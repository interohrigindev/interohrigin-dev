/** HR 플랫폼 프로젝트 현황 라이브 동기화 프록시 — GET /api/hr-sync?key=...
 *  HR 플랫폼의 ceo-staff API(service_role로 RLS 우회)를 서버에서 호출해 프로젝트 현황을 가져온다.
 *  토큰(CEO_STAFF_TOKEN)은 대시보드 Cloudflare 환경변수에만 저장(코드/응답에 노출 안 함).
 *  fresh=1 이면 KV 캐시(5분) 무시.
 */
import type { Env } from "../_lib/storage";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Dashboard-Key",
};
function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...CORS } });
}
function authorized(req: Request, env: Env): boolean {
  const key = req.headers.get("X-Dashboard-Key") || new URL(req.url).searchParams.get("key");
  return key === env.DASHBOARD_KEY;
}

const HR_DEFAULT = "https://interohrigin-hr2.pages.dev";

async function ceoStaff(env: Env, action: string, extra: Record<string, any> = {}): Promise<any> {
  const base = (env.HR_API_URL || HR_DEFAULT).replace(/\/$/, "");
  const res = await fetch(`${base}/api/ceo-staff`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CEO_STAFF_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...extra }),
  });
  if (!res.ok) throw new Error(`ceo-staff ${action} ${res.status}`);
  return res.json();
}

const DONE = /^(done|completed|complete|완료)$/i;

export const onRequestOptions: PagesFunction = async () => new Response(null, { headers: CORS });

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
  if (!env.CEO_STAFF_TOKEN) {
    return json({ ok: false, configured: false, message: "CEO_STAFF_TOKEN 미설정 — 대시보드 Cloudflare Pages 환경변수에 추가하세요. (HR 플랫폼 Cloudflare의 CEO_STAFF_TOKEN 값과 동일)" });
  }

  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  const cacheKey = "hr_sync";
  if (!fresh) {
    try {
      const c = await env.MESSAGES.get(cacheKey);
      if (c) { const o = JSON.parse(c); if (Date.now() - o.fetchedAt < 5 * 60 * 1000) return json({ ...o, cached: true }); }
    } catch { /* noop */ }
  }

  try {
    // "프로젝트 & 업무" 보드 = project_boards, 단계 = pipeline_stages, 이름 = employees
    const [boards, stages, emps] = await Promise.all([
      ceoStaff(env, "query", { table: "project_boards", select: "*", limit: 100 }),
      ceoStaff(env, "query", { table: "pipeline_stages", select: "project_id,stage_name,status,deadline,stage_order", limit: 2000 }).catch(() => []),
      ceoStaff(env, "query", { table: "employees", select: "id,name", limit: 500 }).catch(() => []),
    ]);
    if (boards && boards.error) return json({ ok: false, error: boards.error });

    const empMap: Record<string, string> = {};
    for (const e of (Array.isArray(emps) ? emps : [])) if (e && e.id) empMap[e.id] = e.name;
    const nm = (id: any) => (id && empMap[id]) || null;

    // 대상 직원(차주용) id 찾기 — 이 직원이 담당(담당/관리/리더/임원)인 프로젝트만 표시
    const targetName = env.HR_TARGET_EMPLOYEE || "차주용";
    const target = (Array.isArray(emps) ? emps : []).find((e: any) => e && e.name === targetName);
    if (!target) {
      return json({ ok: true, configured: true, fetchedAt: Date.now(), count: 0, projects: [], note: `직원 '${targetName}'을(를) 찾지 못했습니다.` });
    }
    const tid = target.id;
    const isMine = (p: any) =>
      (Array.isArray(p.assignee_ids) && p.assignee_ids.includes(tid)) ||
      p.manager_id === tid || p.leader_id === tid || p.executive_id === tid;

    // 프로젝트별 단계 모음
    const stagesByProj: Record<string, any[]> = {};
    for (const s of (Array.isArray(stages) ? stages : [])) {
      const pid = s && s.project_id; if (!pid) continue;
      (stagesByProj[pid] = stagesByProj[pid] || []).push(s);
    }

    const out = (Array.isArray(boards) ? boards : []).filter(isMine).map((p: any) => {
      const sts = (stagesByProj[p.id] || []).slice().sort((a, b) => (a.stage_order ?? 0) - (b.stage_order ?? 0));
      const total = sts.length;
      const done = sts.filter(s => String(s.status) === "완료").length;
      const progress = total ? Math.round((done / total) * 100) : null;
      const current = sts.find(s => String(s.status) !== "완료");
      const nextDeadline = sts.filter(s => s.deadline && String(s.status) !== "완료").map(s => s.deadline).sort()[0] || null;
      const assignees = (p.assignee_ids || []).map(nm).filter(Boolean);
      return {
        id: p.id,
        name: p.project_name || p.name || "(이름 없음)",
        status: p.status || null,
        priority: p.priority ?? null,
        manager_name: nm(p.manager_id),
        leader_name: nm(p.leader_id),
        assignee_names: assignees,
        progress,
        stageDone: done,
        stageTotal: total,
        currentStage: current ? current.stage_name : (total ? "전체 단계 완료" : null),
        nextDeadline,
      };
    });

    const payload = { ok: true, configured: true, fetchedAt: Date.now(), count: out.length, projects: out };
    try { await env.MESSAGES.put(cacheKey, JSON.stringify(payload)); } catch { /* noop */ }
    return json(payload);
  } catch (e: any) {
    return json({ ok: false, error: e.message || String(e) }, 502);
  }
};

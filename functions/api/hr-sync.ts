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
    const [projects, tasks] = await Promise.all([
      ceoStaff(env, "query", { table: "projects", select: "*", limit: 100 }),
      ceoStaff(env, "query", { table: "project_tasks", select: "project_id,status", limit: 2000 }).catch(() => []),
    ]);
    if (projects && projects.error) return json({ ok: false, error: projects.error });

    // 프로젝트별 진행률 = project_tasks 완료/전체
    const byProj: Record<string, { total: number; done: number }> = {};
    for (const t of (Array.isArray(tasks) ? tasks : [])) {
      const pid = t && t.project_id; if (!pid) continue;
      const e = byProj[pid] || (byProj[pid] = { total: 0, done: 0 });
      e.total++; if (DONE.test(String(t.status))) e.done++;
    }

    const out = (Array.isArray(projects) ? projects : []).map((p: any) => {
      const st = byProj[p.id];
      const progress = (st && st.total) ? Math.round((st.done / st.total) * 100)
        : (typeof p.progress === "number" ? p.progress : null);
      return {
        id: p.id,
        name: p.name || p.project_name || "(이름 없음)",
        status: p.status || null,
        priority: p.priority ?? null,
        manager_name: p.manager_name || null,
        brand: p.brand || null,
        category: p.category || null,
        start_date: p.start_date || null,
        end_date: p.end_date || p.launch_date || null,
        description: p.description || null,
        progress,
        taskTotal: st ? st.total : 0,
        taskDone: st ? st.done : 0,
      };
    });

    const payload = { ok: true, configured: true, fetchedAt: Date.now(), count: out.length, projects: out };
    try { await env.MESSAGES.put(cacheKey, JSON.stringify(payload)); } catch { /* noop */ }
    return json(payload);
  } catch (e: any) {
    return json({ ok: false, error: e.message || String(e) }, 502);
  }
};

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

// 허용된 레포만 조회 (임의 레포 조회 방지)
const ALLOWED_REPOS = new Set([
  "interohrigindev/interohrigin-hr",
  "interohrigindev/io-finance",
  "interohrigindev/ophe",
  "interohrigindev/boomnzap",
  "interohrigindev/exhiboot",
  "interohrigindev/interohrigin-ir",
  "interohrigindev/interohrigin-dev",
  "interohrigindev/interohrigin-cs",
  "interohrigindev/ai-design-agent",
]);

export const onRequestOptions: PagesFunction = async () => new Response(null, { headers: CORS });

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
  const url = new URL(request.url);
  const repo = url.searchParams.get("repo") || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "8", 10), 20);
  const fresh = url.searchParams.get("fresh") === "1"; // 강제 새로고침: 캐시 무시하고 GitHub 즉시 조회
  if (!ALLOWED_REPOS.has(repo)) return json({ error: "repo not allowed", repo }, 400);

  // KV 캐시 (10분) — fresh=1 이면 건너뜀
  const cacheKey = `commits:${repo}`;
  if (!fresh) {
    try {
      const cached = await env.MESSAGES.get(cacheKey);
      if (cached) {
        const c = JSON.parse(cached);
        if (Date.now() - c.at < 10 * 60 * 1000) {
          return json({ repo, cached: true, fetchedAt: c.at, commits: c.commits.slice(0, limit) });
        }
      }
    } catch {}
  }

  if (!env.GITHUB_TOKEN) {
    return json({ error: "GITHUB_TOKEN 미설정 — Cloudflare Pages Secret에 추가 필요", repo }, 503);
  }

  // GitHub API 조회
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/commits?per_page=20`, {
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "executive-dashboard",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) {
      const txt = await res.text();
      return json({ error: `GitHub API ${res.status}`, detail: txt.slice(0, 200), repo }, res.status);
    }
    const raw = await res.json<any[]>();
    const commits = raw.map(c => ({
      sha: c.sha?.slice(0, 7),
      message: (c.commit?.message || "").split("\n")[0],
      author: c.commit?.author?.name || c.author?.login || "?",
      date: c.commit?.author?.date || "",
      url: c.html_url || "",
    }));
    // 캐시 저장
    const now = Date.now();
    try { await env.MESSAGES.put(cacheKey, JSON.stringify({ at: now, commits })); } catch {}
    return json({ repo, cached: false, fetchedAt: now, commits: commits.slice(0, limit) });
  } catch (e: any) {
    return json({ error: e.message || String(e), repo }, 500);
  }
};

import { listMessages, addMessage, updateMessage, deleteMessage } from "../_lib/storage";
import type { Env } from "../_lib/storage";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Dashboard-Key",
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function authorized(req: Request, env: Env): boolean {
  const key = req.headers.get("X-Dashboard-Key") || new URL(req.url).searchParams.get("key");
  return key === env.DASHBOARD_KEY;
}

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { headers: CORS });

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
  const url = new URL(request.url);
  const panel = url.searchParams.get("panel") || "overview";
  const messages = await listMessages(env, panel);
  const base = `https://${env.SLACK_WORKSPACE}.slack.com/archives/${env.SLACK_CHANNEL_ID}`;
  const messagesWithLinks = messages.map(m => ({
    ...m,
    slackLink: m.slackTs ? `${base}/p${m.slackTs.replace(".", "")}` : null,
    slackChannelUrl: env.SLACK_CHANNEL_URL,
  }));
  return json({ panel, messages: messagesWithLinks, channelUrl: env.SLACK_CHANNEL_URL });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
  const body = await request.json<{ panel: string; category: string; author: string; title?: string; content: string }>();
  const m = await addMessage(env, body);
  return json({ ok: true, message: m });
};

// id를 쿼리 파라미터로 받음 (슬랙 ts의 특수문자 ':' '.' 라우팅 문제 회피)
export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
  const url = new URL(request.url);
  const panel = url.searchParams.get("panel") || "overview";
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "id required" }, 400);
  const body = await request.json<any>();
  const m = await updateMessage(env, panel, id, body);
  return json({ ok: true, message: m });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
  const url = new URL(request.url);
  const panel = url.searchParams.get("panel") || "overview";
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "id required" }, 400);
  await deleteMessage(env, panel, id);
  return json({ ok: true });
};

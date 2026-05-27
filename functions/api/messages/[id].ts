import { updateMessage, deleteMessage } from "../../_lib/storage";
import type { Env } from "../../_lib/storage";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Dashboard-Key",
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...CORS } });
}

function authorized(req: Request, env: Env): boolean {
  const key = req.headers.get("X-Dashboard-Key") || new URL(req.url).searchParams.get("key");
  return key === env.DASHBOARD_KEY;
}

export const onRequestOptions: PagesFunction = async () => new Response(null, { headers: CORS });

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
  const id = params.id as string;
  const url = new URL(request.url);
  const panel = url.searchParams.get("panel") || "overview";
  const body = await request.json<any>();
  const m = await updateMessage(env, panel, id, body);
  return json({ ok: true, message: m });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
  const id = params.id as string;
  const url = new URL(request.url);
  const panel = url.searchParams.get("panel") || "overview";
  await deleteMessage(env, panel, id);
  return json({ ok: true });
};

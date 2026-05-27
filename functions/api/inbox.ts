import { getMessage } from "../_lib/storage";
import { buildInbox } from "../_lib/claude";
import type { Env } from "../_lib/storage";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Dashboard-Key",
};

function authorized(req: Request, env: Env): boolean {
  const key = req.headers.get("X-Dashboard-Key") || new URL(req.url).searchParams.get("key");
  return key === env.DASHBOARD_KEY;
}

export const onRequestOptions: PagesFunction = async () => new Response(null, { headers: CORS });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!authorized(request, env)) return new Response("unauthorized", { status: 401, headers: CORS });
  const body = await request.json<{ ids: string[]; panels: string[] }>();
  const messages: any[] = [];
  for (let i = 0; i < body.panels.length; i++) {
    const m = await getMessage(env, body.panels[i], body.ids[i]);
    if (m) messages.push({ ...m, panel: body.panels[i] });
  }
  const md = buildInbox(messages);
  return new Response(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="inbox-${new Date().toISOString().slice(0,10)}.md"`,
      ...CORS,
    },
  });
};

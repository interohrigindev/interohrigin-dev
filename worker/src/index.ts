/**
 * Executive Dashboard Worker
 * - 슬랙 채널 메시지·이미지를 받아 KV/R2에 저장
 * - 대시보드 API: /api/messages?panel=hr → 모든 임원이 같은 화면
 * - Claude Code Inbox 생성: PM이 선택한 의견을 inbox.md로 정리
 */

import { handleSlackEvent } from "./slack";
import { listMessages, addMessage, deleteMessage, getMessage, updateMessage } from "./storage";
import { buildInbox } from "./claude";

export interface Env {
  ASSETS: Fetcher;
  MESSAGES: KVNamespace;
  IMAGES: R2Bucket;
  SLACK_SIGNING_SECRET: string;
  SLACK_BOT_TOKEN: string;
  DASHBOARD_KEY: string;
  GITHUB_TOKEN?: string;
  ALLOWED_PANELS: string;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Dashboard-Key, X-Slack-Signature, X-Slack-Request-Timestamp",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function authorized(req: Request, env: Env): boolean {
  const key = req.headers.get("X-Dashboard-Key") || new URL(req.url).searchParams.get("key");
  return key === env.DASHBOARD_KEY;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // CORS preflight
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    try {
      // 1) Slack Events 수신
      if (path === "/slack/events" && req.method === "POST") {
        return await handleSlackEvent(req, env);
      }

      // 2) 이미지 프록시 (R2 → 임원 브라우저)
      if (path.startsWith("/img/") && req.method === "GET") {
        const key = path.replace("/img/", "");
        const obj = await env.IMAGES.get(key);
        if (!obj) return new Response("Not found", { status: 404 });
        const headers = new Headers();
        obj.writeHttpMetadata(headers);
        headers.set("etag", obj.httpEtag);
        headers.set("Cache-Control", "public, max-age=3600");
        return new Response(obj.body, { headers });
      }

      // 3) API — 메시지 목록
      if (path === "/api/messages" && req.method === "GET") {
        if (!authorized(req, env)) return json({ error: "unauthorized" }, 401);
        const panel = url.searchParams.get("panel") || "overview";
        const messages = await listMessages(env, panel);
        return json({ panel, messages });
      }

      // 4) API — 메시지 추가 (대시보드에서 작성)
      if (path === "/api/messages" && req.method === "POST") {
        if (!authorized(req, env)) return json({ error: "unauthorized" }, 401);
        const body = await req.json<{
          panel: string;
          category: string;
          author: string;
          title?: string;
          content: string;
        }>();
        const m = await addMessage(env, body);
        return json({ ok: true, message: m });
      }

      // 5) API — 메시지 삭제
      if (path.startsWith("/api/messages/") && req.method === "DELETE") {
        if (!authorized(req, env)) return json({ error: "unauthorized" }, 401);
        const id = path.split("/")[3];
        const panel = url.searchParams.get("panel") || "overview";
        await deleteMessage(env, panel, id);
        return json({ ok: true });
      }

      // 6) API — 메시지 상태 변경 (해결됨/답글)
      if (path.startsWith("/api/messages/") && req.method === "PATCH") {
        if (!authorized(req, env)) return json({ error: "unauthorized" }, 401);
        const id = path.split("/")[3];
        const panel = url.searchParams.get("panel") || "overview";
        const body = await req.json<any>();
        const m = await updateMessage(env, panel, id, body);
        return json({ ok: true, message: m });
      }

      // 7) API — Claude Code Inbox 생성
      if (path === "/api/inbox" && req.method === "POST") {
        if (!authorized(req, env)) return json({ error: "unauthorized" }, 401);
        const body = await req.json<{ ids: string[]; panels: string[] }>();
        const messages: any[] = [];
        for (let i = 0; i < body.panels.length; i++) {
          const m = await getMessage(env, body.panels[i], body.ids[i]);
          if (m) messages.push({ ...m, panel: body.panels[i] });
        }
        const inboxMd = buildInbox(messages);
        return new Response(inboxMd, {
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Content-Disposition": `attachment; filename="inbox-${new Date().toISOString().slice(0,10)}.md"`,
            ...CORS,
          },
        });
      }

      // 8) Health
      if (path === "/health") return json({ ok: true, time: new Date().toISOString() });

      // 9) 정적 자산 (대시보드 HTML)
      return env.ASSETS.fetch(req);
    } catch (err: any) {
      console.error("Worker error:", err);
      return json({ error: err.message || String(err) }, 500);
    }
  },
};

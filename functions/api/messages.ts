import { listMessages, addMessage, updateMessage, deleteMessage, getMessage } from "../_lib/storage";
import { reflectStatusToSlack, postThreadReply, postChannelMessage } from "../_lib/slack-api";
import type { Env, ImageRef } from "../_lib/storage";

const CAT_EMOJI: Record<string, string> = { question: "❓", request: "📋", decision: "⚠️", feedback: "👍" };
const CAT_LABEL2: Record<string, string> = { question: "질문", request: "요청", decision: "결정필요", feedback: "피드백" };

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
  const body = await request.json<{ panel: string; category: string; author: string; title?: string; content: string; imageRefs?: ImageRef[]; postToSlack?: boolean }>();

  // 슬랙 채널에도 게시 → 게시된 ts를 slackTs로 저장 (이후 이모지/thread 양방향 연동)
  let slackTs: string | undefined;
  if (body.postToSlack) {
    const emoji = CAT_EMOJI[body.category] || "❓";
    const label = CAT_LABEL2[body.category] || "질문";
    const text = `${emoji} *[${label}] ${body.author}*\n${body.title ? "*" + body.title + "*\n" : ""}${body.content}\n_경영진 대시보드에서 작성_`;
    const ts = await postChannelMessage(env, text);
    if (ts) slackTs = ts;
  }

  const m = await addMessage(env, {
    ...body,
    slackTs,
    slackChannel: slackTs ? env.SLACK_CHANNEL_ID : undefined,
    fromSlack: false,
  });
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

  // 원본 메시지 (슬랙 ts/channel 확보용)
  const before = await getMessage(env, panel, id);
  const m = await updateMessage(env, panel, id, body);

  // 대시보드 → 슬랙 반영
  if (before?.slackTs && before?.slackChannel) {
    // (1) 상태 변경 → 이모지 반영
    if (body.status) {
      await reflectStatusToSlack(env, before.slackChannel, before.slackTs, body.status);
    }
    // (2) 답글 → 슬랙 thread 전송 (toSlack=true 일 때만)
    if (body.reply && body.reply.toSlack) {
      await postThreadReply(env, before.slackChannel, before.slackTs, body.reply.author, body.reply.content);
    }
  }

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

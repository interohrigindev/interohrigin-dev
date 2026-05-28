/** Slack Events 처리 — R2 없이 이미지는 슬랙 permalink로 점프 */

import type { Env } from "./storage";
import { addMessage, updateMessage, deleteMessageByTs, markResolvedAcrossPanels, setStatusAcrossPanels, updateCategoryAcrossPanels } from "./storage";

const REACTION_CATEGORY: Record<string, string> = {
  question: "question", grey_question: "question",
  clipboard: "request", memo: "request",
  warning: "decision", exclamation: "decision", heavy_exclamation_mark: "decision",
  thumbsup: "feedback", "+1": "feedback",
};

const RESOLVED_REACTIONS = new Set([
  "white_check_mark", "heavy_check_mark", "ballot_box_with_check",
  "white_tick", "done", "white_check",
]);
const REVIEWING_REACTIONS = new Set(["eyes", "mag", "mag_right"]); // 👀 🔍

export function panelFromText(text: string | undefined): string {
  if (!text) return "overview";
  const t = text.toLowerCase();
  const tagMatch = t.match(/#([a-z가-힣-]+)/);
  if (tagMatch) {
    const tag = tagMatch[1];
    if (/^hr|인사|채용|평가/.test(tag)) return "hr";
    if (/^cs|고객|상담/.test(tag))     return "cs";
    if (/^(finance|재무|자금|손익)/.test(tag)) return "finance";
    if (/^ophe/.test(tag))             return "ophe";
    if (/^(ai-?design|디자인)/.test(tag)) return "ai-design";
    if (/^(boom|zap|붐앤잽)/.test(tag))  return "boomzap";
    if (/^(cost|과금|비용)/.test(tag))    return "cost";
    if (/^(future|향후|계획)/.test(tag))  return "future";
  }
  if (/\bhr\b|인사평가|채용|면접|연차|결재/.test(t))  return "hr";
  if (/\bcs\b|고객지원|상담|티켓/.test(t))             return "cs";
  if (/재무|자금계획|손익|고정비/.test(t))             return "finance";
  if (/\bophe\b|오프|cafe24/.test(t))                  return "ophe";
  if (/ai.?design|디자인.?에이전트/.test(t))           return "ai-design";
  if (/붐앤잽|boom.?n.?zap/.test(t))                   return "boomzap";
  return "overview";
}

async function verifySig(req: Request, env: Env, raw: string): Promise<boolean> {
  const ts = req.headers.get("X-Slack-Request-Timestamp");
  const sig = req.headers.get("X-Slack-Signature");
  if (!ts || !sig) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(ts, 10)) > 300) return false;
  const base = `v0:${ts}:${raw}`;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.SLACK_SIGNING_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(base));
  const expected = "v0=" + Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, "0")).join("");
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

async function getUserName(userId: string, env: Env): Promise<string> {
  try {
    const res = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
      headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` },
    });
    const data = await res.json<any>();
    return data?.user?.real_name || data?.user?.name || userId;
  } catch { return userId; }
}

// 이미지 메타데이터만 저장 (실제 파일은 슬랙에 둠 → permalink로 점프)
function extractImageRefs(files: any[]): string[] {
  if (!Array.isArray(files)) return [];
  return files
    .filter(f => f.mimetype?.startsWith("image/"))
    .map(f => f.name || "image");
}

export async function handleSlackEvent(req: Request, env: Env): Promise<Response> {
  const raw = await req.text();
  if (!(await verifySig(req, env, raw))) return new Response("Invalid signature", { status: 401 });

  const payload = JSON.parse(raw);
  if (payload.type === "url_verification") {
    return new Response(payload.challenge, { headers: { "Content-Type": "text/plain" } });
  }
  if (payload.type !== "event_callback") return new Response("ok");

  const event = payload.event;
  try {
    if (event.bot_id || event.subtype === "bot_message") return new Response("ok");

    const incomingChannel = event.channel || event.item?.channel;
    if (env.SLACK_CHANNEL_ID && incomingChannel && incomingChannel !== env.SLACK_CHANNEL_ID) {
      return new Response("ok");
    }

    const messageText = event.text || event.message?.text || event.previous_message?.text || "";
    const panel = panelFromText(messageText);

    if (event.type === "message" && event.subtype === undefined && event.text !== undefined) {
      const author = event.user ? await getUserName(event.user, env) : "익명";
      const imageRefs = extractImageRefs(event.files);
      const isThreadReply = event.thread_ts && event.thread_ts !== event.ts;
      if (isThreadReply) {
        await updateMessage(env, panel, "ts:" + event.thread_ts, {
          reply: {
            author,
            content: event.text + (imageRefs.length ? `\n📎 이미지 ${imageRefs.length}건` : ""),
            imageRefs,
            slackTs: event.ts,
          },
        }, true);
      } else {
        await addMessage(env, {
          panel, category: "question", author, title: "",
          content: event.text,
          slackTs: event.ts, slackChannel: event.channel, slackUserId: event.user,
          imageRefs, fromSlack: true,
        });
      }
    }

    if (event.type === "message" && event.subtype === "message_changed") {
      const ts = event.message?.ts;
      if (ts) {
        await updateMessage(env, panel, "ts:" + ts, {
          content: event.message?.text || "", edited: true,
        }, true);
      }
    }

    if (event.type === "message" && event.subtype === "message_deleted") {
      const ts = event.previous_message?.ts;
      if (ts) await deleteMessageByTs(env, panel, ts);
    }

    if (event.type === "reaction_added" && event.item?.ts) {
      const r = event.reaction;
      if (RESOLVED_REACTIONS.has(r)) await setStatusAcrossPanels(env, event.item.ts, "resolved");
      else if (REVIEWING_REACTIONS.has(r)) await setStatusAcrossPanels(env, event.item.ts, "reviewing");
      const cat = REACTION_CATEGORY[r];
      if (cat) await updateCategoryAcrossPanels(env, event.item.ts, cat);
    }
    if (event.type === "reaction_removed" && event.item?.ts) {
      const r = event.reaction;
      if (RESOLVED_REACTIONS.has(r) || REVIEWING_REACTIONS.has(r)) await setStatusAcrossPanels(env, event.item.ts, "open");
    }
  } catch (e) {
    console.error("Event error:", e);
  }
  return new Response("ok");
}

/**
 * Slack Events API 처리
 * - 서명 검증 (HMAC SHA-256 with signing secret)
 * - URL verification (Slack App 등록 시 1회)
 * - message / message.changed / message.deleted / reaction_added 이벤트 처리
 * - 첨부 이미지: Slack files.info → Bot Token으로 다운로드 → R2 업로드
 */

import type { Env } from "./index";
import { addMessage, updateMessage, deleteMessageByTs } from "./storage";

// Slack의 reaction emoji → 카테고리 매핑
const REACTION_CATEGORY: Record<string, string> = {
  "question": "question",        // :question:
  "grey_question": "question",
  "clipboard": "request",         // :clipboard:
  "memo": "request",
  "warning": "decision",          // :warning:
  "exclamation": "decision",
  "heavy_exclamation_mark": "decision",
  "thumbsup": "feedback",         // :+1:
  "+1": "feedback",
};

// 채널 이름 → 패널 매핑 (예: io-cs → cs, io-finance → finance)
function panelFromChannel(channelName: string | undefined): string {
  if (!channelName) return "overview";
  const n = channelName.toLowerCase();
  if (n.includes("hr"))           return "hr";
  if (n.includes("cs"))           return "cs";
  if (n.includes("finance") || n.includes("재무") || n.includes("자금")) return "finance";
  if (n.includes("ophe"))         return "ophe";
  if (n.includes("ai-design") || n.includes("design")) return "ai-design";
  if (n.includes("boomzap") || n.includes("붐앤잽") || n.includes("boom"))  return "boomzap";
  return "overview";
}

async function verifySlackSignature(req: Request, env: Env, rawBody: string): Promise<boolean> {
  const ts = req.headers.get("X-Slack-Request-Timestamp");
  const sig = req.headers.get("X-Slack-Signature");
  if (!ts || !sig) return false;
  // 5분 초과 timestamp는 거부 (replay 방지)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(ts, 10)) > 60 * 5) return false;
  const baseString = `v0:${ts}:${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SLACK_SIGNING_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(baseString));
  const expected = "v0=" + Array.from(new Uint8Array(mac))
    .map(b => b.toString(16).padStart(2, "0")).join("");
  // 상수시간 비교
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

async function downloadAndStoreImage(file: any, env: Env): Promise<string | null> {
  if (!file?.url_private) return null;
  try {
    const res = await fetch(file.url_private, {
      headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` },
    });
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const ext = (file.name || "image").split(".").pop() || "png";
    const key = `${file.id}.${ext}`;
    await env.IMAGES.put(key, buffer, {
      httpMetadata: { contentType: file.mimetype || "image/png" },
    });
    return `/img/${key}`;
  } catch (e) {
    console.error("Image download failed:", e);
    return null;
  }
}

async function getChannelName(channelId: string, env: Env): Promise<string | undefined> {
  try {
    const res = await fetch(`https://slack.com/api/conversations.info?channel=${channelId}`, {
      headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` },
    });
    const data = await res.json<any>();
    return data?.channel?.name;
  } catch { return undefined; }
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

export async function handleSlackEvent(req: Request, env: Env): Promise<Response> {
  const rawBody = await req.text();

  // 1) 서명 검증
  if (!(await verifySlackSignature(req, env, rawBody))) {
    return new Response("Invalid signature", { status: 401 });
  }

  const payload = JSON.parse(rawBody);

  // 2) URL verification (Slack App 등록 시)
  if (payload.type === "url_verification") {
    return new Response(payload.challenge, { headers: { "Content-Type": "text/plain" } });
  }

  if (payload.type !== "event_callback") {
    return new Response("ok");
  }

  const event = payload.event;

  // 3) 메시지 처리
  try {
    // 봇이 자기가 쓴 메시지를 다시 받지 않게
    if (event.bot_id || event.subtype === "bot_message") return new Response("ok");

    const channelName = await getChannelName(event.channel, env);
    const panel = panelFromChannel(channelName);

    if (event.type === "message" && event.subtype === undefined && event.text !== undefined) {
      const author = event.user ? await getUserName(event.user, env) : "익명";

      // 첨부 이미지 처리
      const imageUrls: string[] = [];
      if (Array.isArray(event.files)) {
        for (const f of event.files) {
          if (f.mimetype?.startsWith("image/")) {
            const stored = await downloadAndStoreImage(f, env);
            if (stored) imageUrls.push(stored);
          }
        }
      }

      await addMessage(env, {
        panel,
        category: "question",  // 기본값. reaction으로 변경됨.
        author,
        title: "",
        content: event.text,
        slackTs: event.ts,
        slackChannel: event.channel,
        slackUserId: event.user,
        images: imageUrls,
        fromSlack: true,
      });
    }

    // 메시지 수정
    if (event.type === "message" && event.subtype === "message_changed") {
      const ts = event.message?.ts;
      if (ts) {
        await updateMessage(env, panel, "ts:" + ts, {
          content: event.message?.text || "",
          edited: true,
        }, true);
      }
    }

    // 메시지 삭제
    if (event.type === "message" && event.subtype === "message_deleted") {
      const ts = event.previous_message?.ts;
      if (ts) await deleteMessageByTs(env, panel, ts);
    }

    // 이모지 반응 → 카테고리 변경
    if (event.type === "reaction_added") {
      const cat = REACTION_CATEGORY[event.reaction];
      if (cat && event.item?.ts) {
        const item_channel_name = await getChannelName(event.item.channel, env);
        const item_panel = panelFromChannel(item_channel_name);
        await updateMessage(env, item_panel, "ts:" + event.item.ts, {
          category: cat,
        }, true);
      }
    }
  } catch (e) {
    console.error("Event processing error:", e);
  }

  // Slack은 3초 안에 200 응답 필수
  return new Response("ok");
}

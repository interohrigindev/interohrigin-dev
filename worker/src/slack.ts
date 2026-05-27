/**
 * Slack Events API 처리
 * - 서명 검증 (HMAC SHA-256 with signing secret)
 * - URL verification (Slack App 등록 시 1회)
 * - message / message.changed / message.deleted / reaction_added 이벤트 처리
 * - 첨부 이미지: Slack files.info → Bot Token으로 다운로드 → R2 업로드
 */

import type { Env } from "./index";
import { addMessage, updateMessage, deleteMessageByTs, markResolvedAcrossPanels, updateCategoryAcrossPanels } from "./storage";

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

// 완료 처리 이모지: PM이 슬랙에서 ✅ 반응 → resolved=true 자동
const RESOLVED_REACTIONS = new Set([
  "white_check_mark",  // ✅
  "heavy_check_mark",  // ✔️
  "ballot_box_with_check",
  "white_tick", "done", "white_check",
]);

// 단일 채널 운영 — 메시지 첫 줄의 해시태그/키워드로 패널 자동 분류
// 예: "#hr 채용 면접 페이지 디자인 검토" → HR 탭
//     "#재무 6/9 베타 일정 확인" → 재무 탭
//     해시태그 없으면 overview 탭으로 들어감
function panelFromText(text: string | undefined): string {
  if (!text) return "overview";
  const t = text.toLowerCase();
  // 우선 해시태그 명시
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
  // 본문 키워드 추정 (해시태그 없으면)
  if (/\bhr\b|인사평가|채용|면접|연차|결재/.test(t))  return "hr";
  if (/\bcs\b|고객지원|상담|티켓/.test(t))             return "cs";
  if (/재무|자금계획|손익|고정비/.test(t))             return "finance";
  if (/\bophe\b|오프|cafe24/.test(t))                  return "ophe";
  if (/ai.?design|디자인.?에이전트/.test(t))           return "ai-design";
  if (/붐앤잽|boom.?n.?zap/.test(t))                   return "boomzap";
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

    // 단일 채널 운영 — 지정된 채널 외에는 무시
    const incomingChannel = event.channel || event.item?.channel;
    if (env.SLACK_CHANNEL_ID && incomingChannel && incomingChannel !== env.SLACK_CHANNEL_ID) {
      return new Response("ok"); // 다른 채널은 조용히 무시
    }

    // 패널은 메시지 본문에서 추정
    const messageText = event.text || event.message?.text || event.previous_message?.text || "";
    const panel = panelFromText(messageText);

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

      // 스레드 답글 처리: thread_ts !== ts → 부모 메시지의 reply로 등록
      const isThreadReply = event.thread_ts && event.thread_ts !== event.ts;
      if (isThreadReply) {
        await updateMessage(env, panel, "ts:" + event.thread_ts, {
          reply: {
            author,
            content: event.text + (imageUrls.length ? "\n📎 이미지 " + imageUrls.length + "건" : ""),
            at: new Date().toLocaleString("ko-KR"),
            images: imageUrls,
            slackTs: event.ts,
          } as any,
        }, true);
      } else {
        await addMessage(env, {
          panel,
          category: "question",
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

    // 이모지 반응 처리
    if (event.type === "reaction_added" && event.item?.ts) {
      const targetTs = event.item.ts;
      // 단일 채널이라 패널을 알 수 없음 — 전체 패널에서 찾아서 업데이트
      const reaction = event.reaction;

      // (1) 완료 이모지 — PM이 슬랙에서 ✅ 누르면 resolved=true
      if (RESOLVED_REACTIONS.has(reaction)) {
        await markResolvedAcrossPanels(env, targetTs, true);
      }
      // (2) 카테고리 변경 이모지
      const cat = REACTION_CATEGORY[reaction];
      if (cat) {
        await updateCategoryAcrossPanels(env, targetTs, cat);
      }
    }
    if (event.type === "reaction_removed" && event.item?.ts) {
      if (RESOLVED_REACTIONS.has(event.reaction)) {
        await markResolvedAcrossPanels(env, event.item.ts, false);
      }
    }
  } catch (e) {
    console.error("Event processing error:", e);
  }

  // Slack은 3초 안에 200 응답 필수
  return new Response("ok");
}

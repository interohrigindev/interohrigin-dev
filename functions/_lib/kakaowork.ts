/** 카카오워크 알림 — 봇(App Key)으로 "단톡방 하나"에 모든 의견/답글 공유
 *
 *  전송 대상 conversation_id 결정 순서:
 *   1) env.KAKAOWORK_CONVERSATION_ID 가 있으면 그 방으로 바로 전송 (권장: 기존 단톡방에 봇 초대 후 그 방 id 지정)
 *   2) 없으면 env.KAKAOWORK_RECIPIENTS(이메일들)로 그룹 채팅방을 1회 생성/확보(KV 캐시)해서 그 방으로 전송
 *   3) App Key 가 아예 없고 KAKAOWORK_WEBHOOK_URL 만 있으면 인커밍 웹훅({text})으로 폴백
 *  실패는 throw 하지 않음(알림 실패가 본 저장을 막지 않도록).
 */
import type { Env, ImageRef } from "./storage";

const API = "https://api.kakaowork.com/v1";
const GROUP_CACHE_KEY = "kakao_group_conv"; // 자동 생성 그룹방 id 캐시

const PANEL_NAMES: Record<string, string> = {
  overview: "🏠 종합 현황", hr: "👥 HR 플랫폼", cs: "🎧 CS 플랫폼", finance: "💰 재무관리",
  ophe: "🌿 OPHE", "ai-design": "🎨 AI 디자인", boomzap: "💧 붐앤잽",
  completed: "✅ 완료", cost: "💵 과금", future: "🚀 향후",
};
const CAT: Record<string, { emoji: string; label: string }> = {
  question: { emoji: "❓", label: "질문" },
  request: { emoji: "📋", label: "요청" },
  decision: { emoji: "⚠️", label: "결정필요" },
  feedback: { emoji: "👍", label: "피드백" },
};

function panelName(p: string) { return PANEL_NAMES[p] || p; }
function dashUrl(env: Env, panel: string) {
  const base = (env.DASHBOARD_URL || "https://interohrigin-dev.pages.dev").replace(/\/$/, "");
  return `${base}/#${panel}`;
}
function clip(s: string, n: number) {
  s = (s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
}
function recipients(env: Env): string[] {
  return (env.KAKAOWORK_RECIPIENTS || "").split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
}

// --- 카카오워크 Web API (봇 App Key 인증) ---
async function kwGet(env: Env, path: string): Promise<any> {
  const r = await fetch(API + path, { headers: { Authorization: `Bearer ${env.KAKAOWORK_APP_KEY}` } });
  return r.json().catch(() => ({}));
}
async function kwPost(env: Env, path: string, body: any): Promise<any> {
  const r = await fetch(API + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.KAKAOWORK_APP_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json().catch(() => ({}));
}

async function userIdByEmail(env: Env, email: string): Promise<string | null> {
  const u = await kwGet(env, `/users.find_by_email?email=${encodeURIComponent(email)}`);
  return (u && u.user && u.user.id) ? String(u.user.id) : null;
}

// 봇이 속한 채팅방 목록 (id/type/name/users_count) — 단톡방 id 찾기용
export async function listRooms(env: Env): Promise<any[]> {
  if (!env.KAKAOWORK_APP_KEY) return [];
  const r = await kwGet(env, `/conversations.list?limit=100`);
  return (r && Array.isArray(r.conversations)) ? r.conversations : [];
}

// 전송 대상 단톡방 conversation_id 결정
async function targetConversationId(env: Env): Promise<string | null> {
  // 1) 명시된 단톡방 id
  if (env.KAKAOWORK_CONVERSATION_ID) return String(env.KAKAOWORK_CONVERSATION_ID);

  // 2) 수신자 이메일들로 그룹방 1회 생성 후 캐시
  const emails = recipients(env);
  if (!emails.length) return null;
  try { const c = await env.MESSAGES.get(GROUP_CACHE_KEY); if (c) return c; } catch { /* noop */ }

  const ids: string[] = [];
  for (const e of emails) { const id = await userIdByEmail(env, e); if (id) ids.push(id); }
  if (!ids.length) return null;

  const body: any = ids.length === 1
    ? { user_id: ids[0] }
    : { user_ids: ids, conversation_name: env.KAKAOWORK_CONVERSATION_NAME || "IO 개발현황 알림" };
  const c = await kwPost(env, `/conversations.open`, body);
  const cid = c && c.conversation && c.conversation.id;
  if (cid) { try { await env.MESSAGES.put(GROUP_CACHE_KEY, String(cid)); } catch { /* noop */ } }
  return cid ? String(cid) : null;
}

// 실제 전송 — 봇(단톡방 1곳) 우선, 없으면 웹훅
async function deliver(env: Env, text: string): Promise<void> {
  if (env.KAKAOWORK_APP_KEY) {
    try {
      const cid = await targetConversationId(env);
      if (cid) await kwPost(env, `/messages.send`, { conversation_id: cid, text });
    } catch { /* noop */ }
    return;
  }
  if (env.KAKAOWORK_WEBHOOK_URL) {
    try {
      await fetch(env.KAKAOWORK_WEBHOOK_URL, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }),
      });
    } catch { /* noop */ }
  }
}

export async function notifyNewMessage(
  env: Env,
  m: { panel: string; category: string; author: string; title?: string; content: string; imageRefs?: ImageRef[] }
): Promise<void> {
  const cat = CAT[m.category] || CAT.question;
  const lines = [
    `${cat.emoji} [${cat.label}] 새 의견 · ${panelName(m.panel)}`,
    `작성자: ${m.author}`,
  ];
  if (m.title) lines.push(`제목: ${m.title}`);
  lines.push("", clip(m.content, 500));
  if (m.imageRefs && m.imageRefs.length) lines.push(`📎 이미지 ${m.imageRefs.length}건`);
  lines.push("", `🔗 대시보드: ${dashUrl(env, m.panel)}`);
  await deliver(env, lines.join("\n"));
}

export async function notifyNewReply(
  env: Env,
  panel: string,
  original: { author: string; content: string } | null,
  reply: { author: string; content: string }
): Promise<void> {
  const lines = [
    `↳ 답글 · ${panelName(panel)}`,
    `${reply.author} 님이 답글을 남겼습니다.`,
    "",
    clip(reply.content, 400),
  ];
  if (original) lines.push("", `(원글 ${original.author}: ${clip(original.content, 60)})`);
  lines.push("", `🔗 대시보드: ${dashUrl(env, panel)}`);
  await deliver(env, lines.join("\n"));
}

// 설정 점검용 — 모드/대상 단톡방/수신자 해석 결과
export async function diagnose(env: Env): Promise<any> {
  const mode = env.KAKAOWORK_APP_KEY ? "bot" : (env.KAKAOWORK_WEBHOOK_URL ? "webhook" : "none");
  const result: any = { mode };
  if (mode === "bot") {
    result.conversationIdEnv = env.KAKAOWORK_CONVERSATION_ID || null;
    result.recipientEmails = recipients(env);
    if (!env.KAKAOWORK_CONVERSATION_ID) {
      result.recipients = [];
      for (const email of recipients(env)) {
        const id = await userIdByEmail(env, email);
        result.recipients.push({ email, found: !!id, userId: id });
      }
    }
    try { result.targetConversationId = await targetConversationId(env); } catch (e: any) { result.targetConversationId = null; }
  }
  return result;
}

/** 카카오워크 알림
 *  두 가지 방식을 모두 지원(설정된 것 우선):
 *   (A) 봇(App Key) 방식 — 권장. env.KAKAOWORK_APP_KEY + KAKAOWORK_RECIPIENTS(이메일들).
 *       users.find_by_email → conversations.open → messages.send 순서로 각 수신자에게 알림 DM.
 *   (B) 인커밍 웹훅 방식 — env.KAKAOWORK_WEBHOOK_URL 로 {text} POST.
 *  실패는 throw 하지 않음(알림 실패가 본 저장을 막지 않도록).
 */
import type { Env, ImageRef } from "./storage";

const API = "https://api.kakaowork.com/v1";

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

// --- 카카오워크 Web API 호출 (봇 App Key 인증) ---
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

// 이메일 → conversation_id (KV 캐시 30일)
async function convIdForEmail(env: Env, email: string): Promise<string | null> {
  const cacheKey = `kakao_conv:${email.toLowerCase()}`;
  try { const c = await env.MESSAGES.get(cacheKey); if (c) return c; } catch { /* noop */ }
  const u = await kwGet(env, `/users.find_by_email?email=${encodeURIComponent(email)}`);
  const uid = u && u.user && u.user.id;
  if (!uid) return null;
  const c = await kwPost(env, `/conversations.open`, { user_id: uid });
  const cid = c && c.conversation && c.conversation.id;
  if (cid) { try { await env.MESSAGES.put(cacheKey, String(cid), { expirationTtl: 60 * 60 * 24 * 30 }); } catch { /* noop */ } }
  return cid ? String(cid) : null;
}

// 실제 전송 — 봇 우선, 없으면 웹훅
async function deliver(env: Env, text: string): Promise<void> {
  if (env.KAKAOWORK_APP_KEY) {
    for (const email of recipients(env)) {
      try {
        const cid = await convIdForEmail(env, email);
        if (cid) await kwPost(env, `/messages.send`, { conversation_id: cid, text });
      } catch { /* 개별 수신자 실패 무시 */ }
    }
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

// 설정 점검용 — 모드/수신자 해석 결과를 반환
export async function diagnose(env: Env): Promise<any> {
  const mode = env.KAKAOWORK_APP_KEY ? "bot" : (env.KAKAOWORK_WEBHOOK_URL ? "webhook" : "none");
  const result: any = { mode, recipients: [] as any[] };
  if (mode === "bot") {
    result.recipientEmails = recipients(env);
    for (const email of recipients(env)) {
      const u = await kwGet(env, `/users.find_by_email?email=${encodeURIComponent(email)}`);
      result.recipients.push({
        email,
        found: !!(u && u.user && u.user.id),
        userId: (u && u.user && u.user.id) || null,
        error: u && u.error ? u.error : undefined,
      });
    }
  }
  return result;
}

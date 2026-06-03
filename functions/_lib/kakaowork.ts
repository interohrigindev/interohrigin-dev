/** 카카오워크 알림 — Incoming Webhook 전송
 *  대시보드에 새 의견/답글이 올라오면 지정한 카카오워크 채팅방으로 알림을 보냄.
 *  env.KAKAOWORK_WEBHOOK_URL 이 설정돼 있을 때만 동작(없으면 조용히 무시).
 *  실패는 throw 하지 않음(알림 실패가 본 저장을 막지 않도록).
 */
import type { Env, ImageRef } from "./storage";

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

// 카카오워크 인커밍 웹훅은 { text } 형식이 가장 안정적. URL은 자동으로 링크가 됨.
async function send(env: Env, text: string): Promise<void> {
  const url = env.KAKAOWORK_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (_e) {
    // 알림 실패는 무시
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
  await send(env, lines.join("\n"));
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
  await send(env, lines.join("\n"));
}

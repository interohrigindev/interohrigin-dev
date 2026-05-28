/** Slack Web API 호출 (대시보드 → 슬랙 반영) */

import type { Env } from "./storage";

const STATUS_REACTION: Record<string, string> = {
  resolved: "white_check_mark",  // ✅
  reviewing: "eyes",             // 👀
};

// 메시지에 이모지 반응 추가
export async function addReaction(env: Env, channel: string, ts: string, name: string): Promise<void> {
  if (!env.SLACK_BOT_TOKEN) return;
  try {
    await fetch("https://slack.com/api/reactions.add", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel, timestamp: ts, name }),
    });
  } catch (e) { console.error("reactions.add 실패:", e); }
}

export async function removeReaction(env: Env, channel: string, ts: string, name: string): Promise<void> {
  if (!env.SLACK_BOT_TOKEN) return;
  try {
    await fetch("https://slack.com/api/reactions.remove", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel, timestamp: ts, name }),
    });
  } catch (e) { console.error("reactions.remove 실패:", e); }
}

// status 변경을 슬랙 이모지로 반영 (resolved→✅, reviewing→👀, open→둘 다 제거)
export async function reflectStatusToSlack(env: Env, channel: string, ts: string, newStatus: string): Promise<void> {
  if (!channel || !ts) return;
  if (newStatus === "resolved") {
    await removeReaction(env, channel, ts, "eyes");
    await addReaction(env, channel, ts, "white_check_mark");
  } else if (newStatus === "reviewing") {
    await removeReaction(env, channel, ts, "white_check_mark");
    await addReaction(env, channel, ts, "eyes");
  } else {
    await removeReaction(env, channel, ts, "white_check_mark");
    await removeReaction(env, channel, ts, "eyes");
  }
}

// 슬랙 thread에 답글 전송
export async function postThreadReply(env: Env, channel: string, threadTs: string, author: string, content: string): Promise<void> {
  if (!env.SLACK_BOT_TOKEN || !channel || !threadTs) return;
  try {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        channel,
        thread_ts: threadTs,
        text: `💬 *${author}* (대시보드 답글)\n${content}`,
      }),
    });
  } catch (e) { console.error("chat.postMessage 실패:", e); }
}

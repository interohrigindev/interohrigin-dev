/**
 * KV 저장 레이어
 * - key: `panel:{panelKey}` → JSON 배열 (메시지 목록)
 * - 메시지 1건: { id, category, author, title, content, at, replies, resolved, slackTs?, images?, fromSlack? }
 */

import type { Env } from "./index";

export interface Message {
  id: string;
  category: string;
  author: string;
  title?: string;
  content: string;
  at: string;
  _ts: number;
  replies: Array<{ author: string; content: string; at: string }>;
  resolved: boolean;
  slackTs?: string;
  slackChannel?: string;
  slackUserId?: string;
  images?: string[];
  fromSlack?: boolean;
  sentToSlack?: boolean;
  edited?: boolean;
}

function keyForPanel(panel: string): string { return `panel:${panel}`; }

export async function listMessages(env: Env, panel: string): Promise<Message[]> {
  const raw = await env.MESSAGES.get(keyForPanel(panel));
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

async function saveMessages(env: Env, panel: string, messages: Message[]): Promise<void> {
  await env.MESSAGES.put(keyForPanel(panel), JSON.stringify(messages));
}

export async function addMessage(env: Env, input: {
  panel: string;
  category: string;
  author: string;
  title?: string;
  content: string;
  slackTs?: string;
  slackChannel?: string;
  slackUserId?: string;
  images?: string[];
  fromSlack?: boolean;
}): Promise<Message> {
  const messages = await listMessages(env, input.panel);
  const now = Date.now();
  const m: Message = {
    id: input.slackTs ? "ts:" + input.slackTs : "id:" + now + "-" + Math.random().toString(36).slice(2, 8),
    category: input.category,
    author: input.author,
    title: input.title || "",
    content: input.content,
    at: new Date(now).toLocaleString("ko-KR"),
    _ts: now,
    replies: [],
    resolved: false,
    slackTs: input.slackTs,
    slackChannel: input.slackChannel,
    slackUserId: input.slackUserId,
    images: input.images || [],
    fromSlack: input.fromSlack || false,
  };
  messages.push(m);
  await saveMessages(env, input.panel, messages);
  return m;
}

export async function getMessage(env: Env, panel: string, id: string): Promise<Message | null> {
  const list = await listMessages(env, panel);
  return list.find(m => m.id === id) || null;
}

export async function updateMessage(
  env: Env,
  panel: string,
  id: string,
  patch: Partial<Message> | { reply?: { author: string; content: string } },
  upsert = false
): Promise<Message | null> {
  const list = await listMessages(env, panel);
  let idx = list.findIndex(m => m.id === id);
  if (idx === -1) {
    if (!upsert) return null;
    // 슬랙 이벤트가 메시지보다 먼저 도착했을 때 (드물지만 가능)
    const ts = id.startsWith("ts:") ? id.slice(3) : "";
    list.push({
      id, category: "question", author: "?", content: "", at: new Date().toLocaleString("ko-KR"),
      _ts: Date.now(), replies: [], resolved: false, slackTs: ts, fromSlack: true, images: [],
    });
    idx = list.length - 1;
  }
  // reply 추가
  if ((patch as any).reply) {
    const reply = (patch as any).reply;
    list[idx].replies = list[idx].replies || [];
    list[idx].replies.push({
      author: reply.author || "익명",
      content: reply.content,
      at: new Date().toLocaleString("ko-KR"),
    });
  } else {
    Object.assign(list[idx], patch);
  }
  await saveMessages(env, panel, list);
  return list[idx];
}

export async function deleteMessage(env: Env, panel: string, id: string): Promise<void> {
  const list = await listMessages(env, panel);
  const next = list.filter(m => m.id !== id);
  await saveMessages(env, panel, next);
}

export async function deleteMessageByTs(env: Env, panel: string, ts: string): Promise<void> {
  await deleteMessage(env, panel, "ts:" + ts);
}

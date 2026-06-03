/** KV 저장 레이어 — Cloudflare Pages Functions용 */

// 첨부 이미지 참조. 신규는 객체({id,name,mime}), 과거 슬랙 메시지는 문자열일 수 있음.
export type ImageRef = string | { id: string; name?: string; mime?: string };

export interface Env {
  MESSAGES: KVNamespace;
  SLACK_SIGNING_SECRET: string;
  SLACK_BOT_TOKEN: string;
  DASHBOARD_KEY: string;
  SLACK_WORKSPACE: string;
  SLACK_CHANNEL_ID: string;
  SLACK_CHANNEL_URL: string;
  GITHUB_TOKEN?: string;
  // 카카오워크 알림 — 봇(App Key) 방식 (권장)
  KAKAOWORK_APP_KEY?: string;        // 봇 개발에서 발급된 App Key (Bearer)
  KAKAOWORK_RECIPIENTS?: string;     // 알림 받을 멤버 이메일(콤마/공백 구분)
  // 카카오워크 알림 — 인커밍 웹훅 방식 (폴백). 설정 시 {text} 로 POST.
  KAKAOWORK_WEBHOOK_URL?: string;
  // 알림 메시지에 넣을 대시보드 주소(미설정 시 기본 pages.dev 사용)
  DASHBOARD_URL?: string;
}

export interface Message {
  id: string;
  category: string;
  author: string;
  title?: string;
  content: string;
  at: string;
  _ts: number;
  replies: Array<{ author: string; content: string; at: string; _ts?: number; imageRefs?: ImageRef[]; slackTs?: string; toSlack?: boolean }>;
  resolved: boolean;
  status?: "open" | "reviewing" | "resolved";
  slackTs?: string;
  slackChannel?: string;
  slackUserId?: string;
  imageRefs?: ImageRef[]; // 첨부 이미지 참조 (KV `img:<id>`)
  fromSlack?: boolean;
  edited?: boolean;
}

const ALL_PANELS = ["overview","hr","cs","finance","ophe","ai-design","boomzap","completed","cost","future"];
const keyForPanel = (panel: string) => `panel:${panel}`;

// Cloudflare Worker는 UTC로 실행되므로 timeZone을 명시해야 한국시간(KST)으로 찍힘
const nowKST = (ms?: number) => new Date(ms ?? Date.now()).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

export async function listMessages(env: Env, panel: string): Promise<Message[]> {
  const raw = await env.MESSAGES.get(keyForPanel(panel));
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

async function saveMessages(env: Env, panel: string, messages: Message[]): Promise<void> {
  await env.MESSAGES.put(keyForPanel(panel), JSON.stringify(messages));
}

export async function addMessage(env: Env, input: {
  panel: string; category: string; author: string; title?: string; content: string;
  slackTs?: string; slackChannel?: string; slackUserId?: string;
  imageRefs?: ImageRef[]; fromSlack?: boolean;
}): Promise<Message> {
  const messages = await listMessages(env, input.panel);
  const now = Date.now();
  const m: Message = {
    id: input.slackTs ? "ts:" + input.slackTs : "id:" + now + "-" + Math.random().toString(36).slice(2, 8),
    category: input.category,
    author: input.author,
    title: input.title || "",
    content: input.content,
    at: nowKST(now),
    _ts: now,
    replies: [],
    resolved: false,
    slackTs: input.slackTs,
    slackChannel: input.slackChannel,
    slackUserId: input.slackUserId,
    imageRefs: input.imageRefs || [],
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

export async function updateMessage(env: Env, panel: string, id: string, patch: any, upsert = false): Promise<Message | null> {
  const list = await listMessages(env, panel);
  let idx = list.findIndex(m => m.id === id);
  if (idx === -1) {
    if (!upsert) return null;
    const ts = id.startsWith("ts:") ? id.slice(3) : "";
    list.push({
      id, category: "question", author: "?", content: "",
      at: nowKST(),
      _ts: Date.now(), replies: [], resolved: false,
      slackTs: ts, fromSlack: true, imageRefs: [],
    });
    idx = list.length - 1;
  }
  if (patch.reply) {
    list[idx].replies = list[idx].replies || [];
    list[idx].replies.push({
      author: patch.reply.author || "익명",
      content: patch.reply.content,
      at: nowKST(),
      _ts: Date.now(),
      imageRefs: patch.reply.imageRefs || [],
      slackTs: patch.reply.slackTs,
    });
  } else {
    Object.assign(list[idx], patch);
  }
  await saveMessages(env, panel, list);
  return list[idx];
}

export async function deleteMessage(env: Env, panel: string, id: string): Promise<void> {
  const list = await listMessages(env, panel);
  await saveMessages(env, panel, list.filter(m => m.id !== id));
}

export async function deleteMessageByTs(env: Env, panel: string, ts: string): Promise<void> {
  await deleteMessage(env, panel, "ts:" + ts);
}

export async function markResolvedAcrossPanels(env: Env, slackTs: string, resolved: boolean): Promise<void> {
  for (const p of ALL_PANELS) {
    const list = await listMessages(env, p);
    const idx = list.findIndex(m => m.slackTs === slackTs);
    if (idx !== -1) {
      list[idx].resolved = resolved;
      list[idx].status = resolved ? "resolved" : "open";
      await saveMessages(env, p, list);
      return;
    }
  }
}

export async function setStatusAcrossPanels(env: Env, slackTs: string, status: "open" | "reviewing" | "resolved"): Promise<void> {
  for (const p of ALL_PANELS) {
    const list = await listMessages(env, p);
    const idx = list.findIndex(m => m.slackTs === slackTs);
    if (idx !== -1) {
      list[idx].status = status;
      list[idx].resolved = (status === "resolved");
      await saveMessages(env, p, list);
      return;
    }
  }
}

export async function updateCategoryAcrossPanels(env: Env, slackTs: string, category: string): Promise<void> {
  for (const p of ALL_PANELS) {
    const list = await listMessages(env, p);
    const idx = list.findIndex(m => m.slackTs === slackTs);
    if (idx !== -1) { list[idx].category = category; await saveMessages(env, p, list); return; }
  }
}

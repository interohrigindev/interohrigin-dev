/** 봇이 속한 카카오워크 채팅방 목록 — GET /api/kakao-rooms?key=...
 *  기존 단톡방("IO 개발현황")에 봇을 초대한 뒤 이 주소를 열면,
 *  그 방의 conversation_id 를 확인해 KAKAOWORK_CONVERSATION_ID 환경변수에 넣을 수 있다.
 */
import type { Env } from "../_lib/storage";
import { listRooms } from "../_lib/kakaowork";

const CORS = { "Access-Control-Allow-Origin": "*" };
function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { "Content-Type": "application/json", ...CORS } });
}
function authorized(req: Request, env: Env): boolean {
  const key = req.headers.get("X-Dashboard-Key") || new URL(req.url).searchParams.get("key");
  return key === env.DASHBOARD_KEY;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
  if (!env.KAKAOWORK_APP_KEY) {
    return json({ ok: false, message: "KAKAOWORK_APP_KEY 미설정 — 봇 App Key 를 먼저 환경변수에 등록하세요." });
  }
  const rooms = await listRooms(env);
  return json({
    ok: true,
    count: rooms.length,
    hint: "보낼 단톡방의 id 를 복사해 환경변수 KAKAOWORK_CONVERSATION_ID 에 넣고 재배포하세요. 목록이 비어있으면 그 단톡방에 봇을 먼저 초대하세요.",
    rooms: rooms.map((c: any) => ({ id: c.id, type: c.type, name: c.name, users_count: c.users_count })),
  });
};

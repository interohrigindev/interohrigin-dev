/** 카카오워크 웹훅 설정 점검용 — GET /api/kakao-test?key=...
 *  설정한 KAKAOWORK_WEBHOOK_URL 로 테스트 메시지를 보내 정상 수신되는지 확인.
 */
import type { Env } from "../_lib/storage";
import { notifyNewMessage } from "../_lib/kakaowork";

const CORS = { "Access-Control-Allow-Origin": "*" };
function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...CORS } });
}
function authorized(req: Request, env: Env): boolean {
  const key = req.headers.get("X-Dashboard-Key") || new URL(req.url).searchParams.get("key");
  return key === env.DASHBOARD_KEY;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
  if (!env.KAKAOWORK_WEBHOOK_URL) {
    return json({ ok: false, configured: false, message: "KAKAOWORK_WEBHOOK_URL 미설정 — Cloudflare Pages 환경변수에 추가하세요." });
  }
  await notifyNewMessage(env, {
    panel: "overview", category: "feedback", author: "연동 테스트",
    content: "카카오워크 알림 연동이 정상 작동합니다. ✅ 이 메시지가 보이면 설정 완료입니다.",
  });
  return json({ ok: true, configured: true, message: "테스트 메시지를 전송했습니다. 카카오워크 채팅방을 확인하세요." });
};

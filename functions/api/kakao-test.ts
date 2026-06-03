/** 카카오워크 알림 설정 점검 — GET /api/kakao-test?key=...
 *  현재 설정 모드(bot/webhook/none)와 수신자 이메일 해석 결과를 반환하고,
 *  설정돼 있으면 테스트 메시지를 실제로 전송한다.
 */
import type { Env } from "../_lib/storage";
import { notifyNewMessage, diagnose } from "../_lib/kakaowork";

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

  const diag = await diagnose(env);
  if (diag.mode === "none") {
    return json({
      ok: false, mode: "none",
      message: "카카오워크 미설정 — 봇 방식은 KAKAOWORK_APP_KEY(+ KAKAOWORK_CONVERSATION_ID 또는 KAKAOWORK_RECIPIENTS), 웹훅 방식은 KAKAOWORK_WEBHOOK_URL 를 환경변수에 추가하세요.",
    });
  }

  // 봇 방식인데 보낼 단톡방을 못 정하면 전송 생략
  if (diag.mode === "bot" && !diag.targetConversationId) {
    return json({
      ok: false, mode: "bot",
      message: "보낼 단톡방을 찾지 못했습니다. (1) 기존 단톡방에 봇을 초대하고 /api/kakao-rooms 에서 id를 확인해 KAKAOWORK_CONVERSATION_ID 에 넣거나, (2) KAKAOWORK_RECIPIENTS 의 이메일이 카카오워크 가입 이메일과 일치하는지 확인하세요.",
      diagnose: diag,
    });
  }

  await notifyNewMessage(env, {
    panel: "overview", category: "feedback", author: "연동 테스트",
    content: "카카오워크 알림 연동이 정상 작동합니다. ✅ 이 메시지가 보이면 설정 완료입니다.",
  });

  return json({
    ok: true, mode: diag.mode,
    message: "테스트 메시지를 전송했습니다. 카카오워크를 확인하세요.",
    diagnose: diag,
  });
};

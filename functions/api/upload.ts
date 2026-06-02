/** 이미지 업로드/조회 — Cloudflare Pages Functions
 *  KV(MESSAGES)에 `img:<id>` 키로 바이너리 저장. 메시지 JSON에는 참조 id만 담아
 *  5초 폴링이 이미지 본문을 매번 끌어오지 않도록 분리.
 */
import type { Env } from "../_lib/storage";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Dashboard-Key, X-File-Name",
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function authorized(req: Request, env: Env): boolean {
  const key = req.headers.get("X-Dashboard-Key") || new URL(req.url).searchParams.get("key");
  return key === env.DASHBOARD_KEY;
}

const MAX_BYTES = 8 * 1024 * 1024; // 8MB (클라이언트에서 1600px로 축소해 보냄)

export const onRequestOptions: PagesFunction = async () => new Response(null, { headers: CORS });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
  const mime = request.headers.get("Content-Type") || "application/octet-stream";
  if (!mime.startsWith("image/")) return json({ error: "이미지 파일만 업로드할 수 있습니다." }, 400);

  const buf = await request.arrayBuffer();
  if (buf.byteLength === 0) return json({ error: "빈 파일" }, 400);
  if (buf.byteLength > MAX_BYTES) return json({ error: "이미지가 너무 큽니다 (8MB 제한)" }, 413);

  const rawName = request.headers.get("X-File-Name") || "image";
  let name = "image";
  try { name = decodeURIComponent(rawName).slice(0, 200); } catch { name = rawName.slice(0, 200); }

  const id = "img:" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  await env.MESSAGES.put(id, buf, { metadata: { mime, name } });

  return json({ ok: true, id, url: `/api/upload?id=${encodeURIComponent(id)}` });
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!id.startsWith("img:")) return json({ error: "잘못된 id" }, 400);

  const { value, metadata } = await env.MESSAGES.getWithMetadata<{ mime?: string; name?: string }>(id, { type: "arrayBuffer" });
  if (!value) return json({ error: "not found" }, 404);

  const mime = (metadata && metadata.mime) || "application/octet-stream";
  return new Response(value, {
    headers: {
      "Content-Type": mime,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
    },
  });
};

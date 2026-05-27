import { handleSlackEvent } from "../_lib/slack";
import type { Env } from "../_lib/storage";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  return handleSlackEvent(request, env);
};

export const onRequest: PagesFunction<Env> = async () =>
  new Response("Method not allowed", { status: 405 });

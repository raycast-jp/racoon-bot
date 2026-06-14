/**
 * Slack Events API のエンドポイント (Vercel Function)。
 * POST /api/slack/events
 */
import { waitUntil } from "@vercel/functions";
import { config } from "../../src/config";
import { handleEvent } from "../../src/events";
import { verifySlackRequest } from "../../src/verify";

export async function POST(request: Request): Promise<Response> {
  const body = await request.text();

  const ok = verifySlackRequest(
    config.slackSigningSecret,
    body,
    request.headers.get("x-slack-request-timestamp"),
    request.headers.get("x-slack-signature")
  );
  if (!ok) {
    return new Response("invalid signature", { status: 401 });
  }

  const payload = JSON.parse(body) as Record<string, any>;

  // Slack App 設定時の URL 検証
  if (payload.type === "url_verification") {
    return Response.json({ challenge: payload.challenge });
  }

  // 処理が 3 秒を超えた場合の再送イベントは無視する（重複回答の防止）
  if (request.headers.get("x-slack-retry-num")) {
    return new Response("ok", { headers: { "x-slack-no-retry": "1" } });
  }

  if (payload.type === "event_callback") {
    // Slack は 3 秒以内の ACK を要求するため、本処理はレスポンス後に waitUntil で実行する
    waitUntil(handleEvent(payload.event).catch((err) => console.error("イベント処理に失敗:", err)));
  }

  return new Response("ok");
}

/**
 * ローカル開発用の HTTP サーバー。
 * 本番 (Vercel) では api/slack/events.ts が同じ処理を担う。
 *
 * 使い方: npm run dev → ngrok http 3000 で公開し、
 * Slack App の Request URL に https://xxx.ngrok.io/slack/events を設定する。
 */
import http from "node:http";
import { config } from "./config";
import { messageCount } from "./db";
import { handleEvent } from "./events";
import { verifySlackRequest } from "./verify";

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || !["/slack/events", "/api/slack/events"].includes(req.url ?? "")) {
    res.writeHead(404).end();
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const ok = verifySlackRequest(
      config.slackSigningSecret,
      body,
      req.headers["x-slack-request-timestamp"] as string | undefined,
      req.headers["x-slack-signature"] as string | undefined
    );
    if (!ok) {
      res.writeHead(401).end("invalid signature");
      return;
    }

    const payload = JSON.parse(body) as Record<string, any>;

    // Slack App 設定時の URL 検証
    if (payload.type === "url_verification") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ challenge: payload.challenge }));
      return;
    }

    // 処理が 3 秒を超えた場合の再送イベントは無視する（重複回答の防止）
    if (req.headers["x-slack-retry-num"]) {
      res.writeHead(200, { "x-slack-no-retry": "1" }).end("ok");
      return;
    }

    // Slack は 3 秒以内の ACK を要求するため、先に 200 を返してから処理する
    res.writeHead(200).end("ok");
    if (payload.type === "event_callback") {
      handleEvent(payload.event).catch((err) => console.error("イベント処理に失敗:", err));
    }
  });
});

server.listen(config.port, async () => {
  console.log(
    `⚡️ racoon-bot がポート ${config.port} で起動しました（記憶: ${await messageCount()} 件）`
  );
});

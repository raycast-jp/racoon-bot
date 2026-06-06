/**
 * Slack Events API エンドポイントの happy path E2E テスト。
 * 外部サービス (Slack Web API / AI Gateway) のみモックし、
 * 署名検証 → ルーティング → DB 保存 → 回答投稿までを通しで検証する。
 */
import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  postMessage: vi.fn(async () => ({ ok: true })),
  // generateText のみモックし、searchLogs ツールは実際に実行して検索パスも通す
  generateText: vi.fn(async (opts: any) => {
    const hits: string = await opts.tools.searchLogs.execute({ keywords: ["障害対応"] });
    return {
      text: hits.includes("障害対応")
        ? "昨日の障害は DB のフェイルオーバーで復旧済みです"
        : "ログには見つかりませんでした",
    };
  }),
}));

vi.mock("@slack/web-api", () => ({
  WebClient: class {
    chat = { postMessage: mocks.postMessage };
    conversations = { info: vi.fn(async () => ({ channel: { name: "general" } })) };
    users = { info: vi.fn(async () => ({ user: { profile: { display_name: "myano" } } })) };
  },
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: mocks.generateText };
});

// テスト環境には Vercel のリクエストコンテキストが無いため no-op に差し替える
// （handleEvent の Promise は waitUntil に渡す前に生成されるので処理自体は走る）
vi.mock("@vercel/functions", () => ({ waitUntil: () => {} }));

import { POST } from "../api/slack/events";
import { messageCount, recentMessages } from "../src/db";

const SIGNING_SECRET = "test-secret";

/** Slack と同じ方式で署名した Request を作る */
function signedRequest(payload: object): Request {
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000).toString();
  const signature = `v0=${crypto
    .createHmac("sha256", SIGNING_SECRET)
    .update(`v0:${ts}:${body}`)
    .digest("hex")}`;
  return new Request("http://localhost/api/slack/events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": ts,
      "x-slack-signature": signature,
    },
    body,
  });
}

describe("POST /api/slack/events (happy path)", () => {
  it("url_verification に challenge を返す", async () => {
    const res = await POST(
      signedRequest({ type: "url_verification", challenge: "ch-123" })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ challenge: "ch-123" });
  });

  it("message イベントを ACK して DB に保存する", async () => {
    const res = await POST(
      signedRequest({
        type: "event_callback",
        event: {
          type: "message",
          channel: "C01",
          ts: "1700000001.000100",
          user: "U01",
          text: "昨日の障害対応はフェイルオーバーで復旧しました",
        },
      })
    );

    expect(res.status).toBe(200);
    // 本処理はレスポンス後に非同期で走るため、保存されるまで待つ
    await vi.waitFor(async () => {
      expect(await messageCount()).toBe(1);
    });
    const [saved] = await recentMessages("C01", 10);
    expect(saved.text).toContain("障害対応");
  });

  it("app_mention に回答を生成してスレッドへ投稿する", async () => {
    const res = await POST(
      signedRequest({
        type: "event_callback",
        event: {
          type: "app_mention",
          channel: "C01",
          ts: "1700000002.000100",
          user: "U02",
          text: "<@UBOT> 昨日の障害どうなった？",
        },
      })
    );

    expect(res.status).toBe(200);
    await vi.waitFor(() => {
      expect(mocks.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "C01",
          thread_ts: "1700000002.000100",
          text: expect.stringContaining("復旧済み"),
        })
      );
    });
  });
});

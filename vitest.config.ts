import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // config.ts が import 時に環境変数を要求するため、テスト用の値を注入する
    env: {
      SLACK_BOT_TOKEN: "xoxb-test",
      SLACK_SIGNING_SECRET: "test-secret",
      AI_GATEWAY_API_KEY: "test-key",
      TURSO_DATABASE_URL: "file:./data/test-e2e.db",
    },
    globalSetup: "./test/global-setup.ts",
  },
});

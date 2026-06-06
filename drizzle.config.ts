import { defineConfig } from "drizzle-kit";

// Drizzle Studio (pnpm studio) 用の設定。
// TURSO_DATABASE_URL が未設定ならローカルの SQLite ファイルを開く（src/config.ts と同じ規約）
export default defineConfig({
  dialect: "turso",
  schema: "./src/schema.ts",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL ?? "file:./data/local.db",
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
});

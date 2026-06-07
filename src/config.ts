export const config = {
  slackBotToken: requireEnv("SLACK_BOT_TOKEN"),
  slackSigningSecret: requireEnv("SLACK_SIGNING_SECRET"),
  /**
   * Vercel AI Gateway の認証。Vercel 上では OIDC トークンが自動で利用できる。
   * LLM を使わない backfill などでも config を import できるよう、参照時に検証する
   */
  get aiGatewayApiKey(): string {
    return requireAnyEnv("AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN");
  },
  /** Turso の接続 URL。未設定ならローカルの SQLite ファイルで動く */
  tursoDatabaseUrl: process.env.TURSO_DATABASE_URL ?? "file:./data/local.db",
  /** Turso の認証トークン（ローカルの file: 利用時は不要） */
  tursoAuthToken: process.env.TURSO_AUTH_TOKEN,
  port: Number(process.env.PORT ?? 3000),
  /** 回答生成に使うモデル（Vercel AI Gateway のモデル ID） */
  answerModel: process.env.ANSWER_MODEL ?? "google/gemini-3-flash",
  /** FTS 検索で LLM に渡す最大ヒット件数 */
  searchLimit: Number(process.env.SEARCH_LIMIT ?? 60),
  /** 質問されたチャンネルの直近ログを何件渡すか */
  recentLimit: Number(process.env.RECENT_LIMIT ?? 40),
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`環境変数 ${name} が設定されていません`);
  }
  return value;
}

function requireAnyEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  throw new Error(`環境変数 ${names.join(" または ")} が設定されていません`);
}

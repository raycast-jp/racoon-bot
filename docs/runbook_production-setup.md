# Runbook: 本番環境の初期セットアップ

> 🚨 **これは本番環境 (production) 用の手順です。**
> 本番の Slack App・Turso DB・Vercel プロジェクトを作成します。
> ローカル開発環境のセットアップは [runbook_local-development.md](runbook_local-development.md) を参照。

racoon-bot をゼロから本番稼働させるまでの手順。所要時間の目安: 30〜60 分。
通常はプロジェクト立ち上げ時に **1 回だけ** 実行する。

## 前提

- Node.js 24.x / pnpm 10+
- Slack ワークスペースの App 作成権限
- Vercel アカウント（AI Gateway 利用可能なもの）
- Turso アカウント + `turso` CLI
  - インストール: `brew install tursodatabase/tap/turso`
    （macOS 以外は `curl -sSfL https://get.tur.so/install.sh | bash`）
  - ログイン: `turso auth login`
- `vercel` CLI（`pnpm add -g vercel`）

## 1. Slack App の作成（本番用）

1. https://api.slack.com/apps → **Create New App** → **From an app manifest**
2. リポジトリの `slack-app-manifest.yml`（**本番用**。`slack-app-manifest.dev.yml` の方ではない）の内容を貼り付ける
   - `request_url` は後で差し替えるのでこの時点ではそのままで OK（Verify は失敗する）
3. **Install to Workspace** でインストール
4. 以下を控える:
   - **Bot User OAuth Token**（`xoxb-...`）→ `SLACK_BOT_TOKEN`
   - **Signing Secret**（Basic Information）→ `SLACK_SIGNING_SECRET`

## 2. Turso の DB 作成

```sh
turso db create racoon-bot --location nrt
turso db show racoon-bot --url        # → TURSO_DATABASE_URL
turso db tokens create racoon-bot     # → TURSO_AUTH_TOKEN
```

> スキーマは `drizzle/` のマイグレーションがアプリ初回起動時に自動適用される
> （`src/db.ts` の `ensureSchema` → drizzle-orm の `migrate`）。手動のマイグレーション手順は不要。
> スキーマ変更時は `src/schema.ts` を編集して `pnpm exec drizzle-kit generate` でマイグレーションを生成する。

## 3. Vercel プロジェクトの作成と環境変数

```sh
vercel link    # 新規プロジェクトとしてリンク

vercel env add TURSO_DATABASE_URL production
vercel env add TURSO_AUTH_TOKEN production
vercel env add SLACK_BOT_TOKEN production
vercel env add SLACK_SIGNING_SECRET production
# AI_GATEWAY_API_KEY は不要（Vercel 上では OIDC トークンが自動で使われる）
```

AI Gateway はプロジェクトの **AI** タブから有効化しておく（クレジット/支払い設定を確認）。

## 4. デプロイと Slack の接続

→ [runbook_deploy.md](runbook_deploy.md) の手順でデプロイ後、

1. 発行された URL を Slack App の **Event Subscriptions → Request URL** に設定:
   `https://<project>.vercel.app/api/slack/events`
2. **Verified** と表示されることを確認（署名検証 + url_verification が通った証拠）
3. 動作確認チャンネルで `/invite @racoon-bot` → 適当に発言 → `@racoon-bot 今なんて言った？` で回答が返れば疎通完了

## 5. 過去ログの取り込み（任意）

→ [runbook_backfill.md](runbook_backfill.md)

## チェックリスト

- [ ] Slack App 作成・インストール済み
- [ ] Turso DB 作成済み（URL / トークン取得済み）
- [ ] Vercel 環境変数 4 つ設定済み
- [ ] 本番デプロイ済み
- [ ] Request URL が Verified
- [ ] メンションへの回答を確認

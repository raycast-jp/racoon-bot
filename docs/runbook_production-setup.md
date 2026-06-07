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
  - インストール: `curl -sSfL https://get.tur.so/install.sh | bash`
  - ログイン: `turso auth login`
- `vercel` CLI（リポジトリの dependencies に含まれるため `pnpm install` 済みなら `pnpm vercel ...` で実行できる）

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
# ロケーション一覧は `turso db locations` で確認できる
turso db create racoon-bot --location aws-ap-northeast-1  # 東京
turso db show racoon-bot --url        # → TURSO_DATABASE_URL
turso db tokens create racoon-bot     # → TURSO_AUTH_TOKEN
```

> スキーマは `drizzle/` のマイグレーションがアプリ初回起動時に自動適用される
> （`src/db.ts` の `ensureSchema` → drizzle-orm の `migrate`）。手動のマイグレーション手順は不要。
> スキーマ変更時は `src/schema.ts` を編集して `pnpm exec drizzle-kit generate` でマイグレーションを生成する。

## 3. Vercel プロジェクトの作成と環境変数

### 3-1. ログイン（初回のみ）

```sh
pnpm vercel login
```

メールアドレスまたは GitHub 等を選ぶとブラウザが開くので、そこで認証する。

### 3-2. 新規プロジェクトとしてリンク

`vercel link` はダッシュボードで事前にプロジェクトを作らなくてよい。
対話プロンプトで「既存にリンクしない」を選ぶと、その場で新規プロジェクトが作成される:

```sh
pnpm vercel link
```

| プロンプト | 入力 |
|---|---|
| `Set up "~/.../racoon-bot"?` | `yes` |
| `Which scope should contain your project?` | デプロイ先のチーム（または個人アカウント）を選択 |
| `Link to existing project?` | **`no`** ← ここが新規作成の分かれ目 |
| `What's your project's name?` | `racoon-bot`（本番用の名前。dev 用と区別する） |
| `In which directory is your code located?` | `./` |
| `Want to modify these settings?`（Framework: Other と自動検出される） | `no` |
| `Do you want to change additional project settings?` | `no` |
| `Detected a repository. Connect it to this project?` | `no` |

成功すると `.vercel/project.json`（projectId / orgId）が作られ、以降の
`vercel env` / `vercel deploy` はこのプロジェクトに向く。
`.vercel/` は gitignore 済みなのでコミットされない。

> やり直したい場合（別のスコープ・名前にしたい等）は `.vercel/` を削除して
> `pnpm vercel link` を再実行すればよい。

### 3-3. 環境変数の登録

各コマンドを実行すると値の入力を求められるので、控えておいた値を貼り付ける:

```sh
pnpm vercel env add TURSO_DATABASE_URL production
pnpm vercel env add TURSO_AUTH_TOKEN production
pnpm vercel env add SLACK_BOT_TOKEN production
pnpm vercel env add SLACK_SIGNING_SECRET production
# AI_GATEWAY_API_KEY は不要（Vercel 上では OIDC トークンが自動で使われる）
```

登録済みの変数は `pnpm vercel env ls` で確認できる。

### 3-4. AI Gateway の有効化

ダッシュボードのプロジェクト → **AI** タブから AI Gateway を有効化しておく。
**free tier では Opus / Sonnet が使えない**ため、本番でデフォルトの
`anthropic/claude-opus-4.8` を使うにはクレジットのトップアップ（支払い設定）が必要。

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

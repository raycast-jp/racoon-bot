# racoon-bot 🦝

Slack の会話ログをひたすら記憶し、@メンションで質問すると **Claude が過去ログを根拠に回答してくれる** bot。

## 仕組み

```
Slack イベント ──→ Vercel Function ──→ Turso (libSQL / FTS5 trigram) に蓄積
                                        │
@racoon-bot 質問 ──→ Claude が searchLogs ツールで全文検索（必要なら繰り返し）
                                        │
                          過去ログを根拠に回答 ──→ スレッドに返信
```

- **蓄積**: `message.*` イベントを受信して Turso に保存（編集・削除にも追従）
- **検索**: FTS5 の trigram tokenizer により日本語の部分一致検索が可能
- **回答**: AI SDK の tool calling で `claude-opus-4.8` が `searchLogs` ツールを自律的に呼び出し（キーワードを変えた再検索も可）、ヒットしたログ + 質問チャンネルの直近ログを根拠に回答生成
- **LLM**: AI SDK + Vercel AI Gateway 経由で呼び出し。トラフィック・コストは Vercel の AI Gateway ダッシュボードで可視化される
- **永続化**: DB は Turso (libSQL)。ローカル開発では `file:` URL でただのローカル SQLite ファイルとして動く

## セットアップ

### 1. Slack App を作成

1. https://api.slack.com/apps → **Create New App** → **From an app manifest**
2. `slack-app-manifest.yml` の内容を貼り付け（`request_url` は後でデプロイ後に更新）
3. **Install to Workspace** でインストール
4. 以下を控える:
   - **Bot User OAuth Token** (`xoxb-...`) → `SLACK_BOT_TOKEN`
   - **Signing Secret** (Basic Information) → `SLACK_SIGNING_SECRET`

### 2. ローカルで動作確認

```sh
pnpm install
cp .env.example .env  # トークン類を記入
pnpm dev
```

ローカルでは `TURSO_DATABASE_URL` 未設定のままで OK — DB は `file:./data/local.db` の
ローカル SQLite ファイルとして動く（FTS5 trigram 検索もそのまま使える）。

公開 URL が必要なので、`ngrok http 3000` などでトンネルを張り、
Slack App の **Event Subscriptions → Request URL** に `https://xxx.ngrok.io/slack/events` を設定する。

### 3. Vercel にデプロイ

```sh
# Turso の DB を作成（初回のみ）
turso db create racoon-bot --location nrt
turso db show racoon-bot --url        # → TURSO_DATABASE_URL
turso db tokens create racoon-bot     # → TURSO_AUTH_TOKEN

# Vercel プロジェクトをリンクして環境変数を登録
vercel link
vercel env add TURSO_DATABASE_URL production
vercel env add TURSO_AUTH_TOKEN production
vercel env add SLACK_BOT_TOKEN production
vercel env add SLACK_SIGNING_SECRET production
# AI_GATEWAY_API_KEY は省略可（Vercel 上では OIDC トークンが自動で使われる）

# デプロイ
vercel deploy --prod
```

> **重要な制約**
> - Slack は 3 秒以内の ACK を要求するため、イベントは即座に 200 を返し、
>   検索 + LLM 回答は `waitUntil` でレスポンス後に非同期処理する
> - 回答生成は数十秒かかることがあるので、`vercel.json` の `maxDuration` を
>   十分長く（例: 300 秒）設定しておく
> - Slack はタイムアウト時にイベントを再送する（`x-slack-retry-num` ヘッダー）。
>   重複回答を防ぐため再送イベントは無視する

デプロイ後、発行された URL を Slack App の **Event Subscriptions → Request URL**
（`https://xxx.vercel.app/api/slack/events`）に設定して Verify する。

### 4. 過去ログの取り込み（任意）

bot をチャンネルに招待（`/invite @racoon-bot`）した後、過去ログを一括で取り込める:

```sh
# 本番の Turso に直接書き込む場合は接続情報を指定して実行
TURSO_DATABASE_URL=libsql://xxx.turso.io TURSO_AUTH_TOKEN=... pnpm backfill
```

> DB がクラウド側 (Turso) にあるため、ローカルから実行してもそのまま本番 DB に
> 取り込まれる。レプリカの同期やファイルのアップロードは不要。

## 使い方

- bot をチャンネルに `/invite @racoon-bot` → 以降の発言が自動で記憶される
- `@racoon-bot 先週の障害対応どうなった?` のようにメンションすると、過去ログを検索して回答

## 環境変数

| 変数 | 必須 | 説明 |
|---|---|---|
| `SLACK_BOT_TOKEN` | ✅ | Bot User OAuth Token |
| `SLACK_SIGNING_SECRET` | ✅ | Slack App の Signing Secret |
| `AI_GATEWAY_API_KEY` | ✅* | Vercel AI Gateway の API キー（* Vercel 上では `VERCEL_OIDC_TOKEN` が自動で使われるため省略可） |
| `TURSO_DATABASE_URL` | — | Turso の接続 URL（例 `libsql://xxx.turso.io`）。未設定なら `file:./data/local.db` |
| `TURSO_AUTH_TOKEN` | — | Turso の認証トークン（ローカル `file:` 利用時は不要） |
| `ANSWER_MODEL` | — | 回答モデル（デフォルト `anthropic/claude-opus-4.8`） |
| `SEARCH_LIMIT` | — | LLM に渡す検索ヒット上限（デフォルト 60） |
| `RECENT_LIMIT` | — | 直近ログの件数（デフォルト 40） |

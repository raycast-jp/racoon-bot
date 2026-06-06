# racoon-bot 🦝

Slack の会話ログをひたすら記憶し、@メンションで質問すると **Claude が過去ログを根拠に回答してくれる** bot。

## 仕組み

```
Slack イベント ──→ Bolt (HTTP) ──→ SQLite (FTS5 trigram) に蓄積
                                        │
@racoon-bot 質問 ──→ Haiku でキーワード抽出 ──→ 全文検索 + 直近ログ
                                        │
                          Claude Opus 4.8 が根拠付きで回答 ──→ スレッドに返信
```

- **蓄積**: `message.*` イベントを受信して SQLite に保存（編集・削除にも追従）
- **検索**: FTS5 の trigram tokenizer により日本語の部分一致検索が可能
- **回答**: `claude-haiku-4-5` が質問から検索キーワードを抽出 → ヒットしたログ + 質問チャンネルの直近ログを `claude-opus-4-8` に渡して回答生成
- **永続化**: Cloud Run はディスクが揮発するため、Litestream で SQLite を GCS に常時レプリケート

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
npm install
cp .env.example .env  # トークン類を記入
npm run dev
```

ローカルでは公開 URL が必要なので、`ngrok http 3000` などでトンネルを張り、
Slack App の **Event Subscriptions → Request URL** に `https://xxx.ngrok.io/slack/events` を設定する。

### 3. Cloud Run にデプロイ

```sh
# GCS バケット作成（Litestream のレプリカ先）
gcloud storage buckets create gs://YOUR_BUCKET --location=asia-northeast1

# シークレット登録
echo -n "xoxb-..." | gcloud secrets create slack-bot-token --data-file=-
echo -n "..."      | gcloud secrets create slack-signing-secret --data-file=-
echo -n "sk-ant-..." | gcloud secrets create anthropic-api-key --data-file=-

# デプロイ
gcloud run deploy racoon-bot \
  --source . \
  --region asia-northeast1 \
  --min-instances 1 \
  --max-instances 1 \
  --no-cpu-throttling \
  --memory 1Gi \
  --allow-unauthenticated \
  --set-env-vars "REPLICA_URL=gcs://YOUR_BUCKET/racoon-bot" \
  --set-secrets "SLACK_BOT_TOKEN=slack-bot-token:latest,SLACK_SIGNING_SECRET=slack-signing-secret:latest,ANTHROPIC_API_KEY=anthropic-api-key:latest"
```

> **重要な制約**
> - `--max-instances 1` 必須: SQLite + Litestream は単一インスタンス前提
> - `--min-instances 1` + `--no-cpu-throttling` 必須: Litestream のレプリケーションと
>   Slack イベントの非同期処理がリクエスト外でも動けるようにする
> - Cloud Run のサービスアカウントにバケットへの `roles/storage.objectAdmin` を付与すること

デプロイ後、発行された URL を Slack App の **Event Subscriptions → Request URL**
（`https://xxx.run.app/slack/events`）に設定して Verify する。

### 4. 過去ログの取り込み（任意）

bot をチャンネルに招待（`/invite @racoon-bot`）した後、過去ログを一括で取り込める:

```sh
npm run backfill
```

> ローカルで実行した場合、DB を Cloud Run 側と共有するには
> `litestream restore` / GCS へのアップロードが必要。運用開始前に一度だけ
> ローカルで backfill → `gcloud storage cp` ではなく、Litestream の
> レプリカ生成 (`litestream replicate -once` 相当) を使うのが安全。

## 使い方

- bot をチャンネルに `/invite @racoon-bot` → 以降の発言が自動で記憶される
- `@racoon-bot 先週の障害対応どうなった?` のようにメンションすると、過去ログを検索して回答

## 環境変数

| 変数 | 必須 | 説明 |
|---|---|---|
| `SLACK_BOT_TOKEN` | ✅ | Bot User OAuth Token |
| `SLACK_SIGNING_SECRET` | ✅ | Slack App の Signing Secret |
| `ANTHROPIC_API_KEY` | ✅ | Anthropic API キー |
| `DB_PATH` | — | SQLite のパス（デフォルト `./data/slack-log.db`） |
| `REPLICA_URL` | — | Litestream のレプリカ先（例 `gcs://bucket/racoon-bot`）。未設定ならレプリケートなし |
| `ANSWER_MODEL` | — | 回答モデル（デフォルト `claude-opus-4-8`） |
| `KEYWORD_MODEL` | — | キーワード抽出モデル（デフォルト `claude-haiku-4-5`） |
| `SEARCH_LIMIT` | — | LLM に渡す検索ヒット上限（デフォルト 60） |
| `RECENT_LIMIT` | — | 直近ログの件数（デフォルト 40） |

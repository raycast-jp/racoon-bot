# Runbook: staging 環境のセットアップ

> 🎭 **これは staging 環境用の手順です。**
> 本番と同じ Vercel プロジェクトの **Preview 環境（`staging` ブランチ）** にデプロイし、
> Slack App と Turso DB だけ staging 専用のものを使う。
> 通常はプロジェクト立ち上げ時に **1 回だけ** 実行する。

## 環境の全体像

| | dev | **staging** | production |
|---|---|---|---|
| Slack App | `racoon-bot-dev-<name>` ×人数分 | `racoon-bot-staging` **×1 共有** | `racoon-bot` |
| Request URL | 各自の ngrok | `staging` ブランチの固定 URL | 本番 URL |
| DB | 各自の `data/local.db` | Turso `racoon-bot-staging` | Turso `racoon-bot` |
| Vercel | （使わない） | 同一プロジェクトの Preview | 同一プロジェクトの Production |

dev が「1 人 1 App」なのは Request URL が各自の ngrok を向くため。
staging は Vercel の固定 URL なのでチーム共有の App が 1 つあればよい。

## 前提

- [runbook_production-setup.md](runbook_production-setup.md) が完了している
  （Vercel プロジェクト `racoon-bot` がリンク済み）

## 1. Slack App の作成（staging 用・1 回だけ）

1. https://api.slack.com/apps → **Create New App** → **From an app manifest**
2. リポジトリの `slack-app-manifest.staging.yml` の内容を貼り付ける
   - `request_url` の `YOUR-TEAM` は後で確定するのでそのままで OK（Verify は失敗する）
3. **Install to Workspace** でインストール
4. **Bot User OAuth Token**（`xoxb-...`）と **Signing Secret** を控える

## 2. Turso の staging DB 作成

```sh
turso db create racoon-bot-staging --location aws-ap-northeast-1  # 東京
turso db show racoon-bot-staging --url        # → TURSO_DATABASE_URL
turso db tokens create racoon-bot-staging     # → TURSO_AUTH_TOKEN
```

## 3. Vercel に staging ブランチ限定の環境変数を登録

`preview staging` を付けると **Preview 環境のうち `staging` ブランチに限定**して登録される。
これを忘れると全 feature ブランチの preview デプロイに staging の秘密情報が配られるので注意。

```sh
pnpm vercel env add SLACK_BOT_TOKEN preview staging       # staging App の xoxb-...
pnpm vercel env add SLACK_SIGNING_SECRET preview staging  # staging App の Signing Secret
pnpm vercel env add TURSO_DATABASE_URL preview staging    # libsql://racoon-bot-staging-xxx.turso.io
pnpm vercel env add TURSO_AUTH_TOKEN preview staging

# 任意: コスト節約するなら回答モデルを下げる
pnpm vercel env add ANSWER_MODEL preview staging          # 例: anthropic/claude-haiku-4.5
```

> `AI_GATEWAY_API_KEY` は本番同様不要（Preview でも `VERCEL_OIDC_TOKEN` が自動で使える）。
> 登録結果は `pnpm vercel env ls` で environment / branch ごとに確認できる。

## 4. staging ブランチのデプロイ

```sh
git checkout -b staging main
git push origin staging
```

- **Git 連携済みの場合**: push しただけで Preview デプロイが走る
- **Git 連携していない場合**（`vercel link` で repository 接続を `no` にした場合）:
  staging ブランチをチェックアウトした状態で `pnpm vercel deploy`（`--prod` なし = Preview）を実行する。
  あとから連携するならダッシュボード → **Settings → Git** で接続でき、以降は push だけで済む

デプロイ後、`staging` ブランチには **固定のブランチエイリアス** が割り当てられる:

```
https://racoon-bot-git-staging-<チームスラッグ>.vercel.app
```

正確な URL はダッシュボードのデプロイ詳細（Domains 欄）か `pnpm vercel inspect <デプロイURL>` で確認する。

> ⚠️ **デプロイ単位の URL（`racoon-bot-abc123xyz-...vercel.app`）を Slack に登録しないこと。**
> そちらはデプロイごとに変わる。ブランチエイリアスは常に staging の最新デプロイを指すので、
> 一度 Slack に登録すれば以降の再デプロイで設定し直す必要はない。

### Deployment Protection を無効化する

チームプロジェクトでは Preview デプロイに **Vercel Authentication（認証画面）が
デフォルトで有効**になっていることがあり、その場合 Slack からのリクエストが
401 で弾かれて Request URL の Verify が通らない。

ダッシュボード → **Settings → Deployment Protection** で Vercel Authentication を
Preview に対して無効化する。racoon-bot は Slack の署名検証
（`SLACK_SIGNING_SECRET`）を自前で行っているため、エンドポイントが公開されていても
第三者からの偽リクエストは 401 で拒否される。

## 5. Slack の接続

1. 手順 4 の固定 URL を staging App の **Event Subscriptions → Request URL** に設定:
   `https://racoon-bot-git-staging-<チームスラッグ>.vercel.app/api/slack/events`
2. **Verified** と表示されることを確認
3. 動作確認チャンネルで `/invite @racoon-bot-staging` → 発言 → `@racoon-bot-staging 今なんて言った？` で回答が返れば疎通完了

> 本番 bot と同じチャンネルに invite しても DB が別なので干渉しない。
> ただし回答はそれぞれ返ってくるので、検証用チャンネルに分けるのが無難。

## 6. 過去ログの取り込み（任意）

staging DB に対して backfill する場合は staging の接続情報を指定して実行:

```sh
TURSO_DATABASE_URL=libsql://racoon-bot-staging-xxx.turso.io \
TURSO_AUTH_TOKEN=<staging のトークン> \
SLACK_BOT_TOKEN=<staging App の xoxb-...> \
pnpm backfill
```

## 日常の使い方

- 検証したい変更を `staging` ブランチに merge / push → デプロイ → Slack で動作確認
- 問題なければ `main` に merge して本番デプロイ（[runbook_deploy.md](runbook_deploy.md)）

## チェックリスト

- [ ] Slack App `racoon-bot-staging` 作成・インストール済み
- [ ] Turso `racoon-bot-staging` 作成済み
- [ ] Preview (`staging` ブランチ限定) の環境変数 4 つ登録済み
- [ ] `staging` ブランチをデプロイ済み・固定 URL 確認済み
- [ ] Request URL が Verified
- [ ] メンションへの回答を確認

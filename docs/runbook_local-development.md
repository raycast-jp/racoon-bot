# Runbook: ローカル開発

## 初回セットアップ

### 1. 開発用 Slack App (racoon-bot-dev) を作る

本番 App とは**別の App** をローカル開発用に作る（Slack App に環境の概念はないため）。
本番と同一ワークスペースに共存させる。

1. https://api.slack.com/apps → **Create New App** → **From an app manifest**
2. `slack-app-manifest.dev.yml` の内容を貼り付ける（bot 名は `racoon-bot-dev`）
3. **Install to Workspace** でインストール
4. **Bot User OAuth Token** と **Signing Secret** を控える（→ `.env` へ）

> **注意（同一ワークスペース運用）**
> - 本番 App の Request URL は絶対に触らない。ngrok に向けるのは dev App だけ
> - dev bot を invite したチャンネルの発言はローカルの `data/local.db` に記録される。
>   **動作確認用のテストチャンネル（例: #racoon-bot-dev）にだけ invite** し、
>   業務チャンネルには入れないこと
> - メンションは `@racoon-bot-dev` 宛てに行う（本番 bot と取り違えない）

### 2. 依存と環境変数

```sh
pnpm install
cp .env.example .env
```

`.env` に最低限必要なもの:

| 変数 | 取得元 |
|---|---|
| `SLACK_BOT_TOKEN` | **racoon-bot-dev** → OAuth & Permissions |
| `SLACK_SIGNING_SECRET` | **racoon-bot-dev** → Basic Information |
| `AI_GATEWAY_API_KEY` | Vercel ダッシュボード → AI Gateway → API Keys |

**DB の準備は不要。** `TURSO_DATABASE_URL` 未設定なら `file:./data/local.db` の
ローカル SQLite ファイルが自動作成される（FTS5 trigram もそのまま動く）。

## 開発ループ

```sh
# ターミナル 1: 開発サーバー（コード変更で自動再起動）
pnpm dev

# ターミナル 2: Slack からのイベントを受けるトンネル
ngrok http 3000
```

ngrok の URL を **racoon-bot-dev** の **Event Subscriptions → Request URL** に設定:
`https://xxx.ngrok.io/slack/events`

テストチャンネルで `/invite @racoon-bot-dev` → 発言 → `@racoon-bot-dev 今なんて言った？`
で回答が返れば疎通完了。

## Slack を介さない部分テスト

```sh
# E2E テスト（署名検証〜回答投稿まで。外部サービスはモック）
pnpm test

# DB 層だけ手で叩く
SLACK_BOT_TOKEN=x SLACK_SIGNING_SECRET=x AI_GATEWAY_API_KEY=x \
pnpm exec tsx -e "
import { saveMessage, searchMessages } from './src/db';
(async () => {
  await saveMessage({ channelId: 'C01', ts: '1700000001.000100', text: 'テスト' });
  console.log(await searchMessages(['テスト'], 10));
})();
"
```

## よくある操作

| やりたいこと | コマンド |
|---|---|
| ローカル DB をリセット | `rm -rf data/` |
| 型チェック込みビルド | `pnpm run build` |
| ローカル DB に過去ログ取り込み | `pnpm backfill` |
| Vercel Function として動作確認 | `vercel dev`（通常は `pnpm dev` で十分） |

## ハマりどころ

- **`環境変数 ... が設定されていません` で起動失敗** → `.env` の 3 変数を確認。
  `src/config.ts` が import 時に検証している
- **ngrok 経由でイベントが来ない** → Slack App の Event Subscriptions が
  ngrok の最新 URL か確認（無料 ngrok は再起動で URL が変わる）
- **メンションに二重で回答する** → ngrok の接続が不安定で ACK が 3 秒を超え、
  Slack が再送している可能性。再送は `x-slack-retry-num` で無視する実装だが、
  ACK 自体が返らないケースでは発生しうる。トンネルの安定性を確認

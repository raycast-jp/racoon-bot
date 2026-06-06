# Runbook: ローカル開発

## 初回セットアップ

```sh
pnpm install
cp .env.example .env
```

`.env` に最低限必要なもの:

| 変数 | 取得元 |
|---|---|
| `SLACK_BOT_TOKEN` | Slack App → OAuth & Permissions（開発用 App 推奨、下記参照） |
| `SLACK_SIGNING_SECRET` | Slack App → Basic Information |
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

ngrok の URL を Slack App の **Event Subscriptions → Request URL** に設定:
`https://xxx.ngrok.io/slack/events`

> 本番 App の Request URL を書き換えないこと。開発用に別の Slack App
> （例: racoon-bot-dev）を manifest から複製して使う。

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

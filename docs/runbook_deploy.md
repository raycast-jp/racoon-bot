# Runbook: デプロイ / ロールバック

## 通常デプロイ

```sh
# 事前確認（main がグリーンであること）
pnpm install
pnpm run build
pnpm test

# 本番デプロイ
vercel deploy --prod
```

デプロイ後の確認:

1. `vercel inspect <デプロイ URL>` または Vercel ダッシュボードでビルド成功を確認
2. Slack でメンションして回答が返ることを確認（疎通 + AI Gateway 認証の確認を兼ねる）
3. Vercel ダッシュボード → **Logs** で `イベント処理に失敗` エラーが出ていないこと

> Git 連携を設定している場合は `main` への push で自動デプロイされる。
> その場合も上記 1〜3 の事後確認は同様に行う。

## Git 連携（任意: push だけで自動デプロイしたくなったら）

CLI から接続できる:

```sh
pnpm vercel git connect      # git remote origin を自動検出して接続
pnpm vercel git disconnect   # 解除
```

- 初回のみ、GitHub 側に Vercel の GitHub App が未インストールだと
  ブラウザでのインストール承認（リポジトリへのアクセス許可）を求められる
- `Error: Failed to connect ... to project` が出る場合は、Vercel App が
  **Selected repositories（許可制）** でインストールされていて対象リポジトリが
  含まれていないのが典型。https://github.com/apps/vercel → Configure → org を選び、
  Repository access に対象リポジトリを追加してから再実行する
- 接続後は `main` への push で本番デプロイ、PR には preview URL が自動で付く
- 以降は `vercel deploy --prod` の手動デプロイと併用しても問題ない（同じプロジェクトに乗るだけ）

## ロールバック

```sh
# 直近のデプロイ一覧
vercel ls

# 正常だったデプロイに即時切り戻し（ビルド不要・数秒で反映）
vercel rollback <デプロイ URL>
```

- DB スキーマはアプリ起動時に `drizzle/` のマイグレーション（追加のみの構成）が自動適用されるため、
  コードのロールバックで DB 互換性が壊れることは基本ない
- スキーマを破壊的に変更した場合のみ、Turso の point-in-time restore を検討する:
  `turso db create racoon-bot-restored --from-db racoon-bot --timestamp <ISO8601>`

## 設定変更のみのデプロイ

環境変数の変更は再デプロイしないと反映されない:

```sh
vercel env add ANSWER_MODEL production   # 例: モデル切り替え
vercel deploy --prod
```

## 注意事項

- `vercel.json` の `maxDuration: 300` は回答生成（LLM 数十秒）のための設定。削らないこと
- Slack の 3 秒 ACK は `api/slack/events.ts` の「即 200 → `waitUntil`」で担保している。
  このファイルの応答順序を変えるとイベント再送 → 重複回答が発生する

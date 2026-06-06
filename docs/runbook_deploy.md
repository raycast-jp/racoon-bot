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

## ロールバック

```sh
# 直近のデプロイ一覧
vercel ls

# 正常だったデプロイに即時切り戻し（ビルド不要・数秒で反映）
vercel rollback <デプロイ URL>
```

- DB スキーマはアプリ起動時に `CREATE TABLE IF NOT EXISTS` で作られる追加のみの構成のため、
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

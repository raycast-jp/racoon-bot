# Runbook: 障害対応（bot が応答しない / おかしい）

## まず見る場所

1. **Vercel ダッシュボード → Logs**（Function の実行ログ・エラー）
2. **Vercel → AI** タブ（AI Gateway のリクエスト状況・エラー率・残クレジット）
3. **Turso ダッシュボード**（DB の死活・使用量上限）
4. https://slack-status.com（Slack 側の障害）

## 症状別の切り分け

### メンションしても無反応

| 確認 | 対処 |
|---|---|
| Vercel Logs にリクエスト自体が来ていない | Slack App の Event Subscriptions が **Verified** のままか確認。Request URL がデプロイ URL と一致しているか |
| `invalid signature` (401) が出ている | `SLACK_SIGNING_SECRET` が App のものと一致しているか。App を作り直した場合は更新 → 再デプロイ |
| `イベント処理に失敗` エラーが出ている | スタックトレースを確認し下記の該当項目へ |
| 「エラーが発生しました」と返ってくる | LLM 呼び出し失敗の可能性大 → AI Gateway の項へ |

### AI Gateway 関連（回答生成だけ失敗する）

- Vercel → AI タブでエラー内容を確認
  - **401/403**: OIDC/API キーの問題。`AI_GATEWAY_API_KEY` を明示設定して再デプロイして切り分け
  - **402/クレジット不足**: AI Gateway のクレジットを補充
  - **429**: プロバイダー側 rate limit。一時的なら自然回復を待つ。継続するなら `ANSWER_MODEL` を別モデルに切り替えて凌ぐ（`vercel env add ANSWER_MODEL production` → 再デプロイ）

### DB 関連（保存も回答もできない）

- ログに `LibsqlError` 系が出る
  - **認証エラー**: `TURSO_AUTH_TOKEN` の期限切れ → `turso db tokens create racoon-bot` で再発行 → env 更新 → 再デプロイ
  - **Turso の利用上限**: ダッシュボードで quota を確認（無料枠の row read 上限など）
- データ破損が疑われる場合: `turso db create racoon-bot-restored --from-db racoon-bot --timestamp <直前の正常時刻>` で復元 DB を作り、env の URL を差し替え

### 回答が二重に投稿される

- 処理が遅く Slack が再送している。再送は `x-slack-retry-num` ヘッダーで無視する実装
  （`api/slack/events.ts`）なので、二重投稿が起きるのは **ACK 自体が 3 秒以内に
  返っていない**ケース
- Vercel Logs でレスポンスタイムを確認。コールドスタート + Turso 接続で遅い場合は
  Fluid Compute の設定 / リージョン（Turso と近い `hnd1`/`iad1` 等）を見直す

### 記憶されていない（検索にヒットしない）

- そのチャンネルに bot が invite されているか（`/invite @racoon-bot`）
- イベント購読は `message.channels/groups/im/mpim`。manifest を変更した場合は
  App の再インストールが必要
- 保存件数の確認: メンションだけ（質問なし）を送ると「現在 N 件のメッセージを
  記憶しています」と返る

## エスカレーション

- 30 分以上復旧しない場合: Slack App の Event Subscriptions を一時 **無効化**して
  イベント再送の蓄積を止める（復旧後に有効化すれば以降のイベントから再開）
- 無効化中のメッセージは記憶されない。必要なら復旧後に backfill で埋める
  （→ [runbook_backfill.md](runbook_backfill.md)、upsert なので安全）

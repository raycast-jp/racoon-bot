# Runbook: 過去ログの一括取り込み (backfill)

bot 導入前の過去ログを DB に取り込む手順。`src/backfill.ts` は
**bot が参加している全チャンネル**（public / private、スレッド返信含む）を走査する。

## 事前準備

1. 取り込みたいチャンネルに bot を招待しておく: `/invite @racoon-bot`
   - bot が参加していないチャンネルはスキップされる（`is_member` チェック）
2. メッセージ量を見積もる。Slack API の rate limit (Tier 3) 対策で
   1 リクエスト（200 件）ごとに 1.2 秒 sleep するため、
   **目安: 1 万件 ≒ 1〜2 分 + スレッド数に比例して加算**

## 実行

### 本番 (Turso) に取り込む

```sh
TURSO_DATABASE_URL=libsql://xxx.turso.io \
TURSO_AUTH_TOKEN=... \
pnpm backfill
```

ローカルマシンから直接本番 DB に書き込まれる。レプリカ同期等の後処理は不要。

### ローカル DB で試す（推奨: 本番前に一度）

```sh
pnpm backfill   # TURSO_* 未設定 → file:./data/local.db に取り込まれる
```

## 実行中の出力

```
#general を取り込み中...
  #general: 200 件保存済み...
#general: 完了 (412 件)
バックフィル完了。合計 1234 件のメッセージを記憶しています。
```

## 冪等性・再実行

- `(channel_id, ts)` を主キーに **upsert** するため、**再実行しても重複しない**
- 途中で失敗した場合はそのまま再実行すれば OK（処理済み分は上書きされるだけ）

## 注意事項

- bot メッセージ（`bot_id` あり）と subtype 付きメッセージは取り込まれない（仕様）
- 実行中も本番 bot は通常稼働して問題ない（同じ upsert 経路のため競合しない）
- rate limit エラー（HTTP 429）が頻発する場合は `src/backfill.ts` の
  `sleep(1200)` を増やす
- **private チャンネルも取り込まれる**。横断検索による情報露出の扱いは
  セキュリティ方針（issue 参照）を確認してから実行すること

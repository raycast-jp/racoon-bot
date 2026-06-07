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
pnpm backfill:prod
```

接続情報を手で貼る必要はない。このスクリプトは

1. `vercel env pull` で本番の環境変数（`SLACK_BOT_TOKEN` / `TURSO_*`）を `.env.production` に取得し
2. それを使って backfill を実行し
3. 終了後に `.env.production` を削除する

（`.env.production` は gitignore 済み。Vercel にログイン・プロジェクトリンク済みであることが前提）

ローカルマシンから直接本番 DB に書き込まれる。レプリカ同期等の後処理は不要。

<details>
<summary>手動で接続情報を指定する場合</summary>

```sh
TURSO_DATABASE_URL=libsql://xxx.turso.io \
TURSO_AUTH_TOKEN=... \
SLACK_BOT_TOKEN=xoxb-... \
pnpm backfill
```

</details>

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

- 他アプリ（bot）の投稿（`bot_message`）も取り込まれる。除外されるのは
  **racoon-bot 自身の発言**と、`bot_message` 以外の subtype 付きメッセージ（参加通知など）のみ
- 実行中も本番 bot は通常稼働して問題ない（同じ upsert 経路のため競合しない）
- rate limit エラー（HTTP 429）が頻発する場合は `src/backfill.ts` の
  `sleep(1200)` を増やす
- **private チャンネルも取り込まれる**。横断検索による情報露出の扱いは
  セキュリティ方針（issue 参照）を確認してから実行すること

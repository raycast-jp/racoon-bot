# Runbook: ローカル開発

## 初回セットアップ

### 1. 開発用 Slack App を作る（1 人 1 セット方式）

本番 App とは**別の App** をローカル開発用に作る（Slack App に環境の概念はないため）。
チーム開発では**開発者ごとに自分専用の dev App + 自分の ngrok ドメイン**を持つ。
dev App を共有すると、Request URL を自分の ngrok に向けた瞬間に
他のメンバーへイベントが届かなくなるため、共有はしないこと。

1. https://api.slack.com/apps → **Create New App** → **From an app manifest**
2. `slack-app-manifest.dev.yml` の内容を貼り付ける。事前に 2 箇所を自分用に置き換える:
   - `YOURNAME` → 自分の名前（bot 名は `racoon-bot-dev-myano` のように）
   - `YOUR-SUBDOMAIN` → 自分の ngrok 固定ドメイン（次節で取得）
3. **Install to Workspace** でインストール
4. **Bot User OAuth Token** と **Signing Secret** を控える（→ `.env` へ）

> **注意（同一ワークスペース運用）**
> - 本番 App の Request URL は絶対に触らない。ngrok に向けるのは自分の dev App だけ
> - dev bot を invite したチャンネルの発言はローカルの `data/local.db` に記録される。
>   **動作確認用のテストチャンネル（例: #racoon-bot-dev）にだけ invite** し、
>   業務チャンネルには入れないこと
> - メンションは自分の bot（`@racoon-bot-dev-myano` など）宛てに行う。
>   テストチャンネルは共有でよい — 各自それぞれの bot にメンションすれば混線しない

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

## ngrok の準備（初回のみ）

1. https://ngrok.com で**各自の**アカウントを作成 → `ngrok config add-authtoken <token>`
2. ダッシュボード → **Domains** で**無料の固定ドメインを 1 つ請求**する
   （無料枠は 1 アカウント 1 ドメイン。だからこそ 1 人 1 アカウント）。
   固定ドメインなので再起動しても URL が変わらず、Slack の Request URL を
   再設定せずに済む。取得したドメインは自分の dev App の Request URL に対応させる

## 開発ループ

```sh
# ターミナル 1: 開発サーバー（コード変更で自動再起動）
pnpm dev

# ターミナル 2: Slack からのイベントを受けるトンネル（自分の固定ドメインを指定）
ngrok http 3000 --url=YOUR-SUBDOMAIN.ngrok-free.dev
```

固定ドメインの URL を**自分の dev App** の **Event Subscriptions → Request URL** に設定:
`https://YOUR-SUBDOMAIN.ngrok-free.dev/slack/events`（初回のみ。以降は変わらない）

> デバッグ Tips: http://localhost:4040 の ngrok インスペクタで受信した
> Slack イベントのペイロードを確認でき、**Replay でイベントを再送**して
> ハンドラーを再実行できる（Slack で発言し直す必要がない）。
> ただし署名検証のタイムスタンプ 5 分制限があるため、古いイベントの
> Replay は 401 になる。

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

## チーム開発の構成まとめ

```
本番:   racoon-bot            → Vercel（main から deploy）
myano:  racoon-bot-dev-myano  → myano の ngrok 固定ドメイン → 手元の pnpm dev
alice:  racoon-bot-dev-alice  → alice の ngrok 固定ドメイン → 手元の pnpm dev
```

- App 名・bot 名は `racoon-bot-dev-<name>` で統一する
- ngrok アカウント・固定ドメイン・`.env` は各自のもの。リポジトリにはコミットしない
- DB は各自の `file:./data/local.db` なので競合しない
- マージ前にチームで動作を共有確認したくなったら、ngrok ではなく
  staging（Vercel に `racoon-bot-stg` プロジェクト + 専用 Slack App + 専用 Turso DB）
  を別途立てる方が筋が良い。必要になった時点で構築する

## ハマりどころ

- **`環境変数 ... が設定されていません` で起動失敗** → `.env` の 3 変数を確認。
  `src/config.ts` が import 時に検証している
- **ngrok 経由でイベントが来ない** → `--url` 付きで起動しているか確認
  （固定ドメインなしで起動するとランダム URL になり、Slack 側の設定とずれる）。
  localhost:4040 のインスペクタにリクエストが届いているかで切り分ける
- **メンションに二重で回答する** → ngrok の接続が不安定で ACK が 3 秒を超え、
  Slack が再送している可能性。再送は `x-slack-retry-num` で無視する実装だが、
  ACK 自体が返らないケースでは発生しうる。トンネルの安定性を確認

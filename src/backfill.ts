/**
 * 過去ログの一括取り込みスクリプト。
 * bot が参加しているチャンネルの履歴（スレッド返信を含む）を DB に保存する。
 *
 * 使い方: npm run backfill
 * 本番の Turso に取り込む場合は TURSO_DATABASE_URL / TURSO_AUTH_TOKEN を指定して実行する。
 */
import { WebClient } from "@slack/web-api";
import { config } from "./config";
import { saveMessage, cacheChannelName, messageCount } from "./db";

const client = new WebClient(config.slackBotToken);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function backfillChannel(channelId: string, channelName: string): Promise<number> {
  let saved = 0;
  let cursor: string | undefined;

  do {
    const res = await client.conversations.history({
      channel: channelId,
      limit: 200,
      cursor,
    });

    for (const m of res.messages ?? []) {
      if (!m.ts || m.bot_id || m.subtype) continue;
      await saveMessage({
        channelId,
        ts: m.ts,
        threadTs: m.thread_ts,
        userId: m.user,
        text: m.text ?? "",
      });
      saved++;

      // スレッドの返信も取り込む
      if (m.reply_count && m.reply_count > 0 && m.thread_ts) {
        let replyCursor: string | undefined;
        do {
          const replies = await client.conversations.replies({
            channel: channelId,
            ts: m.thread_ts,
            limit: 200,
            cursor: replyCursor,
          });
          for (const r of replies.messages ?? []) {
            if (!r.ts || r.ts === m.ts || r.bot_id || (r as { subtype?: string }).subtype) continue;
            await saveMessage({
              channelId,
              ts: r.ts,
              threadTs: r.thread_ts,
              userId: r.user,
              text: r.text ?? "",
            });
            saved++;
          }
          replyCursor = replies.response_metadata?.next_cursor || undefined;
          await sleep(1200); // rate limit (Tier 3) 対策
        } while (replyCursor);
      }
    }

    cursor = res.response_metadata?.next_cursor || undefined;
    console.log(`  #${channelName}: ${saved} 件保存済み...`);
    await sleep(1200);
  } while (cursor);

  return saved;
}

(async () => {
  console.log("バックフィルを開始します...");
  let cursor: string | undefined;

  do {
    const res = await client.conversations.list({
      types: "public_channel,private_channel",
      limit: 200,
      cursor,
      exclude_archived: true,
    });

    for (const ch of res.channels ?? []) {
      if (!ch.id || !ch.is_member) continue;
      const name = ch.name ?? ch.id;
      await cacheChannelName(ch.id, name);
      console.log(`#${name} を取り込み中...`);
      const saved = await backfillChannel(ch.id, name);
      console.log(`#${name}: 完了 (${saved} 件)`);
    }

    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);

  console.log(`バックフィル完了。合計 ${await messageCount()} 件のメッセージを記憶しています。`);
})();

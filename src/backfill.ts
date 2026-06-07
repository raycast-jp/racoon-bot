/**
 * 過去ログの一括取り込みスクリプト。
 * bot が参加しているチャンネルの履歴（スレッド返信を含む）を DB に保存する。
 *
 * 使い方: npm run backfill
 * 本番の Turso に取り込む場合は TURSO_DATABASE_URL / TURSO_AUTH_TOKEN を指定して実行する。
 */
import { WebClient } from "@slack/web-api";
import { config } from "./config";
import { saveMessage, cacheChannelName, cacheUserName, messageCount } from "./db";

const client = new WebClient(config.slackBotToken);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// racoon-bot 自身の bot_id（自分の回答は取り込まない）
let selfBotId: string | undefined;

type SlackMessage = {
  ts?: string;
  thread_ts?: string;
  user?: string;
  bot_id?: string;
  username?: string;
  subtype?: string;
  text?: string;
};

/**
 * 取り込み対象なら保存して true を返す。
 * 対象: 通常メッセージと bot_message（racoon-bot 自身を除く）
 */
async function saveIfTarget(channelId: string, m: SlackMessage): Promise<boolean> {
  if (!m.ts) return false;
  if (m.subtype !== undefined && m.subtype !== "bot_message") return false;
  if (m.bot_id && m.bot_id === selfBotId) return false;
  if (m.subtype === "bot_message" && m.bot_id && m.username) {
    await cacheUserName(m.bot_id, m.username);
  }
  await saveMessage({
    channelId,
    ts: m.ts,
    threadTs: m.thread_ts,
    userId: m.user ?? m.bot_id,
    text: m.text ?? "",
  });
  return true;
}

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
      if (!m.ts) continue;
      if (await saveIfTarget(channelId, m)) saved++;

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
            if (!r.ts || r.ts === m.ts) continue;
            if (await saveIfTarget(channelId, r)) saved++;
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
  selfBotId = ((await client.auth.test()) as { bot_id?: string }).bot_id;
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

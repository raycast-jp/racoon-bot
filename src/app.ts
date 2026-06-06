import { App } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import { config } from "./config";
import {
  saveMessage,
  updateMessageText,
  deleteMessage,
  searchMessages,
  recentMessages,
  messageCount,
  cacheChannelName,
  getCachedChannelName,
  cacheUserName,
  getCachedUserName,
  type StoredMessage,
} from "./db";
import { extractKeywords, answerQuestion } from "./llm";

const app = new App({
  token: config.slackBotToken,
  signingSecret: config.slackSigningSecret,
});

// --- ログの蓄積 ---

app.event("message", async ({ event }) => {
  const e = event as Record<string, any>;

  if (e.subtype === undefined) {
    if (e.bot_id) return; // bot の発言は記録しない
    saveMessage({
      channelId: e.channel,
      ts: e.ts,
      threadTs: e.thread_ts,
      userId: e.user,
      text: e.text ?? "",
    });
  } else if (e.subtype === "message_changed" && e.message?.ts) {
    updateMessageText(e.channel, e.message.ts, e.message.text ?? "");
  } else if (e.subtype === "message_deleted" && e.deleted_ts) {
    deleteMessage(e.channel, e.deleted_ts);
  } else if (e.subtype === "thread_broadcast") {
    saveMessage({
      channelId: e.channel,
      ts: e.ts,
      threadTs: e.thread_ts,
      userId: e.user,
      text: e.text ?? "",
    });
  }
});

// --- @メンションで質問に回答 ---

app.event("app_mention", async ({ event, client, say }) => {
  const question = event.text.replace(/<@[^>]+>/g, "").trim();
  const threadTs = event.thread_ts ?? event.ts;

  if (!question) {
    await say({
      text: `質問をどうぞ！現在 ${messageCount()} 件のメッセージを記憶しています。`,
      thread_ts: threadTs,
    });
    return;
  }

  try {
    // 1. 質問から検索キーワードを抽出
    const keywords = await extractKeywords(question);

    // 2. 全文検索 + 質問チャンネルの直近ログを収集
    const hits = keywords.length > 0 ? searchMessages(keywords, config.searchLimit) : [];
    const recent = recentMessages(event.channel, config.recentLimit);

    const searchContext = await formatMessages(client, hits);
    const recentContext = await formatMessages(client, recent);

    // 3. Claude に回答させる
    const answer = await answerQuestion(question, searchContext, recentContext);

    await say({
      text: answer || "回答を生成できませんでした。",
      thread_ts: threadTs,
    });
  } catch (error) {
    console.error("回答生成に失敗:", error);
    await say({
      text: "エラーが発生しました。しばらくしてからもう一度お試しください。",
      thread_ts: threadTs,
    });
  }
});

// --- 表示用フォーマット ---

async function formatMessages(client: WebClient, messages: StoredMessage[]): Promise<string> {
  const lines: string[] = [];
  for (const m of messages) {
    const channel = await resolveChannelName(client, m.channel_id);
    const user = m.user_id ? await resolveUserName(client, m.user_id) : "unknown";
    const date = new Date(m.created_at * 1000).toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    lines.push(`[${date}] #${channel} ${user}: ${m.text}`);
  }
  return lines.join("\n");
}

async function resolveChannelName(client: WebClient, channelId: string): Promise<string> {
  const cached = getCachedChannelName(channelId);
  if (cached) return cached;
  try {
    const res = await client.conversations.info({ channel: channelId });
    const name = res.channel?.name ?? channelId;
    cacheChannelName(channelId, name);
    return name;
  } catch {
    return channelId;
  }
}

async function resolveUserName(client: WebClient, userId: string): Promise<string> {
  const cached = getCachedUserName(userId);
  if (cached) return cached;
  try {
    const res = await client.users.info({ user: userId });
    const name =
      res.user?.profile?.display_name || res.user?.real_name || res.user?.name || userId;
    cacheUserName(userId, name);
    return name;
  } catch {
    return userId;
  }
}

// --- 起動 ---

(async () => {
  await app.start(config.port);
  console.log(`⚡️ racoon-bot がポート ${config.port} で起動しました（記憶: ${messageCount()} 件）`);
})();

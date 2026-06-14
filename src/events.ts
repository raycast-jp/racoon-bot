import { WebClient } from "@slack/web-api";
import { config } from "./config";
import {
  cacheChannelName,
  cacheUserName,
  deleteMessage,
  getCachedChannelName,
  getCachedUserName,
  messageCount,
  recentMessages,
  type StoredMessage,
  saveMessage,
  searchMessages,
  updateMessageText,
} from "./db";
import { answerQuestion } from "./llm";

const client = new WebClient(config.slackBotToken);

// 自分自身 (racoon-bot) の bot_id。初回参照時に auth.test で解決してキャッシュする
let selfBotIdPromise: Promise<string | undefined> | null = null;
function selfBotId(): Promise<string | undefined> {
  selfBotIdPromise ??= client.auth.test().then((res) => (res as { bot_id?: string }).bot_id);
  return selfBotIdPromise;
}

/**
 * Events API の event_callback ペイロード内の event を処理する。
 * Vercel Function とローカル開発サーバーの両方から呼ばれる。
 */
export async function handleEvent(event: Record<string, any>): Promise<void> {
  if (event.type === "message") return handleMessage(event);
  if (event.type === "app_mention") return handleAppMention(event);
}

// --- ログの蓄積 ---

async function handleMessage(e: Record<string, any>): Promise<void> {
  if (e.subtype === undefined || e.subtype === "bot_message") {
    // racoon-bot 自身の回答だけは記録しない（検索ノイズ・自己参照の防止）。
    // 他のアプリ (bot) の投稿は人間の発言と同様に記録する
    if (e.bot_id && e.bot_id === (await selfBotId())) return;
    // bot_message は user を持たないことがあるため bot_id を発言者として保存し、表示名をキャッシュ
    if (e.subtype === "bot_message" && e.bot_id && e.username) {
      await cacheUserName(e.bot_id, e.username);
    }
    await saveMessage({
      channelId: e.channel,
      ts: e.ts,
      threadTs: e.thread_ts,
      userId: e.user ?? e.bot_id,
      text: e.text ?? "",
    });
  } else if (e.subtype === "message_changed" && e.message?.ts) {
    await updateMessageText(e.channel, e.message.ts, e.message.text ?? "");
  } else if (e.subtype === "message_deleted" && e.deleted_ts) {
    await deleteMessage(e.channel, e.deleted_ts);
  } else if (e.subtype === "thread_broadcast") {
    await saveMessage({
      channelId: e.channel,
      ts: e.ts,
      threadTs: e.thread_ts,
      userId: e.user,
      text: e.text ?? "",
    });
  }
}

// --- @メンションで質問に回答 ---

async function handleAppMention(e: Record<string, any>): Promise<void> {
  const question = (e.text as string).replace(/<@[^>]+>/g, "").trim();
  const threadTs = e.thread_ts ?? e.ts;
  const reply = (text: string) =>
    client.chat.postMessage({ channel: e.channel, text, thread_ts: threadTs });

  if (!question) {
    await reply(`質問をどうぞ！現在 ${await messageCount()} 件のメッセージを記憶しています。`);
    return;
  }

  try {
    // 質問チャンネルの直近ログを文脈として渡し、
    // 全文検索はツールとしてモデルが必要に応じて呼び出す
    const recent = await recentMessages(e.channel, config.recentLimit);
    const recentContext = await formatMessages(recent);

    const answer = await answerQuestion(question, recentContext, async (keywords) => {
      const hits = await searchMessages(keywords, config.searchLimit);
      return (await formatMessages(hits)) || "(ヒットなし)";
    });

    await reply(answer || "回答を生成できませんでした。");
  } catch (error) {
    console.error("回答生成に失敗:", error);
    await reply("エラーが発生しました。しばらくしてからもう一度お試しください。");
  }
}

// --- 表示用フォーマット ---

async function formatMessages(messages: StoredMessage[]): Promise<string> {
  const lines: string[] = [];
  for (const m of messages) {
    const channel = await resolveChannelName(m.channelId);
    const user = m.userId ? await resolveUserName(m.userId) : "unknown";
    const date = new Date(m.createdAt * 1000).toLocaleString("ja-JP", {
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

async function resolveChannelName(channelId: string): Promise<string> {
  const cached = await getCachedChannelName(channelId);
  if (cached) return cached;
  try {
    const res = await client.conversations.info({ channel: channelId });
    const name = res.channel?.name ?? channelId;
    await cacheChannelName(channelId, name);
    return name;
  } catch {
    return channelId;
  }
}

async function resolveUserName(userId: string): Promise<string> {
  const cached = await getCachedUserName(userId);
  if (cached) return cached;
  try {
    // bot_message の発言者は bot_id (B...) のため users.info ではなく bots.info で引く
    if (userId.startsWith("B")) {
      const res = await client.bots.info({ bot: userId });
      const name = res.bot?.name ?? userId;
      await cacheUserName(userId, name);
      return name;
    }
    const res = await client.users.info({ user: userId });
    const name = res.user?.profile?.display_name || res.user?.real_name || res.user?.name || userId;
    await cacheUserName(userId, name);
    return name;
  } catch {
    return userId;
  }
}

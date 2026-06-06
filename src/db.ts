import { createClient } from "@libsql/client";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";
import { channels, messages, users, type StoredMessage } from "./schema";

export type { StoredMessage } from "./schema";

// ローカル開発時 (file:) は保存先ディレクトリを作っておく
if (config.tursoDatabaseUrl.startsWith("file:")) {
  const filePath = config.tursoDatabaseUrl.slice("file:".length);
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

const client = createClient({
  url: config.tursoDatabaseUrl,
  authToken: config.tursoAuthToken,
});

const db = drizzle(client);

// スキーマは drizzle/ のマイグレーション（drizzle-kit generate で生成）で管理する。
// 初回アクセス時に一度だけ適用する
let schemaReady: Promise<void> | null = null;

function ensureSchema(): Promise<void> {
  schemaReady ??= migrate(db, {
    migrationsFolder: path.join(process.cwd(), "drizzle"),
  });
  return schemaReady;
}

export async function saveMessage(msg: {
  channelId: string;
  ts: string;
  threadTs?: string;
  userId?: string;
  text: string;
}): Promise<void> {
  if (!msg.text.trim()) return;
  await ensureSchema();
  await db
    .insert(messages)
    .values({
      channelId: msg.channelId,
      ts: msg.ts,
      threadTs: msg.threadTs ?? null,
      userId: msg.userId ?? null,
      text: msg.text,
      createdAt: Math.floor(Number(msg.ts)),
    })
    .onConflictDoUpdate({
      target: [messages.channelId, messages.ts],
      set: { text: sql`excluded.text` },
    });
}

export async function updateMessageText(
  channelId: string,
  ts: string,
  text: string
): Promise<void> {
  await ensureSchema();
  await db
    .update(messages)
    .set({ text })
    .where(and(eq(messages.channelId, channelId), eq(messages.ts, ts)));
}

export async function deleteMessage(channelId: string, ts: string): Promise<void> {
  await ensureSchema();
  await db.delete(messages).where(and(eq(messages.channelId, channelId), eq(messages.ts, ts)));
}

/**
 * キーワード群で全文検索する。
 * trigram tokenizer は 3 文字未満のクエリにマッチしないため、
 * 短いキーワードは LIKE でフォールバックする。
 */
export async function searchMessages(
  keywords: string[],
  limit: number
): Promise<StoredMessage[]> {
  await ensureSchema();

  const seen = new Set<string>();
  const results: StoredMessage[] = [];

  const push = (rows: StoredMessage[]) => {
    for (const row of rows) {
      const key = `${row.channelId}:${row.ts}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(row);
    }
  };

  const ftsKeywords = keywords.filter((k) => [...k].length >= 3);
  const shortKeywords = keywords.filter((k) => {
    const len = [...k].length;
    return len > 0 && len < 3;
  });

  if (ftsKeywords.length > 0) {
    const query = ftsKeywords
      .map((k) => `"${k.replaceAll('"', '""')}"`)
      .join(" OR ");
    try {
      // FTS5 の MATCH / bm25 は Drizzle で表現できないため raw SQL
      const rows = (await db.all(sql`
        SELECT m.channel_id AS channelId, m.ts AS ts, m.thread_ts AS threadTs,
               m.user_id AS userId, m.text AS text, m.created_at AS createdAt
        FROM messages_fts f
        JOIN messages m ON m.rowid = f.rowid
        WHERE messages_fts MATCH ${query}
        ORDER BY bm25(messages_fts)
        LIMIT ${limit}
      `)) as StoredMessage[];
      push(rows);
    } catch {
      // FTS クエリ構文エラーは無視して LIKE にフォールバック
    }
  }

  for (const kw of [...shortKeywords, ...ftsKeywords]) {
    if (results.length >= limit) break;
    const escaped = kw.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
    const rows = await db
      .select()
      .from(messages)
      .where(sql`${messages.text} LIKE ${`%${escaped}%`} ESCAPE '\\'`)
      .orderBy(desc(messages.createdAt))
      .limit(20);
    push(rows);
  }

  return results.slice(0, limit);
}

export async function recentMessages(
  channelId: string,
  limit: number
): Promise<StoredMessage[]> {
  await ensureSchema();
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.channelId, channelId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  return rows.reverse(); // 古い順に並べ替え
}

export async function messageCount(): Promise<number> {
  await ensureSchema();
  const [row] = await db.select({ c: count() }).from(messages);
  return row.c;
}

// --- チャンネル名・ユーザー名のキャッシュ ---

export async function cacheChannelName(id: string, name: string): Promise<void> {
  await ensureSchema();
  await db
    .insert(channels)
    .values({ id, name })
    .onConflictDoUpdate({ target: channels.id, set: { name: sql`excluded.name` } });
}

export async function getCachedChannelName(id: string): Promise<string | undefined> {
  await ensureSchema();
  const [row] = await db.select({ name: channels.name }).from(channels).where(eq(channels.id, id));
  return row?.name;
}

export async function cacheUserName(id: string, name: string): Promise<void> {
  await ensureSchema();
  await db
    .insert(users)
    .values({ id, name })
    .onConflictDoUpdate({ target: users.id, set: { name: sql`excluded.name` } });
}

export async function getCachedUserName(id: string): Promise<string | undefined> {
  await ensureSchema();
  const [row] = await db.select({ name: users.name }).from(users).where(eq(users.id, id));
  return row?.name;
}

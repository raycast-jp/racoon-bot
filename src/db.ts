import { createClient, type Row } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";

// ローカル開発時 (file:) は保存先ディレクトリを作っておく
if (config.tursoDatabaseUrl.startsWith("file:")) {
  const filePath = config.tursoDatabaseUrl.slice("file:".length);
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

const db = createClient({
  url: config.tursoDatabaseUrl,
  authToken: config.tursoAuthToken,
});

// trigram tokenizer は日本語の部分一致検索に対応 (SQLite 3.34+)
const SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
  channel_id TEXT NOT NULL,
  ts         TEXT NOT NULL,
  thread_ts  TEXT,
  user_id    TEXT,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (channel_id, ts)
);

CREATE INDEX IF NOT EXISTS idx_messages_channel_created
  ON messages (channel_id, created_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  text,
  content='messages',
  content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF text ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TABLE IF NOT EXISTS channels (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
`;

let schemaReady: Promise<void> | null = null;

function ensureSchema(): Promise<void> {
  schemaReady ??= db.executeMultiple(SCHEMA);
  return schemaReady;
}

export interface StoredMessage {
  channel_id: string;
  ts: string;
  thread_ts: string | null;
  user_id: string | null;
  text: string;
  created_at: number;
}

function rowToMessage(r: Row): StoredMessage {
  return {
    channel_id: r.channel_id as string,
    ts: r.ts as string,
    thread_ts: (r.thread_ts as string | null) ?? null,
    user_id: (r.user_id as string | null) ?? null,
    text: r.text as string,
    created_at: Number(r.created_at),
  };
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
  await db.execute({
    sql: `INSERT INTO messages (channel_id, ts, thread_ts, user_id, text, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (channel_id, ts) DO UPDATE SET text = excluded.text`,
    args: [
      msg.channelId,
      msg.ts,
      msg.threadTs ?? null,
      msg.userId ?? null,
      msg.text,
      Math.floor(Number(msg.ts)),
    ],
  });
}

export async function updateMessageText(
  channelId: string,
  ts: string,
  text: string
): Promise<void> {
  await ensureSchema();
  await db.execute({
    sql: "UPDATE messages SET text = ? WHERE channel_id = ? AND ts = ?",
    args: [text, channelId, ts],
  });
}

export async function deleteMessage(channelId: string, ts: string): Promise<void> {
  await ensureSchema();
  await db.execute({
    sql: "DELETE FROM messages WHERE channel_id = ? AND ts = ?",
    args: [channelId, ts],
  });
}

const FTS_SQL = `
  SELECT m.channel_id, m.ts, m.thread_ts, m.user_id, m.text, m.created_at
  FROM messages_fts f
  JOIN messages m ON m.rowid = f.rowid
  WHERE messages_fts MATCH ?
  ORDER BY bm25(messages_fts)
  LIMIT ?
`;

const LIKE_SQL = `
  SELECT channel_id, ts, thread_ts, user_id, text, created_at
  FROM messages
  WHERE text LIKE ? ESCAPE '\\'
  ORDER BY created_at DESC
  LIMIT ?
`;

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
      const key = `${row.channel_id}:${row.ts}`;
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
      const rs = await db.execute({ sql: FTS_SQL, args: [query, limit] });
      push(rs.rows.map(rowToMessage));
    } catch {
      // FTS クエリ構文エラーは無視して LIKE にフォールバック
    }
  }

  for (const kw of [...shortKeywords, ...ftsKeywords]) {
    if (results.length >= limit) break;
    const escaped = kw.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
    const rs = await db.execute({ sql: LIKE_SQL, args: [`%${escaped}%`, 20] });
    push(rs.rows.map(rowToMessage));
  }

  return results.slice(0, limit);
}

export async function recentMessages(
  channelId: string,
  limit: number
): Promise<StoredMessage[]> {
  await ensureSchema();
  const rs = await db.execute({
    sql: `SELECT channel_id, ts, thread_ts, user_id, text, created_at
          FROM messages
          WHERE channel_id = ?
          ORDER BY created_at DESC
          LIMIT ?`,
    args: [channelId, limit],
  });
  return rs.rows.map(rowToMessage).reverse(); // 古い順に並べ替え
}

export async function messageCount(): Promise<number> {
  await ensureSchema();
  const rs = await db.execute("SELECT COUNT(*) AS c FROM messages");
  return Number(rs.rows[0].c);
}

// --- チャンネル名・ユーザー名のキャッシュ ---

export async function cacheChannelName(id: string, name: string): Promise<void> {
  await ensureSchema();
  await db.execute({
    sql: "INSERT INTO channels (id, name) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name",
    args: [id, name],
  });
}

export async function getCachedChannelName(id: string): Promise<string | undefined> {
  await ensureSchema();
  const rs = await db.execute({ sql: "SELECT name FROM channels WHERE id = ?", args: [id] });
  return rs.rows[0]?.name as string | undefined;
}

export async function cacheUserName(id: string, name: string): Promise<void> {
  await ensureSchema();
  await db.execute({
    sql: "INSERT INTO users (id, name) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name",
    args: [id, name],
  });
}

export async function getCachedUserName(id: string): Promise<string | undefined> {
  await ensureSchema();
  const rs = await db.execute({ sql: "SELECT name FROM users WHERE id = ?", args: [id] });
  return rs.rows[0]?.name as string | undefined;
}

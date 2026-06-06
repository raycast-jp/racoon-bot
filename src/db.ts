import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";

fs.mkdirSync(path.dirname(path.resolve(config.dbPath)), { recursive: true });

const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

// trigram tokenizer は日本語の部分一致検索に対応 (SQLite 3.34+)
db.exec(`
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
`);

export interface StoredMessage {
  channel_id: string;
  ts: string;
  thread_ts: string | null;
  user_id: string | null;
  text: string;
  created_at: number;
}

const insertStmt = db.prepare(`
  INSERT INTO messages (channel_id, ts, thread_ts, user_id, text, created_at)
  VALUES (@channel_id, @ts, @thread_ts, @user_id, @text, @created_at)
  ON CONFLICT (channel_id, ts) DO UPDATE SET text = excluded.text
`);

export function saveMessage(msg: {
  channelId: string;
  ts: string;
  threadTs?: string;
  userId?: string;
  text: string;
}): void {
  if (!msg.text.trim()) return;
  insertStmt.run({
    channel_id: msg.channelId,
    ts: msg.ts,
    thread_ts: msg.threadTs ?? null,
    user_id: msg.userId ?? null,
    text: msg.text,
    created_at: Math.floor(Number(msg.ts)),
  });
}

const updateStmt = db.prepare(
  "UPDATE messages SET text = ? WHERE channel_id = ? AND ts = ?"
);

export function updateMessageText(channelId: string, ts: string, text: string): void {
  updateStmt.run(text, channelId, ts);
}

const deleteStmt = db.prepare(
  "DELETE FROM messages WHERE channel_id = ? AND ts = ?"
);

export function deleteMessage(channelId: string, ts: string): void {
  deleteStmt.run(channelId, ts);
}

const ftsStmt = db.prepare(`
  SELECT m.channel_id, m.ts, m.thread_ts, m.user_id, m.text, m.created_at
  FROM messages_fts f
  JOIN messages m ON m.rowid = f.rowid
  WHERE messages_fts MATCH ?
  ORDER BY bm25(messages_fts)
  LIMIT ?
`);

const likeStmt = db.prepare(`
  SELECT channel_id, ts, thread_ts, user_id, text, created_at
  FROM messages
  WHERE text LIKE ? ESCAPE '\\'
  ORDER BY created_at DESC
  LIMIT ?
`);

/**
 * キーワード群で全文検索する。
 * trigram tokenizer は 3 文字未満のクエリにマッチしないため、
 * 短いキーワードは LIKE でフォールバックする。
 */
export function searchMessages(keywords: string[], limit: number): StoredMessage[] {
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
      push(ftsStmt.all(query, limit) as StoredMessage[]);
    } catch {
      // FTS クエリ構文エラーは無視して LIKE にフォールバック
    }
  }

  for (const kw of [...shortKeywords, ...ftsKeywords]) {
    if (results.length >= limit) break;
    const escaped = kw.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
    push(likeStmt.all(`%${escaped}%`, 20) as StoredMessage[]);
  }

  return results.slice(0, limit);
}

const recentStmt = db.prepare(`
  SELECT channel_id, ts, thread_ts, user_id, text, created_at
  FROM messages
  WHERE channel_id = ?
  ORDER BY created_at DESC
  LIMIT ?
`);

export function recentMessages(channelId: string, limit: number): StoredMessage[] {
  const rows = recentStmt.all(channelId, limit) as StoredMessage[];
  return rows.reverse(); // 古い順に並べ替え
}

const countStmt = db.prepare("SELECT COUNT(*) AS c FROM messages");

export function messageCount(): number {
  return (countStmt.get() as { c: number }).c;
}

// --- チャンネル名・ユーザー名のキャッシュ ---

const upsertChannelStmt = db.prepare(
  "INSERT INTO channels (id, name) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name"
);
const getChannelStmt = db.prepare("SELECT name FROM channels WHERE id = ?");

export function cacheChannelName(id: string, name: string): void {
  upsertChannelStmt.run(id, name);
}

export function getCachedChannelName(id: string): string | undefined {
  return (getChannelStmt.get(id) as { name: string } | undefined)?.name;
}

const upsertUserStmt = db.prepare(
  "INSERT INTO users (id, name) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name"
);
const getUserStmt = db.prepare("SELECT name FROM users WHERE id = ?");

export function cacheUserName(id: string, name: string): void {
  upsertUserStmt.run(id, name);
}

export function getCachedUserName(id: string): string | undefined {
  return (getUserStmt.get(id) as { name: string } | undefined)?.name;
}

-- FTS5 仮想テーブルと同期 trigger。Drizzle のスキーマ API では表現できないためカスタムマイグレーションで管理する。
-- trigram tokenizer は日本語の部分一致検索に対応 (SQLite 3.34+)
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  text,
  content='messages',
  content_rowid='rowid',
  tokenize='trigram'
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF text ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
END;

import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const messages = sqliteTable(
  "messages",
  {
    channelId: text("channel_id").notNull(),
    ts: text("ts").notNull(),
    threadTs: text("thread_ts"),
    userId: text("user_id"),
    text: text("text").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.ts] }),
    index("idx_messages_channel_created").on(t.channelId, t.createdAt),
  ]
);

export const channels = sqliteTable("channels", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export type StoredMessage = typeof messages.$inferSelect;

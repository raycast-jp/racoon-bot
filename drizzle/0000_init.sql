CREATE TABLE IF NOT EXISTS `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `messages` (
	`channel_id` text NOT NULL,
	`ts` text NOT NULL,
	`thread_ts` text,
	`user_id` text,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`channel_id`, `ts`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_messages_channel_created` ON `messages` (`channel_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);

CREATE TABLE `series` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`estimate_minutes` integer NOT NULL,
	`weekdays` text NOT NULL,
	`lead_days` integer NOT NULL,
	`end_date` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `series_user_idx` ON `series` (`user_id`);--> statement-breakpoint
ALTER TABLE `deadlines` ADD `series_id` text REFERENCES series(id);--> statement-breakpoint
CREATE INDEX `deadlines_series_due_idx` ON `deadlines` (`series_id`,`due_date`);
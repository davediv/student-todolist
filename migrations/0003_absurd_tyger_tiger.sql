CREATE TABLE `deadlines` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`due_date` text NOT NULL,
	`start_date` text NOT NULL,
	`estimate_minutes` integer NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`done_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deadlines_user_due_idx` ON `deadlines` (`user_id`,`due_date`);--> statement-breakpoint
CREATE TABLE `study_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`deadline_id` text NOT NULL,
	`date` text NOT NULL,
	`minutes` integer NOT NULL,
	`ticked` integer DEFAULT false NOT NULL,
	`ticked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deadline_id`) REFERENCES `deadlines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `study_sessions_deadline_date_idx` ON `study_sessions` (`deadline_id`,`date`);--> statement-breakpoint
CREATE INDEX `study_sessions_user_date_idx` ON `study_sessions` (`user_id`,`date`);
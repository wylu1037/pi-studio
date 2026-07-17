CREATE TABLE `scheduled_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`agent_id` text NOT NULL,
	`session_id` text,
	`prompt` text NOT NULL,
	`schedule_type` text NOT NULL,
	`interval_minutes` integer,
	`weekday` integer,
	`time_of_day` text,
	`scheduled_at` text,
	`timezone` text DEFAULT 'Asia/Shanghai' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_run_at` text,
	`last_run_status` text DEFAULT 'idle' NOT NULL,
	`next_run_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `scheduled_tasks_agent_idx` ON `scheduled_tasks` (`agent_id`);--> statement-breakpoint
CREATE INDEX `scheduled_tasks_next_run_idx` ON `scheduled_tasks` (`next_run_at`);

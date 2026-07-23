CREATE TABLE `metric_samples` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`metric_id` text NOT NULL,
	`value` real NOT NULL,
	`captured_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `metric_samples_metric_time_idx` ON `metric_samples` (`metric_id`,`captured_at`);
--> statement-breakpoint
CREATE INDEX `metric_samples_time_idx` ON `metric_samples` (`captured_at`);

CREATE TABLE `agent_extensions` (
	`agent_id` text NOT NULL,
	`extension_id` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`extension_id`) REFERENCES `studio_extensions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_extensions_agent_idx` ON `agent_extensions` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_extensions_extension_idx` ON `agent_extensions` (`extension_id`);--> statement-breakpoint
CREATE TABLE `studio_extensions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`path` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

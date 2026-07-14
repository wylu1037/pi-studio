CREATE TABLE `agent_package_sources` (
	`agent_id` text NOT NULL,
	`source` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_package_sources_agent_idx` ON `agent_package_sources` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_package_sources_source_idx` ON `agent_package_sources` (`source`);
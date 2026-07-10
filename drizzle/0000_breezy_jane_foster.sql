CREATE TABLE `agent_mcp_configs` (
	`agent_id` text NOT NULL,
	`mcp_config_id` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mcp_config_id`) REFERENCES `mcp_configs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_mcp_configs_agent_idx` ON `agent_mcp_configs` (`agent_id`);--> statement-breakpoint
CREATE TABLE `agent_model_providers` (
	`agent_id` text NOT NULL,
	`provider_id` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `model_providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_model_providers_agent_idx` ON `agent_model_providers` (`agent_id`);--> statement-breakpoint
CREATE TABLE `agent_models` (
	`agent_id` text NOT NULL,
	`model_id` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_models_agent_idx` ON `agent_models` (`agent_id`);--> statement-breakpoint
CREATE TABLE `agent_prompts` (
	`agent_id` text NOT NULL,
	`prompt_id` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`prompt_id`) REFERENCES `global_prompts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_prompts_agent_idx` ON `agent_prompts` (`agent_id`);--> statement-breakpoint
CREATE TABLE `agent_skills` (
	`agent_id` text NOT NULL,
	`skill_id` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `global_skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_skills_agent_idx` ON `agent_skills` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_skills_skill_idx` ON `agent_skills` (`skill_id`);--> statement-breakpoint
CREATE TABLE `agent_tags` (
	`agent_id` text NOT NULL,
	`tag` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_tags_agent_idx` ON `agent_tags` (`agent_id`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`icon` text,
	`color` text DEFAULT '#7c8cf8' NOT NULL,
	`default_cwd` text,
	`default_provider_id` text,
	`default_model_id` text,
	`default_thinking_level` text DEFAULT 'medium' NOT NULL,
	`last_used` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`node_id` text,
	`type` text NOT NULL,
	`role` text,
	`title` text,
	`content` text NOT NULL,
	`tokens` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`node_id`) REFERENCES `session_tree_nodes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chat_messages_session_idx` ON `chat_messages` (`session_id`);--> statement-breakpoint
CREATE TABLE `chat_run_events` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`type` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `chat_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_run_events_run_idx` ON `chat_run_events` (`run_id`);--> statement-breakpoint
CREATE TABLE `chat_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`provider_id` text,
	`model_id` text,
	`thinking_level` text DEFAULT 'medium' NOT NULL,
	`cwd` text NOT NULL,
	`prompt` text NOT NULL,
	`error` text,
	`started_at` text,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_runs_session_idx` ON `chat_runs` (`session_id`);--> statement-breakpoint
CREATE TABLE `global_prompts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`content` text NOT NULL,
	`path` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `global_skills` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`source` text NOT NULL,
	`path` text NOT NULL,
	`version` text,
	`author` text,
	`installed_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcp_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`command` text NOT NULL,
	`args_json` text DEFAULT '[]' NOT NULL,
	`env_json` text DEFAULT '{}' NOT NULL,
	`enabled_globally` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcp_tags` (
	`mcp_config_id` text NOT NULL,
	`tag` text NOT NULL,
	FOREIGN KEY (`mcp_config_id`) REFERENCES `mcp_configs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mcp_tags_mcp_idx` ON `mcp_tags` (`mcp_config_id`);--> statement-breakpoint
CREATE TABLE `model_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`api` text NOT NULL,
	`api_key` text,
	`headers_json` text DEFAULT '{}' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'untested' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `models` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`name` text,
	`reasoning` integer DEFAULT false NOT NULL,
	`input_json` text DEFAULT '["text"]' NOT NULL,
	`context_window` integer,
	`max_tokens` integer,
	FOREIGN KEY (`provider_id`) REFERENCES `model_providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `models_provider_idx` ON `models` (`provider_id`);--> statement-breakpoint
CREATE TABLE `packages` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`source` text NOT NULL,
	`type` text NOT NULL,
	`version` text NOT NULL,
	`scope` text DEFAULT 'global' NOT NULL,
	`author` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`downloads` text DEFAULT '0' NOT NULL,
	`resources_json` text DEFAULT '{}' NOT NULL,
	`has_extensions` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'installed' NOT NULL,
	`is_gallery` integer DEFAULT false NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `prompt_tags` (
	`prompt_id` text NOT NULL,
	`tag` text NOT NULL,
	FOREIGN KEY (`prompt_id`) REFERENCES `global_prompts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `prompt_tags_prompt_idx` ON `prompt_tags` (`prompt_id`);--> statement-breakpoint
CREATE TABLE `session_tags` (
	`session_id` text NOT NULL,
	`tag` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_tags_session_idx` ON `session_tags` (`session_id`);--> statement-breakpoint
CREATE TABLE `session_tree_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`parent_id` text,
	`type` text NOT NULL,
	`role` text,
	`preview` text NOT NULL,
	`label` text,
	`is_current` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tree_nodes_session_idx` ON `session_tree_nodes` (`session_id`);--> statement-breakpoint
CREATE INDEX `tree_nodes_parent_idx` ON `session_tree_nodes` (`parent_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`name` text,
	`file_path` text NOT NULL,
	`cwd` text NOT NULL,
	`active_node_id` text,
	`total_tokens` integer,
	`total_cost` real,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_agent_idx` ON `sessions` (`agent_id`);--> statement-breakpoint
CREATE TABLE `skill_tags` (
	`skill_id` text NOT NULL,
	`tag` text NOT NULL,
	FOREIGN KEY (`skill_id`) REFERENCES `global_skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `skill_tags_skill_idx` ON `skill_tags` (`skill_id`);
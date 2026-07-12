ALTER TABLE `chat_messages` ADD `usage_input_tokens` integer;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `usage_output_tokens` integer;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `usage_cache_read_tokens` integer;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `usage_cache_write_tokens` integer;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `usage_cost_input` real;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `usage_cost_output` real;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `usage_cost_cache_read` real;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `usage_cost_cache_write` real;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `usage_cost_total` real;
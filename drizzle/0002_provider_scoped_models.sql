ALTER TABLE `global_prompts` ADD `argument_hint` text;--> statement-breakpoint
ALTER TABLE `global_prompts` ADD `source` text DEFAULT 'studio' NOT NULL;--> statement-breakpoint
ALTER TABLE `global_prompts` ADD `scope` text DEFAULT 'global' NOT NULL;

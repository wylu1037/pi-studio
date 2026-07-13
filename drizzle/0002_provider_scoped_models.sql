PRAGMA foreign_keys=OFF;--> statement-breakpoint
UPDATE `agent_models`
SET `model_id` = (
  SELECT `provider_id` || '::' || `models`.`id`
  FROM `models`
  WHERE `models`.`id` = `agent_models`.`model_id`
);--> statement-breakpoint
UPDATE `models`
SET `id` = `provider_id` || '::' || `id`;--> statement-breakpoint
PRAGMA foreign_keys=ON;

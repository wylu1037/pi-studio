import { relations, sql } from 'drizzle-orm'
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

const timestamps = {
  createdAt: text('created_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
}

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  icon: text('icon'),
  color: text('color').notNull().default('#7c8cf8'),
  defaultCwd: text('default_cwd'),
  defaultProviderId: text('default_provider_id'),
  defaultModelId: text('default_model_id'),
  defaultThinkingLevel: text('default_thinking_level').notNull().default('medium'),
  lastUsed: text('last_used'),
  ...timestamps,
})

export const agentTags = sqliteTable(
  'agent_tags',
  {
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
  },
  (table) => [index('agent_tags_agent_idx').on(table.agentId)],
)

export const globalSkills = sqliteTable('global_skills', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  source: text('source').notNull(),
  path: text('path').notNull(),
  version: text('version'),
  author: text('author'),
  installedAt: text('installed_at').notNull(),
  ...timestamps,
})

export const studioExtensions = sqliteTable('studio_extensions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  path: text('path').notNull(),
  ...timestamps,
})

export const skillTags = sqliteTable(
  'skill_tags',
  {
    skillId: text('skill_id')
      .notNull()
      .references(() => globalSkills.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
  },
  (table) => [index('skill_tags_skill_idx').on(table.skillId)],
)

export const globalPrompts = sqliteTable('global_prompts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  argumentHint: text('argument_hint'),
  content: text('content').notNull(),
  path: text('path').notNull(),
  source: text('source').notNull().default('studio'),
  scope: text('scope').notNull().default('global'),
  ...timestamps,
})

export const promptTags = sqliteTable(
  'prompt_tags',
  {
    promptId: text('prompt_id')
      .notNull()
      .references(() => globalPrompts.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
  },
  (table) => [index('prompt_tags_prompt_idx').on(table.promptId)],
)

export const mcpConfigs = sqliteTable('mcp_configs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  command: text('command').notNull(),
  argsJson: text('args_json').notNull().default('[]'),
  envJson: text('env_json').notNull().default('{}'),
  enabledGlobally: integer('enabled_globally', { mode: 'boolean' }).notNull().default(false),
  ...timestamps,
})

export const mcpTags = sqliteTable(
  'mcp_tags',
  {
    mcpConfigId: text('mcp_config_id')
      .notNull()
      .references(() => mcpConfigs.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
  },
  (table) => [index('mcp_tags_mcp_idx').on(table.mcpConfigId)],
)

export const modelProviders = sqliteTable('model_providers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  api: text('api').notNull(),
  apiKey: text('api_key'),
  headersJson: text('headers_json').notNull().default('{}'),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  status: text('status').notNull().default('untested'),
  ...timestamps,
})

export const models = sqliteTable(
  'models',
  {
    id: text('id').primaryKey(),
    providerId: text('provider_id')
      .notNull()
      .references(() => modelProviders.id, { onDelete: 'cascade' }),
    name: text('name'),
    reasoning: integer('reasoning', { mode: 'boolean' }).notNull().default(false),
    inputJson: text('input_json').notNull().default('["text"]'),
    contextWindow: integer('context_window'),
    maxTokens: integer('max_tokens'),
  },
  (table) => [index('models_provider_idx').on(table.providerId)],
)

export const packages = sqliteTable('packages', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  source: text('source').notNull(),
  type: text('type').notNull(),
  version: text('version').notNull(),
  scope: text('scope').notNull().default('global'),
  author: text('author').notNull().default(''),
  description: text('description').notNull().default(''),
  downloads: text('downloads').notNull().default('0'),
  resourcesJson: text('resources_json').notNull().default('{}'),
  hasExtensions: integer('has_extensions', { mode: 'boolean' }).notNull().default(false),
  status: text('status').notNull().default('installed'),
  isGallery: integer('is_gallery', { mode: 'boolean' }).notNull().default(false),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
})

export const agentSkills = sqliteTable(
  'agent_skills',
  {
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    skillId: text('skill_id')
      .notNull()
      .references(() => globalSkills.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('agent_skills_agent_idx').on(table.agentId),
    index('agent_skills_skill_idx').on(table.skillId),
  ],
)

export const agentPackageSources = sqliteTable(
  'agent_package_sources',
  {
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
  },
  (table) => [
    index('agent_package_sources_agent_idx').on(table.agentId),
    index('agent_package_sources_source_idx').on(table.source),
  ],
)

export const agentExtensions = sqliteTable(
  'agent_extensions',
  {
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    extensionId: text('extension_id')
      .notNull()
      .references(() => studioExtensions.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('agent_extensions_agent_idx').on(table.agentId),
    index('agent_extensions_extension_idx').on(table.extensionId),
  ],
)

export const agentPrompts = sqliteTable(
  'agent_prompts',
  {
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    promptId: text('prompt_id')
      .notNull()
      .references(() => globalPrompts.id, { onDelete: 'cascade' }),
  },
  (table) => [index('agent_prompts_agent_idx').on(table.agentId)],
)

export const agentMcpConfigs = sqliteTable(
  'agent_mcp_configs',
  {
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    mcpConfigId: text('mcp_config_id')
      .notNull()
      .references(() => mcpConfigs.id, { onDelete: 'cascade' }),
  },
  (table) => [index('agent_mcp_configs_agent_idx').on(table.agentId)],
)

export const agentModelProviders = sqliteTable(
  'agent_model_providers',
  {
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    providerId: text('provider_id')
      .notNull()
      .references(() => modelProviders.id, { onDelete: 'cascade' }),
  },
  (table) => [index('agent_model_providers_agent_idx').on(table.agentId)],
)

export const agentModels = sqliteTable(
  'agent_models',
  {
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    modelId: text('model_id')
      .notNull()
      .references(() => models.id, { onDelete: 'cascade' }),
  },
  (table) => [index('agent_models_agent_idx').on(table.agentId)],
)

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    name: text('name'),
    filePath: text('file_path').notNull(),
    cwd: text('cwd').notNull(),
    activeNodeId: text('active_node_id'),
    lastProviderId: text('last_provider_id'),
    lastModelId: text('last_model_id'),
    lastThinkingLevel: text('last_thinking_level'),
    totalTokens: integer('total_tokens'),
    totalCost: real('total_cost'),
    ...timestamps,
  },
  (table) => [index('sessions_agent_idx').on(table.agentId)],
)

export const sessionTags = sqliteTable(
  'session_tags',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
  },
  (table) => [index('session_tags_session_idx').on(table.sessionId)],
)

export const sessionTreeNodes = sqliteTable(
  'session_tree_nodes',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    parentId: text('parent_id'),
    type: text('type').notNull(),
    role: text('role'),
    preview: text('preview').notNull(),
    label: text('label'),
    isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('tree_nodes_session_idx').on(table.sessionId),
    index('tree_nodes_parent_idx').on(table.parentId),
  ],
)

export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').references(() => sessionTreeNodes.id, {
      onDelete: 'set null',
    }),
    type: text('type').notNull(),
    role: text('role'),
    title: text('title'),
    content: text('content').notNull(),
    tokens: integer('tokens'),
    usageInputTokens: integer('usage_input_tokens'),
    usageOutputTokens: integer('usage_output_tokens'),
    usageCacheReadTokens: integer('usage_cache_read_tokens'),
    usageCacheWriteTokens: integer('usage_cache_write_tokens'),
    usageCostInput: real('usage_cost_input'),
    usageCostOutput: real('usage_cost_output'),
    usageCostCacheRead: real('usage_cost_cache_read'),
    usageCostCacheWrite: real('usage_cost_cache_write'),
    usageCostTotal: real('usage_cost_total'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('chat_messages_session_idx').on(table.sessionId)],
)

export const chatRuns = sqliteTable(
  'chat_runs',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('queued'),
    providerId: text('provider_id'),
    modelId: text('model_id'),
    thinkingLevel: text('thinking_level').notNull().default('medium'),
    cwd: text('cwd').notNull(),
    prompt: text('prompt').notNull(),
    error: text('error'),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('chat_runs_session_idx').on(table.sessionId)],
)

export const chatRunEvents = sqliteTable(
  'chat_run_events',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => chatRuns.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    payloadJson: text('payload_json').notNull().default('{}'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('chat_run_events_run_idx').on(table.runId)],
)

export const scheduledTasks = sqliteTable(
  'scheduled_tasks',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    sessionName: text('session_name'),
    prompt: text('prompt').notNull(),
    providerId: text('provider_id'),
    modelId: text('model_id'),
    thinkingLevel: text('thinking_level'),
    scheduleType: text('schedule_type').notNull(),
    intervalMinutes: integer('interval_minutes'),
    weekday: integer('weekday'),
    timeOfDay: text('time_of_day'),
    scheduledAt: text('scheduled_at'),
    cronExpression: text('cron_expression'),
    timezone: text('timezone').notNull().default('Asia/Shanghai'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    lastRunAt: text('last_run_at'),
    lastRunStatus: text('last_run_status').notNull().default('idle'),
    nextRunAt: text('next_run_at'),
    ...timestamps,
  },
  (table) => [
    index('scheduled_tasks_agent_idx').on(table.agentId),
    index('scheduled_tasks_next_run_idx').on(table.nextRunAt),
  ],
)

export const agentsRelations = relations(agents, ({ many }) => ({
  tags: many(agentTags),
  extensions: many(agentExtensions),
  skills: many(agentSkills),
  packageSources: many(agentPackageSources),
  prompts: many(agentPrompts),
  mcpConfigs: many(agentMcpConfigs),
  modelProviders: many(agentModelProviders),
  models: many(agentModels),
  sessions: many(sessions),
}))

export const providersRelations = relations(modelProviders, ({ many }) => ({
  models: many(models),
}))

export const sessionsRelations = relations(sessions, ({ many }) => ({
  messages: many(chatMessages),
  treeNodes: many(sessionTreeNodes),
  runs: many(chatRuns),
}))

import { z } from '@hono/zod-openapi'
import { isCronExpression } from '@/lib/scheduler/cron'
import { isSupportedTimeZone } from '@/lib/scheduler/timezones'

export const ErrorSchema = z.object({
  error: z.string(),
})

export const ThinkingLevelSchema = z.enum([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])

export const AgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()),
  icon: z.string().optional(),
  color: z.string(),
  defaultCwd: z.string().optional(),
  selectedPackageSources: z.array(z.string()),
  selectedSkillIds: z.array(z.string()),
  selectedPromptIds: z.array(z.string()),
  selectedProviderIds: z.array(z.string()),
  selectedModelIds: z.array(z.string()),
  defaultProviderId: z.string().optional(),
  defaultModelId: z.string().optional(),
  defaultThinkingLevel: ThinkingLevelSchema,
  sessionCount: z.number(),
  lastUsed: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const AgentInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  icon: z.string().optional(),
  tags: z.array(z.string()).default([]),
  defaultCwd: z.string().optional(),
  defaultProviderId: z.string().optional(),
  defaultModelId: z.string().optional(),
  defaultThinkingLevel: ThinkingLevelSchema.default('medium'),
})

export const AgentResourcesSchema = z.object({
  selectedPackageSources: z.array(z.string()).optional(),
  selectedSkillIds: z.array(z.string()).optional(),
  selectedPromptIds: z.array(z.string()).optional(),
  selectedProviderIds: z.array(z.string()).optional(),
  selectedModelIds: z.array(z.string()).optional(),
  defaultProviderId: z.string().optional(),
  defaultModelId: z.string().optional(),
  defaultThinkingLevel: ThinkingLevelSchema.optional(),
})

export const SkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  source: z.enum(['skills.sh', 'local', 'git', 'manual']),
  path: z.string(),
  version: z.string().optional(),
  author: z.string().optional(),
  tags: z.array(z.string()),
  installedAt: z.string(),
  updatedAt: z.string(),
  usedByAgents: z.number(),
})

export const SkillInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().default(''),
  source: z.enum(['skills.sh', 'local', 'git', 'manual']).default('manual'),
  path: z.string().min(1),
  // Selects a specific skill inside a multi-skill repo when installing from a
  // git/GitHub source, mapping to the CLI's `--skill` flag. Optional because
  // skills.sh package specs already resolve to a single skill.
  skill: z.string().optional(),
  version: z.string().optional(),
  author: z.string().optional(),
  tags: z.array(z.string()).default([]),
})

export const SkillRegistryItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  author: z.string(),
  installed: z.boolean(),
  source: z.string(),
  sourceType: z.string().optional(),
  installUrl: z.string().optional(),
  url: z.string().optional(),
  installs: z.number().optional(),
})

export const PromptSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  argumentHint: z.string().optional(),
  content: z.string(),
  path: z.string(),
  source: z.enum(['studio', 'global', 'project', 'package']),
  scope: z.enum(['global', 'project']),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  usedByAgents: z.number(),
})

export const PromptInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  argumentHint: z.string().optional(),
  content: z.string().min(1),
  path: z.string().optional(),
  source: z.enum(['studio', 'global', 'project', 'package']).default('studio'),
  scope: z.enum(['global', 'project']).default('global'),
  tags: z.array(z.string()).default([]),
})

export const ModelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  reasoning: z.boolean().optional(),
  input: z.array(z.enum(['text', 'image'])),
  contextWindow: z.number().optional(),
  maxTokens: z.number().optional(),
})

export const ModelInputSchema = z.object({
  id: z.string().min(1),
  originalId: z.string().min(1).optional(),
  name: z.string().optional(),
  reasoning: z.boolean().default(false),
  input: z.array(z.enum(['text', 'image'])).default(['text']),
  contextWindow: z.number().optional(),
  maxTokens: z.number().optional(),
})

export const ProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  api: z.enum([
    'openai-completions',
    'openai-responses',
    'anthropic-messages',
    'google-generative-ai',
  ]),
  apiKey: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  models: z.array(ModelSchema),
  isDefault: z.boolean().optional(),
  status: z.enum(['connected', 'untested', 'error']),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const ProviderInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  baseUrl: z.string().min(1),
  api: z.enum([
    'openai-completions',
    'openai-responses',
    'anthropic-messages',
    'google-generative-ai',
  ]),
  apiKey: z.string().optional(),
  headers: z.record(z.string(), z.string()).default({}),
  isDefault: z.boolean().default(false),
  status: z.enum(['connected', 'untested', 'error']).default('untested'),
})

export const ProviderTestResultSchema = z.object({
  ok: z.boolean(),
  status: z.string(),
  message: z.string(),
})

export const ModelCapabilitiesSchema = z.object({
  thinkingLevels: z.array(ThinkingLevelSchema),
  reasoning: z.boolean(),
  input: z.array(z.enum(['text', 'image'])),
  contextWindow: z.number().optional(),
  maxTokens: z.number().optional(),
})

export const PackageSchema = z.object({
  id: z.string(),
  name: z.string(),
  source: z.string(),
  type: z.enum(['npm', 'git', 'local']),
  version: z.string(),
  scope: z.enum(['global', 'project']),
  author: z.string(),
  description: z.string(),
  downloads: z.string(),
  resources: z.object({
    extensions: z.number(),
    skills: z.number(),
    prompts: z.number(),
    themes: z.number(),
  }),
  hasExtensions: z.boolean(),
  status: z.enum(['installed', 'update-available', 'pinned', 'error']),
  updatedAt: z.string(),
})

export const PackageCollectionSchema = z.object({
  installed: z.array(PackageSchema),
  gallery: z.array(PackageSchema),
})

export const PiPackageCatalogQuerySchema = z.object({
  name: z.string().trim().max(200).optional(),
  type: z.enum(['extension', 'skill', 'theme', 'prompt']).optional(),
  sort: z.enum(['downloads', 'recent', 'name']).optional(),
  page: z.coerce.number().int().positive().optional(),
})

export const PiPackageCatalogSchema = z.object({
  packages: z.array(PackageSchema),
  recentlyPublished: z.array(PackageSchema),
  page: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().positive(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
})


export const InstallPackageSchema = z.object({
  source: z.string().min(1),
  scope: z.enum(['global', 'project']).default('global'),
  cwd: z.string().optional(),
})

export const SessionSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  name: z.string().optional(),
  filePath: z.string(),
  cwd: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  messageCount: z.number(),
  firstUserMessage: z.string().optional(),
  lastMessagePreview: z.string().optional(),
  lastProviderId: z.string().optional(),
  lastModelId: z.string().optional(),
  lastThinkingLevel: ThinkingLevelSchema.optional(),
  totalTokens: z.number().optional(),
  totalCost: z.number().optional(),
  branchCount: z.number(),
  tags: z.array(z.string()),
})

export const CreateSessionSchema = z.object({
  agentId: z.string(),
  name: z.string().optional(),
  cwd: z.string().optional(),
})

export const UpdateSessionSchema = z.object({
  name: z.string().trim().min(1),
  cwd: z.string().trim().min(1),
})

export const UpdateSessionComposerSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  thinkingLevel: ThinkingLevelSchema,
})

export const ScheduledTaskSchema = z.object({
  id: z.string(),
  name: z.string(),
  agentId: z.string(),
  sessionId: z.string().optional(),
  sessionName: z.string().optional(),
  prompt: z.string(),
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  thinkingLevel: ThinkingLevelSchema.optional(),
  scheduleType: z.enum(['interval', 'weekly', 'once', 'cron']),
  intervalMinutes: z.number().int().positive().optional(),
  weekday: z.number().int().min(0).max(6).optional(),
  timeOfDay: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  scheduledAt: z.string().datetime().optional(),
  cronExpression: z.string().optional(),
  timezone: z.string(),
  enabled: z.boolean(),
  lastRunAt: z.string().optional(),
  lastRunStatus: z.enum(['idle', 'queued', 'running', 'completed', 'failed']),
  nextRunAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const ScheduledTaskInputSchema = z
  .object({
    name: z.string().trim().min(1),
    agentId: z.string().min(1),
    sessionId: z.string().min(1).nullable().optional(),
    sessionName: z.string().trim().max(200).nullable().optional(),
    prompt: z.string().trim().min(1),
    providerId: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
    thinkingLevel: ThinkingLevelSchema.optional(),
    scheduleType: z.enum(['interval', 'weekly', 'once', 'cron']),
    intervalMinutes: z.number().int().positive().optional(),
    weekday: z.number().int().min(0).max(6).optional(),
    timeOfDay: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    scheduledAt: z.string().datetime().optional(),
    cronExpression: z.string().trim().optional(),
    timezone: z
      .string()
      .min(1)
      .refine(isSupportedTimeZone, 'Use a valid IANA time zone.')
      .default('Asia/Shanghai'),
    enabled: z.boolean().default(true),
  })
  .superRefine((value, context) => {
    if (Boolean(value.providerId) !== Boolean(value.modelId)) {
      context.addIssue({
        code: 'custom',
        path: [value.providerId ? 'modelId' : 'providerId'],
        message: 'Provider and model must be selected together.',
      })
    }
    if (value.scheduleType === 'interval' && !value.intervalMinutes) {
      context.addIssue({
        code: 'custom',
        path: ['intervalMinutes'],
        message: 'Interval is required.',
      })
    }
    if (value.scheduleType === 'weekly' && (value.weekday == null || !value.timeOfDay)) {
      context.addIssue({
        code: 'custom',
        path: ['timeOfDay'],
        message: 'Weekday and time are required.',
      })
    }
    if (value.scheduleType === 'once' && !value.scheduledAt) {
      context.addIssue({ code: 'custom', path: ['scheduledAt'], message: 'Run time is required.' })
    }
    if (
      value.scheduleType === 'cron' &&
      (!value.cronExpression || !isCronExpression(value.cronExpression))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['cronExpression'],
        message: 'Use a valid five-field cron expression.',
      })
    }
  })

export const AssignToAgentSchema = z.object({
  agentId: z.string(),
  resourceId: z.string(),
  enabled: z.boolean().default(true),
  kind: z.enum(['package', 'skill', 'prompt', 'provider', 'model']),
})

export const ChatMessageSchema = z.object({
  id: z.string(),
  type: z.enum([
    'user',
    'assistant',
    'thinking',
    'tool_call',
    'tool_result',
    'bash',
    'error',
    'compaction',
  ]),
  content: z.string(),
  title: z.string().optional(),
  timestamp: z.string(),
  tokens: z.number().optional(),
  attachments: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        path: z.string(),
        size: z.number(),
        type: z.string(),
      }),
    )
    .optional(),
  usage: z
    .object({
      input: z.number(),
      output: z.number(),
      cacheRead: z.number(),
      cacheWrite: z.number(),
      cost: z
        .object({
          input: z.number().optional(),
          output: z.number().optional(),
          cacheRead: z.number().optional(),
          cacheWrite: z.number().optional(),
          total: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
})

export const SessionTreeNodeSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  type: z.string(),
  role: z.string().optional(),
  preview: z.string(),
  timestamp: z.string(),
  children: z.array(z.any()),
  label: z.string().optional(),
  isCurrent: z.boolean().optional(),
})

export const SdkSessionTreeSchema = z.object({
  roots: z.array(SessionTreeNodeSchema),
  leafId: z.string().nullable(),
})

export const SessionBranchContextSchema = z.object({
  leafId: z.string().nullable(),
  messages: z.array(ChatMessageSchema),
  model: z.object({ provider: z.string(), modelId: z.string() }).nullable(),
  thinkingLevel: z.string(),
})

export const SessionEntryActionSchema = z.object({
  entryId: z.string().min(1),
})

export const StartRunSchema = z.object({
  message: z.string().min(1),
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  thinkingLevel: ThinkingLevelSchema.default('medium'),
  /**
   * Branch anchor for edit-and-resend: the prompt is attached under this entry
   * (a new branch) instead of the current leaf. `null` branches from the session
   * root (re-editing the first message); omitted means "continue at the leaf".
   * Applied idempotently right before the prompt, so it holds even when the SDK
   * session was rebuilt after the client staged the branch.
   */
  branchParentEntryId: z.string().nullable().optional(),
})

export const RunSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  agentId: z.string(),
  status: z.string(),
  providerId: z.string().nullable(),
  modelId: z.string().nullable(),
  thinkingLevel: z.string(),
  cwd: z.string(),
  prompt: z.string(),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
})

export const StartRunResultSchema = z.object({
  status: z.enum([
    'started',
    'session-not-found',
    'agent-not-found',
    'already-running',
    'branch-failed',
  ]),
  activityId: z.string().nullable().optional(),
  runId: z.string().nullable().optional(),
})
export const AgentQueueMessageSchema = z.object({
  message: z.string().min(1),
})

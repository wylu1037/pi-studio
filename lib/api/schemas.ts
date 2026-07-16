import { z } from '@hono/zod-openapi'

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
  selectedExtensionIds: z.array(z.string()),
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
  selectedExtensionIds: z.array(z.string()).optional(),
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

export const ExtensionSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  relativePath: z.string().optional(),
  source: z.string(),
  scope: z.enum(['global', 'project']),
  origin: z.enum(['package', 'top-level']).optional(),
  enabled: z.boolean(),
  packageManaged: z.boolean(),
  canToggle: z.boolean().optional(),
  compatibility: z.enum(['web', 'partial', 'tui-only']).optional(),
  status: z
    .enum(['enabled', 'disabled', 'loaded', 'load-error', 'trust-required', 'missing'])
    .optional(),
  package: z
    .object({
      source: z.string(),
      name: z.string().optional(),
      version: z.string().optional(),
      installedPath: z.string().optional(),
    })
    .optional(),
  capabilities: z
    .object({
      tools: z.array(z.string()),
      commands: z.array(z.string()),
      shortcuts: z.array(z.string()),
      flags: z.array(z.string()),
      providers: z.array(z.string()),
      hooks: z.array(z.string()),
      ui: z.boolean(),
    })
    .optional(),
  runtime: z
    .object({
      loaded: z.boolean(),
      sessionIds: z.array(z.string()),
      lastLoadedAt: z.string().optional(),
      lastErrorAt: z.string().optional(),
    })
    .optional(),
  diagnosticCount: z.number().int().nonnegative().optional(),
  assignedAgentIds: z.array(z.string()).optional(),
  usedByAgents: z.number().int().nonnegative().optional(),
})

export const ToggleExtensionSchema = z.object({
  source: z.string().min(1),
  scope: z.enum(['global', 'project']),
  enabled: z.boolean(),
  extensionId: z.string().optional(),
  relativePath: z.string().optional(),
  cwd: z.string().optional(),
})

export const ExtensionStateSchema = z.object({
  enabled: z.boolean(),
  cwd: z.string().optional(),
})

export const ExtensionListQuerySchema = z.object({
  cwd: z.string().optional(),
  scope: z.enum(['effective', 'global', 'project']).optional(),
})

export const ExtensionWorkspaceSchema = z.object({
  path: z.string(),
  label: z.string(),
  sources: z.array(z.enum(['studio', 'agent', 'session'])),
})

export const ProjectTrustStateSchema = z.object({
  cwd: z.string(),
  requiresTrust: z.boolean(),
  trusted: z.boolean(),
  savedDecision: z.boolean().nullable(),
  options: z.array(
    z.object({
      label: z.string(),
      trusted: z.boolean(),
      updates: z.array(z.object({ path: z.string(), decision: z.boolean().nullable() })),
      savedPath: z.string().optional(),
    }),
  ),
})

export const ProjectTrustInputSchema = z.object({
  cwd: z.string(),
  decision: z.enum(['once', 'always', 'deny', 'reset']),
})

export const ExtensionDiagnosticSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  extensionPath: z.string().optional(),
  event: z.string(),
  level: z.enum(['error', 'warning', 'info']),
  message: z.string(),
  stack: z.string().optional(),
  createdAt: z.string(),
})

export const ExtensionSourceSchema = z.object({
  path: z.string(),
  content: z.string(),
})

export const ExtensionTemplateSchema = z.enum([
  'empty',
  'tool',
  'command',
  'permission-gate',
  'lifecycle',
  'context-modifier',
  'provider',
  'session-state',
])

export const CreateExtensionSchema = z.object({
  name: z.string().min(1),
  template: ExtensionTemplateSchema,
})

export const ExtensionFileSchema = z.object({
  path: z.string(),
  type: z.enum(['file', 'directory']),
  size: z.number().int().nonnegative().optional(),
})

export const ExtensionFileQuerySchema = z.object({
  cwd: z.string(),
  path: z.string(),
})

export const ExtensionFileContentSchema = z.object({
  path: z.string(),
  content: z.string(),
})

export const ExtensionValidationSchema = z.object({
  valid: z.boolean(),
  diagnostics: z.array(
    z.object({
      file: z.string().optional(),
      line: z.number().int().positive().optional(),
      column: z.number().int().positive().optional(),
      severity: z.enum(['error', 'warning']),
      code: z.string(),
      message: z.string(),
    }),
  ),
  capabilities: z.object({
    tools: z.array(z.string()),
    commands: z.array(z.string()),
    hooks: z.array(z.string()),
    providers: z.array(z.string()),
    ui: z.array(z.string()),
  }),
  checkedAt: z.string(),
})

export const ExtensionReloadSchema = z.object({
  cwd: z.string().optional(),
  sessionIds: z.array(z.string()).optional(),
  mode: z.enum(['idle-only', 'all']).default('idle-only'),
  confirmRunning: z.boolean().optional(),
})

export const ExtensionReloadResultSchema = z.object({
  sessionId: z.string(),
  status: z.enum(['reloaded', 'skipped-running', 'failed']),
  error: z.string().optional(),
})

const RuntimeToolSchema = z.object({
  name: z.string(),
  label: z.string(),
  description: z.string(),
  extensionPath: z.string(),
})

const RuntimeCommandSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  extensionPath: z.string(),
})

const RuntimeFlagSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  extensionPath: z.string(),
})

export const SessionExtensionSnapshotSchema = z.object({
  sessionId: z.string(),
  cwd: z.string(),
  running: z.boolean(),
  loadedAt: z.string(),
  extensions: z.array(
    z.object({
      path: z.string(),
      tools: z.array(RuntimeToolSchema),
      commands: z.array(RuntimeCommandSchema),
      flags: z.array(RuntimeFlagSchema),
    }),
  ),
})

export const ExtensionUiSnapshotSchema = z.object({
  interactions: z.array(
    z.object({
      id: z.string(),
      type: z.enum(['select', 'confirm', 'input', 'editor']),
      title: z.string(),
      message: z.string().optional(),
      options: z.array(z.string()).optional(),
      placeholder: z.string().optional(),
      prefill: z.string().optional(),
      createdAt: z.string(),
      expiresAt: z.string(),
    }),
  ),
  notifications: z.array(
    z.object({
      id: z.number().int(),
      message: z.string(),
      type: z.enum(['info', 'warning', 'error']),
      createdAt: z.string(),
    }),
  ),
  statuses: z.record(z.string(), z.string()),
  widgets: z.array(
    z.object({
      key: z.string(),
      content: z.array(z.string()),
      placement: z.enum(['aboveEditor', 'belowEditor']),
    }),
  ),
  title: z.string().optional(),
  workingMessage: z.string().optional(),
  workingVisible: z.boolean(),
  hiddenThinkingLabel: z.string().optional(),
  editorCommand: z
    .object({
      revision: z.number().int().nonnegative(),
      mode: z.enum(['set', 'append']),
      text: z.string(),
    })
    .optional(),
})

export const ExtensionUiResponseSchema = z.object({
  interactionId: z.string(),
  value: z.unknown().optional(),
  cancelled: z.boolean().optional(),
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

export const AssignToAgentSchema = z.object({
  agentId: z.string(),
  resourceId: z.string(),
  enabled: z.boolean().default(true),
  kind: z.enum(['extension', 'package', 'skill', 'prompt', 'provider', 'model']),
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

export const AgentSessionStateSchema = z.object({
  active: z.boolean(),
  running: z.boolean(),
  isStreaming: z.boolean(),
  isCompacting: z.boolean(),
  model: z.object({ provider: z.string(), modelId: z.string() }).nullable(),
  thinkingLevel: z.string().nullable(),
  sessionFile: z.string().nullable(),
  sdkSessionId: z.string().nullable(),
})

export const AgentQueueMessageSchema = z.object({
  message: z.string().min(1),
})

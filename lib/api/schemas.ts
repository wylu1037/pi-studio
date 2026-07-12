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
  selectedSkillIds: z.array(z.string()),
  selectedPromptIds: z.array(z.string()),
  selectedMcpConfigIds: z.array(z.string()),
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
  tags: z.array(z.string()).default([]),
  defaultCwd: z.string().optional(),
  defaultProviderId: z.string().optional(),
  defaultModelId: z.string().optional(),
  defaultThinkingLevel: ThinkingLevelSchema.default('medium'),
})

export const AgentResourcesSchema = z.object({
  selectedSkillIds: z.array(z.string()).optional(),
  selectedPromptIds: z.array(z.string()).optional(),
  selectedMcpConfigIds: z.array(z.string()).optional(),
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
  content: z.string(),
  path: z.string(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  usedByAgents: z.number(),
})

export const PromptInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  content: z.string().min(1),
  path: z.string().optional(),
  tags: z.array(z.string()).default([]),
})

export const McpSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  command: z.string(),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()),
  tags: z.array(z.string()),
  enabledGlobally: z.boolean(),
  usedByAgents: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const McpInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  tags: z.array(z.string()).default([]),
  enabledGlobally: z.boolean().default(false),
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

export const AssignToAgentSchema = z.object({
  agentId: z.string(),
  resourceId: z.string(),
  enabled: z.boolean().default(true),
  kind: z.enum(['skill', 'prompt', 'mcp', 'provider', 'model']),
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
  usage: z.object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
    cost: z.object({
      input: z.number().optional(),
      output: z.number().optional(),
      cacheRead: z.number().optional(),
      cacheWrite: z.number().optional(),
      total: z.number().optional(),
    }).optional(),
  }).optional(),
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

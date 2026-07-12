export type ThinkingLevel =
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'

export type SkillSource = 'skills.sh' | 'local' | 'git' | 'manual'

export interface GlobalSkill {
  id: string
  name: string
  description: string
  source: SkillSource
  path: string
  version?: string
  author?: string
  tags: string[]
  installedAt: string
  updatedAt: string
  usedByAgents: number
}

export interface GlobalPromptTemplate {
  id: string
  name: string
  description?: string
  content: string
  path: string
  tags: string[]
  createdAt: string
  updatedAt: string
  usedByAgents: number
}

export interface GlobalMcpConfig {
  id: string
  name: string
  description?: string
  command: string
  args: string[]
  env: Record<string, string>
  tags: string[]
  enabledGlobally: boolean
  usedByAgents: number
  createdAt: string
  updatedAt: string
}

export type ProviderApi =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-generative-ai'

export interface GlobalModel {
  id: string
  name?: string
  reasoning?: boolean
  input: Array<'text' | 'image'>
  contextWindow?: number
  maxTokens?: number
}

export interface GlobalModelProvider {
  id: string
  name: string
  baseUrl: string
  api: ProviderApi
  apiKey?: string
  headers?: Record<string, string>
  models: GlobalModel[]
  isDefault?: boolean
  status: 'connected' | 'untested' | 'error'
  createdAt: string
  updatedAt: string
}

export type PackageType = 'npm' | 'git' | 'local'
export type PackageStatus = 'installed' | 'update-available' | 'pinned' | 'error'

export interface GlobalPackage {
  id: string
  name: string
  source: string
  type: PackageType
  version: string
  scope: 'global' | 'project'
  author: string
  description: string
  downloads: string
  resources: {
    extensions: number
    skills: number
    prompts: number
    themes: number
  }
  hasExtensions: boolean
  status: PackageStatus
  updatedAt: string
}

export interface AgentProfile {
  id: string
  name: string
  description?: string
  tags: string[]
  icon?: string
  color: string
  defaultCwd?: string
  selectedSkillIds: string[]
  selectedPromptIds: string[]
  selectedMcpConfigIds: string[]
  selectedProviderIds: string[]
  selectedModelIds: string[]
  defaultProviderId?: string
  defaultModelId?: string
  defaultThinkingLevel: ThinkingLevel
  sessionCount: number
  lastUsed: string
  createdAt: string
  updatedAt: string
}

export interface AgentSessionSummary {
  id: string
  agentId: string
  name?: string
  filePath: string
  cwd: string
  createdAt: string
  updatedAt: string
  messageCount: number
  firstUserMessage?: string
  lastMessagePreview?: string
  totalTokens?: number
  totalCost?: number
  branchCount: number
  tags: string[]
}

export type TreeNodeType =
  | 'message'
  | 'model_change'
  | 'thinking_level_change'
  | 'compaction'
  | 'branch_summary'
  | 'label'

export type TreeNodeRole =
  | 'user'
  | 'assistant'
  | 'toolResult'
  | 'bashExecution'
  | 'custom'

export interface SessionTreeNode {
  id: string
  parentId: string | null
  type: TreeNodeType
  role?: TreeNodeRole
  preview: string
  timestamp: string
  children: SessionTreeNode[]
  label?: string
  isCurrent?: boolean
}

export type ChatMessageType =
  | 'user'
  | 'assistant'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'bash'
  | 'error'
  | 'compaction'

export interface ChatMessage {
  id: string
  type: ChatMessageType
  content: string
  title?: string
  timestamp: string
  tokens?: number
  usage?: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    cost?: {
      input?: number
      output?: number
      cacheRead?: number
      cacheWrite?: number
      total?: number
    }
  }
}

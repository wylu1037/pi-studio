import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { syncPiSkillLinks } from '@/lib/skills/store'
import { registerRun } from './run-registry'

interface PiModelProviderConfig {
  id: string
  name: string
  baseUrl: string
  api: string
  apiKey?: string
  headers?: Record<string, string>
  models?: Array<{
    id: string
    name?: string
    reasoning?: boolean
    input: Array<'text' | 'image'>
    contextWindow?: number
    maxTokens?: number
  }>
}

interface PiMcpConfig {
  id: string
  name: string
  description?: string
  command: string
  args: string[]
  env: Record<string, string>
}

export interface PiRunInput {
  agentId: string
  agentName: string
  runId: string
  sessionId: string
  sessionDir: string
  cwd: string
  prompt: string
  provider?: string
  providerConfig?: PiModelProviderConfig
  providerConfigs?: PiModelProviderConfig[]
  apiKey?: string
  baseUrl?: string
  model?: string
  thinkingLevel?: string
  skills: Array<{ name: string; path: string }>
  prompts: string[]
  mcpConfigs?: PiMcpConfig[]
}

export interface PiUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
  cost?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
    total?: number
  }
}

export type PiRunEvent =
  | { type: 'message_delta'; content: string; usage?: PiUsage }
  | { type: 'thinking_delta'; content: string }
  | { type: 'tool_call_delta'; content: string; title?: string }
  | { type: 'tool_result_delta'; content: string; title?: string; isError?: boolean }
  | { type: 'bash_output'; stream: 'stdout' | 'stderr'; content: string }
  | { type: 'usage'; usage: PiUsage }
  | { type: 'error'; message: string }
  | { type: 'done'; exitCode: number | null }

export async function* runPiCli(input: PiRunInput): AsyncGenerator<PiRunEvent> {
  mkdirSync(input.sessionDir, { recursive: true })
  const runtimeAgentDir = syncUserAgentDir(input)
  const provider = input.providerConfig
    ? studioProviderName(input.providerConfig.id)
    : input.provider
  const args = [
    '--mode',
    'json',
    '--print',
    '--session-id',
    input.sessionId,
    '--session-dir',
    input.sessionDir,
  ]

  if (provider) args.push('--provider', provider)
  if (input.providerConfig?.apiKey ?? input.apiKey) {
    args.push('--api-key', input.providerConfig?.apiKey ?? input.apiKey ?? '')
  }
  if (input.model) args.push('--model', input.model)
  if (input.thinkingLevel) args.push('--thinking', input.thinkingLevel)
  for (const skill of input.skills) args.push('--skill', skill.name)
  for (const prompt of input.prompts) args.push('--prompt-template', prompt)
  args.push(input.prompt)

  const child = spawn('pi', args, {
    cwd: existsSync(input.cwd) ? input.cwd : process.cwd(),
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: runtimeAgentDir,
      PI_CODING_AGENT_SESSION_DIR: input.sessionDir,
      ...providerEnv(
        provider,
        input.providerConfig?.apiKey ?? input.apiKey,
        input.providerConfig?.baseUrl ?? input.baseUrl,
      ),
    },
  })
  child.stdin.end()
  registerRun(input.runId, child)

  const queue: PiRunEvent[] = []
  let done = false
  let wake: (() => void) | null = null
  let assistantSnapshot = ''
  let thinkingSnapshot = ''
  const notify = () => {
    wake?.()
    wake = null
  }
  const push = (event: PiRunEvent) => {
    queue.push(event)
    notify()
  }

  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')

  child.stdout.on('data', (chunk: string) => {
    for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
      const parsed = parsePiJsonLine(line)
      if (parsed === null) continue
      const events = parsed ?? [{ type: 'message_delta' as const, content: `${line}\n` }]
      for (const event of events) {
      if (event.type === 'thinking_delta') {
        const delta = assistantDelta(thinkingSnapshot, event.content)
        if (!delta) continue
        thinkingSnapshot = event.content.startsWith(thinkingSnapshot)
          ? event.content
          : thinkingSnapshot + event.content
        push({ type: 'thinking_delta', content: delta })
        continue
      }
      if (event.type !== 'message_delta') {
        push(event)
        continue
      }

      const delta = assistantDelta(assistantSnapshot, event.content)
      if (!delta) {
        if (event.usage) push({ type: 'usage', usage: event.usage })
        continue
      }
      assistantSnapshot = event.content.startsWith(assistantSnapshot)
        ? event.content
        : assistantSnapshot + event.content
      push({ type: 'message_delta', content: delta, usage: event.usage })
      }
    }
  })
  child.stderr.on('data', (chunk: string) => {
    push({ type: 'bash_output', stream: 'stderr', content: chunk })
  })
  child.on('error', (error) => {
    push({ type: 'error', message: error.message })
  })
  child.on('close', (exitCode) => {
    push({ type: 'done', exitCode })
    done = true
    notify()
  })

  while (!done || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>((resolve) => {
        wake = resolve
      })
    }
    while (queue.length > 0) {
      const event = queue.shift()
      if (event) yield event
    }
  }
}

function syncUserAgentDir(input: PiRunInput) {
  const agentDir = join(homedir(), '.pi', 'agent')
  mkdirSync(agentDir, { recursive: true })
  syncPiSkillLinks(input.skills)
  syncSettingsJson(agentDir, input)
  syncMcpConfig(agentDir, input)

  const modelsJson = readJsonObject(join(agentDir, 'models.json'))
  const existingProviders = asRecord(modelsJson.providers) ?? {}
  const providers = Object.fromEntries(
    Object.entries(existingProviders).filter(
      ([name]) => !name.startsWith('pi-studio-'),
    ),
  )

  for (const providerConfig of input.providerConfigs ?? []) {
    providers[studioProviderName(providerConfig.id)] = serializeProvider(
      providerConfig,
      providerConfig.id === input.providerConfig?.id ? input.model : undefined,
    )
  }

  writeJson(join(agentDir, 'models.json'), { ...modelsJson, providers }, 0o600)
  return agentDir
}

function serializeProvider(providerConfig: PiModelProviderConfig, modelId?: string) {
  const sourceModels = providerConfig.models ?? []
  const modelIds = new Set(sourceModels.map((model) => model.id))
  const models = [...sourceModels]
  if (modelId && !modelIds.has(modelId)) {
    models.push({ id: modelId, name: modelId, input: ['text'] })
  }

  return {
    name: providerConfig.name,
    baseUrl: providerConfig.baseUrl,
    apiKey: providerConfig.apiKey,
    api: providerConfig.api,
    headers: providerConfig.headers,
    models: models.map((model) => ({
      id: model.id,
      name: model.name,
      reasoning: model.reasoning,
      input: model.input,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    })),
  }
}

function studioProviderName(providerId: string) {
  return `pi-studio-${providerId.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

function syncSettingsJson(agentDir: string, input: PiRunInput) {
  const settingsPath = join(agentDir, 'settings.json')
  const settings = readJsonObject(settingsPath)
  const provider = input.providerConfig
    ? studioProviderName(input.providerConfig.id)
    : input.provider
  const model = input.model ?? input.providerConfig?.models?.[0]?.id

  writeJson(
    settingsPath,
    {
      ...settings,
      defaultProvider: provider ?? settings.defaultProvider,
      defaultModel: model ?? settings.defaultModel,
      defaultThinkingLevel:
        input.thinkingLevel ?? settings.defaultThinkingLevel,
      skills: input.skills.map((skill) => skill.name),
      prompts: input.prompts,
      piStudioActiveAgent: {
        id: input.agentId,
        name: input.agentName,
        syncedAt: new Date().toISOString(),
      },
    },
    0o600,
  )
}

function syncMcpConfig(agentDir: string, input: PiRunInput) {
  writeJson(
    join(agentDir, 'pi-studio-mcp.json'),
    {
      agent: {
        id: input.agentId,
        name: input.agentName,
      },
      syncedAt: new Date().toISOString(),
      servers: Object.fromEntries(
        (input.mcpConfigs ?? []).map((config) => [
          config.id,
          {
            name: config.name,
            description: config.description,
            command: config.command,
            args: config.args,
            env: config.env,
          },
        ]),
      ),
    },
    0o600,
  )
}

function readJsonObject(path: string) {
  if (!existsSync(path)) return {}
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return asRecord(value) ?? {}
  } catch {
    return {}
  }
}

function writeJson(path: string, value: unknown, mode?: number) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode })
}

function parsePiJsonLine(line: string): PiRunEvent[] | null | undefined {
  try {
    const payload = JSON.parse(line) as Record<string, unknown>
    const type = String(payload.type ?? payload.event ?? '')
    const message = asRecord(payload.message)
    const assistantMessage = message?.role === 'assistant' ? message : null
    const agentMessages = Array.isArray(payload.messages)
      ? payload.messages.map(asRecord).filter(Boolean)
      : []
    const lastAssistantMessage =
      agentMessages.findLast((item) => item?.role === 'assistant') ?? null
    const errorMessage =
      String(assistantMessage?.errorMessage ?? lastAssistantMessage?.errorMessage ?? '')
    if (
      errorMessage ||
      assistantMessage?.stopReason === 'error' ||
      lastAssistantMessage?.stopReason === 'error'
    ) {
      return [{ type: 'error', message: errorMessage || line }]
    }

    const toolResult = extractToolResult(payload)
    if (toolResult) return [{ type: 'tool_result_delta', ...toolResult }]

    if (message && message.role !== 'assistant') return null

    const events: PiRunEvent[] = []

    const thinkingContent = extractThinkingContent(payload)
    if (thinkingContent) events.push({ type: 'thinking_delta', content: thinkingContent })

    for (const toolCall of extractToolCalls(payload)) {
      events.push({ type: 'tool_call_delta', ...toolCall })
    }

    const content = extractTextContent(payload)
    if (type.includes('tool') && events.length === 0) {
      events.push({ type: 'tool_call_delta', content: content || line })
    }
    if (type.includes('error')) return [{ type: 'error', message: content || line }]
    if (type === 'message_end') {
      const assistantContent = extractTextContent(
        assistantMessage ?? lastAssistantMessage,
      )
      const usage = extractUsage(assistantMessage ?? lastAssistantMessage ?? payload)
      if (assistantContent) {
        events.push({ type: 'message_delta', content: assistantContent, usage })
      } else if (usage) {
        events.push({ type: 'usage', usage })
      }
      return events.length > 0 ? events : null
    }
    if (type === 'turn_end' || type === 'agent_end') return null
    if (content) events.push({ type: 'message_delta', content })
    return events.length > 0 ? events : null
  } catch {
    return undefined
  }
}

function assistantDelta(previous: string, next: string) {
  if (!next) return ''
  if (!previous) return next
  if (next === previous) return ''
  if (next.startsWith(previous)) return next.slice(previous.length)
  return next
}

function extractContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map(extractContent).filter(Boolean).join('')
  }
  if (!value || typeof value !== 'object') return ''

  const record = value as Record<string, unknown>
  for (const key of ['content', 'text', 'delta', 'message', 'output']) {
    const content = extractContent(record[key])
    if (content) return content
  }
  if (Array.isArray(record.parts)) {
    return record.parts.map(extractContent).filter(Boolean).join('')
  }
  return ''
}

function extractTextContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map(extractTextContent).filter(Boolean).join('')
  }
  if (!value || typeof value !== 'object') return ''

  const record = value as Record<string, unknown>
  const type = String(record.type ?? '')
  if (type === 'thinking' || type === 'toolCall' || type === 'tool_call') return ''
  if (type === 'text' && typeof record.text === 'string') return record.text
  if (Array.isArray(record.content)) {
    return record.content.map(extractTextContent).filter(Boolean).join('')
  }
  if (Array.isArray(record.parts)) {
    return record.parts.map(extractTextContent).filter(Boolean).join('')
  }
  for (const key of ['text', 'delta', 'message', 'output']) {
    const content = extractTextContent(record[key])
    if (content) return content
  }
  return ''
}

function extractThinkingContent(value: unknown): string {
  if (!value || typeof value !== 'object') return ''

  if (Array.isArray(value)) {
    return value.map(extractThinkingContent).filter(Boolean).join('')
  }

  const record = value as Record<string, unknown>
  if (record.type === 'thinking' && typeof record.thinking === 'string') {
    return record.thinking
  }

  for (const key of ['thinking', 'reasoning', 'reasoningContent', 'reasoning_content']) {
    if (typeof record[key] === 'string') return record[key]
  }

  if (Array.isArray(record.content)) {
    return record.content.map(extractThinkingContent).filter(Boolean).join('')
  }
  if (Array.isArray(record.parts)) {
    return record.parts.map(extractThinkingContent).filter(Boolean).join('')
  }
  return extractThinkingContent(record.message)
}

function extractToolCalls(value: unknown): Array<{ content: string; title?: string }> {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(extractToolCalls)

  const record = value as Record<string, unknown>
  const type = String(record.type ?? '')
  const calls: Array<{ content: string; title?: string }> = []
  if (type === 'toolCall' || type === 'tool_call') {
    const title = stringValue(record.toolName) ?? stringValue(record.name) ?? stringValue(record.tool)
    const input = record.input ?? record.args ?? record.arguments ?? {}
    calls.push({
      title,
      content: formatToolPayload(title, input),
    })
  }

  for (const key of ['content', 'parts', 'messages']) {
    const nested = record[key]
    if (Array.isArray(nested)) calls.push(...nested.flatMap(extractToolCalls))
  }
  if (record.message) calls.push(...extractToolCalls(record.message))
  return calls
}

function extractToolResult(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const message = asRecord(record.message) ?? record
  const role = String(message.role ?? '')
  if (role !== 'toolResult' && role !== 'tool_result') return null

  const title =
    stringValue(message.toolName) ??
    stringValue(message.name) ??
    stringValue(message.tool) ??
    'Tool result'
  const content = extractTextContent(message.content) || extractContent(message.content) || ''
  return {
    title,
    content: content || JSON.stringify(message, null, 2),
    isError: Boolean(message.isError),
  }
}

function extractUsage(value: unknown): PiUsage | undefined {
  const record = asRecord(value)
  const usage = asRecord(record?.usage)
  if (!usage) return undefined

  const input = numberValue(usage.input)
  const output = numberValue(usage.output)
  const cacheRead = numberValue(usage.cacheRead)
  const cacheWrite = numberValue(usage.cacheWrite)
  const totalTokens = numberValue(usage.totalTokens) || input + output
  const cost = asRecord(usage.cost)

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens,
    cost: cost
      ? {
          input: numberValue(cost.input),
          output: numberValue(cost.output),
          cacheRead: numberValue(cost.cacheRead),
          cacheWrite: numberValue(cost.cacheWrite),
          total: numberValue(cost.total),
        }
      : undefined,
  }
}

function formatToolPayload(title: string | undefined, input: unknown) {
  const body =
    input && typeof input === 'object'
      ? JSON.stringify(input, null, 2)
      : String(input ?? '')
  return title ? `${title}\n${body}` : body
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function asRecord(value: unknown) {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null
}

function providerEnv(provider?: string, apiKey?: string, baseUrl?: string) {
  const env: Record<string, string> = {}
  if (!apiKey && !baseUrl) return env

  if (provider === 'anthropic') {
    if (apiKey) env.ANTHROPIC_API_KEY = apiKey
    if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl
  } else if (provider === 'google') {
    if (apiKey) env.GEMINI_API_KEY = apiKey
    if (apiKey) env.GOOGLE_GENERATIVE_AI_API_KEY = apiKey
    if (baseUrl) env.GOOGLE_GENERATIVE_AI_BASE_URL = baseUrl
  } else if (provider === 'openai') {
    if (apiKey) env.OPENAI_API_KEY = apiKey
    if (baseUrl) env.OPENAI_BASE_URL = baseUrl
  }

  return env
}

export function defaultPiSessionDir() {
  return join(process.cwd(), 'data', 'pi-sessions')
}

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
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
  apiKey?: string
  baseUrl?: string
  model?: string
  thinkingLevel?: string
  skills: string[]
  prompts: string[]
  mcpConfigs?: PiMcpConfig[]
}

export type PiRunEvent =
  | { type: 'message_delta'; content: string }
  | { type: 'thinking_delta'; content: string }
  | { type: 'tool_call_delta'; content: string }
  | { type: 'bash_output'; stream: 'stdout' | 'stderr'; content: string }
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
  for (const skill of input.skills) args.push('--skill', skill)
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
      const event = parsed ?? { type: 'message_delta' as const, content: `${line}\n` }
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
      if (!delta) continue
      assistantSnapshot = event.content.startsWith(assistantSnapshot)
        ? event.content
        : assistantSnapshot + event.content
      push({ type: 'message_delta', content: delta })
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
  syncSettingsJson(agentDir, input)
  syncMcpConfig(agentDir, input)
  if (!input.providerConfig) return agentDir

  const providerName = studioProviderName(input.providerConfig.id)
  const sourceModels = input.providerConfig.models ?? []
  const modelIds = new Set(sourceModels.map((model) => model.id))
  const models = [...sourceModels]
  if (input.model && !modelIds.has(input.model)) {
    models.push({ id: input.model, name: input.model, input: ['text'] })
  }
  const modelsJson = readJsonObject(join(agentDir, 'models.json'))
  const existingProviders = asRecord(modelsJson.providers) ?? {}
  const providers = Object.fromEntries(
    Object.entries(existingProviders).filter(
      ([name]) => !name.startsWith('pi-studio-'),
    ),
  )
  providers[providerName] = {
    name: input.providerConfig.name,
    baseUrl: input.providerConfig.baseUrl,
    apiKey: input.providerConfig.apiKey,
    api: input.providerConfig.api,
    headers: input.providerConfig.headers,
    models: models.map((model) => ({
      id: model.id,
      name: model.name,
      reasoning: model.reasoning,
      input: model.input,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    })),
  }
  writeJson(join(agentDir, 'models.json'), { ...modelsJson, providers }, 0o600)
  return agentDir
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
      skills: input.skills,
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

function parsePiJsonLine(line: string): PiRunEvent | null | undefined {
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
      return { type: 'error', message: errorMessage || line }
    }
    if (message && message.role !== 'assistant') return null

    const thinkingContent = extractThinkingContent(payload)
    if (thinkingContent) return { type: 'thinking_delta', content: thinkingContent }

    const content = extractContent(payload)
    if (type.includes('tool')) return { type: 'tool_call_delta', content: content || line }
    if (type.includes('error')) return { type: 'error', message: content || line }
    if (type === 'message_end') {
      const assistantContent = extractContent(
        assistantMessage ?? lastAssistantMessage,
      )
      return assistantContent
        ? { type: 'message_delta', content: assistantContent }
        : null
    }
    if (type === 'turn_end' || type === 'agent_end') return null
    return content ? { type: 'message_delta', content } : null
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

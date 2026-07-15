import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { piAgentDir, syncPiSkillLinks } from '@/lib/skills/store'
import { updateSessionFilePath } from '@/lib/db/repository'
import { resolvePiProviderConnection } from '@/lib/models/provider-connection'
import { piStudioDataDir } from '@/lib/runtime/paths'
import type { GlobalModelProvider } from '@/lib/types'
import { parseSdkEvent, type PiRunEvent } from './pi-events'
import { registerRun, unregisterRun } from './run-registry'

export type { PiUsage } from './pi-events'

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
  sessionFile?: string
  cwd: string
  prompt: string
  provider?: string
  providerConfig?: PiModelProviderConfig
  providerConfigs?: PiModelProviderConfig[]
  apiKey?: string
  baseUrl?: string
  model?: string
  thinkingLevel?: string
  extensions: Array<{ id: string; path: string }>
  skills: Array<{ name: string; path: string }>
  prompts: string[]
  packagePaths: string[]
  mcpConfigs?: PiMcpConfig[]
}

export async function* runPiCli(input: PiRunInput): AsyncGenerator<PiRunEvent> {
  const { getOrCreateSdkSession } = await import('./sdk-session-manager')
  mkdirSync(input.sessionDir, { recursive: true })
  const agentDir = syncAgentRuntime(input)
  const provider = input.providerConfig
    ? studioProviderName(input.providerConfig.id)
    : input.provider
  const modelRuntimeSignature = createModelRuntimeSignature(input.providerConfigs ?? [])
  const session = await getOrCreateSdkSession({
    studioSessionId: input.sessionId,
    sessionFile: input.sessionFile,
    sessionDir: input.sessionDir,
    cwd: existsSync(input.cwd) ? input.cwd : process.cwd(),
    agentDir,
    modelProvider: provider,
    modelId: input.model,
    modelRuntimeSignature,
    thinkingLevel: input.thinkingLevel,
    extensionPaths: input.extensions.map((extension) => extension.path),
    promptPaths: input.prompts,
  })
  if (session.inner.sessionFile) {
    updateSessionFilePath(input.sessionId, session.inner.sessionFile)
  }

  if (provider && input.model) {
    const model = session.inner.modelRegistry.find(provider, input.model)
    if (!model) {
      throw new Error(`Configured model not found in SDK registry: ${provider} / ${input.model}`)
    }
    if (session.inner.model?.provider !== model.provider || session.inner.model?.id !== model.id) {
      await session.inner.setModel(model)
    }
  }
  if (input.thinkingLevel && input.thinkingLevel !== 'auto') {
    session.inner.setThinkingLevel(input.thinkingLevel as never)
  }

  const queue: PiRunEvent[] = []
  let done = false
  let wake: (() => void) | null = null
  const notify = () => {
    wake?.()
    wake = null
  }
  const push = (event: PiRunEvent) => {
    queue.push(event)
    notify()
  }

  const unsubscribe = session.subscribe((sdkEvent) => {
    const events = parseSdkEvent(sdkEvent)
    for (const event of events) {
      push(event)
    }
  })
  registerRun(input.runId, () => session.inner.abort())

  void session.inner
    .prompt(input.prompt, { source: 'rpc' })
    .then(() => push({ type: 'done', exitCode: 0 }))
    .catch((error: unknown) => {
      push({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
      push({ type: 'done', exitCode: 1 })
    })
    .finally(() => {
      done = true
      unregisterRun(input.runId)
      unsubscribe()
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

export function createModelRuntimeSignature(providerConfigs: PiModelProviderConfig[]) {
  const normalized = providerConfigs
    .map((provider) => ({
      ...provider,
      headers: sortRecord(provider.headers),
      models: [...(provider.models ?? [])].sort((left, right) => left.id.localeCompare(right.id)),
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}

function sortRecord(value: Record<string, string> | undefined) {
  if (!value) return undefined
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  )
}

export function syncAgentRuntime(input: PiRunInput) {
  const agentDir = piAgentDir()
  mkdirSync(agentDir, { recursive: true })
  syncPiSkillLinks(input.skills, join(agentDir, 'skills'))
  syncSettingsJson(agentDir, input)
  syncMcpConfig(agentDir, input)

  const modelsJson = readJsonObject(join(agentDir, 'models.json'))
  const existingProviders = asRecord(modelsJson.providers) ?? {}
  const providers = Object.fromEntries(
    Object.entries(existingProviders).filter(([name]) => !name.startsWith('pi-studio-')),
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
  const connection = resolvePiProviderConnection({
    baseUrl: providerConfig.baseUrl,
    api: providerConfig.api as GlobalModelProvider['api'],
    apiKey: providerConfig.apiKey,
    headers: providerConfig.headers,
  })
  const sourceModels = providerConfig.models ?? []
  const modelIds = new Set(sourceModels.map((model) => model.id))
  const models = [...sourceModels]
  if (modelId && !modelIds.has(modelId)) {
    models.push({ id: modelId, name: modelId, input: ['text'] })
  }

  return {
    name: providerConfig.name,
    baseUrl: connection.baseUrl,
    apiKey: connection.apiKey,
    api: providerConfig.api,
    headers: connection.headers,
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
      defaultThinkingLevel: input.thinkingLevel ?? settings.defaultThinkingLevel,
      skills: input.skills.map((skill) => skill.name),
      prompts: input.prompts,
      packages: input.packagePaths,
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

function asRecord(value: unknown) {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

export function defaultPiSessionDir() {
  return join(piStudioDataDir(), 'pi-sessions')
}

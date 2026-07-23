import { existsSync, mkdirSync } from 'node:fs'
import {
  createModelRuntimeSignature,
  defaultPiSessionDir,
  syncAgentRuntime,
} from '@/lib/chat/pi-adapter'
import { getSession, resolveAgentRunConfig, updateSessionFilePath } from '@/lib/db/repository'

import type { RunActivityStatus } from '@/lib/chat/session-run-controller'

export type StartSessionPromptResult =
  | { status: 'started'; activityId: string; runId: string; completion: Promise<RunActivityStatus> }
  | { status: 'session-not-found' }
  | { status: 'agent-not-found' }
  | { status: 'already-running' }

/**
 * Prepare a session (runtime sync, model selection) and start a prompt through
 * the session's run controller. This owns everything that must happen *before*
 * `controller.prompt()` — the controller itself assumes the session is already
 * in the right shape and only manages the activity/run lifecycle and event stream.
 *
 * Replaces the old `startRunExecution` → `runPiCli` → `inner.prompt` indirection.
 */
export async function startSessionPrompt(input: {
  sessionId: string
  prompt: string
  providerId?: string
  modelId?: string
  thinkingLevel?: string
}): Promise<StartSessionPromptResult> {
  const session = getSession(input.sessionId)
  if (!session) return { status: 'session-not-found' }

  const config = resolveAgentRunConfig(session.agentId, input.providerId)
  if (!config) return { status: 'agent-not-found' }

  const sessionDir = defaultPiSessionDir()
  mkdirSync(sessionDir, { recursive: true })

  const provider = piProviderName(config.provider?.api)
  const model = input.modelId ?? config.agent.defaultModelId ?? undefined
  const thinkingLevel = input.thinkingLevel ?? session.lastThinkingLevel ?? 'medium'
  const cwd = existsSync(session.cwd) ? session.cwd : process.cwd()

  // Runtime sync writes settings.json / models.json / MCP config for the agent dir.
  const agentDir = syncAgentRuntime({
    agentId: config.agent.id,
    agentName: config.agent.name,
    runId: 'session-prompt',
    sessionId: input.sessionId,
    sessionDir,
    sessionFile: session.filePath,
    cwd,
    prompt: input.prompt,
    provider,
    providerConfig: config.provider ?? undefined,
    providerConfigs: config.providers ?? [],
    apiKey: config.provider?.apiKey ?? undefined,
    baseUrl: config.provider?.baseUrl ?? undefined,
    model,
    thinkingLevel,
    extensions: config.extensions.map((extension) => ({ id: extension.id, path: extension.path })),
    skills: config.skills.map((skill) => ({ name: skill.name, path: skill.path })),
    prompts: config.prompts.map((prompt) => prompt.path),
    packagePaths: config.packagePaths,
    mcpConfigs: (config.mcpConfigs ?? []).map((mcp) => ({
      id: mcp.id,
      name: mcp.name,
      description: mcp.description,
      command: mcp.command,
      args: mcp.args,
      env: mcp.env,
    })),
  })

  const storedProvider = config.provider ? studioProviderName(config.provider.id) : provider
  const modelRuntimeSignature = createModelRuntimeSignature(config.providers ?? [])

  const { getOrCreateSdkSession } = await import('./sdk-session-manager')
  const studioSession = await getOrCreateSdkSession({
    studioSessionId: input.sessionId,
    sessionFile: session.filePath,
    sessionDir,
    cwd,
    agentDir,
    modelProvider: storedProvider,
    modelId: model,
    modelRuntimeSignature,
    thinkingLevel,
    extensionPaths: config.extensions.map((extension) => extension.path),
    promptPaths: config.prompts.map((prompt) => prompt.path),
  })

  if (studioSession.inner.sessionFile) {
    updateSessionFilePath(input.sessionId, studioSession.inner.sessionFile)
  }

  // A session can only run one activity at a time.
  if (studioSession.runController.getSnapshot().running) {
    return { status: 'already-running' }
  }

  if (storedProvider && model) {
    const resolved = studioSession.inner.modelRegistry.find(storedProvider, model)
    if (!resolved) {
      throw new Error(`Configured model not found in SDK registry: ${storedProvider} / ${model}`)
    }
    if (
      studioSession.inner.model?.provider !== resolved.provider ||
      studioSession.inner.model?.id !== resolved.id
    ) {
      await studioSession.inner.setModel(resolved)
    }
  }
  if (thinkingLevel && thinkingLevel !== 'auto') {
    studioSession.inner.setThinkingLevel(thinkingLevel as never)
  }

  const { activityId, runId, completion } = studioSession.runController.prompt(input.prompt, {
    agentId: config.agent.id,
    providerId: input.providerId,
    modelId: model,
    thinkingLevel,
    cwd,
  })

  return { status: 'started', activityId, runId, completion }
}

function piProviderName(api?: string | null) {
  if (!api) return undefined
  if (api.startsWith('anthropic')) return 'anthropic'
  if (api.startsWith('google')) return 'google'
  if (api.startsWith('openai')) return 'openai'
  return undefined
}

function studioProviderName(providerId: string) {
  return `pi-studio-${providerId.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

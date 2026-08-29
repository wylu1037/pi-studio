import { existsSync, statSync } from 'node:fs'
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  SettingsManager,
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
} from '@earendil-works/pi-coding-agent'
import { registerPiStudioApiProviders } from '@/lib/models/pi-ai'
import { createPiRunEventParser, type PiRunEvent } from './pi-events'
import {
  disposeSessionRunController,
  getSessionRunController,
  type SessionRunController,
} from './session-run-controller'

type Listener = (event: AgentSessionEvent) => void
type PiEventListener = (event: PiRunEvent) => void

class StudioAgentSession {
  private listeners = new Set<Listener>()
  private piEventListeners = new Set<PiEventListener>()
  private readonly parsePiEvent: ReturnType<typeof createPiRunEventParser>
  private unsubscribe: (() => void) | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private alive = true
  readonly runController: SessionRunController

  constructor(
    readonly key: string,
    readonly inner: AgentSession,
    resourceSignature: string,
    readonly cwd: string,
    readonly agentDir: string,
    readonly promptPaths: string[],
    readonly modelRuntimeSignature: string,
  ) {
    this.resourceSignature = resourceSignature
    this.parsePiEvent = createPiRunEventParser({ runId: `session:${key}` })
    // The controller lives in a session-scoped registry that outlives this SDK
    // session; bind the live inner session to it for the session's lifetime.
    this.runController = getSessionRunController(key)
    this.runController.bind(inner)
    this.unsubscribe = inner.subscribe((event) => {
      this.touch()
      for (const listener of this.listeners) listener(event)
      for (const piEvent of this.parsePiEvent(event)) {
        // Feed each parsed event through the controller: it keeps the running
        // truth in step and forwards the event onto the unified frame stream
        // that the session SSE endpoint subscribes to.
        this.runController.ingest(piEvent)
        for (const listener of this.piEventListeners) listener(piEvent)
      }
    })
    this.touch()
  }

  resourceSignature: string

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    this.touch()
    return () => this.listeners.delete(listener)
  }

  subscribePiEvents(listener: PiEventListener) {
    this.piEventListeners.add(listener)
    this.touch()
    return () => this.piEventListeners.delete(listener)
  }

  isAlive() {
    return this.alive
  }

  touch() {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.destroy(), 10 * 60 * 1000)
  }

  destroy() {
    if (!this.alive) return
    this.alive = false
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.unsubscribe?.()
    this.runController.unbind()
    this.inner.dispose()
    this.listeners.clear()
    this.piEventListeners.clear()
    sessions().delete(this.key)
  }
}

declare global {
  var __piStudioSdkSessions: Map<string, StudioAgentSession> | undefined
  var __piStudioSdkSessionLocks: Map<string, Promise<StudioAgentSession>> | undefined
  var __piStudioPendingBranches: Map<string, string> | undefined
}

function sessions() {
  globalThis.__piStudioSdkSessions ??= new Map()
  return globalThis.__piStudioSdkSessions
}

function locks() {
  globalThis.__piStudioSdkSessionLocks ??= new Map()
  return globalThis.__piStudioSdkSessionLocks
}

function pendingBranches() {
  globalThis.__piStudioPendingBranches ??= new Map()
  return globalThis.__piStudioPendingBranches
}

export async function getOrCreateSdkSession(input: {
  studioSessionId: string
  sessionFile?: string
  sessionDir: string
  cwd: string
  agentDir: string
  modelProvider?: string
  modelId?: string
  modelRuntimeSignature?: string
  thinkingLevel?: string
  promptPaths?: string[]
}) {
  const resourceSignature = await createResourceSignature(
    input.cwd,
    input.promptPaths ?? [],
    input.agentDir,
    input.modelRuntimeSignature ?? '',
  )
  const existing = sessions().get(input.studioSessionId)
  if (existing?.isAlive() && existing.resourceSignature === resourceSignature) {
    existing.touch()
    return existing
  }
  if (existing?.isAlive()) existing.destroy()

  const inflight = locks().get(input.studioSessionId)
  if (inflight) return inflight

  const starting = (async () => {
    const sessionManager =
      input.sessionFile && existsSync(input.sessionFile)
        ? SessionManager.open(input.sessionFile, input.sessionDir)
        : SessionManager.create(input.cwd, input.sessionDir)
    const settingsManager = SettingsManager.create(input.cwd, input.agentDir)
    const services = await createAgentSessionServices({
      cwd: input.cwd,
      agentDir: input.agentDir,
      settingsManager,
      resourceLoaderOptions: {
        noExtensions: true,
        additionalPromptTemplatePaths: input.promptPaths ?? [],
        promptsOverride: (base) => {
          const selected = new Set(input.promptPaths ?? [])
          return {
            prompts: base.prompts.filter((prompt) => selected.has(prompt.filePath)),
            diagnostics: base.diagnostics,
          }
        },
      },
    })
    registerPiStudioApiProviders()
    const model =
      input.modelProvider && input.modelId
        ? services.modelRuntime.getModel(input.modelProvider, input.modelId)
        : undefined
    if (input.modelProvider && input.modelId && !model) {
      throw new Error(
        `Configured model not found in SDK registry: ${input.modelProvider} / ${input.modelId}`,
      )
    }
    const { session } = await createAgentSessionFromServices({
      services,
      sessionManager,
      ...(model ? { model } : {}),
      ...(input.thinkingLevel && input.thinkingLevel !== 'auto'
        ? { thinkingLevel: input.thinkingLevel as never }
        : {}),
    })
    const pendingBranch = pendingBranches().get(input.studioSessionId)
    if (pendingBranch) {
      await session.navigateTree(pendingBranch, {})
      pendingBranches().delete(input.studioSessionId)
    }
    const wrapped = new StudioAgentSession(
      input.studioSessionId,
      session,
      resourceSignature,
      input.cwd,
      input.agentDir,
      input.promptPaths ?? [],
      input.modelRuntimeSignature ?? '',
    )
    sessions().set(input.studioSessionId, wrapped)
    return wrapped
  })().finally(() => locks().delete(input.studioSessionId))

  locks().set(input.studioSessionId, starting)
  return starting
}

async function createResourceSignature(
  cwd: string,
  promptPaths: string[],
  agentDir: string,
  modelRuntimeSignature = '',
) {
  const files = [...promptPaths].sort().map((path) => {
    try {
      return [path, statSync(path).mtimeMs]
    } catch {
      return [path, 0]
    }
  })
  const settings = SettingsManager.create(cwd, agentDir)
  return JSON.stringify({
    files,
    globalPackages: settings.getGlobalSettings().packages ?? [],
    projectPackages: settings.getProjectSettings().packages ?? [],
    modelRuntimeSignature,
  })
}

function getSdkSession(studioSessionId: string) {
  const session = sessions().get(studioSessionId)
  return session?.isAlive() ? session : null
}

export { disposeSessionRunController }

export function disposeSdkSession(studioSessionId: string) {
  if (locks().has(studioSessionId)) return { status: 'running' as const }

  const session = getSdkSession(studioSessionId)
  if (session && (session.inner.isStreaming || !session.inner.isIdle)) {
    return { status: 'running' as const }
  }

  session?.destroy()
  pendingBranches().delete(studioSessionId)
  return { status: 'disposed' as const }
}

export async function steerSdkSession(studioSessionId: string, message: string) {
  const session = getSdkSession(studioSessionId)
  if (!session) return false
  return session.runController.steer(message)
}

export async function followUpSdkSession(studioSessionId: string, message: string) {
  const session = getSdkSession(studioSessionId)
  if (!session) return false
  return session.runController.followUp(message)
}

export async function abortSdkSession(studioSessionId: string) {
  const session = getSdkSession(studioSessionId)
  if (!session) return false
  return session.runController.abort()
}

export async function reloadSdkSessions(input: {
  cwd?: string
  sessionIds?: string[]
  mode: 'idle-only' | 'all'
  confirmRunning?: boolean
}) {
  const selected = new Set(input.sessionIds ?? [])
  const results: Array<{
    sessionId: string
    status: 'reloaded' | 'skipped-running' | 'failed'
    error?: string
  }> = []
  for (const session of [...sessions().values()]) {
    if (!session.isAlive()) continue
    if (input.cwd && session.cwd !== input.cwd) continue
    if (selected.size > 0 && !selected.has(session.key)) continue
    const running = session.inner.isStreaming || !session.inner.isIdle
    if (running && (input.mode !== 'all' || !input.confirmRunning)) {
      results.push({ sessionId: session.key, status: 'skipped-running' })
      continue
    }
    try {
      if (running) await session.inner.abort()
      await session.inner.reload({ beforeSessionStart: () => session.touch() })
      session.resourceSignature = await createResourceSignature(
        session.cwd,
        session.promptPaths,
        session.agentDir,
        session.modelRuntimeSignature,
      )
      results.push({ sessionId: session.key, status: 'reloaded' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Session reload failed.'
      results.push({ sessionId: session.key, status: 'failed', error: message })
    }
  }
  return results
}

export async function selectSdkBranch(studioSessionId: string, entryId: string) {
  const session = getSdkSession(studioSessionId)
  if (session) {
    if (!session.inner.isIdle) return false
    const result = await session.inner.navigateTree(entryId, {})
    return !result.cancelled
  }
  pendingBranches().set(studioSessionId, entryId)
  return true
}

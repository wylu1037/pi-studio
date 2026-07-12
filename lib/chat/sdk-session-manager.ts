import { existsSync } from 'node:fs'
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  getAgentDir,
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
} from '@earendil-works/pi-coding-agent'

type Listener = (event: AgentSessionEvent) => void

class StudioAgentSession {
  private listeners = new Set<Listener>()
  private unsubscribe: (() => void) | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private alive = true

  constructor(
    readonly key: string,
    readonly inner: AgentSession,
  ) {
    this.unsubscribe = inner.subscribe((event) => {
      this.touch()
      for (const listener of this.listeners) listener(event)
    })
    this.touch()
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    this.touch()
    return () => this.listeners.delete(listener)
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
    this.inner.dispose()
    this.listeners.clear()
    sessions().delete(this.key)
  }
}

declare global {
  var __piStudioSdkSessions: Map<string, StudioAgentSession> | undefined
  var __piStudioSdkSessionLocks:
    | Map<string, Promise<StudioAgentSession>>
    | undefined
}

function sessions() {
  globalThis.__piStudioSdkSessions ??= new Map()
  return globalThis.__piStudioSdkSessions
}

function locks() {
  globalThis.__piStudioSdkSessionLocks ??= new Map()
  return globalThis.__piStudioSdkSessionLocks
}

export async function getOrCreateSdkSession(input: {
  studioSessionId: string
  sessionFile?: string
  sessionDir: string
  cwd: string
  modelProvider?: string
  modelId?: string
  thinkingLevel?: string
}) {
  const existing = sessions().get(input.studioSessionId)
  if (existing?.isAlive()) {
    existing.touch()
    return existing
  }

  const inflight = locks().get(input.studioSessionId)
  if (inflight) return inflight

  const starting = (async () => {
    const sessionManager =
      input.sessionFile && existsSync(input.sessionFile)
        ? SessionManager.open(input.sessionFile, input.sessionDir)
        : SessionManager.create(input.cwd, input.sessionDir)
    const services = await createAgentSessionServices({
      cwd: input.cwd,
      agentDir: getAgentDir(),
    })
    const model =
      input.modelProvider && input.modelId
        ? services.modelRegistry.find(input.modelProvider, input.modelId)
        : undefined
    const { session } = await createAgentSessionFromServices({
      services,
      sessionManager,
      ...(model ? { model } : {}),
      ...(input.thinkingLevel && input.thinkingLevel !== 'auto'
        ? { thinkingLevel: input.thinkingLevel as never }
        : {}),
    })
    try {
      await session.bindExtensions({
        mode: 'rpc',
        onError: (error) => {
          console.error(
            `[pi-studio] extension error in ${error.extensionPath} (${error.event}): ${error.error}`,
          )
        },
      })
    } catch (error) {
      console.error(
        '[pi-studio] unable to bind session extensions:',
        error instanceof Error ? error.message : error,
      )
    }
    const wrapped = new StudioAgentSession(input.studioSessionId, session)
    sessions().set(input.studioSessionId, wrapped)
    return wrapped
  })().finally(() => locks().delete(input.studioSessionId))

  locks().set(input.studioSessionId, starting)
  return starting
}

export function getSdkSession(studioSessionId: string) {
  const session = sessions().get(studioSessionId)
  return session?.isAlive() ? session : null
}

export function getSdkSessionState(studioSessionId: string) {
  const session = getSdkSession(studioSessionId)
  if (!session) return null
  return {
    running: session.inner.isStreaming || !session.inner.isIdle,
    isStreaming: session.inner.isStreaming,
    isCompacting: session.inner.isCompacting,
    model: session.inner.model
      ? { provider: session.inner.model.provider, modelId: session.inner.model.id }
      : null,
    thinkingLevel: session.inner.thinkingLevel,
    sessionFile: session.inner.sessionFile ?? null,
    sessionId: session.inner.sessionId,
  }
}

export async function steerSdkSession(studioSessionId: string, message: string) {
  const session = getSdkSession(studioSessionId)
  if (!session) return false
  await session.inner.steer(message)
  return true
}

export async function followUpSdkSession(studioSessionId: string, message: string) {
  const session = getSdkSession(studioSessionId)
  if (!session) return false
  await session.inner.followUp(message)
  return true
}

export function disposeAllSdkSessions() {
  for (const session of [...sessions().values()]) session.destroy()
}

import { existsSync, statSync } from 'node:fs'
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  getAgentDir,
  SettingsManager,
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
  type ExtensionError,
} from '@earendil-works/pi-coding-agent'
import { registerPiStudioApiProviders } from '@/lib/models/pi-ai'
import { isProjectTrusted } from '@/lib/extensions/project-trust'
import { logger } from '@/lib/runtime/logger'
import { createPiRunEventParser, type PiRunEvent } from './pi-events'
import { getSessionRunController, type SessionRunController } from './session-run-controller'
import {
  disposeExtensionUiBroker,
  getExtensionUiBroker,
  getOrCreateExtensionUiBroker,
} from './extension-ui-broker'

type Listener = (event: AgentSessionEvent) => void
type PiEventListener = (event: PiRunEvent) => void

export interface SdkExtensionDiagnostic {
  id: string
  sessionId: string
  extensionPath?: string
  event: string
  level: 'error' | 'warning' | 'info'
  message: string
  stack?: string
  createdAt: string
}

class StudioAgentSession {
  private listeners = new Set<Listener>()
  private piEventListeners = new Set<PiEventListener>()
  private readonly parsePiEvent: ReturnType<typeof createPiRunEventParser>
  private unsubscribe: (() => void) | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private alive = true
  private diagnostics: SdkExtensionDiagnostic[] = []
  readonly runController: SessionRunController

  constructor(
    readonly key: string,
    readonly inner: AgentSession,
    resourceSignature: string,
    readonly cwd: string,
    readonly agentDir: string,
    readonly extensionPaths: string[],
    readonly promptPaths: string[],
    readonly modelRuntimeSignature: string,
    diagnostics: SdkExtensionDiagnostic[] = [],
  ) {
    this.resourceSignature = resourceSignature
    this.diagnostics = diagnostics.slice(-200)
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

  recordDiagnostic(diagnostic: Omit<SdkExtensionDiagnostic, 'id' | 'sessionId' | 'createdAt'>) {
    this.diagnostics.push({
      ...diagnostic,
      id: `${this.key}:${Date.now()}:${this.diagnostics.length}`,
      sessionId: this.key,
      createdAt: new Date().toISOString(),
    })
    if (this.diagnostics.length > 200) this.diagnostics.splice(0, this.diagnostics.length - 200)
  }

  getDiagnostics() {
    return [...this.diagnostics]
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
    disposeExtensionUiBroker(this.key)
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
  extensionPaths?: string[]
  promptPaths?: string[]
}) {
  const resourceSignature = await createResourceSignature(
    input.cwd,
    input.extensionPaths ?? [],
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
    const settingsManager = SettingsManager.create(input.cwd, input.agentDir, {
      projectTrusted: isProjectTrusted(input.cwd),
    })
    const services = await createAgentSessionServices({
      cwd: input.cwd,
      agentDir: input.agentDir,
      settingsManager,
      resourceLoaderReloadOptions: {
        resolveProjectTrust: async () => isProjectTrusted(input.cwd),
      },
      resourceLoaderOptions: {
        noExtensions: true,
        additionalExtensionPaths: input.extensionPaths ?? [],
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
        ? services.modelRegistry.find(input.modelProvider, input.modelId)
        : undefined
    if (input.modelProvider && input.modelId && !model) {
      throw new Error(
        `Configured model not found in SDK registry: ${input.modelProvider} / ${input.modelId}`,
      )
    }
    const { session, extensionsResult } = await createAgentSessionFromServices({
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
    const diagnostics: SdkExtensionDiagnostic[] = extensionsResult.errors.map((error, index) => ({
      id: `${input.studioSessionId}:load:${index}`,
      sessionId: input.studioSessionId,
      extensionPath: error.path,
      event: 'load',
      level: 'error',
      message: error.error,
      createdAt: new Date().toISOString(),
    }))
    const wrappedRef: { current?: StudioAgentSession } = {}
    const recordExtensionError = (error: ExtensionError) => {
      const diagnostic = {
        extensionPath: error.extensionPath,
        event: error.event,
        level: 'error' as const,
        message: error.error,
        stack: error.stack,
      }
      if (wrappedRef.current) wrappedRef.current.recordDiagnostic(diagnostic)
      else {
        diagnostics.push({
          ...diagnostic,
          id: `${input.studioSessionId}:bind:${diagnostics.length}`,
          sessionId: input.studioSessionId,
          createdAt: new Date().toISOString(),
        })
      }
      logger.error(`Extension error in ${error.extensionPath} (${error.event}): ${error.error}`)
    }
    try {
      const broker = getOrCreateExtensionUiBroker(input.studioSessionId)
      await session.bindExtensions({
        mode: 'rpc',
        uiContext: broker.uiContext,
        onError: recordExtensionError,
      })
    } catch (error) {
      logger.error(
        'Unable to bind session extensions:',
        error instanceof Error ? error.message : error,
      )
    }
    const wrapped = new StudioAgentSession(
      input.studioSessionId,
      session,
      resourceSignature,
      input.cwd,
      input.agentDir,
      input.extensionPaths ?? [],
      input.promptPaths ?? [],
      input.modelRuntimeSignature ?? '',
      diagnostics,
    )
    wrappedRef.current = wrapped
    sessions().set(input.studioSessionId, wrapped)
    return wrapped
  })().finally(() => locks().delete(input.studioSessionId))

  locks().set(input.studioSessionId, starting)
  return starting
}

async function createResourceSignature(
  cwd: string,
  extensionPaths: string[],
  promptPaths: string[],
  agentDir = getAgentDir(),
  modelRuntimeSignature = '',
) {
  const files = [...promptPaths, ...extensionPaths].sort().map((path) => {
    try {
      return [path, statSync(path).mtimeMs]
    } catch {
      return [path, 0]
    }
  })
  const settings = SettingsManager.create(cwd, agentDir, {
    projectTrusted: isProjectTrusted(cwd),
  })
  return JSON.stringify({
    files,
    globalPackages: settings.getGlobalSettings().packages ?? [],
    projectPackages: settings.getProjectSettings().packages ?? [],
    extensionPaths: [...extensionPaths].sort(),
    modelRuntimeSignature,
    projectTrusted: isProjectTrusted(cwd),
  })
}

export function getSdkSession(studioSessionId: string) {
  const session = sessions().get(studioSessionId)
  return session?.isAlive() ? session : null
}

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

export function getSdkSessionExtensions(studioSessionId: string) {
  const session = getSdkSession(studioSessionId)
  if (!session) return null
  const runner = session.inner.extensionRunner
  const paths = runner.getExtensionPaths()
  const tools = runner.getAllRegisteredTools().map((tool) => ({
    name: tool.definition.name,
    label: tool.definition.label,
    description: tool.definition.description,
    extensionPath: tool.sourceInfo.path,
  }))
  const commands = runner.getRegisteredCommands().map((command) => ({
    name: command.invocationName,
    description: command.description,
    extensionPath: command.sourceInfo.path,
  }))
  const flags = [...runner.getFlags().values()].map((flag) => ({
    name: flag.name,
    description: flag.description,
    extensionPath: flag.extensionPath,
  }))
  return {
    sessionId: studioSessionId,
    cwd: session.cwd,
    running: session.inner.isStreaming || !session.inner.isIdle,
    loadedAt: new Date().toISOString(),
    extensions: paths.map((path) => ({
      path,
      tools: tools.filter((tool) => tool.extensionPath === path),
      commands: commands.filter((command) => command.extensionPath === path),
      flags: flags.filter((flag) => flag.extensionPath === path),
    })),
  }
}

export function listSdkSessionExtensionSnapshots(cwd?: string) {
  return [...sessions().values()]
    .filter((session) => session.isAlive() && (!cwd || session.cwd === cwd))
    .map((session) => getSdkSessionExtensions(session.key))
    .filter((snapshot): snapshot is NonNullable<typeof snapshot> => snapshot !== null)
}

export function getSdkSessionExtensionDiagnostics(studioSessionId: string) {
  return getSdkSession(studioSessionId)?.getDiagnostics() ?? null
}

export function listSdkExtensionDiagnostics(cwd?: string) {
  return [...sessions().values()]
    .filter((session) => session.isAlive() && (!cwd || session.cwd === cwd))
    .flatMap((session) => session.getDiagnostics())
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
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
        session.extensionPaths,
        session.promptPaths,
        session.agentDir,
        session.modelRuntimeSignature,
      )
      session.recordDiagnostic({
        event: 'reload',
        level: 'info',
        message: 'Extensions reloaded successfully.',
      })
      results.push({ sessionId: session.key, status: 'reloaded' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Extension reload failed.'
      session.recordDiagnostic({ event: 'reload', level: 'error', message })
      results.push({ sessionId: session.key, status: 'failed', error: message })
    }
  }
  return results
}

export function getSdkSessionExtensionUi(studioSessionId: string, afterNotification = 0) {
  const broker = getExtensionUiBroker(studioSessionId)
  if (!broker && !getSdkSession(studioSessionId)) return null
  return broker?.snapshot(afterNotification) ?? null
}

export function respondToSdkSessionExtensionUi(
  studioSessionId: string,
  interactionId: string,
  value: unknown,
  cancelled = false,
) {
  return getExtensionUiBroker(studioSessionId)?.respond(interactionId, value, cancelled) ?? false
}

export async function executeSdkExtensionCommand(
  studioSessionId: string,
  commandName: string,
  args = '',
) {
  const session = getSdkSession(studioSessionId)
  if (!session) return { status: 'session-not-active' as const }
  if (!session.inner.isIdle) return { status: 'session-running' as const }
  const command = session.inner.extensionRunner.getCommand(commandName)
  if (!command) return { status: 'command-not-found' as const }
  try {
    await command.handler(args, session.inner.extensionRunner.createCommandContext())
    return { status: 'completed' as const }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Extension command failed.'
    session.recordDiagnostic({
      extensionPath: command.sourceInfo.path,
      event: `command:${commandName}`,
      level: 'error',
      message,
      stack: error instanceof Error ? error.stack : undefined,
    })
    return { status: 'failed' as const, error: message }
  }
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

export function disposeAllSdkSessions() {
  for (const session of [...sessions().values()]) session.destroy()
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

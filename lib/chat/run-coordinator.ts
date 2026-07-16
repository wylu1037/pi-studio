export const RUN_TERMINAL_EVENT = 'run_terminal'

export type RunTerminalStatus = 'completed' | 'failed' | 'aborted'
export type RunLifecycleStatus = 'pending' | 'running' | RunTerminalStatus

export type RunStreamEvent<T = unknown> = {
  runId: string
  sequence: number
  type: string
  payload: T
  createdAt: string
}

export type RunTerminal = {
  status: RunTerminalStatus
  error?: string
  completedAt: string
  sequence: number
}

export type RunSnapshot = {
  runId: string
  status: RunLifecycleStatus
  abortRequested: boolean
  lastSequence: number
  terminal: RunTerminal | null
}

export type RunAbortHandler = () => void | Promise<void>

export type RunEventListener = (event: RunStreamEvent) => void | Promise<void>

export type RunSubscriptionOptions = {
  afterSequence?: number
  onEvent: RunEventListener
  onError?: (error: unknown, event: RunStreamEvent) => void
}

export type RunSubscription = {
  unsubscribe: () => void
  drained: () => Promise<void>
  readonly lastSequence: number
  readonly terminal: RunTerminal | null
}

export type RunExecutionContext = {
  runId: string
  publish: <T>(type: string, payload: T) => RunStreamEvent<T>
  isAbortRequested: () => boolean
  onAbort: (handler: RunAbortHandler) => () => void
  complete: () => RunTerminal
  fail: (error: unknown) => RunTerminal
  abort: () => RunTerminal
}

export type RunWorker = (context: RunExecutionContext) => void | Promise<void>

export type RunHandle = {
  runId: string
  completion: Promise<RunTerminal>
  requestAbort: () => boolean
  snapshot: () => RunSnapshot
}

type Subscriber = {
  active: boolean
  lastSequence: number
  tail: Promise<void>
  onEvent: RunEventListener
  onError?: (error: unknown, event: RunStreamEvent) => void
}

type RunRecord = {
  runId: string
  status: RunLifecycleStatus
  abortRequested: boolean
  started: boolean
  events: RunStreamEvent[]
  subscribers: Set<Subscriber>
  abortHandlers: Set<RunAbortHandler>
  terminal: RunTerminal | null
  completion: Promise<RunTerminal>
  resolveCompletion: (terminal: RunTerminal) => void
}

export type RunCoordinatorOptions = {
  now?: () => string
  maxRetainedRuns?: number
}

/**
 * Owns the live, process-local view of a run. Durable event storage intentionally
 * stays outside this class: callers can persist each returned event before or
 * alongside forwarding it to an SSE connection.
 */
export class RunCoordinator {
  private readonly runs = new Map<string, RunRecord>()
  private readonly now: () => string
  private readonly maxRetainedRuns: number

  constructor(options: RunCoordinatorOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.maxRetainedRuns = Math.max(1, options.maxRetainedRuns ?? 20)
  }

  start(runId: string, worker: RunWorker): RunHandle {
    const record = this.ensureRun(runId)

    if (!record.started && !record.terminal) {
      record.started = true
      record.status = 'running'
      void Promise.resolve()
        .then(async () => {
          if (record.terminal) return
          await worker(this.createExecutionContext(record))
          if (!record.terminal) {
            this.finish(runId, record.abortRequested ? 'aborted' : 'completed')
          }
        })
        .catch((error: unknown) => {
          if (!record.terminal) {
            this.finish(runId, record.abortRequested ? 'aborted' : 'failed', error)
          }
        })
    }

    return this.createHandle(record)
  }

  publish<T>(runId: string, type: string, payload: T): RunStreamEvent<T> {
    const record = this.ensureRun(runId)
    if (record.terminal) {
      throw new Error(`Cannot publish to terminal run: ${runId}`)
    }

    const event: RunStreamEvent<T> = {
      runId,
      sequence: record.events.length + 1,
      type,
      payload,
      createdAt: this.now(),
    }
    record.events.push(event)
    this.dispatch(record, event)
    return event
  }

  subscribe(runId: string, options: RunSubscriptionOptions): RunSubscription {
    const record = this.ensureRun(runId)
    const subscriber: Subscriber = {
      active: true,
      lastSequence: Math.max(0, options.afterSequence ?? 0),
      tail: Promise.resolve(),
      onEvent: options.onEvent,
      onError: options.onError,
    }

    // Add the subscriber before queuing replay. All deliveries use its one
    // promise chain, so replay and subsequent live events remain ordered.
    record.subscribers.add(subscriber)
    for (const event of record.events) this.enqueue(subscriber, event)

    return {
      unsubscribe: () => {
        if (!subscriber.active) return
        subscriber.active = false
        record.subscribers.delete(subscriber)
      },
      drained: () => subscriber.tail,
      get lastSequence() {
        return subscriber.lastSequence
      },
      get terminal() {
        return record.terminal
      },
    }
  }

  getEvents(runId: string, afterSequence = 0): RunStreamEvent[] {
    const record = this.runs.get(runId)
    if (!record) return []
    return record.events.filter((event) => event.sequence > afterSequence)
  }

  getSnapshot(runId: string): RunSnapshot | null {
    const record = this.runs.get(runId)
    return record ? this.snapshot(record) : null
  }

  requestAbort(runId: string): boolean {
    const record = this.runs.get(runId)
    if (!record || record.terminal || record.abortRequested) return false

    record.abortRequested = true
    for (const handler of record.abortHandlers) {
      void Promise.resolve(handler()).catch(() => {
        // The worker owns the terminal state and will surface its final error.
      })
    }
    return true
  }

  finish(runId: string, status: RunTerminalStatus, error?: unknown): RunTerminal {
    const record = this.ensureRun(runId)
    if (record.terminal) return record.terminal

    const terminalEvent = this.publish(runId, RUN_TERMINAL_EVENT, {
      status,
      ...(error ? { error: errorMessage(error) } : {}),
    })
    const payload = terminalEvent.payload as { status: RunTerminalStatus; error?: string }
    const terminal: RunTerminal = {
      status,
      completedAt: terminalEvent.createdAt,
      sequence: terminalEvent.sequence,
      ...(payload.error ? { error: payload.error } : {}),
    }

    record.status = status
    record.terminal = terminal
    record.abortHandlers.clear()
    record.resolveCompletion(terminal)
    this.pruneTerminalRuns(runId)
    return terminal
  }

  private ensureRun(runId: string): RunRecord {
    const existing = this.runs.get(runId)
    if (existing) return existing

    let resolveCompletion!: (terminal: RunTerminal) => void
    const completion = new Promise<RunTerminal>((resolve) => {
      resolveCompletion = resolve
    })
    const record: RunRecord = {
      runId,
      status: 'pending',
      abortRequested: false,
      started: false,
      events: [],
      subscribers: new Set(),
      abortHandlers: new Set(),
      terminal: null,
      completion,
      resolveCompletion,
    }
    this.runs.set(runId, record)
    return record
  }

  private createHandle(record: RunRecord): RunHandle {
    return {
      runId: record.runId,
      completion: record.completion,
      requestAbort: () => this.requestAbort(record.runId),
      snapshot: () => this.snapshot(record),
    }
  }

  private createExecutionContext(record: RunRecord): RunExecutionContext {
    return {
      runId: record.runId,
      publish: <T>(type: string, payload: T) => this.publish(record.runId, type, payload),
      isAbortRequested: () => record.abortRequested,
      onAbort: (handler: RunAbortHandler) => {
        if (record.terminal) return () => {}
        record.abortHandlers.add(handler)
        if (record.abortRequested) {
          void Promise.resolve(handler()).catch(() => {
            // The worker owns the terminal state and will surface its final error.
          })
        }
        return () => record.abortHandlers.delete(handler)
      },
      complete: () => this.finish(record.runId, 'completed'),
      fail: (error: unknown) => this.finish(record.runId, 'failed', error),
      abort: () => this.finish(record.runId, 'aborted'),
    }
  }

  private snapshot(record: RunRecord): RunSnapshot {
    return {
      runId: record.runId,
      status: record.status,
      abortRequested: record.abortRequested,
      lastSequence: record.events.length,
      terminal: record.terminal,
    }
  }

  private dispatch(record: RunRecord, event: RunStreamEvent) {
    for (const subscriber of record.subscribers) this.enqueue(subscriber, event)
  }

  private enqueue(subscriber: Subscriber, event: RunStreamEvent) {
    if (!subscriber.active || event.sequence <= subscriber.lastSequence) return
    subscriber.lastSequence = event.sequence
    subscriber.tail = subscriber.tail.then(async () => {
      if (!subscriber.active) return
      try {
        await subscriber.onEvent(event)
      } catch (error) {
        subscriber.onError?.(error, event)
      }
    })
  }

  private pruneTerminalRuns(currentRunId: string) {
    if (this.runs.size <= this.maxRetainedRuns) return
    for (const [runId, record] of this.runs) {
      if (this.runs.size <= this.maxRetainedRuns) break
      if (runId === currentRunId || !record.terminal || record.subscribers.size > 0) continue
      this.runs.delete(runId)
    }
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

declare global {
  var __piStudioRunCoordinator: RunCoordinator | undefined
}

export function getRunCoordinator() {
  globalThis.__piStudioRunCoordinator ??= new RunCoordinator()
  return globalThis.__piStudioRunCoordinator
}

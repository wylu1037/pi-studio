/**
 * Client transport for the unified session event stream (`/api/sessions/:id/events`).
 *
 * The server side of this contract (SessionRunController + the SSE endpoint)
 * already provides sequenced frames, a ring buffer, and cursor replay. This
 * module is the client counterpart: it owns the EventSource lifecycle so the
 * connection is *self-healing* — the UI layer only consumes frames and never
 * reasons about connection health.
 *
 * Failure modes covered (each previously left the UI silently frozen on
 * "thinking" until a manual page switch):
 *  - Fatal HTTP responses (non-200 / wrong content-type during dev recompiles,
 *    server restarts): EventSource gives up permanently (`readyState CLOSED`,
 *    no auto-retry). Detected via `onerror` and rebuilt with backoff.
 *  - Silent half-open TCP links (sleep/resume, network switches): no error is
 *    ever fired. Detected by the heartbeat watchdog — the server emits a
 *    `heartbeat` event every 30s, so a quiet gap beyond `heartbeatTimeoutMs`
 *    means the link is dead, and the source is rebuilt.
 *  - Transient network drops: EventSource reconnects on its own (it re-sends
 *    `Last-Event-ID` so the server replays the gap); we only surface the
 *    `reconnecting` status while it does.
 *
 * Recovery always reuses the server's replay contract: manual rebuilds pass the
 * highest seen sequence as `?after=`, browser-native reconnects carry the
 * `Last-Event-ID` header, and a cursor the server no longer covers falls back
 * to its fresh-view replay of the currently running activity.
 */
import type { PiRunEvent } from './pi-events'

export type { PiRunEvent }

/**
 * Client mirror of the server's `RunStreamFrame` (lib/chat/session-run-controller.ts).
 * Kept as a structural copy so client bundles never import server-only modules.
 */
export type RunStreamFrame =
  | { kind: 'state'; running: boolean; activityId: string | null; startedAt: string | null }
  | {
      kind: 'activity_start'
      activityId: string
      activityKind: 'prompt' | 'steer' | 'follow-up' | 'command'
      startedAt: string
    }
  | {
      kind: 'activity_end'
      activityId: string
      status: 'completed' | 'failed' | 'aborted'
      error?: string
    }
  | { kind: 'pi'; event: PiRunEvent }

export type SessionEventStreamStatus = 'connecting' | 'open' | 'reconnecting' | 'disposed'

/** The subset of EventSource this module uses; injectable for tests and SSR safety. */
export interface EventSourceLike {
  readyState: number
  onopen: ((event: unknown) => void) | null
  onerror: ((event: unknown) => void) | null
  addEventListener(type: string, listener: (event: MessageEvent) => void): void
  close(): void
}

export interface SessionEventStreamHandlers {
  onFrame: (frame: RunStreamFrame) => void
  onExtensionUi?: (snapshot: unknown) => void
  onStatusChange?: (status: SessionEventStreamStatus) => void
}

export interface SessionEventStreamOptions {
  createSource?: (url: string) => EventSourceLike
  /** Quiet-link threshold; the server heartbeats every 30s, default is 2.5 periods. */
  heartbeatTimeoutMs?: number
  watchdogIntervalMs?: number
  reconnectBaseDelayMs?: number
  reconnectMaxDelayMs?: number
}

// EventSource readyState values. Named locally because the EventSource global
// does not exist during SSR and this module must stay importable there.
const SOURCE_OPEN = 1
const SOURCE_CLOSED = 2

const DEFAULT_HEARTBEAT_TIMEOUT_MS = 75_000
const DEFAULT_WATCHDOG_INTERVAL_MS = 15_000
const DEFAULT_RECONNECT_BASE_DELAY_MS = 1_000
const DEFAULT_RECONNECT_MAX_DELAY_MS = 30_000

export class SessionEventStream {
  private source: EventSourceLike | null = null
  private cursor = 0
  private status: SessionEventStreamStatus = 'connecting'
  private disposed = false
  private lastEventAt: number
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private readonly watchdogTimer: ReturnType<typeof setInterval>

  private readonly createSource: (url: string) => EventSourceLike
  private readonly heartbeatTimeoutMs: number
  private readonly reconnectBaseDelayMs: number
  private readonly reconnectMaxDelayMs: number

  constructor(
    private readonly sessionId: string,
    private readonly handlers: SessionEventStreamHandlers,
    options: SessionEventStreamOptions = {},
  ) {
    this.createSource = options.createSource ?? ((url) => new EventSource(url) as EventSourceLike)
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS
    this.lastEventAt = Date.now()
    this.connect()
    this.watchdogTimer = setInterval(
      () => this.checkLiveness(),
      options.watchdogIntervalMs ?? DEFAULT_WATCHDOG_INTERVAL_MS,
    )
  }

  get currentStatus(): SessionEventStreamStatus {
    return this.status
  }

  /** Highest frame sequence seen; exposed for diagnostics/tests. */
  get currentCursor(): number {
    return this.cursor
  }

  /**
   * Immediately tear down and rebuild the connection, keeping the cursor so the
   * server replays whatever was missed. This is the one command every caller
   * with reason to distrust the stream uses (abort fallback, watchdog, fatal
   * errors) — recovery policy lives here, not at call sites.
   */
  reconnect() {
    if (this.disposed) return
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.connect()
  }

  /** Reconnect only if the link is not verifiably alive. Idempotent and cheap. */
  ensureConnected() {
    if (this.disposed) return
    const fresh = Date.now() - this.lastEventAt <= this.heartbeatTimeoutMs
    if (this.source && this.source.readyState === SOURCE_OPEN && fresh) return
    this.reconnect()
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    clearInterval(this.watchdogTimer)
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.closeSource()
    this.setStatus('disposed')
  }

  private url() {
    const base = `/api/sessions/${encodeURIComponent(this.sessionId)}/events`
    return this.cursor > 0 ? `${base}?after=${this.cursor}` : base
  }

  private closeSource() {
    const source = this.source
    this.source = null
    if (!source) return
    source.onopen = null
    source.onerror = null
    source.close()
  }

  private connect() {
    this.closeSource()
    // A rebuild counts as activity: the watchdog must measure the *new* link's
    // quietness, not blame it for the old link's silence and thrash-reconnect.
    this.touch()
    if (this.status !== 'connecting') this.setStatus('reconnecting')

    const source = this.createSource(this.url())
    this.source = source

    source.onopen = () => {
      if (this.disposed || this.source !== source) return
      this.reconnectAttempts = 0
      this.touch()
      this.setStatus('open')
    }
    source.onerror = () => {
      if (this.disposed || this.source !== source) return
      if (source.readyState === SOURCE_CLOSED) {
        // Fatal per the SSE spec (non-200, wrong content-type): the browser has
        // permanently given up, so recovery is entirely on us.
        this.scheduleReconnect()
      } else {
        // The browser is retrying on its own (it re-sends Last-Event-ID, so the
        // server will replay the gap). Just surface the degraded state.
        this.setStatus('reconnecting')
      }
    }

    const onFrameMessage = (event: MessageEvent) => {
      if (this.disposed || this.source !== source) return
      this.touch()
      const sequence = Number(event.lastEventId)
      if (Number.isInteger(sequence) && sequence > this.cursor) this.cursor = sequence
      const frame = parseJson(event.data)
      if (frame !== undefined) this.handlers.onFrame(frame as RunStreamFrame)
    }
    source.addEventListener('frame', onFrameMessage)
    source.addEventListener('state', onFrameMessage)
    source.addEventListener('extension_ui', (event) => {
      if (this.disposed || this.source !== source) return
      this.touch()
      const snapshot = parseJson(event.data)
      if (snapshot !== undefined) this.handlers.onExtensionUi?.(snapshot)
    })
    source.addEventListener('heartbeat', () => {
      if (this.disposed || this.source !== source) return
      this.touch()
    })
  }

  private scheduleReconnect() {
    if (this.disposed || this.reconnectTimer !== null) return
    this.setStatus('reconnecting')
    const delay = Math.min(
      this.reconnectBaseDelayMs * 2 ** this.reconnectAttempts,
      this.reconnectMaxDelayMs,
    )
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.reconnectAttempts += 1
      this.connect()
    }, delay)
  }

  private checkLiveness() {
    if (this.disposed || !this.source) return
    // Covers the half-open link: readyState still claims OPEN but no bytes
    // (not even heartbeats) arrive. Quiet past the threshold means dead.
    if (Date.now() - this.lastEventAt > this.heartbeatTimeoutMs) this.reconnect()
  }

  private touch() {
    this.lastEventAt = Date.now()
  }

  private setStatus(status: SessionEventStreamStatus) {
    if (this.status === status) return
    this.status = status
    this.handlers.onStatusChange?.(status)
  }
}

function parseJson(data: unknown): unknown {
  if (typeof data !== 'string' || !data) return undefined
  try {
    return JSON.parse(data)
  } catch {
    return undefined
  }
}

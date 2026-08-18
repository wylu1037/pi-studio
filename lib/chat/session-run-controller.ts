import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { createRun, markRun } from '@/lib/db/repository'
import type { PiRunEvent } from './pi-events'

/**
 * Single source of truth for a session's agent run state and event stream.
 *
 * The SDK's `AgentSession` already knows if it is busy (`isStreaming` / `isIdle`).
 * Previously that raw boolean was combined with a *separate* `chatRuns` record +
 * `RunCoordinator` to derive an "abortable run id" — and the two could disagree
 * (running:true / activeRunId:null), which surfaced as the dead "Working" button.
 *
 * This controller collapses everything into one owner:
 *  - `activityId`: non-null iff the session is running. One continuous busy span
 *    (a prompt plus any mid-flight steers/follow-ups) is one activity.
 *  - a single sequenced event stream (`activity_start`, forwarded SDK events,
 *    `activity_end`) with a small ring buffer for same-process reconnects.
 *  - `chatRuns` bookkeeping (queued → running → terminal) for run history and abort.
 *
 * The controller lives in a session-scoped global registry, *independent of the
 * SDK session lifecycle*. The frontend connects to the session event stream on
 * entry — before any SDK session may exist — so the controller must outlive
 * (and predate) the `AgentSession`. `bind()` attaches the live session; `unbind()`
 * detaches it when the SDK session is disposed.
 *
 * All interactions that drive the session (prompt / steer / follow-up / abort)
 * go through here so the running truth stays owned in one place. Session setup
 * (runtime sync, model selection) stays in the caller — this controller assumes
 * the session is already in the right shape before `prompt()` is called.
 */
export type RunActivityKind = 'prompt' | 'steer' | 'follow-up' | 'command'

export type RunActivityStatus = 'completed' | 'failed' | 'aborted'

export interface RunActivitySnapshot {
  running: boolean
  /** Non-null iff `running` is true. Identifies the current continuous activity. */
  activityId: string | null
  kind: RunActivityKind | null
  startedAt: string | null
}

/** Metadata needed to persist a `chatRuns` row for a prompt-initiated activity. */
export interface PromptAccounting {
  agentId: string
  providerId?: string
  modelId?: string
  thinkingLevel: string
  cwd: string
}

/** A frame on the unified session event stream. */
export type RunStreamFrame =
  | { kind: 'state'; running: boolean; activityId: string | null; startedAt: string | null }
  | { kind: 'activity_start'; activityId: string; activityKind: RunActivityKind; startedAt: string }
  | {
      kind: 'activity_end'
      activityId: string
      status: RunActivityStatus
      error?: string
    }
  | { kind: 'pi'; event: PiRunEvent }

export interface SequencedFrame {
  sequence: number
  frame: RunStreamFrame
}

type FrameListener = (frame: SequencedFrame) => void

const RING_BUFFER_SIZE = 300

export class SessionRunController {
  private inner: AgentSession | null = null
  private activityId: string | null = null
  private activityKind: RunActivityKind | null = null
  private startedAt: string | null = null
  /** The chatRuns row id for the current prompt activity, if any. */
  private runId: string | null = null
  /**
   * A Stop requested during the prompt preflight window (activity exists but the
   * SDK isn't streaming yet, so there's no AbortController to signal). `ingest()`
   * cashes it in the moment the run goes busy.
   */
  private abortRequested = false
  private counter = 0
  /** Resolves when the current activity reaches a terminal status. */
  private completionResolver: ((status: RunActivityStatus) => void) | null = null
  /**
   * How many context messages the session file held when the current prompt
   * activity started (sampled before `prompt()` writes the user entry). While
   * the run is live, everything the file gains at or past this index is the
   * running turn's partial content — the page render uses this to keep that
   * content out of "history", because the client renders the same turn from
   * the live event stream. Null for activities not started via `prompt()`
   * (externally driven runs picked up by `sync()`), where the boundary is
   * unknown and no trimming happens.
   */
  private contextMessageCountAtStart: number | null = null

  private sequence = 0
  private readonly buffer: SequencedFrame[] = []
  private readonly listeners = new Set<FrameListener>()

  constructor(private readonly sessionId: string) {}

  // --- SDK session binding --------------------------------------------------

  /** Attach the live SDK session. Called when the `AgentSession` is (re)created. */
  bind(inner: AgentSession) {
    this.inner = inner
    this.sync()
  }

  /** Detach the SDK session (disposed/reloaded). Any live activity is closed. */
  unbind() {
    // If the SDK session goes away mid-activity (idle timeout should not happen
    // while running, but reload/dispose can), close the activity as aborted so
    // subscribers and the chatRuns row do not hang in "running" forever.
    if (this.activityId) this.finishActivity('aborted')
    this.inner = null
  }

  private isBusy() {
    return this.inner ? this.inner.isStreaming || !this.inner.isIdle : false
  }

  // --- Event stream ---------------------------------------------------------

  private emit(frame: RunStreamFrame): SequencedFrame {
    this.sequence += 1
    const sequenced: SequencedFrame = { sequence: this.sequence, frame }
    this.buffer.push(sequenced)
    if (this.buffer.length > RING_BUFFER_SIZE) this.buffer.shift()
    for (const listener of this.listeners) listener(sequenced)
    return sequenced
  }

  /** Subscribe to live frames. Returns an unsubscribe function. */
  subscribe(listener: FrameListener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Buffered frames with a sequence greater than `afterSequence` (reconnect replay). */
  bufferedFrames(afterSequence = 0): SequencedFrame[] {
    return this.buffer.filter((entry) => entry.sequence > afterSequence)
  }

  /**
   * Frames appropriate for a newly attached SSE subscriber.
   *
   * A subscriber with a cursor is resuming an existing live view and receives
   * only the missed suffix. A subscriber without a cursor is a fresh page/view:
   * it must never replay completed activities that are already present in the
   * persisted session history. If an activity is currently running, replay only
   * that activity so a page opened mid-run can reconstruct its live tail.
   */
  replayFrames(afterSequence?: number): SequencedFrame[] {
    return selectReplayFrames(this.buffer, this.activityId, afterSequence)
  }

  /** The highest sequence number emitted so far (for a fresh subscriber's cursor). */
  currentSequence() {
    return this.sequence
  }

  /**
   * The current running state, for the SSE first frame and cold snapshots.
   * Pure read: it must not `sync()` (which could emit a duplicate
   * `activity_start` that the connecting client already replayed from the buffer).
   */
  stateFrame(): RunStreamFrame {
    return {
      kind: 'state',
      running: this.isBusy(),
      activityId: this.activityId,
      startedAt: this.startedAt,
    }
  }

  // --- Running truth --------------------------------------------------------

  /**
   * Reconcile the activity id with the live SDK running state. Cheap and
   * synchronous: called on every SDK event and before every snapshot so the id
   * and the running flag can never drift apart.
   *
   * `sync()` only ever *starts* an activity. Ending is owned exclusively by the
   * prompt promise (which knows the real terminal status) and `abort()`, so a
   * momentary idle reading here can never race them into a wrong status. If we
   * observe idle with a leftover activity that has no owning run (defensive:
   * should not happen since prompts always create a run), clear it silently.
   */
  sync(pendingKind: RunActivityKind = 'prompt') {
    const running = this.isBusy()
    if (running && !this.activityId) {
      this.counter += 1
      this.activityId = `${this.sessionId}:act:${this.counter}`
      this.activityKind = pendingKind
      this.startedAt = new Date().toISOString()
      // Not started through `prompt()`, so where the run began in the session
      // file is unknown; leave the boundary unset rather than guessing.
      this.contextMessageCountAtStart = null
      this.emit({
        kind: 'activity_start',
        activityId: this.activityId,
        activityKind: pendingKind,
        startedAt: this.startedAt,
      })
    } else if (!running && this.activityId && !this.runId) {
      // Orphan span with no owning prompt promise — clear without a terminal
      // frame (there is no meaningful status to report).
      this.activityId = null
      this.activityKind = null
      this.startedAt = null
    }
  }

  private finishActivity(status: RunActivityStatus, error?: string) {
    if (!this.activityId) return
    const activityId = this.activityId
    if (this.runId) {
      markRun(this.runId, status, error)
      this.runId = null
    }
    this.activityId = null
    this.activityKind = null
    this.startedAt = null
    this.abortRequested = false
    this.contextMessageCountAtStart = null
    this.emit({ kind: 'activity_end', activityId, status, ...(error ? { error } : {}) })
    const resolve = this.completionResolver
    this.completionResolver = null
    resolve?.(status)
  }

  /** Forward a parsed SDK event onto the stream and keep running truth in step. */
  ingest(event: PiRunEvent) {
    // Assign/refresh the activity id before forwarding so a subscriber taking a
    // snapshot mid-dispatch already sees a consistent state.
    this.sync(this.activityKind ?? 'prompt')
    // Cash in a Stop pressed during the prompt preflight window: back then the SDK
    // had no live run to abort, so the intent was parked. The run is streaming now,
    // so honor it — this drives the abort + `activity_end` the client is waiting on
    // instead of leaving it stuck on "Stopping" until the run finishes on its own.
    if (this.abortRequested && this.isBusy()) {
      this.abortRequested = false
      void this.abortInner().catch(() => {})
    }
    this.emit({ kind: 'pi', event })
  }

  getSnapshot(): RunActivitySnapshot {
    this.sync(this.activityKind ?? 'prompt')
    const running = this.isBusy()
    return {
      running,
      activityId: running ? this.activityId : null,
      kind: running ? this.activityKind : null,
      startedAt: running ? this.startedAt : null,
    }
  }

  /**
   * Where the currently running prompt began in the session file, or null when
   * no run is live (or the boundary is unknown for a non-prompt activity).
   * Everything the file holds at or past this context-message index belongs to
   * the running turn; a server render must not present it as settled history —
   * the client is already rendering that same turn from the live event stream.
   */
  liveRunMessageBoundary(): number | null {
    if (!this.activityId || this.contextMessageCountAtStart === null) return null
    return this.contextMessageCountAtStart
  }

  // --- Interactions ---------------------------------------------------------

  /**
   * Start a prompt. Assumes the session is already prepared (model/thinking set,
   * runtime synced) by the caller. Fire-and-forget: SDK events arrive via
   * `ingest()`; this only manages the activity/run lifecycle.
   */
  prompt(
    text: string,
    accounting: PromptAccounting,
    options?: { contextMessageCountAtStart?: number },
  ): { activityId: string; runId: string; completion: Promise<RunActivityStatus> } {
    if (!this.inner) throw new Error('No SDK session bound to run controller')
    const run = createRun({
      sessionId: this.sessionId,
      agentId: accounting.agentId,
      prompt: text,
      providerId: accounting.providerId,
      modelId: accounting.modelId,
      thinkingLevel: accounting.thinkingLevel,
      cwd: accounting.cwd,
    })
    if (!run) throw new Error('Unable to create run record')
    this.runId = run.id
    // Establish the activity synchronously so the returned id is live.
    this.counter += 1
    this.activityId = `${this.sessionId}:act:${this.counter}`
    this.activityKind = 'prompt'
    this.startedAt = new Date().toISOString()
    this.contextMessageCountAtStart = options?.contextMessageCountAtStart ?? null
    markRun(run.id, 'running')
    this.emit({
      kind: 'activity_start',
      activityId: this.activityId,
      activityKind: 'prompt',
      startedAt: this.startedAt,
    })

    const activityId = this.activityId
    const completion = new Promise<RunActivityStatus>((resolve) => {
      this.completionResolver = resolve
    })
    void this.inner
      .prompt(text, { source: 'rpc' })
      .then(() => {
        this.finishActivity('completed')
      })
      .catch((error: unknown) => {
        this.finishActivity('failed', error instanceof Error ? error.message : String(error))
      })

    return { activityId, runId: run.id, completion }
  }

  async steer(message: string): Promise<boolean> {
    if (!this.inner || !this.isBusy()) return false
    await this.inner.steer(message)
    return true
  }

  async followUp(message: string): Promise<boolean> {
    if (!this.inner || !this.isBusy()) return false
    await this.inner.followUp(message)
    return true
  }

  /**
   * Stop whatever the session is currently doing. No-op when there's nothing to
   * stop. When a run exists only as a controller activity but the SDK hasn't begun
   * streaming yet (the `prompt()` preflight window: auth check, compaction, the
   * `before_agent_start` hooks), there's no AbortController to signal, so the abort
   * would be silently dropped and the client would hang on "Stopping" waiting for
   * an `activity_end` that never arrives. Record the intent instead and let
   * `ingest()` cash it in the instant the run goes busy.
   */
  async abort(): Promise<boolean> {
    if (!this.inner) return false
    const busy = this.isBusy()
    if (!this.activityId && !busy) return false
    if (!busy) {
      this.abortRequested = true
      return true
    }
    this.abortRequested = false
    await this.abortInner()
    return true
  }

  /** Abort the live SDK run and close the activity. Assumes the run is busy. */
  private async abortInner(): Promise<void> {
    if (!this.inner) return
    await this.inner.abort()
    this.finishActivity('aborted')
  }
}

export function selectReplayFrames(
  buffer: readonly SequencedFrame[],
  currentActivityId: string | null,
  afterSequence?: number,
): SequencedFrame[] {
  if (afterSequence !== undefined) {
    const earliestSequence = buffer[0]?.sequence
    const cursorIsCovered = earliestSequence === undefined || afterSequence >= earliestSequence - 1
    if (cursorIsCovered) {
      return buffer.filter((entry) => entry.sequence > afterSequence)
    }
  }

  if (!currentActivityId || buffer.length === 0) return []

  for (let index = buffer.length - 1; index >= 0; index--) {
    const frame = buffer[index]?.frame
    if (frame?.kind === 'activity_start' && frame.activityId === currentActivityId) {
      return buffer.slice(index)
    }
  }

  // The activity start can fall out of the bounded ring buffer during a long
  // run. In that case everything after the most recent completed activity is
  // part of the current run. If even that boundary was pruned, replay the whole
  // remaining buffer as the best available live snapshot.
  for (let index = buffer.length - 1; index >= 0; index--) {
    if (buffer[index]?.frame.kind === 'activity_end') return buffer.slice(index + 1)
  }
  return [...buffer]
}

declare global {
  var __piStudioRunControllers: Map<string, SessionRunController> | undefined
}

function controllers() {
  globalThis.__piStudioRunControllers ??= new Map()
  return globalThis.__piStudioRunControllers
}

/** Get-or-create the run controller for a session. Outlives the SDK session. */
export function getSessionRunController(sessionId: string) {
  const existing = controllers().get(sessionId)
  if (existing) return existing
  const controller = new SessionRunController(sessionId)
  controllers().set(sessionId, controller)
  return controller
}

/** Peek at an existing controller without creating one. */
export function peekSessionRunController(sessionId: string) {
  return controllers().get(sessionId) ?? null
}

/**
 * Drop the controller for a session that is gone for good (session deleted).
 * Not called on idle SDK-session teardown: the controller is designed to
 * outlive the SDK session so a reconnecting client can replay its ring buffer.
 * Only a definitive "session no longer exists" event should evict it, otherwise
 * the registry grows unbounded with one buffered controller per deleted session.
 */
export function disposeSessionRunController(sessionId: string) {
  controllers().delete(sessionId)
}

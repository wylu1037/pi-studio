/**
 * Pure reducer for the live-run stream state of a chat session.
 *
 * Everything a running turn shows in the UI — phase, live tail rows, activity
 * identity, abort bookkeeping, the optimistic user message — lives in one
 * `RunStreamState`, advanced exclusively by `runStreamReducer`. Inputs arrive
 * as actions from three places (see docs/run-stream-reducer-design.md):
 *
 *  - `frame`: every frame of the server contract, verbatim.
 *  - Local intents: submit / abort / clear / branch staging / handover.
 *  - The rAF-batched markdown pipeline's output (`content_flushed` /
 *    `content_replaced`), which upserts assistant row content. High-frequency
 *    `message_delta` text intentionally does NOT flow through `frame`.
 *
 * Purity contract: no `Date.now()`, no refs, no I/O. Every nondeterministic
 * input rides in the action payload (`at`), and generated row ids derive from
 * `messageSequence`. A recorded action sequence therefore replays exactly, and
 * StrictMode's double invocation is harmless.
 */
import type { ChatMessage } from '@/lib/types'
import { hasPersistedAssistantResponse } from './stream-lifecycle'
import type { PiRunEvent, RunStreamFrame } from './session-event-stream'

export type RunStreamPhase = 'idle' | 'starting' | 'thinking' | 'streaming'

type ProcessMessageType = Extract<
  ChatMessage['type'],
  'thinking' | 'tool_call' | 'tool_result' | 'bash'
>

export interface RunStreamState {
  phase: RunStreamPhase
  /** Non-null while an activity is running (server-assigned id). */
  activityId: string | null
  /**
   * Whether the `activity_start` frame for `activityId` has been applied.
   * `prompt_started` (the POST response) announces the id *before* the frame
   * arrives, so idempotency must key on "start applied", not "id seen" —
   * otherwise the real start frame would be skipped as a duplicate.
   */
  activityStartApplied: boolean
  sdkRunning: boolean
  queueReady: boolean
  aborting: boolean
  error: string | null
  /** Run finished; the post-run history refresh/handover is pending. */
  done: boolean
  startedAt: number | null
  /** The live tail: rows accumulated for the running (or just-finished) turn. */
  messages: ChatMessage[]
  optimisticUserMessage: ChatMessage | null
  /** Assistant row currently receiving deltas. */
  currentAssistantId: string | null
  /** Most recent assistant row (usage frames without an id attach here). */
  latestAssistantId: string | null
  /** Deterministic seed for generated row ids. */
  messageSequence: number
  /** Where the running turn begins in the persisted history (trim/handover boundary). */
  sourceCountAtRunStart: number
  /** Boundary staged by edit-message branch navigation for the next submit. */
  stagedSourceCount: number | null
}

export function createInitialRunStreamState(sourceCount: number): RunStreamState {
  return {
    phase: 'idle',
    activityId: null,
    activityStartApplied: false,
    sdkRunning: false,
    queueReady: false,
    aborting: false,
    error: null,
    done: false,
    startedAt: null,
    messages: [],
    optimisticUserMessage: null,
    currentAssistantId: null,
    latestAssistantId: null,
    messageSequence: 0,
    sourceCountAtRunStart: sourceCount,
    stagedSourceCount: null,
  }
}

export const initialRunStreamState = createInitialRunStreamState(0)

export type RunStreamAction =
  | { type: 'frame'; frame: RunStreamFrame; at: number }
  | { type: 'prompt_submitted'; message: ChatMessage; sourceCount: number; at: number }
  | { type: 'prompt_started'; activityId: string | null }
  | { type: 'prompt_rejected'; error: string | null; alreadyRunning?: boolean }
  | { type: 'abort_requested' }
  | { type: 'abort_failed'; error: string }
  | { type: 'abort_fallback_fired' }
  | { type: 'branch_context_staged'; sourceCount: number }
  | { type: 'session_reset' }
  | { type: 'handover_completed' }
  | { type: 'error_dismissed' }
  | { type: 'stream_error_raised'; error: string }
  | { type: 'content_flushed'; batch: readonly { messageId: string; content: string }[] }
  | { type: 'content_replaced'; messageId: string; content: string }

export function runStreamReducer(state: RunStreamState, action: RunStreamAction): RunStreamState {
  switch (action.type) {
    case 'frame':
      return reduceFrame(state, action.frame, action.at)

    case 'prompt_submitted':
      return {
        ...state,
        phase: 'starting',
        activityStartApplied: false,
        queueReady: false,
        aborting: false,
        error: null,
        done: false,
        startedAt: action.at,
        messages: [],
        optimisticUserMessage: action.message,
        currentAssistantId: null,
        latestAssistantId: null,
        messageSequence: 0,
        sourceCountAtRunStart: state.stagedSourceCount ?? action.sourceCount,
        stagedSourceCount: null,
      }

    case 'prompt_started':
      return { ...state, activityId: action.activityId, sdkRunning: true }

    case 'prompt_rejected': {
      const settled = {
        ...state,
        phase: 'idle' as const,
        activityId: null,
        aborting: false,
        optimisticUserMessage: null,
        startedAt: null,
      }
      // The server said another run holds the session: reflect its running
      // state so steer/follow-up affordances light up instead of an error.
      if (action.alreadyRunning) {
        return { ...settled, sdkRunning: true, queueReady: true, error: null }
      }
      return { ...settled, error: action.error }
    }

    case 'abort_requested':
      return { ...state, aborting: true }

    case 'abort_failed':
      return { ...state, aborting: false, error: action.error }

    case 'abort_fallback_fired':
      return { ...state, aborting: false }

    case 'branch_context_staged':
      return { ...state, stagedSourceCount: action.sourceCount }

    case 'session_reset':
      return createInitialRunStreamState(0)

    case 'handover_completed':
      return {
        ...state,
        phase: 'idle',
        done: false,
        startedAt: null,
        messages: [],
        optimisticUserMessage: null,
        currentAssistantId: null,
        latestAssistantId: null,
      }

    case 'error_dismissed':
      return { ...state, error: null }

    case 'stream_error_raised':
      return { ...state, error: action.error }

    case 'content_flushed': {
      if (action.batch.length === 0) return state
      let messages = state.messages
      for (const delta of action.batch) {
        messages = upsertAssistantContent(messages, delta.messageId, delta.content, 'append')
      }
      return { ...state, messages }
    }

    case 'content_replaced': {
      if (!action.content) return state
      return {
        ...state,
        messages: upsertAssistantContent(
          state.messages,
          action.messageId,
          action.content,
          'replace',
        ),
      }
    }
  }
}

function reduceFrame(state: RunStreamState, frame: RunStreamFrame, at: number): RunStreamState {
  switch (frame.kind) {
    case 'state': {
      if (frame.running) {
        return {
          ...state,
          sdkRunning: true,
          queueReady: true,
          activityId: frame.activityId ?? state.activityId,
          phase: state.phase === 'idle' ? 'thinking' : state.phase,
        }
      }
      return {
        ...state,
        sdkRunning: false,
        queueReady: false,
        activityId: null,
        activityStartApplied: false,
        phase: 'idle',
      }
    }

    case 'activity_start': {
      // Idempotent on the *applied* start, not the announced id: a reconnect
      // replays activity_start ahead of frames we already applied, and wiping
      // the accumulated tail would flicker the view for nothing (the replayed
      // deltas are duplicate-tolerant upserts). The id alone is not enough —
      // `prompt_started` announces it before this frame ever arrives.
      if (frame.activityId === state.activityId && state.activityStartApplied) return state
      return {
        ...state,
        phase: 'thinking',
        activityId: frame.activityId,
        activityStartApplied: true,
        sdkRunning: true,
        queueReady: true,
        error: null,
        done: false,
        startedAt: at,
        messages: [],
        currentAssistantId: null,
        latestAssistantId: null,
      }
    }

    case 'activity_end': {
      const failed = frame.status === 'failed'
      return {
        ...state,
        phase: 'idle',
        activityId: null,
        activityStartApplied: false,
        sdkRunning: false,
        queueReady: false,
        aborting: false,
        messages: settleStreamingRows(state.messages),
        error: failed ? (frame.error ?? 'pi run failed.') : state.error,
        done: !failed,
      }
    }

    case 'pi':
      return reducePiEvent(state, frame.event)
  }
}

function reducePiEvent(state: RunStreamState, event: PiRunEvent): RunStreamState {
  switch (event.type) {
    case 'assistant_message_start': {
      let sequence = state.messageSequence
      let id = event.messageId
      if (!id) {
        id = `stream-assistant-${sequence}`
        sequence += 1
      }
      return { ...state, currentAssistantId: id, latestAssistantId: id, messageSequence: sequence }
    }

    case 'assistant_message_end': {
      const id = event.messageId ?? state.currentAssistantId
      if (!id) return state
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === id && message.timestamp === 'streaming'
            ? { ...message, timestamp: 'now' }
            : message,
        ),
        currentAssistantId: state.currentAssistantId === id ? null : state.currentAssistantId,
      }
    }

    case 'assistant_text_end':
      // Segment sealing is a markdown-pipeline concern; its replacement text
      // returns as a `content_replaced` action.
      return state

    case 'message_delta': {
      if (!event.content) return state
      let sequence = state.messageSequence
      let id = event.messageId ?? state.currentAssistantId
      let messages = state.messages
      if (!id) {
        id = `stream-assistant-${sequence}`
        sequence += 1
      }
      // The defensive no-messageId path bypasses the markdown pipeline (the
      // dispatcher cannot address an assembler without an id), so the reducer
      // carries the text itself. The served parser always sets messageId.
      if (!event.messageId) {
        messages = upsertAssistantContent(messages, id, event.content, 'append')
      }
      return {
        ...state,
        phase: 'streaming',
        currentAssistantId: id,
        latestAssistantId: id,
        messageSequence: sequence,
        messages,
      }
    }

    case 'thinking_delta':
      return appendProcessRow(state, 'thinking', event.content ?? '', 'Thinking')

    case 'tool_call_delta':
      return appendProcessRow(state, 'tool_call', event.content ?? '', event.title ?? 'Tool call')

    case 'tool_result_delta':
      return appendProcessRow(
        state,
        'tool_result',
        event.content ?? '',
        event.title ?? 'Tool result',
      )

    case 'bash_output':
      return appendProcessRow(state, 'bash', event.content ?? '', event.stream ?? 'stderr')

    case 'usage': {
      const assistantId = event.messageId ?? state.latestAssistantId
      if (!assistantId || !event.usage) return state
      const usage = {
        input: event.usage.input ?? 0,
        output: event.usage.output ?? 0,
        cacheRead: event.usage.cacheRead ?? 0,
        cacheWrite: event.usage.cacheWrite ?? 0,
        cost: event.usage.cost,
      }
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === assistantId
            ? { ...message, tokens: event.usage.totalTokens, usage }
            : message,
        ),
      }
    }

    case 'error':
      // `activity_end` remains the authoritative failure signal; surfacing the
      // SDK message eagerly just shows it sooner.
      return { ...state, error: event.message ?? 'pi run failed.' }

    case 'done':
      return state
  }
}

function appendProcessRow(
  state: RunStreamState,
  type: ProcessMessageType,
  content: string,
  title: string | undefined,
): RunStreamState {
  if (!content) return state
  const withPhase = (
    messages: ChatMessage[],
    sequence = state.messageSequence,
  ): RunStreamState => ({
    ...state,
    phase: 'thinking',
    messages,
    messageSequence: sequence,
  })

  const last = state.messages.at(-1)
  if (type === 'thinking' && last?.type === 'thinking') {
    return withPhase([...state.messages.slice(0, -1), { ...last, content: last.content + content }])
  }
  if (type === 'bash' && last?.type === 'bash' && last.title === title) {
    return withPhase([...state.messages.slice(0, -1), { ...last, content: last.content + content }])
  }
  return withPhase(
    [
      ...state.messages,
      {
        id: `stream-${type}-${state.messageSequence}`,
        type,
        title,
        content,
        timestamp: 'streaming',
      },
    ],
    state.messageSequence + 1,
  )
}

function settleStreamingRows(messages: ChatMessage[]): ChatMessage[] {
  if (!messages.some((message) => message.timestamp === 'streaming')) return messages
  return messages.map((message) =>
    message.timestamp === 'streaming' ? { ...message, timestamp: 'now' } : message,
  )
}

function upsertAssistantContent(
  messages: ChatMessage[],
  messageId: string,
  content: string,
  mode: 'append' | 'replace',
): ChatMessage[] {
  const index = messages.findIndex((message) => message.id === messageId)
  if (index >= 0) {
    const existing = messages[index]!
    return [
      ...messages.slice(0, index),
      { ...existing, content: mode === 'append' ? existing.content + content : content },
      ...messages.slice(index + 1),
    ]
  }
  return [...messages, { id: messageId, type: 'assistant', content, timestamp: 'streaming' }]
}

// --- Selectors ---------------------------------------------------------------

export const selectIsStartingRun = (state: RunStreamState) =>
  state.phase === 'starting' && !state.activityId

export const selectIsRunningRun = (state: RunStreamState) =>
  Boolean(state.activityId) || state.sdkRunning

export const selectCanQueueMessage = (state: RunStreamState) =>
  selectIsRunningRun(state) && state.queueReady && !state.aborting

export const selectRunProducedAssistantText = (state: RunStreamState) =>
  state.messages.some((message) => message.type === 'assistant' && message.content)

export const selectHasPersistedRun = (state: RunStreamState, sourceMessages: ChatMessage[]) =>
  state.done &&
  hasPersistedAssistantResponse(sourceMessages, state.sourceCountAtRunStart, {
    acceptProcessMessages: !selectRunProducedAssistantText(state),
  })

export const selectIsWaiting = (state: RunStreamState, hasPersistedRun: boolean) =>
  !state.error &&
  !hasPersistedRun &&
  (state.phase !== 'idle' || state.sdkRunning) &&
  state.messages.length === 0

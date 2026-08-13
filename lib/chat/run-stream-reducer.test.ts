import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatMessage } from '@/lib/types'
import {
  createInitialRunStreamState,
  runStreamReducer,
  selectCanQueueMessage,
  selectHasPersistedRun,
  selectIsRunningRun,
  selectIsStartingRun,
  selectIsWaiting,
  type RunStreamAction,
  type RunStreamState,
} from './run-stream-reducer'
import type { RunStreamFrame } from './session-event-stream'

const T0 = 1_700_000_000_000

function replay(state: RunStreamState, actions: RunStreamAction[]): RunStreamState {
  return actions.reduce(runStreamReducer, state)
}

function frame(value: RunStreamFrame, at = T0): RunStreamAction {
  return { type: 'frame', frame: value, at }
}

function userMessage(content = 'hello'): ChatMessage {
  return { id: 'optimistic-user-1', type: 'user', content, timestamp: 'sending' }
}

function submitted(sourceCount = 3): RunStreamAction {
  return { type: 'prompt_submitted', message: userMessage(), sourceCount, at: T0 }
}

const activityStart = frame({
  kind: 'activity_start',
  activityId: 'act-1',
  activityKind: 'prompt',
  startedAt: '2026-08-10T00:00:00.000Z',
})

const activityEndCompleted = frame({
  kind: 'activity_end',
  activityId: 'act-1',
  status: 'completed',
})

const assistantStart = frame({
  kind: 'pi',
  event: { type: 'assistant_message_start', messageId: 'assistant-1' },
})

const assistantEnd = frame({
  kind: 'pi',
  event: { type: 'assistant_message_end', messageId: 'assistant-1' },
})

const flushHello: RunStreamAction = {
  type: 'content_flushed',
  batch: [{ messageId: 'assistant-1', content: 'Hi there' }],
}

test('golden path: submit → start → assistant → flush → end → handover', () => {
  let state = createInitialRunStreamState(3)

  state = runStreamReducer(state, submitted())
  assert.equal(state.phase, 'starting')
  assert.equal(selectIsStartingRun(state), true)
  assert.equal(selectIsWaiting(state, false), true)
  assert.equal(state.sourceCountAtRunStart, 3)
  assert.equal(state.optimisticUserMessage?.content, 'hello')

  state = runStreamReducer(state, { type: 'prompt_started', activityId: 'act-1' })
  assert.equal(selectIsRunningRun(state), true)
  assert.equal(selectIsStartingRun(state), false)

  state = replay(state, [activityStart, assistantStart])
  assert.equal(state.phase, 'thinking')
  assert.equal(state.currentAssistantId, 'assistant-1')
  assert.equal(selectIsWaiting(state, false), true, 'no content yet — still waiting')

  state = runStreamReducer(
    state,
    frame({
      kind: 'pi',
      event: { type: 'message_delta', content: 'Hi', messageId: 'assistant-1' },
    }),
  )
  assert.equal(state.phase, 'streaming')
  assert.equal(state.messages.length, 0, 'delta content rides the markdown pipeline, not the frame')

  state = runStreamReducer(state, flushHello)
  assert.equal(state.messages.length, 1)
  assert.equal(state.messages[0]!.content, 'Hi there')
  assert.equal(selectIsWaiting(state, false), false)

  state = replay(state, [assistantEnd, activityEndCompleted])
  assert.equal(state.done, true)
  assert.equal(state.phase, 'idle')
  assert.equal(state.aborting, false)
  assert.equal(state.messages[0]!.timestamp, 'now')
  assert.equal(selectIsRunningRun(state), false)

  const persisted: ChatMessage[] = [
    { id: 'p1', type: 'user', content: 'a', timestamp: 'now' },
    { id: 'p2', type: 'assistant', content: 'b', timestamp: 'now' },
    { id: 'p3', type: 'user', content: 'hello', timestamp: 'now' },
    { id: 'p4', type: 'assistant', content: 'Hi there', timestamp: 'now' },
  ]
  assert.equal(selectHasPersistedRun(state, persisted), true)

  state = runStreamReducer(state, { type: 'handover_completed' })
  assert.equal(state.messages.length, 0)
  assert.equal(state.optimisticUserMessage, null)
  assert.equal(state.done, false)
  assert.equal(selectIsWaiting(state, false), false)
})

test('reconnect replay: duplicate activity_start keeps the accumulated tail', () => {
  let state = replay(createInitialRunStreamState(0), [
    submitted(0),
    activityStart,
    assistantStart,
    flushHello,
  ])
  assert.equal(state.messages.length, 1)

  const before = state
  state = replay(state, [
    activityStart, // replayed by the server after a reconnect
    frame({ kind: 'pi', event: { type: 'assistant_message_start', messageId: 'assistant-1' } }),
  ])
  assert.equal(state.messages, before.messages, 'tail survives the replayed start')

  // Replayed flush content arrives as an append to the same row — the row count
  // stays stable (transport-level sequence de-dupe prevents true duplicates).
  state = runStreamReducer(state, flushHello)
  assert.equal(state.messages.length, 1)
})

test('mid-run attach: state(running) then an unknown-assistant flush renders', () => {
  let state = createInitialRunStreamState(5)

  state = runStreamReducer(
    state,
    frame({ kind: 'state', running: true, activityId: 'act-9', startedAt: null }),
  )
  assert.equal(state.activityId, 'act-9')
  assert.equal(state.phase, 'thinking')
  assert.equal(selectIsWaiting(state, false), true)

  state = runStreamReducer(state, {
    type: 'content_flushed',
    batch: [{ messageId: 'assistant-x', content: 'partial' }],
  })
  assert.equal(state.messages.length, 1)
  assert.equal(selectIsWaiting(state, false), false)

  state = runStreamReducer(
    state,
    frame({ kind: 'state', running: false, activityId: null, startedAt: null }),
  )
  assert.equal(state.phase, 'idle')
  assert.equal(selectIsRunningRun(state), false)
})

test('failure: activity_end(failed) surfaces the error and blocks handover', () => {
  let state = replay(createInitialRunStreamState(0), [submitted(0), activityStart, flushHello])

  state = runStreamReducer(
    state,
    frame({ kind: 'activity_end', activityId: 'act-1', status: 'failed', error: 'model exploded' }),
  )
  assert.equal(state.error, 'model exploded')
  assert.equal(state.done, false)
  assert.equal(state.phase, 'idle')
  assert.equal(selectIsWaiting(state, false), false, 'error suppresses the waiting bubble')

  const persisted: ChatMessage[] = [{ id: 'e', type: 'error', content: 'x', timestamp: 'now' }]
  assert.equal(selectHasPersistedRun(state, persisted), false, 'done=false blocks handover')

  state = runStreamReducer(state, { type: 'error_dismissed' })
  assert.equal(state.error, null)
})

test('abort: aborting is set on request and cleared by activity_end(aborted)', () => {
  let state = replay(createInitialRunStreamState(0), [submitted(0), activityStart])

  state = runStreamReducer(state, { type: 'abort_requested' })
  assert.equal(state.aborting, true)
  assert.equal(selectCanQueueMessage(state), false)

  state = runStreamReducer(
    state,
    frame({ kind: 'activity_end', activityId: 'act-1', status: 'aborted' }),
  )
  assert.equal(state.aborting, false)
  assert.equal(state.done, true, 'aborted still hands over to persisted history')
})

test('abort fallback and abort failure both release the aborting flag', () => {
  const base = replay(createInitialRunStreamState(0), [
    submitted(0),
    activityStart,
    { type: 'abort_requested' },
  ])

  const fallback = runStreamReducer(base, { type: 'abort_fallback_fired' })
  assert.equal(fallback.aborting, false)

  const failed = runStreamReducer(base, { type: 'abort_failed', error: 'no route' })
  assert.equal(failed.aborting, false)
  assert.equal(failed.error, 'no route')
})

test('edit-message branch: staged source count wins for the next submit only', () => {
  let state = createInitialRunStreamState(10)

  state = runStreamReducer(state, { type: 'branch_context_staged', sourceCount: 4 })
  assert.equal(state.stagedSourceCount, 4)

  state = runStreamReducer(state, submitted(10))
  assert.equal(state.sourceCountAtRunStart, 4, 'staged boundary wins')
  assert.equal(state.stagedSourceCount, null)

  state = runStreamReducer(state, submitted(12))
  assert.equal(state.sourceCountAtRunStart, 12, 'staged was consumed')
})

test('tool-only turn: handover accepts persisted process messages', () => {
  const state = replay(createInitialRunStreamState(1), [
    submitted(1),
    activityStart,
    frame({ kind: 'pi', event: { type: 'tool_call_delta', content: 'run x', title: 'bash' } }),
    activityEndCompleted,
  ])
  assert.equal(state.done, true)

  const persisted: ChatMessage[] = [
    { id: 'p1', type: 'user', content: 'hello', timestamp: 'now' },
    { id: 'p2', type: 'tool_call', content: 'run x', timestamp: 'now' },
  ]
  assert.equal(
    selectHasPersistedRun(state, persisted),
    true,
    'no assistant text in the tail → process rows suffice',
  )
})

test('process rows: thinking merges, bash merges per title, usage attaches', () => {
  let state = replay(createInitialRunStreamState(0), [
    submitted(0),
    activityStart,
    frame({ kind: 'pi', event: { type: 'thinking_delta', content: 'a' } }),
    frame({ kind: 'pi', event: { type: 'thinking_delta', content: 'b' } }),
    frame({ kind: 'pi', event: { type: 'bash_output', stream: 'stdout', content: '1' } }),
    frame({ kind: 'pi', event: { type: 'bash_output', stream: 'stdout', content: '2' } }),
    frame({ kind: 'pi', event: { type: 'bash_output', stream: 'stderr', content: '!' } }),
  ])
  assert.deepEqual(
    state.messages.map((message) => [message.type, message.title, message.content]),
    [
      ['thinking', 'Thinking', 'ab'],
      ['bash', 'stdout', '12'],
      ['bash', 'stderr', '!'],
    ],
  )
  assert.equal(state.phase, 'thinking')

  state = replay(state, [
    assistantStart,
    flushHello,
    frame({
      kind: 'pi',
      event: {
        type: 'usage',
        usage: { input: 10, output: 5, cacheRead: 1, cacheWrite: 2, totalTokens: 15 },
      },
    }),
  ])
  const assistantRow = state.messages.find((message) => message.id === 'assistant-1')
  assert.equal(
    assistantRow?.tokens,
    15,
    'usage without a messageId attaches to the latest assistant',
  )
  assert.deepEqual(assistantRow?.usage, {
    input: 10,
    output: 5,
    cacheRead: 1,
    cacheWrite: 2,
    cost: undefined,
  })
})

test('prompt rejection: already-running keeps queue affordances, others surface errors', () => {
  const base = replay(createInitialRunStreamState(0), [submitted(0)])

  const busy = runStreamReducer(base, {
    type: 'prompt_rejected',
    error: null,
    alreadyRunning: true,
  })
  assert.equal(busy.phase, 'idle')
  assert.equal(busy.optimisticUserMessage, null)
  assert.equal(busy.sdkRunning, true)
  assert.equal(selectCanQueueMessage(busy), true)

  const gone = runStreamReducer(base, {
    type: 'prompt_rejected',
    error: 'This session is no longer available.',
  })
  assert.equal(gone.error, 'This session is no longer available.')
  assert.equal(gone.sdkRunning, false)
})

test('defensive no-messageId delta carries its own content deterministically', () => {
  let state = replay(createInitialRunStreamState(0), [submitted(0), activityStart])

  state = runStreamReducer(
    state,
    frame({ kind: 'pi', event: { type: 'message_delta', content: 'raw text' } }),
  )
  assert.equal(state.messages.length, 1)
  assert.equal(state.messages[0]!.id, 'stream-assistant-0')
  assert.equal(state.messages[0]!.content, 'raw text')
  assert.equal(state.currentAssistantId, 'stream-assistant-0')

  state = runStreamReducer(
    state,
    frame({ kind: 'pi', event: { type: 'message_delta', content: ' more' } }),
  )
  assert.equal(state.messages.length, 1, 'follow-up deltas append to the current row')
  assert.equal(state.messages[0]!.content, 'raw text more')
})

test('session_reset returns to the initial state from any mid-run point', () => {
  const midRun = replay(createInitialRunStreamState(7), [
    submitted(7),
    activityStart,
    assistantStart,
    flushHello,
    { type: 'abort_requested' },
  ])

  const reset = runStreamReducer(midRun, { type: 'session_reset' })
  assert.deepEqual(reset, createInitialRunStreamState(0))
})

test('replaying the same action sequence twice yields identical states', () => {
  const actions: RunStreamAction[] = [
    submitted(2),
    { type: 'prompt_started', activityId: 'act-1' },
    activityStart,
    assistantStart,
    flushHello,
    assistantEnd,
    activityEndCompleted,
  ]
  const first = replay(createInitialRunStreamState(2), actions)
  const second = replay(createInitialRunStreamState(2), actions)
  assert.deepEqual(first, second, 'the reducer is deterministic — no wall clock, no refs')
})

// --- Auto-retry --------------------------------------------------------------

const transientError = frame({
  kind: 'pi',
  event: { type: 'error', message: 'Connection error.' },
})

const retryPending = frame({ kind: 'pi', event: { type: 'retry_pending' } })

function retryScheduled(attempt: number, maxAttempts = 5): RunStreamAction {
  return frame({
    kind: 'pi',
    event: {
      type: 'retry_scheduled',
      attempt,
      maxAttempts,
      delayMs: 1000,
      message: 'Connection error.',
    },
  })
}

function runningWithError() {
  return replay(createInitialRunStreamState(3), [
    submitted(3),
    activityStart,
    assistantStart,
    transientError,
  ])
}

test('a pending retry takes the error over, carrying its message', () => {
  const state = runStreamReducer(runningWithError(), retryPending)

  assert.equal(state.error, null, 'the error block yields to the retry notice')
  assert.deepEqual(state.retry, { attempt: 0, maxAttempts: 0, message: 'Connection error.' })
  assert.equal(selectIsWaiting(state, false), false, 'the notice replaces the waiting bubble')
})

test('retry_scheduled fills in the attempt counters', () => {
  const state = replay(runningWithError(), [retryPending, retryScheduled(1)])
  assert.deepEqual(state.retry, { attempt: 1, maxAttempts: 5, message: 'Connection error.' })

  const second = runStreamReducer(state, retryScheduled(2))
  assert.deepEqual(second.retry, { attempt: 2, maxAttempts: 5, message: 'Connection error.' })
  assert.equal(second.error, null)
})

test('retry_scheduled without a preceding retry_pending still opens the notice', () => {
  const state = replay(runningWithError(), [retryScheduled(1)])
  assert.equal(state.error, null)
  assert.equal(state.retry?.attempt, 1)
})

test('a succeeding retry clears both the notice and the error', () => {
  const state = replay(runningWithError(), [
    retryPending,
    retryScheduled(1),
    frame({ kind: 'pi', event: { type: 'retry_finished', success: true, attempt: 1 } }),
  ])

  assert.equal(state.retry, null)
  assert.equal(state.error, null)
})

test('an exhausted retry budget hands the failure back to the error block', () => {
  const state = replay(runningWithError(), [
    retryPending,
    retryScheduled(5),
    frame({
      kind: 'pi',
      event: {
        type: 'retry_finished',
        success: false,
        attempt: 5,
        finalError: 'Connection error.',
      },
    }),
  ])

  assert.equal(state.retry, null)
  assert.equal(state.error, 'Connection error.')
})

test('a retry_finished without a finalError falls back to the retried message', () => {
  const state = replay(runningWithError(), [
    retryPending,
    retryScheduled(5),
    frame({ kind: 'pi', event: { type: 'retry_finished', success: false, attempt: 5 } }),
  ])

  assert.equal(state.error, 'Connection error.')
})

test('activity_end drops a still-open retry notice for the real failure', () => {
  const state = replay(runningWithError(), [
    retryPending,
    retryScheduled(5),
    frame({
      kind: 'activity_end',
      activityId: 'act-1',
      status: 'failed',
      error: 'pi run failed.',
    }),
  ])

  assert.equal(state.retry, null, 'a settled activity can no longer be retrying')
  assert.equal(state.error, 'pi run failed.')
})

test('a new activity clears a retry left over from the previous one', () => {
  const state = replay(runningWithError(), [
    retryPending,
    frame({
      kind: 'activity_start',
      activityId: 'act-2',
      activityKind: 'prompt',
      startedAt: '2026-08-10T00:01:00.000Z',
    }),
  ])

  assert.equal(state.retry, null)
  assert.equal(state.error, null)
})

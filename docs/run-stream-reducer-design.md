# Run-Stream Reducer Design

Status: implemented — PR-1 ([lib/chat/run-stream-reducer.ts](../lib/chat/run-stream-reducer.ts) + replay tests) and PR-2 (chat-view adoption) are landed; §13 records where the implementation deviates from the original proposal.
中文版:[run-stream-reducer-design.zh-CN.md](run-stream-reducer-design.zh-CN.md)
Prerequisite: the self-healing session event stream transport
([lib/chat/session-event-stream.ts](../lib/chat/session-event-stream.ts)) is in place, so the
client's connection lifecycle is already owned outside the view. This design is
the second step: making the *state* driven by that stream equally principled.

## 1. Problem

`components/chat-view.tsx` derives everything about a live run from ten
separate `useState` cells plus five bookkeeping refs, mutated from six
different call sites (frame handler, submit, abort, clear, queue, reconcile
effects). The run lifecycle is a state machine in disguise:

- Transitions are scattered `setX()` groups that must be kept mutually
  consistent by hand (e.g. `beginActivity` touches 9 cells, `finishActivity`
  touches 8, `clearCurrentSession` touches 20+).
- Guard conditions are re-derived boolean soup (`isWaiting` combines four
  cells; a missed cell produces exactly the class of "stuck on thinking"
  bugs we just fixed at the transport level).
- Refs (`currentStreamingAssistantIdRef`, `streamMessageSequenceRef`,
  `sourceMessageCountAtRunStartRef`, `pendingSourceCountRef`) exist only to
  dodge stale closures — they are plain state that fell out of React's model.
- None of it is testable: the only way to exercise "reconnect replays
  activity_start mid-run" today is manual QA.

## 2. Goal / non-goals

**Goal.** One pure reducer owns every piece of live-run state. Frames, local
intents, and markdown flushes become actions. A recorded frame sequence can be
replayed in a unit test and asserted against at every step.

**Non-goals.**

- No external store library (zustand/redux). The state is scoped to one
  `ChatView` instance; `useReducer` is sufficient.
- The streaming-markdown assembler pipeline (rAF batching, mutable
  `StreamingMarkdownAssembler`) stays as-is. It is a performance layer, not
  state (see §6).
- History composition (`baseMessages`, `buildDisplayItems`,
  outline entries) stays as `useMemo` derivation; only its *inputs* move into
  the reducer.
- Branch/tree UI state (`selectedNodeId`, `branchMessages`, `branchPending`),
  composer state, and layout state stay in the component.

## 3. Architecture

```
SSE transport (SessionEventStream)          ← already self-healing
      │ RunStreamFrame
      ▼
frame dispatcher (thin, in chat-view)
      │            │
      │            └─ markdown commands ──→ useStreamingMarkdown (rAF, mutable)
      │                                          │ onFlushContent / onReplaceContent
      ▼                                          ▼
dispatch({type:'frame', …})            dispatch({type:'content_flushed', …})
dispatch(local intents: submit/abort/clear/…)
      │
      ▼
runStreamReducer(state, action) → RunStreamState        [pure core]
      │
      ├─ selectors → isRunningRun / isWaiting / canQueueMessage / …
      └─ effects layer (small useEffects reacting to state):
           done → router.refresh()
           handover ready → dispatch(handover) + resetStreamingMarkdown()
           activity settled → clear abort-fallback timer
```

Data flows one way. The markdown pipeline is commanded by the dispatcher and
feeds its batched output back as actions; it never reads reducer state.

## 4. State shape

```ts
// lib/chat/run-stream-reducer.ts
export type RunStreamPhase = 'idle' | 'starting' | 'thinking' | 'streaming'
// 'connecting' is dropped: nothing has written it since the SSE unification.

export interface RunStreamState {
  phase: RunStreamPhase
  activityId: string | null
  activityStartApplied: boolean // whether activity_start for activityId has been applied (§13)
  sdkRunning: boolean          // was sdkSessionRunning
  queueReady: boolean          // was sdkSessionQueueReady
  aborting: boolean            // was abortingRun
  error: string | null         // was streamError
  done: boolean                // was streamDone (post-run refresh pending)
  startedAt: number | null     // was streamStartedAt
  messages: ChatMessage[]      // was streamMessages (the live tail)
  optimisticUserMessage: ChatMessage | null   // was optimisticMessage

  // Former refs — plain state once the reducer removes the closure problem:
  currentAssistantId: string | null   // was currentStreamingAssistantIdRef
  latestAssistantId: string | null    // was latestStreamingAssistantIdRef
  messageSequence: number             // was streamMessageSequenceRef
  sourceCountAtRunStart: number       // was sourceMessageCountAtRunStartRef
  stagedSourceCount: number | null    // was pendingSourceCountRef
}

export const initialRunStreamState: RunStreamState
```

`queueingMessage` ('steer' | 'follow-up' | null) may be folded in as a
follow-up; it is excluded from the first migration to keep the diff reviewable.

## 5. Actions

```ts
export type RunStreamAction =
  // The entire server contract arrives through one action:
  | { type: 'frame'; frame: RunStreamFrame; at: number }

  // Local intents:
  | { type: 'prompt_submitted'; message: ChatMessage; sourceCount: number; at: number }
  | { type: 'prompt_started'; activityId: string | null } // POST response announced the id
  | { type: 'prompt_rejected'; error: string | null; alreadyRunning?: boolean }
  | { type: 'abort_requested' }
  | { type: 'abort_failed'; error: string }
  | { type: 'abort_fallback_fired' }
  | { type: 'branch_context_staged'; sourceCount: number }  // edit-message navigation
  | { type: 'session_reset' }        // clear-session and session switch
  | { type: 'handover_completed' }   // live tail reconciled into persisted history
  | { type: 'error_dismissed' }      // stream error auto-dismiss timeout
  | { type: 'stream_error_raised'; error: string }  // local failures (e.g. queueMessage POST)

  // Markdown pipeline output (batched by rAF in useStreamingMarkdown):
  | { type: 'content_flushed'; batch: readonly { messageId: string; content: string }[] }
  | { type: 'content_replaced'; messageId: string; content: string }
```

**Purity rule.** The reducer never calls `Date.now()`, `Math.random()`, or
reads refs. Every nondeterministic input (`at`, generated ids' seeds) rides in
the action payload; ids derive from `messageSequence`. This makes the reducer
safe under StrictMode double-invocation and makes replay tests exact.

## 6. The markdown dual channel

`message_delta` text is intentionally **not** applied to state by the `frame`
action. High-frequency deltas go through the existing rAF-batched assembler
(`useStreamingMarkdown`), whose flushed output returns as `content_flushed` /
`content_replaced` actions that upsert the assistant row. The reducer handles
the *rest* of each pi event synchronously (phase transitions, process rows,
usage, error, assistant start/end bookkeeping).

The dispatcher therefore does exactly two things per frame:

1. `dispatch({ type: 'frame', frame, at: Date.now() })`
2. Issue the matching markdown commands (`beginMessage`, `appendDelta`,
   `sealTextSegment`, `finishMessage`, `finishAll`, `reset`) — same calls the
   current `handlePiEvent` makes.

Markdown `reset` is scoped to the moments a new tail begins: `prompt_submitted`
(just before dispatch), the handover effect, and `session_reset`. It is
deliberately **not** issued on `activity_start` — a replayed start is a reducer
no-op (§7), and resetting the assemblers there would discard prefix text the
replayed deltas no longer carry. `finishAll` runs on `activity_end`, on a pi
`error` event, and on the abort-failure path.

One nuance moves into the reducer: today `appendStreamingAssistantDelta`
falls back to `startStreamingAssistant()` when no assistant id is current.
That fallback becomes: `content_flushed` upserts a row for an unknown
`messageId` (already the behavior of `applyStreamingContentBatch`), and
`frame`/`message_delta` assigns `currentAssistantId` when unset.

## 7. Key transition rules

| Action / frame                        | Transition (essentials)                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `prompt_submitted`                    | reset live fields; `phase='starting'`; `optimisticUserMessage`; `sourceCountAtRunStart = stagedSourceCount ?? sourceCount`; clear staged; `activityStartApplied=false` |
| `prompt_started`                      | `activityId=announced id; sdkRunning=true` (the POST response races the frame stream — see §13)                   |
| `frame:state` running=true            | `sdkRunning=true; queueReady=true; activityId ??= frame.activityId`; `phase: idle→thinking` (others keep)         |
| `frame:state` running=false           | `sdkRunning=false; queueReady=false; activityId=null; activityStartApplied=false; phase='idle'`                   |
| `frame:activity_start`                | **idempotent on the applied start**: same `activityId` *and* `activityStartApplied` → no-op (reconnect replay must not wipe the accumulated tail); otherwise → reset live fields, `phase='thinking'`, `startedAt=at`, `activityStartApplied=true` |
| `frame:activity_end` completed/aborted| settle `'streaming'` rows to `'now'`; `activityId=null; activityStartApplied=false; sdkRunning=false; queueReady=false; aborting=false; phase='idle'; done=true` |
| `frame:activity_end` failed           | as above but `error=frame.error ?? default; done=false`                                                           |
| `frame:pi assistant_message_start`    | `currentAssistantId = latestAssistantId = messageId ?? generated(seq)`                                            |
| `frame:pi assistant_message_end`      | settle that row to `'now'`; clear `currentAssistantId` if it matches                                              |
| `frame:pi thinking/tool/bash deltas`  | `phase='thinking'`; upsert process row (keep today's merge rules: consecutive `thinking` rows merge; `bash` rows merge per title) |
| `frame:pi message_delta`              | `phase='streaming'`; assign `currentAssistantId` if unset (content arrives via `content_flushed`)                 |
| `frame:pi usage`                      | attach `tokens`/`usage` to `messageId ?? latestAssistantId` row                                                   |
| `frame:pi error`                      | `error=message` (authoritative failure remains `activity_end`)                                                    |
| `content_flushed` / `content_replaced`| append-or-create assistant rows (`timestamp:'streaming'`)                                                         |
| `handover_completed`                  | `messages=[]; optimisticUserMessage=null; startedAt=null; done=false; phase='idle'; currentAssistantId=latestAssistantId=null` |
| `session_reset`                       | `initialRunStreamState` with `sourceCountAtRunStart=0`                                                            |

The `activity_start` idempotency row is the one deliberate behavior *change*:
today a replayed `activity_start` clears the tail and the replayed deltas
rebuild it (visible flicker); under the reducer the replay is a no-op followed
by duplicate-tolerant upserts. Everything else is a 1:1 translation of current
`setX` groups, locked in by tests before the UI is touched.

## 8. Selectors

```ts
export const selectIsStartingRun = (s) => s.phase === 'starting' && !s.activityId
export const selectIsRunningRun  = (s) => Boolean(s.activityId) || s.sdkRunning
export const selectCanQueueMessage = (s) => selectIsRunningRun(s) && s.queueReady && !s.aborting
export const selectRunProducedAssistantText = (s) =>
  s.messages.some((m) => m.type === 'assistant' && m.content)
export const selectIsWaiting = (s, hasPersistedRun: boolean) =>
  !s.error && !hasPersistedRun &&
  (s.phase !== 'idle' || s.sdkRunning) && s.messages.length === 0
export const selectHasPersistedRun = (s, sourceMessages: ChatMessage[]) =>
  s.done && hasPersistedAssistantResponse(sourceMessages, s.sourceCountAtRunStart, {
    acceptProcessMessages: !selectRunProducedAssistantText(s),
  })
```

Selectors are exported from the reducer module and unit-tested with it; the
component stops re-deriving any of these inline.

## 9. Effects layer (what stays as `useEffect`)

Side effects react to state; they never compute state:

- `state.done` → debounced `router.refresh()` (unchanged single-refresh rule).
- `selectHasPersistedRun(state, sourceMessages)` → `dispatch({type:'handover_completed'})`
  and `resetStreamingMarkdown()` (needs `sourceMessages` from server props, so
  it cannot live in the reducer).
- `state.error` → auto-dismiss timer → `dispatch({type:'error_dismissed'})`.
- Activity settled (`activityId` transitions to null) → clear the
  abort-fallback timer (replaces the imperative clear inside `finishActivity`).
- Scroll-follow and composer focus remain untouched.

## 10. Migration plan

Three reviewable steps; each leaves the app working.

1. **PR-1 — pure module + tests.** Add `lib/chat/run-stream-reducer.ts` and
   `run-stream-reducer.test.ts`. Encode *current* behavior (except the
   documented `activity_start` idempotency fix). No UI changes.
2. **PR-2 — adoption.** `useReducer` in chat-view; frame dispatcher replaces
   `handleFrame`/`handlePiEvent` bodies; submit/abort/clear/reconcile call
   sites dispatch intents; selectors replace inline derivations; delete the ten
   `useState` cells and five refs.
3. **PR-3 — cleanup (optional).** Fold `queueingMessage` in; drop the
   `'connecting'` phase from types; add a dev-only dispatch logger.

## 11. Test plan (PR-1)

Replay-style tests, each a frame/action sequence with assertions between steps:

- Golden path: submit → activity_start → assistant start → flush → assistant
  end → activity_end(completed) → handover. Assert `phase`, `isWaiting`,
  row contents at every step.
- Reconnect replay: duplicate `activity_start` + replayed deltas → tail not
  wiped, no duplicate rows.
- Mid-run attach: `state(running)` then flushes for an unknown assistant id →
  row upserted, `isWaiting` false.
- Failure: `activity_end(failed)` → error surfaced, `done=false`, no handover.
- Abort: `abort_requested` → `activity_end(aborted)` → `aborting` cleared.
- Edit-message branch: `branch_context_staged(n)` then `prompt_submitted` →
  `sourceCountAtRunStart === n`, staged cleared.
- Tool-only turn: no assistant text → `selectHasPersistedRun` accepts process
  messages (today's `acceptProcessMessages` rule).
- Process-row merges: consecutive thinking deltas merge; bash rows merge per
  title; usage attaches to the right row.
- `session_reset` returns to initial state from any mid-run point.

## 12. Risks

- **Behavior drift** — mitigated by PR-1 locking current semantics in tests
  before any UI change, and by the 1:1 transition table above.
- **Render frequency** — unchanged: deltas stay rAF-batched; one dispatch per
  frame replaces one-or-more `setState` calls per frame (React 18+ batches
  both identically).
- **Reducer purity regressions** — StrictMode double-invocation plus the
  replay tests fail loudly if `Date.now()`/refs sneak back in.

## 13. Implementation deltas (found during PR-1/PR-2)

Differences between this proposal and what landed, each forced by a real
interaction the design missed:

- **`activityStartApplied: boolean` joined the state.** The proposal keyed
  `activity_start` idempotency on "same `activityId`". That is wrong in the
  golden path: the POST response (`prompt_started`) announces the activity id
  *before* the frame stream delivers `activity_start`, so the real start frame
  matched the already-known id and was skipped — the run never left
  `'starting'`. The replay test caught this on first run. Idempotency now keys
  on "start applied", not "id seen": the flag is set false on
  `prompt_submitted`, true when a start frame is applied, and false again on
  `activity_end` / `state(running=false)`.
- **`prompt_started` action.** Implied but unlisted in §5: the POST success
  path needs its own intent to record the announced id and mark the SDK
  running (it cannot wait for the `state` frame).
- **`prompt_rejected` gained `alreadyRunning?: boolean`.** When the server
  rejects a prompt because another run holds the session, the client should
  reflect that run (`sdkRunning=true, queueReady=true`, no error) so
  steer/follow-up affordances light up instead of an error banner.
- **`stream_error_raised` action.** The dual of `error_dismissed`, used by
  local failure paths outside the frame stream (e.g. the queue-message POST
  failing). The proposal only allowed errors in via frames and
  `prompt_rejected`/`abort_failed`.
- **Markdown `reset` scope narrowed** (§6): reset happens at
  `prompt_submitted`/handover/`session_reset` only, never on `activity_start`,
  matching the start-frame idempotency.

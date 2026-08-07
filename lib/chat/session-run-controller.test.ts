import assert from 'node:assert/strict'
import test from 'node:test'
import { selectReplayFrames, type SequencedFrame } from './session-run-controller'

function frame(sequence: number, value: SequencedFrame['frame']): SequencedFrame {
  return { sequence, frame: value }
}

const completedActivity: SequencedFrame[] = [
  frame(1, {
    kind: 'activity_start',
    activityId: 'activity-1',
    activityKind: 'prompt',
    startedAt: '2026-08-07T00:00:00.000Z',
  }),
  frame(2, {
    kind: 'pi',
    event: { type: 'message_delta', content: 'old answer', messageId: 'assistant-1' },
  }),
  frame(3, { kind: 'activity_end', activityId: 'activity-1', status: 'completed' }),
]

test('does not replay completed assistant frames into a fresh idle view', () => {
  assert.deepEqual(selectReplayFrames(completedActivity, null), [])
})

test('replays only the current activity into a fresh view opened mid-run', () => {
  const currentStart = frame(4, {
    kind: 'activity_start',
    activityId: 'activity-2',
    activityKind: 'prompt',
    startedAt: '2026-08-07T00:01:00.000Z',
  })
  const currentDelta = frame(5, {
    kind: 'pi',
    event: { type: 'message_delta', content: 'live answer', messageId: 'assistant-2' },
  })

  assert.deepEqual(
    selectReplayFrames([...completedActivity, currentStart, currentDelta], 'activity-2'),
    [currentStart, currentDelta],
  )
})

test('resumes from a cursor without replaying frames the client already handled', () => {
  const end = frame(6, {
    kind: 'activity_end',
    activityId: 'activity-2',
    status: 'completed',
  })
  const buffer = [
    ...completedActivity,
    frame(4, {
      kind: 'activity_start',
      activityId: 'activity-2',
      activityKind: 'prompt',
      startedAt: '2026-08-07T00:01:00.000Z',
    }),
    frame(5, {
      kind: 'pi',
      event: { type: 'message_delta', content: 'tail', messageId: 'assistant-2' },
    }),
    end,
  ]

  assert.deepEqual(selectReplayFrames(buffer, null, 5), [end])
})

test('falls back to fresh-view behavior when a reconnect cursor was pruned', () => {
  const prunedBuffer = completedActivity.map((entry) => ({
    ...entry,
    sequence: entry.sequence + 100,
  }))

  assert.deepEqual(selectReplayFrames(prunedBuffer, null, 4), [])
})

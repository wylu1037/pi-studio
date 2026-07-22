import assert from 'node:assert/strict'
import test from 'node:test'
import { formatUtcTimestamp, summarizeSessionUsage } from './session-branches'

test('formats millisecond message timestamps as UTC ISO 8601', () => {
  assert.equal(formatUtcTimestamp(1784096998445), '2026-07-15T06:29:58.445Z')
  assert.equal(formatUtcTimestamp('1784096998445'), '2026-07-15T06:29:58.445Z')
})

test('normalizes parseable date strings and preserves invalid values', () => {
  assert.equal(formatUtcTimestamp('2026-07-15T14:29:58.445+08:00'), '2026-07-15T06:29:58.445Z')
  assert.equal(formatUtcTimestamp('unknown'), 'unknown')
})

test('aggregates SDK message token usage and cost for session summaries', () => {
  assert.deepEqual(
    summarizeSessionUsage([
      {
        id: 'assistant-1',
        type: 'assistant',
        content: 'First',
        timestamp: 'now',
        tokens: 30,
        usage: {
          input: 20,
          output: 10,
          cacheRead: 0,
          cacheWrite: 0,
          cost: { total: 0.012 },
        },
      },
      {
        id: 'assistant-2',
        type: 'assistant',
        content: 'Second',
        timestamp: 'later',
        usage: {
          input: 5,
          output: 7,
          cacheRead: 0,
          cacheWrite: 0,
          cost: { input: 0.001, output: 0.002 },
        },
      },
    ]),
    { totalTokens: 42, totalCost: 0.015 },
  )
})

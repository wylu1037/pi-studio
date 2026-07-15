import assert from 'node:assert/strict'
import test from 'node:test'
import { formatUtcTimestamp } from './session-branches'

test('formats millisecond message timestamps as UTC ISO 8601', () => {
  assert.equal(formatUtcTimestamp(1784096998445), '2026-07-15T06:29:58.445Z')
  assert.equal(formatUtcTimestamp('1784096998445'), '2026-07-15T06:29:58.445Z')
})

test('normalizes parseable date strings and preserves invalid values', () => {
  assert.equal(formatUtcTimestamp('2026-07-15T14:29:58.445+08:00'), '2026-07-15T06:29:58.445Z')
  assert.equal(formatUtcTimestamp('unknown'), 'unknown')
})

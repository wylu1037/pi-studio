import assert from 'node:assert/strict'
import test from 'node:test'
import { percentile } from './math'

test('calculates nearest-rank percentiles without mutating input', () => {
  const values = [50, 10, 40, 20, 30]

  assert.equal(percentile(values, 0.5), 30)
  assert.equal(percentile(values, 0.95), 50)
  assert.deepEqual(values, [50, 10, 40, 20, 30])
})

test('handles empty and boundary percentile inputs', () => {
  assert.equal(percentile([], 0.95), null)
  assert.equal(percentile([10, 20, 30], 0), 10)
  assert.equal(percentile([10, 20, 30], 1), 30)
})

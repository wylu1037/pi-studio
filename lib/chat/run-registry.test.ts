import assert from 'node:assert/strict'
import test from 'node:test'
import {
  abortRun,
  isRunAbortRequested,
  prepareRun,
  registerRun,
  unregisterRun,
} from './run-registry'

test('preserves an abort request until the run registers its handler', () => {
  const runId = 'late-register-run'
  let aborted = false

  prepareRun(runId)
  assert.equal(abortRun(runId), true)
  assert.equal(isRunAbortRequested(runId), true)
  registerRun(runId, () => {
    aborted = true
  })

  assert.equal(aborted, true)
  unregisterRun(runId)
  assert.equal(isRunAbortRequested(runId), false)
})

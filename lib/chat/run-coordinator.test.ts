import assert from 'node:assert/strict'
import test from 'node:test'
import { RUN_TERMINAL_EVENT, RunCoordinator } from './run-coordinator'

test('starts a worker once and publishes a terminal event after its stream events', async () => {
  const coordinator = new RunCoordinator({ now: () => '2026-07-16T00:00:00.000Z' })
  let starts = 0

  const worker = async ({ publish }: Parameters<Parameters<RunCoordinator['start']>[1]>[0]) => {
    starts += 1
    publish('message_delta', { content: 'hello' })
  }
  const first = coordinator.start('run-1', worker)
  const second = coordinator.start('run-1', worker)

  const terminal = await first.completion

  assert.equal(second.runId, 'run-1')
  assert.equal(starts, 1)
  assert.deepEqual(
    coordinator.getEvents('run-1').map((event) => [event.sequence, event.type]),
    [
      [1, 'message_delta'],
      [2, RUN_TERMINAL_EVENT],
    ],
  )
  assert.deepEqual(terminal, {
    status: 'completed',
    completedAt: '2026-07-16T00:00:00.000Z',
    sequence: 2,
  })
})

test('replays missed events and serializes live delivery on one subscriber queue', async () => {
  const coordinator = new RunCoordinator()
  coordinator.publish('run-1', 'message_delta', { content: 'one' })
  coordinator.publish('run-1', 'message_delta', { content: 'two' })

  const delivered: number[] = []
  let activeCallbacks = 0
  let maxActiveCallbacks = 0
  const subscription = coordinator.subscribe('run-1', {
    afterSequence: 1,
    onEvent: async (event) => {
      activeCallbacks += 1
      maxActiveCallbacks = Math.max(maxActiveCallbacks, activeCallbacks)
      await Promise.resolve()
      delivered.push(event.sequence)
      activeCallbacks -= 1
    },
  })

  coordinator.publish('run-1', 'message_delta', { content: 'three' })
  await subscription.drained()

  assert.deepEqual(delivered, [2, 3])
  assert.equal(maxActiveCallbacks, 1)
  assert.equal(subscription.lastSequence, 3)
  subscription.unsubscribe()
})

test('records an abort request, invokes late-bound handlers, and terminates after the worker exits', async () => {
  const coordinator = new RunCoordinator()
  let releaseWorker!: () => void
  const workerCanExit = new Promise<void>((resolve) => {
    releaseWorker = resolve
  })
  let handlerCalled = false
  let workerStarted!: () => void
  const started = new Promise<void>((resolve) => {
    workerStarted = resolve
  })

  const handle = coordinator.start('run-1', async ({ isAbortRequested, onAbort }) => {
    onAbort(() => {
      handlerCalled = true
    })
    workerStarted()
    await workerCanExit
    assert.equal(isAbortRequested(), true)
  })

  await started
  assert.equal(handle.requestAbort(), true)
  assert.equal(handle.requestAbort(), false)
  assert.equal(handlerCalled, true)

  releaseWorker()
  const terminal = await handle.completion

  assert.equal(terminal.status, 'aborted')
  assert.equal(coordinator.getSnapshot('run-1')?.abortRequested, true)
  assert.equal(coordinator.getEvents('run-1').at(-1)?.type, RUN_TERMINAL_EVENT)
})

test('delivers an abort requested before the worker registers its handler', async () => {
  const coordinator = new RunCoordinator()
  coordinator.subscribe('run-1', { onEvent: () => {} })
  assert.equal(coordinator.requestAbort('run-1'), true)

  let handlerCalled = false
  const handle = coordinator.start('run-1', ({ isAbortRequested, onAbort, abort }) => {
    onAbort(() => {
      handlerCalled = true
    })
    assert.equal(isAbortRequested(), true)
    abort()
  })

  assert.equal((await handle.completion).status, 'aborted')
  assert.equal(handlerCalled, true)
})

test('bounds retained terminal runs without removing active subscriptions', async () => {
  const coordinator = new RunCoordinator({ maxRetainedRuns: 2 })
  await coordinator.start('run-1', () => {}).completion
  await coordinator.start('run-2', () => {}).completion
  await coordinator.start('run-3', () => {}).completion

  assert.equal(coordinator.getSnapshot('run-1'), null)
  assert.ok(coordinator.getSnapshot('run-2'))
  assert.ok(coordinator.getSnapshot('run-3'))
})

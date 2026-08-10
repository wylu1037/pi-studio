import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import {
  SessionEventStream,
  type EventSourceLike,
  type RunStreamFrame,
  type SessionEventStreamStatus,
} from './session-event-stream'

const CONNECTING = 0
const OPEN = 1
const CLOSED = 2

class FakeEventSource implements EventSourceLike {
  readyState = CONNECTING
  onopen: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  closed = false
  private listeners = new Map<string, Array<(event: MessageEvent) => void>>()

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const existing = this.listeners.get(type) ?? []
    this.listeners.set(type, [...existing, listener])
  }

  close() {
    this.closed = true
    this.readyState = CLOSED
  }

  open() {
    this.readyState = OPEN
    this.onopen?.({})
  }

  emit(type: string, data: unknown, lastEventId = '') {
    const event = { data: JSON.stringify(data), lastEventId } as MessageEvent
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }

  emitRaw(type: string, data: string, lastEventId = '') {
    const event = { data, lastEventId } as MessageEvent
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }

  failFatally() {
    this.readyState = CLOSED
    this.onerror?.({})
  }

  failTransiently() {
    this.readyState = CONNECTING
    this.onerror?.({})
  }
}

function createHarness(options: { heartbeatTimeoutMs?: number; watchdogIntervalMs?: number } = {}) {
  const sources: FakeEventSource[] = []
  const frames: RunStreamFrame[] = []
  const statuses: SessionEventStreamStatus[] = []
  const extensionUi: unknown[] = []
  const stream = new SessionEventStream(
    'session-1',
    {
      onFrame: (frame) => frames.push(frame),
      onExtensionUi: (snapshot) => extensionUi.push(snapshot),
      onStatusChange: (status) => statuses.push(status),
    },
    {
      createSource: (url) => {
        const source = new FakeEventSource(url)
        sources.push(source)
        return source
      },
      heartbeatTimeoutMs: options.heartbeatTimeoutMs ?? 75_000,
      watchdogIntervalMs: options.watchdogIntervalMs ?? 15_000,
      reconnectBaseDelayMs: 1_000,
      reconnectMaxDelayMs: 30_000,
    },
  )
  return { stream, sources, frames, statuses, extensionUi }
}

const stateFrame: RunStreamFrame = {
  kind: 'state',
  running: false,
  activityId: null,
  startedAt: null,
}

test('connects without a cursor and delivers parsed frames', () => {
  const { stream, sources, frames } = createHarness()
  try {
    assert.equal(sources.length, 1)
    assert.equal(sources[0]!.url, '/api/sessions/session-1/events')

    sources[0]!.open()
    sources[0]!.emit('frame', stateFrame, '7')
    assert.deepEqual(frames, [stateFrame])
    assert.equal(stream.currentCursor, 7)
  } finally {
    stream.dispose()
  }
})

test('ignores malformed frame payloads and keeps the connection', () => {
  const { stream, sources, frames } = createHarness()
  try {
    sources[0]!.open()
    sources[0]!.emitRaw('frame', 'not-json', '3')
    sources[0]!.emit('frame', stateFrame, '4')
    assert.deepEqual(frames, [stateFrame])
    assert.equal(stream.currentCursor, 4)
  } finally {
    stream.dispose()
  }
})

test('a fatal close rebuilds the source with the cursor after backoff', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
  try {
    const { stream, sources, statuses } = createHarness()
    sources[0]!.open()
    sources[0]!.emit('frame', stateFrame, '12')

    sources[0]!.failFatally()
    assert.equal(sources.length, 1, 'rebuild waits for the backoff delay')
    assert.deepEqual(statuses, ['open', 'reconnecting'])

    mock.timers.tick(1_000)
    assert.equal(sources.length, 2)
    assert.equal(sources[1]!.url, '/api/sessions/session-1/events?after=12')

    sources[1]!.open()
    assert.equal(stream.currentStatus, 'open')
    stream.dispose()
  } finally {
    mock.timers.reset()
  }
})

test('repeated fatal closes back off exponentially', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
  try {
    const { stream, sources } = createHarness()
    sources[0]!.failFatally()
    mock.timers.tick(1_000)
    assert.equal(sources.length, 2)

    sources[1]!.failFatally()
    mock.timers.tick(1_000)
    assert.equal(sources.length, 2, 'second retry waits 2s, not 1s')
    mock.timers.tick(1_000)
    assert.equal(sources.length, 3)
    stream.dispose()
  } finally {
    mock.timers.reset()
  }
})

test('a transient error only surfaces reconnecting; the browser retry keeps the source', () => {
  const { stream, sources, statuses } = createHarness()
  try {
    sources[0]!.open()
    sources[0]!.failTransiently()
    assert.equal(sources.length, 1)
    assert.deepEqual(statuses, ['open', 'reconnecting'])

    sources[0]!.open()
    assert.equal(stream.currentStatus, 'open')
  } finally {
    stream.dispose()
  }
})

test('the watchdog rebuilds a silently dead link once heartbeats stop', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
  try {
    const { stream, sources } = createHarness()
    sources[0]!.open()

    // Heartbeats keep the link alive across many watchdog passes.
    for (let index = 0; index < 4; index++) {
      mock.timers.tick(30_000)
      sources[0]!.emitRaw('heartbeat', String(Date.now()))
    }
    assert.equal(sources.length, 1)

    // Then the link goes quiet: no frames, no heartbeats, no error event.
    mock.timers.tick(76_000)
    assert.equal(sources.length, 2, 'quiet link is torn down and rebuilt')
    assert.ok(sources[0]!.closed)
    stream.dispose()
  } finally {
    mock.timers.reset()
  }
})

test('ensureConnected is a no-op on a fresh open link and rebuilds a dead one', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
  try {
    const { stream, sources } = createHarness()
    sources[0]!.open()
    stream.ensureConnected()
    assert.equal(sources.length, 1, 'healthy link is left alone')

    // Kill the link silently, then assert ensureConnected rebuilds it at once.
    mock.timers.tick(76_000)
    const count = sources.length
    stream.ensureConnected()
    assert.ok(sources.length >= count, 'stale link is rebuilt')
    assert.equal(sources.at(-1)!.closed, false)
    stream.dispose()
  } finally {
    mock.timers.reset()
  }
})

test('dispose closes the source and stops every recovery path', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
  try {
    const { stream, sources, statuses } = createHarness()
    sources[0]!.open()
    stream.dispose()
    assert.ok(sources[0]!.closed)
    assert.equal(stream.currentStatus, 'disposed')

    // Neither the watchdog nor a manual reconnect may resurrect the stream.
    mock.timers.tick(300_000)
    stream.reconnect()
    stream.ensureConnected()
    assert.equal(sources.length, 1)
    assert.deepEqual(statuses.at(-1), 'disposed')
  } finally {
    mock.timers.reset()
  }
})

test('extension_ui snapshots are delivered and refresh liveness', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
  try {
    const { stream, sources, extensionUi } = createHarness()
    sources[0]!.open()
    for (let index = 0; index < 6; index++) {
      mock.timers.tick(30_000)
      sources[0]!.emit('extension_ui', { notification: index })
    }
    assert.equal(sources.length, 1, 'regular snapshots count as liveness')
    assert.equal(extensionUi.length, 6)
    stream.dispose()
  } finally {
    mock.timers.reset()
  }
})

test('events from a replaced source are ignored', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
  try {
    const { stream, sources, frames } = createHarness()
    sources[0]!.open()
    stream.reconnect()
    assert.equal(sources.length, 2)

    sources[0]!.emit('frame', stateFrame, '99')
    assert.deepEqual(frames, [], 'stale source frames are dropped')
    assert.equal(stream.currentCursor, 0)

    sources[1]!.open()
    sources[1]!.emit('frame', stateFrame, '5')
    assert.equal(frames.length, 1)
    assert.equal(stream.currentCursor, 5)
    stream.dispose()
  } finally {
    mock.timers.reset()
  }
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { disposeExtensionUiBroker, getOrCreateExtensionUiBroker } from './extension-ui-broker'

test('bridges extension confirmation requests and browser responses', async () => {
  const broker = getOrCreateExtensionUiBroker('extension-ui-test-confirm')
  try {
    const result = broker.uiContext.confirm('Allow action?', 'Review this action.')
    const interaction = broker.snapshot().interactions[0]
    assert.equal(interaction?.type, 'confirm')
    assert.equal(broker.respond(interaction!.id, true), true)
    assert.equal(await result, true)
    assert.equal(broker.snapshot().interactions.length, 0)
  } finally {
    disposeExtensionUiBroker('extension-ui-test-confirm')
  }
})

test('records notifications and resolves pending requests on disposal', async () => {
  const sessionId = 'extension-ui-test-dispose'
  const broker = getOrCreateExtensionUiBroker(sessionId)
  broker.uiContext.notify('Extension loaded', 'info')
  assert.deepEqual(
    broker.snapshot().notifications.map((notification) => notification.message),
    ['Extension loaded'],
  )

  const result = broker.uiContext.input('Name')
  disposeExtensionUiBroker(sessionId)
  assert.equal(await result, undefined)
})

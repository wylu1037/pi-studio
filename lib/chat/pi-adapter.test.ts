import assert from 'node:assert/strict'
import test from 'node:test'
import { createModelRuntimeSignature } from './pi-adapter'
import { createPiRunEventParser, parseSdkEvent } from './pi-events'

const usage = {
  input: 120,
  output: 40,
  cacheRead: 20,
  cacheWrite: 0,
  totalTokens: 180,
}

test('model runtime signature changes with provider connection or model configuration', () => {
  const base = [
    {
      id: 'provider-a',
      name: 'Provider A',
      baseUrl: 'https://api.example.com/v1',
      api: 'openai-responses',
      apiKey: 'key-a',
      headers: { 'X-Tenant': 'one', Authorization: 'Bearer token' },
      models: [{ id: 'model-a', input: ['text'] as Array<'text' | 'image'> }],
    },
  ]

  const reordered = [
    {
      ...base[0],
      headers: { Authorization: 'Bearer token', 'X-Tenant': 'one' },
    },
  ]
  const changedUrl = [{ ...base[0], baseUrl: 'https://api.example.com/v2' }]
  const changedModel = [
    {
      ...base[0],
      models: [{ id: 'model-b', input: ['text'] as Array<'text' | 'image'> }],
    },
  ]

  assert.equal(createModelRuntimeSignature(base), createModelRuntimeSignature(reordered))
  assert.notEqual(createModelRuntimeSignature(base), createModelRuntimeSignature(changedUrl))
  assert.notEqual(createModelRuntimeSignature(base), createModelRuntimeSignature(changedModel))
})

test('uses SDK text deltas across assistant messages separated by a tool call', () => {
  const sdkEvents = [
    { type: 'message_start', message: { role: 'assistant', content: [] } },
    messageUpdate('我会查', { type: 'text_delta', delta: '我会查' }),
    messageUpdate('我会查权威来源', { type: 'text_delta', delta: '权威来源' }),
    messageUpdate('我会查权威来源', {
      type: 'toolcall_start',
      partial: toolCall('call-1', 'tavily-search', {}),
    }),
    messageUpdate('我会查权威来源', {
      type: 'toolcall_delta',
      delta: '{"query":"世界杯',
    }),
    messageUpdate('我会查权威来源', {
      type: 'toolcall_end',
      toolCall: toolCall('call-1', 'tavily-search', { query: '世界杯四强' }),
    }),
    { type: 'message_end', message: { role: 'assistant', content: [], usage } },
    {
      type: 'message_end',
      message: {
        role: 'toolResult',
        toolName: 'tavily-search',
        content: [{ type: 'text', text: '搜索完成' }],
      },
    },
    { type: 'message_start', message: { role: 'assistant', content: [] } },
    messageUpdate('搜索结果已经确认', { type: 'text_delta', delta: '搜索结果已经确认' }),
    messageUpdate('搜索结果已经确认。', { type: 'text_delta', delta: '。' }),
    { type: 'message_end', message: { role: 'assistant', content: [], usage } },
  ]

  const events = sdkEvents.flatMap(parseSdkEvent)

  assert.equal(
    events
      .filter((event) => event.type === 'message_delta')
      .map((event) => event.content)
      .join(''),
    '我会查权威来源搜索结果已经确认。',
  )
  assert.equal(events.filter((event) => event.type === 'tool_call_delta').length, 1)
  assert.equal(events.filter((event) => event.type === 'tool_result_delta').length, 1)
  assert.equal(events.filter((event) => event.type === 'assistant_message_start').length, 2)
  assert.equal(events.filter((event) => event.type === 'assistant_message_end').length, 2)
})

test('emits thinking deltas and final usage without replaying message snapshots', () => {
  const events = [
    messageUpdate('', { type: 'thinking_delta', delta: '分析' }),
    messageUpdate('', { type: 'thinking_delta', delta: '完成' }),
    messageUpdate('答案', { type: 'text_delta', delta: '答案' }),
    messageUpdate('答案', { type: 'done', message: { role: 'assistant', usage } }),
    { type: 'message_end', message: { role: 'assistant', content: [], usage } },
  ].flatMap(parseSdkEvent)

  assert.equal(
    events
      .filter((event) => event.type === 'thinking_delta')
      .map((event) => event.content)
      .join(''),
    '分析完成',
  )
  assert.equal(
    events
      .filter((event) => event.type === 'message_delta')
      .map((event) => event.content)
      .join(''),
    '答案',
  )
  assert.ok(events.some((event) => event.type === 'usage' && event.usage.totalTokens === 180))
})

test('adds stable assistant IDs, text boundaries, and usage ownership for one run', () => {
  const parse = createPiRunEventParser({ runId: 'run-42' })
  const responseId = 'provider-response-7'
  const events = [
    { type: 'message_start', message: { role: 'assistant', responseId, content: [] } },
    messageUpdate('', { type: 'text_start', contentIndex: 2 }, { responseId }),
    messageUpdate('Hello', { type: 'text_delta', contentIndex: 2, delta: 'Hello' }, { responseId }),
    messageUpdate(
      'Hello world',
      { type: 'text_delta', contentIndex: 2, delta: ' world' },
      { responseId },
    ),
    messageUpdate(
      'Hello world',
      {
        type: 'text_end',
        contentIndex: 2,
        content: 'Hello world',
      },
      { responseId },
    ),
    {
      type: 'message_end',
      message: { role: 'assistant', responseId, stopReason: 'stop', content: [], usage },
    },
  ].flatMap(parse)

  const messageId = 'run-42:response:provider-response-7'
  assert.deepEqual(events[0], {
    type: 'assistant_message_start',
    messageId,
    responseId,
  })
  assert.deepEqual(
    events
      .filter((event) => event.type === 'message_delta')
      .map(({ messageId: eventMessageId, contentIndex, content }) => ({
        messageId: eventMessageId,
        contentIndex,
        content,
      })),
    [
      { messageId, contentIndex: 2, content: 'Hello' },
      { messageId, contentIndex: 2, content: ' world' },
    ],
  )
  assert.deepEqual(
    events.filter((event) => event.type === 'assistant_text_end'),
    [
      {
        type: 'assistant_text_end',
        messageId,
        contentIndex: 2,
        content: 'Hello world',
      },
    ],
  )
  assert.deepEqual(
    events.find((event) => event.type === 'usage'),
    { type: 'usage', usage, messageId },
  )
  assert.deepEqual(events.at(-1), {
    type: 'assistant_message_end',
    messageId,
    responseId,
    stopReason: 'stop',
  })
})

test('creates coherent implicit assistant starts and closes unended text segments', () => {
  const parse = createPiRunEventParser({ runId: 'run-implicit' })
  const events = [
    messageUpdate('first', { type: 'text_delta', contentIndex: 3, delta: 'first' }),
    messageUpdate('first', { type: 'text_end', contentIndex: 3, content: 'first' }),
    { type: 'message_end', message: { role: 'assistant', content: [] } },
    messageUpdate('second', { type: 'text_delta', contentIndex: 0, delta: 'second' }),
    { type: 'message_end', message: { role: 'assistant', content: [] } },
  ].flatMap(parse)

  assert.deepEqual(
    events
      .filter((event) => event.type === 'assistant_message_start')
      .map((event) => event.messageId),
    ['run-implicit:assistant:1', 'run-implicit:assistant:2'],
  )
  assert.deepEqual(
    events
      .filter((event) => event.type === 'assistant_text_end')
      .map(({ messageId, contentIndex }) => ({ messageId, contentIndex })),
    [
      { messageId: 'run-implicit:assistant:1', contentIndex: 3 },
      { messageId: 'run-implicit:assistant:2', contentIndex: 0 },
    ],
  )

  const implicitTextEnd = events.findIndex(
    (event) =>
      event.type === 'assistant_text_end' && event.messageId === 'run-implicit:assistant:2',
  )
  const secondMessageEnd = events.findIndex(
    (event) =>
      event.type === 'assistant_message_end' && event.messageId === 'run-implicit:assistant:2',
  )
  assert.ok(implicitTextEnd >= 0)
  assert.ok(implicitTextEnd < secondMessageEnd)
})

test('keeps parseSdkEvent stateless for legacy callers', () => {
  assert.deepEqual(
    parseSdkEvent(
      messageUpdate('legacy', { type: 'text_delta', contentIndex: 4, delta: 'legacy' }),
    ),
    [{ type: 'message_delta', content: 'legacy' }],
  )
  assert.deepEqual(
    parseSdkEvent(messageUpdate('legacy', { type: 'text_end', contentIndex: 4 })),
    [],
  )
})

function messageUpdate(
  content: string,
  assistantMessageEvent: Record<string, unknown>,
  messageFields: Record<string, unknown> = {},
) {
  return {
    type: 'message_update',
    message: {
      role: 'assistant',
      content: content ? [{ type: 'text', text: content }] : [],
      ...messageFields,
    },
    assistantMessageEvent,
  }
}

function toolCall(id: string, name: string, args: Record<string, unknown>) {
  return { type: 'toolCall', id, name, arguments: args }
}

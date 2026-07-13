import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSdkEvent } from './pi-events'

const usage = {
  input: 120,
  output: 40,
  cacheRead: 20,
  cacheWrite: 0,
  totalTokens: 180,
}

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

function messageUpdate(content: string, assistantMessageEvent: Record<string, unknown>) {
  return {
    type: 'message_update',
    message: {
      role: 'assistant',
      content: content ? [{ type: 'text', text: content }] : [],
    },
    assistantMessageEvent,
  }
}

function toolCall(id: string, name: string, args: Record<string, unknown>) {
  return { type: 'toolCall', id, name, arguments: args }
}

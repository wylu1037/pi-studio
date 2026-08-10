import assert from 'node:assert/strict'
import test from 'node:test'
import { formatUtcTimestamp, mapContextMessages, summarizeSessionUsage } from './session-branches'

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

type SdkContextMessage = Parameters<typeof mapContextMessages>[0][number]

function sdkUser(text: string): SdkContextMessage {
  return { role: 'user', content: text, timestamp: 1784096998445 } as SdkContextMessage
}

function sdkAssistant(text: string): SdkContextMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    timestamp: 1784096998445,
  } as SdkContextMessage
}

function sdkToolResult(name: string): SdkContextMessage {
  return {
    role: 'toolResult',
    toolCallId: `${name}-call`,
    toolName: name,
    isError: false,
    content: [{ type: 'text', text: `${name} output` }],
    timestamp: 1784096998445,
  } as SdkContextMessage
}

test('maps the full history when no run is live', () => {
  const mapped = mapContextMessages([sdkUser('ask'), sdkAssistant('answer')])

  assert.deepEqual(
    mapped.map((message) => [message.type, message.content]),
    [
      ['user', 'ask'],
      ['assistant', 'answer'],
    ],
  )
})

test('trims the running turn written past the live-run boundary', () => {
  const mapped = mapContextMessages(
    [
      sdkUser('ask'),
      sdkAssistant('answer'),
      sdkUser('follow-up'),
      sdkAssistant('partial tool turn'),
      sdkToolResult('read_file'),
    ],
    2,
  )

  assert.deepEqual(
    mapped.map((message) => [message.type, message.content]),
    [
      ['user', 'ask'],
      ['assistant', 'answer'],
      ['user', 'follow-up'],
    ],
  )
})

test('keeps the previous completed reply when the run has persisted nothing yet', () => {
  const messages = [sdkUser('ask'), sdkAssistant('answer')]

  assert.equal(mapContextMessages(messages, 2).length, 2)
})

test('keeps user messages steered into the running turn', () => {
  const mapped = mapContextMessages(
    [sdkUser('ask'), sdkAssistant('working'), sdkUser('steer'), sdkToolResult('bash')],
    1,
  )

  assert.deepEqual(
    mapped.map((message) => [message.type, message.content]),
    [
      ['user', 'ask'],
      ['user', 'steer'],
    ],
  )
})

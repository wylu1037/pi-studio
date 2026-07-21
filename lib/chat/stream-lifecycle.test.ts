import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatMessage } from '@/lib/types'
import { hasPersistedAssistantResponse, hasPersistedUserMessage } from './stream-lifecycle'

function message(id: string, type: ChatMessage['type']): ChatMessage {
  return { id, type, content: id, timestamp: 'now' }
}

test('does not treat a newly persisted user message as a persisted assistant response', () => {
  const messages = [message('existing', 'assistant'), message('new-user', 'user')]

  assert.equal(hasPersistedAssistantResponse(messages, 1), false)
})

test('waits for the assistant response instead of an intermediate process message', () => {
  const messages = [
    message('new-user', 'user'),
    message('thinking', 'thinking'),
    message('tool', 'tool_call'),
  ]

  assert.equal(hasPersistedAssistantResponse(messages, 0), false)
  assert.equal(
    hasPersistedAssistantResponse([...messages, message('answer', 'assistant')], 0),
    true,
  )
})

test('accepts a persisted error as the terminal assistant response', () => {
  assert.equal(hasPersistedAssistantResponse([message('error', 'error')], 0), true)
})

test('does not match an identical user message from before the current run', () => {
  const existing = { ...message('existing', 'user'), content: 'repeat me' }
  const optimistic = { ...message('optimistic', 'user'), content: 'repeat me' }

  assert.equal(hasPersistedUserMessage([existing], 1, optimistic), false)
})

test('matches an identical user message persisted during the current run', () => {
  const existing = { ...message('existing', 'user'), content: 'repeat me' }
  const persisted = { ...message('persisted', 'user'), content: 'repeat me' }
  const optimistic = { ...message('optimistic', 'user'), content: 'repeat me' }

  assert.equal(hasPersistedUserMessage([existing, persisted], 1, optimistic), true)
})

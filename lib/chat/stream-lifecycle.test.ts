import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatMessage } from '@/lib/types'
import {
  hasPersistedAssistantResponse,
  hasPersistedUserMessage,
  selectPersistedHistory,
} from './stream-lifecycle'

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

test('hands a turn that produced no assistant text over on a process message', () => {
  const messages = [
    message('new-user', 'user'),
    message('thinking', 'thinking'),
    message('tool', 'tool_call'),
  ]

  assert.equal(hasPersistedAssistantResponse(messages, 0, { acceptProcessMessages: true }), true)
})

test('does not hand over on a process message before anything of the run persisted', () => {
  const messages = [message('old-answer', 'assistant'), message('new-user', 'user')]

  assert.equal(hasPersistedAssistantResponse(messages, 1, { acceptProcessMessages: true }), false)
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

test('keeps the full history when no live tail is on screen', () => {
  const messages = [message('ask', 'user'), message('thinking', 'thinking')]

  assert.deepEqual(selectPersistedHistory(messages, 0, false), messages)
})

test('keeps the array identity when the live run has persisted nothing yet', () => {
  const messages = [message('old-answer', 'assistant'), message('ask', 'user')]

  assert.equal(selectPersistedHistory(messages, 1, true), messages)
})

test('drops the live run half-written by the SDK while its tail streams', () => {
  const messages = [
    message('old-ask', 'user'),
    message('old-answer', 'assistant'),
    message('ask', 'user'),
    message('thinking', 'thinking'),
    message('tool', 'tool_call'),
  ]

  assert.deepEqual(
    selectPersistedHistory(messages, 2, true).map((item) => item.id),
    ['old-ask', 'old-answer', 'ask'],
  )
})

test('drops the live run for a view that attached mid-run', () => {
  // A page loaded mid-run records a run-start index past the already-written
  // part of the running turn; the last user message is the real boundary.
  const messages = [
    message('ask', 'user'),
    message('thinking', 'thinking'),
    message('tool', 'tool_call'),
  ]

  assert.deepEqual(
    selectPersistedHistory(messages, messages.length, true).map((item) => item.id),
    ['ask'],
  )
})

test('keeps a follow-up user message steered into the running turn', () => {
  const messages = [
    message('ask', 'user'),
    message('thinking', 'thinking'),
    message('steer', 'user'),
    message('tool', 'tool_call'),
  ]

  assert.deepEqual(
    selectPersistedHistory(messages, 1, true).map((item) => item.id),
    ['ask', 'steer'],
  )
})

import type { ChatMessage } from '@/lib/types'

export function hasPersistedAssistantResponse(messages: ChatMessage[], runStartIndex: number) {
  const startIndex = Math.max(0, Math.min(runStartIndex, messages.length))
  return messages
    .slice(startIndex)
    .some((message) => message.type === 'assistant' || message.type === 'error')
}

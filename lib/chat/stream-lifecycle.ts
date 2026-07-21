import type { ChatMessage } from '@/lib/types'

export function hasPersistedAssistantResponse(messages: ChatMessage[], runStartIndex: number) {
  const startIndex = Math.max(0, Math.min(runStartIndex, messages.length))
  return messages
    .slice(startIndex)
    .some((message) => message.type === 'assistant' || message.type === 'error')
}

export function hasPersistedUserMessage(
  messages: ChatMessage[],
  runStartIndex: number,
  optimisticMessage: ChatMessage,
) {
  const startIndex = Math.max(0, Math.min(runStartIndex, messages.length))
  return messages.slice(startIndex).some(
    (message) =>
      message.type === 'user' &&
      message.content === optimisticMessage.content &&
      haveSameAttachments(message.attachments, optimisticMessage.attachments),
  )
}

function haveSameAttachments(left: ChatMessage['attachments'], right: ChatMessage['attachments']) {
  if (!left?.length && !right?.length) return true
  if (!left || !right || left.length !== right.length) return false
  return left.every((attachment, index) => attachment.path === right[index]?.path)
}

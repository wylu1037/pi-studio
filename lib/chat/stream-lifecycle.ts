import type { ChatMessage } from '@/lib/types'

const PROCESS_MESSAGE_TYPES = new Set<ChatMessage['type']>([
  'thinking',
  'tool_call',
  'tool_result',
  'bash',
])

/**
 * Whether the finished run is on disk and the live tail can hand over to history.
 *
 * An assistant message (or a persisted error) is the reliable signal: the SDK
 * writes the reply text last, so seeing it means the whole turn landed. Waiting
 * for one is what keeps a mid-run refresh from swapping in a half-written turn.
 *
 * But a turn can end without ever producing assistant text — aborted after a
 * tool call, or a run that only ran tools. There the signal never arrives and
 * the live tail stays pinned on screen until the next submit. `acceptProcessMessages`
 * covers that case: the caller passes it only when the live tail itself holds no
 * assistant text, so no reply is pending and a persisted process message already
 * means the turn is complete.
 */
export function hasPersistedAssistantResponse(
  messages: ChatMessage[],
  runStartIndex: number,
  options?: { acceptProcessMessages?: boolean },
) {
  const startIndex = Math.max(0, Math.min(runStartIndex, messages.length))
  const trailing = messages.slice(startIndex)
  if (trailing.some((message) => message.type === 'assistant' || message.type === 'error')) {
    return true
  }
  if (!options?.acceptProcessMessages) return false
  return trailing.some((message) => PROCESS_MESSAGE_TYPES.has(message.type))
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

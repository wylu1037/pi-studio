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

/**
 * The persisted history to render *beneath* a live run's streaming tail.
 *
 * The SDK session file is written incrementally while a run is still going, and
 * the page reads it on every server render. So a view attached mid-run (a fresh
 * page load, a session switch, any `router.refresh()`) receives the current
 * run's already-written thinking/tool/assistant entries as "history" — the exact
 * same content the SSE replay then re-renders as the live tail. Keeping both
 * paints the turn twice.
 *
 * Whenever a live tail is on screen it owns the current run, so drop the run's
 * assistant-side entries here. User messages always stay: they anchor the turn
 * (and a steered follow-up mid-run must not disappear), and the live tail never
 * renders them.
 *
 * The boundary is the earlier of the run-start index the client recorded when it
 * submitted and the last persisted user message. The recorded index is right for
 * a run this view started, but it is already past the run's content for a view
 * that attached mid-run; the last user message is the correct boundary there.
 */
export function selectPersistedHistory(
  messages: ChatMessage[],
  runStartIndex: number,
  hasLiveTail: boolean,
) {
  if (!hasLiveTail || messages.length === 0) return messages
  const lastUserIndex = messages.findLastIndex((message) => message.type === 'user')
  const boundary = Math.max(
    0,
    Math.min(runStartIndex, lastUserIndex < 0 ? messages.length : lastUserIndex),
  )
  const trailing = messages.slice(boundary)
  const persistedUserMessages = trailing.filter((message) => message.type === 'user')
  // Nothing from the live run has been persisted yet — keep the array identity so
  // the expensive display/outline derivations downstream stay memoized.
  if (persistedUserMessages.length === trailing.length) return messages
  return [...messages.slice(0, boundary), ...persistedUserMessages]
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

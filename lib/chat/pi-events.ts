export interface PiUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
  cost?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
    total?: number
  }
}

export type PiRunEvent =
  | { type: 'assistant_message_start'; messageId?: string; responseId?: string }
  | {
      type: 'assistant_message_end'
      messageId?: string
      responseId?: string
      stopReason?: string
    }
  | {
      type: 'assistant_text_end'
      messageId: string
      contentIndex: number
      content?: string
    }
  | {
      type: 'message_delta'
      content: string
      usage?: PiUsage
      messageId?: string
      contentIndex?: number
    }
  | { type: 'thinking_delta'; content: string }
  | { type: 'tool_call_delta'; content: string; title?: string }
  | { type: 'tool_result_delta'; content: string; title?: string; isError?: boolean }
  | { type: 'bash_output'; stream: 'stdout' | 'stderr'; content: string }
  | { type: 'usage'; usage: PiUsage; messageId?: string }
  | { type: 'error'; message: string }
  | { type: 'done'; exitCode: number | null }

export interface PiRunEventParserOptions {
  /** Prefixes generated and provider-backed assistant IDs for one active run. */
  runId?: string
}

interface ActiveAssistantMessage {
  messageId: string
  responseId?: string
  activeTextContentIndex?: number
  openTextContentIndexes: Set<number>
}

interface PiRunEventParserState {
  runId?: string
  assistantMessageCount: number
  activeAssistant?: ActiveAssistantMessage
}

/**
 * Creates a stateful Pi event parser for one agent run. It is required when a
 * consumer needs stable assistant message IDs and structured text boundaries.
 */
export function createPiRunEventParser(options: PiRunEventParserOptions = {}) {
  const state: PiRunEventParserState = {
    runId: nonEmptyString(options.runId),
    assistantMessageCount: 0,
  }
  return (event: unknown): PiRunEvent[] => parseSdkEventWithState(event, state)
}

/**
 * Legacy, stateless SDK adapter. It intentionally preserves the original event
 * shapes for existing callers. Use createPiRunEventParser for phase-two stream
 * metadata such as message IDs, content indexes, and text-end boundaries.
 */
export function parseSdkEvent(event: unknown): PiRunEvent[] {
  return parseSdkEventWithState(event)
}

function parseSdkEventWithState(event: unknown, state?: PiRunEventParserState): PiRunEvent[] {
  const payload = asRecord(event)
  if (!payload) return []
  const type = String(payload.type ?? '')

  if (type === 'message_start') {
    const message = asRecord(payload.message)
    if (message?.role !== 'assistant') return []
    return state ? startAssistantMessage(state, message) : [{ type: 'assistant_message_start' }]
  }

  if (type === 'message_update') {
    const message = asRecord(payload.message)
    const assistantEvent = asRecord(payload.assistantMessageEvent)
    if (!message || message.role !== 'assistant' || !assistantEvent) return []

    const assistantEventType = String(assistantEvent.type ?? '')
    const lifecycle = state ? ensureAssistantMessage(state, message) : []
    if (assistantEventType === 'text_delta') {
      const delta = assistantEvent.delta
      if (typeof delta !== 'string' || !delta) return lifecycle
      if (!state) return [{ type: 'message_delta', content: delta }]

      const assistant = state.activeAssistant
      if (!assistant) return lifecycle
      const contentIndex = resolveTextContentIndex(assistant, assistantEvent.contentIndex)
      assistant.activeTextContentIndex = contentIndex
      assistant.openTextContentIndexes.add(contentIndex)
      return [
        ...lifecycle,
        {
          type: 'message_delta',
          content: delta,
          messageId: assistant.messageId,
          contentIndex,
        },
      ]
    }
    if (assistantEventType === 'text_start') {
      if (!state) return []
      const assistant = state.activeAssistant
      if (!assistant) return lifecycle
      const contentIndex = resolveTextContentIndex(assistant, assistantEvent.contentIndex, true)
      assistant.activeTextContentIndex = contentIndex
      assistant.openTextContentIndexes.add(contentIndex)
      return lifecycle
    }
    if (assistantEventType === 'text_end') {
      if (!state) return []
      const assistant = state.activeAssistant
      if (!assistant) return lifecycle
      const contentIndex = resolveTextContentIndex(assistant, assistantEvent.contentIndex)
      assistant.openTextContentIndexes.delete(contentIndex)
      if (assistant.activeTextContentIndex === contentIndex) {
        assistant.activeTextContentIndex = undefined
      }
      const content =
        typeof assistantEvent.content === 'string' ? assistantEvent.content : undefined
      return [
        ...lifecycle,
        {
          type: 'assistant_text_end',
          messageId: assistant.messageId,
          contentIndex,
          ...(content !== undefined ? { content } : {}),
        },
      ]
    }
    if (assistantEventType === 'thinking_delta') {
      const delta = assistantEvent.delta
      return typeof delta === 'string' && delta
        ? [...lifecycle, { type: 'thinking_delta', content: delta }]
        : lifecycle
    }
    if (assistantEventType === 'toolcall_end') {
      const toolCall = extractToolCalls(assistantEvent.toolCall)[0]
      return toolCall ? [...lifecycle, { type: 'tool_call_delta', ...toolCall }] : lifecycle
    }
    if (assistantEventType === 'done') return lifecycle
    if (assistantEventType === 'error') {
      const error = asRecord(assistantEvent.error)
      const errorMessage = stringValue(error?.errorMessage) ?? stringValue(message.errorMessage)
      return [...lifecycle, { type: 'error', message: errorMessage ?? 'The model run failed.' }]
    }
    return lifecycle
  }

  if (type === 'message_end') {
    const message = asRecord(payload.message)
    if (!message) return []
    if (message.role === 'toolResult' || message.role === 'tool_result') {
      const toolResult = extractToolResult({ message })
      return toolResult ? [{ type: 'tool_result_delta', ...toolResult }] : []
    }
    if (message.role !== 'assistant') return []

    if (state) {
      const lifecycle = ensureAssistantMessage(state, message)
      const assistant = state.activeAssistant
      if (!assistant) return lifecycle
      const textEnds = endOpenTextSegments(assistant)
      const errorMessage = stringValue(message.errorMessage)
      const usage = extractUsage(message)
      const endEvent = createAssistantMessageEndEvent(assistant, message)
      state.activeAssistant = undefined

      if (errorMessage || message.stopReason === 'error') {
        return [
          ...lifecycle,
          ...textEnds,
          endEvent,
          { type: 'error', message: errorMessage ?? 'The model run failed.' },
        ]
      }

      return [
        ...lifecycle,
        ...textEnds,
        ...(usage ? ([{ type: 'usage', usage, messageId: assistant.messageId }] as const) : []),
        endEvent,
      ]
    }

    const errorMessage = stringValue(message.errorMessage)
    if (errorMessage || message.stopReason === 'error') {
      return [{ type: 'error', message: errorMessage ?? 'The model run failed.' }]
    }
    const usage = extractUsage(message)
    return [
      ...(usage ? ([{ type: 'usage', usage }] as const) : []),
      { type: 'assistant_message_end' },
    ]
  }
  return []
}

function startAssistantMessage(state: PiRunEventParserState, message: Record<string, unknown>) {
  const responseId = extractAssistantResponseId(message)
  const active = state.activeAssistant
  if (active?.responseId && responseId === active.responseId) return []

  const priorEvents = active ? endAssistantMessageWithoutUsage(state, active) : []
  const assistant: ActiveAssistantMessage = {
    messageId: createAssistantMessageId(state, responseId),
    responseId,
    openTextContentIndexes: new Set(),
  }
  state.activeAssistant = assistant
  return [...priorEvents, createAssistantMessageStartEvent(assistant)]
}

function ensureAssistantMessage(state: PiRunEventParserState, message: Record<string, unknown>) {
  const active = state.activeAssistant
  if (!active) return startAssistantMessage(state, message)

  const responseId = extractAssistantResponseId(message)
  if (responseId && active.responseId && responseId !== active.responseId) {
    return startAssistantMessage(state, message)
  }
  if (responseId && !active.responseId) active.responseId = responseId
  return []
}

function createAssistantMessageId(state: PiRunEventParserState, responseId?: string) {
  const scope = state.runId ? `${state.runId}:` : ''
  if (responseId) return `${scope}response:${responseId}`
  state.assistantMessageCount += 1
  return `${scope}assistant:${state.assistantMessageCount}`
}

function createAssistantMessageStartEvent(assistant: ActiveAssistantMessage): PiRunEvent {
  return {
    type: 'assistant_message_start',
    messageId: assistant.messageId,
    ...(assistant.responseId ? { responseId: assistant.responseId } : {}),
  }
}

function createAssistantMessageEndEvent(
  assistant: ActiveAssistantMessage,
  message: Record<string, unknown>,
): PiRunEvent {
  return {
    type: 'assistant_message_end',
    messageId: assistant.messageId,
    ...(assistant.responseId ? { responseId: assistant.responseId } : {}),
    ...(nonEmptyString(message.stopReason) ? { stopReason: String(message.stopReason) } : {}),
  }
}

function endAssistantMessageWithoutUsage(
  state: PiRunEventParserState,
  assistant: ActiveAssistantMessage,
) {
  const events = [...endOpenTextSegments(assistant), createAssistantMessageEndEvent(assistant, {})]
  state.activeAssistant = undefined
  return events
}

function endOpenTextSegments(assistant: ActiveAssistantMessage): PiRunEvent[] {
  const openIndexes = [...assistant.openTextContentIndexes].sort((left, right) => left - right)
  assistant.openTextContentIndexes.clear()
  assistant.activeTextContentIndex = undefined
  return openIndexes.map((contentIndex) => ({
    type: 'assistant_text_end' as const,
    messageId: assistant.messageId,
    contentIndex,
  }))
}

function resolveTextContentIndex(
  assistant: ActiveAssistantMessage,
  value: unknown,
  startNewSegment = false,
) {
  const contentIndex = numberOrUndefined(value)
  if (contentIndex !== undefined) return contentIndex
  if (startNewSegment && assistant.activeTextContentIndex !== undefined) {
    return assistant.activeTextContentIndex + 1
  }
  return assistant.activeTextContentIndex ?? 0
}

function extractAssistantResponseId(message: Record<string, unknown>) {
  return nonEmptyString(message.responseId) ?? nonEmptyString(message.id)
}

function extractContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(extractContent).filter(Boolean).join('')
  const record = asRecord(value)
  if (!record) return ''

  for (const key of ['content', 'text', 'delta', 'message', 'output']) {
    const content = extractContent(record[key])
    if (content) return content
  }
  if (Array.isArray(record.parts)) {
    return record.parts.map(extractContent).filter(Boolean).join('')
  }
  return ''
}

function extractTextContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(extractTextContent).filter(Boolean).join('')
  const record = asRecord(value)
  if (!record) return ''

  const type = String(record.type ?? '')
  if (type === 'thinking' || type === 'toolCall' || type === 'tool_call') return ''
  if (type === 'text' && typeof record.text === 'string') return record.text
  if (Array.isArray(record.content)) {
    return record.content.map(extractTextContent).filter(Boolean).join('')
  }
  if (Array.isArray(record.parts)) {
    return record.parts.map(extractTextContent).filter(Boolean).join('')
  }
  for (const key of ['text', 'delta', 'message', 'output']) {
    const content = extractTextContent(record[key])
    if (content) return content
  }
  return ''
}

function extractToolCalls(value: unknown): Array<{ content: string; title?: string }> {
  if (Array.isArray(value)) return value.flatMap(extractToolCalls)
  const record = asRecord(value)
  if (!record) return []

  const type = String(record.type ?? '')
  const calls: Array<{ content: string; title?: string }> = []
  if (type === 'toolCall' || type === 'tool_call') {
    const title =
      stringValue(record.toolName) ?? stringValue(record.name) ?? stringValue(record.tool)
    const input = record.input ?? record.args ?? record.arguments ?? {}
    calls.push({ title, content: formatToolPayload(title, input) })
  }

  for (const key of ['content', 'parts', 'messages']) {
    const nested = record[key]
    if (Array.isArray(nested)) calls.push(...nested.flatMap(extractToolCalls))
  }
  if (record.message) calls.push(...extractToolCalls(record.message))
  return calls
}

function extractToolResult(value: unknown) {
  const record = asRecord(value)
  if (!record) return null
  const message = asRecord(record.message) ?? record
  const role = String(message.role ?? '')
  if (role !== 'toolResult' && role !== 'tool_result') return null

  const title =
    stringValue(message.toolName) ??
    stringValue(message.name) ??
    stringValue(message.tool) ??
    'Tool result'
  const content = extractTextContent(message.content) || extractContent(message.content) || ''
  return {
    title,
    content: content || JSON.stringify(message, null, 2),
    isError: Boolean(message.isError),
  }
}

function extractUsage(value: unknown): PiUsage | undefined {
  const record = asRecord(value)
  const usage = asRecord(record?.usage)
  if (!usage) return undefined

  const input = numberValue(usage.input)
  const output = numberValue(usage.output)
  const cacheRead = numberValue(usage.cacheRead)
  const cacheWrite = numberValue(usage.cacheWrite)
  const totalTokens = numberValue(usage.totalTokens) || input + output
  const cost = asRecord(usage.cost)

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens,
    ...(cost
      ? {
          cost: {
            input: numberValue(cost.input),
            output: numberValue(cost.output),
            cacheRead: numberValue(cost.cacheRead),
            cacheWrite: numberValue(cost.cacheWrite),
            total: numberValue(cost.total),
          },
        }
      : {}),
  }
}

function formatToolPayload(title: string | undefined, input: unknown) {
  const body =
    input && typeof input === 'object' ? JSON.stringify(input, null, 2) : String(input ?? '')
  return title ? `${title}\n${body}` : body
}

function stringValue(value: unknown) {
  return nonEmptyString(value)
}

function nonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function numberOrUndefined(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

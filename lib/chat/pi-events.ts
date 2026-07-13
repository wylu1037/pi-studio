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
  | { type: 'assistant_message_start' }
  | { type: 'assistant_message_end' }
  | { type: 'message_delta'; content: string; usage?: PiUsage }
  | { type: 'thinking_delta'; content: string }
  | { type: 'tool_call_delta'; content: string; title?: string }
  | { type: 'tool_result_delta'; content: string; title?: string; isError?: boolean }
  | { type: 'bash_output'; stream: 'stdout' | 'stderr'; content: string }
  | { type: 'usage'; usage: PiUsage }
  | { type: 'error'; message: string }
  | { type: 'done'; exitCode: number | null }

export function parseSdkEvent(event: unknown): PiRunEvent[] {
  const payload = asRecord(event)
  if (!payload) return []
  const type = String(payload.type ?? '')

  if (type === 'message_start') {
    const message = asRecord(payload.message)
    return message?.role === 'assistant' ? [{ type: 'assistant_message_start' }] : []
  }

  if (type === 'message_update') {
    const message = asRecord(payload.message)
    const assistantEvent = asRecord(payload.assistantMessageEvent)
    if (!message || message.role !== 'assistant' || !assistantEvent) return []

    const assistantEventType = String(assistantEvent.type ?? '')
    if (assistantEventType === 'text_delta') {
      const delta = assistantEvent.delta
      return typeof delta === 'string' && delta ? [{ type: 'message_delta', content: delta }] : []
    }
    if (assistantEventType === 'thinking_delta') {
      const delta = assistantEvent.delta
      return typeof delta === 'string' && delta ? [{ type: 'thinking_delta', content: delta }] : []
    }
    if (assistantEventType === 'toolcall_end') {
      const toolCall = extractToolCalls(assistantEvent.toolCall)[0]
      return toolCall ? [{ type: 'tool_call_delta', ...toolCall }] : []
    }
    if (assistantEventType === 'done') return []
    if (assistantEventType === 'error') {
      const error = asRecord(assistantEvent.error)
      const errorMessage = stringValue(error?.errorMessage) ?? stringValue(message.errorMessage)
      return [{ type: 'error', message: errorMessage ?? 'The model run failed.' }]
    }
    return []
  }

  if (type === 'message_end') {
    const message = asRecord(payload.message)
    if (!message) return []
    if (message.role === 'toolResult' || message.role === 'tool_result') {
      const toolResult = extractToolResult({ message })
      return toolResult ? [{ type: 'tool_result_delta', ...toolResult }] : []
    }
    if (message.role !== 'assistant') return []
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
    cost: cost
      ? {
          input: numberValue(cost.input),
          output: numberValue(cost.output),
          cacheRead: numberValue(cost.cacheRead),
          cacheWrite: numberValue(cost.cacheWrite),
          total: numberValue(cost.total),
        }
      : undefined,
  }
}

function formatToolPayload(title: string | undefined, input: unknown) {
  const body =
    input && typeof input === 'object' ? JSON.stringify(input, null, 2) : String(input ?? '')
  return title ? `${title}\n${body}` : body
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

import { existsSync } from 'node:fs'
import {
  SessionManager,
  buildSessionContext,
  type SessionEntry,
  type SessionTreeNode as PiSessionTreeNode,
} from '@earendil-works/pi-coding-agent'
import type { AgentSessionSummary, ChatMessage, SessionTreeNode } from '@/lib/types'
import { parsePromptWithAttachments } from '@/lib/chat/attachments'

export function formatUtcTimestamp(value: string | number) {
  const timestamp = typeof value === 'number' ? value : Number(value)
  const date = Number.isFinite(timestamp) ? new Date(timestamp) : new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString()
}

function textContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(textContent).filter(Boolean).join('\n')
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  if (record.type === 'text' && typeof record.text === 'string') return record.text
  if (record.type === 'thinking' && typeof record.thinking === 'string') return record.thinking
  return textContent(record.content)
}

function entryPreview(entry: SessionEntry) {
  if (entry.type === 'message') {
    const content =
      'content' in entry.message
        ? textContent(entry.message.content)
        : JSON.stringify(entry.message)
    if (entry.message.role === 'user') {
      const parsed = parsePromptWithAttachments(content)
      return (
        parsed.message || parsed.attachments.map((attachment) => attachment.name).join(', ')
      ).slice(0, 120)
    }
    return content.slice(0, 120) || entry.message.role
  }
  if (entry.type === 'model_change') return `${entry.provider} / ${entry.modelId}`
  if (entry.type === 'thinking_level_change') return `Thinking: ${entry.thinkingLevel}`
  if (entry.type === 'compaction' || entry.type === 'branch_summary')
    return entry.summary.slice(0, 120)
  if (entry.type === 'session_info') return entry.name ?? 'Session info'
  if (entry.type === 'label') return entry.label ?? 'Label removed'
  if (entry.type === 'custom_message') return textContent(entry.content).slice(0, 120)
  return entry.type
}

function entryRole(entry: SessionEntry): SessionTreeNode['role'] {
  if (entry.type !== 'message') return undefined
  const role = entry.message.role
  if (role === 'user' || role === 'assistant' || role === 'toolResult') return role
  return role === 'bashExecution' ? 'bashExecution' : 'custom'
}

function mapTreeNode(node: PiSessionTreeNode, leafId: string | null): SessionTreeNode {
  return {
    id: node.entry.id,
    parentId: node.entry.parentId,
    type: node.entry.type as SessionTreeNode['type'],
    role: entryRole(node.entry),
    preview: entryPreview(node.entry),
    timestamp: formatUtcTimestamp(node.entry.timestamp),
    children: node.children.map((child) => mapTreeNode(child, leafId)),
    label: node.label,
    isCurrent: node.entry.id === leafId,
  }
}

function mapMessage(
  message: ReturnType<typeof buildSessionContext>['messages'][number],
  index: number,
): ChatMessage[] {
  if (message.role === 'user') {
    const parsed = parsePromptWithAttachments(textContent(message.content))
    return [
      {
        id: `sdk-user-${index}`,
        type: 'user',
        content: parsed.message,
        attachments: parsed.attachments.length > 0 ? parsed.attachments : undefined,
        timestamp: formatUtcTimestamp(message.timestamp),
      },
    ]
  }
  if (message.role === 'toolResult') {
    return [
      {
        id: `sdk-tool-${index}`,
        type: 'tool_result',
        title: message.toolName,
        content: textContent(message.content),
        timestamp: formatUtcTimestamp(message.timestamp),
      },
    ]
  }
  if (message.role === 'assistant') {
    const timestamp = formatUtcTimestamp(message.timestamp)
    const mapped: ChatMessage[] = []
    const content = Array.isArray(message.content) ? message.content : []

    for (const [contentIndex, item] of content.entries()) {
      if (!item || typeof item !== 'object') continue
      const record = item as unknown as Record<string, unknown>
      if (record.type === 'thinking' && typeof record.thinking === 'string') {
        mapped.push({
          id: `sdk-thinking-${index}-${contentIndex}`,
          type: 'thinking',
          title: 'Thinking',
          content: record.thinking,
          timestamp,
        })
        continue
      }
      if (record.type === 'toolCall') {
        const title = typeof record.name === 'string' ? record.name : 'Tool call'
        mapped.push({
          id: `sdk-tool-call-${index}-${contentIndex}`,
          type: 'tool_call',
          title,
          content: formatToolCall(title, record.arguments),
          timestamp,
        })
        continue
      }
      if (record.type !== 'text' || typeof record.text !== 'string' || !record.text) continue
      const previous = mapped.at(-1)
      if (previous?.type === 'assistant') {
        previous.content += record.text
      } else {
        mapped.push({
          id: `sdk-assistant-${index}-${contentIndex}`,
          type: 'assistant',
          content: record.text,
          timestamp,
        })
      }
    }

    const finalAssistant = mapped.findLast((item) => item.type === 'assistant')
    if (finalAssistant) {
      finalAssistant.tokens = message.usage?.totalTokens
      finalAssistant.usage = message.usage
    }
    return mapped
  }
  return []
}

function formatToolCall(title: string, args: unknown) {
  const body = args && typeof args === 'object' ? JSON.stringify(args, null, 2) : String(args ?? '')
  return `${title}\n${body}`
}

export function readSdkSessionTree(filePath: string) {
  if (!existsSync(filePath)) return null
  const manager = SessionManager.open(filePath)
  const leafId = manager.getLeafId()
  const roots = manager.getTree().map((node) => mapTreeNode(node, leafId))
  return { roots, leafId }
}

export function readSdkSessionContext(filePath: string, leafId?: string | null) {
  if (!existsSync(filePath)) return null
  const manager = SessionManager.open(filePath)
  const entries = manager.getEntries()
  const context = buildSessionContext(entries, leafId ?? manager.getLeafId())
  return {
    leafId: leafId ?? manager.getLeafId(),
    messages: context.messages.flatMap(mapMessage),
    model: context.model,
    thinkingLevel: context.thinkingLevel,
  }
}

export function hydrateSessionSummariesFromSdk(sessions: AgentSessionSummary[]) {
  return sessions.map((session) => {
    const context = readSdkSessionContext(session.filePath)
    if (!context) return session
    const firstUser = context.messages.find((message) => message.type === 'user')
    const lastMessage = context.messages.at(-1)
    const usage = summarizeSessionUsage(context.messages)
    return {
      ...session,
      messageCount: context.messages.length,
      firstUserMessage: firstUser?.content,
      lastMessagePreview: lastMessage?.content,
      totalTokens: usage.totalTokens ?? session.totalTokens,
      totalCost: usage.totalCost ?? session.totalCost,
    }
  })
}

export function summarizeSessionUsage(messages: ChatMessage[]) {
  let hasTokens = false
  let hasCost = false
  let totalTokens = 0
  let totalCost = 0

  for (const message of messages) {
    if (message.tokens != null) {
      hasTokens = true
      totalTokens += message.tokens
    } else if (message.usage) {
      hasTokens = true
      totalTokens += message.usage.input + message.usage.output
    }

    const cost = message.usage?.cost
    if (!cost) continue
    if (cost.total != null) {
      hasCost = true
      totalCost += cost.total
      continue
    }
    const components = [cost.input, cost.output, cost.cacheRead, cost.cacheWrite]
    if (components.some((value) => value != null)) {
      hasCost = true
      totalCost += components.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    }
  }

  return {
    totalTokens: hasTokens ? totalTokens : undefined,
    totalCost: hasCost ? totalCost : undefined,
  }
}

export function forkSdkSessionFile(filePath: string, entryId: string) {
  if (!existsSync(filePath)) return null
  const manager = SessionManager.open(filePath)
  return manager.createBranchedSession(entryId) ?? null
}

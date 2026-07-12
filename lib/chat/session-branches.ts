import { existsSync } from 'node:fs'
import {
  SessionManager,
  buildSessionContext,
  type SessionEntry,
  type SessionTreeNode as PiSessionTreeNode,
} from '@earendil-works/pi-coding-agent'
import type { ChatMessage, SessionTreeNode } from '@/lib/types'

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
    const content = 'content' in entry.message
      ? textContent(entry.message.content)
      : JSON.stringify(entry.message)
    return content.slice(0, 120) || entry.message.role
  }
  if (entry.type === 'model_change') return `${entry.provider} / ${entry.modelId}`
  if (entry.type === 'thinking_level_change') return `Thinking: ${entry.thinkingLevel}`
  if (entry.type === 'compaction' || entry.type === 'branch_summary') return entry.summary.slice(0, 120)
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
    timestamp: node.entry.timestamp,
    children: node.children.map((child) => mapTreeNode(child, leafId)),
    label: node.label,
    isCurrent: node.entry.id === leafId,
  }
}

function mapMessage(message: ReturnType<typeof buildSessionContext>['messages'][number], index: number): ChatMessage | null {
  if (message.role === 'user') {
    return { id: `sdk-user-${index}`, type: 'user', content: textContent(message.content), timestamp: String(message.timestamp) }
  }
  if (message.role === 'toolResult') {
    return {
      id: `sdk-tool-${index}`,
      type: 'tool_result',
      title: message.toolName,
      content: textContent(message.content),
      timestamp: String(message.timestamp),
    }
  }
  if (message.role === 'assistant') {
    const content = textContent(message.content)
    return {
      id: `sdk-assistant-${index}`,
      type: 'assistant',
      content,
      timestamp: String(message.timestamp),
      tokens: message.usage?.totalTokens,
      usage: message.usage,
    }
  }
  return null
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
    messages: context.messages.map(mapMessage).filter((message): message is ChatMessage => Boolean(message)),
    model: context.model,
    thinkingLevel: context.thinkingLevel,
  }
}

export function forkSdkSessionFile(filePath: string, entryId: string) {
  if (!existsSync(filePath)) return null
  const manager = SessionManager.open(filePath)
  return manager.createBranchedSession(entryId) ?? null
}

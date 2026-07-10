'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import {
  Send,
  Paperclip,
  GitBranch,
  Terminal,
  Brain,
  Wrench,
  User,
  Bot,
  AlertTriangle,
  Layers,
  ChevronRight,
  Cpu,
  Coins,
  Circle,
} from 'lucide-react'
import {
  Label,
  Tag,
  BracketButton,
  Panel,
  PanelHeader,
} from '@/components/pi-ui'
import { postApiSessionsIdRuns } from '@/lib/api/generated/clients/postApiSessionsIdRuns'
import { postApiSessionsIdRunsMutationRequestSchema } from '@/lib/api/generated/zod/postApiSessionsIdRunsSchema'
import type {
  AgentProfile,
  AgentSessionSummary,
  ChatMessage,
  GlobalMcpConfig,
  GlobalModelProvider,
  GlobalSkill,
  SessionTreeNode,
  TreeNodeRole,
} from '@/lib/types'
import { cn } from '@/lib/utils'

const thinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

type ComposerValues = {
  message: string
  thinkingLevel?: (typeof thinkingLevels)[number]
  modelId?: string
  providerId?: string
}

export function ChatView({
  activeAgent,
  sessions,
  activeSession,
  messages,
  tree,
  providers,
  skills,
  mcpConfigs,
}: {
  activeAgent?: AgentProfile
  sessions: AgentSessionSummary[]
  activeSession?: AgentSessionSummary
  messages: ChatMessage[]
  tree: SessionTreeNode | null
  providers: GlobalModelProvider[]
  skills: GlobalSkill[]
  mcpConfigs: GlobalMcpConfig[]
}) {
  const router = useRouter()
  const [streamingMessage, setStreamingMessage] = useState('')
  const [runId, setRunId] = useState<string | null>(null)
  const [streamError, setStreamError] = useState<string | null>(null)

  const activeProvider =
    providers.find((provider) => provider.id === activeAgent?.defaultProviderId) ??
    providers[0]
  const availableModels = providers.flatMap((provider) => provider.models)

  const form = useForm<ComposerValues>({
    resolver: zodResolver(postApiSessionsIdRunsMutationRequestSchema as never),
    defaultValues: {
      message: '',
      providerId: activeAgent?.defaultProviderId ?? activeProvider?.id,
      modelId: activeAgent?.defaultModelId ?? availableModels[0]?.id,
      thinkingLevel: activeAgent?.defaultThinkingLevel ?? 'medium',
    },
  })

  const thinking = form.watch('thinkingLevel') ?? 'medium'
  const model = form.watch('modelId') ?? activeAgent?.defaultModelId ?? 'model'
  const activeModelName =
    availableModels.find((candidate) => candidate.id === model)?.name ?? model

  const skillNames = useMemo(() => {
    const selected = new Set(activeAgent?.selectedSkillIds ?? [])
    return skills.filter((skill) => selected.has(skill.id)).map((skill) => skill.name)
  }, [activeAgent?.selectedSkillIds, skills])
  const mcpNames = useMemo(() => {
    const selected = new Set(activeAgent?.selectedMcpConfigIds ?? [])
    return mcpConfigs.filter((mcp) => selected.has(mcp.id)).map((mcp) => mcp.name)
  }, [activeAgent?.selectedMcpConfigIds, mcpConfigs])

  const displayMessages = streamingMessage
    ? [
        ...messages,
        {
          id: 'streaming-assistant',
          type: 'assistant' as const,
          content: streamingMessage,
          timestamp: 'streaming',
        },
      ]
    : messages

  const submit = form.handleSubmit(async (values) => {
    if (!activeSession || !activeAgent) return
    setStreamingMessage('')
    setStreamError(null)
    const run = await postApiSessionsIdRuns(activeSession.id, values)
    setRunId(run.id)
    form.reset({
      message: '',
      providerId: values.providerId,
      modelId: values.modelId,
      thinkingLevel: values.thinkingLevel,
    })

    const source = new EventSource(`/api/runs/${run.id}/events`)
    source.addEventListener('message_delta', (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { content?: string }
      setStreamingMessage((current) => current + (payload.content ?? ''))
    })
    source.addEventListener('bash_output', (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { content?: string }
      setStreamingMessage((current) => current + (payload.content ?? ''))
    })
    source.addEventListener('error', (event) => {
      if ('data' in event && event.data) {
        const payload = JSON.parse(event.data as string) as { message?: string }
        setStreamError(payload.message ?? 'pi run failed')
      }
      source.close()
      setRunId(null)
      router.refresh()
    })
    source.addEventListener('done', () => {
      source.close()
      setRunId(null)
      router.refresh()
    })
  })

  const abort = async () => {
    if (!runId) return
    await fetch(`/api/runs/${runId}/abort`, { method: 'POST' })
    setRunId(null)
    router.refresh()
  }

  if (!activeAgent || !activeSession) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-sm text-muted-foreground">
        No agent or session is available.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      {/* LEFT: session tree */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-panel">
        <div className="border-b border-border px-4 py-3">
          <Label>Session tree</Label>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            {activeSession.branchCount} nodes · {sessions.length} sessions
          </p>
        </div>
        <div className="flex-1 overflow-auto p-2">
          {tree ? (
            <TreeNode node={tree} depth={0} />
          ) : (
            <p className="px-2 py-6 text-center font-mono text-[11px] text-muted-foreground">
              No tree nodes yet
            </p>
          )}
        </div>
        <div className="border-t border-border p-2">
          <BracketButton className="w-full justify-center">
            <GitBranch className="size-3" />
            New branch
          </BracketButton>
        </div>
      </aside>

      {/* CENTER: conversation */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* header */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-7 items-center justify-center border border-border-strong bg-card">
              <Bot className="size-3.5 text-accent" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">
                {activeAgent.name}
              </div>
              <div className="truncate font-mono text-[11px] text-muted-foreground">
                {activeSession.name ?? activeSession.firstUserMessage ?? 'New conversation'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Tag tone="outline">
              <Circle className={cn('size-2', runId ? 'fill-success text-success' : 'text-muted-foreground')} />
              {runId ? 'running' : 'ready'}
            </Tag>
            <Tag tone="outline">{activeSession.messageCount} msgs</Tag>
          </div>
        </div>

        {/* messages */}
        <div className="flex-1 overflow-auto px-5 py-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {displayMessages.map((m) => (
              <MessageBubble key={m.id} message={m} agentName={activeAgent.name} />
            ))}
            {displayMessages.length === 0 && (
              <div className="border border-dashed border-border bg-panel/50 px-4 py-8 text-center font-mono text-xs text-muted-foreground">
                Start a new pi conversation from the composer.
              </div>
            )}
            {streamError && (
              <MessageBubble
                agentName={activeAgent.name}
                message={{ id: 'stream-error', type: 'error', content: streamError, timestamp: 'now' }}
              />
            )}
          </div>
        </div>

        {/* composer */}
        <div className="border-t border-border bg-panel px-5 py-3">
          <div className="mx-auto max-w-3xl">
            <form onSubmit={submit} className="flex items-end gap-2 border border-border-strong bg-card p-2 focus-within:border-ring">
              <button
                type="button"
                className="mb-0.5 text-muted-foreground hover:text-foreground"
                aria-label="Attach file"
              >
                <Paperclip className="size-4" />
              </button>
              <textarea
                {...form.register('message')}
                onKeyDown={(e) => {
                  if (
                    e.key === 'Enter' &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing &&
                    e.keyCode !== 229
                  ) {
                    e.preventDefault()
                    void submit()
                  }
                }}
                rows={1}
                disabled={Boolean(runId)}
                placeholder="Reply to the agent...  (Enter to send, Shift+Enter for newline)"
                className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-1.5 font-mono text-[13px] text-foreground outline-none placeholder:text-muted-foreground/60"
              />
              <button
                type={runId ? 'button' : 'submit'}
                onClick={runId ? abort : undefined}
                className="mb-0.5 flex size-8 items-center justify-center border border-accent bg-accent text-accent-foreground hover:opacity-90"
                aria-label={runId ? 'Abort run' : 'Send message'}
              >
                <Send className="size-3.5" />
              </button>
            </form>
            {form.formState.errors.message && (
              <p className="mt-1 font-mono text-[11px] text-destructive">
                {form.formState.errors.message.message}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <label className="flex items-center gap-1.5">
                <Cpu className="size-3 text-muted-foreground" />
                <select
                  {...form.register('modelId')}
                  className="bg-transparent font-mono text-[11px] text-muted-foreground outline-none hover:text-foreground"
                >
                  {providers.flatMap((provider) =>
                    provider.models.map((candidate) => (
                      <option key={`${provider.id}:${candidate.id}`} value={candidate.id}>
                        {provider.name} / {candidate.name ?? candidate.id}
                      </option>
                    )),
                  )}
                </select>
              </label>
              <label className="flex items-center gap-1.5">
                <Brain className="size-3 text-muted-foreground" />
                <select
                  {...form.register('thinkingLevel')}
                  className="bg-transparent font-mono text-[11px] text-muted-foreground outline-none hover:text-foreground"
                >
                  {thinkingLevels.map((t) => (
                    <option key={t} value={t}>
                      thinking: {t}
                    </option>
                  ))}
                </select>
              </label>
              <span className="ml-auto font-mono text-[11px] text-muted-foreground/60">
                {activeSession.cwd}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT: context inspector */}
      <aside className="hidden w-72 shrink-0 flex-col border-l border-border bg-panel xl:flex">
        <div className="border-b border-border px-4 py-3">
          <Label>Active context</Label>
        </div>
        <div className="flex-1 space-y-4 overflow-auto p-4">
          <Panel>
            <PanelHeader>
              <Label>Model</Label>
            </PanelHeader>
            <div className="space-y-2 p-3">
              <Row icon={<Cpu className="size-3" />} label={activeModelName} />
              <Row icon={<Brain className="size-3" />} label={`thinking · ${thinking}`} />
              <Row icon={<Coins className="size-3" />} label={`${activeSession.totalTokens ?? 0} tokens`} />
            </div>
          </Panel>
          <Panel>
            <PanelHeader>
              <Label>Skills</Label>
              <Tag>{skillNames.length}</Tag>
            </PanelHeader>
            <ul className="divide-y divide-border">
              {skillNames.map((s) => (
                <li
                  key={s}
                  className="flex items-center gap-2 px-3 py-2 font-mono text-[11px] text-muted-foreground"
                >
                  <Layers className="size-3 shrink-0 text-accent" />
                  {s}
                </li>
              ))}
            </ul>
          </Panel>
          <Panel>
            <PanelHeader>
              <Label>MCP tools</Label>
              <Tag>{mcpNames.length}</Tag>
            </PanelHeader>
            <ul className="divide-y divide-border">
              {mcpNames.map((s) => (
                <li
                  key={s}
                  className="flex items-center gap-2 px-3 py-2 font-mono text-[11px] text-muted-foreground"
                >
                  <Wrench className="size-3 shrink-0 text-accent" />
                  {s}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </aside>
    </div>
  )
}

function Row({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
      <span className="text-accent">{icon}</span>
      {label}
    </div>
  )
}

/* ---------- Session tree ---------- */

const roleMeta: Record<TreeNodeRole, { icon: React.ReactNode; color: string }> = {
  user: { icon: <User className="size-3" />, color: 'text-foreground' },
  assistant: { icon: <Bot className="size-3" />, color: 'text-accent' },
  toolResult: { icon: <Wrench className="size-3" />, color: 'text-muted-foreground' },
  bashExecution: { icon: <Terminal className="size-3" />, color: 'text-muted-foreground' },
  custom: { icon: <Circle className="size-3" />, color: 'text-muted-foreground' },
}

function TreeNode({ node, depth }: { node: SessionTreeNode; depth: number }) {
  const isEvent = node.type !== 'message'
  const meta = node.role ? roleMeta[node.role] : null

  return (
    <div>
      <div
        className={cn(
          'group flex cursor-pointer items-start gap-1.5 rounded-none px-2 py-1.5 transition-colors hover:bg-muted',
          node.isCurrent && 'bg-accent/12 ring-1 ring-accent/40',
        )}
        style={{ paddingLeft: depth * 12 + 8 }}
      >
        <span
          className={cn(
            'mt-0.5 shrink-0',
            isEvent ? 'text-warning' : meta?.color ?? 'text-muted-foreground',
          )}
        >
          {isEvent ? <GitBranch className="size-3" /> : meta?.icon}
        </span>
        <div className="min-w-0 flex-1">
          {node.label && (
            <span className="mb-0.5 mr-1 inline-block bg-accent/12 px-1 font-mono text-[9px] uppercase tracking-wider text-accent">
              {node.label}
            </span>
          )}
          <p
            className={cn(
              'truncate font-mono text-[11px] leading-snug',
              isEvent ? 'italic text-warning' : 'text-foreground/80',
            )}
          >
            {node.preview}
          </p>
          <span className="font-mono text-[9px] text-muted-foreground/50">
            {node.timestamp}
          </span>
        </div>
      </div>
      {node.children.length > 0 && (
        <div
          className={cn(
            node.children.length > 1 &&
              'ml-3 border-l border-dashed border-border',
          )}
        >
          {node.children.map((c) => (
            <TreeNode key={c.id} node={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

/* ---------- Message bubbles ---------- */

function MessageBubble({
  message,
  agentName,
}: {
  message: ChatMessage
  agentName: string
}) {
  switch (message.type) {
    case 'user':
      return (
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-1.5">
            <Label>You</Label>
            <span className="font-mono text-[10px] text-muted-foreground/50">
              {message.timestamp}
            </span>
          </div>
          <div className="max-w-[85%] border border-border-strong bg-card px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
            {message.content}
          </div>
        </div>
      )
    case 'assistant':
      return (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <Bot className="size-3 text-accent" />
            <Label>{agentName}</Label>
            {message.tokens && (
              <span className="font-mono text-[10px] text-muted-foreground/50">
                {message.tokens} tok · {message.timestamp}
              </span>
            )}
          </div>
          <div className="prose-pi max-w-none whitespace-pre-wrap border-l-2 border-accent/50 pl-3.5 text-sm leading-relaxed text-foreground">
            {message.content}
          </div>
        </div>
      )
    case 'thinking':
      return (
        <details className="group border border-dashed border-border bg-panel/60">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-1.5">
            <Brain className="size-3 text-muted-foreground" />
            <span className="font-mono text-[11px] text-muted-foreground">
              {message.title ?? 'Thinking'}
            </span>
            <ChevronRight className="ml-auto size-3 text-muted-foreground transition-transform group-open:rotate-90" />
          </summary>
          <p className="border-t border-dashed border-border px-3 py-2 font-mono text-[11px] italic leading-relaxed text-muted-foreground">
            {message.content}
          </p>
        </details>
      )
    case 'tool_call':
      return (
        <div className="flex items-center gap-2 border border-border bg-panel px-3 py-1.5">
          <Wrench className="size-3 shrink-0 text-accent" />
          <code className="truncate font-mono text-[11px] text-muted-foreground">
            {message.content}
          </code>
          <Tag tone="accent" className="ml-auto">
            call
          </Tag>
        </div>
      )
    case 'tool_result':
      return (
        <Panel>
          <PanelHeader className="py-1.5">
            <div className="flex items-center gap-1.5">
              <Wrench className="size-3 text-muted-foreground" />
              <Label>{message.title ?? 'tool result'}</Label>
            </div>
            <span className="font-mono text-[10px] text-muted-foreground/50">
              {message.timestamp}
            </span>
          </PanelHeader>
          <pre className="overflow-auto bg-code p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {message.content}
          </pre>
        </Panel>
      )
    case 'bash':
      return (
        <div className="border border-border bg-code">
          <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5">
            <Terminal className="size-3 text-success" />
            <span className="font-mono text-[11px] text-muted-foreground">
              {message.title ?? 'bash'}
            </span>
          </div>
          <pre className="overflow-auto p-3 font-mono text-[11px] leading-relaxed text-foreground/90">
            {message.content}
          </pre>
        </div>
      )
    case 'error':
      return (
        <div className="flex items-start gap-2 border border-destructive/40 bg-destructive/8 px-3 py-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          <p className="font-mono text-[11px] leading-relaxed text-destructive">
            {message.content}
          </p>
        </div>
      )
    case 'compaction':
      return (
        <div className="flex items-center gap-2 py-1">
          <div className="h-px flex-1 bg-border" />
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">
            {message.content}
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>
      )
    default:
      return null
  }
}

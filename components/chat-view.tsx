'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import {
  Send,
  Square,
  LoaderCircle,
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
import { MarkdownContent } from '@/components/markdown-content'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getApiRunsId } from '@/lib/api/generated/clients/getApiRunsId'
import { postApiRunsIdAbort } from '@/lib/api/generated/clients/postApiRunsIdAbort'
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
const EVENT_STREAM_CONNECT_TIMEOUT_MS = 5000
const RUN_RECONCILE_INITIAL_DELAY_MS = 1000
const RUN_RECONCILE_POLL_MS = 1200
const RUN_RECONCILE_MAX_MS = 20000

type StreamPhase = 'idle' | 'starting' | 'connecting' | 'thinking' | 'streaming'

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
  const [streamBuffer, setStreamBuffer] = useState('')
  const [streamDone, setStreamDone] = useState(false)
  const [streamPhase, setStreamPhase] = useState<StreamPhase>('idle')
  const [optimisticMessage, setOptimisticMessage] =
    useState<ChatMessage | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [abortingRun, setAbortingRun] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const activeRunIdRef = useRef<string | null>(null)
  const reconcileTimerRef = useRef<number | null>(null)

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

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close()
      if (reconcileTimerRef.current) {
        window.clearTimeout(reconcileTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (streamingMessage.length >= streamBuffer.length) return
    const timer = window.setTimeout(() => {
      setStreamingMessage((current) => {
        const remaining = streamBuffer.length - current.length
        const step = Math.min(4, Math.max(1, Math.ceil(remaining / 24)))
        return streamBuffer.slice(0, current.length + step)
      })
    }, 18)

    return () => window.clearTimeout(timer)
  }, [streamBuffer, streamingMessage])

  useEffect(() => {
    if (!streamDone || streamingMessage.length < streamBuffer.length) return
    const timer = window.setTimeout(() => {
      router.refresh()
    }, 150)

    return () => window.clearTimeout(timer)
  }, [router, streamBuffer.length, streamDone, streamingMessage.length])

  useEffect(() => {
    if (!streamDone || !streamingMessage.trim()) return
    const persisted = messages.some(
      (message) =>
        message.type === 'assistant' &&
        message.content.trim() === streamingMessage.trim(),
    )
    if (!persisted) return

    setStreamingMessage('')
    setStreamBuffer('')
    setStreamDone(false)
    setOptimisticMessage(null)
    setStreamPhase('idle')
  }, [messages, streamDone, streamingMessage])

  const baseMessages =
    optimisticMessage &&
    !messages.some(
      (message) =>
        message.type === 'user' &&
        message.content === optimisticMessage.content,
    )
      ? [...messages, optimisticMessage]
      : messages

  const hasPersistedStreamingAssistant =
    streamingMessage.trim().length > 0 &&
    messages.some(
      (message) =>
        message.type === 'assistant' &&
        message.content.trim() === streamingMessage.trim(),
    )

  const displayMessages = streamingMessage && !hasPersistedStreamingAssistant
    ? [
        ...baseMessages,
        {
          id: 'streaming-assistant',
          type: 'assistant' as const,
          content: streamingMessage,
          timestamp: 'streaming',
        },
      ]
    : baseMessages
  const isWaiting =
    !streamError &&
    runId !== null &&
    streamPhase !== 'idle' &&
    streamingMessage.length === 0

  const clearReconciliation = () => {
    if (!reconcileTimerRef.current) return
    window.clearTimeout(reconcileTimerRef.current)
    reconcileTimerRef.current = null
  }

  const finishActiveStream = (currentRunId: string, source?: EventSource | null) => {
    if (activeRunIdRef.current !== currentRunId) return false
    clearReconciliation()
    source?.close()
    if (eventSourceRef.current === source) eventSourceRef.current = null
    activeRunIdRef.current = null
    setRunId(null)
    setAbortingRun(false)
    setStreamPhase('idle')
    setStreamDone(true)
    return true
  }

  const failActiveStream = (
    currentRunId: string,
    message: string,
    source?: EventSource | null,
  ) => {
    if (activeRunIdRef.current !== currentRunId) return false
    clearReconciliation()
    source?.close()
    if (eventSourceRef.current === source) eventSourceRef.current = null
    activeRunIdRef.current = null
    setRunId(null)
    setAbortingRun(false)
    setStreamPhase('idle')
    setStreamDone(false)
    setStreamError(message)
    router.refresh()
    return true
  }

  const scheduleRunReconciliation = (currentRunId: string, source: EventSource) => {
    const startedAt = Date.now()
    const poll = async () => {
      if (activeRunIdRef.current !== currentRunId) return
      if (Date.now() - startedAt > RUN_RECONCILE_MAX_MS) return
      try {
        const run = await getApiRunsId(currentRunId)
        if (run.status === 'completed') {
          finishActiveStream(currentRunId, source)
          return
        }
        if (run.status === 'failed' || run.status === 'aborted') {
          failActiveStream(
            currentRunId,
            run.error ?? (run.status === 'aborted' ? 'pi run was aborted.' : 'pi run failed.'),
            source,
          )
          return
        }
      } catch {
        // SSE is still the primary path; polling only recovers missed endings.
      }
      reconcileTimerRef.current = window.setTimeout(poll, RUN_RECONCILE_POLL_MS)
    }
    reconcileTimerRef.current = window.setTimeout(poll, RUN_RECONCILE_INITIAL_DELAY_MS)
  }

  const submit = form.handleSubmit(async (values) => {
    if (!activeSession || !activeAgent) return
    eventSourceRef.current?.close()
    clearReconciliation()
    activeRunIdRef.current = null
    setStreamingMessage('')
    setStreamBuffer('')
    setStreamDone(false)
    setStreamPhase('starting')
    setAbortingRun(false)
    setStreamError(null)
    setOptimisticMessage({
      id: `optimistic-user-${Date.now()}`,
      type: 'user',
      content: values.message,
      timestamp: 'sending',
    })
    try {
      const run = await postApiSessionsIdRuns(activeSession.id, values)
      activeRunIdRef.current = run.id
      setRunId(run.id)
      setStreamPhase('connecting')
      form.reset({
        message: '',
        providerId: values.providerId,
        modelId: values.modelId,
        thinkingLevel: values.thinkingLevel,
      })

      const eventSource = new EventSource(`/api/runs/${run.id}/events`)
      eventSourceRef.current = eventSource
      const currentRunId = run.id
      const connectionTimeout = window.setTimeout(() => {
        failActiveStream(
          currentRunId,
          'Timed out connecting to the pi event stream. Please try again.',
          eventSource,
        )
      }, EVENT_STREAM_CONNECT_TIMEOUT_MS)

      eventSource.addEventListener('connected', () => {
        if (activeRunIdRef.current !== currentRunId) return
        window.clearTimeout(connectionTimeout)
        setStreamPhase('thinking')
      })
      eventSource.addEventListener('started', () => {
        if (activeRunIdRef.current !== currentRunId) return
        window.clearTimeout(connectionTimeout)
        setStreamPhase('thinking')
      })
      eventSource.addEventListener('message_delta', (event) => {
        if (activeRunIdRef.current !== currentRunId) return
        window.clearTimeout(connectionTimeout)
        const payload = JSON.parse((event as MessageEvent).data) as { content?: string }
        const content = payload.content ?? ''
        if (!content) return
        setStreamPhase('streaming')
        setStreamBuffer((current) => current + content)
      })
      eventSource.addEventListener('error', (event) => {
        if (activeRunIdRef.current !== currentRunId) return
        const data = (event as MessageEvent).data
        if (typeof data === 'string' && data) {
          window.clearTimeout(connectionTimeout)
          const payload = JSON.parse(data) as { message?: string }
          failActiveStream(currentRunId, payload.message ?? 'pi run failed.', eventSource)
          return
        }
        // Native EventSource errors can fire while the browser is still
        // connecting. The connection timeout and run-status reconciliation
        // decide whether this becomes a real failure.
      })
      eventSource.addEventListener('done', () => {
        if (activeRunIdRef.current !== currentRunId) return
        window.clearTimeout(connectionTimeout)
        finishActiveStream(currentRunId, eventSource)
      })
      scheduleRunReconciliation(currentRunId, eventSource)
    } catch (error) {
      setStreamPhase('idle')
      setRunId(null)
      setAbortingRun(false)
      activeRunIdRef.current = null
      setStreamError(
        error instanceof Error ? error.message : 'Unable to start pi run.',
      )
      return
    }
  })

  const abort = async () => {
    if (!runId || abortingRun) return
    setAbortingRun(true)
    try {
      await postApiRunsIdAbort(runId)
      clearReconciliation()
      eventSourceRef.current?.close()
      eventSourceRef.current = null
      activeRunIdRef.current = null
      setRunId(null)
      setStreamPhase('idle')
      router.refresh()
    } catch (error) {
      setStreamError(
        error instanceof Error ? error.message : 'Unable to abort pi run.',
      )
    } finally {
      setAbortingRun(false)
    }
  }

  if (!activeAgent || !activeSession) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-sm text-muted-foreground">
        No agent or session is available.
      </div>
    )
  }

  const isStartingRun = streamPhase === 'starting' && !runId
  const isRunningRun = Boolean(runId)
  const sendButtonLabel = abortingRun
    ? 'Stopping'
    : isRunningRun
      ? 'Stop'
      : isStartingRun
        ? 'Sending'
        : 'Send'

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
        <ScrollArea className="min-h-0 flex-1" viewportClassName="px-5 py-6">
          <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-4 overflow-x-hidden">
            {displayMessages.map((m) => (
              <MessageBubble key={m.id} message={m} agentName={activeAgent.name} />
            ))}
            {isWaiting && (
              <WaitingBubble agentName={activeAgent.name} />
            )}
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
        </ScrollArea>

        {/* composer */}
        <div className="border-t border-border bg-panel px-5 py-3">
          <div className="mx-auto max-w-3xl">
            <form onSubmit={submit} className="flex items-center gap-2.5 border border-border-strong bg-card p-2.5 focus-within:border-ring">
              <button
                type="button"
                className="flex size-9 items-center justify-center text-muted-foreground hover:text-foreground"
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
                className="max-h-40 min-h-11 flex-1 resize-none bg-transparent py-2 font-mono text-[13px] leading-6 text-foreground outline-none placeholder:text-muted-foreground/60"
              />
              <button
                type={isRunningRun ? 'button' : 'submit'}
                onClick={isRunningRun ? abort : undefined}
                disabled={isStartingRun || abortingRun}
                className={cn(
                  'flex h-9 items-center justify-center gap-1.5 border font-mono text-[11px] uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-70',
                  isRunningRun
                    ? 'border-destructive/70 bg-destructive/10 px-3 text-destructive hover:bg-destructive hover:text-destructive-foreground'
                    : 'border-accent bg-accent px-2.5 text-accent-foreground hover:opacity-90',
                )}
                aria-label={isRunningRun ? 'Abort run' : 'Send message'}
              >
                {abortingRun || isStartingRun ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : isRunningRun ? (
                  <Square className="size-3 fill-current" />
                ) : (
                  <Send className="size-3.5" />
                )}
                <span>{sendButtonLabel}</span>
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

function WaitingBubble({ agentName }: { agentName: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Bot className="size-3 text-accent" />
        <Label>{agentName}</Label>
      </div>
      <div className="flex items-center gap-2 border-l-2 border-accent/50 pl-3.5 font-mono text-xs text-muted-foreground">
        <span>Thinking</span>
        <span className="flex items-center gap-1">
          <span className="size-1.5 animate-pulse bg-muted-foreground/60" />
          <span className="size-1.5 animate-pulse bg-muted-foreground/60 [animation-delay:120ms]" />
          <span className="size-1.5 animate-pulse bg-muted-foreground/60 [animation-delay:240ms]" />
        </span>
      </div>
    </div>
  )
}

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
          <div className="max-w-[85%] break-words border border-border-strong bg-card px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
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
          <MarkdownContent content={message.content} />
        </div>
      )
    case 'thinking':
      return (
        <details className="group border border-dashed border-border bg-panel/40">
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
          <code className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
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
          <pre className="max-w-full overflow-hidden whitespace-pre-wrap break-words bg-code p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
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
          <pre className="max-w-full overflow-hidden whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-relaxed text-foreground/90">
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

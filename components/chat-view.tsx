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
import { postApiSessionsIdFollowUp } from '@/lib/api/generated/clients/postApiSessionsIdFollowUp'
import { postApiSessionsIdSteer } from '@/lib/api/generated/clients/postApiSessionsIdSteer'
import { postApiSessionsIdRuns } from '@/lib/api/generated/clients/postApiSessionsIdRuns'
import { postApiSessionsIdRunsMutationRequestSchema } from '@/lib/api/generated/zod/postApiSessionsIdRunsSchema'
import type {
  AgentProfile,
  AgentSessionSummary,
  ChatMessage,
  ChatMessageType,
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

type StreamUsage = {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  totalTokens?: number
  cost?: {
    total?: number
  }
}

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
  const [streamProcessMessages, setStreamProcessMessages] = useState<ChatMessage[]>([])
  const [streamingTokens, setStreamingTokens] = useState<number | null>(null)
  const [streamingUsage, setStreamingUsage] = useState<StreamUsage | null>(null)
  const [streamStartedAt, setStreamStartedAt] = useState<number | null>(null)
  const [streamDone, setStreamDone] = useState(false)
  const [streamPhase, setStreamPhase] = useState<StreamPhase>('idle')
  const [optimisticMessage, setOptimisticMessage] =
    useState<ChatMessage | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [abortingRun, setAbortingRun] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [queueingMessage, setQueueingMessage] = useState<'steer' | 'follow-up' | null>(null)
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
  const message = form.watch('message') ?? ''
  const composerValues = {
    message: message.trim(),
    providerId: form.watch('providerId'),
    modelId: form.watch('modelId'),
    thinkingLevel: thinking,
  }
  const canSend =
    postApiSessionsIdRunsMutationRequestSchema.safeParse(composerValues).success
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
    setStreamProcessMessages([])
    setStreamingTokens(null)
    setStreamingUsage(null)
    setStreamStartedAt(null)
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
        ...streamProcessMessages,
        {
          id: 'streaming-assistant',
          type: 'assistant' as const,
          content: streamingMessage,
          timestamp: 'streaming',
          tokens: streamingTokens ?? undefined,
        },
      ]
    : [...baseMessages, ...streamProcessMessages]
  const displayItems = buildDisplayItems(displayMessages)
  const isWaiting =
    !streamError &&
    runId !== null &&
    streamPhase !== 'idle' &&
    streamingMessage.length === 0 &&
    streamProcessMessages.length === 0

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

  const appendStreamProcessMessage = (
    type: Extract<ChatMessageType, 'thinking' | 'tool_call' | 'tool_result' | 'bash'>,
    content: string,
    title?: string,
  ) => {
    if (!content) return
    setStreamProcessMessages((current) => {
      if (type === 'thinking') {
        const existing = current.find((message) => message.type === 'thinking')
        if (existing) {
          return current.map((message) =>
            message.id === existing.id
              ? { ...message, content: message.content + content }
              : message,
          )
        }
      }

      const last = current.at(-1)
      if (last?.type === type && last.title === title && type === 'bash') {
        return [
          ...current.slice(0, -1),
          { ...last, content: last.content + content },
        ]
      }

      return [
        ...current,
        {
          id: `stream-${type}-${Date.now()}-${current.length}`,
          type,
          title,
          content,
          timestamp: 'streaming',
        },
      ]
    })
  }

  const submit = form.handleSubmit(async (values) => {
    if (!activeSession || !activeAgent) return
    const payload = {
      ...values,
      message: values.message.trim(),
    }
    if (!postApiSessionsIdRunsMutationRequestSchema.safeParse(payload).success) {
      return
    }
    eventSourceRef.current?.close()
    clearReconciliation()
    activeRunIdRef.current = null
    setStreamingMessage('')
    setStreamBuffer('')
    setStreamProcessMessages([])
    setStreamingTokens(null)
    setStreamingUsage(null)
    setStreamStartedAt(Date.now())
    setStreamDone(false)
    setStreamPhase('starting')
    setAbortingRun(false)
    setStreamError(null)
    setOptimisticMessage({
      id: `optimistic-user-${Date.now()}`,
      type: 'user',
      content: payload.message,
      timestamp: 'sending',
    })
    try {
      const run = await postApiSessionsIdRuns(activeSession.id, payload)
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
        const payload = JSON.parse((event as MessageEvent).data) as {
          content?: string
          usage?: StreamUsage
        }
        const content = payload.content ?? ''
        if (!content) return
        setStreamPhase('streaming')
        if (payload.usage?.totalTokens) {
          setStreamingTokens(payload.usage.totalTokens)
          setStreamingUsage(payload.usage)
        }
        setStreamBuffer((current) => current + content)
      })
      eventSource.addEventListener('thinking_delta', (event) => {
        if (activeRunIdRef.current !== currentRunId) return
        window.clearTimeout(connectionTimeout)
        const payload = JSON.parse((event as MessageEvent).data) as { content?: string }
        setStreamPhase('thinking')
        appendStreamProcessMessage('thinking', payload.content ?? '', 'Thinking')
      })
      eventSource.addEventListener('tool_call_delta', (event) => {
        if (activeRunIdRef.current !== currentRunId) return
        window.clearTimeout(connectionTimeout)
        const payload = JSON.parse((event as MessageEvent).data) as {
          content?: string
          title?: string
        }
        setStreamPhase('thinking')
        appendStreamProcessMessage('tool_call', payload.content ?? '', payload.title ?? 'Tool call')
      })
      eventSource.addEventListener('tool_result_delta', (event) => {
        if (activeRunIdRef.current !== currentRunId) return
        window.clearTimeout(connectionTimeout)
        const payload = JSON.parse((event as MessageEvent).data) as {
          content?: string
          title?: string
        }
        setStreamPhase('thinking')
        appendStreamProcessMessage('tool_result', payload.content ?? '', payload.title ?? 'Tool result')
      })
      eventSource.addEventListener('bash_output', (event) => {
        if (activeRunIdRef.current !== currentRunId) return
        window.clearTimeout(connectionTimeout)
        const payload = JSON.parse((event as MessageEvent).data) as {
          content?: string
          stream?: 'stdout' | 'stderr'
        }
        setStreamPhase('thinking')
        appendStreamProcessMessage('bash', payload.content ?? '', payload.stream ?? 'stderr')
      })
      eventSource.addEventListener('usage', (event) => {
        if (activeRunIdRef.current !== currentRunId) return
        const payload = JSON.parse((event as MessageEvent).data) as {
          usage?: StreamUsage
        }
        if (payload.usage?.totalTokens) {
          setStreamingTokens(payload.usage.totalTokens)
          setStreamingUsage(payload.usage)
        }
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
      setStreamStartedAt(null)
      router.refresh()
    } catch (error) {
      setStreamError(
        error instanceof Error ? error.message : 'Unable to abort pi run.',
      )
    } finally {
      setAbortingRun(false)
    }
  }

  const queueMessage = async (behavior: 'steer' | 'follow-up') => {
    const content = form.getValues('message').trim()
    if (!activeSession || !content || queueingMessage) return
    setQueueingMessage(behavior)
    setStreamError(null)
    try {
      if (behavior === 'steer') {
        await postApiSessionsIdSteer(activeSession.id, { message: content })
      } else {
        await postApiSessionsIdFollowUp(activeSession.id, { message: content })
      }
      form.setValue('message', '')
    } catch (error) {
      setStreamError(
        error instanceof Error ? error.message : `Unable to queue ${behavior} message.`,
      )
    } finally {
      setQueueingMessage(null)
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
            {displayItems.map((item) => (
              item.type === 'process' ? (
                <ProcessDetailsGroup
                  key={item.id}
                  messages={item.messages}
                  isStreaming={Boolean(runId && item.messages.some((message) => message.timestamp === 'streaming'))}
                />
              ) : (
                <MessageBubble
                  key={item.message.id}
                  message={item.message}
                  agentName={activeAgent.name}
                  streamStartedAt={item.message.id === 'streaming-assistant' ? streamStartedAt : null}
                  usageSummary={item.message.id === 'streaming-assistant' ? formatUsageSummary(streamingUsage) : undefined}
                />
              )
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
                    if (canSend && !isStartingRun && !isRunningRun && !abortingRun) {
                      void submit()
                    }
                  }
                }}
                rows={1}
                placeholder={
                  runId
                    ? 'Add guidance to the active run...'
                    : 'Reply to the agent...  (Enter to send, Shift+Enter for newline)'
                }
                className="max-h-40 min-h-11 flex-1 resize-none bg-transparent py-2 font-mono text-[13px] leading-6 text-foreground outline-none placeholder:text-muted-foreground/60"
              />
              <button
                type={isRunningRun ? 'button' : 'submit'}
                onClick={isRunningRun ? abort : undefined}
                disabled={isRunningRun ? abortingRun : isStartingRun || !canSend}
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
            {isRunningRun && (
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={!message.trim() || queueingMessage !== null}
                  onClick={() => void queueMessage('steer')}
                  className="border border-border-strong px-2.5 py-1 font-mono text-[10px] uppercase text-muted-foreground hover:border-accent hover:text-foreground disabled:opacity-50"
                >
                  {queueingMessage === 'steer' ? 'Queueing…' : 'Steer now'}
                </button>
                <button
                  type="button"
                  disabled={!message.trim() || queueingMessage !== null}
                  onClick={() => void queueMessage('follow-up')}
                  className="border border-border-strong px-2.5 py-1 font-mono text-[10px] uppercase text-muted-foreground hover:border-accent hover:text-foreground disabled:opacity-50"
                >
                  {queueingMessage === 'follow-up' ? 'Queueing…' : 'Follow up'}
                </button>
              </div>
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

type DisplayItem =
  | { type: 'message'; message: ChatMessage }
  | { type: 'process'; id: string; messages: ChatMessage[] }

const processMessageTypes = new Set<ChatMessageType>([
  'thinking',
  'tool_call',
  'tool_result',
  'bash',
])

function isProcessMessage(message: ChatMessage) {
  return processMessageTypes.has(message.type)
}

function estimateTokens(content: string) {
  return Math.max(1, Math.ceil(content.length / 4))
}

function formatUsageSummary(usage: StreamUsage | null) {
  if (!usage) return null
  const parts = [
    usage.input ? `${usage.input.toLocaleString()} in` : null,
    usage.output ? `${usage.output.toLocaleString()} out` : null,
    usage.cacheRead ? `${usage.cacheRead.toLocaleString()} cache` : null,
    usage.cacheWrite ? `${usage.cacheWrite.toLocaleString()} write` : null,
    usage.cost?.total ? `$${usage.cost.total.toFixed(4)}` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : null
}

function buildDisplayItems(messages: ChatMessage[]): DisplayItem[] {
  const items: DisplayItem[] = []
  let pendingProcess: ChatMessage[] = []

  const flushProcess = () => {
    if (pendingProcess.length === 0) return
    items.push({
      type: 'process',
      id: `process-${pendingProcess.map((message) => message.id).join('-')}`,
      messages: pendingProcess,
    })
    pendingProcess = []
  }

  for (const message of messages) {
    if (isProcessMessage(message)) {
      pendingProcess.push(message)
      continue
    }
    if (message.type === 'assistant') {
      flushProcess()
      items.push({ type: 'message', message })
      continue
    }
    flushProcess()
    items.push({ type: 'message', message })
  }

  flushProcess()
  return items
}

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

function ProcessDetailsGroup({
  messages,
  isStreaming,
}: {
  messages: ChatMessage[]
  isStreaming?: boolean
}) {
  const toolCalls = messages.filter((message) => message.type === 'tool_call').length
  const toolResults = messages.filter((message) => message.type === 'tool_result').length
  const bashOutputs = messages.filter((message) => message.type === 'bash').length
  const thinking = messages.some((message) => message.type === 'thinking')
  const summary = [
    `${messages.length} messages`,
    toolCalls ? `${toolCalls} tool calls` : null,
    toolResults ? `${toolResults} results` : null,
    bashOutputs ? `${bashOutputs} outputs` : null,
  ].filter(Boolean).join(' · ')

  return (
    <details className="group border border-border bg-panel/35">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2">
        <span className="flex size-5 items-center justify-center border border-border bg-card text-muted-foreground">
          {toolCalls > 0 ? (
            <Wrench className="size-3" />
          ) : bashOutputs > 0 ? (
            <Terminal className="size-3" />
          ) : (
            <Brain className="size-3" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] uppercase text-muted-foreground">
              {isStreaming ? 'Working' : 'Process details'}
            </span>
            {isStreaming && (
              <span className="flex items-center gap-1">
                <span className="size-1.5 animate-pulse bg-accent/70" />
                <span className="size-1.5 animate-pulse bg-accent/70 [animation-delay:120ms]" />
                <span className="size-1.5 animate-pulse bg-accent/70 [animation-delay:240ms]" />
              </span>
            )}
          </div>
          <div className="truncate font-mono text-[10px] text-muted-foreground/60">
            {thinking ? 'Thinking' : 'Activity'} · {summary}
          </div>
        </div>
        <ChevronRight className="size-3 text-muted-foreground transition-transform group-open:rotate-90" />
      </summary>
      <div className="space-y-2 border-t border-border px-3 py-3">
        {messages.map((message) => (
          <ProcessMessageRow key={message.id} message={message} />
        ))}
      </div>
    </details>
  )
}

function ProcessMessageRow({ message }: { message: ChatMessage }) {
  const meta = processMessageMeta(message)
  return (
    <div className="overflow-hidden border border-border bg-card/70">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <span className={cn('shrink-0', meta.color)}>{meta.icon}</span>
        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
          {message.title ?? meta.label}
        </span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground/50">
          {message.timestamp}
        </span>
      </div>
      <pre className={cn(
        'max-h-72 max-w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap wrap-break-word p-3 font-mono text-[11px] leading-relaxed',
        message.type === 'thinking'
          ? 'italic text-muted-foreground'
          : 'text-foreground/85',
      )}>
        {message.content}
      </pre>
    </div>
  )
}

function processMessageMeta(message: ChatMessage) {
  switch (message.type) {
    case 'tool_call':
      return {
        label: 'Tool call',
        icon: <Wrench className="size-3" />,
        color: 'text-accent',
      }
    case 'tool_result':
      return {
        label: 'Tool result',
        icon: <Wrench className="size-3" />,
        color: 'text-success',
      }
    case 'bash':
      return {
        label: 'Bash output',
        icon: <Terminal className="size-3" />,
        color: 'text-success',
      }
    default:
      return {
        label: 'Thinking',
        icon: <Brain className="size-3" />,
        color: 'text-muted-foreground',
      }
  }
}

function MessageBubble({
  message,
  agentName,
  streamStartedAt,
  usageSummary,
}: {
  message: ChatMessage
  agentName: string
  streamStartedAt?: number | null
  usageSummary?: string | null
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
          <div className="max-w-[85%] wrap-break-word border border-border-strong bg-card px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
            {message.content}
          </div>
        </div>
      );
    case 'assistant': {
      const estimatedTokens = message.tokens ?? estimateTokens(message.content)
      const streamSeconds =
        streamStartedAt && message.timestamp === 'streaming'
          ? Math.max(1, Math.round((Date.now() - streamStartedAt) / 1000))
          : null
      const effectiveUsageSummary =
        usageSummary ?? formatUsageSummary(message.usage ?? null)
      const meta = [
        effectiveUsageSummary,
        !effectiveUsageSummary && message.tokens
          ? `${message.tokens.toLocaleString()} tok`
          : !effectiveUsageSummary && message.timestamp === 'streaming'
            ? `~${estimatedTokens.toLocaleString()} tok`
            : null,
        streamSeconds ? `${streamSeconds}s` : null,
        message.timestamp !== 'streaming' ? message.timestamp : null,
      ].filter(Boolean).join(' · ')
      return (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <Bot className="size-3 text-accent" />
            <Label>{agentName}</Label>
            {meta && (
              <span className="font-mono text-[10px] text-muted-foreground/50">
                {meta}
              </span>
            )}
          </div>
          <MarkdownContent content={message.content} />
        </div>
      )
    }
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
              <Label>{message.title ?? "tool result"}</Label>
            </div>
            <span className="font-mono text-[10px] text-muted-foreground/50">
              {message.timestamp}
            </span>
          </PanelHeader>
          <pre className="max-w-full overflow-hidden whitespace-pre-wrap wrap-break-word bg-code p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {message.content}
          </pre>
        </Panel>
      );
    case 'bash':
      return (
        <div className="border border-border bg-code">
          <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5">
            <Terminal className="size-3 text-success" />
            <span className="font-mono text-[11px] text-muted-foreground">
              {message.title ?? "bash"}
            </span>
          </div>
          <pre className="max-w-full overflow-hidden whitespace-pre-wrap wrap-break-word p-3 font-mono text-[11px] leading-relaxed text-foreground/90">
            {message.content}
          </pre>
        </div>
      );
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

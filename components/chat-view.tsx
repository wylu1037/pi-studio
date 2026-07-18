'use client'

import { memo, type SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import {
  ArrowLineDownIcon as InputMetricIcon,
  ArrowLineUpIcon as OutputMetricIcon,
  ClockIcon as TimeMetricIcon,
  CoinsIcon as CostMetricIcon,
  DatabaseIcon as CacheMetricIcon,
} from '@phosphor-icons/react'
import {
  LoaderCircle,
  GitBranch,
  Terminal,
  Brain,
  Cpu,
  File as FileIcon,
  Wrench,
  User,
  Bot,
  AlertTriangle,
  Layers,
  ChevronDown,
  ChevronRight,
  Coins,
  Circle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  ArrowDown,
  ArrowUp,
  Package,
} from 'lucide-react'
import { ActionButton, Label, Tag, BracketButton, Panel, PanelHeader } from '@/components/pi-ui'
import {
  ChatComposer,
  formatFileSize,
  type ComposerValues,
  type SlashCommandOption,
} from '@/components/chat-composer'
import { MarkdownContent } from '@/components/markdown-content'
import { StreamingMarkdownContent } from '@/components/streaming-markdown-content'
import {
  useStreamingMarkdown,
  type StreamingContentBatch,
} from '@/components/use-streaming-markdown'
import { WorkspaceExplorer } from '@/components/workspace-explorer'
import { ExtensionUiHost } from '@/components/extension-ui-host'
import { ChatAvatar } from '@/components/chat-avatar'
import { useProfileSettings } from '@/components/use-profile-settings'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { Message, MessageAvatar, MessageContent, MessageFooter } from '@/components/ui/message'
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from '@/components/ui/attachment'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getApiRunsId } from '@/lib/api/generated/clients/getApiRunsId'
import { getApiSessionsIdAgentState } from '@/lib/api/generated/clients/getApiSessionsIdAgentState'
import { postApiRunsIdAbort } from '@/lib/api/generated/clients/postApiRunsIdAbort'
import { postApiSessions } from '@/lib/api/generated/clients/postApiSessions'
import { postApiSessionsIdFollowUp } from '@/lib/api/generated/clients/postApiSessionsIdFollowUp'
import { postApiSessionsIdSteer } from '@/lib/api/generated/clients/postApiSessionsIdSteer'
import { postApiSessionsIdRuns } from '@/lib/api/generated/clients/postApiSessionsIdRuns'
import { postApiSessionsIdRunsMutationRequestSchema } from '@/lib/api/generated/zod/postApiSessionsIdRunsSchema'
import type {
  AgentProfile,
  AgentSessionSummary,
  ChatMessage,
  ChatMessageType,
  GlobalModelProvider,
  GlobalPromptTemplate,
  GlobalSkill,
  SessionTreeNode,
  StudioExtension,
  TreeNodeRole,
} from '@/lib/types'
import type { StreamingMarkdownSnapshot } from '@/lib/markdown/streaming-markdown'
import { errorMessage, showToast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { useChatAttachments } from '@/components/use-chat-attachments'
import { ImageAttachmentPreview, isImageAttachment } from '@/components/image-attachment-preview'
import { buildPromptWithAttachments } from '@/lib/chat/attachments'
import { hasPersistedAssistantResponse } from '@/lib/chat/stream-lifecycle'

const EVENT_STREAM_CONNECT_TIMEOUT_MS = 5000
const RUN_RECONCILE_INITIAL_DELAY_MS = 1000
const RUN_RECONCILE_POLL_MS = 1200
const RUN_RECONCILE_MAX_MS = 20000
const SESSION_TREE_RECENT_NODE_LIMIT = 80
const INITIAL_VISIBLE_MESSAGE_LIMIT = 120
const MESSAGE_LIMIT_INCREMENT = 100

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

const ComposerSchema = postApiSessionsIdRunsMutationRequestSchema.extend({ message: z.string() })

export function ChatView({
  agents,
  activeAgent,
  sessions,
  activeSession,
  messages,
  tree,
  providers,
  extensions,
  skills,
  prompts,
}: {
  agents: AgentProfile[]
  activeAgent?: AgentProfile
  sessions: AgentSessionSummary[]
  activeSession?: AgentSessionSummary
  messages: ChatMessage[]
  tree: SessionTreeNode | null
  providers: GlobalModelProvider[]
  extensions: StudioExtension[]
  skills: GlobalSkill[]
  prompts: GlobalPromptTemplate[]
}) {
  const router = useRouter()
  const { userAvatar } = useProfileSettings()
  const [streamMessages, setStreamMessages] = useState<ChatMessage[]>([])
  const [streamStartedAt, setStreamStartedAt] = useState<number | null>(null)
  const [composerOverlayHeight, setComposerOverlayHeight] = useState(112)
  const [streamDone, setStreamDone] = useState(false)
  const [streamPhase, setStreamPhase] = useState<StreamPhase>('idle')
  const [optimisticMessage, setOptimisticMessage] = useState<ChatMessage | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [sdkActiveRunId, setSdkActiveRunId] = useState<string | null>(null)
  const [sdkSessionRunning, setSdkSessionRunning] = useState(false)
  const [abortingRun, setAbortingRun] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [queueingMessage, setQueueingMessage] = useState<'steer' | 'follow-up' | null>(null)
  const [showSessionTree, setShowSessionTree] = useState(false)
  const [showActiveContext, setShowActiveContext] = useState(false)
  const [activeContextCollapsed, setActiveContextCollapsed] = useState(false)
  const messageViewportRef = useRef<HTMLDivElement>(null)
  const composerContainerRef = useRef<HTMLDivElement>(null)
  const shouldFollowMessagesRef = useRef(true)
  const prependScrollRef = useRef<{ height: number; top: number } | null>(null)
  const [canScrollUp, setCanScrollUp] = useState(false)
  const [canScrollDown, setCanScrollDown] = useState(false)
  const [visibleMessageLimit, setVisibleMessageLimit] = useState(INITIAL_VISIBLE_MESSAGE_LIMIT)
  const [slashSelection, setSlashSelection] = useState(0)
  const [creatingSession, setCreatingSession] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(() =>
    findCurrentTreeNodeId(tree),
  )
  const [branchMessages, setBranchMessages] = useState<ChatMessage[] | null>(null)
  const [branchPending, setBranchPending] = useState<'navigate' | 'fork' | null>(null)
  const [branchError, setBranchError] = useState<string | null>(null)
  const [extensionCommands, setExtensionCommands] = useState<
    Array<{ name: string; description?: string }>
  >([])
  const eventSourceRef = useRef<EventSource | null>(null)
  const activeRunIdRef = useRef<string | null>(null)
  const reconcileTimerRef = useRef<number | null>(null)
  const currentStreamingAssistantIdRef = useRef<string | null>(null)
  const latestStreamingAssistantIdRef = useRef<string | null>(null)
  const streamMessageSequenceRef = useRef(0)
  const sourceMessageCountAtRunStartRef = useRef(messages.length)
  const sdkSessionWasRunningRef = useRef(false)
  const ignoreSdkRunningUntilIdleRef = useRef(false)

  const applyStreamingContentBatch = useCallback((batch: StreamingContentBatch) => {
    if (batch.length === 0) return
    setStreamMessages((current) => {
      const next = [...current]
      for (const delta of batch) {
        const index = next.findIndex((message) => message.id === delta.messageId)
        if (index >= 0) {
          const message = next[index]
          next[index] = { ...message, content: message.content + delta.content }
        } else {
          next.push({
            id: delta.messageId,
            type: 'assistant',
            content: delta.content,
            timestamp: 'streaming',
          })
        }
      }
      return next
    })
  }, [])

  const replaceStreamingContent = useCallback((messageId: string, content: string) => {
    if (!content) return
    setStreamMessages((current) => {
      const existing = current.find((message) => message.id === messageId)
      if (existing) {
        return current.map((message) =>
          message.id === messageId ? { ...message, content } : message,
        )
      }
      return [
        ...current,
        {
          id: messageId,
          type: 'assistant',
          content,
          timestamp: 'streaming',
        },
      ]
    })
  }, [])

  const {
    snapshots: streamingMarkdownSnapshots,
    beginMessage: beginStreamingMarkdownMessage,
    appendDelta: appendStreamingMarkdownDelta,
    sealTextSegment: sealStreamingMarkdownSegment,
    finishMessage: finishStreamingMarkdownMessage,
    finishAll: finishAllStreamingMarkdown,
    flush: flushStreamingMarkdown,
    reset: resetStreamingMarkdown,
  } = useStreamingMarkdown({
    onFlushContent: applyStreamingContentBatch,
    onReplaceContent: replaceStreamingContent,
  })

  const handleAttachmentError = useCallback((message: string) => {
    showToast({ tone: 'error', title: 'Attachment unavailable', message })
  }, [])
  const {
    attachments,
    addFiles: addAttachmentFiles,
    clear: clearAttachments,
    removeAttachment,
    retryAttachment,
    uploadAll: uploadAllAttachments,
    isUploading: isUploadingAttachments,
  } = useChatAttachments({
    sessionId: activeSession?.id ?? '',
    onError: handleAttachmentError,
  })

  const availableModelOptions = useMemo(() => {
    const enabledProviders = new Set(activeAgent?.selectedProviderIds ?? [])
    const enabledModels = new Set(activeAgent?.selectedModelIds ?? [])
    return providers
      .filter((provider) => enabledProviders.has(provider.id))
      .flatMap((provider) =>
        provider.models
          .filter(
            (model) =>
              enabledModels.has(`${provider.id}::${model.id}`) || enabledModels.has(model.id),
          )
          .map((model) => ({ provider, model })),
      )
  }, [activeAgent?.selectedModelIds, activeAgent?.selectedProviderIds, providers])
  const defaultModelOption =
    availableModelOptions.find(
      ({ provider, model }) =>
        provider.id === activeAgent?.defaultProviderId && model.id === activeAgent?.defaultModelId,
    ) ?? availableModelOptions[0]

  const form = useForm<ComposerValues>({
    resolver: zodResolver(ComposerSchema as never),
    defaultValues: {
      message: '',
      providerId: defaultModelOption?.provider.id,
      modelId: defaultModelOption?.model.id,
      thinkingLevel: activeAgent?.defaultThinkingLevel ?? 'medium',
    },
  })
  const applyExtensionEditorText = useCallback(
    (text: string, mode: 'set' | 'append') => {
      const current = form.getValues('message') ?? ''
      form.setValue('message', mode === 'append' ? current + text : text, {
        shouldDirty: true,
      })
      form.setFocus('message')
    },
    [form],
  )

  const thinking = form.watch('thinkingLevel') ?? 'medium'
  const model = form.watch('modelId') ?? activeAgent?.defaultModelId ?? 'model'
  const message = form.watch('message') ?? ''
  const composerValues = {
    message: message.trim(),
    providerId: form.watch('providerId'),
    modelId: form.watch('modelId'),
    thinkingLevel: thinking,
  }
  const extensionCommandMatch = message.trim().match(/^\/([^\s]+)(?:\s+(.*))?$/)
  const selectedExtensionCommand = extensionCommands.find(
    (command) => command.name === extensionCommandMatch?.[1],
  )

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (!shouldFollowMessagesRef.current) return
      const messageViewport = messageViewportRef.current
      if (messageViewport) messageViewport.scrollTop = messageViewport.scrollHeight
    })
    return () => window.cancelAnimationFrame(frame)
  }, [message])

  useEffect(() => {
    const composer = composerContainerRef.current
    if (!composer) return
    const updateHeight = () => setComposerOverlayHeight(composer.offsetHeight)
    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(composer)
    return () => observer.disconnect()
  }, [])
  const selectedModelOption = availableModelOptions.find(
    ({ provider, model: candidate }) =>
      provider.id === composerValues.providerId && candidate.id === composerValues.modelId,
  )
  const isNewSessionCommand = composerValues.message.toLowerCase() === '/new-session'
  const canSend = Boolean(
    isNewSessionCommand ||
    selectedExtensionCommand ||
    (selectedModelOption &&
      (composerValues.message.length > 0 || attachments.length > 0) &&
      !isUploadingAttachments),
  )
  const activeModelName = selectedModelOption?.model.name ?? selectedModelOption?.model.id ?? model

  useEffect(() => {
    const currentProviderId = form.getValues('providerId')
    const currentModelId = form.getValues('modelId')
    const currentIsEnabled = availableModelOptions.some(
      ({ provider, model: candidate }) =>
        provider.id === currentProviderId && candidate.id === currentModelId,
    )
    if (currentIsEnabled) return
    form.setValue('providerId', defaultModelOption?.provider.id)
    form.setValue('modelId', defaultModelOption?.model.id)
  }, [availableModelOptions, defaultModelOption, form])

  const skillNames = useMemo(() => {
    const selected = new Set(activeAgent?.selectedSkillIds ?? [])
    return skills.filter((skill) => selected.has(skill.id)).map((skill) => skill.name)
  }, [activeAgent?.selectedSkillIds, skills])
  const selectedPrompts = useMemo(() => {
    const selected = new Set(activeAgent?.selectedPromptIds ?? [])
    return prompts.filter((prompt) => selected.has(prompt.id))
  }, [activeAgent?.selectedPromptIds, prompts])
  const extensionNames = useMemo(() => {
    const selected = new Set(activeAgent?.selectedExtensionIds ?? [])
    return extensions
      .filter((extension) => selected.has(extension.id))
      .map((extension) => extension.name)
  }, [activeAgent?.selectedExtensionIds, extensions])

  useEffect(() => {
    let active = true
    let timer: number | undefined
    const load = async () => {
      if (!activeSession) return
      try {
        const response = await fetch(
          `/api/sessions/${encodeURIComponent(activeSession.id)}/extensions`,
          { cache: 'no-store' },
        )
        if (response.ok) {
          const snapshot = (await response.json()) as {
            extensions: Array<{
              commands: Array<{ name: string; description?: string }>
            }>
          }
          if (active) {
            const commands = snapshot.extensions.flatMap((extension) => extension.commands)
            setExtensionCommands(
              commands.filter(
                (command, index) =>
                  commands.findIndex((candidate) => candidate.name === command.name) === index,
              ),
            )
          }
        } else if (active) {
          setExtensionCommands([])
        }
      } catch {
        if (active) setExtensionCommands([])
      }
      if (active) timer = window.setTimeout(load, 2500)
    }
    void load()
    return () => {
      active = false
      if (timer) window.clearTimeout(timer)
    }
  }, [activeSession])

  const createNewSession = async () => {
    if (!activeAgent || creatingSession) return
    if (runId || sdkSessionRunning) {
      showToast({
        tone: 'error',
        title: 'Run in progress',
        message: 'Stop the active run before starting a new session.',
      })
      return
    }
    setCreatingSession(true)
    try {
      const session = await postApiSessions({
        agentId: activeAgent.id,
        name: 'New conversation',
        cwd: activeAgent.defaultCwd ?? activeSession?.cwd,
      })
      form.setValue('message', '')
      clearAttachments()
      showToast({
        tone: 'success',
        title: 'New session ready',
        message: `Started a clean conversation with ${activeAgent.name}.`,
      })
      router.push(`/chat?agent=${activeAgent.id}&session=${session.id}`)
      router.refresh()
    } catch (error) {
      showToast({
        tone: 'error',
        title: 'Unable to create session',
        message: errorMessage(error, 'Session creation failed.'),
      })
    } finally {
      setCreatingSession(false)
    }
  }

  const switchSession = (sessionId: string) => {
    if (
      !activeAgent ||
      sessionId === activeSession?.id ||
      streamPhase !== 'idle' ||
      sdkSessionRunning ||
      creatingSession ||
      branchPending !== null
    )
      return
    router.push(
      `/chat?agent=${encodeURIComponent(activeAgent.id)}&session=${encodeURIComponent(sessionId)}`,
    )
  }

  const switchAgent = (agentId: string) => {
    if (
      !activeAgent ||
      agentId === activeAgent.id ||
      streamPhase !== 'idle' ||
      sdkSessionRunning ||
      creatingSession ||
      branchPending !== null
    )
      return
    router.push(`/chat?agent=${encodeURIComponent(agentId)}`)
  }

  const slashQuery = message.match(/^\/([^\s]*)$/)?.[1]?.toLowerCase()
  const slashCommandOptions = useMemo<SlashCommandOption[]>(() => {
    if (slashQuery === undefined) return []
    const options: SlashCommandOption[] = []
    if ('new-session'.includes(slashQuery)) {
      options.push({
        kind: 'builtin',
        id: 'new-session',
        command: 'new-session',
        description: 'Start a clean conversation with the current agent.',
      })
    }
    options.push(
      ...selectedPrompts
        .filter(
          (prompt) =>
            prompt.name.toLowerCase().includes(slashQuery) ||
            prompt.description?.toLowerCase().includes(slashQuery),
        )
        .map((prompt) => ({
          kind: 'prompt' as const,
          id: prompt.id,
          command: prompt.name,
          description: prompt.description || 'No description',
          argumentHint: prompt.argumentHint,
          prompt,
        })),
    )
    options.push(
      ...extensionCommands
        .filter(
          (command) =>
            command.name.toLowerCase().includes(slashQuery) ||
            command.description?.toLowerCase().includes(slashQuery),
        )
        .map((command) => ({
          kind: 'extension' as const,
          id: command.name,
          command: command.name,
          description: command.description || 'Extension command',
        })),
    )
    return options.slice(0, 8)
  }, [extensionCommands, selectedPrompts, slashQuery])

  useEffect(() => {
    setSlashSelection(0)
  }, [slashQuery])

  const insertPromptCommand = (prompt: GlobalPromptTemplate) => {
    form.setValue('message', `/${prompt.name} `, { shouldDirty: true })
    form.setFocus('message')
  }

  const executeSlashCommand = (option: SlashCommandOption) => {
    if (option.kind === 'builtin') {
      void createNewSession()
      return
    }
    if (option.kind === 'extension') {
      form.setValue('message', `/${option.command} `, { shouldDirty: true })
      form.setFocus('message')
      return
    }
    insertPromptCommand(option.prompt)
  }
  const sourceMessages = branchMessages ?? messages

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close()
      if (reconcileTimerRef.current) {
        window.clearTimeout(reconcileTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    let active = true
    let timer: number | undefined
    const activeSessionId = activeSession?.id
    sdkSessionWasRunningRef.current = false
    ignoreSdkRunningUntilIdleRef.current = false
    setSdkSessionRunning(false)
    setSdkActiveRunId(null)

    const poll = async () => {
      if (!activeSessionId) return
      try {
        const state = (await getApiSessionsIdAgentState(activeSessionId, {
          headers: { 'cache-control': 'no-cache' },
        })) as Awaited<ReturnType<typeof getApiSessionsIdAgentState>> & {
          activeRunId?: string | null
        }
        if (!active) return
        if (ignoreSdkRunningUntilIdleRef.current) {
          if (!state.running) ignoreSdkRunningUntilIdleRef.current = false
          sdkSessionWasRunningRef.current = false
          setSdkActiveRunId(null)
          setSdkSessionRunning(false)
          if (active) timer = window.setTimeout(poll, RUN_RECONCILE_POLL_MS)
          return
        }
        const wasRunning = sdkSessionWasRunningRef.current
        sdkSessionWasRunningRef.current = state.running
        setSdkActiveRunId(state.activeRunId ?? null)
        setSdkSessionRunning(state.running)
        if (wasRunning && !state.running) {
          if (!activeRunIdRef.current) {
            setStreamPhase('idle')
            setStreamDone(true)
          }
          router.refresh()
        }
      } catch {
        // Keep the last known state during transient polling failures.
      }
      if (active) timer = window.setTimeout(poll, RUN_RECONCILE_POLL_MS)
    }

    void poll()
    return () => {
      active = false
      if (timer) window.clearTimeout(timer)
    }
  }, [activeSession?.id, router])

  useEffect(() => {
    setSelectedNodeId(findCurrentTreeNodeId(tree))
    setVisibleMessageLimit(INITIAL_VISIBLE_MESSAGE_LIMIT)
    setBranchMessages(null)
    setBranchError(null)
  }, [activeSession?.id, tree])

  useEffect(() => {
    if (!streamDone) return
    const timer = window.setTimeout(() => {
      router.refresh()
    }, 50)

    return () => window.clearTimeout(timer)
  }, [router, streamDone])

  const hasPersistedRun =
    streamDone &&
    hasPersistedAssistantResponse(sourceMessages, sourceMessageCountAtRunStartRef.current)

  useEffect(() => {
    if (!hasPersistedRun) return

    setStreamMessages([])
    setStreamStartedAt(null)
    setStreamDone(false)
    setOptimisticMessage(null)
    setStreamPhase('idle')
    setBranchMessages(null)
    currentStreamingAssistantIdRef.current = null
    latestStreamingAssistantIdRef.current = null
    resetStreamingMarkdown()
  }, [hasPersistedRun, resetStreamingMarkdown])

  const baseMessages = useMemo(() => {
    if (!optimisticMessage) return sourceMessages

    const hasPersistedOptimisticMessage = sourceMessages.some(
      (message) =>
        message.type === 'user' &&
        message.content === optimisticMessage.content &&
        sameAttachments(message.attachments, optimisticMessage.attachments),
    )

    return hasPersistedOptimisticMessage ? sourceMessages : [...sourceMessages, optimisticMessage]
  }, [optimisticMessage, sourceMessages])

  const displayMessages = useMemo(
    () =>
      hasPersistedRun
        ? baseMessages
        : [...baseMessages, ...streamMessages.filter((message) => message.content)],
    [baseMessages, hasPersistedRun, streamMessages],
  )
  const hiddenMessageCount = Math.max(0, displayMessages.length - visibleMessageLimit)
  const visibleDisplayMessages = useMemo(
    () => (hiddenMessageCount > 0 ? displayMessages.slice(-visibleMessageLimit) : displayMessages),
    [displayMessages, hiddenMessageCount, visibleMessageLimit],
  )
  const displayItems = useMemo(
    () => buildDisplayItems(visibleDisplayMessages),
    [visibleDisplayMessages],
  )

  const loadOlderMessages = () => {
    const viewport = messageViewportRef.current
    if (viewport) {
      prependScrollRef.current = {
        height: viewport.scrollHeight,
        top: viewport.scrollTop,
      }
    }
    shouldFollowMessagesRef.current = false
    setVisibleMessageLimit((current) => current + MESSAGE_LIMIT_INCREMENT)
  }

  useEffect(() => {
    const previous = prependScrollRef.current
    const viewport = messageViewportRef.current
    if (!previous || !viewport) return
    const frame = window.requestAnimationFrame(() => {
      viewport.scrollTop = previous.top + (viewport.scrollHeight - previous.height)
      prependScrollRef.current = null
    })
    return () => window.cancelAnimationFrame(frame)
  }, [visibleMessageLimit])

  useEffect(() => {
    const viewport = messageViewportRef.current
    if (!viewport) return

    const updateScrollState = () => {
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
      const nearBottom = distanceFromBottom < 96
      shouldFollowMessagesRef.current = nearBottom
      setCanScrollUp(viewport.scrollTop > 96)
      setCanScrollDown(distanceFromBottom > 96)
    }

    updateScrollState()
    viewport.addEventListener('scroll', updateScrollState, { passive: true })
    const observer = new ResizeObserver(updateScrollState)
    observer.observe(viewport)
    return () => {
      viewport.removeEventListener('scroll', updateScrollState)
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    const viewport = messageViewportRef.current
    if (!viewport || !shouldFollowMessagesRef.current) return
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'auto' })
  }, [displayMessages.length, streamMessages])

  const scrollMessagesTo = (position: 'top' | 'bottom') => {
    const viewport = messageViewportRef.current
    if (!viewport) return
    shouldFollowMessagesRef.current = position === 'bottom'
    viewport.scrollTo({
      top: position === 'top' ? 0 : viewport.scrollHeight,
      behavior: 'smooth',
    })
  }
  const isStartingRun = streamPhase === 'starting' && !runId
  const isRunningRun = Boolean(runId) || sdkSessionRunning
  const isWaiting =
    !streamError &&
    !hasPersistedRun &&
    (streamPhase !== 'idle' || sdkSessionRunning) &&
    streamMessages.length === 0

  const clearReconciliation = () => {
    if (!reconcileTimerRef.current) return
    window.clearTimeout(reconcileTimerRef.current)
    reconcileTimerRef.current = null
  }

  const finishActiveStream = (currentRunId: string, source?: EventSource | null) => {
    if (activeRunIdRef.current !== currentRunId) return false
    finishAllStreamingMarkdown()
    clearReconciliation()
    source?.close()
    if (eventSourceRef.current === source) eventSourceRef.current = null
    activeRunIdRef.current = null
    ignoreSdkRunningUntilIdleRef.current = true
    sdkSessionWasRunningRef.current = false
    setRunId(null)
    setSdkActiveRunId(null)
    setSdkSessionRunning(false)
    setAbortingRun(false)
    setStreamPhase('idle')
    setStreamDone(true)
    setBranchMessages(null)
    return true
  }

  const failActiveStream = (currentRunId: string, message: string, source?: EventSource | null) => {
    if (activeRunIdRef.current !== currentRunId) return false
    finishAllStreamingMarkdown()
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

  const startStreamingAssistant = useCallback(
    (messageId?: string) => {
      const id = messageId ?? `stream-assistant-${Date.now()}-${streamMessageSequenceRef.current++}`
      currentStreamingAssistantIdRef.current = id
      latestStreamingAssistantIdRef.current = id
      beginStreamingMarkdownMessage(id)
      return id
    },
    [beginStreamingMarkdownMessage],
  )

  const appendStreamingAssistantDelta = useCallback(
    (content: string, messageId?: string, contentIndex = 0) => {
      if (!content) return
      const id = messageId ?? currentStreamingAssistantIdRef.current ?? startStreamingAssistant()
      if (currentStreamingAssistantIdRef.current !== id) startStreamingAssistant(id)
      appendStreamingMarkdownDelta(id, contentIndex, content)
    },
    [appendStreamingMarkdownDelta, startStreamingAssistant],
  )

  const endStreamingAssistant = useCallback(
    (messageId?: string) => {
      const id = messageId ?? currentStreamingAssistantIdRef.current
      if (!id) return
      finishStreamingMarkdownMessage(id)
      setStreamMessages((current) =>
        current.map((message) =>
          message.id === id && message.timestamp === 'streaming'
            ? { ...message, timestamp: 'now' }
            : message,
        ),
      )
      if (currentStreamingAssistantIdRef.current === id) {
        currentStreamingAssistantIdRef.current = null
      }
    },
    [finishStreamingMarkdownMessage],
  )

  const appendStreamProcessMessage = useCallback(
    (
      type: Extract<ChatMessageType, 'thinking' | 'tool_call' | 'tool_result' | 'bash'>,
      content: string,
      title?: string,
    ) => {
      if (!content) return
      flushStreamingMarkdown()
      setStreamMessages((current) => {
        if (type === 'thinking') {
          const last = current.at(-1)
          if (last?.type === 'thinking') {
            return [...current.slice(0, -1), { ...last, content: last.content + content }]
          }
        }

        const last = current.at(-1)
        if (last?.type === type && last.title === title && type === 'bash') {
          return [...current.slice(0, -1), { ...last, content: last.content + content }]
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
    },
    [flushStreamingMarkdown],
  )

  useEffect(() => {
    if (!activeSession || !sdkSessionRunning || runId || ignoreSdkRunningUntilIdleRef.current)
      return

    setStreamStartedAt(Date.now())
    setStreamDone(false)
    setStreamError(null)
    setStreamPhase('thinking')
    currentStreamingAssistantIdRef.current = null
    latestStreamingAssistantIdRef.current = null
    resetStreamingMarkdown()

    const source = new EventSource(
      `/api/sessions/${encodeURIComponent(activeSession.id)}/live-events`,
    )
    eventSourceRef.current = source
    source.addEventListener('assistant_message_start', (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { messageId?: string }
      startStreamingAssistant(payload.messageId)
    })
    source.addEventListener('assistant_message_end', (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { messageId?: string }
      endStreamingAssistant(payload.messageId)
    })
    source.addEventListener('assistant_text_end', (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as {
        messageId?: string
        contentIndex?: number
        content?: string
      }
      const messageId = payload.messageId ?? currentStreamingAssistantIdRef.current
      if (!messageId) return
      sealStreamingMarkdownSegment(messageId, payload.contentIndex ?? 0, payload.content)
    })
    source.addEventListener('message_delta', (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as {
        content?: string
        messageId?: string
        contentIndex?: number
      }
      setStreamPhase('streaming')
      appendStreamingAssistantDelta(
        payload.content ?? '',
        payload.messageId,
        payload.contentIndex ?? 0,
      )
    })
    source.addEventListener('thinking_delta', (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { content?: string }
      setStreamPhase('thinking')
      appendStreamProcessMessage('thinking', payload.content ?? '', 'Thinking')
    })
    source.addEventListener('tool_call_delta', (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as {
        content?: string
        title?: string
      }
      setStreamPhase('thinking')
      appendStreamProcessMessage('tool_call', payload.content ?? '', payload.title ?? 'Tool call')
    })
    source.addEventListener('tool_result_delta', (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as {
        content?: string
        title?: string
      }
      setStreamPhase('thinking')
      appendStreamProcessMessage(
        'tool_result',
        payload.content ?? '',
        payload.title ?? 'Tool result',
      )
    })
    source.addEventListener('bash_output', (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as {
        content?: string
        stream?: 'stdout' | 'stderr'
      }
      setStreamPhase('thinking')
      appendStreamProcessMessage('bash', payload.content ?? '', payload.stream ?? 'stderr')
    })
    source.addEventListener('usage', (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as {
        usage?: StreamUsage
        messageId?: string
      }
      const assistantId = payload.messageId ?? latestStreamingAssistantIdRef.current
      if (!assistantId || !payload.usage) return
      const usage = {
        input: payload.usage.input ?? 0,
        output: payload.usage.output ?? 0,
        cacheRead: payload.usage.cacheRead ?? 0,
        cacheWrite: payload.usage.cacheWrite ?? 0,
        cost: payload.usage.cost,
      }
      setStreamMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? { ...message, tokens: payload.usage?.totalTokens, usage }
            : message,
        ),
      )
    })
    source.addEventListener('error', (event) => {
      const data = (event as MessageEvent).data
      if (typeof data !== 'string' || !data) return
      const payload = JSON.parse(data) as { message?: string }
      finishAllStreamingMarkdown()
      setStreamError(payload.message ?? 'pi run failed.')
    })
    source.addEventListener('done', () => {
      finishAllStreamingMarkdown()
      source.close()
      if (eventSourceRef.current === source) eventSourceRef.current = null
      sdkSessionWasRunningRef.current = false
      setSdkSessionRunning(false)
      setStreamPhase('idle')
      setStreamDone(true)
      router.refresh()
    })

    return () => {
      source.close()
      if (eventSourceRef.current === source) eventSourceRef.current = null
    }
  }, [
    activeSession,
    appendStreamProcessMessage,
    appendStreamingAssistantDelta,
    endStreamingAssistant,
    finishAllStreamingMarkdown,
    router,
    runId,
    sdkSessionRunning,
    sealStreamingMarkdownSegment,
    startStreamingAssistant,
    resetStreamingMarkdown,
  ])

  const submit = form.handleSubmit(async (values) => {
    if (!activeSession || !activeAgent) return
    if (values.message.trim().toLowerCase() === '/new-session') {
      await createNewSession()
      return
    }
    const commandMatch = values.message.trim().match(/^\/([^\s]+)(?:\s+(.*))?$/)
    const extensionCommand = extensionCommands.find((command) => command.name === commandMatch?.[1])
    if (extensionCommand) {
      try {
        const response = await fetch(
          `/api/sessions/${encodeURIComponent(activeSession.id)}/extensions/commands/${encodeURIComponent(extensionCommand.name)}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ args: commandMatch?.[2] ?? '' }),
          },
        )
        const result = (await response.json()) as { status: string; error?: string }
        if (!response.ok || result.status !== 'completed') {
          throw new Error(
            result.error ??
              (result.status === 'session-running'
                ? 'Wait for the active run to finish before executing this command.'
                : 'The extension command is unavailable.'),
          )
        }
        form.setValue('message', '')
        clearAttachments()
        showToast({
          tone: 'success',
          title: `/${extensionCommand.name}`,
          message: 'Extension command completed.',
        })
      } catch (commandError) {
        showToast({
          tone: 'error',
          title: `/${extensionCommand.name}`,
          message: errorMessage(commandError, 'Extension command failed.'),
        })
      }
      return
    }
    const trimmedMessage = values.message.trim()
    if (!trimmedMessage && attachments.length === 0) return
    try {
      const state = await getApiSessionsIdAgentState(activeSession.id, {
        headers: { 'cache-control': 'no-cache' },
      })
      if (state.running) {
        sdkSessionWasRunningRef.current = true
        setSdkSessionRunning(true)
        showToast({
          tone: 'warning',
          title: 'Agent is processing',
          message: 'Use Steer now or Follow up to queue this message.',
        })
        return
      }
    } catch {
      // Starting the run remains the source of truth if the preflight check is unavailable.
    }
    const uploadedAttachments = attachments.length > 0 ? await uploadAllAttachments() : []
    if (!uploadedAttachments) return
    const payload = {
      ...values,
      message: buildPromptWithAttachments(trimmedMessage, uploadedAttachments),
    }
    if (!postApiSessionsIdRunsMutationRequestSchema.safeParse(payload).success) return
    eventSourceRef.current?.close()
    clearReconciliation()
    activeRunIdRef.current = null
    ignoreSdkRunningUntilIdleRef.current = false
    setSdkActiveRunId(null)
    setStreamMessages([])
    resetStreamingMarkdown()
    setStreamStartedAt(Date.now())
    setStreamDone(false)
    setStreamPhase('starting')
    setAbortingRun(false)
    setStreamError(null)
    currentStreamingAssistantIdRef.current = null
    latestStreamingAssistantIdRef.current = null
    streamMessageSequenceRef.current = 0
    sourceMessageCountAtRunStartRef.current = sourceMessages.length
    setOptimisticMessage({
      id: `optimistic-user-${Date.now()}`,
      type: 'user',
      content: trimmedMessage,
      attachments: uploadedAttachments,
      timestamp: 'sending',
    })
    try {
      const run = await postApiSessionsIdRuns(activeSession.id, payload)
      activeRunIdRef.current = run.id
      setRunId(run.id)
      setStreamPhase('connecting')
      clearAttachments()
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
      eventSource.addEventListener('assistant_message_start', (event) => {
        if (activeRunIdRef.current !== currentRunId) return
        window.clearTimeout(connectionTimeout)
        const payload = JSON.parse((event as MessageEvent).data) as { messageId?: string }
        startStreamingAssistant(payload.messageId)
      })
      eventSource.addEventListener('assistant_message_end', (event) => {
        if (activeRunIdRef.current !== currentRunId) return
        const payload = JSON.parse((event as MessageEvent).data) as { messageId?: string }
        endStreamingAssistant(payload.messageId)
      })
      eventSource.addEventListener('assistant_text_end', (event) => {
        if (activeRunIdRef.current !== currentRunId) return
        const payload = JSON.parse((event as MessageEvent).data) as {
          messageId?: string
          contentIndex?: number
          content?: string
        }
        const messageId = payload.messageId ?? currentStreamingAssistantIdRef.current
        if (!messageId) return
        sealStreamingMarkdownSegment(messageId, payload.contentIndex ?? 0, payload.content)
      })
      eventSource.addEventListener('message_delta', (event) => {
        if (activeRunIdRef.current !== currentRunId) return
        window.clearTimeout(connectionTimeout)
        const payload = JSON.parse((event as MessageEvent).data) as {
          content?: string
          usage?: StreamUsage
          messageId?: string
          contentIndex?: number
        }
        const content = payload.content ?? ''
        if (!content) return
        setStreamPhase('streaming')
        appendStreamingAssistantDelta(content, payload.messageId, payload.contentIndex ?? 0)
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
        appendStreamProcessMessage(
          'tool_result',
          payload.content ?? '',
          payload.title ?? 'Tool result',
        )
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
          messageId?: string
        }
        const assistantId = payload.messageId ?? latestStreamingAssistantIdRef.current
        if (!assistantId || !payload.usage) return
        const usage = {
          input: payload.usage.input ?? 0,
          output: payload.usage.output ?? 0,
          cacheRead: payload.usage.cacheRead ?? 0,
          cacheWrite: payload.usage.cacheWrite ?? 0,
          cost: payload.usage.cost,
        }
        setStreamMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  tokens: payload.usage?.totalTokens,
                  usage,
                }
              : message,
          ),
        )
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
      const message = errorMessage(error, 'Unable to start pi run.')
      setStreamPhase('idle')
      setRunId(null)
      setAbortingRun(false)
      activeRunIdRef.current = null
      setOptimisticMessage(null)
      setStreamStartedAt(null)
      if (/already processing|streamingBehavior/i.test(message)) {
        sdkSessionWasRunningRef.current = true
        setSdkSessionRunning(true)
        setStreamError(null)
        showToast({
          tone: 'warning',
          title: 'Agent is processing',
          message: 'Use Steer now or Follow up to queue this message.',
        })
      } else {
        setStreamError(message)
      }
      return
    }
  })

  const abort = async () => {
    const abortRunId = runId ?? sdkActiveRunId
    if (!abortRunId || abortingRun) return
    setAbortingRun(true)
    try {
      await postApiRunsIdAbort(abortRunId)
      clearReconciliation()
      eventSourceRef.current?.close()
      eventSourceRef.current = null
      activeRunIdRef.current = null
      finishAllStreamingMarkdown()
      setRunId(null)
      setSdkActiveRunId(null)
      setStreamPhase('idle')
      setStreamStartedAt(null)
      router.refresh()
    } catch (error) {
      finishAllStreamingMarkdown()
      setStreamError(error instanceof Error ? error.message : 'Unable to abort pi run.')
    } finally {
      setAbortingRun(false)
    }
  }

  const queueMessage = async (behavior: 'steer' | 'follow-up') => {
    const content = form.getValues('message').trim()
    if (!activeSession || (!content && attachments.length === 0) || queueingMessage) return
    setQueueingMessage(behavior)
    setStreamError(null)
    try {
      const uploadedAttachments = attachments.length > 0 ? await uploadAllAttachments() : []
      if (!uploadedAttachments) return
      const prompt = buildPromptWithAttachments(content, uploadedAttachments)
      if (behavior === 'steer') {
        await postApiSessionsIdSteer(activeSession.id, { message: prompt })
      } else {
        await postApiSessionsIdFollowUp(activeSession.id, { message: prompt })
      }
      form.setValue('message', '')
      clearAttachments()
    } catch (error) {
      setStreamError(
        error instanceof Error ? error.message : `Unable to queue ${behavior} message.`,
      )
    } finally {
      setQueueingMessage(null)
    }
  }

  const selectTreeNode = async (entryId: string) => {
    if (!activeSession || isRunningRun) return
    setSelectedNodeId(entryId)
    setBranchError(null)
    try {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(activeSession.id)}/context?leafId=${encodeURIComponent(entryId)}`,
      )
      const body = (await response.json()) as {
        messages?: ChatMessage[]
        error?: string
      }
      if (!response.ok || !body.messages)
        throw new Error(body.error ?? 'Unable to load branch context.')
      setBranchMessages(body.messages)
    } catch (error) {
      setBranchError(error instanceof Error ? error.message : 'Unable to load branch context.')
    }
  }

  const startBranch = async () => {
    if (!activeSession || !selectedNodeId || isRunningRun) return
    setBranchPending('navigate')
    setBranchError(null)
    try {
      const response = await fetch(`/api/sessions/${activeSession.id}/navigate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entryId: selectedNodeId }),
      })
      const body = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Unable to create branch.')
      form.setFocus('message')
    } catch (error) {
      setBranchError(error instanceof Error ? error.message : 'Unable to create branch.')
    } finally {
      setBranchPending(null)
    }
  }

  const forkSession = async () => {
    if (!activeAgent || !activeSession || !selectedNodeId || isRunningRun) return
    setBranchPending('fork')
    setBranchError(null)
    try {
      const response = await fetch(`/api/sessions/${activeSession.id}/fork`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entryId: selectedNodeId }),
      })
      const body = (await response.json()) as { id?: string; error?: string }
      if (!response.ok || !body.id) throw new Error(body.error ?? 'Unable to fork session.')
      router.push(`/chat?agent=${activeAgent.id}&session=${body.id}`)
      router.refresh()
    } catch (error) {
      setBranchError(error instanceof Error ? error.message : 'Unable to fork session.')
    } finally {
      setBranchPending(null)
    }
  }

  const totalTreeNodes = countTreeNodes(tree)
  const visibleTree = useMemo(
    () => buildRecentSessionTree(tree, SESSION_TREE_RECENT_NODE_LIMIT, selectedNodeId),
    [tree, selectedNodeId],
  )
  const visibleTreeNodes = countTreeNodes(visibleTree)

  if (!activeAgent || !activeSession) {
    return <EmptyState onOpenAgents={() => router.push('/')} />
  }

  const canAbortRun = Boolean(runId ?? sdkActiveRunId)
  const sendButtonLabel = abortingRun
    ? 'Stopping'
    : isStartingRun && !canAbortRun
      ? 'Sending'
      : isRunningRun
        ? canAbortRun
          ? 'Stop'
          : 'Working'
        : creatingSession
          ? 'Creating'
          : isNewSessionCommand
            ? 'New session'
            : 'Send'

  return (
    <div className="flex h-full min-h-0">
      {/* LEFT: session tree */}
      {showSessionTree && (
        <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-panel">
          <div className="flex h-18 shrink-0 items-center gap-3 border-b border-border px-4">
            <div>
              <Label>Session tree</Label>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                {visibleTreeNodes < totalTreeNodes
                  ? `${visibleTreeNodes} of ${totalTreeNodes} recent nodes`
                  : `${totalTreeNodes} nodes`}{' '}
                · {sessions.length} sessions
              </p>
            </div>
          </div>
          <ScrollArea className="min-h-0 flex-1" viewportClassName="py-2 pl-2 pr-5">
            {visibleTree ? (
              <TreeNode
                node={visibleTree}
                depth={0}
                selectedId={selectedNodeId}
                onSelect={selectTreeNode}
              />
            ) : (
              <p className="px-2 py-6 text-center font-mono text-[11px] text-muted-foreground">
                No tree nodes yet
              </p>
            )}
          </ScrollArea>
          {branchError && (
            <p className="border-t border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
              {branchError}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 border-border p-2">
            <BracketButton
              className="justify-center whitespace-nowrap"
              disabled={!selectedNodeId || isRunningRun || branchPending !== null}
              onClick={() => void startBranch()}
            >
              <span className="inline-flex items-center gap-1.5">
                <GitBranch className="size-3 shrink-0" />
                <span>{branchPending === 'navigate' ? 'Branching' : 'New branch'}</span>
              </span>
            </BracketButton>
            <BracketButton
              className="justify-center whitespace-nowrap"
              disabled={!selectedNodeId || isRunningRun || branchPending !== null}
              onClick={() => void forkSession()}
            >
              <span className="inline-flex items-center gap-1.5">
                <GitBranch className="size-3 shrink-0" />
                <span>{branchPending === 'fork' ? 'Forking' : 'Fork'}</span>
              </span>
            </BracketButton>
          </div>
        </aside>
      )}

      {/* CENTER: conversation */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* header */}
        <div className="flex h-18 shrink-0 items-center justify-between gap-3 border-b border-border px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => setShowSessionTree((value) => !value)}
              className="flex size-8 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={showSessionTree ? 'Hide session tree' : 'Show session tree'}
              aria-label={showSessionTree ? 'Hide session tree' : 'Show session tree'}
            >
              {showSessionTree ? (
                <PanelLeftClose className="size-4" />
              ) : (
                <PanelLeftOpen className="size-4" />
              )}
            </button>
            <div className="flex min-w-0 items-center gap-1.5">
              <Select
                value={activeAgent.id}
                onValueChange={(value) => {
                  if (value !== null) switchAgent(value)
                }}
                disabled={
                  streamPhase !== 'idle' ||
                  sdkSessionRunning ||
                  creatingSession ||
                  branchPending !== null
                }
              >
                <SelectTrigger
                  aria-label="Switch agent"
                  size="sm"
                  variant="ghost"
                  className="h-7 max-w-[30vw] px-2 text-xs text-foreground"
                >
                  <SelectValue>{activeAgent.name}</SelectValue>
                </SelectTrigger>
                <SelectContent
                  align="start"
                  alignItemWithTrigger={false}
                  className="w-max max-w-[calc(100vw-2rem)] min-w-(--anchor-width) sm:max-w-sm"
                >
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={activeSession.id}
                onValueChange={(value) => {
                  if (value !== null) switchSession(value)
                }}
                disabled={
                  streamPhase !== 'idle' ||
                  sdkSessionRunning ||
                  creatingSession ||
                  branchPending !== null
                }
              >
                <SelectTrigger
                  aria-label="Switch session"
                  size="sm"
                  variant="ghost"
                  className="h-7 max-w-[40vw] px-2 text-[11px] text-muted-foreground hover:text-foreground sm:max-w-80"
                >
                  <SelectValue>
                    {activeSession.name ?? activeSession.firstUserMessage ?? 'New conversation'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent
                  align="start"
                  alignItemWithTrigger={false}
                  className="w-max max-w-[calc(100vw-2rem)] min-w-(--anchor-width) sm:max-w-lg"
                >
                  {sessions.toReversed().map((session) => (
                    <SelectItem key={session.id} value={session.id}>
                      {session.name ?? session.firstUserMessage ?? 'New conversation'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Tag tone="outline">
              <Circle
                className={cn(
                  'size-2',
                  isRunningRun ? 'fill-success text-success' : 'text-muted-foreground',
                )}
              />
              {isRunningRun ? 'running' : 'ready'}
            </Tag>
            <Tag tone="outline">{activeSession.messageCount} msgs</Tag>
            <button
              type="button"
              onClick={() => setShowActiveContext((value) => !value)}
              className="flex size-8 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={showActiveContext ? 'Hide active context' : 'Show active context'}
              aria-label={showActiveContext ? 'Hide active context' : 'Show active context'}
            >
              {showActiveContext ? (
                <PanelRightClose className="size-4" />
              ) : (
                <PanelRightOpen className="size-4" />
              )}
            </button>
          </div>
        </div>

        {/* messages */}
        <div className="relative min-h-0 flex-1">
          <ScrollArea
            className="h-full min-h-0"
            viewportClassName="px-5 py-6"
            viewportRef={messageViewportRef}
          >
            <div className="mx-auto flex w-full max-w-208 min-w-0 flex-col gap-4 overflow-x-hidden px-8">
              {hiddenMessageCount > 0 && (
                <button
                  type="button"
                  onClick={loadOlderMessages}
                  className="mx-auto border border-border-strong bg-card px-3 py-1.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase transition-colors hover:bg-muted hover:text-foreground"
                >
                  Load {Math.min(MESSAGE_LIMIT_INCREMENT, hiddenMessageCount)} older messages
                </button>
              )}
              {displayItems.map((item) => {
                if (item.type === 'assistant-turn') {
                  const isStreaming = item.messages.some(
                    (message) => message.timestamp === 'streaming',
                  )
                  const primaryAssistant = item.messages.findLast(
                    (message) => message.type === 'assistant',
                  )
                  return (
                    <AssistantTurn
                      key={item.id}
                      messages={item.messages}
                      agentAvatar={activeAgent.icon}
                      mediaSessionId={activeSession.id}
                      streamStartedAt={isStreaming ? streamStartedAt : null}
                      isStreaming={isStreaming}
                      streamingMarkdown={
                        primaryAssistant
                          ? streamingMarkdownSnapshots[primaryAssistant.id]
                          : undefined
                      }
                    />
                  )
                }

                return (
                  <StandaloneMessage
                    key={item.message.id}
                    message={item.message}
                    userAvatar={userAvatar}
                    mediaSessionId={activeSession.id}
                  />
                )
              })}
              {isWaiting && <WaitingBubble agentAvatar={activeAgent.icon} />}
              {displayMessages.length === 0 && !isWaiting && !streamError && (
                <EmptyConversationState
                  agentName={activeAgent.name}
                  modelName={activeModelName}
                  skillCount={skillNames.length}
                  onSelectPrompt={(prompt) => {
                    form.setValue('message', prompt)
                    form.setFocus('message')
                  }}
                />
              )}
              {streamError && (
                <StandaloneMessage
                  message={{
                    id: 'stream-error',
                    type: 'error',
                    content: streamError,
                    timestamp: 'now',
                  }}
                />
              )}
              <div
                aria-hidden="true"
                className="shrink-0"
                style={{ height: composerOverlayHeight + 16 }}
              />
            </div>
          </ScrollArea>
          {/* composer */}
          <ChatComposer
            form={form}
            containerRef={composerContainerRef}
            extensionUi={
              <ExtensionUiHost
                sessionId={activeSession.id}
                onEditorText={applyExtensionEditorText}
              />
            }
            message={message}
            thinking={thinking}
            selectedModelOption={selectedModelOption}
            availableModelOptions={availableModelOptions}
            activeSessionCwd={activeSession.cwd}
            attachments={attachments}
            slashCommandOptions={slashCommandOptions}
            slashSelection={slashSelection}
            onSlashSelectionChange={setSlashSelection}
            onExecuteSlashCommand={executeSlashCommand}
            onFilesSelected={addAttachmentFiles}
            onRemoveAttachment={removeAttachment}
            onRetryAttachment={(attachmentId) => void retryAttachment(attachmentId)}
            onSubmit={() => void submit()}
            onAbort={() => void abort()}
            onQueueMessage={(behavior) => void queueMessage(behavior)}
            isRunningRun={isRunningRun}
            canAbortRun={canAbortRun}
            isStartingRun={isStartingRun}
            abortingRun={abortingRun}
            creatingSession={creatingSession}
            queueingMessage={queueingMessage}
            canSend={canSend}
            sendButtonLabel={sendButtonLabel}
          />
          {(canScrollUp || canScrollDown) && (
            <div
              className="pointer-events-none absolute right-5 flex flex-col border border-border bg-card shadow-lg"
              style={{ bottom: composerOverlayHeight + 20 }}
            >
              {canScrollUp && (
                <button
                  type="button"
                  onClick={() => scrollMessagesTo('top')}
                  className="pointer-events-auto flex size-9 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-[0.98]"
                  title="Back to top"
                  aria-label="Back to top"
                >
                  <ArrowUp className="size-4" />
                </button>
              )}
              {canScrollDown && (
                <button
                  type="button"
                  onClick={() => scrollMessagesTo('bottom')}
                  className="pointer-events-auto flex size-9 items-center justify-center border-t border-border text-muted-foreground transition-colors first:border-t-0 hover:bg-muted hover:text-foreground active:scale-[0.98]"
                  title="Jump to latest message"
                  aria-label="Jump to latest message"
                >
                  <ArrowDown className="size-4" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: context inspector */}
      {showActiveContext && (
        <aside className="hidden w-80 shrink-0 flex-col border-l border-border bg-panel xl:flex">
          <section
            className={cn(
              'flex flex-col bg-panel/40',
              activeContextCollapsed ? 'shrink-0' : 'min-h-0 flex-1',
            )}
          >
            <div className="flex h-10 shrink-0 items-center gap-2 pr-2 pl-2">
              <button
                type="button"
                onClick={() => setActiveContextCollapsed((value) => !value)}
                className="flex h-full min-w-0 flex-1 items-center gap-2 text-left transition-colors hover:text-foreground active:scale-[0.995]"
                aria-expanded={!activeContextCollapsed}
                title={activeContextCollapsed ? 'Expand active context' : 'Collapse active context'}
              >
                {activeContextCollapsed ? (
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <Label className="text-foreground">Active context</Label>
              </button>
            </div>
            {!activeContextCollapsed && (
              <ScrollArea className="min-h-0 flex-1" viewportClassName="p-3">
                <div className="flex flex-col gap-3">
                  <Panel>
                    <PanelHeader>
                      <Label>Model</Label>
                    </PanelHeader>
                    <div className="flex flex-col gap-2 p-3">
                      <Row icon={<Cpu className="size-3" />} label={activeModelName} />
                      <Row icon={<Brain className="size-3" />} label={`thinking · ${thinking}`} />
                      <Row
                        icon={<Coins className="size-3" />}
                        label={`${activeSession.totalTokens ?? 0} tokens`}
                      />
                    </div>
                  </Panel>
                  <Panel>
                    <PanelHeader>
                      <Label>Packages</Label>
                      <Tag>{activeAgent.selectedPackageSources.length}</Tag>
                    </PanelHeader>
                    <ul className="divide-y divide-border">
                      {activeAgent.selectedPackageSources.map((source) => (
                        <li
                          key={source}
                          title={source}
                          className="flex min-w-0 items-center gap-2 px-3 py-2 font-mono text-[11px] text-muted-foreground"
                        >
                          <Package className="size-3 shrink-0 text-accent" />
                          <span className="truncate">{source}</span>
                        </li>
                      ))}
                    </ul>
                  </Panel>
                  <Panel>
                    <PanelHeader>
                      <Label>Skills</Label>
                      <Tag>{skillNames.length}</Tag>
                    </PanelHeader>
                    <ul className="divide-y divide-border">
                      {skillNames.map((skillName) => (
                        <li
                          key={skillName}
                          className="flex items-center gap-2 px-3 py-2 font-mono text-[11px] text-muted-foreground"
                        >
                          <Layers className="size-3 shrink-0 text-accent" />
                          {skillName}
                        </li>
                      ))}
                    </ul>
                  </Panel>
                  <Panel>
                    <PanelHeader>
                      <Label>Prompts</Label>
                      <Tag>{selectedPrompts.length}</Tag>
                    </PanelHeader>
                    <ul className="divide-y divide-border">
                      {selectedPrompts.map((prompt) => (
                        <li
                          key={prompt.id}
                          className="flex items-center gap-2 px-3 py-2 font-mono text-[11px] text-muted-foreground"
                        >
                          <Terminal className="size-3 shrink-0 text-accent" />
                          {prompt.name}
                        </li>
                      ))}
                    </ul>
                  </Panel>
                  <Panel>
                    <PanelHeader>
                      <Label>Extensions</Label>
                      <Tag>{extensionNames.length}</Tag>
                    </PanelHeader>
                    <ul className="divide-y divide-border">
                      {extensionNames.map((name) => (
                        <li
                          key={name}
                          className="flex items-center gap-2 px-3 py-2 font-mono text-[11px] text-muted-foreground"
                        >
                          <Wrench className="size-3 shrink-0 text-accent" />
                          {name}
                        </li>
                      ))}
                    </ul>
                  </Panel>
                </div>
              </ScrollArea>
            )}
          </section>
          <WorkspaceExplorer sessionId={activeSession.id} />
        </aside>
      )}
    </div>
  )
}

function EmptyState({ onOpenAgents }: { onOpenAgents: () => void }) {
  return (
    <Empty className="h-full px-6 py-24">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Bot />
        </EmptyMedia>
        <EmptyTitle>No chat available</EmptyTitle>
        <EmptyDescription>
          Create an agent first. Pi Studio will open its first session automatically.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <ActionButton variant="accent" onClick={onOpenAgents}>
          <Bot className="size-3.5" />
          Go to Agents
        </ActionButton>
      </EmptyContent>
    </Empty>
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

function EmptyConversationState({
  agentName,
  modelName,
  skillCount,
  onSelectPrompt,
}: {
  agentName: string
  modelName: string
  skillCount: number
  onSelectPrompt: (prompt: string) => void
}) {
  const prompts = [
    'Review this project and summarize its architecture.',
    'Find the highest-impact improvement to make next.',
    'Help me implement a new feature in this workspace.',
  ]

  return (
    <div className="flex min-h-[calc(100vh-250px)] items-center justify-center py-10">
      <div className="w-full max-w-xl">
        <div className="relative overflow-hidden border border-border-strong bg-card shadow-sm">
          <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-accent to-transparent opacity-70" />
          <div className="px-7 pt-8 pb-6 text-center">
            <div className="mx-auto flex size-12 items-center justify-center border border-accent/40 bg-accent/10 text-accent shadow-[0_0_24px_color-mix(in_oklab,var(--accent)_18%,transparent)]">
              <Bot className="size-5" />
            </div>
            <Label className="mt-5 inline-block text-accent">Ready for a new task</Label>
            <h2 className="mt-2 font-serif text-2xl text-foreground italic">
              Start working with {agentName}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              Describe what you want to understand, change, or build. The agent will use the active
              workspace and configured resources.
            </p>
          </div>

          <div className="grid grid-cols-3 border-y border-border bg-panel/60">
            <div className="flex min-w-0 items-center justify-center gap-2 border-r border-border px-3 py-2.5">
              <Cpu className="size-3 shrink-0 text-accent" />
              <span className="truncate font-mono text-[10px] text-muted-foreground uppercase">
                {modelName}
              </span>
            </div>
            <div className="flex items-center justify-center gap-2 border-r border-border px-3 py-2.5">
              <Layers className="size-3 text-accent" />
              <span className="font-mono text-[10px] text-muted-foreground uppercase">
                {skillCount} skills
              </span>
            </div>
            <div className="flex items-center justify-center gap-2 px-3 py-2.5">
              <Brain className="size-3 text-accent" />
              <span className="font-mono text-[10px] text-muted-foreground uppercase">
                Agent mode
              </span>
            </div>
          </div>

          <div className="space-y-2 p-4">
            {prompts.map((prompt, index) => (
              <button
                key={prompt}
                type="button"
                onClick={() => onSelectPrompt(prompt)}
                className="group flex w-full items-center gap-3 border border-border bg-panel/40 px-3 py-2.5 text-left transition-colors hover:border-accent/50 hover:bg-accent/5"
              >
                <span className="font-mono text-[10px] text-muted-foreground/50">0{index + 1}</span>
                <span className="flex-1 text-[13px] text-muted-foreground transition-colors group-hover:text-foreground">
                  {prompt}
                </span>
                <span className="font-mono text-xs text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-accent">
                  →
                </span>
              </button>
            ))}
          </div>
        </div>
        <p className="mt-3 text-center font-mono text-[10px] tracking-wider text-muted-foreground/50 uppercase">
          Or type a custom request in the composer below
        </p>
      </div>
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

function findCurrentTreeNodeId(node: SessionTreeNode | null): string | null {
  if (!node) return null
  if (node.isCurrent) return node.id
  for (const child of node.children) {
    const current = findCurrentTreeNodeId(child)
    if (current) return current
  }
  return null
}

function countTreeNodes(node: SessionTreeNode | null): number {
  if (!node) return 0
  return 1 + node.children.reduce((total, child) => total + countTreeNodes(child), 0)
}

function formatTreeTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  return new Intl.DateTimeFormat(undefined, {
    month: sameDay ? undefined : 'short',
    day: sameDay ? undefined : 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

function buildRecentSessionTree(
  tree: SessionTreeNode | null,
  limit: number,
  selectedId: string | null,
): SessionTreeNode | null {
  if (!tree || countTreeNodes(tree) <= limit) return tree

  const nodes: SessionTreeNode[] = []
  const parents = new Map<string, string | null>()
  const visit = (node: SessionTreeNode) => {
    nodes.push(node)
    parents.set(node.id, node.parentId)
    node.children.forEach(visit)
  }
  visit(tree)

  const included = new Set(
    nodes
      .slice()
      .sort((a, b) => {
        const aTime = Date.parse(a.timestamp)
        const bTime = Date.parse(b.timestamp)
        if (Number.isNaN(aTime) || Number.isNaN(bTime)) {
          return nodes.indexOf(a) - nodes.indexOf(b)
        }
        return aTime - bTime
      })
      .slice(-limit)
      .map((node) => node.id),
  )
  if (selectedId) included.add(selectedId)
  const currentId = findCurrentTreeNodeId(tree)
  if (currentId) included.add(currentId)

  for (const id of Array.from(included)) {
    let parentId = parents.get(id) ?? null
    while (parentId) {
      included.add(parentId)
      parentId = parents.get(parentId) ?? null
    }
  }

  const cloneIncluded = (node: SessionTreeNode): SessionTreeNode | null => {
    if (!included.has(node.id)) return null
    return {
      ...node,
      children: node.children
        .map(cloneIncluded)
        .filter((child): child is SessionTreeNode => child !== null),
    }
  }

  return cloneIncluded(tree)
}

function TreeNode({
  node,
  depth,
  selectedId,
  onSelect,
}: {
  node: SessionTreeNode
  depth: number
  selectedId: string | null
  onSelect: (entryId: string) => void
}) {
  const isEvent = node.type !== 'message'
  const meta = node.role ? roleMeta[node.role] : null
  const hasBranches = node.children.length > 1
  const childDepth = hasBranches ? Math.min(depth + 1, 4) : depth
  const previewRef = useRef<HTMLParagraphElement>(null)
  const [tooltipPosition, setTooltipPosition] = useState<{
    top: number
    left: number
  } | null>(null)

  const showPreviewTooltip = () => {
    const preview = previewRef.current
    if (!preview || preview.scrollWidth <= preview.clientWidth) return
    const rect = preview.getBoundingClientRect()
    setTooltipPosition({
      top: Math.max(12, Math.min(rect.top - 8, window.innerHeight - 140)),
      left: Math.min(rect.right + 10, window.innerWidth - 380),
    })
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(node.id)}
        onMouseEnter={showPreviewTooltip}
        onMouseLeave={() => setTooltipPosition(null)}
        onFocus={showPreviewTooltip}
        onBlur={() => setTooltipPosition(null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') onSelect(node.id)
        }}
        className={cn(
          'group flex cursor-pointer items-start gap-2 border-l-2 border-transparent px-2 py-2 transition-colors outline-none hover:bg-muted/70 focus-visible:border-ring focus-visible:bg-muted',
          node.isCurrent && 'border-l-accent bg-accent/8',
          selectedId === node.id && 'border-l-primary bg-primary/10',
        )}
        style={{ paddingLeft: Math.min(depth, 4) * 12 + 8 }}
      >
        <span
          className={cn(
            'mt-0.5 shrink-0',
            isEvent ? 'text-warning' : (meta?.color ?? 'text-muted-foreground'),
          )}
        >
          {isEvent ? <GitBranch className="size-3" /> : meta?.icon}
        </span>
        <div className="max-w-55 min-w-0 flex-1">
          {node.label && (
            <span className="mr-1 mb-0.5 inline-block bg-accent/12 px-1 font-mono text-[9px] tracking-wider text-accent uppercase">
              {node.label}
            </span>
          )}
          <p
            ref={previewRef}
            className={cn(
              'truncate font-mono text-[11px] leading-4',
              isEvent ? 'text-warning italic' : 'text-foreground/80',
            )}
          >
            {node.preview}
          </p>
          <span
            className="mt-0.5 block font-mono text-[9px] text-muted-foreground/55"
            title={node.timestamp}
          >
            {formatTreeTimestamp(node.timestamp)}
          </span>
        </div>
      </div>
      {tooltipPosition &&
        createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-50 max-w-sm border border-border-strong bg-card px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground shadow-xl"
            style={tooltipPosition}
          >
            {node.preview}
          </div>,
          document.body,
        )}
      {node.children.length > 0 && (
        <div className={cn(hasBranches && 'ml-3 border-l border-dashed border-border-strong')}>
          {node.children.map((c) => (
            <TreeNode
              key={c.id}
              node={c}
              depth={childDepth}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/* ---------- Message bubbles ---------- */

type DisplayItem =
  | { type: 'message'; message: ChatMessage }
  | { type: 'assistant-turn'; id: string; messages: ChatMessage[] }

const processMessageTypes = new Set<ChatMessageType>([
  'thinking',
  'tool_call',
  'tool_result',
  'bash',
])

function isProcessMessage(message: ChatMessage) {
  return processMessageTypes.has(message.type)
}

function isAssistantTurnMessage(message: ChatMessage) {
  return message.type === 'assistant' || message.type === 'error' || isProcessMessage(message)
}

function estimateTokens(content: string) {
  return Math.max(1, Math.ceil(content.length / 4))
}

function buildDisplayItems(messages: ChatMessage[]): DisplayItem[] {
  const items: DisplayItem[] = []
  let pendingAssistantTurn: ChatMessage[] = []

  const flushAssistantTurn = () => {
    if (pendingAssistantTurn.length === 0) return
    items.push({
      type: 'assistant-turn',
      id: `assistant-turn-${pendingAssistantTurn[0].id}`,
      messages: pendingAssistantTurn,
    })
    pendingAssistantTurn = []
  }

  for (const message of messages) {
    if (isAssistantTurnMessage(message)) {
      pendingAssistantTurn.push(message)
      continue
    }
    flushAssistantTurn()
    items.push({ type: 'message', message })
  }

  flushAssistantTurn()
  return items
}

function WaitingBubble({ agentAvatar }: { agentAvatar?: string }) {
  return (
    <Message>
      <MessageAvatar className="bg-transparent">
        <ChatAvatar preset={agentAvatar} role="assistant" />
      </MessageAvatar>
      <MessageContent>
        <Marker
          role="status"
          aria-live="polite"
          className="ml-3.5 min-h-5 w-fit gap-1.5 font-mono text-xs"
        >
          <MarkerIcon className="flex size-3 items-center justify-center text-accent">
            <LoaderCircle className="size-3 animate-spin" />
          </MarkerIcon>
          <MarkerContent>Thinking</MarkerContent>
        </Marker>
      </MessageContent>
    </Message>
  )
}

function aggregateAssistantUsage(messages: ChatMessage[]): StreamUsage | null {
  const usageMessages = messages.filter(
    (message): message is ChatMessage & { usage: NonNullable<ChatMessage['usage']> } =>
      message.type === 'assistant' && Boolean(message.usage),
  )
  if (usageMessages.length === 0) return null

  return usageMessages.reduce<StreamUsage>(
    (total, message) => ({
      input: (total.input ?? 0) + message.usage.input,
      output: (total.output ?? 0) + message.usage.output,
      cacheRead: (total.cacheRead ?? 0) + message.usage.cacheRead,
      cacheWrite: (total.cacheWrite ?? 0) + message.usage.cacheWrite,
      cost: {
        total: (total.cost?.total ?? 0) + (message.usage.cost?.total ?? 0),
      },
    }),
    {},
  )
}

type AssistantTurnProps = {
  messages: ChatMessage[]
  agentAvatar?: string
  streamStartedAt?: number | null
  mediaSessionId?: string
  isStreaming?: boolean
  streamingMarkdown?: StreamingMarkdownSnapshot
}

type AssistantTurnContent = {
  assistantMessages: ChatMessage[]
  primaryAssistant: ChatMessage | undefined
  errorMessages: ChatMessage[]
  detailMessages: ChatMessage[]
  usage: StreamUsage | null
  fallbackTokens: number
  latestTimestamp: string | null
}

function deriveAssistantTurnContent(messages: ChatMessage[]): AssistantTurnContent {
  const assistantMessages = messages.filter((message) => message.type === 'assistant')
  const primaryAssistant = assistantMessages.at(-1)
  const errorMessages = messages.filter((message) => message.type === 'error')
  const detailMessages = messages.filter(
    (message) => message !== primaryAssistant && message.type !== 'error',
  )
  const fallbackTokens = assistantMessages.reduce(
    (total, message) => total + (message.tokens ?? estimateTokens(message.content)),
    0,
  )
  const latestTimestamp =
    [...messages].reverse().find((message) => message.timestamp !== 'streaming')?.timestamp ?? null

  return {
    assistantMessages,
    primaryAssistant,
    errorMessages,
    detailMessages,
    usage: aggregateAssistantUsage(assistantMessages),
    fallbackTokens,
    latestTimestamp,
  }
}

const AssistantTurn = memo(function AssistantTurn({
  messages,
  agentAvatar,
  streamStartedAt,
  mediaSessionId,
  isStreaming,
  streamingMarkdown,
}: AssistantTurnProps) {
  const {
    assistantMessages,
    primaryAssistant,
    errorMessages,
    detailMessages,
    usage,
    fallbackTokens,
    latestTimestamp,
  } = useMemo(() => deriveAssistantTurnContent(messages), [messages])
  const streamSeconds =
    isStreaming && streamStartedAt
      ? Math.max(1, Math.round((Date.now() - streamStartedAt) / 1000))
      : null

  return (
    <Message>
      <MessageAvatar className="bg-transparent">
        <ChatAvatar preset={agentAvatar} role="assistant" />
      </MessageAvatar>
      <MessageContent className="gap-0.5">
        {primaryAssistant ? (
          <Bubble variant="ghost" className="w-full max-w-full">
            <BubbleContent className="w-full p-0">
              {detailMessages.length > 0 && (
                <ProcessDetailsGroup
                  messages={detailMessages}
                  isStreaming={isStreaming}
                  mediaSessionId={mediaSessionId}
                />
              )}
              <div className="px-3.5 pt-3 pb-2">
                {streamingMarkdown ? (
                  <StreamingMarkdownContent
                    snapshot={streamingMarkdown}
                    mediaSessionId={mediaSessionId}
                  />
                ) : primaryAssistant.timestamp === 'streaming' ? (
                  <div className="whitespace-pre-wrap text-foreground">
                    {primaryAssistant.content}
                  </div>
                ) : (
                  <MarkdownContent
                    content={primaryAssistant.content}
                    mediaSessionId={mediaSessionId}
                  />
                )}
              </div>
              {errorMessages.map((message) => (
                <div
                  key={message.id}
                  className="flex items-start gap-2 border-t border-destructive/30 bg-destructive/8 px-3.5 py-2.5"
                >
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                  <p className="font-mono text-[11px] leading-relaxed text-destructive">
                    {message.content}
                  </p>
                </div>
              ))}
            </BubbleContent>
          </Bubble>
        ) : (
          <div className="flex flex-col gap-2">
            {errorMessages.map((message) => (
              <Bubble key={message.id} variant="destructive" className="w-full max-w-full">
                <BubbleContent className="flex w-full items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <p className="font-mono text-[11px] leading-relaxed">{message.content}</p>
                </BubbleContent>
              </Bubble>
            ))}
            {detailMessages.length > 0 && (
              <ProcessDetailsGroup
                messages={detailMessages}
                isStreaming={isStreaming}
                mediaSessionId={mediaSessionId}
              />
            )}
          </div>
        )}
        {assistantMessages.length > 0 && (
          <MessageFooter className="justify-end px-0">
            <AssistantMessageMetrics
              usage={usage}
              fallbackTokens={fallbackTokens}
              estimated={Boolean(isStreaming && !usage)}
              streamSeconds={streamSeconds}
              timestamp={latestTimestamp}
              className="mr-3.5"
            />
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  )
}, areAssistantTurnPropsEqual)

function areAssistantTurnPropsEqual(previous: AssistantTurnProps, next: AssistantTurnProps) {
  return (
    previous.agentAvatar === next.agentAvatar &&
    previous.mediaSessionId === next.mediaSessionId &&
    previous.isStreaming === next.isStreaming &&
    previous.streamStartedAt === next.streamStartedAt &&
    previous.streamingMarkdown === next.streamingMarkdown &&
    haveSameMessageReferences(previous.messages, next.messages)
  )
}

function haveSameMessageReferences(left: ChatMessage[], right: ChatMessage[]) {
  return left.length === right.length && left.every((message, index) => message === right[index])
}

function ProcessDetailsGroup({
  messages,
  isStreaming,
  mediaSessionId,
}: {
  messages: ChatMessage[]
  isStreaming?: boolean
  mediaSessionId?: string
}) {
  const [open, setOpen] = useState(Boolean(isStreaming))
  const { activities, summary, toolCount, bashOutputCount } = useMemo(() => {
    const activities = buildRunActivities(messages)
    return {
      activities,
      ...summarizeRunActivities(activities),
    }
  }, [messages])

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="group/run"
    >
      <summary className="mx-3.5 flex cursor-pointer list-none items-center gap-2 py-2 transition-colors hover:bg-muted/45 active:bg-muted/70">
        <span className="flex size-4 items-center justify-center text-muted-foreground">
          {toolCount > 0 ? (
            <Wrench className="size-3.5" />
          ) : bashOutputCount > 0 ? (
            <Terminal className="size-3.5" />
          ) : (
            <Brain className="size-3.5" />
          )}
        </span>
        <span
          className={cn(
            'shrink-0 text-xs font-medium text-foreground/85',
            isStreaming && 'shimmer',
          )}
        >
          {isStreaming ? 'Working' : 'Activity'}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground/60">
          {summary || `${activities.length} steps`}
        </span>
        <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open/run:rotate-90" />
      </summary>
      {open && (
        <div className="px-3.5 py-1.5">
          <div className="ml-2 border-l border-border pl-5">
            {activities.map((activity) => (
              <RunActivityRow
                key={activity.id}
                activity={activity}
                mediaSessionId={mediaSessionId}
              />
            ))}
          </div>
        </div>
      )}
    </details>
  )
}

type RunActivity =
  | {
      kind: 'message'
      id: string
      message: ChatMessage
    }
  | {
      kind: 'tool'
      id: string
      call?: ChatMessage
      result?: ChatMessage
    }

type RunActivitySummary = {
  toolCount: number
  bashOutputCount: number
  summary: string
}

function summarizeRunActivities(activities: RunActivity[]): RunActivitySummary {
  let updateCount = 0
  let thoughtCount = 0
  let toolCount = 0
  let bashOutputCount = 0

  for (const activity of activities) {
    if (activity.kind === 'tool') {
      toolCount += 1
      continue
    }

    switch (activity.message.type) {
      case 'assistant':
        updateCount += 1
        break
      case 'thinking':
        thoughtCount += 1
        break
      case 'bash':
        bashOutputCount += 1
        break
    }
  }

  const summary = [
    updateCount ? `${updateCount} ${updateCount === 1 ? 'update' : 'updates'}` : null,
    thoughtCount ? `${thoughtCount} ${thoughtCount === 1 ? 'thought' : 'thoughts'}` : null,
    toolCount ? `${toolCount} ${toolCount === 1 ? 'tool' : 'tools'}` : null,
    bashOutputCount ? `${bashOutputCount} ${bashOutputCount === 1 ? 'output' : 'outputs'}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return { toolCount, bashOutputCount, summary }
}

function buildRunActivities(messages: ChatMessage[]): RunActivity[] {
  const activities: RunActivity[] = []
  const pendingToolIndexes: number[] = []

  for (const message of messages) {
    if (message.type === 'tool_call') {
      activities.push({ kind: 'tool', id: `tool-${message.id}`, call: message })
      pendingToolIndexes.push(activities.length - 1)
      continue
    }

    if (message.type === 'tool_result') {
      const titleMatchPosition = pendingToolIndexes.findIndex((index) => {
        const activity = activities[index]
        return (
          activity?.kind === 'tool' &&
          Boolean(message.title) &&
          activity.call?.title === message.title
        )
      })
      const pendingPosition = titleMatchPosition >= 0 ? titleMatchPosition : 0
      const activityIndex = pendingToolIndexes[pendingPosition]

      if (activityIndex !== undefined) {
        const activity = activities[activityIndex]
        if (activity?.kind === 'tool') activity.result = message
        pendingToolIndexes.splice(pendingPosition, 1)
      } else {
        activities.push({ kind: 'tool', id: `tool-result-${message.id}`, result: message })
      }
      continue
    }

    activities.push({ kind: 'message', id: message.id, message })
  }

  return activities
}

function activityPreview(content: string) {
  return content.replace(/\s+/g, ' ').trim()
}

function useDeferredDetailsContent() {
  const [hasOpened, setHasOpened] = useState(false)
  const handleToggle = useCallback((event: SyntheticEvent<HTMLDetailsElement>) => {
    if (event.currentTarget.open) setHasOpened(true)
  }, [])

  return { hasOpened, handleToggle }
}

type RunActivityRowProps = {
  activity: RunActivity
  mediaSessionId?: string
}

const RunActivityRow = memo(function RunActivityRow({
  activity,
  mediaSessionId,
}: RunActivityRowProps) {
  if (activity.kind === 'tool') return <ToolActivityRow activity={activity} />

  return <MessageActivityRow message={activity.message} mediaSessionId={mediaSessionId} />
}, areRunActivityRowPropsEqual)

function MessageActivityRow({
  message,
  mediaSessionId,
}: {
  message: ChatMessage
  mediaSessionId?: string
}) {
  const meta = processMessageMeta(message)
  const streaming = message.timestamp === 'streaming'
  const { hasOpened, handleToggle } = useDeferredDetailsContent()
  const title =
    message.type === 'bash' && message.title
      ? `${meta.label} · ${message.title}`
      : (message.title ?? meta.label)

  return (
    <details className="group/activity relative min-w-0 py-1.5" onToggle={handleToggle}>
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm py-1 pr-1 transition-colors hover:bg-muted/45 active:bg-muted/70">
        <span
          className={cn(
            'absolute -left-7.25 flex size-4 items-center justify-center bg-background',
            meta.color,
          )}
        >
          {meta.icon}
        </span>
        <span
          className={cn(
            'max-w-[36%] shrink-0 truncate text-xs font-medium text-foreground/85',
            streaming && 'shimmer',
          )}
        >
          {title}
        </span>
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-xs text-muted-foreground',
            message.type === 'thinking' && 'italic',
            message.type === 'bash' && 'font-mono text-[10px]',
          )}
        >
          {activityPreview(message.content)}
        </span>
        {!streaming && (
          <span className="hidden shrink-0 font-mono text-[9px] text-muted-foreground/45 sm:inline">
            {message.timestamp}
          </span>
        )}
        <ChevronRight className="size-3 shrink-0 text-muted-foreground transition-transform group-open/activity:rotate-90" />
      </summary>
      {hasOpened && (
        <div className="pt-1.5 pb-1 pl-0.5">
          {message.type === 'assistant' ? (
            <div className="text-sm text-foreground/85">
              <MarkdownContent content={message.content} mediaSessionId={mediaSessionId} />
            </div>
          ) : message.type === 'bash' ? (
            <pre className="max-h-72 overflow-auto border border-border bg-panel px-3 py-2 font-mono text-[11px] leading-relaxed wrap-break-word whitespace-pre-wrap text-foreground/85">
              {message.content}
            </pre>
          ) : (
            <p className="border-l border-border pl-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground italic">
              {message.content}
            </p>
          )}
        </div>
      )}
    </details>
  )
}

function areRunActivityRowPropsEqual(previous: RunActivityRowProps, next: RunActivityRowProps) {
  if (previous.mediaSessionId !== next.mediaSessionId) return false
  if (previous.activity.kind !== next.activity.kind) return false

  if (previous.activity.kind === 'message' && next.activity.kind === 'message') {
    return previous.activity.message === next.activity.message
  }

  return (
    previous.activity.kind === 'tool' &&
    next.activity.kind === 'tool' &&
    previous.activity.call === next.activity.call &&
    previous.activity.result === next.activity.result
  )
}

function ToolActivityRow({ activity }: { activity: Extract<RunActivity, { kind: 'tool' }> }) {
  const { call, result } = activity
  const streaming = call?.timestamp === 'streaming' || result?.timestamp === 'streaming'
  const timestamp = result?.timestamp ?? call?.timestamp
  const title = call?.title ?? result?.title ?? 'Tool'
  const preview = activityPreview(call?.content ?? result?.content ?? '')
  const status = result ? 'done' : streaming ? 'running' : 'called'
  const { hasOpened, handleToggle } = useDeferredDetailsContent()

  return (
    <details className="group/activity relative min-w-0 py-1.5" onToggle={handleToggle}>
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm py-1 pr-1 transition-colors hover:bg-muted/45 active:bg-muted/70">
        <span
          className={cn(
            'absolute -left-7.25 flex size-4 items-center justify-center bg-background',
            result ? 'text-success' : 'text-accent',
          )}
        >
          <Wrench className="size-3" />
        </span>
        <span className="max-w-[36%] shrink-0 truncate text-xs font-medium text-foreground/85">
          {title}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
          {preview}
        </span>
        <span
          className={cn(
            'shrink-0 font-mono text-[9px] uppercase',
            result ? 'text-success' : 'shimmer text-accent',
          )}
        >
          {status}
        </span>
        {!streaming && timestamp && (
          <span className="hidden shrink-0 font-mono text-[9px] text-muted-foreground/45 sm:inline">
            {timestamp}
          </span>
        )}
        <ChevronRight className="size-3 shrink-0 text-muted-foreground transition-transform group-open/activity:rotate-90" />
      </summary>
      {hasOpened && (
        <div className="flex flex-col gap-2 pt-1.5 pb-1 pl-0.5">
          {call && (
            <div className="min-w-0">
              <div className="mb-1 font-mono text-[9px] tracking-wide text-muted-foreground/55 uppercase">
                Input
              </div>
              <pre className="max-h-56 overflow-auto border border-border bg-panel px-3 py-2 font-mono text-[11px] leading-relaxed wrap-break-word whitespace-pre-wrap text-foreground/85">
                {call.content}
              </pre>
            </div>
          )}
          {result && (
            <div className="min-w-0">
              <div className="mb-1 font-mono text-[9px] tracking-wide text-muted-foreground/55 uppercase">
                Result
              </div>
              <pre className="max-h-72 overflow-auto border border-border bg-panel px-3 py-2 font-mono text-[11px] leading-relaxed wrap-break-word whitespace-pre-wrap text-muted-foreground">
                {result.content}
              </pre>
            </div>
          )}
        </div>
      )}
    </details>
  )
}

function processMessageMeta(message: ChatMessage) {
  switch (message.type) {
    case 'assistant':
      return {
        label: 'Progress update',
        icon: <Bot className="size-3" />,
        color: 'text-accent',
      }
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

function sameAttachments(left: ChatMessage['attachments'], right: ChatMessage['attachments']) {
  if (!left?.length && !right?.length) return true
  if (!left || !right || left.length !== right.length) return false
  return left.every((attachment, index) => attachment.path === right[index]?.path)
}

const StandaloneMessage = memo(function StandaloneMessage({
  message,
  userAvatar,
  mediaSessionId,
}: {
  message: ChatMessage
  userAvatar?: string
  mediaSessionId?: string
}) {
  switch (message.type) {
    case 'user':
      return (
        <Message align="end">
          <MessageAvatar className="bg-transparent">
            <ChatAvatar preset={userAvatar} role="user" />
          </MessageAvatar>
          <MessageContent className="items-end gap-1 pr-2">
            {message.attachments && message.attachments.length > 0 && (
              <AttachmentGroup className="max-w-[85%] justify-end">
                {message.attachments.map((attachment) => {
                  const isImage = isImageAttachment(attachment.name, attachment.type)
                  return isImage && mediaSessionId ? (
                    <figure key={attachment.id} className="w-fit max-w-full min-w-0">
                      <ImageAttachmentPreview
                        src={`/api/media?sessionId=${encodeURIComponent(mediaSessionId)}&path=${encodeURIComponent(attachment.path)}`}
                        alt={attachment.name}
                        className="inline-block max-w-full border border-border bg-muted"
                        imageClassName="h-auto max-h-80 w-auto max-w-full object-contain"
                      />
                      <figcaption className="mt-1 flex min-w-0 items-center justify-between gap-2 px-0.5 text-[10px] leading-4 text-muted-foreground">
                        <span className="truncate" title={attachment.name}>
                          {attachment.name}
                        </span>
                        <span className="shrink-0 font-mono">
                          {formatFileSize(attachment.size)}
                        </span>
                      </figcaption>
                    </figure>
                  ) : (
                    <Attachment key={attachment.id} state="done" size="xs" className="rounded-none">
                      <AttachmentMedia className="rounded-none">
                        <FileIcon />
                      </AttachmentMedia>
                      <AttachmentContent>
                        <AttachmentTitle title={attachment.name}>{attachment.name}</AttachmentTitle>
                        <AttachmentDescription title={attachment.path}>
                          {formatFileSize(attachment.size)}
                        </AttachmentDescription>
                      </AttachmentContent>
                    </Attachment>
                  )
                })}
              </AttachmentGroup>
            )}
            {message.content && (
              <Bubble variant="secondary" align="end" className="max-w-[85%]">
                <BubbleContent className="px-3.5 py-2.5 text-foreground">
                  {message.content}
                </BubbleContent>
              </Bubble>
            )}
            <MessageFooter className="justify-end px-0">
              <span className="font-mono text-[10px] text-muted-foreground/50">
                {message.timestamp}
              </span>
            </MessageFooter>
          </MessageContent>
        </Message>
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
        <Marker
          variant="separator"
          className="min-h-5 py-1 font-mono text-[10px] tracking-wider text-muted-foreground/60 uppercase"
        >
          <MarkerIcon className="size-3">
            <Layers className="size-3" />
          </MarkerIcon>
          <MarkerContent>{message.content}</MarkerContent>
        </Marker>
      )
    default:
      return null
  }
})

function AssistantMessageMetrics({
  usage,
  fallbackTokens,
  estimated,
  streamSeconds,
  timestamp,
  className,
}: {
  usage: StreamUsage | null
  fallbackTokens: number
  estimated: boolean
  streamSeconds: number | null
  timestamp: string | null
  className?: string
}) {
  const metrics = usage
    ? [
        usage.input
          ? { icon: InputMetricIcon, value: usage.input.toLocaleString(), label: 'input tokens' }
          : null,
        usage.output
          ? { icon: OutputMetricIcon, value: usage.output.toLocaleString(), label: 'output tokens' }
          : null,
        usage.cacheRead
          ? {
              icon: CacheMetricIcon,
              value: usage.cacheRead.toLocaleString(),
              label: 'cached tokens',
            }
          : null,
        usage.cacheWrite
          ? {
              icon: CacheMetricIcon,
              value: usage.cacheWrite.toLocaleString(),
              label: 'cache write',
            }
          : null,
        usage.cost?.total
          ? { icon: CostMetricIcon, value: `$${usage.cost.total.toFixed(4)}`, label: 'cost' }
          : null,
      ].filter(Boolean)
    : [
        {
          icon: OutputMetricIcon,
          value: `${estimated ? '~' : ''}${fallbackTokens.toLocaleString()}`,
          label: 'tokens',
        },
      ]

  return (
    <span
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] text-muted-foreground/60',
        className,
      )}
    >
      {metrics.map((metric, index) => {
        if (!metric) return null
        const Icon = metric.icon
        return (
          <span
            key={`${metric.label}-${index}`}
            className="inline-flex items-center gap-0.5 whitespace-nowrap"
            title={metric.label}
          >
            <Icon className="size-3 text-muted-foreground/70" weight="regular" aria-hidden />
            <span>{metric.value}</span>
          </span>
        )
      })}
      {streamSeconds ? (
        <span className="inline-flex items-center gap-0.5 whitespace-nowrap" title="elapsed time">
          <TimeMetricIcon
            className="size-3 text-muted-foreground/70"
            weight="regular"
            aria-hidden
          />
          <span>{streamSeconds}s</span>
        </span>
      ) : null}
      {timestamp ? (
        <span className="inline-flex items-center gap-0.5 whitespace-nowrap" title="UTC timestamp">
          <TimeMetricIcon
            className="size-3 text-muted-foreground/70"
            weight="regular"
            aria-hidden
          />
          <span>{timestamp}</span>
        </span>
      ) : null}
    </span>
  )
}

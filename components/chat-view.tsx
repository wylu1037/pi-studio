'use client'

import {
  memo,
  type CSSProperties,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
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
  Package,
  Pencil,
  Copy,
  Check,
  RotateCcw,
  MessageSquare,
  type LucideIcon,
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
import { useStreamingMarkdown } from '@/components/use-streaming-markdown'
import { WorkspaceExplorer } from '@/components/workspace-explorer'
import { ChatAvatar } from '@/components/chat-avatar'
import { ChatMessageOutline, type ChatMessageOutlineEntry } from '@/components/chat-message-outline'
import { useProfileSettings } from '@/components/use-profile-settings'
import { useSessionEventStream } from '@/components/use-session-event-stream'
import type { PiRunEvent, RunStreamFrame } from '@/lib/chat/session-event-stream'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
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
import { postApiSessionsIdAbort } from '@/lib/api/generated/clients/postApiSessionsIdAbort'
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
  TreeNodeRole,
} from '@/lib/types'
import type { StreamingMarkdownSnapshot } from '@/lib/markdown/streaming-markdown'
import { errorMessage, showToast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { useChatAttachments } from '@/components/use-chat-attachments'
import { ImageAttachmentPreview, isImageAttachment } from '@/components/image-attachment-preview'
import { buildPromptWithAttachments } from '@/lib/chat/attachments'
import { hasPersistedUserMessage } from '@/lib/chat/stream-lifecycle'
import {
  createInitialRunStreamState,
  runStreamReducer,
  selectCanQueueMessage,
  selectHasPersistedRun,
  selectIsRunningRun,
  selectIsStartingRun,
  selectIsWaiting,
  type RunStreamRetry,
} from '@/lib/chat/run-stream-reducer'

const SESSION_TREE_RECENT_NODE_LIMIT = 80
const INITIAL_VISIBLE_MESSAGE_LIMIT = 120
const MESSAGE_LIMIT_INCREMENT = 100

// After a Stop, the composer leaves "Stopping" only when the SSE `activity_end`
// frame arrives — and that frame fires only once the agent run truly goes idle.
// When the run is wedged on an operation slow to honor the abort (a still-
// streaming LLM response, a lingering tool/bash child), that frame can be very
// late or never come, and "Stopping" would spin forever. If the abort hasn't
// settled within this window, we reconnect the event stream (which replays the
// missed frame and re-pushes the true running state) and drop the pending flag —
// automating the manual "switch pages" that used to be the only way out.
const ABORT_FALLBACK_TIMEOUT_MS = 8000
const STREAM_ERROR_TIMEOUT_MS = 8000
// The SDK emits a failed turn's `error` a beat before the `retry_pending` that
// supersedes it. While the run is still live that retry may still be on the
// wire, so the error block waits this long rather than flashing and being
// swapped out. A settled run can never retry, and clears the hold immediately.
const STREAM_ERROR_RETRY_GRACE_MS = 400

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
  skills,
  prompts,
  scheduledTaskModel,
}: {
  agents: AgentProfile[]
  activeAgent?: AgentProfile
  sessions: AgentSessionSummary[]
  activeSession?: AgentSessionSummary
  messages: ChatMessage[]
  tree: SessionTreeNode | null
  providers: GlobalModelProvider[]
  skills: GlobalSkill[]
  prompts: GlobalPromptTemplate[]
  scheduledTaskModel?: { providerId: string; modelId: string }
}) {
  const router = useRouter()
  const { userAvatar } = useProfileSettings()
  // All live-run state lives in one pure reducer (see
  // docs/run-stream-reducer-design.md). The aliases below keep the historical
  // names for the many read sites; every mutation is a dispatched action.
  const [runStream, dispatchRunStream] = useReducer(
    runStreamReducer,
    messages.length,
    createInitialRunStreamState,
  )
  const streamMessages = runStream.messages
  const streamStartedAt = runStream.startedAt
  const streamDone = runStream.done
  const streamPhase = runStream.phase
  const optimisticMessage = runStream.optimisticUserMessage
  const activityId = runStream.activityId
  const sdkSessionRunning = runStream.sdkRunning
  const abortingRun = runStream.aborting
  const streamError = runStream.error
  const streamRetry = runStream.retry
  const [composerOverlayHeight, setComposerOverlayHeight] = useState(112)
  const [queueingMessage, setQueueingMessage] = useState<'steer' | 'follow-up' | null>(null)
  const [showSessionTree, setShowSessionTree] = useState(false)
  const [showActiveContext, setShowActiveContext] = useState(false)
  const [activeContextCollapsed, setActiveContextCollapsed] = useState(false)
  const lastPersistedComposerConfigRef = useRef(
    activeSession?.lastProviderId && activeSession.lastModelId && activeSession.lastThinkingLevel
      ? `${activeSession.lastProviderId}::${activeSession.lastModelId}::${activeSession.lastThinkingLevel}`
      : null,
  )
  const messageViewportRef = useRef<HTMLDivElement>(null)
  const composerContainerRef = useRef<HTMLDivElement>(null)
  const shouldFollowMessagesRef = useRef(true)
  const prependScrollRef = useRef<{ height: number; top: number } | null>(null)
  const [visibleMessageLimit, setVisibleMessageLimit] = useState(INITIAL_VISIBLE_MESSAGE_LIMIT)
  const [slashSelection, setSlashSelection] = useState(0)
  const [creatingSession, setCreatingSession] = useState(false)
  const [clearingSession, setClearingSession] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(() =>
    findCurrentTreeNodeId(tree),
  )
  const [branchMessages, setBranchMessages] = useState<ChatMessage[] | null>(null)
  const [branchPending, setBranchPending] = useState<'navigate' | 'fork' | null>(null)
  const [branchError, setBranchError] = useState<string | null>(null)
  // Pending Stop-fallback timer (see ABORT_FALLBACK_TIMEOUT_MS). Cleared when the
  // activity settles on its own (an effect watches activityId) or on unmount.
  const abortFallbackTimerRef = useRef<number | null>(null)

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
    // The rAF-batched pipeline's output rejoins the reducer as actions; the
    // reducer owns the assistant-row upserts (dispatch identity is stable).
    onFlushContent: (batch) => dispatchRunStream({ type: 'content_flushed', batch }),
    onReplaceContent: (messageId, content) =>
      dispatchRunStream({ type: 'content_replaced', messageId, content }),
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
  const preferredModelOption =
    availableModelOptions.find(
      ({ provider, model }) =>
        provider.id === activeSession?.lastProviderId && model.id === activeSession.lastModelId,
    ) ??
    availableModelOptions.find(
      ({ provider, model }) =>
        provider.id === scheduledTaskModel?.providerId && model.id === scheduledTaskModel.modelId,
    ) ??
    availableModelOptions.find(
      ({ provider, model }) =>
        provider.id === activeAgent?.defaultProviderId && model.id === activeAgent?.defaultModelId,
    ) ??
    availableModelOptions[0]

  const form = useForm<ComposerValues>({
    resolver: zodResolver(ComposerSchema as never),
    defaultValues: {
      message: '',
      providerId: preferredModelOption?.provider.id,
      modelId: preferredModelOption?.model.id,
      thinkingLevel:
        activeSession?.lastThinkingLevel ?? activeAgent?.defaultThinkingLevel ?? 'medium',
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
  const isClearSessionCommand = composerValues.message.toLowerCase() === '/clear-session'
  const isNextSessionCommand = composerValues.message.toLowerCase() === '/next-session'
  const isPrevSessionCommand = composerValues.message.toLowerCase() === '/prev-session'
  const canSend = Boolean(
    isNewSessionCommand ||
    isClearSessionCommand ||
    isNextSessionCommand ||
    isPrevSessionCommand ||
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
    form.setValue('providerId', preferredModelOption?.provider.id)
    form.setValue('modelId', preferredModelOption?.model.id)
  }, [availableModelOptions, preferredModelOption, form])

  useEffect(() => {
    if (!activeSession || !composerValues.providerId || !composerValues.modelId) return
    const configKey = `${composerValues.providerId}::${composerValues.modelId}::${composerValues.thinkingLevel}`
    if (lastPersistedComposerConfigRef.current === configKey) return

    const timer = window.setTimeout(() => {
      void fetch(`/api/sessions/${encodeURIComponent(activeSession.id)}/composer`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: composerValues.providerId,
          modelId: composerValues.modelId,
          thinkingLevel: composerValues.thinkingLevel,
        }),
      })
        .then((response) => {
          if (response.ok) lastPersistedComposerConfigRef.current = configKey
        })
        .catch(() => {
          // Keep the current in-memory selection; a later change will retry persistence.
        })
    }, 150)

    return () => window.clearTimeout(timer)
  }, [
    activeSession,
    composerValues.modelId,
    composerValues.providerId,
    composerValues.thinkingLevel,
  ])

  const skillNames = useMemo(() => {
    const selected = new Set(activeAgent?.selectedSkillIds ?? [])
    return skills.filter((skill) => selected.has(skill.id)).map((skill) => skill.name)
  }, [activeAgent?.selectedSkillIds, skills])
  const selectedPrompts = useMemo(() => {
    const selected = new Set(activeAgent?.selectedPromptIds ?? [])
    return prompts.filter((prompt) => selected.has(prompt.id))
  }, [activeAgent?.selectedPromptIds, prompts])
  const createNewSession = async () => {
    if (!activeAgent || creatingSession || clearingSession) return
    if (activityId || sdkSessionRunning) {
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

  const clearCurrentSession = async () => {
    if (!activeSession || clearingSession || creatingSession) return
    if (activityId || sdkSessionRunning) {
      showToast({
        tone: 'error',
        title: 'Run in progress',
        message: 'Stop the active run before clearing this session.',
      })
      return
    }

    setClearingSession(true)
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(activeSession.id)}/clear`, {
        method: 'POST',
      })
      const body = (await response.json()) as { ok?: boolean; error?: string }
      if (!response.ok || !body.ok) {
        throw new Error(body.error ?? 'Unable to clear the session.')
      }

      // The session event stream stays connected across a clear: the session id
      // is unchanged and the server emits no frames for it, so tearing the
      // EventSource down here would orphan the view from all future run frames
      // (the "stuck on thinking until a page switch" bug).
      finishAllStreamingMarkdown()
      resetStreamingMarkdown()
      shouldFollowMessagesRef.current = true
      dispatchRunStream({ type: 'session_reset' })
      setQueueingMessage(null)
      setSelectedNodeId(null)
      setBranchMessages(null)
      setBranchPending(null)
      setBranchError(null)
      setVisibleMessageLimit(INITIAL_VISIBLE_MESSAGE_LIMIT)
      clearAttachments()
      const values = form.getValues()
      form.reset({
        message: '',
        providerId: values.providerId,
        modelId: values.modelId,
        thinkingLevel: values.thinkingLevel,
      })
      showToast({
        tone: 'success',
        title: 'Session cleared',
        message: 'All messages were removed from this conversation.',
      })
      router.refresh()
    } catch (error) {
      showToast({
        tone: 'error',
        title: 'Unable to clear session',
        message: errorMessage(error, 'Session clearing failed.'),
      })
    } finally {
      setClearingSession(false)
    }
  }

  const switchSession = (sessionId: string) => {
    if (
      !activeAgent ||
      sessionId === activeSession?.id ||
      streamPhase !== 'idle' ||
      sdkSessionRunning ||
      creatingSession ||
      clearingSession ||
      branchPending !== null
    )
      return
    router.push(
      `/chat?agent=${encodeURIComponent(activeAgent.id)}&session=${encodeURIComponent(sessionId)}`,
    )
  }

  const switchRelativeSession = (direction: 'next' | 'previous') => {
    if (!activeAgent || !activeSession) return
    form.setValue('message', '')
    if (
      streamPhase !== 'idle' ||
      sdkSessionRunning ||
      creatingSession ||
      clearingSession ||
      branchPending !== null
    ) {
      showToast({
        tone: 'warning',
        title: 'Session switch unavailable',
        message: 'Wait for the current session activity to finish before switching sessions.',
      })
      return
    }

    const orderedSessions = sessions.toReversed()
    const currentIndex = orderedSessions.findIndex((session) => session.id === activeSession.id)
    if (currentIndex < 0) {
      showToast({
        tone: 'error',
        title: 'Session not found',
        message: 'The current session is no longer available in the session list.',
      })
      return
    }
    const targetIndex = currentIndex + (direction === 'next' ? 1 : -1)
    const target = orderedSessions[targetIndex]
    if (!target) {
      showToast({
        tone: 'info',
        title: direction === 'next' ? 'No next session' : 'No previous session',
        message:
          direction === 'next'
            ? 'You are already at the last session in the list.'
            : 'You are already at the first session in the list.',
      })
      return
    }

    clearAttachments()
    switchSession(target.id)
  }

  const switchAgent = (agentId: string) => {
    if (
      !activeAgent ||
      agentId === activeAgent.id ||
      streamPhase !== 'idle' ||
      sdkSessionRunning ||
      creatingSession ||
      clearingSession ||
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
    if ('clear-session'.includes(slashQuery)) {
      options.push({
        kind: 'builtin',
        id: 'clear-session',
        command: 'clear-session',
        description: 'Clear every message from the current conversation.',
      })
    }
    if ('next-session'.includes(slashQuery)) {
      options.push({
        kind: 'builtin',
        id: 'next-session',
        command: 'next-session',
        description: 'Switch to the next conversation in the session list.',
      })
    }
    if ('prev-session'.includes(slashQuery)) {
      options.push({
        kind: 'builtin',
        id: 'prev-session',
        command: 'prev-session',
        description: 'Switch to the previous conversation in the session list.',
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
    return options.slice(0, 8)
  }, [selectedPrompts, slashQuery])

  useEffect(() => {
    setSlashSelection(0)
  }, [slashQuery])

  const insertPromptCommand = (prompt: GlobalPromptTemplate) => {
    form.setValue('message', `/${prompt.name} `, { shouldDirty: true })
    form.setFocus('message')
  }

  const executeSlashCommand = (option: SlashCommandOption) => {
    if (option.kind === 'builtin') {
      if (option.command === 'clear-session') void clearCurrentSession()
      else if (option.command === 'next-session') switchRelativeSession('next')
      else if (option.command === 'prev-session') switchRelativeSession('previous')
      else void createNewSession()
      return
    }
    insertPromptCommand(option.prompt)
  }
  const sourceMessages = branchMessages ?? messages

  useEffect(() => {
    return () => {
      if (abortFallbackTimerRef.current !== null) {
        window.clearTimeout(abortFallbackTimerRef.current)
        abortFallbackTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    setSelectedNodeId(findCurrentTreeNodeId(tree))
    setVisibleMessageLimit(INITIAL_VISIBLE_MESSAGE_LIMIT)
    setBranchMessages(null)
    setBranchError(null)
  }, [activeSession?.id, tree])

  // Single refresh point per run: `finishActivity` must NOT call
  // `router.refresh()` itself, or a run end would issue two refreshes (this
  // effect + the handler) and re-render the whole history list twice.
  useEffect(() => {
    if (!streamDone) return
    const timer = window.setTimeout(() => {
      router.refresh()
    }, 50)

    return () => window.clearTimeout(timer)
  }, [router, streamDone])

  // A turn that never produced assistant text — aborted after a tool call, or a
  // pure tool turn — persists no assistant message, so waiting for one would pin
  // the live tail on screen until the next submit (and with it the stream copy of
  // the turn, which carries no usage and cannot be edited). When the live tail
  // holds no assistant text either, nothing is pending: a persisted process
  // message is enough to hand the turn over to history.
  const hasPersistedRun = selectHasPersistedRun(runStream, sourceMessages)

  useEffect(() => {
    if (!hasPersistedRun) return

    dispatchRunStream({ type: 'handover_completed' })
    setBranchMessages(null)
    resetStreamingMarkdown()
  }, [hasPersistedRun, resetStreamingMarkdown])

  // The Stop fallback only guards a live activity; once it settles (the
  // activity_end frame arrived), a pending fallback must not fire a spurious
  // reconnect after the fact.
  useEffect(() => {
    if (runStream.activityId !== null) return
    if (abortFallbackTimerRef.current !== null) {
      window.clearTimeout(abortFallbackTimerRef.current)
      abortFallbackTimerRef.current = null
    }
  }, [runStream.activityId])

  const baseMessages = useMemo(() => {
    if (!optimisticMessage) return sourceMessages

    const hasPersistedOptimisticMessage = hasPersistedUserMessage(
      sourceMessages,
      runStream.sourceCountAtRunStart,
    )

    return hasPersistedOptimisticMessage ? sourceMessages : [...sourceMessages, optimisticMessage]
  }, [optimisticMessage, runStream.sourceCountAtRunStart, sourceMessages])

  // `displayMessages` (persisted + optimistic + live stream) stays defined for
  // the cheap consumers below (context meter, empty-state check, scroll length).
  // The EXPENSIVE derivations — `buildDisplayItems` and especially
  // `buildMessageOutlineEntries`, which allocates a full content-string cache key
  // per message — deliberately do NOT read it. They hang off `baseMessages`
  // (persisted + optimistic user), which is referentially stable between tokens,
  // so a streaming delta no longer forces an O(total messages) rebuild. The live
  // turn is derived separately from `streamMessages` and rendered as a tail; only
  // that small subtree recomputes per token.
  const displayMessages = useMemo(
    () =>
      hasPersistedRun
        ? baseMessages
        : [...baseMessages, ...streamMessages.filter((message) => message.content)],
    [baseMessages, hasPersistedRun, streamMessages],
  )
  const hiddenMessageCount = Math.max(0, baseMessages.length - visibleMessageLimit)
  const visibleBaseMessages = useMemo(
    () => (hiddenMessageCount > 0 ? baseMessages.slice(-visibleMessageLimit) : baseMessages),
    [baseMessages, hiddenMessageCount, visibleMessageLimit],
  )
  const baseDisplayItems = useMemo(
    () => buildDisplayItems(visibleBaseMessages),
    [visibleBaseMessages],
  )
  const liveDisplayItems = useMemo(
    () =>
      hasPersistedRun ? [] : buildDisplayItems(streamMessages.filter((message) => message.content)),
    [hasPersistedRun, streamMessages],
  )
  const baseOutlineEntries = useMemo(
    () => buildMessageOutlineEntries(baseDisplayItems),
    [baseDisplayItems],
  )
  const liveOutlineEntries = useMemo(
    () => buildMessageOutlineEntries(liveDisplayItems),
    [liveDisplayItems],
  )
  const messageOutlineEntries = useMemo(
    () =>
      liveOutlineEntries.length > 0
        ? [...baseOutlineEntries, ...liveOutlineEntries]
        : baseOutlineEntries,
    [baseOutlineEntries, liveOutlineEntries],
  )

  // Live context-window occupancy for the composer meter. The most recent
  // assistant turn's usage is the authoritative snapshot of what currently
  // sits in the window (prompt = input + both cache buckets, plus that turn's
  // output), unlike the session's cumulative totalTokens which only ever grows.
  const contextUsage = useMemo(() => {
    const contextWindow = selectedModelOption?.model.contextWindow
    if (!contextWindow || contextWindow <= 0) return null
    let latestUsage: ChatMessage['usage'] | undefined
    for (let index = displayMessages.length - 1; index >= 0; index--) {
      const candidate = displayMessages[index]
      if (candidate.type === 'assistant' && candidate.usage) {
        latestUsage = candidate.usage
        break
      }
    }
    const usedTokens = latestUsage
      ? latestUsage.input + latestUsage.cacheRead + latestUsage.cacheWrite + latestUsage.output
      : 0
    return { contextWindow, usedTokens }
  }, [displayMessages, selectedModelOption])

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

    const updateFollowState = () => {
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
      shouldFollowMessagesRef.current = distanceFromBottom < 96
    }

    updateFollowState()
    viewport.addEventListener('scroll', updateFollowState, { passive: true })
    const observer = new ResizeObserver(updateFollowState)
    observer.observe(viewport)
    return () => {
      viewport.removeEventListener('scroll', updateFollowState)
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    const viewport = messageViewportRef.current
    if (!viewport || !shouldFollowMessagesRef.current) return
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'auto' })
  }, [displayMessages.length, streamMessages])

  // Sending a message always snaps the view back to the live tail, even if the
  // user had scrolled up into history; the display-length effect above corrects
  // to the true bottom once the optimistic message renders.
  const followMessagesToBottom = () => {
    shouldFollowMessagesRef.current = true
    window.requestAnimationFrame(() => {
      const viewport = messageViewportRef.current
      if (viewport) viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'auto' })
    })
  }

  // Error blocks are transient status, not persistent content: auto-dismiss so
  // a stale failure notice doesn't linger over a subsequent successful run.
  useEffect(() => {
    if (!streamError) return
    const timer = window.setTimeout(
      () => dispatchRunStream({ type: 'error_dismissed' }),
      STREAM_ERROR_TIMEOUT_MS,
    )
    return () => window.clearTimeout(timer)
  }, [streamError])

  const isStartingRun = selectIsStartingRun(runStream)
  const isRunningRun = selectIsRunningRun(runStream)
  const canQueueMessage = selectCanQueueMessage(runStream)
  const isWaiting = selectIsWaiting(runStream, hasPersistedRun)

  // Hold a live run's error back for one grace window so an auto-retry that is
  // still in flight can claim it (see STREAM_ERROR_RETRY_GRACE_MS). The hold
  // lifts the moment the run settles, so an unretryable failure shows at once.
  const [errorHoldLifted, setErrorHoldLifted] = useState(true)
  useEffect(() => {
    if (!streamError || !isRunningRun) {
      setErrorHoldLifted(true)
      return
    }
    setErrorHoldLifted(false)
    const timer = window.setTimeout(() => setErrorHoldLifted(true), STREAM_ERROR_RETRY_GRACE_MS)
    return () => window.clearTimeout(timer)
  }, [streamError, isRunningRun])

  const showStreamError = Boolean(streamError) && !streamRetry && errorHoldLifted

  // Markdown-pipeline commands for a pi event. State transitions live in the
  // reducer (dispatched from handleFrame); this issues only the imperative
  // markdown work, addressed by the event's own message id. The server parser
  // always assigns assistant message ids; the defensive id-less delta path is
  // carried by the reducer directly, bypassing the pipeline.
  const issuePiMarkdownCommands = (event: PiRunEvent) => {
    switch (event.type) {
      case 'assistant_message_start': {
        if (event.messageId) beginStreamingMarkdownMessage(event.messageId)
        break
      }
      case 'assistant_message_end': {
        if (event.messageId) finishStreamingMarkdownMessage(event.messageId)
        break
      }
      case 'assistant_text_end': {
        sealStreamingMarkdownSegment(event.messageId, event.contentIndex ?? 0, event.content)
        break
      }
      case 'message_delta': {
        if (event.messageId && event.content) {
          appendStreamingMarkdownDelta(event.messageId, event.contentIndex ?? 0, event.content)
        }
        break
      }
      case 'thinking_delta':
      case 'tool_call_delta':
      case 'tool_result_delta':
      case 'bash_output': {
        // Land pending markdown text before the reducer appends the process
        // row, preserving row order within the same dispatch batch.
        flushStreamingMarkdown()
        break
      }
      case 'error': {
        finishAllStreamingMarkdown()
        break
      }
      default:
        break
    }
  }

  const handleFrame = (frame: RunStreamFrame) => {
    // Markdown commands first: their synchronous flushes re-enter the reducer
    // as content actions and must precede this frame's own transition. Then the
    // frame itself becomes one pure action; every run-state rule lives in
    // runStreamReducer, not here.
    if (frame.kind === 'pi') issuePiMarkdownCommands(frame.event)
    else if (frame.kind === 'activity_end') finishAllStreamingMarkdown()
    dispatchRunStream({ type: 'frame', frame, at: Date.now() })
  }

  // Single self-healing session event stream for the active session.
  const { status: eventStreamStatus, reconnect: reconnectEventStream } = useSessionEventStream(
    activeSession?.id,
    {
      onFrame: handleFrame,
    },
  )

  // The submit body lives outside `form.handleSubmit` so edit-resend can pass
  // the branch anchor directly — threading it through state would hit the same
  // stale-closure trap the staged source count exists to avoid.
  const submitPrompt = async (
    values: ComposerValues,
    options?: { branchParentEntryId?: string | null },
  ) => {
    if (!activeSession || !activeAgent) return
    if (values.message.trim().toLowerCase() === '/new-session') {
      await createNewSession()
      return
    }
    if (values.message.trim().toLowerCase() === '/clear-session') {
      await clearCurrentSession()
      return
    }
    if (values.message.trim().toLowerCase() === '/next-session') {
      switchRelativeSession('next')
      return
    }
    if (values.message.trim().toLowerCase() === '/prev-session') {
      switchRelativeSession('previous')
      return
    }
    const trimmedMessage = values.message.trim()
    if (!trimmedMessage && attachments.length === 0) return
    // No preflight running-check: the session event stream keeps `isRunningRun`
    // live, and the backend returns `already-running` as the authoritative guard
    // (handled below) if a race slips through.
    const uploadedAttachments = attachments.length > 0 ? await uploadAllAttachments() : []
    if (!uploadedAttachments) return
    const payload = {
      ...values,
      message: buildPromptWithAttachments(trimmedMessage, uploadedAttachments),
      ...(options?.branchParentEntryId !== undefined
        ? { branchParentEntryId: options.branchParentEntryId }
        : {}),
    }
    if (!postApiSessionsIdRunsMutationRequestSchema.safeParse(payload).success) return
    resetStreamingMarkdown()
    dispatchRunStream({
      type: 'prompt_submitted',
      message: {
        id: `optimistic-user-${Date.now()}`,
        type: 'user',
        content: trimmedMessage,
        attachments: uploadedAttachments,
        timestamp: 'sending',
      },
      sourceCount: sourceMessages.length,
      at: Date.now(),
    })
    followMessagesToBottom()
    try {
      // The session-level event stream is always connected, so the run's frames
      // arrive through it. Starting a run only kicks off the activity; the
      // activity_start/state frames advance the stream phase from here.
      const run = (await postApiSessionsIdRuns(activeSession.id, payload)) as unknown as {
        status:
          'started' | 'session-not-found' | 'agent-not-found' | 'already-running' | 'branch-failed'
        activityId?: string | null
        runId?: string | null
      }
      if (run.status !== 'started') {
        if (run.status === 'already-running') {
          dispatchRunStream({ type: 'prompt_rejected', error: null, alreadyRunning: true })
          showToast({
            tone: 'warning',
            title: 'Agent is processing',
            message: 'Use Steer now or Follow up to queue this message.',
          })
        } else {
          dispatchRunStream({
            type: 'prompt_rejected',
            error:
              run.status === 'session-not-found'
                ? 'This session is no longer available.'
                : run.status === 'agent-not-found'
                  ? 'The agent for this session is no longer available.'
                  : run.status === 'branch-failed'
                    ? 'Unable to branch from the edited message.'
                    : 'Unable to start pi run.',
          })
        }
        return
      }
      dispatchRunStream({ type: 'prompt_started', activityId: run.activityId ?? null })
      clearAttachments()
      form.reset({
        message: '',
        providerId: values.providerId,
        modelId: values.modelId,
        thinkingLevel: values.thinkingLevel,
      })
      return true
    } catch (error) {
      const message = errorMessage(error, 'Unable to start pi run.')
      if (/already processing|streamingBehavior/i.test(message)) {
        dispatchRunStream({ type: 'prompt_rejected', error: null, alreadyRunning: true })
        showToast({
          tone: 'warning',
          title: 'Agent is processing',
          message: 'Use Steer now or Follow up to queue this message.',
        })
      } else {
        dispatchRunStream({ type: 'prompt_rejected', error: message })
      }
      return
    }
  }

  const submit = form.handleSubmit((values) => submitPrompt(values))

  const abort = async () => {
    if (abortingRun) return
    if (!isRunningRun || !activeSession) return
    dispatchRunStream({ type: 'abort_requested' })
    // The abort's UI settle rides entirely on the SSE `activity_end` frame, which
    // fires only once the agent run truly goes idle. That can lag badly — or never
    // arrive — when the run is wedged on an operation slow to honor the abort, or
    // when the SDK drops the abort during its prompt preflight (isBusy() false).
    // Arm a fallback: if we're still "Stopping" after the window, force the
    // transport to rebuild the stream (replaying the missed activity_end and
    // re-pushing the true running state) and refresh history.
    if (abortFallbackTimerRef.current !== null) window.clearTimeout(abortFallbackTimerRef.current)
    abortFallbackTimerRef.current = window.setTimeout(() => {
      abortFallbackTimerRef.current = null
      dispatchRunStream({ type: 'abort_fallback_fired' })
      reconnectEventStream()
      router.refresh()
    }, ABORT_FALLBACK_TIMEOUT_MS)
    try {
      // Aborting is session-scoped; the resulting activity_end frame on the
      // session event stream drives the stream back to idle.
      await postApiSessionsIdAbort(activeSession.id)
    } catch (error) {
      if (abortFallbackTimerRef.current !== null) {
        window.clearTimeout(abortFallbackTimerRef.current)
        abortFallbackTimerRef.current = null
      }
      finishAllStreamingMarkdown()
      dispatchRunStream({
        type: 'abort_failed',
        error: error instanceof Error ? error.message : 'Unable to abort pi run.',
      })
    }
  }

  const queueMessage = async (behavior: 'steer' | 'follow-up') => {
    const content = form.getValues('message').trim()
    if (
      !activeSession ||
      !canQueueMessage ||
      (!content && attachments.length === 0) ||
      queueingMessage
    )
      return
    setQueueingMessage(behavior)
    dispatchRunStream({ type: 'error_dismissed' })
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
      followMessagesToBottom()
      showToast({
        tone: 'success',
        title: behavior === 'steer' ? 'Steer queued' : 'Follow-up queued',
        message:
          behavior === 'steer'
            ? 'The agent will apply this guidance after its current tool call.'
            : 'The agent will process this message after the current task finishes.',
      })
    } catch (error) {
      const message = errorMessage(error, `Unable to queue ${behavior} message.`)
      dispatchRunStream({ type: 'stream_error_raised', error: message })
      showToast({
        tone: 'error',
        title: behavior === 'steer' ? 'Unable to steer run' : 'Unable to queue follow-up',
        message,
      })
    } finally {
      setQueueingMessage(null)
    }
  }

  const selectTreeNode = async (entryId: string) => {
    if (!activeSession || isRunningRun || clearingSession) return
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
    if (!activeSession || !selectedNodeId || isRunningRun || clearingSession) return
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
    if (!activeAgent || !activeSession || !selectedNodeId || isRunningRun || clearingSession) return
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

  // Branching is silent on success — the new branch is its own confirmation.
  // `intent` only titles the failure toasts: retrying is an edit that happens to
  // keep the original text, so it branches from the same parent entry either way.
  const resubmitEditedUserMessage = async (
    message: ChatMessage,
    content: string,
    intent: 'edit' | 'retry' = 'edit',
  ) => {
    if (!activeSession || !activeAgent || isRunningRun || clearingSession) return
    const trimmed = content.trim()
    if (!trimmed) return

    const toastTitle = intent === 'retry' ? 'Retry message' : 'Edit message'

    const userMessages = displayMessages.filter((item) => item.type === 'user')
    const userIndex = userMessages.findIndex((item) => item.id === message.id)
    const entry = userIndex >= 0 ? findUserTreeNodeByIndex(tree, userIndex) : null
    if (!entry) {
      showToast({
        tone: 'error',
        title: toastTitle,
        message: 'Unable to locate this message in the session tree.',
      })
      return
    }

    // The branch anchor rides in the run request itself and is applied
    // server-side right before the prompt (see startSessionPrompt). A separate
    // /navigate call would only move an in-memory leaf pointer that a session
    // rebuild silently resets — degrading the edit into a linear append while
    // the UI shows the branch view.
    const branchParentEntryId = entry.parentId

    if (branchParentEntryId) {
      try {
        const contextResponse = await fetch(
          `/api/sessions/${encodeURIComponent(activeSession.id)}/context?leafId=${encodeURIComponent(branchParentEntryId)}`,
        )
        const contextBody = (await contextResponse.json()) as {
          messages?: ChatMessage[]
          error?: string
        }
        if (!contextResponse.ok || !contextBody.messages) {
          throw new Error(contextBody.error ?? 'Unable to load branch context.')
        }
        setSelectedNodeId(branchParentEntryId)
        setBranchMessages(contextBody.messages)
        dispatchRunStream({
          type: 'branch_context_staged',
          sourceCount: contextBody.messages.length,
        })
      } catch (error) {
        showToast({
          tone: 'error',
          title: toastTitle,
          message: error instanceof Error ? error.message : 'Unable to branch from this message.',
        })
        return
      }
    } else {
      // Re-editing the root message: the branch prefix is empty.
      setSelectedNodeId(null)
      setBranchMessages([])
      dispatchRunStream({ type: 'branch_context_staged', sourceCount: 0 })
    }

    clearAttachments()
    form.setValue('message', trimmed, { shouldDirty: true })
    await submitPrompt({ ...form.getValues(), message: trimmed }, { branchParentEntryId })
  }

  const retryUserMessage = async (message: ChatMessage) => {
    await resubmitEditedUserMessage(message, message.content, 'retry')
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

  // A running session can always be stopped: with a run handle we abort the run,
  // otherwise we fall back to a session-level abort. So "running" implies "abortable".
  const canAbortRun = isRunningRun
  const sendButtonLabel = abortingRun
    ? 'Stopping'
    : isStartingRun && !isRunningRun
      ? 'Sending'
      : isRunningRun
        ? 'Stop'
        : creatingSession
          ? 'Creating'
          : clearingSession
            ? 'Clearing'
            : isNewSessionCommand
              ? 'New session'
              : isClearSessionCommand
                ? 'Clear session'
                : isNextSessionCommand
                  ? 'Next session'
                  : isPrevSessionCommand
                    ? 'Previous session'
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
            <div className="flex min-w-0 items-center gap-1">
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
                  className="h-7 max-w-[30vw] px-2 font-mono text-xs tracking-wide text-foreground/85 hover:text-foreground sm:max-w-56"
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
              <span className="font-mono text-[10px] text-muted-foreground/40" aria-hidden>
                /
              </span>
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
                  className="h-7 max-w-[40vw] px-2 font-mono text-xs tracking-wide text-foreground/85 hover:text-foreground sm:max-w-80"
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
            <span
              className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-muted-foreground uppercase"
              title={isRunningRun ? 'Running' : 'Ready'}
              aria-label={isRunningRun ? 'Running' : 'Ready'}
            >
              <Circle
                className={cn(
                  'size-2.5',
                  isRunningRun ? 'fill-success text-success' : 'text-muted-foreground',
                )}
              />
              {isRunningRun ? 'running' : 'ready'}
            </span>
            <span
              className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground"
              title={`${activeSession.messageCount} messages`}
              aria-label={`${activeSession.messageCount} messages`}
            >
              <MessageSquare className="size-3" aria-hidden />
              {activeSession.messageCount}
            </span>
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
        {/* --composer-overlay-height lets descendants (the user-message edit
            card) reserve scroll space for the composer overlay, which floats
            above the scroll viewport and is invisible to scrollIntoView. */}
        <div
          className="relative min-h-0 flex-1"
          style={{ '--composer-overlay-height': `${composerOverlayHeight}px` } as CSSProperties}
        >
          {eventStreamStatus === 'reconnecting' && (
            <div className="pointer-events-none absolute top-2 left-1/2 z-10 -translate-x-1/2">
              <div className="flex items-center gap-1.5 border border-border-strong bg-card px-2.5 py-1 font-mono text-[10px] tracking-wide text-muted-foreground uppercase shadow-sm">
                <Circle className="size-2 animate-pulse fill-current" />
                Reconnecting
              </div>
            </div>
          )}
          <ScrollArea
            className="h-full min-h-0"
            viewportClassName="px-5 py-6 xl:pr-14"
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
              {/* Persisted + optimistic history. Referentially stable between
                  tokens, so React skips reconciling this whole list while a reply
                  streams — only the live tail below re-renders per delta. */}
              {baseDisplayItems.map((item) => {
                const anchorId = messageOutlineAnchorId(item)
                if (item.type === 'assistant-turn') {
                  return (
                    <div key={item.id} id={anchorId} data-message-outline-anchor>
                      <AssistantTurn
                        messages={item.messages}
                        agentAvatar={activeAgent.icon}
                        mediaSessionId={activeSession.id}
                        streamStartedAt={null}
                        isStreaming={false}
                        streamingMarkdown={undefined}
                      />
                    </div>
                  )
                }

                return (
                  <div key={item.message.id} id={anchorId} data-message-outline-anchor>
                    <StandaloneMessage
                      message={item.message}
                      userAvatar={userAvatar}
                      mediaSessionId={activeSession.id}
                      canEdit={!isRunningRun && !clearingSession}
                      onResubmit={resubmitEditedUserMessage}
                      onRetry={retryUserMessage}
                    />
                  </div>
                )
              })}
              {/* Live tail: only present mid-run. Isolated so its per-token
                  re-render never touches the history list above. */}
              {liveDisplayItems.map((item) => {
                const anchorId = messageOutlineAnchorId(item)
                if (item.type === 'assistant-turn') {
                  const isStreaming = item.messages.some(
                    (message) => message.timestamp === 'streaming',
                  )
                  const primaryAssistant = item.messages.findLast(
                    (message) => message.type === 'assistant',
                  )
                  return (
                    <div key={item.id} id={anchorId} data-message-outline-anchor>
                      <AssistantTurn
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
                    </div>
                  )
                }

                return (
                  <div key={item.message.id} id={anchorId} data-message-outline-anchor>
                    <StandaloneMessage
                      message={item.message}
                      userAvatar={userAvatar}
                      mediaSessionId={activeSession.id}
                      canEdit={!isRunningRun && !clearingSession}
                      onResubmit={resubmitEditedUserMessage}
                      onRetry={retryUserMessage}
                    />
                  </div>
                )
              })}
              {isWaiting && <WaitingBubble agentAvatar={activeAgent.icon} />}
              {displayMessages.length === 0 && !isWaiting && !streamError && !streamRetry && (
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
              {streamRetry && (
                <ChatRetryNotice retry={streamRetry} agentAvatar={activeAgent.icon} />
              )}
              {showStreamError && streamError && (
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
                style={{ height: composerOverlayHeight }}
              />
            </div>
          </ScrollArea>
          <ChatMessageOutline
            entries={messageOutlineEntries}
            viewportRef={messageViewportRef}
            bottomOffset={composerOverlayHeight}
          />
          {/* composer */}
          <ChatComposer
            form={form}
            containerRef={composerContainerRef}
            message={message}
            thinking={thinking}
            selectedModelOption={selectedModelOption}
            availableModelOptions={availableModelOptions}
            activeSessionCwd={activeSession.cwd}
            contextWindow={contextUsage?.contextWindow}
            contextUsedTokens={contextUsage?.usedTokens}
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
            canQueueMessage={canQueueMessage}
            canAbortRun={canAbortRun}
            isStartingRun={isStartingRun}
            abortingRun={abortingRun}
            creatingSession={creatingSession}
            clearingSession={clearingSession}
            queueingMessage={queueingMessage}
            canSend={canSend}
            sendButtonLabel={sendButtonLabel}
          />
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

// Outline previews/references run several regexes per message. Streaming pushes
// a fresh `displayMessages` array every frame, so without memoization every
// historical message is re-scanned on each frame — O(history) work per token.
// These bounded FIFO caches (keyed by the stable message content) turn repeat
// lookups into O(1); only the one actively streaming message misses each frame.
const OUTLINE_CACHE_LIMIT = 400
const outlinePreviewCache = new Map<string, string>()
const outlineReferencesCache = new Map<string, string[]>()

function setOutlineCache<V>(cache: Map<string, V>, key: string, value: V) {
  if (cache.size >= OUTLINE_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value
    if (oldestKey !== undefined) cache.delete(oldestKey)
  }
  cache.set(key, value)
}

function messageOutlineAnchorId(item: DisplayItem) {
  return `chat-message-${item.type === 'assistant-turn' ? item.id : item.message.id}`
}

function buildMessageOutlineEntries(items: DisplayItem[]): ChatMessageOutlineEntry[] {
  const entries: ChatMessageOutlineEntry[] = []

  for (const item of items) {
    if (item.type === 'message' && item.message.type === 'user') {
      const attachmentNames = item.message.attachments
        ?.map((attachment) => attachment.name)
        .join(', ')
      entries.push({
        id: `outline-${item.message.id}`,
        anchorId: messageOutlineAnchorId(item),
        title:
          messageOutlinePreview(item.message.content, 120) ||
          attachmentNames ||
          'Message with attachments',
        timestamp: item.message.timestamp,
        attachmentCount: item.message.attachments?.length,
      })
      continue
    }

    if (item.type !== 'assistant-turn') continue
    const response =
      item.messages.findLast((message) => message.type === 'assistant') ??
      item.messages.findLast((message) => message.type === 'error')
    if (!response?.content) continue

    const summary = messageOutlinePreview(response.content, 180)
    const references = messageOutlineReferences(response.content)
    const currentTurn = entries.at(-1)
    if (currentTurn && !currentTurn.summary) {
      currentTurn.summary = summary
      currentTurn.references = references
      continue
    }

    entries.push({
      id: `outline-${item.id}`,
      anchorId: messageOutlineAnchorId(item),
      title: 'Assistant response',
      summary,
      timestamp: response.timestamp,
      references,
    })
  }

  return entries
}

function messageOutlinePreview(content: string, maxLength: number) {
  const cacheKey = `${maxLength}\u0000${content}`
  const cached = outlinePreviewCache.get(cacheKey)
  if (cached !== undefined) return cached

  const preview = content
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1 image')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_`~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const result = preview.length > maxLength ? `${preview.slice(0, maxLength).trimEnd()}…` : preview
  setOutlineCache(outlinePreviewCache, cacheKey, result)
  return result
}

function messageOutlineReferences(content: string) {
  const cached = outlineReferencesCache.get(content)
  if (cached) return cached

  const references: string[] = []
  const addReference = (value: string) => {
    const normalized = value.trim().replace(/^.*[\\/]/, '')
    if (normalized && !references.includes(normalized)) references.push(normalized)
  }

  for (const match of content.matchAll(
    /\[([^\]]+\.(?:tsx?|jsx?|css|json|ya?ml|md|cjs|mjs)(?::\d+)?)\]\([^)]+\)/gi,
  )) {
    addReference(match[1])
    if (references.length === 2) break
  }

  if (references.length < 2) {
    for (const match of content.matchAll(
      /`([^`\n]+\.(?:tsx?|jsx?|css|json|ya?ml|md|cjs|mjs)(?::\d+)?)`/gi,
    )) {
      addReference(match[1])
      if (references.length === 2) break
    }
  }

  setOutlineCache(outlineReferencesCache, content, references)
  return references
}

// In-progress label lit by the shadcn `shimmer` utility (static under reduced
// motion, handled by the utility itself). Reused by the "Thinking" waiting
// bubble and the "Working" / activity-title labels so every in-progress state
// shares the same effect.
//
// The utility's gradient base is `currentColor`, so contrast depends entirely
// on the text color: at a plain `muted-foreground` base the foreground peak is
// too close to read. We own the color here (callers pass only layout/size) and
// force a heavily faded base against a solid-foreground peak, so the sweep
// travels as a clear dim → bright glint the way the old hand-rolled effect did.
// Both tokens adapt, so it holds up in light and dark.
function ShimmerText({ text, className }: { text: string; className?: string }) {
  return (
    <span
      className={cn(
        className,
        'shimmer text-muted-foreground/40 shimmer-color-foreground shimmer-duration-1500 shimmer-spread-8',
      )}
    >
      {text}
    </span>
  )
}

function WaitingBubble({ agentAvatar }: { agentAvatar?: string }) {
  return (
    <Message>
      <MessageAvatar className="bg-transparent">
        <ChatAvatar preset={agentAvatar} role="assistant" />
      </MessageAvatar>
      <MessageContent className="min-h-8 justify-center">
        <div
          role="status"
          aria-live="polite"
          className="ml-3.5 flex min-h-5 w-fit items-center gap-2 font-mono text-xs"
        >
          <span aria-hidden="true" className="flex items-center gap-1">
            {[0, 1, 2].map((index) => (
              <span
                key={index}
                className="thinking-dot size-1 rounded-full bg-accent"
                style={{ animationDelay: `${index * 0.15}s` }}
              />
            ))}
          </span>
          <ShimmerText text="Thinking" />
        </div>
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
        {primaryAssistant || errorMessages.length > 0 || detailMessages.length > 0 ? (
          <Bubble variant="ghost" className="w-full max-w-full">
            <BubbleContent className="w-full max-w-full min-w-0 p-0">
              {detailMessages.length > 0 && (
                <ProcessDetailsGroup
                  messages={detailMessages}
                  isStreaming={isStreaming}
                  mediaSessionId={mediaSessionId}
                />
              )}
              {primaryAssistant ? (
                <div
                  className={cn(
                    'w-full max-w-full min-w-0 px-3.5 pb-2',
                    detailMessages.length > 0 ? 'pt-3' : 'pt-1.25',
                  )}
                >
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
              ) : null}
              {errorMessages.length > 0 ? (
                <div
                  className={cn(
                    'flex w-full max-w-full min-w-0 flex-col gap-2 px-3.5',
                    primaryAssistant ? 'pt-1 pb-3' : 'py-3',
                  )}
                >
                  {errorMessages.map((message) => (
                    <ChatErrorCallout key={message.id} content={message.content} />
                  ))}
                </div>
              ) : null}
            </BubbleContent>
          </Bubble>
        ) : null}
        {assistantMessages.length > 0 && (
          <MessageFooter className="justify-end gap-1.5 px-0 opacity-100 transition-opacity md:opacity-0 md:group-focus-within/message:opacity-100 md:group-hover/message:opacity-100">
            <AssistantMessageMetrics
              usage={usage}
              fallbackTokens={fallbackTokens}
              estimated={Boolean(isStreaming && !usage)}
              streamSeconds={streamSeconds}
              timestamp={latestTimestamp}
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
  const { activities, items, toolCount, bashOutputCount } = useMemo(() => {
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
        {isStreaming ? (
          <ShimmerText
            text="Working"
            className="shrink-0 text-xs font-medium text-muted-foreground"
          />
        ) : (
          <span className="shrink-0 text-xs font-medium text-foreground/85">Activity</span>
        )}
        <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden font-mono text-[10px] text-muted-foreground/60">
          {items.length > 0 ? (
            items.map((item) => {
              const Icon = item.icon
              return (
                <span
                  key={item.key}
                  className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap"
                  title={`${item.count} ${item.label}`}
                >
                  <Icon className="size-3 text-muted-foreground/70" aria-hidden />
                  <span>{item.count}</span>
                </span>
              )
            })
          ) : (
            <span className="truncate">{activities.length} steps</span>
          )}
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

type RunActivitySummaryItem = {
  key: string
  count: number
  label: string
  icon: LucideIcon
}

type RunActivitySummary = {
  toolCount: number
  bashOutputCount: number
  items: RunActivitySummaryItem[]
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

  const items: RunActivitySummaryItem[] = [
    updateCount
      ? {
          key: 'updates',
          count: updateCount,
          label: updateCount === 1 ? 'update' : 'updates',
          icon: Bot,
        }
      : null,
    thoughtCount
      ? {
          key: 'thoughts',
          count: thoughtCount,
          label: thoughtCount === 1 ? 'thought' : 'thoughts',
          icon: Brain,
        }
      : null,
    toolCount
      ? {
          key: 'tools',
          count: toolCount,
          label: toolCount === 1 ? 'tool' : 'tools',
          icon: Wrench,
        }
      : null,
    bashOutputCount
      ? {
          key: 'outputs',
          count: bashOutputCount,
          label: bashOutputCount === 1 ? 'output' : 'outputs',
          icon: Terminal,
        }
      : null,
  ].filter((item): item is RunActivitySummaryItem => item !== null)

  return { toolCount, bashOutputCount, items }
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
        {streaming ? (
          // Static (not shimmer) while streaming: the turn-level "Working"
          // label already carries the animated in-progress cue, so per-row
          // shimmer only multiplies background-clip:text repaints for no signal.
          <span className="max-w-[36%] shrink-0 truncate text-xs font-medium text-muted-foreground">
            {title}
          </span>
        ) : (
          <span className="max-w-[36%] shrink-0 truncate text-xs font-medium text-foreground/85">
            {title}
          </span>
        )}
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
            <ScrollArea
              className="rounded-panel border border-border bg-panel"
              viewportClassName="max-h-72 px-3 py-2"
            >
              <pre className="font-mono text-[11px] leading-relaxed wrap-break-word whitespace-pre-wrap text-foreground/85">
                {message.content}
              </pre>
            </ScrollArea>
          ) : (
            // Thinking (and other prose) is model-authored markdown; render it so
            // bold/headings/lists show properly instead of leaking `**` syntax.
            // Keep the muted, left-bordered "thinking" treatment on the wrapper.
            <div className="border-l border-border pl-3 text-[13px] text-muted-foreground">
              <MarkdownContent content={message.content} mediaSessionId={mediaSessionId} />
            </div>
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
        {result ? (
          <span className="shrink-0 font-mono text-[9px] text-success uppercase">{status}</span>
        ) : (
          <ShimmerText
            className="shrink-0 font-mono text-[9px] text-accent uppercase"
            text={status}
          />
        )}
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
              <ScrollArea
                className="rounded-panel border border-border bg-panel"
                viewportClassName="max-h-56 px-3 py-2"
              >
                <pre className="font-mono text-[11px] leading-relaxed wrap-break-word whitespace-pre-wrap text-foreground/85">
                  {call.content}
                </pre>
              </ScrollArea>
            </div>
          )}
          {result && (
            <div className="min-w-0">
              <div className="mb-1 font-mono text-[9px] tracking-wide text-muted-foreground/55 uppercase">
                Result
              </div>
              <ScrollArea
                className="rounded-panel border border-border bg-panel"
                viewportClassName="max-h-72 px-3 py-2"
              >
                <pre className="font-mono text-[11px] leading-relaxed wrap-break-word whitespace-pre-wrap text-muted-foreground">
                  {result.content}
                </pre>
              </ScrollArea>
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

const StandaloneMessage = memo(function StandaloneMessage({
  message,
  userAvatar,
  mediaSessionId,
  canEdit = false,
  onResubmit,
  onRetry,
}: {
  message: ChatMessage
  userAvatar?: string
  mediaSessionId?: string
  canEdit?: boolean
  onResubmit?: (message: ChatMessage, content: string) => Promise<void> | void
  onRetry?: (message: ChatMessage) => Promise<void> | void
}) {
  switch (message.type) {
    case 'user':
      return (
        <UserMessage
          message={message}
          userAvatar={userAvatar}
          mediaSessionId={mediaSessionId}
          canEdit={canEdit}
          onResubmit={onResubmit}
          onRetry={onRetry}
        />
      )
    case 'error':
      return (
        <Message>
          <MessageContent className="gap-0.5">
            <Bubble variant="ghost" className="w-full max-w-full">
              <BubbleContent className="w-full max-w-full min-w-0 p-0">
                <div className="w-full max-w-full min-w-0 px-3.5 py-3">
                  <ChatErrorCallout content={message.content} />
                </div>
              </BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
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

function UserMessage({
  message,
  userAvatar,
  mediaSessionId,
  canEdit = false,
  onResubmit,
  onRetry,
}: {
  message: ChatMessage
  userAvatar?: string
  mediaSessionId?: string
  canEdit?: boolean
  onResubmit?: (message: ChatMessage, content: string) => Promise<void> | void
  onRetry?: (message: ChatMessage) => Promise<void> | void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const [submitting, setSubmitting] = useState(false)
  const [copied, setCopied] = useState(false)
  const editCardRef = useRef<HTMLDivElement>(null)
  const editTextareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!isEditing) setDraft(message.content)
  }, [isEditing, message.content])

  useEffect(() => {
    if (isEditing) editTextareaRef.current?.focus({ preventScroll: true })
  }, [isEditing])

  // The composer floats over the scroll viewport, so the browser would happily
  // leave the edit card's action row underneath it. The card's
  // scroll-margin-bottom covers the overlay; re-check on draft growth too so
  // typing that adds rows keeps the buttons above the composer's top edge.
  useEffect(() => {
    if (isEditing) editCardRef.current?.scrollIntoView({ block: 'nearest' })
  }, [isEditing, draft])

  const copyMessage = async () => {
    const ok = await copyTextToClipboard(message.content)
    if (!ok) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const cancelEdit = () => {
    setIsEditing(false)
    setDraft(message.content)
  }

  const sendEdit = async () => {
    const trimmed = draft.trim()
    if (!trimmed || !onResubmit || submitting) return
    setSubmitting(true)
    try {
      await onResubmit(message, trimmed)
      setIsEditing(false)
    } finally {
      setSubmitting(false)
    }
  }

  const retry = async () => {
    if (!onRetry || submitting) return
    setSubmitting(true)
    try {
      await onRetry(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Message align="end">
      <MessageAvatar className="bg-transparent">
        <ChatAvatar preset={userAvatar} role="user" />
      </MessageAvatar>
      <MessageContent className="items-end gap-1 pr-2">
        {message.attachments && message.attachments.length > 0 && !isEditing && (
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
                    <span className="shrink-0 font-mono">{formatFileSize(attachment.size)}</span>
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
        {isEditing ? (
          <div
            ref={editCardRef}
            className="w-full max-w-[85%] scroll-mb-[calc(var(--composer-overlay-height,112px)+8px)] rounded-md bg-secondary px-4 pt-3.5 pb-3 shadow-sm"
          >
            <textarea
              ref={editTextareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="min-h-20 w-full resize-none scrollbar-thin bg-transparent text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
              disabled={submitting}
              rows={Math.min(12, Math.max(3, draft.split('\n').length))}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  cancelEdit()
                }
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void sendEdit()
                }
              }}
            />
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={cancelEdit}
                disabled={submitting}
                className="rounded-md border border-border/80 bg-transparent px-3.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-background/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void sendEdit()}
                disabled={submitting || !draft.trim()}
                className="rounded-md bg-foreground px-3.5 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-40"
              >
                {submitting ? 'Sending' : 'Send'}
              </button>
            </div>
          </div>
        ) : (
          <>
            {message.content && (
              <Bubble variant="secondary" align="end" className="max-w-[85%]">
                <BubbleContent className="p-0">
                  <ScrollArea viewportClassName="max-h-72 px-3.5 py-2.5">
                    <div className="whitespace-pre-wrap text-foreground">{message.content}</div>
                  </ScrollArea>
                </BubbleContent>
              </Bubble>
            )}
            <MessageFooter className="justify-end gap-1 px-0 opacity-100 transition-opacity md:opacity-0 md:group-focus-within/message:opacity-100 md:group-hover/message:opacity-100">
              <span className="font-mono text-[10px] text-muted-foreground/50">
                {message.timestamp}
              </span>
              <MessageActionIconButton
                label={copied ? 'Copied' : 'Copy'}
                onClick={() => void copyMessage()}
              >
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              </MessageActionIconButton>
              {canEdit && onRetry && message.content.trim() ? (
                <MessageActionIconButton
                  label="Retry"
                  disabled={submitting}
                  onClick={() => void retry()}
                >
                  <RotateCcw className="size-3" />
                </MessageActionIconButton>
              ) : null}
              {canEdit && onResubmit ? (
                <MessageActionIconButton
                  label="Edit"
                  disabled={submitting}
                  onClick={() => {
                    setDraft(message.content)
                    setIsEditing(true)
                  }}
                >
                  <Pencil className="size-3" />
                </MessageActionIconButton>
              ) : null}
            </MessageFooter>
          </>
        )}
      </MessageContent>
    </Message>
  )
}

type ParsedChatError = {
  title: string
  message: string
  status?: string
  code?: string
  requestId?: string
  type?: string
  raw: string
}

function tryParseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function extractRequestId(value: string) {
  const match = value.match(/request id[:\s]+["']?([A-Za-z0-9_-]+)/i)
  return match?.[1] ?? null
}

function humanizeErrorCode(code: string) {
  return code.replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function titleFromError(code?: string | null, status?: string | null) {
  switch (code) {
    case 'model_not_found':
      return 'Model not available'
    case 'rate_limit_exceeded':
      return 'Rate limit exceeded'
    case 'insufficient_quota':
      return 'Insufficient quota'
    case 'invalid_api_key':
    case 'authentication_error':
      return 'Authentication failed'
    case 'context_length_exceeded':
      return 'Context too long'
    case 'new_api_error':
      return 'API error'
    default:
      break
  }
  switch (status) {
    case '400':
      return 'Bad request'
    case '401':
    case '403':
      return 'Authentication failed'
    case '404':
      return 'Not found'
    case '429':
      return 'Too many requests'
    case '500':
      return 'Server error'
    case '502':
    case '503':
    case '504':
      return 'Service unavailable'
    default:
      break
  }
  if (code) return humanizeErrorCode(code)
  return 'Request failed'
}

function parseApiErrorFields(raw: string) {
  const code = raw.match(/"code"\s*:\s*"([^"]+)"/)?.[1] ?? null
  const type = raw.match(/"type"\s*:\s*"([^"]+)"/)?.[1] ?? null
  const message =
    raw
      .match(/"message"\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1]
      ?.replace(/\\"/g, '"')
      .replace(/\\n/g, '\n') ??
    raw.match(/"message"\s*:\s*"([^"]*)/)?.[1] ??
    null
  const requestId =
    extractRequestId(raw) ?? raw.match(/"request[_ ]?id"\s*:\s*"([^"]+)"/i)?.[1] ?? null
  return { code, type, message, requestId }
}

function parseChatError(rawInput: string): ParsedChatError {
  const raw = rawInput.trim()
  if (!raw) {
    return {
      title: 'Request failed',
      message: 'An unknown error occurred.',
      raw: rawInput,
    }
  }

  const statusPrefix = raw.match(/^(\d{3})\s*:\s*([\s\S]+)$/)
  const status = statusPrefix?.[1] ?? raw.match(/^(\d{3})\b/)?.[1] ?? null
  const body = statusPrefix?.[2]?.trim() ?? raw

  const jsonObject = tryParseJsonObject(body) ?? tryParseJsonObject(raw)
  if (jsonObject) {
    const code = stringField(jsonObject, 'code')
    const type = stringField(jsonObject, 'type')
    const nestedError =
      jsonObject.error && typeof jsonObject.error === 'object' && !Array.isArray(jsonObject.error)
        ? (jsonObject.error as Record<string, unknown>)
        : null
    const message =
      stringField(jsonObject, 'message') ??
      stringField(jsonObject, 'error') ??
      (nestedError ? stringField(nestedError, 'message') : null) ??
      raw
    const requestId =
      extractRequestId(message) ??
      stringField(jsonObject, 'request_id') ??
      stringField(jsonObject, 'requestId') ??
      (nestedError ? stringField(nestedError, 'request_id') : null)
    const cleanMessage = message.replace(/\s*\(request id:\s*[^)]+\)\s*/i, '').trim() || message
    return {
      title: titleFromError(code ?? stringField(nestedError ?? {}, 'code'), status),
      message: cleanMessage,
      status: status ?? undefined,
      code: code ?? stringField(nestedError ?? {}, 'code') ?? undefined,
      requestId: requestId ?? undefined,
      type: type ?? stringField(nestedError ?? {}, 'type') ?? undefined,
      raw,
    }
  }

  const fields = parseApiErrorFields(body)
  if (fields.message || fields.code) {
    const cleanMessage =
      fields.message?.replace(/\s*\(request id:\s*[^)]+\)\s*/i, '').trim() || fields.message || raw
    return {
      title: titleFromError(fields.code, status),
      message: cleanMessage,
      status: status ?? undefined,
      code: fields.code ?? undefined,
      requestId: fields.requestId ?? undefined,
      type: fields.type ?? undefined,
      raw,
    }
  }

  const plainMessage = statusPrefix ? body : raw
  const inferredCode = /rate limit/i.test(plainMessage)
    ? 'rate_limit_exceeded'
    : /model not (found|available)|no available channel/i.test(plainMessage)
      ? 'model_not_found'
      : /context.*(length|too long)|maximum context/i.test(plainMessage)
        ? 'context_length_exceeded'
        : null

  return {
    title: titleFromError(inferredCode, status),
    message: plainMessage.replace(/\s*\(request id:\s*[^)]+\)\s*/i, '').trim() || plainMessage,
    status: status ?? undefined,
    code: inferredCode ?? undefined,
    requestId: extractRequestId(raw) ?? undefined,
    raw,
  }
}

/**
 * Transient-failure notice shown in place of the error block while the SDK
 * auto-retries the turn. It takes over the waiting bubble's slot, so it wears
 * the same shape (avatar, indent, shimmer label) and only swaps the Thinking
 * dots for the attempt counter. The error itself is not lost — it sits one
 * disclosure away, like ChatErrorCallout's details.
 */
function ChatRetryNotice({ retry, agentAvatar }: { retry: RunStreamRetry; agentAvatar?: string }) {
  const parsed = useMemo(() => parseChatError(retry.message), [retry.message])
  const counter = retry.maxAttempts > 0 ? `${retry.attempt}/${retry.maxAttempts}` : null

  return (
    <Message>
      <MessageAvatar className="bg-transparent">
        <ChatAvatar preset={agentAvatar} role="assistant" />
      </MessageAvatar>
      <MessageContent className="min-h-8 justify-center">
        <details role="status" aria-live="polite" className="group/retry ml-3.5 min-w-0">
          <summary
            title="Show error details"
            className="flex min-h-5 w-fit max-w-full cursor-pointer list-none items-center gap-2 font-mono text-xs"
          >
            <ShimmerText text="Reconnecting" />
            {counter ? <span className="text-muted-foreground/60">{counter}</span> : null}
            <ChevronRight
              className="size-3 shrink-0 text-muted-foreground/60 transition-transform group-open/retry:rotate-90"
              aria-hidden
            />
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto font-mono text-[10px] leading-relaxed wrap-break-word whitespace-pre-wrap text-muted-foreground/70">
            {parsed.raw || parsed.message}
          </pre>
        </details>
      </MessageContent>
    </Message>
  )
}

function ChatErrorCallout({
  content,
  variant = 'standalone',
  className,
}: {
  content: string
  variant?: 'standalone' | 'embedded'
  className?: string
}) {
  const parsed = useMemo(() => parseChatError(content), [content])
  const [showDetails, setShowDetails] = useState(false)
  const detailsUseful =
    parsed.raw.trim() !== parsed.message.trim() &&
    parsed.raw.trim() !== `${parsed.title}\n${parsed.message}`.trim()

  return (
    <div
      role="alert"
      className={cn(
        // Keep callout width locked to the message body column (same as 正文).
        'box-border flex w-full max-w-full min-w-0 items-start gap-2.5 overflow-hidden text-destructive',
        // Keep the default state compact; diagnostics stay behind the disclosure control.
        variant === 'embedded'
          ? 'border-t border-destructive/25 bg-destructive/6 px-3.5 py-2.5'
          : 'rounded-md border border-destructive/30 bg-destructive/6 px-3.5 py-2.5',
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 opacity-90" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[12px] leading-relaxed text-destructive/85">{parsed.message}</p>
        {showDetails && detailsUseful ? (
          <pre className="mt-2 max-h-40 overflow-auto font-mono text-[10px] leading-relaxed wrap-break-word whitespace-pre-wrap text-destructive/70">
            {parsed.raw}
          </pre>
        ) : null}
      </div>
      {detailsUseful ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="-mt-0.5 -mr-1"
          onClick={() => setShowDetails((value) => !value)}
          aria-expanded={showDetails}
          aria-label={showDetails ? 'Hide error details' : 'Show error details'}
          title={showDetails ? 'Hide error details' : 'Show error details'}
        >
          <ChevronDown
            className={cn('transition-transform', showDetails && 'rotate-180')}
            aria-hidden
          />
        </Button>
      ) : null}
    </div>
  )
}

function MessageActionIconButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="inline-flex size-6 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  )
}

async function copyTextToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    showToast({
      tone: 'error',
      title: 'Copy failed',
      message: 'Unable to access the clipboard.',
    })
    return false
  }
}

function findUserTreeNodeByIndex(
  tree: SessionTreeNode | null,
  userIndex: number,
): SessionTreeNode | null {
  if (!tree || userIndex < 0) return null

  const currentPathUsers: SessionTreeNode[] = []
  const collectCurrentPath = (node: SessionTreeNode, trail: SessionTreeNode[]): boolean => {
    const next = [...trail, node]
    if (node.isCurrent) {
      for (const item of next) {
        if (item.role === 'user') currentPathUsers.push(item)
      }
      return true
    }
    for (const child of node.children) {
      if (collectCurrentPath(child, next)) return true
    }
    return false
  }
  collectCurrentPath(tree, [])
  if (currentPathUsers[userIndex]) return currentPathUsers[userIndex]

  const allUsers: SessionTreeNode[] = []
  const walk = (node: SessionTreeNode) => {
    if (node.role === 'user') allUsers.push(node)
    node.children.forEach(walk)
  }
  walk(tree)
  return allUsers[userIndex] ?? null
}

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

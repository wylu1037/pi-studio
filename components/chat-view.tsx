'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import {
  ArrowLineDownIcon as InputMetricIcon,
  ArrowLineUpIcon as OutputMetricIcon,
  ClockIcon as TimeMetricIcon,
  CoinsIcon as CostMetricIcon,
  DatabaseIcon as CacheMetricIcon,
} from '@phosphor-icons/react'
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
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  ArrowDown,
  ArrowUp,
  MessageSquarePlus,
} from 'lucide-react'
import { Label, Tag, BracketButton, Panel, PanelHeader } from '@/components/pi-ui'
import { MarkdownContent } from '@/components/markdown-content'
import { WorkspaceExplorer } from '@/components/workspace-explorer'
import { ExtensionUiHost } from '@/components/extension-ui-host'
import { ScrollArea } from '@/components/ui/scroll-area'
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
import { errorMessage, showToast } from '@/lib/toast'
import { cn } from '@/lib/utils'

const thinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
const EVENT_STREAM_CONNECT_TIMEOUT_MS = 5000
const RUN_RECONCILE_INITIAL_DELAY_MS = 1000
const RUN_RECONCILE_POLL_MS = 1200
const RUN_RECONCILE_MAX_MS = 20000
const SESSION_TREE_RECENT_NODE_LIMIT = 80
const INITIAL_VISIBLE_MESSAGE_LIMIT = 120
const MESSAGE_LIMIT_INCREMENT = 100
const COMPOSER_MAX_HEIGHT = 160

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

type SlashCommandOption =
  | {
      kind: 'builtin'
      id: 'new-session'
      command: 'new-session'
      description: string
    }
  | {
      kind: 'prompt'
      id: string
      command: string
      description: string
      argumentHint?: string
      prompt: GlobalPromptTemplate
    }
  | {
      kind: 'extension'
      id: string
      command: string
      description: string
    }

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
  const [streamMessages, setStreamMessages] = useState<ChatMessage[]>([])
  const [streamStartedAt, setStreamStartedAt] = useState<number | null>(null)
  const [composerInputHeight, setComposerInputHeight] = useState(44)
  const [composerIsScrollable, setComposerIsScrollable] = useState(false)
  const [composerOverlayHeight, setComposerOverlayHeight] = useState(112)
  const [streamDone, setStreamDone] = useState(false)
  const [streamPhase, setStreamPhase] = useState<StreamPhase>('idle')
  const [optimisticMessage, setOptimisticMessage] = useState<ChatMessage | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [sdkSessionRunning, setSdkSessionRunning] = useState(false)
  const [abortingRun, setAbortingRun] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [queueingMessage, setQueueingMessage] = useState<'steer' | 'follow-up' | null>(null)
  const [showSessionTree, setShowSessionTree] = useState(false)
  const [showActiveContext, setShowActiveContext] = useState(false)
  const messageViewportRef = useRef<HTMLDivElement>(null)
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null)
  const composerInputViewportRef = useRef<HTMLDivElement>(null)
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
    resolver: zodResolver(postApiSessionsIdRunsMutationRequestSchema as never),
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
  const messageRegistration = form.register('message')
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
    const contentHeight = resizeTextarea(composerTextareaRef.current)
    setComposerInputHeight(Math.min(contentHeight, COMPOSER_MAX_HEIGHT))
    setComposerIsScrollable(contentHeight > COMPOSER_MAX_HEIGHT)
    const frame = window.requestAnimationFrame(() => {
      const inputViewport = composerInputViewportRef.current
      if (inputViewport) inputViewport.scrollTop = inputViewport.scrollHeight
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
      postApiSessionsIdRunsMutationRequestSchema.safeParse(composerValues).success),
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
    sdkSessionWasRunningRef.current = false
    setSdkSessionRunning(false)

    const poll = async () => {
      if (!activeSession) return
      try {
        const state = await getApiSessionsIdAgentState(activeSession.id, {
          headers: { 'cache-control': 'no-cache' },
        })
        if (!active) return
        const wasRunning = sdkSessionWasRunningRef.current
        sdkSessionWasRunningRef.current = state.running
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
  }, [activeSession, router])

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

  useEffect(() => {
    if (!streamDone || sourceMessages.length <= sourceMessageCountAtRunStartRef.current) return

    setStreamMessages([])
    setStreamStartedAt(null)
    setStreamDone(false)
    setOptimisticMessage(null)
    setStreamPhase('idle')
    setBranchMessages(null)
    currentStreamingAssistantIdRef.current = null
    latestStreamingAssistantIdRef.current = null
  }, [sourceMessages.length, streamDone])

  const baseMessages =
    optimisticMessage &&
    !sourceMessages.some(
      (message) => message.type === 'user' && message.content === optimisticMessage.content,
    )
      ? [...sourceMessages, optimisticMessage]
      : sourceMessages

  const hasPersistedRun =
    streamDone && sourceMessages.length > sourceMessageCountAtRunStartRef.current
  const displayMessages = hasPersistedRun
    ? baseMessages
    : [...baseMessages, ...streamMessages.filter((message) => message.content)]
  const hiddenMessageCount = Math.max(0, displayMessages.length - visibleMessageLimit)
  const visibleDisplayMessages =
    hiddenMessageCount > 0 ? displayMessages.slice(-visibleMessageLimit) : displayMessages
  const displayItems = buildDisplayItems(visibleDisplayMessages)

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
  const isWaiting =
    !streamError && runId !== null && streamPhase !== 'idle' && streamMessages.length === 0

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
    setBranchMessages(null)
    return true
  }

  const failActiveStream = (currentRunId: string, message: string, source?: EventSource | null) => {
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

  const startStreamingAssistant = useCallback(() => {
    const id = `stream-assistant-${Date.now()}-${streamMessageSequenceRef.current++}`
    currentStreamingAssistantIdRef.current = id
    latestStreamingAssistantIdRef.current = id
    return id
  }, [])

  const appendStreamingAssistantDelta = useCallback(
    (content: string) => {
      if (!content) return
      const id = currentStreamingAssistantIdRef.current ?? startStreamingAssistant()
      setStreamMessages((current) => {
        const existing = current.find((message) => message.id === id)
        if (existing) {
          return current.map((message) =>
            message.id === id ? { ...message, content: message.content + content } : message,
          )
        }
        return [
          ...current,
          {
            id,
            type: 'assistant',
            content,
            timestamp: 'streaming',
          },
        ]
      })
    },
    [startStreamingAssistant],
  )

  const appendStreamProcessMessage = useCallback(
    (
      type: Extract<ChatMessageType, 'thinking' | 'tool_call' | 'tool_result' | 'bash'>,
      content: string,
      title?: string,
    ) => {
      if (!content) return
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
    [],
  )

  useEffect(() => {
    if (!activeSession || !sdkSessionRunning || runId) return

    setStreamStartedAt(Date.now())
    setStreamDone(false)
    setStreamError(null)
    setStreamPhase('thinking')
    currentStreamingAssistantIdRef.current = null
    latestStreamingAssistantIdRef.current = null

    const source = new EventSource(
      `/api/sessions/${encodeURIComponent(activeSession.id)}/live-events`,
    )
    eventSourceRef.current = source
    source.addEventListener('assistant_message_start', () => startStreamingAssistant())
    source.addEventListener('assistant_message_end', () => {
      currentStreamingAssistantIdRef.current = null
    })
    source.addEventListener('message_delta', (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { content?: string }
      setStreamPhase('streaming')
      appendStreamingAssistantDelta(payload.content ?? '')
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
      const payload = JSON.parse((event as MessageEvent).data) as { usage?: StreamUsage }
      const assistantId = latestStreamingAssistantIdRef.current
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
      setStreamError(payload.message ?? 'pi run failed.')
    })
    source.addEventListener('done', () => {
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
    router,
    runId,
    sdkSessionRunning,
    startStreamingAssistant,
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
    const payload = {
      ...values,
      message: values.message.trim(),
    }
    if (!postApiSessionsIdRunsMutationRequestSchema.safeParse(payload).success) {
      return
    }
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
    eventSourceRef.current?.close()
    clearReconciliation()
    activeRunIdRef.current = null
    setStreamMessages([])
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
      eventSource.addEventListener('assistant_message_start', () => {
        if (activeRunIdRef.current !== currentRunId) return
        window.clearTimeout(connectionTimeout)
        startStreamingAssistant()
      })
      eventSource.addEventListener('assistant_message_end', () => {
        if (activeRunIdRef.current !== currentRunId) return
        currentStreamingAssistantIdRef.current = null
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
        appendStreamingAssistantDelta(content)
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
        }
        const assistantId = latestStreamingAssistantIdRef.current
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
      setStreamError(error instanceof Error ? error.message : 'Unable to abort pi run.')
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
    return (
      <div className="flex h-full items-center justify-center font-mono text-sm text-muted-foreground">
        No agent or session is available.
      </div>
    )
  }

  const isStartingRun = streamPhase === 'starting' && !runId
  const isRunningRun = Boolean(runId) || sdkSessionRunning
  const canAbortRun = Boolean(runId)
  const sendButtonLabel = abortingRun
    ? 'Stopping'
    : isRunningRun
      ? canAbortRun
        ? 'Stop'
        : 'Working'
      : creatingSession
        ? 'Creating'
        : isStartingRun
          ? 'Sending'
          : isNewSessionCommand
            ? 'New session'
            : 'Send'

  return (
    <div className="flex h-full min-h-0">
      {/* LEFT: session tree */}
      {showSessionTree && (
        <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-panel">
          <div className="flex h-18 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
            <div>
              <Label>Session tree</Label>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                {visibleTreeNodes < totalTreeNodes
                  ? `${visibleTreeNodes} of ${totalTreeNodes} recent nodes`
                  : `${totalTreeNodes} nodes`}{' '}
                · {sessions.length} sessions
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowSessionTree(false)}
              className="flex size-8 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Hide session tree"
              aria-label="Hide session tree"
            >
              <PanelLeftClose className="size-4" />
            </button>
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
            {!showSessionTree && (
              <button
                type="button"
                onClick={() => setShowSessionTree(true)}
                className="flex size-8 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Show session tree"
                aria-label="Show session tree"
              >
                <PanelLeftOpen className="size-4" />
              </button>
            )}
            <span className="flex size-7 items-center justify-center border border-border-strong bg-card">
              <Bot className="size-3.5 text-accent" />
            </span>
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
                  className="h-7 max-w-[30vw] border-border bg-panel px-2 text-xs text-foreground"
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
                  className="h-7 max-w-[40vw] border-border bg-panel px-2 text-[11px] text-muted-foreground hover:text-foreground sm:max-w-80"
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
                  {sessions.map((session) => (
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
            {!showActiveContext && (
              <button
                type="button"
                onClick={() => setShowActiveContext(true)}
                className="flex size-8 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Show active context"
                aria-label="Show active context"
              >
                <PanelRightOpen className="size-4" />
              </button>
            )}
          </div>
        </div>

        {/* messages */}
        <div className="relative min-h-0 flex-1">
          <ScrollArea
            className="h-full min-h-0"
            viewportClassName="px-5 py-6"
            viewportRef={messageViewportRef}
          >
            <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-4 overflow-x-hidden">
              {hiddenMessageCount > 0 && (
                <button
                  type="button"
                  onClick={loadOlderMessages}
                  className="mx-auto border border-border-strong bg-card px-3 py-1.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase transition-colors hover:bg-muted hover:text-foreground"
                >
                  Load {Math.min(MESSAGE_LIMIT_INCREMENT, hiddenMessageCount)} older messages
                </button>
              )}
              {displayItems.map((item) =>
                item.type === 'process' ? (
                  <ProcessDetailsGroup
                    key={item.id}
                    messages={item.messages}
                    isStreaming={Boolean(
                      runId && item.messages.some((message) => message.timestamp === 'streaming'),
                    )}
                  />
                ) : (
                  <MessageBubble
                    key={item.message.id}
                    message={item.message}
                    agentName={activeAgent.name}
                    mediaSessionId={activeSession.id}
                    streamStartedAt={
                      item.message.timestamp === 'streaming' ? streamStartedAt : null
                    }
                  />
                ),
              )}
              {isWaiting && <WaitingBubble agentName={activeAgent.name} />}
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
                <MessageBubble
                  agentName={activeAgent.name}
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
          <div
            ref={composerContainerRef}
            className="pointer-events-none absolute inset-x-0 bottom-0 px-5 pb-4"
          >
            <div className="pointer-events-auto relative mx-auto max-w-3xl bg-background/95 px-2 pt-2 shadow-[0_-16px_32px_-28px_rgba(24,28,36,0.45)]">
              <ExtensionUiHost
                sessionId={activeSession.id}
                onEditorText={applyExtensionEditorText}
              />
              {slashCommandOptions.length > 0 && (
                <div className="absolute inset-x-0 bottom-full mb-2 overflow-hidden border border-border-strong bg-card shadow-xl">
                  <div className="flex items-center justify-between border-b border-border bg-panel px-4 py-2.5">
                    <Label>Slash commands</Label>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {slashCommandOptions.length} available
                    </span>
                  </div>
                  <ul className="scrollbar-thin max-h-64 overflow-auto py-1">
                    {slashCommandOptions.map((option, index) => (
                      <li key={`${option.kind}:${option.id}`}>
                        <button
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => executeSlashCommand(option)}
                          disabled={option.kind === 'builtin' && (isRunningRun || creatingSession)}
                          className={cn(
                            'flex w-full flex-col gap-1 border-l-2 border-transparent px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45',
                            index === slashSelection
                              ? 'border-l-accent bg-accent/10'
                              : 'hover:bg-muted/70',
                          )}
                        >
                          <span className="flex min-w-0 items-center gap-2.5">
                            {option.kind === 'builtin' ? (
                              <MessageSquarePlus className="size-3.5 shrink-0 text-accent" />
                            ) : (
                              <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
                            )}
                            <span className="shrink-0 font-mono text-[13px] leading-5 font-medium text-accent">
                              /{option.command}
                            </span>
                            {option.kind === 'prompt' && option.argumentHint && (
                              <span className="truncate font-mono text-[10px] leading-5 text-warning">
                                {option.argumentHint}
                              </span>
                            )}
                            {option.kind === 'builtin' && (
                              <Tag tone="outline" className="ml-auto shrink-0">
                                built-in
                              </Tag>
                            )}
                            {option.kind === 'extension' && (
                              <Tag tone="accent" className="ml-auto shrink-0">
                                extension
                              </Tag>
                            )}
                          </span>
                          <span className="line-clamp-2 pl-6 text-[12px] leading-4 text-muted-foreground">
                            {option.description}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <form
                onSubmit={submit}
                className={cn(
                  'border border-border-strong bg-card p-2.5 focus-within:border-ring',
                  composerIsScrollable
                    ? 'grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-2.5'
                    : 'flex items-end gap-2.5',
                )}
              >
                <button
                  type="button"
                  className={cn(
                    'flex size-9 items-center justify-center text-muted-foreground hover:text-foreground',
                    composerIsScrollable && 'col-start-1 row-start-2',
                  )}
                  aria-label="Attach file"
                >
                  <Paperclip className="size-4" />
                </button>
                <ScrollArea
                  className={cn(
                    'min-h-11 min-w-0',
                    composerIsScrollable ? 'col-span-3 row-start-1 w-full' : 'flex-1',
                  )}
                  viewportClassName={cn('pr-3', composerIsScrollable && 'pl-[46px]')}
                  viewportRef={composerInputViewportRef}
                  style={{ height: composerInputHeight }}
                >
                  <textarea
                    {...messageRegistration}
                    ref={(element) => {
                      messageRegistration.ref(element)
                      composerTextareaRef.current = element
                    }}
                    onInput={(event) => {
                      const contentHeight = resizeTextarea(event.currentTarget)
                      setComposerInputHeight(Math.min(contentHeight, COMPOSER_MAX_HEIGHT))
                      setComposerIsScrollable(contentHeight > COMPOSER_MAX_HEIGHT)
                      window.requestAnimationFrame(() => {
                        const viewport = composerInputViewportRef.current
                        if (viewport) viewport.scrollTop = viewport.scrollHeight
                      })
                    }}
                    onKeyDown={(e) => {
                      if (slashCommandOptions.length > 0) {
                        if (e.key === 'ArrowDown') {
                          e.preventDefault()
                          setSlashSelection((value) => (value + 1) % slashCommandOptions.length)
                          return
                        }
                        if (e.key === 'ArrowUp') {
                          e.preventDefault()
                          setSlashSelection(
                            (value) =>
                              (value - 1 + slashCommandOptions.length) % slashCommandOptions.length,
                          )
                          return
                        }
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          executeSlashCommand(
                            slashCommandOptions[slashSelection] ?? slashCommandOptions[0],
                          )
                          return
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          form.setValue('message', '')
                          return
                        }
                      }
                      if (
                        e.key === 'Enter' &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing &&
                        e.keyCode !== 229
                      ) {
                        e.preventDefault()
                        if (
                          canSend &&
                          !isStartingRun &&
                          !isRunningRun &&
                          !abortingRun &&
                          !creatingSession
                        ) {
                          void submit()
                        }
                      }
                    }}
                    rows={1}
                    placeholder={
                      isRunningRun
                        ? 'Add guidance to the active run...'
                        : 'Reply to the agent...  (Enter to send, Shift+Enter for newline)'
                    }
                    className="block min-h-11 w-full resize-none overflow-hidden bg-transparent py-2 font-mono text-[13px] leading-6 text-foreground outline-none placeholder:text-muted-foreground/60"
                  />
                </ScrollArea>
                <button
                  type={isRunningRun ? 'button' : 'submit'}
                  onClick={canAbortRun ? abort : undefined}
                  disabled={
                    isRunningRun
                      ? !canAbortRun || abortingRun
                      : isStartingRun || creatingSession || !canSend
                  }
                  className={cn(
                    'flex h-9 items-center justify-center gap-1.5 border font-mono text-[11px] uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-70',
                    composerIsScrollable && 'col-start-3 row-start-2',
                    canAbortRun
                      ? 'border-destructive/70 bg-destructive/10 px-3 text-destructive hover:bg-destructive hover:text-destructive-foreground'
                      : isRunningRun
                        ? 'border-border bg-muted px-3 text-muted-foreground'
                        : 'border-accent bg-accent px-2.5 text-accent-foreground hover:opacity-90',
                  )}
                  aria-label={
                    canAbortRun ? 'Abort run' : isRunningRun ? 'Agent processing' : 'Send message'
                  }
                >
                  {abortingRun || isStartingRun || creatingSession ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : canAbortRun ? (
                    <Square className="size-3 fill-current" />
                  ) : isRunningRun ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : isNewSessionCommand ? (
                    <MessageSquarePlus className="size-3.5" />
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
                    className="border border-border-strong px-2.5 py-1 font-mono text-[10px] text-muted-foreground uppercase hover:border-accent hover:text-foreground disabled:opacity-50"
                  >
                    {queueingMessage === 'steer' ? 'Queueing…' : 'Steer now'}
                  </button>
                  <button
                    type="button"
                    disabled={!message.trim() || queueingMessage !== null}
                    onClick={() => void queueMessage('follow-up')}
                    className="border border-border-strong px-2.5 py-1 font-mono text-[10px] text-muted-foreground uppercase hover:border-accent hover:text-foreground disabled:opacity-50"
                  >
                    {queueingMessage === 'follow-up' ? 'Queueing…' : 'Follow up'}
                  </button>
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <label className="flex items-center gap-1.5">
                  <Cpu className="size-3 text-muted-foreground" />
                  <input type="hidden" {...form.register('providerId')} />
                  <input type="hidden" {...form.register('modelId')} />
                  <Select
                    disabled={availableModelOptions.length === 0 || isRunningRun}
                    value={
                      selectedModelOption
                        ? `${selectedModelOption.provider.id}::${selectedModelOption.model.id}`
                        : null
                    }
                    onValueChange={(value) => {
                      if (value === null) return
                      const next = availableModelOptions.find(
                        ({ provider, model: candidate }) =>
                          `${provider.id}::${candidate.id}` === value,
                      )
                      if (!next) return
                      form.setValue('providerId', next.provider.id, {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                      form.setValue('modelId', next.model.id, {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      className="h-6 max-w-[45vw] border-0 bg-transparent px-0 py-0 text-[11px] text-muted-foreground hover:text-foreground focus-visible:ring-0 sm:max-w-72"
                    >
                      <SelectValue>
                        {selectedModelOption
                          ? `${selectedModelOption.provider.name} / ${selectedModelOption.model.name ?? selectedModelOption.model.id}`
                          : 'No enabled models'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent
                      align="start"
                      alignItemWithTrigger={false}
                      className="w-max max-w-[calc(100vw-2rem)] min-w-(--anchor-width) sm:max-w-lg"
                    >
                      {availableModelOptions.map(({ provider, model: candidate }) => (
                        <SelectItem
                          key={`${provider.id}:${candidate.id}`}
                          value={`${provider.id}::${candidate.id}`}
                        >
                          {provider.name} / {candidate.name ?? candidate.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="flex items-center gap-1.5">
                  <Brain className="size-3 text-muted-foreground" />
                  <input type="hidden" {...form.register('thinkingLevel')} />
                  <Select
                    value={thinking}
                    onValueChange={(value) => {
                      if (
                        value !== null &&
                        thinkingLevels.includes(value as (typeof thinkingLevels)[number])
                      ) {
                        form.setValue('thinkingLevel', value as (typeof thinkingLevels)[number], {
                          shouldDirty: true,
                          shouldValidate: true,
                        })
                      }
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      className="h-6 max-w-[40vw] border-0 bg-transparent px-0 py-0 text-[11px] text-muted-foreground hover:text-foreground focus-visible:ring-0 sm:max-w-56"
                    >
                      <SelectValue>
                        {(value) => `thinking: ${String(value ?? thinking)}`}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent
                      align="start"
                      alignItemWithTrigger={false}
                      className="w-max max-w-[calc(100vw-2rem)] min-w-(--anchor-width) sm:max-w-sm"
                    >
                      {thinkingLevels.map((t) => (
                        <SelectItem key={t} value={t}>
                          thinking: {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <span className="ml-auto font-mono text-[11px] text-muted-foreground/60">
                  {activeSession.cwd}
                </span>
              </div>
            </div>
          </div>
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
          <div className="flex h-18 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
            <Label>Active context</Label>
            <button
              type="button"
              onClick={() => setShowActiveContext(false)}
              className="flex size-8 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Hide active context"
              aria-label="Hide active context"
            >
              <PanelRightClose className="size-4" />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
              <Panel>
                <PanelHeader>
                  <Label>Model</Label>
                </PanelHeader>
                <div className="space-y-2 p-3">
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
            <WorkspaceExplorer sessionId={activeSession.id} />
          </div>
        </aside>
      )}
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

function resizeTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return 44
  textarea.style.height = '0px'
  const contentHeight = Math.max(44, textarea.scrollHeight)
  textarea.style.height = `${contentHeight}px`
  return contentHeight
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
  const [open, setOpen] = useState(false)
  const toolCalls = messages.filter((message) => message.type === 'tool_call').length
  const toolResults = messages.filter((message) => message.type === 'tool_result').length
  const bashOutputs = messages.filter((message) => message.type === 'bash').length
  const thinking = messages.some((message) => message.type === 'thinking')
  const summary = [
    `${messages.length} messages`,
    toolCalls ? `${toolCalls} tool calls` : null,
    toolResults ? `${toolResults} results` : null,
    bashOutputs ? `${bashOutputs} outputs` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="group border border-border bg-panel/35"
    >
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
            <span className="font-mono text-[11px] text-muted-foreground uppercase">
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
      {open && (
        <div className="space-y-2 border-t border-border px-3 py-3">
          {messages.map((message) => (
            <ProcessMessageRow key={message.id} message={message} />
          ))}
        </div>
      )}
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
      <pre
        className={cn(
          'max-h-72 max-w-full overflow-x-hidden overflow-y-auto p-3 font-mono text-[11px] leading-relaxed wrap-break-word whitespace-pre-wrap',
          message.type === 'thinking' ? 'text-muted-foreground italic' : 'text-foreground/85',
        )}
      >
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

const MessageBubble = memo(function MessageBubble({
  message,
  agentName,
  streamStartedAt,
  mediaSessionId,
}: {
  message: ChatMessage
  agentName: string
  streamStartedAt?: number | null
  mediaSessionId?: string
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
          <div className="max-w-[85%] border border-border-strong bg-card px-3.5 py-2.5 text-sm leading-relaxed wrap-break-word text-foreground">
            {message.content}
          </div>
        </div>
      )
    case 'assistant': {
      const estimatedTokens = message.tokens ?? estimateTokens(message.content)
      const streamSeconds =
        streamStartedAt && message.timestamp === 'streaming'
          ? Math.max(1, Math.round((Date.now() - streamStartedAt) / 1000))
          : null
      return (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <Bot className="size-3 text-accent" />
            <Label>{agentName}</Label>
            <AssistantMessageMetrics
              usage={message.usage ?? null}
              fallbackTokens={message.tokens ?? estimatedTokens}
              estimated={message.timestamp === 'streaming' && !message.tokens}
              streamSeconds={streamSeconds}
              timestamp={message.timestamp !== 'streaming' ? message.timestamp : null}
            />
          </div>
          {message.timestamp === 'streaming' ? (
            <div className="border-l-2 border-accent/50 pl-3.5 text-sm leading-relaxed wrap-break-word whitespace-pre-wrap text-foreground">
              {message.content}
            </div>
          ) : (
            <MarkdownContent content={message.content} mediaSessionId={mediaSessionId} />
          )}
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
          <p className="border-t border-dashed border-border px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground italic">
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
          <pre className="bg-code max-w-full overflow-hidden p-3 font-mono text-[11px] leading-relaxed wrap-break-word whitespace-pre-wrap text-muted-foreground">
            {message.content}
          </pre>
        </Panel>
      )
    case 'bash':
      return (
        <div className="bg-code border border-border">
          <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5">
            <Terminal className="size-3 text-success" />
            <span className="font-mono text-[11px] text-muted-foreground">
              {message.title ?? 'bash'}
            </span>
          </div>
          <pre className="max-w-full overflow-hidden p-3 font-mono text-[11px] leading-relaxed wrap-break-word whitespace-pre-wrap text-foreground/90">
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
          <span className="font-mono text-[10px] tracking-wider text-muted-foreground/60 uppercase">
            {message.content}
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>
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
}: {
  usage: StreamUsage | null
  fallbackTokens: number
  estimated: boolean
  streamSeconds: number | null
  timestamp: string | null
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
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] text-muted-foreground/60">
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

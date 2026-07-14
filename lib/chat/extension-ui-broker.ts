import { randomUUID } from 'node:crypto'
import type {
  ExtensionUIDialogOptions,
  ExtensionUIContext,
  ExtensionWidgetOptions,
} from '@earendil-works/pi-coding-agent'

export type ExtensionUiInteractionType = 'select' | 'confirm' | 'input' | 'editor'

export interface ExtensionUiInteraction {
  id: string
  type: ExtensionUiInteractionType
  title: string
  message?: string
  options?: string[]
  placeholder?: string
  prefill?: string
  createdAt: string
  expiresAt: string
}

export interface ExtensionUiNotification {
  id: number
  message: string
  type: 'info' | 'warning' | 'error'
  createdAt: string
}

type PendingInteraction = ExtensionUiInteraction & {
  resolve: (value: unknown) => void
  timeout: ReturnType<typeof setTimeout>
  removeAbort?: () => void
}

class ExtensionUiBroker {
  private pending = new Map<string, PendingInteraction>()
  private notifications: ExtensionUiNotification[] = []
  private statuses = new Map<string, string>()
  private widgets = new Map<
    string,
    { content: string[]; placement: 'aboveEditor' | 'belowEditor' }
  >()
  private notificationSequence = 0
  private editorText = ''
  private editorRevision = 0
  private editorCommand: { revision: number; mode: 'set' | 'append'; text: string } | undefined
  private title: string | undefined
  private workingMessage: string | undefined
  private workingVisible = true
  private hiddenThinkingLabel: string | undefined
  private toolsExpanded = false

  constructor(readonly sessionId: string) {}

  private request(
    input: Omit<ExtensionUiInteraction, 'id' | 'createdAt' | 'expiresAt'>,
    options?: ExtensionUIDialogOptions,
  ) {
    const timeoutMs = Math.min(Math.max(options?.timeout ?? 5 * 60_000, 1_000), 30 * 60_000)
    return new Promise<unknown>((resolve) => {
      const id = randomUUID()
      const createdAt = new Date()
      const complete = (value: unknown) => {
        const pending = this.pending.get(id)
        if (!pending) return
        clearTimeout(pending.timeout)
        pending.removeAbort?.()
        this.pending.delete(id)
        resolve(value)
      }
      const timeout = setTimeout(
        () => complete(input.type === 'confirm' ? false : undefined),
        timeoutMs,
      )
      const interaction: PendingInteraction = {
        ...input,
        id,
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + timeoutMs).toISOString(),
        resolve: complete,
        timeout,
      }
      this.pending.set(id, interaction)
      if (options?.signal) {
        const abort = () => complete(input.type === 'confirm' ? false : undefined)
        options.signal.addEventListener('abort', abort, { once: true })
        interaction.removeAbort = () => options.signal?.removeEventListener('abort', abort)
        if (options.signal.aborted) abort()
      }
    })
  }

  readonly uiContext = {
    select: (title: string, options: string[], opts?: ExtensionUIDialogOptions) =>
      this.request({ type: 'select', title, options }, opts) as Promise<string | undefined>,
    confirm: (title: string, message: string, opts?: ExtensionUIDialogOptions) =>
      this.request({ type: 'confirm', title, message }, opts) as Promise<boolean>,
    input: (title: string, placeholder?: string, opts?: ExtensionUIDialogOptions) =>
      this.request({ type: 'input', title, placeholder }, opts) as Promise<string | undefined>,
    editor: (title: string, prefill?: string) =>
      this.request({ type: 'editor', title, prefill }) as Promise<string | undefined>,
    notify: (message: string, type: 'info' | 'warning' | 'error' = 'info') => {
      this.notificationSequence += 1
      this.notifications.push({
        id: this.notificationSequence,
        message,
        type,
        createdAt: new Date().toISOString(),
      })
      if (this.notifications.length > 100)
        this.notifications.splice(0, this.notifications.length - 100)
    },
    onTerminalInput: () => () => undefined,
    setStatus: (key: string, text: string | undefined) => {
      if (text === undefined) this.statuses.delete(key)
      else this.statuses.set(key, text)
    },
    setWorkingMessage: (message?: string) => {
      this.workingMessage = message
    },
    setWorkingVisible: (visible: boolean) => {
      this.workingVisible = visible
    },
    setWorkingIndicator: () => undefined,
    setHiddenThinkingLabel: (label?: string) => {
      this.hiddenThinkingLabel = label
    },
    setWidget: (
      key: string,
      content: string[] | ((...args: never[]) => unknown) | undefined,
      options?: ExtensionWidgetOptions,
    ) => {
      if (!content) this.widgets.delete(key)
      else if (Array.isArray(content)) {
        this.widgets.set(key, {
          content,
          placement: options?.placement ?? 'aboveEditor',
        })
      } else {
        this.uiContext.notify(
          `Widget "${key}" uses a TUI component and cannot render on the web.`,
          'warning',
        )
      }
    },
    setFooter: () => undefined,
    setHeader: () => undefined,
    setTitle: (title: string) => {
      this.title = title
    },
    custom: async <T>() => {
      this.uiContext.notify('This extension requested a TUI-only custom component.', 'warning')
      return undefined as T
    },
    pasteToEditor: (text: string) => {
      this.editorText += text
      this.editorRevision += 1
      this.editorCommand = { revision: this.editorRevision, mode: 'append', text }
    },
    setEditorText: (text: string) => {
      this.editorText = text
      this.editorRevision += 1
      this.editorCommand = { revision: this.editorRevision, mode: 'set', text }
    },
    getEditorText: () => this.editorText,
    addAutocompleteProvider: () => undefined,
    setEditorComponent: () => undefined,
    getEditorComponent: () => undefined,
    get theme() {
      return undefined as never
    },
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: 'Web sessions do not expose TUI themes.' }),
    getToolsExpanded: () => this.toolsExpanded,
    setToolsExpanded: (expanded: boolean) => {
      this.toolsExpanded = expanded
    },
  } as ExtensionUIContext

  snapshot(afterNotification = 0) {
    return {
      interactions: [...this.pending.values()].map(
        ({ resolve: _resolve, timeout: _timeout, removeAbort: _removeAbort, ...interaction }) =>
          interaction,
      ),
      notifications: this.notifications.filter(
        (notification) => notification.id > afterNotification,
      ),
      statuses: Object.fromEntries(this.statuses),
      widgets: [...this.widgets.entries()].map(([key, value]) => ({ key, ...value })),
      title: this.title,
      workingMessage: this.workingMessage,
      workingVisible: this.workingVisible,
      hiddenThinkingLabel: this.hiddenThinkingLabel,
      editorCommand: this.editorCommand,
    }
  }

  respond(interactionId: string, value: unknown, cancelled = false) {
    const interaction = this.pending.get(interactionId)
    if (!interaction) return false
    if (cancelled) interaction.resolve(interaction.type === 'confirm' ? false : undefined)
    else if (interaction.type === 'confirm') interaction.resolve(Boolean(value))
    else interaction.resolve(typeof value === 'string' ? value : undefined)
    return true
  }

  destroy() {
    for (const interaction of [...this.pending.values()]) {
      interaction.resolve(interaction.type === 'confirm' ? false : undefined)
    }
    this.pending.clear()
  }
}

declare global {
  var __piStudioExtensionUiBrokers: Map<string, ExtensionUiBroker> | undefined
}

function brokers() {
  globalThis.__piStudioExtensionUiBrokers ??= new Map()
  return globalThis.__piStudioExtensionUiBrokers
}

export function getOrCreateExtensionUiBroker(sessionId: string) {
  const existing = brokers().get(sessionId)
  if (existing) return existing
  const broker = new ExtensionUiBroker(sessionId)
  brokers().set(sessionId, broker)
  return broker
}

export function getExtensionUiBroker(sessionId: string) {
  return brokers().get(sessionId) ?? null
}

export function disposeExtensionUiBroker(sessionId: string) {
  const broker = brokers().get(sessionId)
  broker?.destroy()
  brokers().delete(sessionId)
}

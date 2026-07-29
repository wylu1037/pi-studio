'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckIcon as Check, XIcon as X } from '@phosphor-icons/react'
import { ActionButton, Label, Tag } from '@/components/pi-ui'
import { showToast } from '@/lib/toast'

type Interaction = {
  id: string
  type: 'select' | 'confirm' | 'input' | 'editor'
  title: string
  message?: string
  options?: string[]
  placeholder?: string
  prefill?: string
  expiresAt: string
}

export type ExtensionUiSnapshot = {
  interactions: Interaction[]
  notifications: Array<{
    id: number
    message: string
    type: 'info' | 'warning' | 'error'
  }>
  statuses: Record<string, string>
  widgets: Array<{
    key: string
    content: string[]
    placement: 'aboveEditor' | 'belowEditor'
  }>
  title?: string
  workingMessage?: string
  workingVisible: boolean
  hiddenThinkingLabel?: string
  editorCommand?: { revision: number; mode: 'set' | 'append'; text: string }
}

// The snapshot now arrives via the session event stream (see chat-view's
// EventSource `extension_ui` handler) instead of a 900ms poll, so this host is
// a pure renderer: it applies one-shot side-effects (toast notifications, editor
// commands) as the pushed snapshot changes and locally clears an interaction it
// just answered so the modal closes without waiting for the next push.
export function ExtensionUiHost({
  sessionId,
  snapshot,
  onEditorText,
}: {
  sessionId: string
  snapshot: ExtensionUiSnapshot | null
  onEditorText?: (text: string, mode: 'set' | 'append') => void
}) {
  const [responding, setResponding] = useState(false)
  const [answeredInteractionIds, setAnsweredInteractionIds] = useState<Set<string>>(
    () => new Set(),
  )
  const latestNotification = useRef(0)
  const latestEditorRevision = useRef(0)

  // Reset the one-shot cursors when the session changes: notification ids and
  // editor revisions restart per session, so a stale cursor would swallow the
  // new session's first notification/editor command.
  useEffect(() => {
    latestNotification.current = 0
    latestEditorRevision.current = 0
    setAnsweredInteractionIds(new Set())
  }, [sessionId])

  // Surface newly arrived notifications exactly once. The pushed snapshot always
  // carries the broker's full (capped) notification list, so we gate on the
  // monotonic id cursor rather than the array contents.
  useEffect(() => {
    if (!snapshot) return
    for (const notification of snapshot.notifications) {
      if (notification.id <= latestNotification.current) continue
      latestNotification.current = notification.id
      showToast({ tone: notification.type, title: 'Extension', message: notification.message })
    }
  }, [snapshot])

  // Apply an editor command once, gated on its monotonic revision.
  useEffect(() => {
    const command = snapshot?.editorCommand
    if (!command || command.revision <= latestEditorRevision.current) return
    latestEditorRevision.current = command.revision
    onEditorText?.(command.text, command.mode)
  }, [snapshot, onEditorText])

  const interaction = snapshot?.interactions.find((item) => !answeredInteractionIds.has(item.id))
  const statuses = Object.entries(snapshot?.statuses ?? {})
  const widgets = snapshot?.widgets ?? []

  const respond = async (value: unknown, cancelled = false) => {
    if (!interaction) return
    setResponding(true)
    try {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/extensions/ui/respond`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ interactionId: interaction.id, value, cancelled }),
        },
      )
      if (!response.ok) throw new Error('The extension interaction is no longer active.')
      // Locally mark this interaction answered so the modal closes immediately;
      // the next pushed snapshot (broker deletes the pending interaction on
      // respond) will drop it from the list for good.
      setAnsweredInteractionIds((current) => {
        const next = new Set(current)
        next.add(interaction.id)
        return next
      })
    } catch (error) {
      showToast({
        tone: 'error',
        title: 'Extension interaction',
        message: error instanceof Error ? error.message : 'Unable to answer extension interaction.',
      })
    } finally {
      setResponding(false)
    }
  }

  return (
    <>
      {(statuses.length > 0 || widgets.length > 0) && (
        <div className="mb-2 space-y-2 border border-border bg-panel px-3 py-2">
          {statuses.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Label>Extensions</Label>
              {statuses.map(([key, value]) => (
                <Tag key={key} tone="outline">
                  {key}: {value}
                </Tag>
              ))}
            </div>
          )}
          {widgets.map((widget) => (
            <div key={widget.key} className="border-t border-border pt-2 first:border-0 first:pt-0">
              <p className="font-mono text-[10px] text-muted-foreground">{widget.key}</p>
              {widget.content.map((line, index) => (
                <p
                  key={`${widget.key}:${index}`}
                  className="mt-0.5 font-mono text-[11px] whitespace-pre-wrap text-foreground"
                >
                  {line}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}
      {interaction && typeof document !== 'undefined'
        ? createPortal(
            <ExtensionInteractionModal
              interaction={interaction}
              responding={responding}
              onRespond={respond}
            />,
            document.body,
          )
        : null}
    </>
  )
}

function ExtensionInteractionModal({
  interaction,
  responding,
  onRespond,
}: {
  interaction: Interaction
  responding: boolean
  onRespond: (value: unknown, cancelled?: boolean) => Promise<void>
}) {
  const [value, setValue] = useState(interaction.prefill ?? '')
  const secondsRemaining = Math.max(
    0,
    Math.ceil((new Date(interaction.expiresAt).getTime() - Date.now()) / 1000),
  )
  return (
    <div className="fixed inset-0 z-80 flex items-center justify-center bg-foreground/25 p-4">
      <div className="w-full max-w-lg border border-border-strong bg-card shadow-[0_28px_80px_rgba(40,35,28,0.24)]">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <Label>Extension request</Label>
            <h2 className="mt-1 font-mono text-sm text-foreground">{interaction.title}</h2>
          </div>
          <button
            type="button"
            onClick={() => void onRespond(undefined, true)}
            disabled={responding}
            className="p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Cancel extension interaction"
          >
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3 p-5">
          {interaction.message && (
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">
              {interaction.message}
            </p>
          )}
          {interaction.type === 'select' && (
            <div className="space-y-1.5">
              {interaction.options?.map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={responding}
                  onClick={() => void onRespond(option)}
                  className="flex w-full items-center justify-between border border-border bg-panel px-3 py-2.5 text-left font-mono text-xs transition-colors hover:border-accent hover:bg-accent/8 active:translate-y-px"
                >
                  <span>{option}</span>
                  <Check size={14} className="text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
          {(interaction.type === 'input' || interaction.type === 'editor') &&
            (interaction.type === 'editor' ? (
              <textarea
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={interaction.placeholder}
                className="min-h-52 w-full resize-y border border-input bg-panel p-3 font-mono text-xs text-foreground outline-none focus:border-ring"
                autoFocus
              />
            ) : (
              <input
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={interaction.placeholder}
                className="w-full border border-input bg-panel px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-ring"
                autoFocus
              />
            ))}
        </div>
        <div className="flex items-center gap-2 border-t border-border bg-panel px-5 py-3">
          <span className="font-mono text-[10px] text-muted-foreground">
            Expires in {secondsRemaining}s
          </span>
          <ActionButton
            className="ml-auto"
            disabled={responding}
            onClick={() => void onRespond(undefined, true)}
          >
            Cancel
          </ActionButton>
          {interaction.type === 'confirm' && (
            <>
              <ActionButton disabled={responding} onClick={() => void onRespond(false)}>
                Deny
              </ActionButton>
              <ActionButton
                disabled={responding}
                variant="accent"
                onClick={() => void onRespond(true)}
              >
                Confirm
              </ActionButton>
            </>
          )}
          {(interaction.type === 'input' || interaction.type === 'editor') && (
            <ActionButton
              disabled={responding}
              variant="accent"
              onClick={() => void onRespond(value)}
            >
              Submit
            </ActionButton>
          )}
        </div>
      </div>
    </div>
  )
}

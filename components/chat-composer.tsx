'use client'

import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { Popover } from '@base-ui/react/popover'
import { Slider } from '@base-ui/react/slider'
import {
  Brain,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Eraser,
  File,
  FileCode2,
  FileImage,
  FileText,
  LoaderCircle,
  MessageSquarePlus,
  Paperclip,
  RefreshCw,
  Send,
  Square,
  Terminal,
  X,
} from 'lucide-react'
import { Label, Tag } from '@/components/pi-ui'
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from '@/components/ui/attachment'
import { Button } from '@/components/ui/button'
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { DraftAttachment } from '@/components/use-chat-attachments'
import { ImageAttachmentPreview, isImageAttachment } from '@/components/image-attachment-preview'
import type { GlobalModel, GlobalModelProvider, GlobalPromptTemplate } from '@/lib/types'
import { cn } from '@/lib/utils'

export const thinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
const codexThinkingLevels = ['low', 'medium', 'high', 'xhigh', 'max'] as const
const reasoningEffortLevels = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export const COMPOSER_MAX_HEIGHT = 176

/** Ordered reasoning levels offered for a selection, matching the model
 *  dropdown: Codex-family models expose low..max; every other reasoning model
 *  additionally leads with its current level so 'off'/'minimal' stay
 *  selectable. Shared by the dropdown and the Shift+Tab keyboard cycle so the
 *  two always stay in sync. */
function reasoningLevelsFor(
  thinking: (typeof thinkingLevels)[number],
): readonly (typeof thinkingLevels)[number][] {
  return codexThinkingLevels.includes(thinking as (typeof codexThinkingLevels)[number])
    ? codexThinkingLevels
    : [thinking, ...codexThinkingLevels]
}

// Shared by every icon button on the composer's action row so they keep one
// footprint and only light up on hover.
const composerIconButtonClass =
  'flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 active:scale-[0.98]'

export type ComposerValues = {
  message: string
  thinkingLevel?: (typeof thinkingLevels)[number]
  modelId?: string
  providerId?: string
}

export type ComposerModelOption = {
  provider: GlobalModelProvider
  model: GlobalModel
}

export type SlashCommandOption =
  | {
      kind: 'builtin'
      id: 'new-session' | 'clear-session' | 'next-session' | 'prev-session'
      command: 'new-session' | 'clear-session' | 'next-session' | 'prev-session'
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

export function ChatComposer({
  form,
  containerRef,
  message,
  thinking,
  selectedModelOption,
  availableModelOptions,
  activeSessionCwd,
  contextWindow,
  contextUsedTokens,
  attachments,
  slashCommandOptions,
  slashSelection,
  onSlashSelectionChange,
  onExecuteSlashCommand,
  onFilesSelected,
  onRemoveAttachment,
  onRetryAttachment,
  onSubmit,
  onAbort,
  onQueueMessage,
  isRunningRun,
  canQueueMessage,
  canAbortRun,
  isStartingRun,
  abortingRun,
  creatingSession,
  clearingSession,
  queueingMessage,
  canSend,
  sendButtonLabel,
}: {
  form: UseFormReturn<ComposerValues>
  containerRef: Ref<HTMLDivElement>
  message: string
  thinking: (typeof thinkingLevels)[number]
  selectedModelOption?: ComposerModelOption
  availableModelOptions: ComposerModelOption[]
  activeSessionCwd: string
  contextWindow?: number
  contextUsedTokens?: number
  attachments: DraftAttachment[]
  slashCommandOptions: SlashCommandOption[]
  slashSelection: number
  onSlashSelectionChange: (value: number | ((current: number) => number)) => void
  onExecuteSlashCommand: (option: SlashCommandOption) => void
  onFilesSelected: (files: FileList | File[]) => void
  onRemoveAttachment: (attachmentId: string) => void
  onRetryAttachment: (attachmentId: string) => void
  onSubmit: () => void
  onAbort: () => void
  onQueueMessage: (behavior: 'steer' | 'follow-up') => void
  isRunningRun: boolean
  canQueueMessage: boolean
  canAbortRun: boolean
  isStartingRun: boolean
  abortingRun: boolean
  creatingSession: boolean
  clearingSession: boolean
  queueingMessage: 'steer' | 'follow-up' | null
  canSend: boolean
  sendButtonLabel: string
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const messageRegistration = form.register('message')
  const hasQueueableContent = message.trim().length > 0 || attachments.length > 0
  const supportsReasoning = selectedModelOption?.model.reasoning ?? false
  const queueActionsDisabled =
    !canQueueMessage || !hasQueueableContent || queueingMessage !== null || abortingRun

  useEffect(() => {
    resizeTextarea(textareaRef.current)
  }, [message])

  const addDroppedFiles = (event: DragEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsDraggingFiles(false)
    if (event.dataTransfer.files.length > 0) onFilesSelected(event.dataTransfer.files)
  }

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Tab' && event.shiftKey) {
      // Shift+Tab cycles the selected model's reasoning intensity through the
      // same ordered levels the dropdown offers. Only reasoning-capable models
      // respond; otherwise the key keeps its default focus-moving behavior.
      if (selectedModelOption?.model.reasoning) {
        event.preventDefault()
        const levels = reasoningLevelsFor(thinking)
        const currentIndex = levels.indexOf(thinking)
        const next = levels[(currentIndex + 1) % levels.length]
        form.setValue('thinkingLevel', next, { shouldDirty: true, shouldValidate: true })
      }
      return
    }
    if (slashCommandOptions.length > 0 && !isRunningRun) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        onSlashSelectionChange((value) => (value + 1) % slashCommandOptions.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        onSlashSelectionChange(
          (value) => (value - 1 + slashCommandOptions.length) % slashCommandOptions.length,
        )
        return
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        if (creatingSession || clearingSession) return
        onExecuteSlashCommand(slashCommandOptions[slashSelection] ?? slashCommandOptions[0])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        form.setValue('message', '')
        return
      }
    }
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      event.keyCode !== 229
    ) {
      event.preventDefault()
      if (isRunningRun) {
        if (!queueActionsDisabled) {
          onQueueMessage(event.altKey ? 'follow-up' : 'steer')
        }
        return
      }
      if (canSend && !isStartingRun && !abortingRun && !creatingSession && !clearingSession) {
        onSubmit()
      }
    }
  }

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-x-0 bottom-0 px-5 xl:pr-14"
    >
      <div className="pointer-events-auto relative mx-auto w-full max-w-3xl bg-background/95 pt-2 pb-1.5 shadow-[0_-16px_32px_-28px_rgba(24,28,36,0.45)]">
        {slashCommandOptions.length > 0 && !isRunningRun && (
          <SlashCommandMenu
            options={slashCommandOptions}
            selectedIndex={slashSelection}
            disabled={isRunningRun || creatingSession || clearingSession}
            onSelect={onExecuteSlashCommand}
          />
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit()
          }}
          onDragEnter={(event) => {
            if (event.dataTransfer.types.includes('Files')) setIsDraggingFiles(true)
          }}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes('Files')) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setIsDraggingFiles(false)
            }
          }}
          onDrop={addDroppedFiles}
          className={cn(
            'relative rounded-xl border border-border-strong bg-card transition-colors focus-within:border-ring',
            isDraggingFiles && 'border-accent bg-accent/5',
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            tabIndex={-1}
            className="sr-only"
            onChange={(event) => {
              if (event.target.files) onFilesSelected(event.target.files)
              event.target.value = ''
            }}
          />

          {attachments.length > 0 && (
            <Carousel opts={{ align: 'start' }} className="mx-3 mt-3">
              <CarouselContent className="-ml-2">
                {attachments.map((attachment) => (
                  <CarouselItem key={attachment.id} className="basis-auto pl-2">
                    <Attachment state={attachment.state} size="xs" className="rounded-panel">
                      <AttachmentMedia
                        variant={
                          isImageAttachment(attachment.file.name, attachment.file.type)
                            ? 'image'
                            : 'icon'
                        }
                        className="rounded-panel-inner"
                      >
                        {isImageAttachment(attachment.file.name, attachment.file.type) ? (
                          <ImageAttachmentPreview
                            file={attachment.file}
                            alt={attachment.file.name}
                            className="size-full"
                          />
                        ) : (
                          attachmentIcon(attachment.file)
                        )}
                      </AttachmentMedia>
                      <AttachmentContent>
                        <AttachmentTitle title={attachment.file.name}>
                          {attachment.file.name}
                        </AttachmentTitle>
                        <AttachmentDescription title={attachment.error}>
                          {attachmentStatus(attachment)}
                        </AttachmentDescription>
                      </AttachmentContent>
                      <AttachmentActions>
                        {attachment.state === 'error' && (
                          <AttachmentAction
                            type="button"
                            aria-label={`Retry ${attachment.file.name}`}
                            title="Retry upload"
                            onClick={() => onRetryAttachment(attachment.id)}
                          >
                            <RefreshCw />
                          </AttachmentAction>
                        )}
                        <AttachmentAction
                          type="button"
                          aria-label={`Remove ${attachment.file.name}`}
                          title="Remove attachment"
                          onClick={() => onRemoveAttachment(attachment.id)}
                        >
                          <X />
                        </AttachmentAction>
                      </AttachmentActions>
                    </Attachment>
                  </CarouselItem>
                ))}
              </CarouselContent>
              <CarouselPrevious
                type="button"
                aria-label="Previous attachments"
                className="left-1 rounded-panel bg-background/90 shadow-sm disabled:pointer-events-none disabled:opacity-0"
              />
              <CarouselNext
                type="button"
                aria-label="Next attachments"
                className="right-1 rounded-panel bg-background/90 shadow-sm disabled:pointer-events-none disabled:opacity-0"
              />
            </Carousel>
          )}

          <textarea
            {...messageRegistration}
            aria-label="Message"
            aria-keyshortcuts="Shift+Tab"
            ref={(element) => {
              messageRegistration.ref(element)
              textareaRef.current = element
            }}
            onInput={(event) => resizeTextarea(event.currentTarget)}
            onKeyDown={handleComposerKeyDown}
            onPaste={(event) => {
              if (event.clipboardData.files.length === 0) return
              event.preventDefault()
              onFilesSelected(event.clipboardData.files)
            }}
            rows={1}
            wrap="soft"
            placeholder={
              isRunningRun
                ? 'Add guidance to the active run…'
                : 'Ask anything, or paste / attach files…'
            }
            className="block min-h-14 w-full resize-none overflow-y-auto bg-transparent px-3 py-3 font-mono text-[13px] leading-6 whitespace-pre-wrap text-foreground outline-none placeholder:text-muted-foreground/55"
          />

          <div className="flex min-w-0 items-center gap-1.5 px-2.5 pb-2.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={composerIconButtonClass}
              aria-label="Attach files"
              title="Attach files"
            >
              <Paperclip className="size-4" strokeWidth={1.75} />
            </button>
            <ReasoningControl form={form} thinking={thinking} selected={selectedModelOption} />
            {contextWindow ? (
              <ContextMeter contextWindow={contextWindow} usedTokens={contextUsedTokens ?? 0} />
            ) : null}
            <input type="hidden" {...form.register('providerId')} />
            <input type="hidden" {...form.register('modelId')} />
            <input type="hidden" {...form.register('thinkingLevel')} />
            {isRunningRun ? (
              <div className="ml-auto flex min-w-0 items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={queueActionsDisabled}
                  onClick={() => onQueueMessage('follow-up')}
                  className="h-8 font-mono text-[10px] uppercase"
                  aria-label="Queue a follow-up after the active run"
                  aria-keyshortcuts="Alt+Enter"
                  title={
                    canQueueMessage
                      ? 'Run after the current task finishes (Option/Alt + Enter)'
                      : 'Available once the agent session starts'
                  }
                >
                  {queueingMessage === 'follow-up' ? 'Queueing…' : 'Follow up'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={queueActionsDisabled}
                  onClick={() => onQueueMessage('steer')}
                  className="h-8 border-accent bg-accent font-mono text-[10px] text-accent-foreground uppercase hover:bg-accent/90"
                  aria-label="Steer the active run now"
                  aria-keyshortcuts="Enter"
                  title={
                    canQueueMessage
                      ? 'Adjust the active run after its current tool call (Enter)'
                      : 'Available once the agent session starts'
                  }
                >
                  {queueingMessage === 'steer' ? 'Queueing…' : 'Steer now'}
                </Button>
              </div>
            ) : (
              <div className="ml-auto min-w-0">
                <ModelConfigurationMenu
                  form={form}
                  options={availableModelOptions}
                  selected={selectedModelOption}
                  thinking={thinking}
                  disabled={availableModelOptions.length === 0}
                />
              </div>
            )}
            <button
              type={isRunningRun ? 'button' : 'submit'}
              onClick={canAbortRun ? onAbort : undefined}
              disabled={
                isRunningRun
                  ? !canAbortRun || abortingRun
                  : isStartingRun || creatingSession || clearingSession || !canSend
              }
              className={cn(
                'flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-panel border font-mono text-[10px] uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                canAbortRun
                  ? 'border-destructive/70 bg-destructive/10 px-2.5 text-destructive hover:bg-destructive hover:text-destructive-foreground'
                  : isRunningRun
                    ? 'border-border bg-muted px-2.5 text-muted-foreground'
                    : 'border-accent bg-accent px-2.5 text-accent-foreground hover:opacity-90',
              )}
              aria-label={
                canAbortRun ? 'Abort run' : isRunningRun ? 'Agent processing' : sendButtonLabel
              }
            >
              {abortingRun || isStartingRun || creatingSession || clearingSession ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : canAbortRun ? (
                <Square className="size-3 fill-current" />
              ) : isRunningRun ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : message.trim().toLowerCase() === '/new-session' ? (
                <MessageSquarePlus className="size-3.5" />
              ) : message.trim().toLowerCase() === '/clear-session' ? (
                <Eraser className="size-3.5" />
              ) : message.trim().toLowerCase() === '/next-session' ? (
                <ChevronDown className="size-3.5" />
              ) : message.trim().toLowerCase() === '/prev-session' ? (
                <ChevronUp className="size-3.5" />
              ) : (
                <Send className="size-3.5" />
              )}
              <span className="hidden sm:inline">{sendButtonLabel}</span>
            </button>
          </div>

          {isDraggingFiles && (
            <div className="pointer-events-none absolute inset-1 flex items-center justify-center rounded-panel border border-dashed border-accent bg-card/94 font-mono text-[11px] text-accent uppercase">
              Drop files to attach
            </div>
          )}
        </form>

        {/* Metadata row. While a run holds the button slot, the model dropdown is
            swapped out for Steer/Follow up — so the active model rides here
            instead, keeping it visible exactly when it cannot be changed. The
            right side also surfaces the Shift+Tab reasoning shortcut. */}
        <div className="mt-1.5 flex min-w-0 items-baseline gap-3 px-1">
          <span
            className="min-w-0 truncate font-mono text-[10px] text-muted-foreground/45"
            title={activeSessionCwd}
          >
            {activeSessionCwd}
          </span>
          <span className="ml-auto flex min-w-0 shrink-0 items-baseline gap-3">
            {supportsReasoning ? (
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground/50">
                Shift+Tab · reasoning
              </span>
            ) : null}
            {isRunningRun ? (
              <span
                className="min-w-0 truncate font-mono text-[10px] text-muted-foreground/60"
                title={modelSummaryLabel(selectedModelOption, thinking)}
              >
                {modelSummaryLabel(selectedModelOption, thinking)}
              </span>
            ) : null}
          </span>
        </div>
      </div>
    </div>
  )
}

function ModelConfigurationMenu({
  form,
  options,
  selected,
  thinking,
  disabled,
}: {
  form: UseFormReturn<ComposerValues>
  options: ComposerModelOption[]
  selected?: ComposerModelOption
  thinking: (typeof thinkingLevels)[number]
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const [showModels, setShowModels] = useState(false)
  const selectedModelValue = selected ? `${selected.provider.id}::${selected.model.id}` : ''
  const visibleThinkingLevels = reasoningLevelsFor(thinking)

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) setShowModels(false)
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange} disabled={disabled}>
      <DropdownMenuTrigger
        disabled={disabled}
        className="flex h-8 max-w-72 min-w-0 items-center gap-1.5 rounded-lg px-2 text-left text-[11px] text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-45"
        aria-label="Configure model and reasoning"
        title="Configure model and reasoning"
      >
        <span className="truncate">{modelSummaryLabel(selected, thinking)}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72 max-w-[calc(100vw-2rem)]" align="start" side="top">
        <DropdownMenuGroup className="p-0.5">
          <DropdownMenuLabel>Reasoning</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={thinking}
            onValueChange={(nextValue) => {
              if (!thinkingLevels.includes(nextValue as (typeof thinkingLevels)[number])) return
              form.setValue('thinkingLevel', nextValue as (typeof thinkingLevels)[number], {
                shouldDirty: true,
                shouldValidate: true,
              })
              setOpen(false)
            }}
            className="flex flex-col gap-0.5"
          >
            {visibleThinkingLevels.map((thinkingLevel) => (
              <DropdownMenuRadioItem key={thinkingLevel} value={thinkingLevel} closeOnClick={false}>
                {reasoningLabel(thinkingLevel)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="mx-1.5" />
        <DropdownMenuGroup className="p-0.5">
          <DropdownMenuItem
            closeOnClick={false}
            onClick={() => setShowModels((value) => !value)}
            className="text-foreground"
          >
            <span className="min-w-0 flex-1 truncate">
              {selected?.model.name ?? selected?.model.id ?? 'Choose model'}
            </span>
            {showModels ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" />
            )}
          </DropdownMenuItem>
          {showModels && (
            <>
              <DropdownMenuLabel>Model</DropdownMenuLabel>
              <ScrollArea
                className="max-h-64"
                viewportClassName="pr-2"
                style={{ height: Math.min(options.length * 38, 256) }}
              >
                <DropdownMenuRadioGroup
                  value={selectedModelValue}
                  onValueChange={(nextValue) => {
                    const next = options.find(
                      ({ provider, model }) => `${provider.id}::${model.id}` === nextValue,
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
                    setOpen(false)
                  }}
                  className="flex flex-col gap-0.5"
                >
                  {options.map(({ provider, model }) => (
                    <DropdownMenuRadioItem
                      key={`${provider.id}:${model.id}`}
                      value={`${provider.id}::${model.id}`}
                      closeOnClick={false}
                    >
                      <span className="min-w-0 flex-1 truncate">{model.name ?? model.id}</span>
                      <span className="mr-3 max-w-20 truncate text-[11px] font-normal text-muted-foreground">
                        {provider.name}
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </ScrollArea>
            </>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The composer's one-line model summary, shared by the dropdown trigger and
 *  the metadata row that stands in for it while a run occupies the button slot. */
function modelSummaryLabel(
  selected: ComposerModelOption | undefined,
  thinking: (typeof thinkingLevels)[number],
) {
  if (!selected) return 'No models'
  return `${selected.provider.name} · ${selected.model.name ?? selected.model.id} · ${reasoningLabel(thinking)}`
}

function reasoningLabel(level: (typeof thinkingLevels)[number]) {
  const labels: Record<(typeof thinkingLevels)[number], string> = {
    off: 'Off',
    minimal: 'Minimal',
    low: 'Light',
    medium: 'Medium',
    high: 'High',
    xhigh: 'Extra High',
    max: 'Ultra',
  }
  return labels[level]
}

// Square icon button beside the attach control (mirrors Claude Code's composer):
// opens a popover with a thinking on/off switch and a discrete effort slider.
// Both write the shared `thinkingLevel` form field, so the model dropdown and
// hidden input stay in sync.
function ReasoningControl({
  form,
  thinking,
  selected,
}: {
  form: UseFormReturn<ComposerValues>
  thinking: (typeof thinkingLevels)[number]
  selected?: ComposerModelOption
}) {
  const supportsReasoning = selected?.model.reasoning ?? false
  const reasoningOn = supportsReasoning && thinking !== 'off'
  const [lastActiveLevel, setLastActiveLevel] = useState<(typeof reasoningEffortLevels)[number]>(
    thinking !== 'off' ? thinking : 'medium',
  )

  useEffect(() => {
    if (thinking !== 'off') setLastActiveLevel(thinking)
  }, [thinking])

  const setLevel = (level: (typeof thinkingLevels)[number]) => {
    form.setValue('thinkingLevel', level, { shouldDirty: true, shouldValidate: true })
  }

  const effortLevel = thinking !== 'off' ? thinking : lastActiveLevel

  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label="Reasoning settings"
        title={
          supportsReasoning
            ? `Reasoning: ${reasoningLabel(thinking)} · Shift+Tab to cycle`
            : 'This model is not marked as a reasoning model'
        }
        className={composerIconButtonClass}
      >
        <Brain className="size-4" strokeWidth={1.75} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" sideOffset={8} align="start" className="z-50">
          <Popover.Popup className="w-72 origin-(--transform-origin) rounded-xl border border-border-strong bg-popover p-1 text-popover-foreground shadow-xl duration-150 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <div className="flex min-h-9 items-center justify-between gap-3 rounded-lg px-2.5 py-1.5">
              <span className="text-[13px] font-medium text-foreground">Thinking</span>
              <Switch
                checked={reasoningOn}
                onCheckedChange={(checked) => setLevel(checked ? lastActiveLevel : 'off')}
                disabled={!supportsReasoning}
                aria-label="Toggle thinking"
                className="rounded-full border-transparent bg-border-strong/70 data-checked:border-transparent data-checked:bg-accent"
                thumbClassName="rounded-full shadow-sm"
              />
            </div>
            <div
              className={cn(
                'flex min-h-9 items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 transition-opacity',
                !reasoningOn && 'opacity-45',
              )}
            >
              <span className="text-[13px] font-medium whitespace-nowrap text-foreground">
                Effort{' '}
                <span className="text-muted-foreground">({reasoningLabel(effortLevel)})</span>
              </span>
              <EffortSlider
                level={effortLevel}
                disabled={!reasoningOn}
                onLevelChange={(level) => setLevel(level)}
              />
            </div>
            {!supportsReasoning && (
              <p className="mx-1 border-t border-border/60 px-1.5 pt-1.5 pb-1 text-[11px] leading-4 text-muted-foreground">
                {selected
                  ? `${selected.model.name ?? selected.model.id} is not marked as a reasoning model, so thinking stays off.`
                  : 'Select a model to configure reasoning.'}
              </p>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

// Discrete effort track styled after the Switch: a filled capsule with a dot per
// level and a thumb that snaps between positions, where the visible knob is
// smaller than its positioning box so it keeps an even rim on all sides — like
// the switch thumb, which never touches the track edges. The thumb *box* equals
// the track height (h-4.5 = 18px) and is `edge`-aligned, so at the extremes the
// box sits flush against the capsule ends; the visible knob (12px) is centered
// inside that box, leaving a 3px rim all around (including the right side at
// `max`, which the full-width blue fill shows through). Snap positions land at
// `boxRadius + (100% - box) * ratio`, which the fill and dots both use.
const EFFORT_BOX_SIZE = 18
const EFFORT_KNOB_SIZE = 12

function EffortSlider({
  level,
  disabled,
  onLevelChange,
}: {
  level: (typeof reasoningEffortLevels)[number]
  disabled: boolean
  onLevelChange: (level: (typeof reasoningEffortLevels)[number]) => void
}) {
  const lastIndex = reasoningEffortLevels.length - 1
  const index = Math.max(0, reasoningEffortLevels.indexOf(level))

  return (
    <Slider.Root
      value={index}
      min={0}
      max={lastIndex}
      step={1}
      largeStep={1}
      disabled={disabled}
      thumbAlignment="edge-client-only"
      onValueChange={(value) => {
        const next = reasoningEffortLevels[Array.isArray(value) ? value[0] : value]
        if (next) onLevelChange(next)
      }}
      aria-label="Reasoning effort"
      className="shrink-0"
    >
      <Slider.Control className="flex h-4.5 w-28 touch-none items-center rounded-full bg-border-strong/60 select-none data-disabled:bg-border-strong/40">
        <Slider.Track className="group/track h-full w-full">
          {/* Fill the full track height (a rounded capsule) and extend it to the
              thumb-box's right edge, so the blue wraps all the way around the
              knob — the left fill continues past the knob to its right rim, not
              just to its center. Width = box + (100% - box) * ratio, so at `max`
              (ratio 1) the fill spans the whole track (blue rounded end) and at
              `minimal` (ratio 0) it's just the box-sized cap around the knob. */}
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-y-0 left-0 rounded-full',
              // Smoothly grow/shrink when the level snaps to a new stop. Killed
              // mid-drag (data-dragging on the track) so the fill tracks the
              // pointer 1:1, and disabled under prefers-reduced-motion.
              'transition-[width] duration-200 ease-out group-data-dragging/track:transition-none motion-reduce:transition-none',
              disabled ? 'bg-border-strong/70' : 'bg-accent',
            )}
            style={{
              width: `calc(${EFFORT_BOX_SIZE}px + (100% - ${EFFORT_BOX_SIZE}px) * ${index / lastIndex})`,
            }}
          />
          {reasoningEffortLevels.map((tick, tickIndex) => (
            <span
              key={tick}
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full',
                disabled
                  ? 'bg-foreground/25'
                  : tickIndex <= index
                    ? 'bg-accent-foreground/50'
                    : 'bg-foreground/25',
              )}
              style={{
                left: `calc(${EFFORT_BOX_SIZE / 2}px + (100% - ${EFFORT_BOX_SIZE}px) * ${tickIndex / lastIndex})`,
              }}
            />
          ))}
          {/* Thumb box equals the track height for edge alignment; the visible
              knob is smaller and centered, leaving an even rim on all sides. */}
          <Slider.Thumb
            className="flex items-center justify-center outline-none select-none [transition:inset-inline-start_200ms_ease-out] group-data-dragging/track:transition-none has-focus-visible:rounded-full has-focus-visible:ring-2 has-focus-visible:ring-ring/60 motion-reduce:transition-none"
            style={{ width: EFFORT_BOX_SIZE, height: EFFORT_BOX_SIZE }}
          >
            <span
              className="rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35),0_0_0_0.5px_rgba(0,0,0,0.08)]"
              style={{ width: EFFORT_KNOB_SIZE, height: EFFORT_KNOB_SIZE }}
            />
          </Slider.Thumb>
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  )
}

function SlashCommandMenu({
  options,
  selectedIndex,
  disabled,
  onSelect,
}: {
  options: SlashCommandOption[]
  selectedIndex: number
  disabled: boolean
  onSelect: (option: SlashCommandOption) => void
}) {
  return (
    <div className="absolute inset-x-0 bottom-full mb-2 overflow-hidden border border-border-strong bg-card shadow-xl">
      <div className="flex items-center justify-between border-b border-border bg-panel px-4 py-2.5">
        <Label>Slash commands</Label>
        <span className="font-mono text-[10px] text-muted-foreground">
          {options.length} available
        </span>
      </div>
      <ul className="max-h-64 scrollbar-thin overflow-auto py-1">
        {options.map((option, index) => (
          <li key={`${option.kind}:${option.id}`}>
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(option)}
              disabled={option.kind === 'builtin' && disabled}
              className={cn(
                'flex w-full flex-col gap-1 border-l-2 border-transparent px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45',
                index === selectedIndex ? 'border-l-accent bg-accent/10' : 'hover:bg-muted/70',
              )}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                {option.kind === 'builtin' ? (
                  option.command === 'clear-session' ? (
                    <Eraser className="size-3.5 shrink-0 text-accent" />
                  ) : option.command === 'next-session' ? (
                    <ChevronDown className="size-3.5 shrink-0 text-accent" />
                  ) : option.command === 'prev-session' ? (
                    <ChevronUp className="size-3.5 shrink-0 text-accent" />
                  ) : (
                    <MessageSquarePlus className="size-3.5 shrink-0 text-accent" />
                  )
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
              </span>
              <span className="line-clamp-2 pl-6 text-[12px] leading-4 text-muted-foreground">
                {option.description}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function resizeTextarea(element: HTMLTextAreaElement | null) {
  if (!element) return
  element.style.height = '0px'
  element.style.height = `${Math.min(Math.max(element.scrollHeight, 56), COMPOSER_MAX_HEIGHT)}px`
  element.style.overflowY = element.scrollHeight > COMPOSER_MAX_HEIGHT ? 'auto' : 'hidden'
}

function attachmentIcon(file: File) {
  if (file.type.startsWith('image/')) return <FileImage />
  if (/\.(?:md|txt|rtf|pdf|docx?)$/i.test(file.name)) return <FileText />
  if (/\.(?:[cm]?[jt]sx?|py|rb|rs|go|java|kt|swift|css|scss|html|json|ya?ml)$/i.test(file.name)) {
    return <FileCode2 />
  }
  return <File />
}

function attachmentStatus(attachment: DraftAttachment) {
  if (attachment.state === 'uploading') return `Uploading · ${formatFileSize(attachment.file.size)}`
  if (attachment.state === 'error') return attachment.error ?? 'Upload failed'
  if (attachment.state === 'done') return `Attached · ${formatFileSize(attachment.file.size)}`
  return `Ready · ${formatFileSize(attachment.file.size)}`
}

export function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

function formatCompactTokens(value: number) {
  if (value < 1000) return String(value)
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}M`
}

// A hollow ring that depletes as the context window fills, like a fuel gauge:
// the arc length is the remaining fraction, so a fuller ring means more room
// left. It warms from accent → warning → destructive as headroom runs out.
// Hover reveals the exact used / remaining / window breakdown.
const CONTEXT_RING_CIRCUMFERENCE = 2 * Math.PI * 8

function ContextMeter({
  contextWindow,
  usedTokens,
}: {
  contextWindow: number
  usedTokens: number
}) {
  const clampedUsed = Math.min(Math.max(usedTokens, 0), contextWindow)
  const remainingTokens = contextWindow - clampedUsed
  const remainingFraction = contextWindow > 0 ? remainingTokens / contextWindow : 0
  const remainingPercent = Math.round(remainingFraction * 100)
  const usedPercent = 100 - remainingPercent
  const severity = remainingPercent <= 8 ? 'critical' : remainingPercent <= 20 ? 'low' : 'ok'
  const strokeClass =
    severity === 'critical'
      ? 'stroke-destructive'
      : severity === 'low'
        ? 'stroke-warning'
        : 'stroke-accent'

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={`Context: ${remainingPercent}% remaining (${remainingTokens.toLocaleString()} of ${contextWindow.toLocaleString()} tokens)`}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          />
        }
      >
        <svg viewBox="0 0 20 20" className="size-4 -rotate-90" aria-hidden="true">
          <circle
            cx="10"
            cy="10"
            r="8"
            fill="none"
            strokeWidth="3"
            className="stroke-border-strong/45"
          />
          <circle
            cx="10"
            cy="10"
            r="8"
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            className={cn('transition-[stroke-dashoffset,stroke] duration-500', strokeClass)}
            strokeDasharray={CONTEXT_RING_CIRCUMFERENCE}
            strokeDashoffset={CONTEXT_RING_CIRCUMFERENCE * (1 - remainingFraction)}
          />
        </svg>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={8}
        hideArrow
        className="block w-56 rounded-xl border border-border bg-card p-0 text-foreground shadow-xl"
      >
        <div className="flex flex-col gap-2.5 p-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-[10px] tracking-wide text-muted-foreground/70 uppercase">
              Context
            </span>
            <span className="font-mono text-xs text-foreground">{usedPercent}% used</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-border-strong/40">
            <div
              className={cn(
                'h-full rounded-full transition-[width]',
                severity === 'critical'
                  ? 'bg-destructive'
                  : severity === 'low'
                    ? 'bg-warning'
                    : 'bg-accent',
              )}
              style={{ width: `${Math.min(100, usedPercent)}%` }}
            />
          </div>
          <dl className="flex flex-col gap-1 font-mono text-[11px]">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Used</dt>
              <dd className="text-foreground">{clampedUsed.toLocaleString()}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Remaining</dt>
              <dd className="text-foreground">{remainingTokens.toLocaleString()}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-1">
              <dt className="text-muted-foreground">Window</dt>
              <dd className="text-foreground">{formatCompactTokens(contextWindow)}</dd>
            </div>
          </dl>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

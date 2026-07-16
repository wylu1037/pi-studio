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
import {
  Brain,
  Cpu,
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
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from '@/components/ui/attachment'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { DraftAttachment } from '@/components/use-chat-attachments'
import type { GlobalModel, GlobalModelProvider, GlobalPromptTemplate } from '@/lib/types'
import { cn } from '@/lib/utils'

export const thinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export const COMPOSER_MAX_HEIGHT = 176

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

export function ChatComposer({
  form,
  containerRef,
  extensionUi,
  message,
  thinking,
  selectedModelOption,
  availableModelOptions,
  activeSessionCwd,
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
  canAbortRun,
  isStartingRun,
  abortingRun,
  creatingSession,
  queueingMessage,
  canSend,
  sendButtonLabel,
}: {
  form: UseFormReturn<ComposerValues>
  containerRef: Ref<HTMLDivElement>
  extensionUi?: ReactNode
  message: string
  thinking: (typeof thinkingLevels)[number]
  selectedModelOption?: ComposerModelOption
  availableModelOptions: ComposerModelOption[]
  activeSessionCwd: string
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
  canAbortRun: boolean
  isStartingRun: boolean
  abortingRun: boolean
  creatingSession: boolean
  queueingMessage: 'steer' | 'follow-up' | null
  canSend: boolean
  sendButtonLabel: string
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const messageRegistration = form.register('message')

  useEffect(() => {
    resizeTextarea(textareaRef.current)
  }, [message])

  const addDroppedFiles = (event: DragEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsDraggingFiles(false)
    if (event.dataTransfer.files.length > 0) onFilesSelected(event.dataTransfer.files)
  }

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashCommandOptions.length > 0) {
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
      if (canSend && !isStartingRun && !isRunningRun && !abortingRun && !creatingSession) {
        onSubmit()
      }
    }
  }

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-x-0 bottom-0 px-5 pb-4">
      <div className="pointer-events-auto relative mx-auto max-w-3xl bg-background/95 px-2 pt-2 shadow-[0_-16px_32px_-28px_rgba(24,28,36,0.45)]">
        {extensionUi}
        {slashCommandOptions.length > 0 && (
          <SlashCommandMenu
            options={slashCommandOptions}
            selectedIndex={slashSelection}
            disabled={isRunningRun || creatingSession}
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
            'relative border border-border-strong bg-card transition-colors focus-within:border-ring',
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
            <AttachmentGroup className="px-3 pt-3">
              {attachments.map((attachment) => (
                <Attachment
                  key={attachment.id}
                  state={attachment.state}
                  size="xs"
                  className="rounded-none"
                >
                  <AttachmentMedia className="rounded-none">
                    {attachmentIcon(attachment.file)}
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
              ))}
            </AttachmentGroup>
          )}

          <textarea
            {...messageRegistration}
            aria-label="Message"
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
            placeholder={
              isRunningRun
                ? 'Add guidance to the active run…'
                : 'Ask anything, or paste / attach files…'
            }
            className="block min-h-14 w-full resize-none overflow-y-auto bg-transparent px-3 py-3 font-mono text-[13px] leading-6 text-foreground outline-none placeholder:text-muted-foreground/55"
          />

          <div className="flex min-w-0 items-center gap-1.5 px-2.5 pb-2.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex size-8 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Attach files"
              title="Attach files"
            >
              <Paperclip className="size-4" />
            </button>
            <input type="hidden" {...form.register('providerId')} />
            <input type="hidden" {...form.register('modelId')} />
            <ModelSelect
              form={form}
              options={availableModelOptions}
              selected={selectedModelOption}
              disabled={availableModelOptions.length === 0 || isRunningRun}
            />
            <input type="hidden" {...form.register('thinkingLevel')} />
            <ThinkingSelect form={form} value={thinking} />
            <span
              className="ml-auto hidden max-w-44 truncate font-mono text-[10px] text-muted-foreground/45 lg:block"
              title={activeSessionCwd}
            >
              {activeSessionCwd}
            </span>
            <button
              type={isRunningRun ? 'button' : 'submit'}
              onClick={canAbortRun ? onAbort : undefined}
              disabled={
                isRunningRun
                  ? !canAbortRun || abortingRun
                  : isStartingRun || creatingSession || !canSend
              }
              className={cn(
                'ml-1 flex h-8 shrink-0 items-center justify-center gap-1.5 border font-mono text-[10px] uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                canAbortRun
                  ? 'border-destructive/70 bg-destructive/10 px-2.5 text-destructive hover:bg-destructive hover:text-destructive-foreground'
                  : isRunningRun
                    ? 'border-border bg-muted px-2.5 text-muted-foreground'
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
              ) : message.trim().toLowerCase() === '/new-session' ? (
                <MessageSquarePlus className="size-3.5" />
              ) : (
                <Send className="size-3.5" />
              )}
              <span className="hidden sm:inline">{sendButtonLabel}</span>
            </button>
          </div>

          {isDraggingFiles && (
            <div className="pointer-events-none absolute inset-1 flex items-center justify-center border border-dashed border-accent bg-card/94 font-mono text-[11px] text-accent uppercase">
              Drop files to attach
            </div>
          )}
        </form>

        {isRunningRun && (
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              disabled={(!message.trim() && attachments.length === 0) || queueingMessage !== null}
              onClick={() => onQueueMessage('steer')}
              className="border border-border-strong px-2.5 py-1 font-mono text-[10px] text-muted-foreground uppercase hover:border-accent hover:text-foreground disabled:opacity-50"
            >
              {queueingMessage === 'steer' ? 'Queueing…' : 'Steer now'}
            </button>
            <button
              type="button"
              disabled={(!message.trim() && attachments.length === 0) || queueingMessage !== null}
              onClick={() => onQueueMessage('follow-up')}
              className="border border-border-strong px-2.5 py-1 font-mono text-[10px] text-muted-foreground uppercase hover:border-accent hover:text-foreground disabled:opacity-50"
            >
              {queueingMessage === 'follow-up' ? 'Queueing…' : 'Follow up'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function ModelSelect({
  form,
  options,
  selected,
  disabled,
}: {
  form: UseFormReturn<ComposerValues>
  options: ComposerModelOption[]
  selected?: ComposerModelOption
  disabled: boolean
}) {
  return (
    <label className="flex min-w-0 items-center gap-1.5">
      <Cpu className="size-3 shrink-0 text-muted-foreground" />
      <Select
        disabled={disabled}
        value={selected ? `${selected.provider.id}::${selected.model.id}` : null}
        onValueChange={(value) => {
          if (value === null) return
          const next = options.find(
            ({ provider, model }) => `${provider.id}::${model.id}` === value,
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
          className="h-7 max-w-36 border-0 bg-transparent px-0 py-0 text-[10px] text-muted-foreground hover:text-foreground focus-visible:ring-0 sm:max-w-64"
        >
          <SelectValue>
            {selected
              ? `${selected.provider.name} / ${selected.model.name ?? selected.model.id}`
              : 'No models'}
          </SelectValue>
        </SelectTrigger>
        <SelectContent
          align="start"
          alignItemWithTrigger={false}
          className="w-max max-w-[calc(100vw-2rem)] min-w-(--anchor-width) sm:max-w-lg"
        >
          {options.map(({ provider, model }) => (
            <SelectItem key={`${provider.id}:${model.id}`} value={`${provider.id}::${model.id}`}>
              {provider.name} / {model.name ?? model.id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}

function ThinkingSelect({
  form,
  value,
}: {
  form: UseFormReturn<ComposerValues>
  value: (typeof thinkingLevels)[number]
}) {
  return (
    <label className="flex items-center gap-1.5">
      <Brain className="size-3 shrink-0 text-muted-foreground" />
      <Select
        value={value}
        onValueChange={(nextValue) => {
          if (
            nextValue !== null &&
            thinkingLevels.includes(nextValue as (typeof thinkingLevels)[number])
          ) {
            form.setValue('thinkingLevel', nextValue as (typeof thinkingLevels)[number], {
              shouldDirty: true,
              shouldValidate: true,
            })
          }
        }}
      >
        <SelectTrigger
          size="sm"
          className="h-7 max-w-28 border-0 bg-transparent px-0 py-0 text-[10px] text-muted-foreground hover:text-foreground focus-visible:ring-0"
        >
          <SelectValue>
            {(selectedValue) => `thinking: ${String(selectedValue ?? value)}`}
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false} className="w-max">
          {thinkingLevels.map((level) => (
            <SelectItem key={level} value={level}>
              thinking: {level}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
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
      <ul className="scrollbar-thin max-h-64 overflow-auto py-1">
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

'use client'

import { useEffect, useState, type ElementType } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import {
  DownloadSimple,
  Eye,
  FileC,
  FileCode,
  FileCpp,
  FileCss,
  FileHtml,
  FileJs,
  FileJsx,
  FilePy,
  FileRs,
  FileSql,
  FileTs,
  FileTsx,
  FileVue,
  X,
} from '@phosphor-icons/react'

import { CodeBlock } from '@/components/code-block'
import { ExcelFileLogo, PdfFileLogo, WordFileLogo } from '@/components/file-type-logos'
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
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { useSidebarOffset } from '@/hooks/use-sidebar-offset'

export type PreviewFileKind =
  | 'pdf'
  | 'word'
  | 'excel'
  | 'javascript'
  | 'jsx'
  | 'typescript'
  | 'tsx'
  | 'python'
  | 'shell'
  | 'html'
  | 'css'
  | 'go'
  | 'rust'
  | 'c'
  | 'cpp'
  | 'sql'
  | 'vue'
  | 'java'
  | 'csharp'
  | 'php'
  | 'ruby'
  | 'swift'
  | 'kotlin'
  | 'script'

type FileKindConfig = {
  category: 'document' | 'script'
  icon: ElementType
  language?: string
  label: string
}

const fileKindConfig: Record<PreviewFileKind, FileKindConfig> = {
  pdf: { category: 'document', icon: PdfFileLogo, label: 'PDF' },
  word: { category: 'document', icon: WordFileLogo, label: 'Word' },
  excel: { category: 'document', icon: ExcelFileLogo, label: 'Excel' },
  javascript: { category: 'script', icon: FileJs, label: 'JavaScript', language: 'javascript' },
  jsx: { category: 'script', icon: FileJsx, label: 'JSX', language: 'jsx' },
  typescript: { category: 'script', icon: FileTs, label: 'TypeScript', language: 'typescript' },
  tsx: { category: 'script', icon: FileTsx, label: 'TSX', language: 'tsx' },
  python: { category: 'script', icon: FilePy, label: 'Python', language: 'python' },
  shell: { category: 'script', icon: FileCode, label: 'Shell', language: 'bash' },
  html: { category: 'script', icon: FileHtml, label: 'HTML', language: 'html' },
  css: { category: 'script', icon: FileCss, label: 'Stylesheet', language: 'css' },
  go: { category: 'script', icon: FileCode, label: 'Go', language: 'go' },
  rust: { category: 'script', icon: FileRs, label: 'Rust', language: 'rust' },
  c: { category: 'script', icon: FileC, label: 'C', language: 'c' },
  cpp: { category: 'script', icon: FileCpp, label: 'C++', language: 'cpp' },
  sql: { category: 'script', icon: FileSql, label: 'SQL', language: 'sql' },
  vue: { category: 'script', icon: FileVue, label: 'Vue', language: 'html' },
  java: { category: 'script', icon: FileCode, label: 'Java', language: 'java' },
  csharp: { category: 'script', icon: FileCode, label: 'C#', language: 'csharp' },
  php: { category: 'script', icon: FileCode, label: 'PHP', language: 'php' },
  ruby: { category: 'script', icon: FileCode, label: 'Ruby', language: 'ruby' },
  swift: { category: 'script', icon: FileCode, label: 'Swift', language: 'swift' },
  kotlin: { category: 'script', icon: FileCode, label: 'Kotlin', language: 'kotlin' },
  script: { category: 'script', icon: FileCode, label: 'Script', language: 'text' },
}

const SCRIPT_PREVIEW_BYTES = 1024 * 1024
const FILE_CARD_ICON_CLASS_NAME = '!size-9 rounded-none bg-transparent ring-0'

type ScriptPreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; content: string; truncated: boolean }
  | { status: 'error'; message: string }

export function FilePreviewCard({
  href,
  label,
  kind,
}: {
  href: string
  label: string
  kind: PreviewFileKind
}) {
  const [open, setOpen] = useState(false)
  const [scriptPreview, setScriptPreview] = useState<ScriptPreviewState>({ status: 'idle' })
  const config = fileKindConfig[kind]
  const Icon = config.icon
  const isScript = config.category === 'script'
  const sidebarOffset = useSidebarOffset(open)

  useEffect(() => {
    if (!open || !isScript) return

    const controller = new AbortController()
    setScriptPreview({ status: 'loading' })
    void fetch(href, {
      cache: 'no-store',
      headers: { Range: `bytes=0-${SCRIPT_PREVIEW_BYTES - 1}` },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Unable to load file (${response.status}).`)
        const contentRange = response.headers.get('content-range')
        const rangeMatch = contentRange?.match(/bytes \d+-\d+\/(\d+)/)
        const totalBytes = rangeMatch ? Number(rangeMatch[1]) : null
        const content = await response.text()
        setScriptPreview({
          status: 'ready',
          content,
          truncated: totalBytes !== null && totalBytes > SCRIPT_PREVIEW_BYTES,
        })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setScriptPreview({
          status: 'error',
          message: error instanceof Error ? error.message : 'Unable to load this file.',
        })
      })

    return () => controller.abort()
  }, [href, isScript, open])

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <AttachmentGroup className="my-2 max-w-lg overflow-visible">
        <Attachment size="sm" className="w-full max-w-lg bg-card">
          <AttachmentMedia data-file-kind={kind} className={FILE_CARD_ICON_CLASS_NAME}>
            <Icon className="!size-9" weight="duotone" />
          </AttachmentMedia>
          <AttachmentContent>
            <button
              type="button"
              className="min-w-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setOpen(true)}
              aria-label={`Preview ${label}`}
            >
              <AttachmentTitle>{label}</AttachmentTitle>
              <AttachmentDescription>
                {config.label} {isScript ? 'source file' : 'document'}
              </AttachmentDescription>
            </button>
          </AttachmentContent>
          <AttachmentActions>
            <AttachmentAction
              type="button"
              aria-label={`Preview ${label}`}
              title="Preview"
              onClick={() => setOpen(true)}
            >
              <Eye />
            </AttachmentAction>
            <AttachmentAction
              render={<a href={href} download={label} aria-label={`Download ${label}`} />}
              title="Download"
            >
              <DownloadSimple />
            </AttachmentAction>
          </AttachmentActions>
        </Attachment>
      </AttachmentGroup>

      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-background/80 backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <Dialog.Viewport
          className="fixed inset-y-0 right-0 flex min-h-dvh items-center justify-center p-4 sm:p-8"
          style={{ left: sidebarOffset }}
        >
          <Dialog.Popup className="flex h-[min(86dvh,60rem)] w-[min(94vw,72rem)] flex-col overflow-hidden rounded-xl border border-border-strong bg-card shadow-2xl outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <header className="flex min-w-0 items-center gap-3 border-b border-border px-3 py-2.5">
              <Icon className="size-4 shrink-0 text-accent" weight="duotone" aria-hidden="true" />
              <Dialog.Title className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                {label}
              </Dialog.Title>
              <Button
                render={<a href={href} download={label} aria-label={`Download ${label}`} />}
                variant="ghost"
                size="icon-sm"
                title="Download"
              >
                <DownloadSimple />
              </Button>
              <Dialog.Close
                render={
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Close preview" />
                }
              >
                <X />
              </Dialog.Close>
            </header>

            {kind === 'pdf' ? (
              <iframe
                className="min-h-0 flex-1 bg-muted"
                src={href}
                title={`Preview of ${label}`}
              />
            ) : isScript ? (
              <ScriptPreview state={scriptPreview} language={config.language} />
            ) : (
              <Empty className="rounded-none">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Icon weight="duotone" />
                  </EmptyMedia>
                  <EmptyTitle>Preview is not available for this format yet.</EmptyTitle>
                  <EmptyDescription>
                    Download the {config.label} document and open it with your preferred desktop
                    application.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button render={<a href={href} download={label} />} variant="outline">
                    <DownloadSimple data-icon="inline-start" />
                    Download file
                  </Button>
                </EmptyContent>
              </Empty>
            )}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ScriptPreview({ language, state }: { language?: string; state: ScriptPreviewState }) {
  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <div
        className="flex min-h-0 flex-1 flex-col gap-2 bg-muted/30 p-3"
        aria-label="Loading file preview"
      >
        <Skeleton className="h-7 w-full" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-3 w-3/5" />
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <Empty className="rounded-none">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileCode weight="duotone" />
          </EmptyMedia>
          <EmptyTitle>Unable to load this script.</EmptyTitle>
          <EmptyDescription>{state.message}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  if (state.status !== 'ready') return null

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-muted/30 p-3">
      {state.truncated ? (
        <p className="mb-2 font-mono text-[10px] text-muted-foreground">
          Showing the first 1 MB of this file.
        </p>
      ) : null}
      <CodeBlock code={state.content} language={language} />
    </div>
  )
}

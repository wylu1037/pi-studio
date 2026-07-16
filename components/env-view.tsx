'use client'

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { FileKey2, Pencil, Plus, Save, Search, ShieldAlert, Trash2, X } from 'lucide-react'
import {
  ActionButton,
  ConfirmDialog,
  Label,
  PageHeader,
  Panel,
  Tag,
  TextInput,
} from '@/components/pi-ui'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

const MANAGED_FILES_KEY = 'pi-studio:environment:managed-files'

type EnvFilePayload = {
  path: string
  content: string
  exists: boolean
  byteSize: number
  updatedAt: string | null
}

type ManagedEnvFile = Omit<EnvFilePayload, 'content'> & {
  variableCount: number
}

export function EnvView({ defaultPath }: { defaultPath: string }) {
  const [files, setFiles] = useState<ManagedEnvFile[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [adding, setAdding] = useState(false)
  const [path, setPath] = useState(defaultPath)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<ManagedEnvFile | null>(null)
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [pending, setPending] = useState<'add' | 'open' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<ManagedEnvFile | null>(null)

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(MANAGED_FILES_KEY) ?? '[]') as unknown
      if (Array.isArray(stored)) {
        setFiles(stored.filter(isManagedEnvFile))
      }
    } catch {
      setFiles([])
    } finally {
      setHydrated(true)
    }
  }, [])

  const dirty = editing !== null && content !== savedContent
  const byteSize = useMemo(() => new TextEncoder().encode(content).length, [content])
  const variableCount = useMemo(() => countVariables(content), [content])
  const filteredFiles = files.filter((file) =>
    file.path.toLowerCase().includes(query.trim().toLowerCase()),
  )

  const persistFiles = (next: ManagedEnvFile[]) => {
    setFiles(next)
    localStorage.setItem(MANAGED_FILES_KEY, JSON.stringify(next))
  }

  const upsertFile = (file: ManagedEnvFile) => {
    const next = [file, ...files.filter((item) => item.path !== file.path)]
    persistFiles(next)
  }

  const requestFile = async (requestedPath: string) => {
    const response = await fetch(`/api/env-file?path=${encodeURIComponent(requestedPath)}`)
    const body = (await response.json()) as EnvFilePayload | { error?: string }
    if (!response.ok || !('content' in body)) {
      throw new Error('error' in body && body.error ? body.error : 'Unable to open file.')
    }
    return body
  }

  const addFile = async () => {
    if (!path.trim()) return
    setPending('add')
    setError(null)
    try {
      const body = await requestFile(path)
      const file = toManagedFile(body)
      upsertFile(file)
      setPath(defaultPath)
      setAdding(false)
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : 'Unable to add file.')
    } finally {
      setPending(null)
    }
  }

  const editFile = async (file: ManagedEnvFile) => {
    setEditing(file)
    setContent('')
    setSavedContent('')
    setPending('open')
    setError(null)
    try {
      const body = await requestFile(file.path)
      const refreshed = toManagedFile(body)
      upsertFile(refreshed)
      setEditing(refreshed)
      setContent(body.content)
      setSavedContent(body.content)
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'Unable to open file.')
    } finally {
      setPending(null)
    }
  }

  const saveFile = async () => {
    if (!editing) return
    setPending('save')
    setError(null)
    try {
      const response = await fetch('/api/env-file', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: editing.path, content }),
      })
      const body = (await response.json()) as
        { path: string; exists: boolean; byteSize: number; updatedAt: string } | { error?: string }
      if (!response.ok || !('path' in body)) {
        throw new Error('error' in body && body.error ? body.error : 'Unable to save file.')
      }
      const saved = { ...body, variableCount }
      setEditing(saved)
      setSavedContent(content)
      upsertFile(saved)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save file.')
    } finally {
      setPending(null)
    }
  }

  const closeEditor = (discard = false) => {
    if (dirty && !discard) {
      setError('Save or discard the current changes before returning to the file list.')
      return
    }
    setEditing(null)
    setContent('')
    setSavedContent('')
    setError(null)
  }

  const removeFile = () => {
    if (!removeTarget) return
    persistFiles(files.filter((file) => file.path !== removeTarget.path))
    setRemoveTarget(null)
  }

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      if (dirty && pending === null) void saveFile()
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Environment"
        subtitle="Manage .env files by path and edit them in place. File contents stay at their original locations."
      >
        <ActionButton
          variant="accent"
          onClick={() => {
            setError(null)
            setAdding(true)
          }}
          disabled={adding || Boolean(editing)}
        >
          <Plus className="size-3.5" />
          Add file
        </ActionButton>
      </PageHeader>

      <div className="scrollbar-thin flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="min-w-0 space-y-3">
          <Panel className="overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-border bg-panel px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <FileKey2 className="size-3.5 text-accent" />
                <Label>Managed files</Label>
                <span className="font-mono text-[10px] text-muted-foreground">{files.length}</span>
              </div>
              <TextInput
                value={query}
                onChange={setQuery}
                placeholder="Filter paths…"
                icon={<Search className="size-3.5" />}
                className="w-full sm:w-56"
              />
            </div>

            {!hydrated ? (
              <div className="min-h-64 animate-pulse bg-muted/70" aria-label="Loading files" />
            ) : files.length === 0 ? (
              <EnvFilesEmptyState
                onAdd={() => {
                  setError(null)
                  setAdding(true)
                }}
              />
            ) : filteredFiles.length === 0 ? (
              <p className="px-4 py-16 text-center font-mono text-[11px] text-muted-foreground">
                No paths match this filter
              </p>
            ) : (
              <>
                <div className="hidden grid-cols-[minmax(0,1fr)_90px_100px_112px] gap-4 border-b border-border px-4 py-2 sm:grid">
                  <Label>File path</Label>
                  <Label>Variables</Label>
                  <Label>Status</Label>
                  <Label className="text-right">Actions</Label>
                </div>
                <ul className="divide-y divide-border">
                  {filteredFiles.map((file) => (
                    <li
                      key={file.path}
                      className="grid gap-3 px-4 py-3 hover:bg-panel/50 sm:grid-cols-[minmax(0,1fr)_90px_100px_112px] sm:items-center sm:gap-4"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-mono text-[13px] text-foreground">
                          {fileName(file.path)}
                        </p>
                        <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                          {file.path}
                        </p>
                        <p className="mt-1 font-mono text-[10px] text-muted-foreground sm:hidden">
                          {file.variableCount} variables · {formatBytes(file.byteSize)}
                        </p>
                      </div>
                      <span className="hidden font-mono text-[12px] text-foreground sm:block">
                        {file.variableCount}
                      </span>
                      <div>
                        <Tag tone={file.exists ? 'success' : 'warning'}>
                          {file.exists ? 'existing' : 'new'}
                        </Tag>
                      </div>
                      <div className="flex items-center justify-end gap-1">
                        <ActionButton
                          variant="ghost"
                          title="Edit file"
                          onClick={() => void editFile(file)}
                          disabled={pending !== null}
                        >
                          <Pencil className="size-3.5" />
                        </ActionButton>
                        <ActionButton
                          variant="ghost"
                          title="Remove from list"
                          onClick={() => setRemoveTarget(file)}
                        >
                          <Trash2 className="size-3.5" />
                        </ActionButton>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>
          <div className="flex items-center gap-2 text-muted-foreground">
            <ShieldAlert className="size-3.5 shrink-0" />
            <p className="font-mono text-[10px] leading-relaxed">
              Only file paths are saved locally. Environment values remain in the .env file.
            </p>
          </div>
        </div>
      </div>

      {adding && (
        <AddEnvFileDialog
          path={path}
          pending={pending === 'add'}
          error={error}
          onPathChange={(value) => {
            setPath(value)
            setError(null)
          }}
          onAdd={() => void addFile()}
          onClose={() => {
            if (pending === null) {
              setAdding(false)
              setError(null)
            }
          }}
        />
      )}

      {editing && (
        <EnvFileDrawer
          file={editing}
          content={content}
          dirty={dirty}
          byteSize={byteSize}
          variableCount={variableCount}
          pending={pending}
          error={error}
          onContentChange={(value) => {
            setContent(value)
            setError(null)
          }}
          onKeyDown={handleEditorKeyDown}
          onSave={() => void saveFile()}
          onClose={() => {
            if (pending === null) closeEditor(false)
          }}
          onDiscard={() => closeEditor(true)}
        />
      )}

      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Remove environment file"
        description={`Remove "${removeTarget?.path ?? ''}" from this list? The file on disk will not be deleted.`}
        confirmLabel="Remove from list"
        onCancel={() => setRemoveTarget(null)}
        onConfirm={removeFile}
      />
    </div>
  )
}

function EnvFileDrawer({
  file,
  content,
  dirty,
  byteSize,
  variableCount,
  pending,
  error,
  onContentChange,
  onKeyDown,
  onSave,
  onClose,
  onDiscard,
}: {
  file: ManagedEnvFile
  content: string
  dirty: boolean
  byteSize: number
  variableCount: number
  pending: 'add' | 'open' | 'save' | null
  error: string | null
  onContentChange: (value: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onSave: () => void
  onClose: () => void
  onDiscard: () => void
}) {
  const gutterRef = useRef<HTMLPreElement>(null)
  const lineNumbers = useMemo(
    () => Array.from({ length: Math.max(1, content.split('\n').length) }, (_, index) => index + 1),
    [content],
  )

  useEffect(() => {
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && pending === null) onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose, pending])

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close environment file editor"
        onClick={onClose}
        className="absolute inset-0 animate-in bg-foreground/20 backdrop-blur-[1px] duration-200 fade-in"
      />
      <aside className="relative flex h-full w-full max-w-190 animate-in flex-col border-l border-border bg-panel shadow-[-24px_0_64px_-36px_rgba(0,0,0,0.45)] duration-300 slide-in-from-right sm:w-[min(760px,94vw)]">
        <div className="flex items-start justify-between gap-4 border-b border-border bg-card px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center border border-border-strong bg-panel text-accent">
              <FileKey2 className="size-4" />
            </span>
            <div className="min-w-0">
              <Label>Environment file</Label>
              <h2
                title={file.path}
                className="mt-0.5 truncate font-mono text-[12px] font-normal text-muted-foreground"
              >
                {file.path}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending !== null}
            className="p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
            aria-label="Close editor"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 divide-x divide-border border-b border-border bg-card">
          <div className="px-5 py-2.5">
            <Label className="block">Status</Label>
            <div className="mt-1">
              <Tag tone={file.exists ? 'success' : 'warning'}>
                {file.exists ? 'existing' : 'new'}
              </Tag>
            </div>
          </div>
          <div className="px-5 py-2.5">
            <Label className="block">Variables</Label>
            <span className="mt-1 block font-mono text-[12px] text-foreground">
              {variableCount}
            </span>
          </div>
          <div className="px-5 py-2.5">
            <Label className="block">File size</Label>
            <span className="mt-1 block font-mono text-[12px] text-foreground">
              {formatBytes(byteSize)}
            </span>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label className="block">File content</Label>
              <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                Plain text · values are stored exactly as written
              </p>
            </div>
            {dirty ? <Tag tone="accent">unsaved changes</Tag> : <Tag tone="outline">saved</Tag>}
          </div>

          {error && (
            <div className="border border-destructive/30 bg-destructive/5 px-3 py-2.5">
              <p className="font-mono text-[11px] leading-relaxed text-destructive">{error}</p>
            </div>
          )}

          <div className="bg-code flex min-h-0 flex-1 flex-col overflow-hidden border border-border-strong">
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-muted/60 px-3">
              <div className="flex items-center gap-2">
                <span className="size-1.5 bg-success" />
                <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                  dotenv
                </span>
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">
                {lineNumbers.length} lines
              </span>
            </div>

            {pending === 'open' ? (
              <div
                className="min-h-0 flex-1 animate-pulse bg-muted/70"
                aria-label="Loading environment file"
              />
            ) : (
              <div className="flex min-h-0 flex-1 overflow-hidden">
                <pre
                  ref={gutterRef}
                  aria-hidden="true"
                  className="w-12 shrink-0 overflow-hidden border-r border-border bg-muted/35 py-3 pr-3 text-right font-mono text-[11px] leading-6 text-muted-foreground/45 select-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  {lineNumbers.join('\n')}
                </pre>
                <textarea
                  value={content}
                  onChange={(event) => onContentChange(event.target.value)}
                  onKeyDown={onKeyDown}
                  onScroll={(event) => {
                    if (gutterRef.current)
                      gutterRef.current.scrollTop = event.currentTarget.scrollTop
                  }}
                  wrap="off"
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  aria-label="Environment file content"
                  className="scrollbar-thin min-h-0 min-w-0 flex-1 resize-none overflow-auto bg-transparent px-3 py-3 font-mono text-[12px] leading-6 whitespace-pre text-foreground outline-none [tab-size:2] placeholder:text-muted-foreground/50"
                  placeholder="# Add environment variables here\nSERVICE_API_KEY=..."
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-border bg-card px-5 py-3.5">
          <div>
            <span className="font-mono text-[10px] text-muted-foreground">
              {file.updatedAt
                ? `Last saved ${new Date(file.updatedAt).toLocaleString()}`
                : 'Not saved yet'}
            </span>
            <span className="ml-2 font-mono text-[10px] text-muted-foreground/60">
              Cmd/Ctrl + S
            </span>
          </div>
          <div className="flex items-center gap-2">
            {dirty && (
              <ActionButton variant="ghost" onClick={onDiscard} disabled={pending !== null}>
                Discard
              </ActionButton>
            )}
            <ActionButton onClick={onClose} disabled={pending !== null}>
              Close
            </ActionButton>
            <ActionButton variant="accent" onClick={onSave} disabled={!dirty || pending !== null}>
              <Save className="size-3.5" />
              {pending === 'save' ? 'Saving' : 'Save file'}
            </ActionButton>
          </div>
        </div>
      </aside>
    </div>
  )
}

function AddEnvFileDialog({
  path,
  pending,
  error,
  onPathChange,
  onAdd,
  onClose,
}: {
  path: string
  pending: boolean
  error: string | null
  onPathChange: (value: string) => void
  onAdd: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose, pending])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-env-file-title"
    >
      <button
        type="button"
        aria-label="Close add environment file"
        onClick={pending ? undefined : onClose}
        className="absolute inset-0 bg-foreground/25"
      />
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (path.trim() && !pending) onAdd()
        }}
        className="relative w-full max-w-lg border border-border bg-card shadow-xl"
      >
        <header className="border-b border-border bg-panel px-4 py-3">
          <h2 id="add-env-file-title" className="font-serif text-lg text-foreground italic">
            Add environment file
          </h2>
        </header>

        <div className="space-y-4 p-4">
          <div>
            <Label className="mb-1.5 block">Environment file path</Label>
            <input
              value={path}
              onChange={(event) => onPathChange(event.target.value)}
              placeholder="/path/to/project/.env"
              autoFocus
              spellCheck={false}
              className="w-full border border-input bg-panel px-3 py-1.5 font-mono text-[13px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-ring"
            />
            <p className="mt-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
              The parent directory must exist. Supported names include .env, .env.local, and
              .env.production.local.
            </p>
          </div>

          {error && (
            <div className="border border-destructive/30 bg-destructive/5 px-3 py-2.5">
              <p className="font-mono text-[11px] leading-relaxed text-destructive">{error}</p>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border bg-panel px-4 py-3">
          <ActionButton onClick={onClose} disabled={pending}>
            Cancel
          </ActionButton>
          <ActionButton
            variant="accent"
            type="submit"
            disabled={!path.trim() || pending}
            className="active:scale-[0.98]"
          >
            <Plus className="size-3.5" />
            {pending ? 'Adding' : 'Add file'}
          </ActionButton>
        </footer>
      </form>
    </div>
  )
}

function EnvFilesEmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <Empty className="min-h-72 px-6">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileKey2 />
        </EmptyMedia>
        <EmptyTitle>No environment files managed</EmptyTitle>
        <EmptyDescription>
          Add a .env path to keep project environment files in one place.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <ActionButton variant="accent" onClick={onAdd}>
          <Plus className="size-3.5" />
          Add file
        </ActionButton>
      </EmptyContent>
    </Empty>
  )
}

function toManagedFile(payload: EnvFilePayload): ManagedEnvFile {
  return {
    path: payload.path,
    exists: payload.exists,
    byteSize: payload.byteSize,
    updatedAt: payload.updatedAt,
    variableCount: countVariables(payload.content),
  }
}

function isManagedEnvFile(value: unknown): value is ManagedEnvFile {
  if (!value || typeof value !== 'object') return false
  const file = value as Partial<ManagedEnvFile>
  return (
    typeof file.path === 'string' &&
    typeof file.exists === 'boolean' &&
    typeof file.byteSize === 'number' &&
    typeof file.variableCount === 'number' &&
    (typeof file.updatedAt === 'string' || file.updatedAt === null)
  )
}

function countVariables(content: string) {
  return content
    .split(/\r?\n/)
    .filter((line) => /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_.-]*\s*=/.test(line)).length
}

function fileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
}

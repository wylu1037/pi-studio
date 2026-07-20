'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  ChevronUp,
  Copy,
  FileKey2,
  Folder,
  FolderOpen,
  GitBranch,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { showToast } from '@/lib/toast'
import { EnvEditor } from '@/components/env-editor'
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
import { ScrollArea } from '@/components/ui/scroll-area'

const MANAGED_FILES_KEY = 'pi-studio:environment:managed-files'

type EnvVersionSummary = {
  id: string
  number: number
  label: string
  note: string
  byteSize: number
  variableCount: number
  createdAt: string
  updatedAt: string
  active: boolean
}

type EnvVersionPayload = {
  path: string
  exists: boolean
  diskByteSize: number
  diskUpdatedAt: string | null
  activeVersionId: string
  inSync: boolean
  versions: EnvVersionSummary[]
  selectedVersion: EnvVersionSummary & { content: string }
}

type ManagedEnvFile = {
  path: string
  exists: boolean
  byteSize: number
  updatedAt: string | null
  variableCount: number
  versionCount: number
  activeVersionLabel: string
  inSync: boolean
}

export function EnvView() {
  const [files, setFiles] = useState<ManagedEnvFile[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [adding, setAdding] = useState(false)
  const [path, setPath] = useState('')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<ManagedEnvFile | null>(null)
  const [versionFile, setVersionFile] = useState<EnvVersionPayload | null>(null)
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [note, setNote] = useState('')
  const [savedNote, setSavedNote] = useState('')
  const [pending, setPending] = useState<
    | 'add'
    | 'open'
    | 'version'
    | 'save'
    | 'save-activate'
    | 'copy'
    | 'activate'
    | 'delete-version'
    | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<ManagedEnvFile | null>(null)
  const [deleteVersionTarget, setDeleteVersionTarget] = useState<EnvVersionSummary | null>(null)
  const [removing, setRemoving] = useState(false)

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(MANAGED_FILES_KEY) ?? '[]') as unknown
      if (Array.isArray(stored)) {
        setFiles(
          stored
            .map(normalizeManagedEnvFile)
            .filter((file): file is ManagedEnvFile => file !== null),
        )
      }
    } catch {
      setFiles([])
    } finally {
      setHydrated(true)
    }
  }, [])

  const dirty = editing !== null && (content !== savedContent || note !== savedNote)
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

  const openAddDialog = () => {
    setPath('')
    setError(null)
    setAdding(true)
  }

  const requestVersionFile = async (requestedPath: string, versionId?: string) => {
    const query = new URLSearchParams({ path: requestedPath })
    if (versionId) query.set('versionId', versionId)
    const response = await fetch(`/api/env-file/versions?${query}`)
    const body = (await response.json()) as EnvVersionPayload | { error?: string }
    if (!response.ok || !('selectedVersion' in body)) {
      throw new Error('error' in body && body.error ? body.error : 'Unable to open file.')
    }
    return body
  }

  const applyVersionPayload = (body: EnvVersionPayload) => {
    const file = toManagedFile(body)
    setVersionFile(body)
    setEditing(file)
    setContent(body.selectedVersion.content)
    setSavedContent(body.selectedVersion.content)
    setNote(body.selectedVersion.note)
    setSavedNote(body.selectedVersion.note)
    upsertFile(file)
  }

  const addFile = async () => {
    if (!path.trim()) return
    setPending('add')
    setError(null)
    try {
      const body = await requestVersionFile(path)
      const file = toManagedFile(body)
      upsertFile(file)
      setPath('')
      setAdding(false)
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : 'Unable to add file.')
    } finally {
      setPending(null)
    }
  }

  const editFile = async (file: ManagedEnvFile) => {
    setEditing(file)
    setVersionFile(null)
    setContent('')
    setSavedContent('')
    setNote('')
    setSavedNote('')
    setPending('open')
    setError(null)
    try {
      const body = await requestVersionFile(file.path)
      applyVersionPayload(body)
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'Unable to open file.')
    } finally {
      setPending(null)
    }
  }

  const requestActivation = async (requestedPath: string, versionId: string) => {
    const response = await fetch('/api/env-file/versions/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: requestedPath, versionId }),
    })
    const body = (await response.json()) as EnvVersionPayload | { error?: string }
    if (!response.ok || !('selectedVersion' in body)) {
      throw new Error('error' in body && body.error ? body.error : 'Unable to activate version.')
    }
    return body
  }

  const saveFile = async (activateAfterSave = false) => {
    if (!editing || !versionFile) return
    setPending(activateAfterSave ? 'save-activate' : 'save')
    setError(null)
    let savedBody: EnvVersionPayload | null = null
    try {
      const response = await fetch('/api/env-file/versions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: editing.path,
          versionId: versionFile.selectedVersion.id,
          content,
          note,
        }),
      })
      const body = (await response.json()) as EnvVersionPayload | { error?: string }
      if (!response.ok || !('selectedVersion' in body)) {
        throw new Error('error' in body && body.error ? body.error : 'Unable to save version.')
      }
      savedBody = body
      let finalBody = body
      if (activateAfterSave && !body.selectedVersion.active) {
        try {
          finalBody = await requestActivation(body.path, body.selectedVersion.id)
        } catch (activationError) {
          throw new Error(
            `Version was saved, but activation failed: ${
              activationError instanceof Error ? activationError.message : 'Unable to activate.'
            }`,
            { cause: activationError },
          )
        }
      }
      applyVersionPayload(finalBody)
    } catch (saveError) {
      if (savedBody) applyVersionPayload(savedBody)
      setError(
        saveError instanceof Error
          ? saveError.message
          : activateAfterSave
            ? 'Version was saved but could not be activated.'
            : 'Unable to save version.',
      )
    } finally {
      setPending(null)
    }
  }

  const selectVersion = async (versionId: string) => {
    if (!editing || versionFile?.selectedVersion.id === versionId) return
    if (dirty) {
      setError('Save or discard the current changes before switching versions.')
      return
    }
    setPending('version')
    setError(null)
    try {
      applyVersionPayload(await requestVersionFile(editing.path, versionId))
    } catch (versionError) {
      setError(versionError instanceof Error ? versionError.message : 'Unable to open version.')
    } finally {
      setPending(null)
    }
  }

  const copyVersion = async () => {
    if (!editing || !versionFile || dirty) return
    setPending('copy')
    setError(null)
    try {
      const response = await fetch('/api/env-file/versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: editing.path,
          sourceVersionId: versionFile.selectedVersion.id,
        }),
      })
      const body = (await response.json()) as EnvVersionPayload | { error?: string }
      if (!response.ok || !('selectedVersion' in body)) {
        throw new Error('error' in body && body.error ? body.error : 'Unable to copy version.')
      }
      applyVersionPayload(body)
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : 'Unable to copy version.')
    } finally {
      setPending(null)
    }
  }

  const activateVersion = async () => {
    if (!editing || !versionFile || dirty || versionFile.selectedVersion.active) return
    setPending('activate')
    setError(null)
    try {
      applyVersionPayload(await requestActivation(editing.path, versionFile.selectedVersion.id))
    } catch (activateError) {
      setError(
        activateError instanceof Error ? activateError.message : 'Unable to activate version.',
      )
    } finally {
      setPending(null)
    }
  }

  const deleteVersion = async () => {
    if (!editing || !versionFile || !deleteVersionTarget || dirty) return
    setPending('delete-version')
    setError(null)
    try {
      const response = await fetch('/api/env-file/versions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: editing.path,
          versionId: deleteVersionTarget.id,
          selectedVersionId: versionFile.selectedVersion.id,
        }),
      })
      const body = (await response.json()) as EnvVersionPayload | { error?: string }
      if (!response.ok || !('selectedVersion' in body)) {
        throw new Error('error' in body && body.error ? body.error : 'Unable to delete version.')
      }
      applyVersionPayload(body)
      setDeleteVersionTarget(null)
    } catch (deleteError) {
      showToast({
        tone: 'error',
        title: 'Delete failed',
        message: deleteError instanceof Error ? deleteError.message : 'Unable to delete version.',
      })
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
    setVersionFile(null)
    setContent('')
    setSavedContent('')
    setNote('')
    setSavedNote('')
    setError(null)
  }

  const revertVersion = () => {
    setContent(savedContent)
    setNote(savedNote)
    setError(null)
  }

  const removeFile = async () => {
    if (!removeTarget) return
    setRemoving(true)
    try {
      const response = await fetch('/api/env-file/versions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: removeTarget.path }),
      })
      const body = (await response.json()) as { deleted?: boolean; error?: string }
      if (!response.ok || !body.deleted) {
        throw new Error(body.error ?? 'Unable to remove version history.')
      }
      persistFiles(files.filter((file) => file.path !== removeTarget.path))
      setRemoveTarget(null)
    } catch (removeError) {
      showToast({
        tone: 'error',
        title: 'Remove failed',
        message:
          removeError instanceof Error ? removeError.message : 'Unable to remove version history.',
      })
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Environment"
        subtitle="Keep local versions of .env files, add notes, and choose which version is active on disk."
      >
        <ActionButton
          variant="accent"
          onClick={openAddDialog}
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
              <EnvFilesEmptyState onAdd={openAddDialog} />
            ) : filteredFiles.length === 0 ? (
              <p className="px-4 py-16 text-center font-mono text-[11px] text-muted-foreground">
                No paths match this filter
              </p>
            ) : (
              <>
                <div className="hidden grid-cols-[minmax(0,1fr)_70px_70px_70px_90px_96px] gap-4 border-b border-border px-4 py-2 lg:grid">
                  <Label>File path</Label>
                  <Label>Variables</Label>
                  <Label>Versions</Label>
                  <Label>Active</Label>
                  <Label>Disk</Label>
                  <Label className="text-right">Actions</Label>
                </div>
                <ul className="divide-y divide-border">
                  {filteredFiles.map((file) => (
                    <li
                      key={file.path}
                      className="grid gap-3 px-4 py-3 hover:bg-panel/50 lg:grid-cols-[minmax(0,1fr)_70px_70px_70px_90px_96px] lg:items-center lg:gap-4"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-mono text-[13px] text-foreground">
                          {fileName(file.path)}
                        </p>
                        <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                          {file.path}
                        </p>
                        <p className="mt-1 font-mono text-[10px] text-muted-foreground lg:hidden">
                          {file.variableCount} variables · {file.versionCount} versions · active{' '}
                          {file.activeVersionLabel}
                        </p>
                      </div>
                      <span className="hidden font-mono text-[12px] text-foreground lg:block">
                        {file.variableCount}
                      </span>
                      <span className="hidden font-mono text-[12px] text-foreground lg:block">
                        {file.versionCount}
                      </span>
                      <span className="hidden font-mono text-[12px] text-foreground lg:block">
                        {file.activeVersionLabel}
                      </span>
                      <div className="hidden lg:block">
                        <Tag tone={!file.exists || !file.inSync ? 'warning' : 'success'}>
                          {!file.exists ? 'new' : file.inSync ? 'synced' : 'changed'}
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
              Version snapshots stay on this device in Pi Studio&apos;s data directory with private
              file permissions.
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
          onError={setError}
          onAdd={() => void addFile()}
          onClose={() => {
            if (pending === null) {
              setAdding(false)
              setPath('')
              setError(null)
            }
          }}
        />
      )}

      {editing && (
        <EnvFileDrawer
          file={editing}
          versionFile={versionFile}
          content={content}
          note={note}
          dirty={dirty}
          byteSize={byteSize}
          variableCount={variableCount}
          pending={pending}
          error={error}
          onContentChange={(value) => {
            setContent(value)
            setError(null)
          }}
          onNoteChange={(value) => {
            setNote(value)
            setError(null)
          }}
          onSelectVersion={(versionId) => void selectVersion(versionId)}
          onCopy={() => void copyVersion()}
          onActivate={() => void activateVersion()}
          onDeleteVersion={setDeleteVersionTarget}
          onSave={() => void saveFile(false)}
          onSaveAndActivate={() => void saveFile(true)}
          onClose={() => {
            if (pending === null) closeEditor(false)
          }}
          onRevert={revertVersion}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleteVersionTarget)}
        title={`Delete ${deleteVersionTarget?.label ?? 'version'}`}
        description={`Permanently delete ${deleteVersionTarget?.label ?? 'this version'} and its saved environment values? Version numbers will not be changed.`}
        confirmLabel="Delete version"
        busy={pending === 'delete-version'}
        onCancel={() => {
          if (pending !== 'delete-version') setDeleteVersionTarget(null)
        }}
        onConfirm={() => void deleteVersion()}
      />

      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Remove environment file"
        description={`Remove "${removeTarget?.path ?? ''}" and its local version history? The active .env file on disk will not be deleted.`}
        confirmLabel="Remove from list"
        busy={removing}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => void removeFile()}
      />
    </div>
  )
}

function EnvFileDrawer({
  file,
  versionFile,
  content,
  note,
  dirty,
  byteSize,
  variableCount,
  pending,
  error,
  onContentChange,
  onNoteChange,
  onSelectVersion,
  onCopy,
  onActivate,
  onDeleteVersion,
  onSave,
  onSaveAndActivate,
  onClose,
  onRevert,
}: {
  file: ManagedEnvFile
  versionFile: EnvVersionPayload | null
  content: string
  note: string
  dirty: boolean
  byteSize: number
  variableCount: number
  pending:
    | 'add'
    | 'open'
    | 'version'
    | 'save'
    | 'save-activate'
    | 'copy'
    | 'activate'
    | 'delete-version'
    | null
  error: string | null
  onContentChange: (value: string) => void
  onNoteChange: (value: string) => void
  onSelectVersion: (versionId: string) => void
  onCopy: () => void
  onActivate: () => void
  onDeleteVersion: (version: EnvVersionSummary) => void
  onSave: () => void
  onSaveAndActivate: () => void
  onClose: () => void
  onRevert: () => void
}) {
  const selectedVersion = versionFile?.selectedVersion ?? null
  const loadingVersion = pending === 'open' || pending === 'version'
  const versionPending = pending !== null
  const selectedIsDraft = selectedVersion ? !selectedVersion.active : false

  useEffect(() => {
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && pending === null) onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose, pending])

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="environment-version-title"
    >
      <button
        type="button"
        aria-label="Close environment file editor"
        onClick={onClose}
        className="absolute inset-0 animate-in bg-foreground/20 backdrop-blur-[1px] duration-200 fade-in"
      />
      <aside className="relative flex h-full w-full max-w-260 animate-in flex-col border-l border-border bg-panel shadow-[-24px_0_64px_-36px_rgba(0,0,0,0.45)] duration-300 slide-in-from-right sm:w-[min(1040px,96vw)]">
        <header className="flex min-h-16 items-center justify-between gap-4 border-b border-border bg-card px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center border border-border-strong bg-panel text-accent">
              <FileKey2 className="size-3.5" />
            </span>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h2
                  id="environment-version-title"
                  className="truncate font-mono text-sm font-medium text-foreground"
                >
                  {fileName(file.path)}
                </h2>
              </div>
              <p
                title={file.path}
                className="mt-0.5 max-w-[58vw] truncate font-mono text-[10px] text-muted-foreground sm:max-w-xl"
              >
                {file.path}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <span
              className={cn(
                'hidden items-center gap-1.5 px-2 font-mono text-[10px] sm:flex',
                !file.exists || !versionFile?.inSync ? 'text-warning' : 'text-muted-foreground',
              )}
            >
              <span
                className={cn(
                  'size-1.5',
                  !file.exists || !versionFile?.inSync ? 'bg-warning' : 'bg-success',
                )}
              />
              {!file.exists ? 'Not created' : versionFile?.inSync ? 'Synced' : 'Disk changed'}
            </span>
            <ActionButton
              variant="ghost"
              title="Duplicate selected version"
              onClick={onCopy}
              disabled={!selectedVersion || dirty || versionPending}
              className="hidden px-2 active:scale-[0.98] sm:inline-flex"
            >
              <Copy className="size-3.5" />
            </ActionButton>
            <button
              type="button"
              onClick={onClose}
              disabled={versionPending}
              className="p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-[0.98] disabled:opacity-40"
              aria-label="Close editor"
            >
              <X className="size-4" />
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-rows-[144px_minmax(0,1fr)] md:grid-cols-[220px_minmax(0,1fr)] md:grid-rows-1">
          <section className="flex min-h-0 flex-col border-b border-border bg-card md:border-r md:border-b-0">
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
              <div className="flex items-center gap-2">
                <GitBranch className="size-3.5 text-accent" />
                <Label>Versions</Label>
                <span className="font-mono text-[9px] text-muted-foreground">
                  {versionFile?.versions.length ?? 0}
                </span>
              </div>
              <ActionButton
                variant="ghost"
                title="Duplicate selected version"
                onClick={onCopy}
                disabled={!selectedVersion || dirty || versionPending}
                className="px-2 active:scale-[0.98] sm:hidden"
              >
                <Copy className="size-3.5" />
              </ActionButton>
            </div>

            {!versionFile ? (
              <div
                className="min-h-0 flex-1 animate-pulse bg-muted/70"
                aria-label="Loading versions"
              />
            ) : (
              <ScrollArea horizontal className="min-h-0 flex-1" viewportClassName="pb-2 md:pb-0">
                <ul className="flex min-w-max md:block md:min-w-0">
                  {versionFile.versions.map((version) => {
                    const selected = selectedVersion?.id === version.id
                    const unsaved = selected && dirty
                    return (
                      <li
                        key={version.id}
                        className="group relative w-52 shrink-0 border-r border-border md:w-auto md:border-r-0 md:border-b"
                      >
                        <button
                          type="button"
                          onClick={() => onSelectVersion(version.id)}
                          disabled={versionPending}
                          className={cn(
                            'flex min-h-18 w-full flex-col gap-1 border-l-2 px-3 py-2.5 pr-9 text-left transition-colors hover:bg-muted active:bg-muted/80 disabled:pointer-events-none disabled:opacity-50',
                            selected ? 'border-accent bg-muted' : 'border-transparent',
                          )}
                        >
                          <span className="flex w-full items-center justify-between gap-2">
                            <span className="font-mono text-[12px] font-medium text-foreground">
                              {version.label}
                            </span>
                            <span
                              className={cn(
                                'flex items-center gap-1.5 font-mono text-[9px] uppercase',
                                unsaved
                                  ? 'text-warning'
                                  : version.active
                                    ? 'text-success'
                                    : 'text-muted-foreground',
                              )}
                            >
                              <span
                                className={cn(
                                  'size-1.5',
                                  unsaved
                                    ? 'bg-warning'
                                    : version.active
                                      ? 'bg-success'
                                      : 'border border-border-strong',
                                )}
                              />
                              {unsaved ? 'Unsaved' : version.active ? 'Live' : 'Draft'}
                            </span>
                          </span>
                          <span className="truncate text-[11px] leading-relaxed text-muted-foreground">
                            {version.note || 'No note'}
                          </span>
                          <span className="font-mono text-[9px] text-muted-foreground/65">
                            {formatVersionTime(version.updatedAt)}
                          </span>
                        </button>
                        {!version.active && versionFile.versions.length > 1 && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              onDeleteVersion(version)
                            }}
                            disabled={dirty || versionPending}
                            title={
                              dirty
                                ? 'Save or revert current changes before deleting a version'
                                : `Delete ${version.label}`
                            }
                            aria-label={`Delete ${version.label}`}
                            className="absolute right-2 bottom-2 p-1 text-muted-foreground opacity-100 transition-colors hover:bg-destructive/10 hover:text-destructive focus:opacity-100 disabled:pointer-events-none disabled:opacity-30 md:opacity-0 md:group-hover:opacity-100"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </ScrollArea>
            )}
          </section>

          <section className="flex min-h-0 min-w-0 flex-col bg-panel">
            {error && (
              <div className="border-b border-destructive/30 bg-destructive/5 px-4 py-2.5">
                <p className="font-mono text-[11px] leading-relaxed text-destructive">{error}</p>
              </div>
            )}

            {!versionFile?.inSync && versionFile?.exists && (
              <div className="border-b border-warning/30 bg-warning/5 px-4 py-2.5">
                <p className="font-mono text-[10px] leading-relaxed text-warning">
                  The live file changed outside Pi Studio. Activating a version will replace it.
                </p>
              </div>
            )}

            <div className="min-h-0 flex-1 bg-panel">
              {selectedVersion && !loadingVersion ? (
                <EnvEditor
                  path={file.path}
                  versionId={selectedVersion.id}
                  value={content}
                  readOnly={versionPending}
                  onChange={onContentChange}
                  onSave={() => {
                    if (dirty && pending === null) onSave()
                  }}
                />
              ) : (
                <div
                  className="h-full animate-pulse bg-muted/70"
                  aria-label="Loading environment version"
                />
              )}
            </div>
          </section>
        </div>

        <footer className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-4 py-2.5 sm:px-5">
          <div className="flex min-w-48 flex-1 items-center gap-2 sm:max-w-md">
            <Pencil className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              value={note.replace(/\s*\r?\n\s*/g, ' ')}
              onChange={(event) => onNoteChange(event.target.value)}
              maxLength={500}
              disabled={versionPending}
              aria-label="Version note"
              placeholder="Add version note"
              className="min-w-0 flex-1 border-b border-transparent bg-transparent px-1 py-1 font-mono text-[10px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-input disabled:opacity-50"
            />
            <span className="hidden shrink-0 font-mono text-[9px] text-muted-foreground lg:inline">
              {variableCount} vars · {formatBytes(byteSize)} · Cmd/Ctrl + S
            </span>
          </div>

          <div className="flex items-center gap-2">
            {dirty && (
              <ActionButton
                variant="ghost"
                onClick={onRevert}
                disabled={versionPending}
                className="active:scale-[0.98]"
              >
                <RotateCcw className="size-3.5" />
                Revert
              </ActionButton>
            )}

            {selectedVersion?.active ? (
              dirty ? (
                <ActionButton
                  variant="accent"
                  onClick={onSave}
                  disabled={versionPending}
                  className="active:scale-[0.98]"
                >
                  <Save className="size-3.5" />
                  {pending === 'save' ? 'Saving' : 'Save to disk'}
                </ActionButton>
              ) : (
                <span className="flex items-center gap-1.5 px-2 font-mono text-[10px] text-success">
                  <Check className="size-3.5" />
                  Live on disk
                </span>
              )
            ) : dirty ? (
              <>
                <ActionButton
                  onClick={onSave}
                  disabled={versionPending}
                  className="active:scale-[0.98]"
                >
                  <Save className="size-3.5" />
                  {pending === 'save' ? 'Saving' : 'Save draft'}
                </ActionButton>
                <ActionButton
                  variant="accent"
                  onClick={onSaveAndActivate}
                  disabled={versionPending}
                  className="active:scale-[0.98]"
                >
                  <Check className="size-3.5" />
                  {pending === 'save-activate' ? 'Activating' : 'Save & activate'}
                </ActionButton>
              </>
            ) : selectedIsDraft ? (
              <ActionButton
                variant="accent"
                onClick={onActivate}
                disabled={versionPending}
                className="active:scale-[0.98]"
              >
                <Check className="size-3.5" />
                {pending === 'activate' ? 'Activating' : `Activate ${selectedVersion?.label ?? ''}`}
              </ActionButton>
            ) : null}
          </div>
        </footer>
      </aside>
    </div>
  )
}

function AddEnvFileDialog({
  path,
  pending,
  error,
  onPathChange,
  onError,
  onAdd,
  onClose,
}: {
  path: string
  pending: boolean
  error: string | null
  onPathChange: (value: string) => void
  onError: (message: string) => void
  onAdd: () => void
  onClose: () => void
}) {
  const [choosing, setChoosing] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)

  useEffect(() => {
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !pending && !choosing && !browserOpen) onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [browserOpen, choosing, onClose, pending])

  const chooseExistingFile = async () => {
    if (!window.piStudio?.selectEnvFile) {
      setBrowserOpen(true)
      return
    }
    setChoosing(true)
    try {
      const selectedPath = await window.piStudio.selectEnvFile()
      if (selectedPath) onPathChange(selectedPath)
    } catch (selectError) {
      onError(selectError instanceof Error ? selectError.message : 'Unable to select file.')
    } finally {
      setChoosing(false)
    }
  }

  if (browserOpen) {
    return (
      <EnvFilePickerDialog
        onClose={() => setBrowserOpen(false)}
        onSelect={(selectedPath) => {
          onPathChange(selectedPath)
          setBrowserOpen(false)
        }}
      />
    )
  }

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
            <div className="flex w-full items-center border border-input bg-panel transition-colors focus-within:border-ring">
              <FolderOpen className="ml-3 size-3.5 shrink-0 text-muted-foreground" />
              <input
                value={path}
                onChange={(event) => onPathChange(event.target.value)}
                placeholder="/path/to/project/.env"
                autoFocus
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent px-2.5 py-2 font-mono text-[13px] text-foreground outline-none placeholder:text-muted-foreground/60"
              />
              <button
                type="button"
                onClick={() => void chooseExistingFile()}
                disabled={pending || choosing}
                title="Choose an existing environment file"
                className="self-stretch border-l border-input px-3 font-mono text-[11px] text-accent transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:text-muted-foreground disabled:opacity-50"
              >
                {choosing ? 'Choosing…' : 'Browse'}
              </button>
            </div>
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
          <ActionButton onClick={onClose} disabled={pending || choosing}>
            Cancel
          </ActionButton>
          <ActionButton
            variant="accent"
            type="submit"
            disabled={!path.trim() || pending || choosing}
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

type EnvFileBrowserEntry = {
  name: string
  path: string
}

type EnvFileBrowserListing = {
  path: string
  parent?: string
  entries: EnvFileBrowserEntry[]
  files: EnvFileBrowserEntry[]
}

function EnvFilePickerDialog({
  onClose,
  onSelect,
}: {
  onClose: () => void
  onSelect: (path: string) => void
}) {
  const [requestedPath, setRequestedPath] = useState('')
  const [directory, setDirectory] = useState<EnvFileBrowserListing | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ includeFiles: 'env' })
    if (requestedPath) query.set('path', requestedPath)

    setLoading(true)
    setError(null)
    setSelectedPath(null)
    fetch(`/api/directories?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as EnvFileBrowserListing & { error?: string }
        if (!response.ok) throw new Error(body.error ?? 'Unable to load this directory.')
        setDirectory(body)
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return
        setDirectory(null)
        setError(
          requestError instanceof Error ? requestError.message : 'Unable to load this directory.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [reloadKey, requestedPath])

  useEffect(() => {
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="env-file-picker-title"
    >
      <button
        type="button"
        aria-label="Close environment file picker"
        onClick={onClose}
        className="absolute inset-0 bg-foreground/25"
      />
      <div className="relative flex w-full max-w-xl flex-col border border-border bg-card shadow-xl">
        <header className="border-b border-border bg-panel px-4 py-3">
          <h2 id="env-file-picker-title" className="font-serif text-lg text-foreground italic">
            Select environment file
          </h2>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            Browse folders and choose an existing .env file.
          </p>
        </header>

        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2 border border-input bg-panel p-2">
            <ActionButton
              title="Go to parent folder"
              onClick={() => directory?.parent && setRequestedPath(directory.parent)}
              disabled={!directory?.parent || loading}
              className="px-2"
            >
              <ChevronUp className="size-3.5" />
            </ActionButton>
            <p
              className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground"
              title={directory?.path}
            >
              {directory?.path ?? (loading ? 'Loading directory…' : 'Choose a directory')}
            </p>
          </div>

          <ScrollArea
            className="h-72 border border-border bg-panel"
            viewportClassName="pr-2"
            contentClassName="min-h-full"
          >
            {loading && !directory ? (
              <div className="flex h-full items-center justify-center gap-2 font-mono text-xs text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                Loading files
              </div>
            ) : error ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="font-mono text-xs text-destructive">{error}</p>
                <div className="flex items-center gap-2">
                  {requestedPath && (
                    <ActionButton onClick={() => setRequestedPath('')}>
                      Open home folder
                    </ActionButton>
                  )}
                  <ActionButton onClick={() => setReloadKey((value) => value + 1)}>
                    Retry
                  </ActionButton>
                </div>
              </div>
            ) : directory && directory.entries.length === 0 && directory.files.length === 0 ? (
              <p className="px-4 py-10 text-center font-mono text-xs text-muted-foreground">
                No folders or environment files in this directory.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {directory?.entries.map((entry) => (
                  <li key={entry.path}>
                    <button
                      type="button"
                      onClick={() => setRequestedPath(entry.path)}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted"
                    >
                      <Folder className="size-4 shrink-0 text-accent" />
                      <span className="truncate font-mono text-[13px] text-foreground">
                        {entry.name}
                      </span>
                    </button>
                  </li>
                ))}
                {directory?.files.map((file) => (
                  <li key={file.path}>
                    <button
                      type="button"
                      onClick={() => setSelectedPath(file.path)}
                      onDoubleClick={() => onSelect(file.path)}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted',
                        selectedPath === file.path && 'bg-muted',
                      )}
                    >
                      <FileKey2 className="size-4 shrink-0 text-accent" />
                      <span className="truncate font-mono text-[13px] text-foreground">
                        {file.name}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border bg-panel px-4 py-3">
          <ActionButton onClick={onClose}>Cancel</ActionButton>
          <ActionButton
            variant="accent"
            onClick={() => selectedPath && onSelect(selectedPath)}
            disabled={!selectedPath || loading}
          >
            Select file
          </ActionButton>
        </footer>
      </div>
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
          Add a .env path to create its first snapshot and start managing versions.
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

function toManagedFile(payload: EnvVersionPayload): ManagedEnvFile {
  const activeVersion =
    payload.versions.find((version) => version.id === payload.activeVersionId) ??
    payload.selectedVersion
  return {
    path: payload.path,
    exists: payload.exists,
    byteSize: activeVersion.byteSize,
    updatedAt: payload.diskUpdatedAt,
    variableCount: activeVersion.variableCount,
    versionCount: payload.versions.length,
    activeVersionLabel: activeVersion.label,
    inSync: payload.inSync,
  }
}

function normalizeManagedEnvFile(value: unknown): ManagedEnvFile | null {
  if (!value || typeof value !== 'object') return null
  const file = value as Partial<ManagedEnvFile>
  if (
    typeof file.path === 'string' &&
    typeof file.exists === 'boolean' &&
    typeof file.byteSize === 'number' &&
    typeof file.variableCount === 'number' &&
    (typeof file.updatedAt === 'string' || file.updatedAt === null)
  ) {
    return {
      path: file.path,
      exists: file.exists,
      byteSize: file.byteSize,
      updatedAt: file.updatedAt,
      variableCount: file.variableCount,
      versionCount: typeof file.versionCount === 'number' ? file.versionCount : 1,
      activeVersionLabel:
        typeof file.activeVersionLabel === 'string' ? file.activeVersionLabel : 'v0',
      inSync: typeof file.inSync === 'boolean' ? file.inSync : true,
    }
  }
  return null
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

function formatVersionTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const datePart = `${month}/${day}`
  return year === new Date().getFullYear()
    ? `${datePart} · ${hours}:${minutes}`
    : `${year}/${datePart} · ${hours}:${minutes}`
}

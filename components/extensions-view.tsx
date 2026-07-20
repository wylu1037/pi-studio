'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Puzzle as SidebarExtensionsIcon } from 'lucide-react'
import {
  ArrowsClockwiseIcon as ArrowsClockwise,
  CaretRightIcon as CaretRight,
  CheckCircleIcon as CheckCircle,
  FileIcon as File,
  FileTsIcon as FileTs,
  FloppyDiskIcon as FloppyDisk,
  FolderIcon as Folder,
  MagnifyingGlassIcon as MagnifyingGlass,
  PlusIcon as Plus,
  PuzzlePieceIcon as PuzzlePiece,
  ShieldCheckIcon as ShieldCheck,
  TerminalWindowIcon as TerminalWindow,
  TrashIcon as Trash,
  WarningIcon as Warning,
  XCircleIcon as XCircle,
  XIcon as X,
} from '@phosphor-icons/react'
import {
  ActionButton,
  ConfirmDialog,
  Label,
  PageHeader,
  PanelHeader,
  Tag,
  TextInput,
} from '@/components/pi-ui'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { AgentProfile, GlobalExtension } from '@/lib/types'
import { errorMessage, showToast } from '@/lib/toast'
import { cn } from '@/lib/utils'

type ExtensionsTab = 'manage' | 'develop'
type ExtensionTemplate =
  | 'empty'
  | 'tool'
  | 'command'
  | 'permission-gate'
  | 'lifecycle'
  | 'context-modifier'
  | 'provider'
  | 'session-state'

type Workspace = {
  path: string
  label: string
  sources: Array<'studio' | 'agent' | 'session'>
}

type TrustState = {
  cwd: string
  requiresTrust: boolean
  trusted: boolean
  savedDecision: boolean | null
  options: Array<{
    label: string
    trusted: boolean
    updates: Array<{ path: string; decision: boolean | null }>
    savedPath?: string
  }>
}

type ExtensionFile = {
  path: string
  type: 'file' | 'directory'
  size?: number
}

type ValidationResult = {
  valid: boolean
  diagnostics: Array<{
    file?: string
    line?: number
    column?: number
    severity: 'error' | 'warning'
    code: string
    message: string
  }>
  capabilities: {
    tools: string[]
    commands: string[]
    hooks: string[]
    providers: string[]
    ui: string[]
  }
  checkedAt: string
}

type ExtensionDiagnostic = {
  id: string
  sessionId: string
  extensionPath?: string
  event: string
  level: 'error' | 'warning' | 'info'
  message: string
  stack?: string
  createdAt: string
}

const templates: Array<{ value: ExtensionTemplate; label: string; description: string }> = [
  { value: 'empty', label: 'Empty extension', description: 'Minimal session start hook.' },
  { value: 'tool', label: 'Custom tool', description: 'Register a TypeBox-backed LLM tool.' },
  { value: 'command', label: 'Slash command', description: 'Register an interactive command.' },
  {
    value: 'permission-gate',
    label: 'Tool permission gate',
    description: 'Review selected tool calls before execution.',
  },
  { value: 'lifecycle', label: 'Lifecycle hook', description: 'Observe session and turn events.' },
  {
    value: 'context-modifier',
    label: 'Context modifier',
    description: 'Append project guidance to the system prompt.',
  },
  {
    value: 'provider',
    label: 'Provider registration',
    description: 'Scaffold a provider adapter.',
  },
  {
    value: 'session-state',
    label: 'Session state',
    description: 'Persist extension state in session entries.',
  },
]

const ExtensionsEditor = dynamic(
  () => import('@/components/extensions-editor').then((module) => module.ExtensionsEditor),
  {
    ssr: false,
    loading: () => <div className="h-full animate-pulse bg-muted" />,
  },
)

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const responseText = await response.text()
  let body: unknown
  if (responseText) {
    try {
      body = JSON.parse(responseText)
    } catch {
      body = undefined
    }
  }
  if (!response.ok) {
    const error =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : undefined
    throw new Error(
      error || `Request failed (${response.status} ${response.statusText || 'Error'}).`,
    )
  }
  if (!responseText) throw new Error('Server returned an empty response.')
  if (body === undefined) throw new Error('Server returned an invalid JSON response.')
  return body as T
}

function queryUrl(path: string, values: Record<string, string | number | undefined>) {
  const url = new URL(path, window.location.origin)
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  return `${url.pathname}${url.search}`
}

export function ExtensionsView({
  initialCwd,
  initialExtensions,
  initialAgents,
  initialWorkspaces,
  initialTrust,
}: {
  initialCwd: string
  initialExtensions: GlobalExtension[]
  initialAgents: AgentProfile[]
  initialWorkspaces: Workspace[]
  initialTrust: TrustState
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const initialTab = searchParams.get('tab') === 'develop' ? 'develop' : 'manage'
  const [tab, setTab] = useState<ExtensionsTab>(initialTab)
  const [cwd, setCwd] = useState(initialCwd)
  const [workspaces] = useState(initialWorkspaces)
  const [items, setItems] = useState(initialExtensions)
  const [trust, setTrust] = useState(initialTrust)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const updateLocation = useCallback(
    (nextTab: ExtensionsTab, extensionId?: string) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set('tab', nextTab)
      if (extensionId) params.set('extension', extensionId)
      else params.delete('extension')
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  const refresh = useCallback(
    async (targetCwd = cwd) => {
      setLoading(true)
      setLoadError(null)
      try {
        const [extensions, trustState] = await Promise.all([
          requestJson<GlobalExtension[]>(queryUrl('/api/extensions', { cwd: targetCwd })),
          requestJson<TrustState>(queryUrl('/api/extensions/trust', { cwd: targetCwd })),
        ])
        setItems(extensions)
        setTrust(trustState)
      } catch (refreshError) {
        setLoadError(errorMessage(refreshError, 'Unable to load extensions.'))
      } finally {
        setLoading(false)
      }
    },
    [cwd],
  )

  const changeWorkspace = (nextCwd: string) => {
    setCwd(nextCwd)
    void refresh(nextCwd)
  }

  const changeTab = (nextTab: ExtensionsTab) => {
    setTab(nextTab)
    updateLocation(
      nextTab,
      nextTab === 'develop' ? (searchParams.get('extension') ?? undefined) : undefined,
    )
  }

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        if (value === 'manage' || value === 'develop') changeTab(value)
      }}
      className="h-full min-h-0 gap-0"
    >
      <PageHeader
        title="Extensions"
        subtitle="Inspect, develop, validate, and reload executable Pi extensions."
      >
        <TabsList className="h-auto rounded-none border border-border-strong bg-panel p-0.5 group-data-horizontal/tabs:h-auto">
          {(['manage', 'develop'] as const).map((value) => (
            <TabsTrigger
              key={value}
              value={value}
              className="h-auto flex-none rounded-none px-4 py-1.5 font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase hover:bg-muted hover:text-foreground active:scale-[0.98] data-active:bg-primary data-active:text-primary-foreground data-active:hover:bg-primary/90 data-active:hover:text-primary-foreground"
            >
              {value}
            </TabsTrigger>
          ))}
        </TabsList>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-panel/80 px-4 py-2.5 sm:px-6">
        <Label>Workspace</Label>
        <Select value={cwd} onValueChange={(value) => value && changeWorkspace(value)}>
          <SelectTrigger className="h-8 w-auto max-w-[min(70vw,32rem)] min-w-48 border-border bg-card px-2 font-mono text-xs">
            <SelectValue>
              {workspaces.find((workspace) => workspace.path === cwd)?.label ?? cwd}
            </SelectValue>
          </SelectTrigger>
          <SelectContent
            align="start"
            alignItemWithTrigger={false}
            className="w-max max-w-[calc(100vw-2rem)] min-w-(--anchor-width)"
          >
            {workspaces.map((workspace) => (
              <SelectItem key={workspace.path} value={workspace.path}>
                <span className="flex min-w-0 flex-col">
                  <span>{workspace.label}</span>
                  <span className="max-w-lg truncate font-mono text-[10px] text-muted-foreground">
                    {workspace.path}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {loading && <Tag tone="warning">refreshing</Tag>}
        <span className="ml-auto hidden max-w-[38vw] truncate font-mono text-[10px] text-muted-foreground lg:block">
          {cwd}
        </span>
      </div>

      {trust.requiresTrust && !trust.trusted && (
        <TrustBanner
          cwd={cwd}
          onTrusted={(state) => {
            setTrust(state)
            void refresh(cwd)
          }}
        />
      )}
      {loadError && (
        <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/8 px-6 py-2.5 text-sm text-destructive">
          <Warning size={16} weight="fill" />
          <span>{loadError}</span>
          <button
            type="button"
            className="ml-auto font-mono text-xs underline"
            onClick={() => void refresh()}
          >
            Retry
          </button>
        </div>
      )}

      <TabsContent value="manage" className="flex min-h-0 flex-1 flex-col">
        <ManageTab items={items} agents={initialAgents} cwd={cwd} onRefresh={() => refresh()} />
      </TabsContent>
      <TabsContent value="develop" className="flex min-h-0 flex-1 flex-col">
        <DevelopTab
          items={items}
          cwd={cwd}
          initialExtensionId={searchParams.get('extension') ?? undefined}
          onRefresh={() => refresh()}
          onLocation={(extensionId) => updateLocation('develop', extensionId)}
        />
      </TabsContent>
    </Tabs>
  )
}

function TrustBanner({ cwd, onTrusted }: { cwd: string; onTrusted: (state: TrustState) => void }) {
  const [pending, setPending] = useState<string | null>(null)
  const decide = async (decision: 'once' | 'always' | 'deny') => {
    setPending(decision)
    try {
      const state = await requestJson<TrustState>('/api/extensions/trust', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd, decision }),
      })
      onTrusted(state)
      showToast({
        tone: 'success',
        message: state.trusted
          ? 'Project extensions are trusted.'
          : 'Project extensions remain disabled.',
      })
    } catch (trustError) {
      showToast({
        tone: 'error',
        message: errorMessage(trustError, 'Unable to update project trust.'),
      })
    } finally {
      setPending(null)
    }
  }
  return (
    <div className="flex flex-col gap-3 border-b border-warning/35 bg-warning/10 px-4 py-3 sm:flex-row sm:items-center sm:px-6">
      <div className="flex min-w-0 items-start gap-2.5">
        <ShieldCheck size={18} className="mt-0.5 shrink-0 text-warning" />
        <div className="min-w-0">
          <p className="font-mono text-xs text-foreground">Project trust required</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Project extensions can execute files, processes, and network requests. Review the path
            before loading them.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 sm:ml-auto">
        <ActionButton disabled={pending !== null} onClick={() => void decide('once')}>
          Trust once
        </ActionButton>
        <ActionButton
          disabled={pending !== null}
          variant="accent"
          onClick={() => void decide('always')}
        >
          Always trust
        </ActionButton>
        <ActionButton
          disabled={pending !== null}
          variant="ghost"
          onClick={() => void decide('deny')}
        >
          Do not trust
        </ActionButton>
      </div>
    </div>
  )
}

function ManageTab({
  items,
  agents,
  cwd,
  onRefresh,
}: {
  items: GlobalExtension[]
  agents: AgentProfile[]
  cwd: string
  onRefresh: () => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [capability, setCapability] = useState('all')
  const [reloading, setReloading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedId) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedId(null)
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [selectedId])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return items.filter((extension) => {
      if (status === 'enabled' && !extension.enabled) return false
      if (status === 'disabled' && extension.enabled) return false
      if (
        status !== 'all' &&
        status !== 'enabled' &&
        status !== 'disabled' &&
        extension.status !== status
      )
        return false
      if (capability !== 'all') {
        if (capability === 'ui' && !extension.capabilities?.ui) return false
        if (
          capability !== 'ui' &&
          !extension.capabilities?.[capability as 'tools' | 'commands' | 'hooks' | 'providers']
            ?.length
        ) {
          return false
        }
      }
      return (
        !normalized ||
        extension.name.toLowerCase().includes(normalized) ||
        extension.source.toLowerCase().includes(normalized) ||
        extension.path.toLowerCase().includes(normalized) ||
        extension.package?.name?.toLowerCase().includes(normalized)
      )
    })
  }, [capability, items, query, status])

  const selected = items.find((item) => item.id === selectedId)
  const metrics = {
    total: items.length,
    enabled: items.filter((item) => item.enabled).length,
    loaded: items.filter((item) => item.status === 'loaded').length,
    errors: items.filter((item) => item.status === 'load-error').length,
    unassigned: items.filter((item) => !item.usedByAgents).length,
  }

  const reload = async (all = false) => {
    if (all && !window.confirm('Reload running sessions too? Active runs will be aborted.')) return
    setReloading(true)
    try {
      const results = await requestJson<Array<{ status: string }>>('/api/extensions/reload', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd, mode: all ? 'all' : 'idle-only', confirmRunning: all }),
      })
      const reloaded = results.filter((result) => result.status === 'reloaded').length
      const skipped = results.filter((result) => result.status === 'skipped-running').length
      showToast({
        tone: 'success',
        message: `${reloaded} session${reloaded === 1 ? '' : 's'} reloaded${skipped ? `; ${skipped} running session${skipped === 1 ? '' : 's'} skipped` : ''}.`,
      })
      await onRefresh()
    } catch (reloadError) {
      showToast({
        tone: 'error',
        message: errorMessage(reloadError, 'Unable to reload extensions.'),
      })
    } finally {
      setReloading(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-4 py-3 sm:px-6">
        <TextInput
          value={query}
          onChange={setQuery}
          placeholder="Search name or library path"
          icon={<MagnifyingGlass size={14} />}
          className="w-full sm:w-72"
        />
        <Select value={status} onValueChange={(value) => value && setStatus(value)}>
          <SelectTrigger className="h-8 w-auto min-w-32 border-border bg-panel px-2 font-mono text-[11px]">
            <SelectValue>{status === 'all' ? 'All status' : status}</SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} className="w-max min-w-(--anchor-width)">
            {['all', 'loaded', 'enabled', 'disabled', 'load-error'].map((value) => (
              <SelectItem key={value} value={value}>
                {value === 'all' ? 'All status' : value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={capability} onValueChange={(value) => value && setCapability(value)}>
          <SelectTrigger className="h-8 w-auto min-w-36 border-border bg-panel px-2 font-mono text-[11px]">
            <SelectValue>{capability === 'all' ? 'All capabilities' : capability}</SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} className="w-max min-w-(--anchor-width)">
            {['all', 'tools', 'commands', 'hooks', 'providers', 'ui'].map((value) => (
              <SelectItem key={value} value={value}>
                {value === 'all' ? 'All capabilities' : value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex gap-2">
          <ActionButton disabled={reloading} onClick={() => void reload(false)}>
            <ArrowsClockwise size={14} className={cn(reloading && 'animate-spin')} />
            Reload idle
          </ActionButton>
          <ActionButton disabled={reloading} variant="ghost" onClick={() => void reload(true)}>
            Reload all
          </ActionButton>
        </div>
      </div>

      <div className="grid grid-cols-2 divide-x divide-border border-b border-border sm:grid-cols-5">
        <Metric label="Total" value={metrics.total} />
        <Metric label="Assigned" value={metrics.enabled} />
        <Metric label="Loaded" value={metrics.loaded} />
        <Metric
          label="Errors"
          value={metrics.errors}
          tone={metrics.errors ? 'danger' : undefined}
        />
        <Metric label="Unassigned" value={metrics.unassigned} />
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<SidebarExtensionsIcon className="size-7" />}
            title="No extensions match"
            description="Change the filters, or create a TypeScript extension in Develop."
          />
        ) : (
          <div className="divide-y divide-border border-y border-border">
            {filtered.map((extension) => (
              <div
                key={extension.id}
                role="button"
                tabIndex={0}
                aria-label={`View ${extension.name} extension details`}
                onClick={() => setSelectedId(extension.id)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setSelectedId(extension.id)
                  }
                }}
                className={cn(
                  'grid w-full cursor-pointer gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/70 focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-ring active:translate-y-px sm:grid-cols-[minmax(0,1fr)_auto_auto]',
                  selectedId === extension.id && 'bg-muted',
                )}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center border border-border bg-card text-accent">
                    <PuzzlePiece size={16} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-mono text-sm text-foreground">
                        {extension.name}
                      </span>
                      <StatusTag extension={extension} />
                    </div>
                    <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                      {extension.package?.name ?? extension.source}
                      {extension.package?.version ? ` · ${extension.package.version}` : ''}
                    </p>
                    <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground/75">
                      {extension.relativePath ?? extension.path}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                  <Tag tone="outline">library</Tag>
                  <Tag tone={extension.usedByAgents ? 'accent' : 'outline'}>
                    {extension.usedByAgents ?? 0} agent{extension.usedByAgents === 1 ? '' : 's'}
                  </Tag>
                  {extension.capabilities?.tools.length ? (
                    <Tag>{extension.capabilities.tools.length} tools</Tag>
                  ) : null}
                  {extension.capabilities?.commands.length ? (
                    <Tag>{extension.capabilities.commands.length} commands</Tag>
                  ) : null}
                </div>
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <CaretRight size={14} className="text-muted-foreground" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          role="dialog"
          aria-modal="true"
          aria-label={`${selected.name} extension details`}
        >
          <button
            type="button"
            aria-label="Close extension details"
            onClick={() => setSelectedId(null)}
            className="absolute inset-0 animate-in bg-foreground/20 backdrop-blur-[1px] duration-200 fade-in"
          />
          <aside className="relative flex h-full w-full max-w-xl animate-in flex-col border-l border-border bg-panel shadow-[-24px_0_64px_-36px_rgba(0,0,0,0.45)] duration-300 slide-in-from-right sm:w-[min(560px,94vw)]">
            <ExtensionDetails
              extension={selected}
              agents={agents}
              cwd={cwd}
              onClose={() => setSelectedId(null)}
              onAssignmentsChanged={onRefresh}
            />
          </aside>
        </div>
      )}
    </div>
  )
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'danger' | 'warning'
}) {
  return (
    <div className="px-4 py-3 sm:px-6">
      <Label>{label}</Label>
      <p
        className={cn(
          'mt-1 font-mono text-xl text-foreground',
          tone === 'danger' && 'text-destructive',
          tone === 'warning' && 'text-warning',
        )}
      >
        {value}
      </p>
    </div>
  )
}

function StatusTag({ extension }: { extension: GlobalExtension }) {
  const tone =
    extension.status === 'loaded'
      ? 'success'
      : extension.status === 'load-error'
        ? 'danger'
        : extension.status === 'trust-required'
          ? 'warning'
          : 'outline'
  return <Tag tone={tone}>{extension.status ?? (extension.enabled ? 'enabled' : 'disabled')}</Tag>
}

function ExtensionDetails({
  extension,
  agents,
  cwd,
  onClose,
  onAssignmentsChanged,
}: {
  extension: GlobalExtension
  agents: AgentProfile[]
  cwd: string
  onClose: () => void
  onAssignmentsChanged: () => Promise<void>
}) {
  const [source, setSource] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<ExtensionDiagnostic[]>([])
  const [loading, setLoading] = useState(true)
  const [assigningAgentId, setAssigningAgentId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([
      requestJson<{ content: string }>(
        queryUrl(`/api/extensions/${encodeURIComponent(extension.id)}/source`, { cwd }),
      ).catch(() => null),
      requestJson<ExtensionDiagnostic[]>(
        queryUrl(`/api/extensions/${encodeURIComponent(extension.id)}/diagnostics`, { cwd }),
      ).catch(() => []),
    ]).then(([sourceResult, diagnosticResult]) => {
      if (!active) return
      setSource(sourceResult?.content ?? null)
      setDiagnostics(diagnosticResult)
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [cwd, extension.id])

  const toggleAssignment = async (agent: AgentProfile) => {
    const enabled = !extension.assignedAgentIds?.includes(agent.id)
    setAssigningAgentId(agent.id)
    try {
      await requestJson(`/api/agents/${encodeURIComponent(agent.id)}/assign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'extension', resourceId: extension.id, enabled }),
      })
      await onAssignmentsChanged()
      showToast({
        tone: 'success',
        message: `${extension.name} ${enabled ? 'assigned to' : 'removed from'} ${agent.name}.`,
      })
    } catch (assignmentError) {
      showToast({
        tone: 'error',
        message: errorMessage(assignmentError, 'Unable to update extension assignment.'),
      })
    } finally {
      setAssigningAgentId(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start gap-3 border-b border-border px-4 py-4">
        <span className="flex size-9 shrink-0 items-center justify-center border border-border bg-card text-accent">
          <PuzzlePiece size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-sm">{extension.name}</p>
          <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
            {extension.source}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Close extension details"
        >
          <X size={16} />
        </button>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <section className="space-y-2">
          <Label>Overview</Label>
          {extension.usedByAgents ? (
            <DetailRow label="Status">
              <StatusTag extension={extension} />
            </DetailRow>
          ) : null}
          <DetailRow label="Library">
            <span>Pi Studio</span>
          </DetailRow>
          <DetailRow label="Compatibility">
            <span>{extension.compatibility ?? 'web'}</span>
          </DetailRow>
          <DetailRow label="Sessions">
            <span>{extension.runtime?.sessionIds.length ?? 0}</span>
          </DetailRow>
          <div className="flex items-center gap-3 border-t border-border pt-2">
            <Label className="shrink-0">Source</Label>
            <p
              title={extension.path}
              className="min-w-0 flex-1 truncate text-right font-mono text-[10px] text-muted-foreground"
            >
              {extension.path}
            </p>
          </div>
        </section>
        <section className="space-y-2 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-3">
            <Label>Assigned agents</Label>
            <Tag tone={extension.usedByAgents ? 'accent' : 'outline'}>
              {extension.usedByAgents ?? 0}
            </Tag>
          </div>
          {agents.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Create an agent before assigning extensions.
            </p>
          ) : (
            <div className="divide-y divide-border border-y border-border">
              {agents.map((agent) => {
                const assigned = extension.assignedAgentIds?.includes(agent.id) ?? false
                return (
                  <div key={agent.id} className="flex items-center justify-between gap-3 px-2 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs text-foreground">{agent.name}</p>
                      {agent.description && (
                        <p className="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground">
                          {agent.description}
                        </p>
                      )}
                    </div>
                    <ActionButton
                      variant={assigned ? 'ghost' : 'accent'}
                      disabled={assigningAgentId === agent.id}
                      onClick={() => void toggleAssignment(agent)}
                    >
                      {assigningAgentId === agent.id ? 'Saving' : assigned ? 'Unassign' : 'Assign'}
                    </ActionButton>
                  </div>
                )
              })}
            </div>
          )}
        </section>
        <section className="space-y-2 border-t border-border pt-4">
          <Label>Capabilities</Label>
          <CapabilityList label="Tools" values={extension.capabilities?.tools ?? []} />
          <CapabilityList label="Commands" values={extension.capabilities?.commands ?? []} />
          <CapabilityList label="Flags" values={extension.capabilities?.flags ?? []} />
          <CapabilityList label="Hooks" values={extension.capabilities?.hooks ?? []} />
        </section>
        <section className="space-y-2 border-t border-border pt-4">
          <div className="flex items-center justify-between">
            <Label>Diagnostics</Label>
            <Tag>{diagnostics.length}</Tag>
          </div>
          {diagnostics.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No runtime errors recorded for active sessions.
            </p>
          ) : (
            <div className="space-y-2">
              {diagnostics.map((diagnostic) => (
                <div
                  key={diagnostic.id}
                  className="border-l-2 border-destructive bg-destructive/5 px-3 py-2"
                >
                  <p className="font-mono text-[10px] text-destructive">
                    {diagnostic.event} · {diagnostic.sessionId}
                  </p>
                  <p className="mt-1 text-xs text-foreground">{diagnostic.message}</p>
                  {diagnostic.stack && (
                    <pre className="mt-2 overflow-auto font-mono text-[9px] whitespace-pre-wrap text-muted-foreground">
                      {diagnostic.stack}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="space-y-2 border-t border-border pt-4">
          <Label>Source preview</Label>
          {loading ? (
            <div className="h-32 animate-pulse bg-muted" />
          ) : source ? (
            <ScrollArea className="h-80 border border-border bg-card">
              <pre className="p-3 pr-5 font-mono text-[10px] leading-relaxed wrap-break-word whitespace-pre-wrap text-foreground">
                {source}
              </pre>
            </ScrollArea>
          ) : (
            <p className="text-xs text-muted-foreground">Source preview is unavailable.</p>
          )}
        </section>
      </div>
    </div>
  )
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/70 py-1.5 text-xs last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right font-mono text-[10px]">{children}</span>
    </div>
  )
}

function CapabilityList({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-2 border-b border-border/70 py-1.5 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex flex-wrap justify-end gap-1">
        {values.length ? (
          values.map((value) => <Tag key={value}>{value}</Tag>)
        ) : (
          <span className="font-mono text-[10px] text-muted-foreground">none</span>
        )}
      </div>
    </div>
  )
}

function DevelopTab({
  items,
  cwd,
  initialExtensionId,
  onRefresh,
  onLocation,
}: {
  items: GlobalExtension[]
  cwd: string
  initialExtensionId?: string
  onRefresh: () => Promise<void>
  onLocation: (extensionId?: string) => void
}) {
  const localExtensions = useMemo(
    () => items.filter((item) => !item.packageManaged && item.origin === 'top-level'),
    [items],
  )
  const [extensionId, setExtensionId] = useState<string | undefined>(
    initialExtensionId && localExtensions.some((item) => item.id === initialExtensionId)
      ? initialExtensionId
      : localExtensions[0]?.id,
  )
  const [files, setFiles] = useState<ExtensionFile[]>([])
  const [activeFile, setActiveFile] = useState<string | undefined>()
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [saving, setSaving] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteRequested, setDeleteRequested] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [mobilePane, setMobilePane] = useState<'files' | 'editor' | 'inspector'>('editor')

  const selected = localExtensions.find((item) => item.id === extensionId)
  const dirty = content !== savedContent

  const loadFiles = useCallback(
    async (id: string) => {
      setLoadingFiles(true)
      setValidation(null)
      try {
        const nextFiles = await requestJson<ExtensionFile[]>(
          queryUrl(`/api/extensions/${encodeURIComponent(id)}/files`, { cwd }),
        )
        setFiles(nextFiles)
        const first =
          nextFiles.find((file) => file.type === 'file' && /index\.[cm]?[jt]s$/.test(file.path)) ??
          nextFiles.find((file) => file.type === 'file')
        setActiveFile(first?.path)
      } catch (fileError) {
        showToast({
          tone: 'error',
          message: errorMessage(fileError, 'Unable to load extension files.'),
        })
        setFiles([])
        setActiveFile(undefined)
      } finally {
        setLoadingFiles(false)
      }
    },
    [cwd],
  )

  useEffect(() => {
    if (!extensionId) {
      setFiles([])
      setActiveFile(undefined)
      return
    }
    void loadFiles(extensionId)
  }, [extensionId, loadFiles])

  useEffect(() => {
    if (!extensionId || !activeFile) {
      setContent('')
      setSavedContent('')
      return
    }
    let active = true
    requestJson<{ content: string }>(
      queryUrl(`/api/extensions/${encodeURIComponent(extensionId)}/files/content`, {
        cwd,
        path: activeFile,
      }),
    )
      .then((result) => {
        if (!active) return
        setContent(result.content)
        setSavedContent(result.content)
      })
      .catch((fileError) => {
        if (active)
          showToast({
            tone: 'error',
            message: errorMessage(fileError, 'Unable to open extension file.'),
          })
      })
    return () => {
      active = false
    }
  }, [activeFile, cwd, extensionId])

  const selectExtension = (id: string) => {
    if (dirty && !window.confirm('Discard unsaved changes and switch extensions?')) return
    setExtensionId(id)
    onLocation(id)
  }

  const selectFile = (path: string) => {
    if (dirty && !window.confirm('Discard unsaved changes and open another file?')) return
    setActiveFile(path)
    setMobilePane('editor')
  }

  const save = async () => {
    if (!extensionId || !activeFile) return false
    setSaving(true)
    try {
      await requestJson(
        `/api/extensions/${encodeURIComponent(extensionId)}/files/content?cwd=${encodeURIComponent(cwd)}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: activeFile, content }),
        },
      )
      setSavedContent(content)
      showToast({ tone: 'success', message: `${activeFile} saved.` })
      return true
    } catch (saveError) {
      showToast({
        tone: 'error',
        message: errorMessage(saveError, 'Unable to save extension file.'),
      })
      return false
    } finally {
      setSaving(false)
    }
  }

  const validate = async () => {
    if (!extensionId) return null
    try {
      const result = await requestJson<ValidationResult>(
        queryUrl(`/api/extensions/${encodeURIComponent(extensionId)}/validate`, { cwd }),
        { method: 'POST' },
      )
      setValidation(result)
      setMobilePane('inspector')
      showToast({
        tone: result.valid ? 'success' : 'error',
        message: result.valid
          ? 'Extension validation passed.'
          : `${result.diagnostics.length} validation issue${result.diagnostics.length === 1 ? '' : 's'} found.`,
      })
      return result
    } catch (validationError) {
      showToast({
        tone: 'error',
        message: errorMessage(validationError, 'Unable to validate extension.'),
      })
      return null
    }
  }

  const saveAndReload = async () => {
    if (!(await save())) return
    const result = await validate()
    if (!result?.valid) return
    try {
      const reloadResults = await requestJson<
        Array<{ status: 'reloaded' | 'skipped-running' | 'failed'; error?: string }>
      >('/api/extensions/reload', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd, mode: 'idle-only' }),
      })
      await onRefresh()
      const failures = reloadResults.filter((item) => item.status === 'failed')
      const skipped = reloadResults.filter((item) => item.status === 'skipped-running')
      if (failures.length > 0) {
        throw new Error(
          failures
            .map((item) => item.error)
            .filter(Boolean)
            .join('; ') || 'Extension reload failed.',
        )
      }
      showToast({
        tone: 'success',
        message: skipped.length
          ? `Saved. ${skipped.length} running session${skipped.length === 1 ? '' : 's'} will use it on the next idle reload.`
          : 'Saved and reloaded in idle sessions.',
      })
    } catch (reloadError) {
      showToast({ tone: 'error', message: errorMessage(reloadError, 'Saved, but reload failed.') })
    }
  }

  const deleteExtension = async () => {
    if (!extensionId || !selected) return
    setDeleting(true)
    try {
      await requestJson(queryUrl(`/api/extensions/${encodeURIComponent(extensionId)}`, { cwd }), {
        method: 'DELETE',
      })
      setExtensionId(undefined)
      onLocation(undefined)
      await onRefresh()
      showToast({ tone: 'success', message: `${selected.name} deleted.` })
    } catch (deleteError) {
      showToast({
        tone: 'error',
        message: errorMessage(deleteError, 'Unable to delete extension.'),
      })
    } finally {
      setDeleting(false)
      setDeleteRequested(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-4 py-3 sm:px-6">
        <Select
          value={extensionId ?? null}
          onValueChange={(value) => value && selectExtension(value)}
        >
          <SelectTrigger className="h-8 w-auto max-w-[65vw] min-w-56 border-border bg-panel px-2 font-mono text-xs">
            <SelectValue>{selected?.name ?? 'Select library extension'}</SelectValue>
          </SelectTrigger>
          <SelectContent
            alignItemWithTrigger={false}
            className="w-max max-w-[calc(100vw-2rem)] min-w-(--anchor-width)"
          >
            {localExtensions.map((extension) => (
              <SelectItem key={extension.id} value={extension.id}>
                <span className="flex items-center gap-2">
                  <FileTs size={14} />
                  {extension.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ActionButton variant="accent" onClick={() => setCreateOpen(true)}>
          <Plus size={14} /> New extension
        </ActionButton>
        {selected && <Tag tone="outline">library</Tag>}
        {dirty && <Tag tone="warning">unsaved</Tag>}
        <div className="ml-auto flex flex-wrap gap-2">
          <ActionButton disabled={!activeFile || saving || !dirty} onClick={() => void save()}>
            <FloppyDisk size={14} /> Save
          </ActionButton>
          <ActionButton disabled={!extensionId} onClick={() => void validate()}>
            <CheckCircle size={14} /> Validate
          </ActionButton>
          <ActionButton
            disabled={!extensionId || saving}
            variant="accent"
            onClick={() => void saveAndReload()}
          >
            <ArrowsClockwise size={14} /> Save and reload
          </ActionButton>
        </div>
      </div>

      <div className="grid grid-cols-3 border-b border-border md:hidden">
        {(['files', 'editor', 'inspector'] as const).map((pane) => (
          <button
            key={pane}
            type="button"
            onClick={() => setMobilePane(pane)}
            className={cn(
              'px-3 py-2 font-mono text-[10px] uppercase',
              mobilePane === pane
                ? 'bg-primary text-primary-foreground'
                : 'bg-panel text-muted-foreground',
            )}
          >
            {pane}
          </button>
        ))}
      </div>

      {!selected ? (
        <EmptyState
          icon={<SidebarExtensionsIcon className="size-7" />}
          title="Create a TypeScript extension"
          description="Start from a template, edit it with Pi API types, validate without executing, then reload an idle session."
          action={
            <ActionButton variant="accent" onClick={() => setCreateOpen(true)}>
              <Plus size={14} /> New extension
            </ActionButton>
          }
        />
      ) : (
        <div className="grid min-h-0 flex-1 md:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_310px]">
          <aside
            className={cn(
              'min-h-0 border-r border-border bg-panel',
              mobilePane !== 'files' && 'hidden md:block',
            )}
          >
            <PanelHeader className="h-10 shrink-0 py-0">
              <Label>Files</Label>
              <Tag>{files.filter((file) => file.type === 'file').length}</Tag>
            </PanelHeader>
            <div className="scrollbar-thin h-[calc(100%-40px)] overflow-y-auto py-2">
              {loadingFiles ? (
                <div className="space-y-2 px-3">
                  {[1, 2, 3].map((value) => (
                    <div key={value} className="h-7 animate-pulse bg-muted" />
                  ))}
                </div>
              ) : files.length ? (
                files.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    disabled={file.type === 'directory'}
                    onClick={() => file.type === 'file' && selectFile(file.path)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[11px] transition-colors',
                      file.type === 'file' ? 'hover:bg-muted' : 'text-muted-foreground',
                      activeFile === file.path && 'bg-muted text-foreground',
                    )}
                    style={{
                      paddingLeft: `${12 + Math.max(0, file.path.split('/').length - 1) * 12}px`,
                    }}
                  >
                    {file.type === 'directory' ? (
                      <Folder size={14} />
                    ) : /\.[cm]?tsx?$/.test(file.path) ? (
                      <FileTs size={14} className="text-accent" />
                    ) : (
                      <File size={14} />
                    )}
                    <span className="truncate">{file.path.split('/').at(-1)}</span>
                  </button>
                ))
              ) : (
                <p className="px-3 py-4 text-xs text-muted-foreground">No editable files found.</p>
              )}
            </div>
          </aside>

          <main
            className={cn('min-h-0 min-w-0 bg-card', mobilePane !== 'editor' && 'hidden md:block')}
          >
            <PanelHeader className="h-10 shrink-0 py-0">
              <span className="truncate font-mono text-[11px] text-muted-foreground">
                {activeFile ?? 'No file selected'}
              </span>
              {dirty && <span className="font-mono text-[10px] text-warning">modified</span>}
            </PanelHeader>
            <div className="h-[calc(100%-40px)] min-h-80">
              {activeFile ? (
                <ExtensionsEditor path={activeFile} value={content} onChange={setContent} />
              ) : (
                <EmptyState
                  icon={<FileTs size={26} />}
                  title="Select a file"
                  description="Choose a source file from the tree."
                  compact
                />
              )}
            </div>
          </main>

          <aside
            className={cn(
              'min-h-0 border-l border-border bg-panel',
              mobilePane !== 'inspector' && 'hidden xl:block',
            )}
          >
            <Inspector validation={validation} />
          </aside>
          <div className="hidden border-t border-border bg-panel p-4 md:block xl:hidden">
            <Inspector validation={validation} inline />
          </div>
        </div>
      )}

      {selected && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-panel px-4 py-2.5 sm:px-6">
          <span className="font-mono text-[10px] text-muted-foreground">
            Extensions execute with full Node.js permissions.
          </span>
          <ActionButton
            className="ml-auto"
            variant="ghost"
            onClick={() => window.location.assign('/chat')}
          >
            <TerminalWindow size={14} /> Open test session
          </ActionButton>
          <ActionButton variant="danger" onClick={() => setDeleteRequested(true)}>
            <Trash size={14} /> Delete
          </ActionButton>
        </div>
      )}

      {createOpen && (
        <CreateExtensionModal
          onClose={() => setCreateOpen(false)}
          onCreated={async (extension) => {
            setCreateOpen(false)
            await onRefresh()
            setExtensionId(extension.id)
            onLocation(extension.id)
          }}
        />
      )}
      <ConfirmDialog
        open={deleteRequested}
        title="Delete extension"
        description={`Delete "${selected?.name ?? ''}" from the Pi Studio extension library? Its agent assignments and source files will be removed.`}
        confirmLabel="Delete extension"
        busy={deleting}
        onCancel={() => setDeleteRequested(false)}
        onConfirm={() => void deleteExtension()}
      />
    </div>
  )
}

function Inspector({
  validation,
  inline,
}: {
  validation: ValidationResult | null
  inline?: boolean
}) {
  if (!validation) {
    return (
      <div className={cn('flex h-full flex-col', inline && 'h-auto')}>
        {!inline && (
          <PanelHeader className="h-10 shrink-0 py-0">
            <Label>Inspector</Label>
          </PanelHeader>
        )}
        <EmptyState
          icon={<CheckCircle size={24} />}
          title="Not validated"
          description="Save your files, then run static validation. No extension code is executed."
          compact
        />
      </div>
    )
  }
  return (
    <div className={cn('flex h-full min-h-0 flex-col', inline && 'h-auto')}>
      {!inline && (
        <PanelHeader className="h-10 shrink-0 py-0">
          <Label>Inspector</Label>
          <Tag tone={validation.valid ? 'success' : 'danger'}>
            {validation.valid ? 'passed' : 'failed'}
          </Tag>
        </PanelHeader>
      )}
      <div
        className={cn(
          'scrollbar-thin min-h-0 flex-1 space-y-4 overflow-y-auto p-4',
          inline && 'grid grid-cols-2 gap-6 space-y-0 p-0',
        )}
      >
        <section>
          <div className="flex items-center gap-2">
            {validation.valid ? (
              <CheckCircle size={18} weight="fill" className="text-success" />
            ) : (
              <XCircle size={18} weight="fill" className="text-destructive" />
            )}
            <p className="font-mono text-xs">
              {validation.valid ? 'Validation passed' : 'Validation failed'}
            </p>
          </div>
          <p className="mt-1 font-mono text-[9px] text-muted-foreground">
            {new Date(validation.checkedAt).toLocaleString()}
          </p>
          <div className="mt-3 space-y-2">
            {validation.diagnostics.length === 0 ? (
              <p className="text-xs text-muted-foreground">No static diagnostics.</p>
            ) : (
              validation.diagnostics.map((diagnostic, index) => (
                <div
                  key={`${diagnostic.code}:${index}`}
                  className={cn(
                    'border-l-2 px-3 py-2',
                    diagnostic.severity === 'error'
                      ? 'border-destructive bg-destructive/5'
                      : 'border-warning bg-warning/5',
                  )}
                >
                  <p className="font-mono text-[9px] text-muted-foreground">
                    {diagnostic.code}
                    {diagnostic.line ? ` · ${diagnostic.line}:${diagnostic.column ?? 1}` : ''}
                  </p>
                  <p className="mt-1 text-xs text-foreground">{diagnostic.message}</p>
                </div>
              ))
            )}
          </div>
        </section>
        <section className="border-t border-border pt-4">
          <Label>Detected capabilities</Label>
          <div className="mt-2 space-y-2">
            <CapabilityList label="Tools" values={validation.capabilities.tools} />
            <CapabilityList label="Commands" values={validation.capabilities.commands} />
            <CapabilityList label="Hooks" values={validation.capabilities.hooks} />
            <CapabilityList label="Providers" values={validation.capabilities.providers} />
            <CapabilityList label="Web UI" values={validation.capabilities.ui} />
          </div>
        </section>
      </div>
    </div>
  )
}

function CreateExtensionModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (extension: GlobalExtension) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [template, setTemplate] = useState<ExtensionTemplate>('tool')
  const [creating, setCreating] = useState(false)
  const create = async () => {
    setCreating(true)
    try {
      const extension = await requestJson<GlobalExtension>('/api/extensions/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, template }),
      })
      await onCreated(extension)
      showToast({ tone: 'success', message: `${extension.name} created.` })
    } catch (createError) {
      showToast({
        tone: 'error',
        message: errorMessage(createError, 'Unable to create extension.'),
      })
    } finally {
      setCreating(false)
    }
  }
  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-foreground/20 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl border border-border bg-card shadow-[0_24px_70px_rgba(45,40,30,0.2)]"
        onClick={(event: React.MouseEvent) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="font-mono text-sm">Create TypeScript extension</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Source is stored in the Pi Studio extension library and runs only when assigned to an
              agent.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-muted-foreground hover:bg-muted"
          >
            <X size={16} />
          </button>
        </div>
        <div className="grid gap-5 p-5 sm:grid-cols-[minmax(0,1fr)_220px]">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <TextInput
                value={name}
                onChange={setName}
                placeholder="review-gate"
                className="w-full"
              />
              <p className="text-[11px] text-muted-foreground">
                Lowercase letters, numbers, hyphens, and underscores.
              </p>
            </div>
            <div className="border border-warning/30 bg-warning/8 p-3 text-xs text-muted-foreground">
              <Warning size={16} className="mb-2 text-warning" />
              Validate is static and does not execute code. Save and reload updates idle sessions
              for agents already assigned this extension.
            </div>
          </div>
          <div className="space-y-2">
            <Label>Template</Label>
            <ScrollArea className="h-72" viewportClassName="pr-3" contentClassName="space-y-1">
              {templates.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setTemplate(item.value)}
                  className={cn(
                    'w-full border px-3 py-2 text-left transition-colors',
                    template === item.value
                      ? 'border-accent bg-accent/8'
                      : 'border-border bg-card hover:bg-muted',
                  )}
                >
                  <p className="font-mono text-[11px]">{item.label}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{item.description}</p>
                </button>
              ))}
            </ScrollArea>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border bg-panel px-5 py-3">
          <ActionButton onClick={onClose}>Cancel</ActionButton>
          <ActionButton
            variant="accent"
            disabled={creating || !name.trim()}
            onClick={() => void create()}
          >
            <Plus size={14} />
            {creating ? 'Creating' : 'Create extension'}
          </ActionButton>
        </div>
      </div>
    </div>
  )
}

function EmptyState({
  icon,
  title,
  description,
  action,
  compact,
}: {
  icon: React.ReactNode
  title: string
  description: string
  action?: React.ReactNode
  compact?: boolean
}) {
  return (
    <Empty className={cn('h-full min-h-48 px-6', compact ? 'py-10' : 'py-20')}>
      <EmptyHeader>
        <EmptyMedia>{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  )
}

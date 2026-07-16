'use client'

import { FormEvent, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Search,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  ExternalLink,
  SlidersHorizontal,
  AlertTriangle,
  Box,
  Flag,
  GitFork,
  Package as PackageIcon,
  Download,
  LoaderCircle,
  Folder,
  Globe2,
  HardDrive,
  Hash,
} from 'lucide-react'
import type {
  GlobalPackage,
  PackageStatus,
  PiPackageCatalog,
  PiPackageSort,
  PiPackageTypeFilter,
} from '@/lib/types'
import { deleteApiPackagesId } from '@/lib/api/generated/clients/deleteApiPackagesId'
import { postApiPackages } from '@/lib/api/generated/clients/postApiPackages'
import { postApiPackagesIdUpdate } from '@/lib/api/generated/clients/postApiPackagesIdUpdate'
import { refreshAfterMutation } from '@/lib/api/refresh'
import { errorMessage, showToast } from '@/lib/toast'
import {
  ActionButton,
  ConfirmDialog,
  Label,
  PageHeader,
  Panel,
  Tag,
  TextInput,
} from '@/components/pi-ui'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'

const statusTone: Record<PackageStatus, 'success' | 'warning' | 'accent' | 'danger'> = {
  installed: 'success',
  'update-available': 'warning',
  pinned: 'accent',
  error: 'danger',
}
const statusLabel: Record<PackageStatus, string> = {
  installed: 'installed',
  'update-available': 'update',
  pinned: 'pinned',
  error: 'error',
}

type PackageTab = 'installed' | 'search'

export function PackagesView({
  installed,
  catalog,
}: {
  installed: GlobalPackage[]
  catalog: PiPackageCatalog
}) {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<PackageTab>('installed')
  const [showInstall, setShowInstall] = useState(false)

  const filtered = installed.filter(
    (p) =>
      !query ||
      p.name.toLowerCase().includes(query.toLowerCase()) ||
      p.description.toLowerCase().includes(query.toLowerCase()),
  )

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        if (value === 'installed' || value === 'search') setTab(value)
      }}
      className="h-full min-h-0 gap-0"
    >
      <PageHeader
        title="Packages"
        subtitle="Resource sources installed from npm, git, URL, or local paths. Packages can contain extensions, skills, prompts, and themes."
      >
        <ActionButton variant="accent" onClick={() => setShowInstall(true)}>
          <Plus className="size-3.5" />
          Install
        </ActionButton>
      </PageHeader>

      <div className="overflow-x-auto border-b border-border px-6">
        <TabsList
          variant="line"
          className="h-auto gap-0 p-0 group-data-horizontal/tabs:h-auto data-[variant=line]:gap-0"
        >
          <TabsTrigger
            value="installed"
            className="h-auto flex-none rounded-none border-0 px-4 py-3 font-mono text-xs tracking-wider text-muted-foreground uppercase after:bg-accent group-data-horizontal/tabs:after:bottom-0 hover:text-foreground data-active:text-foreground"
          >
            Installed ({installed.length})
          </TabsTrigger>
          <TabsTrigger
            value="search"
            className="h-auto flex-none rounded-none border-0 px-4 py-3 font-mono text-xs tracking-wider text-muted-foreground uppercase after:bg-accent group-data-horizontal/tabs:after:bottom-0 hover:text-foreground data-active:text-foreground"
          >
            Search pi.dev
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="installed" className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-3">
          <TextInput
            value={query}
            onChange={setQuery}
            placeholder="Filter packages…"
            icon={<Search className="size-3.5" />}
            className="w-64"
          />
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            {filtered.length} installed
          </span>
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto p-6">
          {installed.length === 0 ? (
            <PackagesEmptyState
              onBrowse={() => setTab('search')}
              onInstall={() => setShowInstall(true)}
            />
          ) : filtered.length === 0 ? (
            <Empty className="py-24">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Search />
                </EmptyMedia>
                <EmptyTitle>No matching packages</EmptyTitle>
                <EmptyDescription>
                  No installed packages match the current filter. Try a broader search.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {filtered.map((p) => (
                <PackageCard key={p.id} pkg={p} />
              ))}
            </div>
          )}
        </div>
      </TabsContent>

      <TabsContent value="search" className="flex min-h-0 flex-1 flex-col">
        <SearchCatalogView initialCatalog={catalog} />
      </TabsContent>

      <InstallPackageDialog open={showInstall} onClose={() => setShowInstall(false)} />
    </Tabs>
  )
}

function InstallPackageDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState(false)

  if (!open) return null

  const install = async () => {
    const value = source.trim()
    if (!value || busy) return
    setBusy(true)
    try {
      await postApiPackages({ source: value })
      refreshAfterMutation()
      onClose()
    } catch (installError) {
      const message = errorMessage(installError, 'Unable to install package.')
      showToast({ tone: 'error', title: 'Install failed', message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-package-title"
    >
      <button
        type="button"
        aria-label="Close install package dialog"
        className="absolute inset-0 bg-foreground/25"
        onClick={busy ? undefined : onClose}
      />
      <div className="relative w-full max-w-lg border border-border bg-card shadow-xl">
        <div className="border-b border-border bg-panel px-4 py-3">
          <h2 id="install-package-title" className="font-serif text-lg text-foreground italic">
            Install Pi package
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Install from npm, git, URL, or a local path.
          </p>
        </div>
        <div className="space-y-4 p-4">
          <div className="space-y-1.5">
            <Label>Package source</Label>
            <TextInput value={source} onChange={setSource} placeholder="npm:@scope/package" />
          </div>
          <p className="text-xs text-muted-foreground">
            Packages are stored in the Studio library and can then be assigned to individual agents.
          </p>
          <div className="flex items-start gap-2 border border-warning/30 bg-warning/10 p-3 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
            Packages may execute arbitrary code through extensions. Review the source before
            installing.
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border bg-panel px-4 py-3">
          <ActionButton onClick={onClose} disabled={busy}>
            Cancel
          </ActionButton>
          <ActionButton
            variant="accent"
            onClick={() => void install()}
            disabled={!source.trim() || busy}
          >
            <Download className="size-3.5" />
            {busy ? 'Installing' : 'Install'}
          </ActionButton>
        </div>
      </div>
    </div>
  )
}

function PackagesEmptyState({
  onBrowse,
  onInstall,
  disabled,
}: {
  onBrowse: () => void
  onInstall: () => void
  disabled?: boolean
}) {
  return (
    <Empty className="py-24">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <PackageIcon />
        </EmptyMedia>
        <EmptyTitle>No packages installed</EmptyTitle>
        <EmptyDescription>
          Install packages into the Studio library, then assign them to the agents that need them.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center">
        <ActionButton onClick={onBrowse}>
          <Search className="size-3.5" />
          Browse pi.dev
        </ActionButton>
        <ActionButton variant="accent" onClick={onInstall} disabled={disabled}>
          <Download className="size-3.5" />
          Install
        </ActionButton>
      </EmptyContent>
    </Empty>
  )
}

function ResourceBadges({ pkg }: { pkg: GlobalPackage }) {
  const r = pkg.resources
  const parts = [
    ['EXTENSION', r.extensions],
    ['SKILL', r.skills],
    ['PROMPT', r.prompts],
    ['THEME', r.themes],
  ].filter(([, n]) => (n as number) > 0)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {parts.map(([k]) => (
        <Tag key={k as string} tone="outline">
          {k as string}
        </Tag>
      ))}
    </div>
  )
}

function CatalogLinks({ pkg }: { pkg: GlobalPackage }) {
  const npmUrl = pkg.npmUrl ?? `https://www.npmjs.com/package/${encodeURIComponent(pkg.name)}`
  const links = [
    { href: npmUrl, label: 'npm', icon: Box },
    ...(pkg.repoUrl ? [{ href: pkg.repoUrl, label: 'repo', icon: GitFork }] : []),
    ...(pkg.reportUrl ? [{ href: pkg.reportUrl, label: 'report', icon: Flag }] : []),
  ]
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
      {links.map(({ href, label, icon: Icon }) => (
        <a
          key={label}
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <Icon className="size-3.5" />
          {label}
        </a>
      ))}
    </div>
  )
}

function PackageCard({ pkg }: { pkg: GlobalPackage }) {
  const [pending, setPending] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const SourceIcon = pkg.type === 'npm' ? Box : pkg.type === 'git' ? GitFork : HardDrive
  const ScopeIcon = pkg.scope === 'global' ? Globe2 : Folder
  const versionLabel =
    pkg.version === 'unknown'
      ? 'version unknown'
      : pkg.version.startsWith('v')
        ? pkg.version
        : `v${pkg.version}`

  const updatePackage = async () => {
    setPending('update')
    try {
      await postApiPackagesIdUpdate(pkg.id)
      refreshAfterMutation()
    } finally {
      setPending(null)
    }
  }

  const removePackage = async () => {
    setPending('remove')
    try {
      await deleteApiPackagesId(pkg.id)
      refreshAfterMutation()
    } finally {
      setPending(null)
      setConfirmRemove(false)
    }
  }

  return (
    <>
      <Panel className="flex flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center border border-border bg-panel">
              <PackageIcon className="size-4 text-accent" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-foreground">{pkg.name}</span>
                <Tag tone={statusTone[pkg.status]}>{statusLabel[pkg.status]}</Tag>
              </div>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
                <span className="flex max-w-full min-w-0 items-center gap-1.5" title={pkg.source}>
                  <SourceIcon className="size-3 shrink-0" />
                  <span className="truncate">{pkg.source}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <Hash className="size-3" />
                  {versionLabel}
                </span>
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <ScopeIcon className="size-3" />
                  {pkg.scope}
                </span>
                {pkg.downloads && (
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <Download className="size-3" />
                    {pkg.downloads}
                  </span>
                )}
              </div>
            </div>
          </div>
          {pkg.hasExtensions && (
            <span title="Contains executable extensions">
              <AlertTriangle className="size-4 text-warning" />
            </span>
          )}
        </div>

        <div className="flex-1 space-y-3 p-4">
          <p className="line-clamp-2 text-[13px] leading-snug text-muted-foreground">
            {pkg.description}
          </p>
          <ResourceBadges pkg={pkg} />
        </div>

        <div className="flex items-center justify-between border-t border-border bg-panel px-3 py-2">
          <div className="flex items-center gap-1">
            <ActionButton variant="ghost" title="Configure resources">
              <SlidersHorizontal className="size-3.5" />
            </ActionButton>
            <ActionButton
              variant="ghost"
              title="Update"
              onClick={updatePackage}
              disabled={pending === 'update'}
            >
              <RefreshCw className="size-3.5" />
            </ActionButton>
            <ActionButton variant="ghost" title="Open source">
              <ExternalLink className="size-3.5" />
            </ActionButton>
            <ActionButton
              variant="ghost"
              title="Remove"
              onClick={() => setConfirmRemove(true)}
              disabled={pending === 'remove'}
            >
              <Trash2 className="size-3.5" />
            </ActionButton>
          </div>
          <Tag tone="outline">{pkg.type}</Tag>
        </div>
      </Panel>
      <ConfirmDialog
        open={confirmRemove}
        title="Remove package"
        description={`Remove package "${pkg.name}"? This cannot be undone.`}
        confirmLabel="Remove package"
        busy={pending === 'remove'}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => void removePackage()}
      />
    </>
  )
}

const resourceTypes: Array<{ value: PiPackageTypeFilter; label: string }> = [
  { value: 'extension', label: 'Extension' },
  { value: 'skill', label: 'Skill' },
  { value: 'prompt', label: 'Prompt' },
  { value: 'theme', label: 'Theme' },
]

const sortOptions: Array<{ value: PiPackageSort; label: string }> = [
  { value: 'downloads', label: 'Most downloads' },
  { value: 'recent', label: 'Recently published' },
  { value: 'name', label: 'A-Z' },
]

function SearchCatalogView({ initialCatalog }: { initialCatalog: PiPackageCatalog }) {
  const [catalog, setCatalog] = useState(initialCatalog)
  const [query, setQuery] = useState('')
  const [type, setType] = useState<PiPackageTypeFilter | ''>('')
  const [sort, setSort] = useState<PiPackageSort>('downloads')
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [installTarget, setInstallTarget] = useState<GlobalPackage | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadCatalog = async (input: {
    name?: string
    type?: PiPackageTypeFilter | ''
    sort?: PiPackageSort
    page?: number
  }) => {
    const next = {
      name: input.name ?? query,
      type: input.type ?? type,
      sort: input.sort ?? sort,
      page: input.page ?? 1,
    }
    const params = new URLSearchParams()
    if (next.name.trim()) params.set('name', next.name.trim())
    if (next.type) params.set('type', next.type)
    params.set('sort', next.sort)
    if (next.page > 1) params.set('page', String(next.page))

    setLoading(true)
    setLoadError(null)
    try {
      const response = await fetch(`/api/packages/gallery?${params.toString()}`)
      if (!response.ok) throw new Error(`Pi catalog returned HTTP ${response.status}`)
      setCatalog((await response.json()) as PiPackageCatalog)
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : 'Unable to load the Pi package catalog.',
      )
    } finally {
      setLoading(false)
    }
  }

  const searchCatalog = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void loadCatalog({ page: 1 })
  }

  const resetCatalog = () => {
    setQuery('')
    setType('')
    setSort('downloads')
    void loadCatalog({ name: '', type: '', sort: 'downloads', page: 1 })
  }

  const installPackage = async () => {
    if (!installTarget) return
    const pkg = installTarget
    setPendingId(pkg.id)
    try {
      await postApiPackages({ source: pkg.source })
      refreshAfterMutation()
    } finally {
      setPendingId(null)
      setInstallTarget(null)
    }
  }
  return (
    <>
      <div className="scrollbar-thin flex-1 overflow-y-auto">
        <section className="border-b border-border px-5 py-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <Label>Recently published</Label>
            <span className="font-mono text-[11px] text-muted-foreground uppercase">Live feed</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {catalog.recentlyPublished.slice(0, 8).map((pkg) => (
              <article key={pkg.id} className="min-w-0 border border-border bg-panel px-3 py-3">
                <h3 className="truncate font-mono text-[13px] font-semibold text-foreground">
                  {pkg.name}
                </h3>
                <p className="mt-1 line-clamp-2 min-h-9 text-xs leading-relaxed text-muted-foreground">
                  {pkg.description || 'Published to the Pi package catalog.'}
                </p>
                <p className="mt-2 font-mono text-[11px] text-accent">{pkg.publishedAt}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="px-5 py-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <Label>All packages</Label>
            <span className="font-mono text-xs text-muted-foreground">
              {catalog.start}-{catalog.end} / {catalog.total || 0}
            </span>
          </div>

          <form
            onSubmit={searchCatalog}
            className="grid gap-2 border-y border-border bg-panel p-3 lg:grid-cols-[minmax(0,1fr)_180px_180px_auto]"
          >
            <TextInput
              value={query}
              onChange={setQuery}
              placeholder="Filter packages…"
              icon={<Search className="size-3.5" />}
            />
            <select
              aria-label="Package type"
              value={type}
              onChange={(event) => {
                const next = event.target.value as PiPackageTypeFilter | ''
                setType(next)
                void loadCatalog({ type: next, page: 1 })
              }}
              className="h-9 border border-input bg-card px-3 font-mono text-xs text-foreground outline-none focus:border-ring"
            >
              <option value="">All types</option>
              {resourceTypes.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <select
              aria-label="Package sorting"
              value={sort}
              onChange={(event) => {
                const next = event.target.value as PiPackageSort
                setSort(next)
                void loadCatalog({ sort: next, page: 1 })
              }}
              className="h-9 border border-input bg-card px-3 font-mono text-xs text-foreground outline-none focus:border-ring"
            >
              {sortOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <ActionButton variant="accent" type="submit" disabled={loading}>
                {loading ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Search className="size-3.5" />
                )}
                Search
              </ActionButton>
              <ActionButton
                type="button"
                onClick={resetCatalog}
                disabled={loading}
                title="Reset filters"
              >
                <RotateCcw className="size-3.5" />
              </ActionButton>
            </div>
          </form>

          {loadError && (
            <p className="mt-3 border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {loadError}
            </p>
          )}

          {loading ? (
            <CatalogSkeleton />
          ) : catalog.packages.length === 0 ? (
            <Empty className="py-20">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Search />
                </EmptyMedia>
                <EmptyTitle>No catalog results</EmptyTitle>
                <EmptyDescription>
                  No Pi packages match this search. Try changing the name, type, or sorting.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {catalog.packages.map((pkg) => (
                <CatalogPackageCard
                  key={pkg.id}
                  pkg={pkg}
                  installing={pendingId === pkg.id}
                  onInstall={() => setInstallTarget(pkg)}
                />
              ))}
            </div>
          )}

          <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
            <ActionButton
              type="button"
              onClick={() => void loadCatalog({ page: catalog.page - 1 })}
              disabled={loading || catalog.page <= 1}
            >
              <ArrowLeft className="size-3.5" />
              Previous
            </ActionButton>
            <span className="font-mono text-xs text-muted-foreground">
              Page {catalog.page} of {catalog.totalPages}
            </span>
            <ActionButton
              type="button"
              onClick={() => void loadCatalog({ page: catalog.page + 1 })}
              disabled={loading || catalog.page >= catalog.totalPages}
            >
              Next
              <ArrowRight className="size-3.5" />
            </ActionButton>
          </div>
        </section>
      </div>
      <ConfirmDialog
        open={installTarget !== null}
        title="Install package"
        description={`Install "${installTarget?.name ?? ''}" from pi.dev? Packages may execute arbitrary code through extensions.`}
        confirmLabel="Install package"
        busy={pendingId === installTarget?.id}
        onCancel={() => setInstallTarget(null)}
        onConfirm={() => void installPackage()}
      />
    </>
  )
}

function CatalogSkeleton() {
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="grid min-h-52 grid-cols-[152px_1fr] border border-border">
          <Skeleton className="rounded-none border-r border-border" />
          <div className="flex flex-col gap-3 p-4">
            <Skeleton className="h-4 w-2/3 rounded-none" />
            <Skeleton className="h-3 w-full rounded-none" />
            <Skeleton className="h-3 w-4/5 rounded-none" />
            <Skeleton className="mt-8 h-9 rounded-none" />
          </div>
        </div>
      ))}
    </div>
  )
}

function CatalogPackageCard({
  pkg,
  installing,
  onInstall,
}: {
  pkg: GlobalPackage
  installing: boolean
  onInstall: () => void
}) {
  return (
    <article className="grid min-h-52 grid-cols-[116px_1fr] border border-border bg-card sm:grid-cols-[180px_1fr]">
      <div className="relative border-r border-border bg-panel p-4">
        <div className="absolute inset-4 border border-border bg-[repeating-linear-gradient(0deg,transparent,transparent_15px,rgba(120,120,120,0.18)_16px),repeating-linear-gradient(90deg,transparent,transparent_15px,rgba(120,120,120,0.18)_16px)]" />
        <div className="absolute right-6 bottom-8 left-6 h-px bg-accent/70" />
        <div className="absolute bottom-6 left-6 h-px w-2/3 bg-muted-foreground/50" />
      </div>
      <div className="flex min-w-0 flex-col p-4">
        <div className="min-w-0">
          <h3 className="truncate font-mono text-sm font-semibold text-foreground">{pkg.name}</h3>
          <p className="mt-2 line-clamp-2 min-h-10 text-[13px] leading-relaxed text-muted-foreground">
            {pkg.description || 'No package description provided.'}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
          {pkg.author && <span>{pkg.author}</span>}
          {pkg.downloads && <span>{pkg.downloads}</span>}
          {pkg.publishedAt && <span>{pkg.publishedAt}</span>}
        </div>
        <div className="mt-3">
          <ResourceBadges pkg={pkg} />
        </div>
        <CatalogLinks pkg={pkg} />
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-3">
          <code className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
            $ pi install {pkg.source}
          </code>
          <ActionButton variant="accent" onClick={onInstall} disabled={installing}>
            {installing ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            Install
          </ActionButton>
        </div>
      </div>
    </article>
  )
}

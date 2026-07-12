'use client'

import { useState } from 'react'
import {
  Search,
  Plus,
  RefreshCw,
  Trash2,
  ExternalLink,
  SlidersHorizontal,
  AlertTriangle,
  Package as PackageIcon,
  X,
  Download,
} from 'lucide-react'
import type { GlobalPackage, PackageStatus } from '@/lib/types'
import { deleteApiPackagesId } from '@/lib/api/generated/clients/deleteApiPackagesId'
import { postApiPackages } from '@/lib/api/generated/clients/postApiPackages'
import { postApiPackagesIdUpdate } from '@/lib/api/generated/clients/postApiPackagesIdUpdate'
import { refreshAfterMutation } from '@/lib/api/refresh'
import {
  ActionButton,
  BracketButton,
  CommandBox,
  ConfirmDialog,
  Label,
  PageHeader,
  Panel,
  Tag,
  TextInput,
} from '@/components/pi-ui'

const statusTone: Record<
  PackageStatus,
  'success' | 'warning' | 'accent' | 'danger'
> = {
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

export function PackagesView({
  installed,
  gallery,
}: {
  installed: GlobalPackage[]
  gallery: GlobalPackage[]
}) {
  const [query, setQuery] = useState('')
  const [showGallery, setShowGallery] = useState(false)
  const [showInstall, setShowInstall] = useState(false)
  const [scope, setScope] = useState<'global' | 'project'>('global')

  const filtered = installed.filter(
    (p) =>
      p.scope === scope &&
      (!query ||
        p.name.toLowerCase().includes(query.toLowerCase()) ||
        p.description.toLowerCase().includes(query.toLowerCase())),
  )

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Packages"
        subtitle="Resource sources installed from npm, git, URL, or local paths. Packages can contain extensions, skills, prompts, and themes."
      >
        <ActionButton onClick={() => setShowGallery(true)}>
          <Search className="size-3.5" />
          Browse pi.dev
        </ActionButton>
        <ActionButton
          variant="accent"
          onClick={() => setShowInstall(true)}
        >
          <Plus className="size-3.5" />
          Install
        </ActionButton>
      </PageHeader>

      {/* Security notice */}
      <div className="flex items-start gap-2.5 border-b border-warning/30 bg-warning/10 px-6 py-2.5">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
        <p className="text-[13px] text-foreground/80">
          Pi packages can execute arbitrary code through extensions. Review the
          source before installing third-party packages.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-3">
        <TextInput
          value={query}
          onChange={setQuery}
          placeholder="Filter packages…"
          icon={<Search className="size-3.5" />}
          className="w-64"
        />
        <BracketButton active={scope === 'global'} onClick={() => setScope('global')}>
          Global
        </BracketButton>
        <BracketButton active={scope === 'project'} onClick={() => setScope('project')}>
          Project
        </BracketButton>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {filtered.length} installed
        </span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
        {installed.length === 0 ? (
          <PackagesEmptyState
            onBrowse={() => setShowGallery(true)}
            onInstall={() => setShowInstall(true)}
          />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
            <PackageIcon className="size-6 text-muted-foreground/50" />
            <p className="font-mono text-sm text-muted-foreground">
              No packages match your filters.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {filtered.map((p) => (
              <PackageCard key={p.id} pkg={p} />
            ))}
          </div>
        )}
      </div>

      {showGallery && (
        <GalleryDrawer
          gallery={gallery}
          scope={scope}
          onClose={() => setShowGallery(false)}
        />
      )}
      <InstallPackageDialog
        key={`${showInstall}:${scope}`}
        open={showInstall}
        initialScope={scope}
        onClose={() => setShowInstall(false)}
      />
    </div>
  )
}

function InstallPackageDialog({
  open,
  initialScope,
  onClose,
}: {
  open: boolean
  initialScope: 'global' | 'project'
  onClose: () => void
}) {
  const [source, setSource] = useState('')
  const [scope, setScope] = useState<'global' | 'project'>(initialScope)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const install = async () => {
    const value = source.trim()
    if (!value || busy) return
    setBusy(true)
    setError(null)
    try {
      await postApiPackages({ source: value, scope })
      refreshAfterMutation()
      onClose()
    } catch (installError) {
      setError(
        installError instanceof Error
          ? installError.message
          : 'Unable to install package.',
      )
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
          <h2 id="install-package-title" className="font-serif text-lg italic text-foreground">
            Install Pi package
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Install from npm, git, URL, or a local path.
          </p>
        </div>
        <div className="space-y-4 p-4">
          <div className="space-y-1.5">
            <Label>Package source</Label>
            <TextInput
              value={source}
              onChange={setSource}
              placeholder="npm:@scope/package"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Install scope</Label>
            <div className="flex gap-2">
              <BracketButton active={scope === 'global'} onClick={() => setScope('global')}>
                Global
              </BracketButton>
              <BracketButton active={scope === 'project'} onClick={() => setScope('project')}>
                Project
              </BracketButton>
            </div>
          </div>
          <div className="flex items-start gap-2 border border-warning/30 bg-warning/10 p-3 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
            Packages may execute arbitrary code through extensions. Review the source before installing.
          </div>
          {error && (
            <p className="border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border bg-panel px-4 py-3">
          <ActionButton onClick={onClose} disabled={busy}>Cancel</ActionButton>
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
    <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-4 py-24 text-center">
      <div className="flex size-14 items-center justify-center border border-border-strong bg-card">
        <PackageIcon className="size-6 text-muted-foreground" />
      </div>
      <div>
        <h2 className="font-serif text-2xl italic text-foreground">
          No packages installed
        </h2>
        <p className="mt-2 text-sm text-muted-foreground text-pretty">
          Install packages to bring in shared skills, prompts, extensions, and
          themes for your local Pi workspace.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <ActionButton onClick={onBrowse}>
          <Search className="size-3.5" />
          Browse pi.dev
        </ActionButton>
        <ActionButton variant="accent" onClick={onInstall} disabled={disabled}>
          <Download className="size-3.5" />
          Install
        </ActionButton>
      </div>
    </div>
  )
}

function ResourceBadges({ pkg }: { pkg: GlobalPackage }) {
  const r = pkg.resources
  const parts = [
    ['ext', r.extensions],
    ['skills', r.skills],
    ['prompts', r.prompts],
    ['themes', r.themes],
  ].filter(([, n]) => (n as number) > 0)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {parts.map(([k, n]) => (
        <Tag key={k as string} tone="outline">
          {n as number} {k as string}
        </Tag>
      ))}
    </div>
  )
}

function PackageCard({ pkg }: { pkg: GlobalPackage }) {
  const [pending, setPending] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

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
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center border border-border bg-panel">
              <PackageIcon className="size-4 text-accent" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-foreground">
                  {pkg.name}
                </span>
                <Tag tone={statusTone[pkg.status]}>
                  {statusLabel[pkg.status]}
                </Tag>
              </div>
              <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                {pkg.source} · {pkg.version} · {pkg.downloads}
              </p>
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

function GalleryDrawer({
  gallery,
  scope,
  onClose,
}: {
  gallery: GlobalPackage[]
  scope: 'global' | 'project'
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [pendingId, setPendingId] = useState<string | null>(null)
  const filtered = gallery.filter(
    (p) => !query || p.name.toLowerCase().includes(query.toLowerCase()),
  )

  const installPackage = async (pkg: GlobalPackage) => {
    setPendingId(pkg.id)
    try {
      await postApiPackages({ source: pkg.source, scope })
      refreshAfterMutation()
    } finally {
      setPendingId(null)
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-foreground/20"
      />
      <div className="relative flex h-full w-full max-w-lg flex-col border-l border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border bg-panel px-4 py-3">
          <div>
            <h2 className="font-serif text-lg italic text-foreground">
              pi.dev / packages
            </h2>
            <Label>discover &amp; install</Label>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="border-b border-border p-3">
          <TextInput
            value={query}
            onChange={setQuery}
            placeholder="Search package gallery…"
            icon={<Search className="size-3.5" />}
          />
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto scrollbar-thin p-4">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
              <PackageIcon className="size-6 text-muted-foreground/50" />
              <p className="font-mono text-sm text-muted-foreground">
                No pi.dev packages match this search.
              </p>
            </div>
          ) : filtered.map((p) => (
            <Panel key={p.id} className="p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm text-foreground">
                  {p.name}
                </span>
                {p.hasExtensions && (
                  <Tag tone="warning">
                    <AlertTriangle className="size-2.5" />
                    extension
                  </Tag>
                )}
              </div>
              <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                {p.author} · {p.downloads}
              </p>
              <p className="mt-2 text-[13px] leading-snug text-muted-foreground">
                {p.description}
              </p>
              <div className="mt-3">
                <ResourceBadges pkg={p} />
              </div>
              <div className="mt-3">
                <CommandBox command={`pi install ${p.source}`} />
              </div>
              <div className="mt-3 flex justify-end">
                <ActionButton
                  variant="accent"
                  onClick={() => installPackage(p)}
                  disabled={pendingId === p.id}
                >
                  <Download className="size-3.5" />
                  Install
                </ActionButton>
              </div>
            </Panel>
          ))}
        </div>
      </div>
    </div>
  )
}

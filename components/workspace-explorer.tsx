'use client'

import { useEffect, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  File,
  FileArchive,
  FileCode2,
  FileImage,
  FileJson2,
  FileMusic,
  FileText,
  Folder,
  Link,
  RotateCcw,
} from 'lucide-react'
import { Label } from '@/components/pi-ui'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

type WorkspaceEntry = {
  name: string
  path: string
  type: 'directory' | 'file' | 'symlink'
}

type DirectoryResponse = {
  entries?: WorkspaceEntry[]
  truncated?: boolean
  error?: string
}

type DirectoryState = {
  entries: WorkspaceEntry[]
  truncated: boolean
  loading: boolean
  error: string | null
}

const initialDirectoryState: DirectoryState = {
  entries: [],
  truncated: false,
  loading: true,
  error: null,
}

export function WorkspaceExplorer({
  sessionId,
  className,
}: {
  sessionId: string
  className?: string
}) {
  const [revision, setRevision] = useState(0)
  const [collapsed, setCollapsed] = useState(false)
  const root = useDirectory(sessionId, '', revision)

  return (
    <section
      className={cn(
        'flex flex-col border-t border-border bg-panel/40',
        collapsed ? 'shrink-0' : 'min-h-0 flex-1',
        className,
      )}
    >
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 pr-3 pl-2">
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="flex h-full min-w-0 flex-1 items-center gap-2 text-left transition-colors hover:text-foreground active:scale-[0.995]"
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand explorer' : 'Collapse explorer'}
        >
          {collapsed ? (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <Label className="text-foreground">Explorer</Label>
        </button>
        {!collapsed && (
          <button
            type="button"
            onClick={() => setRevision((value) => value + 1)}
            className="flex size-7 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-[0.98]"
            title="Refresh explorer"
            aria-label="Refresh explorer"
          >
            <RotateCcw className={cn('size-3.5', root.loading && 'animate-spin')} />
          </button>
        )}
      </div>
      {!collapsed && (
        <ScrollArea className="min-h-0 flex-1" viewportClassName="py-1 pr-2">
          <div key={revision}>
            {root.loading ? (
              <ExplorerSkeleton />
            ) : root.error ? (
              <ExplorerMessage tone="error">{root.error}</ExplorerMessage>
            ) : root.entries.length === 0 ? (
              <ExplorerMessage>This workspace is empty.</ExplorerMessage>
            ) : (
              <>
                {root.entries.map((entry) => (
                  <ExplorerEntry key={entry.path} entry={entry} depth={0} sessionId={sessionId} />
                ))}
                {root.truncated && <TruncatedMessage />}
              </>
            )}
          </div>
        </ScrollArea>
      )}
    </section>
  )
}

function ExplorerEntry({
  entry,
  depth,
  sessionId,
}: {
  entry: WorkspaceEntry
  depth: number
  sessionId: string
}) {
  const [expanded, setExpanded] = useState(false)
  const isDirectory = entry.type === 'directory'
  const Icon = isDirectory ? Folder : fileIcon(entry)

  if (!isDirectory) {
    return (
      <div
        className="flex h-7 min-w-0 items-center gap-1.5 pr-2 font-mono text-[12px] text-foreground/90"
        style={{ paddingLeft: depth * 14 + 24 }}
        title={entry.path}
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground/80" />
        <span className="truncate">{entry.name}</span>
      </div>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex h-7 w-full min-w-0 items-center gap-1.5 pr-2 font-mono text-[12px] text-foreground/90 transition-colors hover:bg-muted active:scale-[0.995]"
        style={{ paddingLeft: depth * 14 + 8 }}
        title={entry.path}
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <Folder className="size-3.5 shrink-0 text-accent/80" />
        <span className="truncate">{entry.name}</span>
      </button>
      {expanded && <ExplorerDirectory sessionId={sessionId} path={entry.path} depth={depth + 1} />}
    </div>
  )
}

function ExplorerDirectory({
  sessionId,
  path,
  depth,
}: {
  sessionId: string
  path: string
  depth: number
}) {
  const directory = useDirectory(sessionId, path, 0)

  if (directory.loading) {
    return (
      <p
        className="py-1 font-mono text-[10px] text-muted-foreground"
        style={{ paddingLeft: depth * 14 + 24 }}
      >
        Loading…
      </p>
    )
  }

  if (directory.error) {
    return (
      <p
        className="py-1 pr-2 font-mono text-[10px] text-destructive"
        style={{ paddingLeft: depth * 14 + 24 }}
      >
        {directory.error}
      </p>
    )
  }

  if (directory.entries.length === 0) {
    return (
      <p
        className="py-1 font-mono text-[10px] text-muted-foreground/70 italic"
        style={{ paddingLeft: depth * 14 + 24 }}
      >
        Empty
      </p>
    )
  }

  return (
    <div>
      {directory.entries.map((child) => (
        <ExplorerEntry key={child.path} entry={child} depth={depth} sessionId={sessionId} />
      ))}
      {directory.truncated && <TruncatedMessage depth={depth} />}
    </div>
  )
}

function useDirectory(sessionId: string, path: string, loadKey: number): DirectoryState {
  const [state, setState] = useState<DirectoryState>(initialDirectoryState)

  useEffect(() => {
    const controller = new AbortController()
    setState(initialDirectoryState)
    const query = new URLSearchParams({ sessionId })
    if (path) query.set('path', path)

    void fetch(`/api/workspace?${query.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as DirectoryResponse
        if (!response.ok) throw new Error(body.error ?? 'Unable to load this directory.')
        setState({
          entries: body.entries ?? [],
          truncated: body.truncated ?? false,
          loading: false,
          error: null,
        })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          entries: [],
          truncated: false,
          loading: false,
          error: error instanceof Error ? error.message : 'Unable to load this directory.',
        })
      })

    return () => controller.abort()
  }, [loadKey, path, sessionId])

  return state
}

function ExplorerSkeleton() {
  return (
    <div className="space-y-2 px-3 py-3" aria-label="Loading workspace files">
      {[72, 54, 84, 64, 46].map((width, index) => (
        <div
          key={width}
          className="flex items-center gap-2"
          style={{ paddingLeft: index % 2 ? 14 : 0 }}
        >
          <span className="size-3.5 animate-pulse bg-muted" />
          <span className="h-2.5 animate-pulse bg-muted" style={{ width: `${width}%` }} />
        </div>
      ))}
    </div>
  )
}

function ExplorerMessage({
  children,
  tone = 'default',
}: {
  children: React.ReactNode
  tone?: 'default' | 'error'
}) {
  return (
    <p
      className={cn(
        'px-4 py-6 text-center font-mono text-[11px] leading-relaxed',
        tone === 'error' ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {children}
    </p>
  )
}

function TruncatedMessage({ depth = 0 }: { depth?: number }) {
  return (
    <p
      className="py-1 pr-2 font-mono text-[10px] text-muted-foreground"
      style={{ paddingLeft: depth * 14 + 24 }}
    >
      Additional entries are hidden.
    </p>
  )
}

function fileIcon(entry: WorkspaceEntry) {
  if (entry.type === 'symlink') return Link

  const extension = entry.name.split('.').pop()?.toLowerCase()
  if (
    [
      'ts',
      'tsx',
      'js',
      'jsx',
      'mjs',
      'cjs',
      'css',
      'scss',
      'html',
      'sh',
      'py',
      'go',
      'rs',
    ].includes(extension ?? '')
  ) {
    return FileCode2
  }
  if (['json', 'jsonl', 'yaml', 'yml', 'toml'].includes(extension ?? '')) return FileJson2
  if (['md', 'mdx', 'txt', 'log', 'pdf'].includes(extension ?? '')) return FileText
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'].includes(extension ?? ''))
    return FileImage
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(extension ?? '')) return FileMusic
  if (['zip', 'gz', 'tgz', 'tar', 'rar', '7z'].includes(extension ?? '')) return FileArchive
  return File
}

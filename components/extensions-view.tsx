'use client'

import { useState } from 'react'
import { AlertTriangle, Puzzle, Search } from 'lucide-react'
import type { GlobalExtension } from '@/lib/types'
import {
  BracketButton,
  Label,
  PageHeader,
  Panel,
  Tag,
  TextInput,
  Toggle,
} from '@/components/pi-ui'

export function ExtensionsView({ extensions }: { extensions: GlobalExtension[] }) {
  const [items, setItems] = useState(extensions)
  const [scope, setScope] = useState<'global' | 'project'>('global')
  const [query, setQuery] = useState('')
  const [pendingSource, setPendingSource] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const filtered = items.filter(
    (extension) =>
      extension.scope === scope &&
      (!query ||
        extension.name.toLowerCase().includes(query.toLowerCase()) ||
        extension.source.toLowerCase().includes(query.toLowerCase()) ||
        extension.path.toLowerCase().includes(query.toLowerCase())),
  )

  const toggle = async (extension: GlobalExtension) => {
    setPendingSource(extension.source)
    setError(null)
    try {
      const response = await fetch('/api/extensions/toggle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: extension.source,
          scope: extension.scope,
          enabled: !extension.enabled,
        }),
      })
      const body = (await response.json()) as GlobalExtension[] | { error?: string }
      if (!response.ok || !Array.isArray(body)) {
        throw new Error(Array.isArray(body) ? 'Unable to update extension.' : body.error)
      }
      setItems(body)
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Unable to update extension.')
    } finally {
      setPendingSource(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Extensions"
        subtitle="Executable Pi extensions loaded from global and project packages."
      />
      <div className="flex items-start gap-2.5 border-b border-warning/30 bg-warning/10 px-6 py-2.5">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
        <p className="text-[13px] text-foreground/80">
          Extensions execute code inside the Pi agent runtime. Only enable sources you trust.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-3">
        <TextInput
          value={query}
          onChange={setQuery}
          placeholder="Filter extensions…"
          icon={<Search className="size-3.5" />}
          className="w-72"
        />
        <BracketButton active={scope === 'global'} onClick={() => setScope('global')}>
          Global
        </BracketButton>
        <BracketButton active={scope === 'project'} onClick={() => setScope('project')}>
          Project
        </BracketButton>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {filtered.length} extensions
        </span>
      </div>
      {error && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-6 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <Puzzle className="size-7 text-muted-foreground/50" />
            <div>
              <h2 className="font-serif text-xl italic text-foreground">No extensions found</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Install a Pi package containing extensions or switch the scope filter.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {filtered.map((extension) => (
              <Panel key={extension.id} className="flex flex-col">
                <div className="flex items-start justify-between gap-3 border-b border-border bg-panel p-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center border border-border bg-card">
                      <Puzzle className="size-4 text-accent" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm text-foreground">
                        {extension.name}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                        {extension.source}
                      </p>
                    </div>
                  </div>
                  <Toggle
                    checked={extension.enabled}
                    onChange={() => void toggle(extension)}
                    disabled={
                      !extension.packageManaged || pendingSource === extension.source
                    }
                  />
                </div>
                <div className="flex-1 space-y-3 p-4">
                  <div>
                    <Label>Path</Label>
                    <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                      {extension.path}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Tag tone={extension.enabled ? 'success' : 'outline'}>
                      {extension.enabled ? 'enabled' : 'disabled'}
                    </Tag>
                    <Tag tone="outline">{extension.scope}</Tag>
                    <Tag tone="outline">
                      {extension.packageManaged ? 'package' : 'local'}
                    </Tag>
                    {pendingSource === extension.source && <Tag tone="warning">saving</Tag>}
                  </div>
                </div>
              </Panel>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

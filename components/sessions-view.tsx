'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Search,
  Coins,
  GitBranch,
  MessageSquare,
  X,
  Folder,
  Play,
  Copy,
  Trash2,
  ExternalLink,
} from 'lucide-react'
import {
  PageHeader,
  Label,
  Tag,
  BracketButton,
  ActionButton,
  ConfirmDialog,
  TextInput,
  Panel,
  PanelHeader,
} from '@/components/pi-ui'
import type { AgentProfile, AgentSessionSummary } from '@/lib/types'
import { deleteApiSessionsId } from '@/lib/api/generated/clients/deleteApiSessionsId'
import { postApiSessions } from '@/lib/api/generated/clients/postApiSessions'
import { postApiSessionsIdDuplicate } from '@/lib/api/generated/clients/postApiSessionsIdDuplicate'
import { refreshAfterMutation } from '@/lib/api/refresh'
import { cn } from '@/lib/utils'

function agentName(agents: AgentProfile[], agentId: string) {
  return agents.find((a) => a.id === agentId)?.name ?? agentId
}

function formatCost(cost?: number) {
  if (cost == null) return '—'
  return `$${cost.toFixed(2)}`
}

function formatTokens(tokens?: number) {
  if (tokens == null) return '—'
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`
  return String(tokens)
}

export function SessionsView({
  agents,
  sessions,
}: {
  agents: AgentProfile[]
  sessions: AgentSessionSummary[]
}) {
  const [query, setQuery] = useState('')
  const [agentFilter, setAgentFilter] = useState<string>('all')
  const [tagFilter, setTagFilter] = useState<string>('all')
  const [selected, setSelected] = useState<AgentSessionSummary | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AgentSessionSummary | null>(
    null,
  )

  const allTags = useMemo(() => {
    const set = new Set<string>()
    sessions.forEach((s) => s.tags.forEach((t) => set.add(t)))
    return Array.from(set)
  }, [])

  const filtered = useMemo(() => {
    return sessions.filter((s) => {
      if (agentFilter !== 'all' && s.agentId !== agentFilter) return false
      if (tagFilter !== 'all' && !s.tags.includes(tagFilter)) return false
      if (query) {
        const q = query.toLowerCase()
        const hay = [
          s.name,
          s.firstUserMessage,
          s.lastMessagePreview,
          s.filePath,
          s.cwd,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [query, agentFilter, tagFilter])

  const createSession = async () => {
    const agentId =
      agentFilter !== 'all'
        ? agentFilter
        : window.prompt(
            `Start session for which agent?\n${agents
              .map((agent) => `${agent.name} (${agent.id})`)
              .join('\n')}`,
          )
    if (!agentId) return
    const agent = agents.find((item) => item.id === agentId || item.name === agentId)
    if (!agent) return window.alert('Agent not found')
    setPending('new')
    try {
      const session = await postApiSessions({
        agentId: agent.id,
        name: 'New conversation',
      })
      window.location.href = `/chat?agent=${agent.id}&session=${session.id}`
    } finally {
      setPending(null)
    }
  }

  const duplicateSession = async (session: AgentSessionSummary) => {
    setPending(`duplicate:${session.id}`)
    try {
      await postApiSessionsIdDuplicate(session.id)
      refreshAfterMutation()
    } finally {
      setPending(null)
    }
  }

  const deleteSession = async (session: AgentSessionSummary) => {
    setPending(`delete:${session.id}`)
    try {
      await deleteApiSessionsId(session.id)
      refreshAfterMutation()
    } finally {
      setPending(null)
      setDeleteTarget(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Sessions"
        subtitle="Browse, resume, and inspect every conversation across your agents."
      >
        <BracketButton onClick={createSession} disabled={pending === 'new'}>
          New session
        </BracketButton>
      </PageHeader>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-3">
        <TextInput
          value={query}
          onChange={setQuery}
          placeholder="Search sessions, messages, paths…"
          icon={<Search className="size-3.5" />}
          className="w-full max-w-xs"
        />
        <div className="flex items-center gap-1.5">
          <Label>Agent</Label>
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="border border-input bg-panel px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-ring"
          >
            <option value="all">all</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <Label>Tag</Label>
          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="border border-input bg-panel px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-ring"
          >
            <option value="all">all</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {filtered.length} / {sessions.length} sessions
        </span>
      </div>

      {/* Table + drawer */}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto">
          {sessions.length === 0 ? (
            <SessionsEmptyState onCreate={createSession} disabled={pending === 'new'} />
          ) : (
            <>
              <table className="w-full border-collapse text-left">
                <thead className="sticky top-0 z-10 bg-panel">
                  <tr className="border-b border-border">
                    {['Session', 'Agent', 'Messages', 'Tokens', 'Cost', 'Branches', 'Updated'].map(
                      (h) => (
                        <th
                          key={h}
                          className="whitespace-nowrap px-4 py-2.5 font-mono-label text-[11px] text-muted-foreground"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => setSelected(s)}
                      className={cn(
                        'cursor-pointer border-b border-border/70 transition-colors hover:bg-muted/60',
                        selected?.id === s.id && 'bg-accent/8',
                      )}
                    >
                      <td className="max-w-sm px-4 py-3">
                        <div className="truncate text-sm font-medium text-foreground">
                          {s.name ?? s.firstUserMessage ?? 'Untitled session'}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          {s.tags.slice(0, 3).map((t) => (
                            <Tag key={t} tone="outline">
                              {t}
                            </Tag>
                          ))}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="font-mono text-xs text-muted-foreground">
                          {agentName(agents, s.agentId)}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-foreground">
                        {s.messageCount}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {formatTokens(s.totalTokens)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {formatCost(s.totalCost)}
                      </td>
                      <td className="px-4 py-3">
                        {s.branchCount > 0 ? (
                          <span className="inline-flex items-center gap-1 font-mono text-xs text-accent">
                            <GitBranch className="size-3" />
                            {s.branchCount}
                          </span>
                        ) : (
                          <span className="font-mono text-xs text-muted-foreground/50">
                            —
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                        {s.updatedAt}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {filtered.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
                  <MessageSquare className="size-6 text-muted-foreground/50" />
                  <p className="font-mono text-sm text-muted-foreground">
                    No sessions match your filters.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Preview drawer */}
        {selected && (
          <aside className="flex w-96 shrink-0 flex-col border-l border-border bg-panel">
            <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <Label>Session detail</Label>
                <h2 className="mt-1 truncate text-sm font-medium text-foreground">
                  {selected.name ?? selected.firstUserMessage ?? 'Untitled'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close detail"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4">
              <div className="grid grid-cols-2 gap-px overflow-hidden border border-border bg-border">
                <Stat icon={<MessageSquare className="size-3" />} label="Messages" value={String(selected.messageCount)} />
                <Stat icon={<Coins className="size-3" />} label="Tokens" value={formatTokens(selected.totalTokens)} />
                <Stat icon={<Coins className="size-3" />} label="Cost" value={formatCost(selected.totalCost)} />
                <Stat icon={<GitBranch className="size-3" />} label="Branches" value={String(selected.branchCount)} />
              </div>

              <div className="mt-4 space-y-3">
                <Field label="Agent" value={agentName(agents, selected.agentId)} />
                <Field label="Created" value={selected.createdAt} />
                <Field label="Updated" value={selected.updatedAt} />
                <div>
                  <Label>Working directory</Label>
                  <div className="mt-1 flex items-center gap-1.5 border border-border bg-card px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                    <Folder className="size-3 shrink-0" />
                    <span className="truncate">{selected.cwd}</span>
                  </div>
                </div>
                <div>
                  <Label>Session file</Label>
                  <div className="mt-1 truncate border border-border bg-card px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                    {selected.filePath}
                  </div>
                </div>
              </div>

              {selected.firstUserMessage && (
                <Panel className="mt-4">
                  <PanelHeader>
                    <Label>First message</Label>
                  </PanelHeader>
                  <p className="p-3 text-sm leading-relaxed text-foreground">
                    {selected.firstUserMessage}
                  </p>
                </Panel>
              )}
              {selected.lastMessagePreview && (
                <Panel className="mt-3">
                  <PanelHeader>
                    <Label>Latest reply</Label>
                  </PanelHeader>
                  <p className="p-3 text-sm leading-relaxed text-muted-foreground">
                    {selected.lastMessagePreview}
                  </p>
                </Panel>
              )}

              {selected.tags.length > 0 && (
                <div className="mt-4">
                  <Label>Tags</Label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {selected.tags.map((t) => (
                      <Tag key={t} tone="accent">
                        {t}
                      </Tag>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
              <Link
                href={`/chat?agent=${selected.agentId}&session=${selected.id}`}
                className="flex-1"
              >
                <ActionButton variant="accent" className="w-full">
                  <Play className="size-3.5" />
                  Resume
                </ActionButton>
              </Link>
              <ActionButton title="Open in new window">
                <ExternalLink className="size-3.5" />
              </ActionButton>
              <ActionButton
                title="Duplicate"
                onClick={() => duplicateSession(selected)}
                disabled={pending === `duplicate:${selected.id}`}
              >
                <Copy className="size-3.5" />
              </ActionButton>
              <ActionButton
                variant="danger"
                title="Delete session"
                onClick={() => setDeleteTarget(selected)}
                disabled={pending === `delete:${selected.id}`}
              >
                <Trash2 className="size-3.5" />
              </ActionButton>
            </div>
          </aside>
        )}
      </div>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete session"
        description={`Delete session "${deleteTarget?.name ?? deleteTarget?.id ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete session"
        busy={
          deleteTarget ? pending === `delete:${deleteTarget.id}` : false
        }
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) void deleteSession(deleteTarget)
        }}
      />
    </div>
  )
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="bg-card p-3">
      <div className="flex items-center gap-1 text-muted-foreground">
        {icon}
        <span className="font-mono-label text-[10px]">{label}</span>
      </div>
      <div className="mt-1 font-mono text-lg text-foreground">{value}</div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label>{label}</Label>
      <span className="truncate font-mono text-xs text-foreground">{value}</span>
    </div>
  )
}

function SessionsEmptyState({
  onCreate,
  disabled,
}: {
  onCreate: () => void
  disabled?: boolean
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-4 py-24 text-center">
      <div className="flex size-14 items-center justify-center border border-border-strong bg-card">
        <MessageSquare className="size-6 text-muted-foreground" />
      </div>
      <div>
        <h2 className="font-serif text-2xl italic text-foreground">
          No sessions yet
        </h2>
        <p className="mt-2 text-sm text-muted-foreground text-pretty">
          Start a conversation from an agent to create the first session, then
          come back here to inspect history, tokens, branches, and files.
        </p>
      </div>
      <ActionButton variant="accent" onClick={onCreate} disabled={disabled}>
        <MessageSquare className="size-3.5" />
        New session
      </ActionButton>
    </div>
  )
}

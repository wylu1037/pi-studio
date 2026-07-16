'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
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
  Pencil,
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
import { errorMessage, showToast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

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
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [agentFilter, setAgentFilter] = useState<string>('all')
  const [tagFilter, setTagFilter] = useState<string>('all')
  const [selected, setSelected] = useState<AgentSessionSummary | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AgentSessionSummary | null>(null)
  const [editTarget, setEditTarget] = useState<AgentSessionSummary | null>(null)
  const [editName, setEditName] = useState('')
  const [editCwd, setEditCwd] = useState('')
  const [showNewSession, setShowNewSession] = useState(false)
  const [newAgentId, setNewAgentId] = useState('')
  const [newSessionName, setNewSessionName] = useState('New conversation')
  const [newSessionCwd, setNewSessionCwd] = useState('')

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
        const hay = [s.name, s.firstUserMessage, s.lastMessagePreview, s.filePath, s.cwd]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [query, agentFilter, tagFilter])

  const openNewSession = () => {
    const agent =
      agents.find((item) => item.id === agentFilter) ??
      agents.find((item) => item.id === newAgentId) ??
      agents[0]
    if (!agent) {
      showToast({ tone: 'error', title: 'No agent available', message: 'Create an agent first.' })
      return
    }
    setNewAgentId(agent.id)
    setNewSessionName('New conversation')
    setNewSessionCwd(agent.defaultCwd ?? '')
    setShowNewSession(true)
  }

  const createSession = async () => {
    const agent = agents.find((item) => item.id === newAgentId)
    if (!agent || !newSessionName.trim()) return
    setPending('new')
    try {
      const session = await postApiSessions({
        agentId: agent.id,
        name: newSessionName.trim(),
        cwd: newSessionCwd.trim() || agent.defaultCwd,
      })
      showToast({
        tone: 'success',
        title: 'Session created',
        message: `Started "${newSessionName.trim()}" with ${agent.name}.`,
      })
      setShowNewSession(false)
      router.push(`/chat?agent=${agent.id}&session=${session.id}`)
      router.refresh()
    } catch (error) {
      showToast({
        tone: 'error',
        title: 'Unable to create session',
        message: errorMessage(error, 'Session creation failed.'),
      })
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

  const openEdit = (session: AgentSessionSummary) => {
    setEditTarget(session)
    setEditName(session.name ?? session.firstUserMessage ?? 'Untitled session')
    setEditCwd(session.cwd)
  }

  const saveSession = async () => {
    if (!editTarget || !editName.trim() || !editCwd.trim()) return
    setPending(`edit:${editTarget.id}`)
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(editTarget.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), cwd: editCwd.trim() }),
      })
      if (!response.ok) throw new Error('Failed to update session')
      setEditTarget(null)
      refreshAfterMutation()
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Sessions"
        subtitle="Browse, resume, and inspect every conversation across your agents."
      >
        <BracketButton onClick={openNewSession} disabled={pending === 'new'}>
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
          <Select
            value={agentFilter}
            onValueChange={(value) => {
              if (value !== null) setAgentFilter(value)
            }}
          >
            <SelectTrigger size="sm" className="min-w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              <SelectItem value="all">all</SelectItem>
              {agents.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1.5">
          <Label>Tag</Label>
          <Select
            value={tagFilter}
            onValueChange={(value) => {
              if (value !== null) setTagFilter(value)
            }}
          >
            <SelectTrigger size="sm" className="min-w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              <SelectItem value="all">all</SelectItem>
              {allTags.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {filtered.length} / {sessions.length} sessions
        </span>
      </div>

      {/* Sessions table */}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto">
          {sessions.length === 0 ? (
            <SessionsEmptyState onCreate={openNewSession} disabled={pending === 'new'} />
          ) : (
            <>
              <table className="w-full border-collapse text-left">
                <thead className="sticky top-0 z-10 bg-panel">
                  <tr className="border-b border-border">
                    {[
                      'Session',
                      'Agent',
                      'Messages',
                      'Tokens',
                      'Cost',
                      'Branches',
                      'Updated',
                      'Actions',
                    ].map((h) => (
                      <th
                        key={h}
                        className="font-mono-label px-4 py-2.5 text-[11px] whitespace-nowrap text-muted-foreground"
                      >
                        {h}
                      </th>
                    ))}
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
                      <td className="px-4 py-3 whitespace-nowrap">
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
                          <span className="font-mono text-xs text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs whitespace-nowrap text-muted-foreground">
                        {s.updatedAt}
                      </td>
                      <td
                        className="px-4 py-3 whitespace-nowrap"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className="flex items-center gap-0.5">
                          <ActionButton
                            variant="ghost"
                            title="Edit session"
                            onClick={() => openEdit(s)}
                          >
                            <Pencil className="size-3.5" />
                          </ActionButton>
                          <ActionButton
                            variant="ghost"
                            title="Delete session"
                            onClick={() => setDeleteTarget(s)}
                            disabled={pending === `delete:${s.id}`}
                          >
                            <Trash2 className="size-3.5" />
                          </ActionButton>
                        </div>
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
          <div
            className="fixed inset-0 z-40 flex justify-end"
            role="dialog"
            aria-modal="true"
            aria-label="Session detail"
          >
            <button
              type="button"
              aria-label="Close session detail"
              onClick={() => setSelected(null)}
              className="absolute inset-0 bg-foreground/20 backdrop-blur-[1px]"
            />
            <aside className="relative flex h-full w-full max-w-[440px] flex-col border-l border-border bg-panel shadow-[-24px_0_64px_-36px_rgba(0,0,0,0.45)]">
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
                  <Stat
                    icon={<MessageSquare className="size-3" />}
                    label="Messages"
                    value={String(selected.messageCount)}
                  />
                  <Stat
                    icon={<Coins className="size-3" />}
                    label="Tokens"
                    value={formatTokens(selected.totalTokens)}
                  />
                  <Stat
                    icon={<Coins className="size-3" />}
                    label="Cost"
                    value={formatCost(selected.totalCost)}
                  />
                  <Stat
                    icon={<GitBranch className="size-3" />}
                    label="Branches"
                    value={String(selected.branchCount)}
                  />
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
                <ActionButton
                  variant="accent"
                  className="flex-1"
                  onClick={() =>
                    router.push(
                      `/chat?agent=${encodeURIComponent(selected.agentId)}&session=${encodeURIComponent(selected.id)}`,
                    )
                  }
                >
                  <Play className="size-3.5" />
                  Resume
                </ActionButton>
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
          </div>
        )}
      </div>
      {showNewSession && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-session-title"
        >
          <button
            type="button"
            aria-label="Close new session dialog"
            onClick={pending === 'new' ? undefined : () => setShowNewSession(false)}
            className="absolute inset-0 bg-foreground/25 backdrop-blur-[1px]"
          />
          <form
            className="relative w-full max-w-lg border border-border-strong bg-card shadow-[0_24px_80px_-36px_rgba(0,0,0,0.55)]"
            onSubmit={(event) => {
              event.preventDefault()
              void createSession()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && pending !== 'new') setShowNewSession(false)
            }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border bg-panel px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-accent">
                  <MessageSquare className="size-4" />
                  <Label>New session</Label>
                </div>
                <h2 id="new-session-title" className="mt-1.5 text-lg font-semibold text-foreground">
                  Start a clean conversation
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Choose the agent and working directory before opening Chat.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewSession(false)}
                disabled={pending === 'new'}
                className="flex size-8 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-[0.98] disabled:opacity-40"
                aria-label="Close new session dialog"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-5">
              <label className="block space-y-2">
                <Label>Agent</Label>
                <Select
                  value={newAgentId}
                  onValueChange={(value) => {
                    if (value === null) return
                    const agent = agents.find((item) => item.id === value)
                    setNewAgentId(value)
                    setNewSessionCwd(agent?.defaultCwd ?? '')
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    {agents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <label className="block space-y-2">
                <Label>Session name</Label>
                <input
                  value={newSessionName}
                  onChange={(event) => setNewSessionName(event.target.value)}
                  placeholder="New conversation"
                  className="w-full border border-input bg-panel px-3 py-2.5 text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground/60 focus:border-ring"
                  autoFocus
                />
              </label>

              <label className="block space-y-2">
                <Label>Working directory</Label>
                <div className="flex items-center border border-input bg-panel focus-within:border-ring">
                  <Folder className="ml-3 size-3.5 shrink-0 text-muted-foreground" />
                  <input
                    value={newSessionCwd}
                    onChange={(event) => setNewSessionCwd(event.target.value)}
                    placeholder="Use the agent default"
                    className="min-w-0 flex-1 bg-transparent px-2.5 py-2.5 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Leave empty to use the selected agent&apos;s default directory.
                </p>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border bg-panel px-5 py-3.5">
              <ActionButton onClick={() => setShowNewSession(false)} disabled={pending === 'new'}>
                Cancel
              </ActionButton>
              <ActionButton
                type="submit"
                variant="accent"
                disabled={!newAgentId || !newSessionName.trim() || pending === 'new'}
              >
                {pending === 'new' ? 'Creating' : 'Create session'}
              </ActionButton>
            </div>
          </form>
        </div>
      )}
      {editTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-session-title"
        >
          <button
            type="button"
            aria-label="Close edit session"
            onClick={() => setEditTarget(null)}
            className="absolute inset-0 bg-foreground/25"
          />
          <form
            className="relative w-full max-w-md border border-border bg-card shadow-xl"
            onSubmit={(event) => {
              event.preventDefault()
              void saveSession()
            }}
          >
            <div className="border-b border-border bg-panel px-4 py-3">
              <h2 id="edit-session-title" className="font-serif text-lg text-foreground italic">
                Edit session
              </h2>
            </div>
            <div className="space-y-4 px-4 py-4">
              <label className="block space-y-1.5">
                <Label>Name</Label>
                <input
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  className="w-full border border-input bg-panel px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
                  autoFocus
                />
              </label>
              <label className="block space-y-1.5">
                <Label>Working directory</Label>
                <input
                  value={editCwd}
                  onChange={(event) => setEditCwd(event.target.value)}
                  className="w-full border border-input bg-panel px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-ring"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-border bg-panel px-4 py-3">
              <ActionButton
                onClick={() => setEditTarget(null)}
                disabled={pending === `edit:${editTarget.id}`}
              >
                Cancel
              </ActionButton>
              <ActionButton
                type="submit"
                variant="accent"
                disabled={
                  !editName.trim() || !editCwd.trim() || pending === `edit:${editTarget.id}`
                }
              >
                Save changes
              </ActionButton>
            </div>
          </form>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete session"
        description={`Delete session "${deleteTarget?.name ?? deleteTarget?.id ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete session"
        busy={deleteTarget ? pending === `delete:${deleteTarget.id}` : false}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) void deleteSession(deleteTarget)
        }}
      />
    </div>
  )
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
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

function SessionsEmptyState({ onCreate, disabled }: { onCreate: () => void; disabled?: boolean }) {
  return (
    <Empty className="py-24">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MessageSquare />
        </EmptyMedia>
        <EmptyTitle>No sessions yet</EmptyTitle>
        <EmptyDescription>
          Start a conversation from an agent to create the first session, then come back here to
          inspect history, tokens, branches, and files.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <ActionButton variant="accent" onClick={onCreate} disabled={disabled}>
          <MessageSquare className="size-3.5" />
          New session
        </ActionButton>
      </EmptyContent>
    </Empty>
  )
}

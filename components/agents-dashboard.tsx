'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Search,
  Plus,
  Copy,
  Trash2,
  MessageSquare,
  SlidersHorizontal,
  Sparkles,
  FileText,
  Plug,
  History,
  Clock,
  Cpu,
  Brain,
} from 'lucide-react'
import type { AgentProfile } from '@/lib/types'
import { deleteApiAgentsId } from '@/lib/api/generated/clients/deleteApiAgentsId'
import { postApiAgents } from '@/lib/api/generated/clients/postApiAgents'
import { postApiAgentsIdDuplicate } from '@/lib/api/generated/clients/postApiAgentsIdDuplicate'
import { refreshAfterMutation } from '@/lib/api/refresh'
import {
  ActionButton,
  BracketButton,
  ConfirmDialog,
  Label,
  PageHeader,
  Tag,
  TextInput,
} from '@/components/pi-ui'

export function AgentsDashboard({ agents }: { agents: AgentProfile[] }) {
  const [query, setQuery] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AgentProfile | null>(null)

  const tags = useMemo(() => Array.from(new Set(agents.flatMap((a) => a.tags))), [agents])

  const filtered = agents.filter((a) => {
    const matchesQuery =
      !query ||
      a.name.toLowerCase().includes(query.toLowerCase()) ||
      a.description?.toLowerCase().includes(query.toLowerCase())
    const matchesTag = !activeTag || a.tags.includes(activeTag)
    return matchesQuery && matchesTag
  })

  const createNewAgent = async () => {
    setPendingId('new')
    try {
      await postApiAgents({
        name: 'New Agent',
        description: 'Describe this agent workflow.',
        tags: [],
        defaultThinkingLevel: 'medium',
      })
      refreshAfterMutation()
    } finally {
      setPendingId(null)
    }
  }

  const duplicateAgent = async (id: string) => {
    setPendingId(`duplicate:${id}`)
    try {
      await postApiAgentsIdDuplicate(id)
      refreshAfterMutation()
    } finally {
      setPendingId(null)
    }
  }

  const removeAgent = async (agent: AgentProfile) => {
    setPendingId(`delete:${agent.id}`)
    try {
      await deleteApiAgentsId(agent.id)
      refreshAfterMutation()
    } finally {
      setPendingId(null)
      setDeleteTarget(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Agents"
        subtitle="Named configuration profiles. Each agent bundles its own skills, prompts, MCP servers, and model range."
      >
        <ActionButton variant="accent" onClick={createNewAgent} disabled={pendingId === 'new'}>
          <Plus className="size-3.5" />
          New Agent
        </ActionButton>
      </PageHeader>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-3">
        <TextInput
          value={query}
          onChange={setQuery}
          placeholder="Search agents…"
          icon={<Search className="size-3.5" />}
          className="w-64"
        />
        <div className="flex items-center gap-1.5">
          <Label className="mr-1">Tags</Label>
          <BracketButton active={activeTag === null} onClick={() => setActiveTag(null)}>
            All
          </BracketButton>
          {tags.map((t) => (
            <BracketButton key={t} active={activeTag === t} onClick={() => setActiveTag(t)}>
              {t}
            </BracketButton>
          ))}
        </div>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {filtered.length} / {agents.length}
        </span>
      </div>

      {/* Grid */}
      <div className="scrollbar-thin flex-1 overflow-y-auto p-6">
        {filtered.length === 0 ? (
          <EmptyState onCreate={createNewAgent} disabled={pendingId === 'new'} />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onDuplicate={duplicateAgent}
                onDelete={setDeleteTarget}
                pendingId={pendingId}
              />
            ))}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete agent"
        description={`Delete agent "${deleteTarget?.name ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete agent"
        busy={deleteTarget ? pendingId === `delete:${deleteTarget.id}` : false}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) void removeAgent(deleteTarget)
        }}
      />
    </div>
  )
}

function AgentCard({
  agent,
  onDuplicate,
  onDelete,
  pendingId,
}: {
  agent: AgentProfile
  onDuplicate: (id: string) => void
  onDelete: (agent: AgentProfile) => void
  pendingId: string | null
}) {
  const stats = [
    { icon: Sparkles, value: agent.selectedSkillIds.length, label: 'skills' },
    { icon: FileText, value: agent.selectedPromptIds.length, label: 'prompts' },
    { icon: Plug, value: agent.selectedMcpConfigIds.length, label: 'mcp' },
    { icon: History, value: agent.sessionCount, label: 'sessions' },
  ]

  return (
    <div className="group flex flex-col border border-border bg-card transition-colors hover:border-border-strong">
      <div className="flex items-start gap-3 p-4">
        <div
          className="mt-0.5 flex size-9 shrink-0 items-center justify-center border"
          style={{
            backgroundColor: `color-mix(in oklch, ${agent.color} 14%, transparent)`,
            borderColor: `color-mix(in oklch, ${agent.color} 40%, transparent)`,
            color: agent.color,
          }}
        >
          <span className="font-serif text-lg italic">{agent.name.charAt(0)}</span>
        </div>
        <div className="min-w-0 flex-1">
          <Link
            href={`/agents/${agent.id}`}
            className="font-mono text-sm font-medium text-foreground hover:text-accent"
          >
            {agent.name}
          </Link>
          <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-muted-foreground">
            {agent.description}
          </p>
        </div>
      </div>

      {agent.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pt-3">
          {agent.tags.map((t) => (
            <Tag key={t} tone="outline">
              {t}
            </Tag>
          ))}
        </div>
      )}

      {/* Runtime profile */}
      <div
        className={`grid grid-cols-[minmax(0,1.6fr)_minmax(112px,0.8fr)] border-y border-border bg-panel/40 ${agent.tags.length > 0 ? 'mt-3' : ''}`}
      >
        <div className="min-w-0 px-4 py-3">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Cpu className="size-3.5" />
            <Label>Model</Label>
          </div>
          <p className="mt-1.5 truncate font-mono text-[12px] text-foreground">
            {agent.defaultModelId ?? 'Automatic selection'}
          </p>
          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
            {agent.defaultProviderId ?? 'Default provider'} · {agent.selectedModelIds.length}{' '}
            enabled
          </p>
        </div>
        <div className="border-l border-border px-4 py-3">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Brain className="size-3.5" />
            <Label>Reasoning</Label>
          </div>
          <p className="mt-1.5 font-mono text-[12px] text-foreground capitalize">
            {agent.defaultThinkingLevel}
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">default level</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4">
        {stats.map((s) => {
          const Icon = s.icon
          return (
            <div
              key={s.label}
              className="flex flex-col items-center gap-1 border-r border-border py-2.5 last:border-r-0"
            >
              <Icon className="size-3.5 text-muted-foreground" />
              <span className="font-mono text-sm text-foreground">{s.value}</span>
              <span className="font-mono-label text-[9px] text-muted-foreground">{s.label}</span>
            </div>
          )
        })}
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between border-t border-border bg-panel px-3 py-2">
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
          <Clock className="size-3" />
          {agent.lastUsed}
        </span>
        <div className="flex items-center gap-1">
          <Link href={`/chat?agent=${agent.id}`}>
            <ActionButton variant="accent" title="Start chat">
              <MessageSquare className="size-3.5" />
              Chat
            </ActionButton>
          </Link>
          <Link href={`/agents/${agent.id}`}>
            <ActionButton variant="ghost" title="Configure">
              <SlidersHorizontal className="size-3.5" />
            </ActionButton>
          </Link>
          <ActionButton
            variant="ghost"
            title="Duplicate"
            onClick={() => onDuplicate(agent.id)}
            disabled={pendingId === `duplicate:${agent.id}`}
          >
            <Copy className="size-3.5" />
          </ActionButton>
          <ActionButton
            variant="ghost"
            title="Delete"
            onClick={() => onDelete(agent)}
            disabled={pendingId === `delete:${agent.id}`}
          >
            <Trash2 className="size-3.5" />
          </ActionButton>
        </div>
      </div>
    </div>
  )
}

function EmptyState({ onCreate, disabled }: { onCreate: () => void; disabled?: boolean }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-4 py-24 text-center">
      <div className="flex size-14 items-center justify-center border border-border-strong bg-card">
        <Plus className="size-6 text-muted-foreground" />
      </div>
      <div>
        <h2 className="font-serif text-2xl text-foreground italic">No agents yet</h2>
        <p className="mt-2 text-sm text-pretty text-muted-foreground">
          Create your first agent by combining global skills, prompts, MCP servers, and a model.
          Agents keep your workflows organized.
        </p>
      </div>
      <ActionButton variant="accent" onClick={onCreate} disabled={disabled}>
        <Plus className="size-3.5" />
        New Agent
      </ActionButton>
    </div>
  )
}

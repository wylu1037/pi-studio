'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import {
  ArrowLeft,
  MessageSquare,
  Search,
  Check,
  X,
  Sparkles,
  FileText,
  Plug,
  Cpu,
  History,
  Coins,
} from 'lucide-react'
import type {
  AgentProfile,
  AgentSessionSummary,
  GlobalMcpConfig,
  GlobalModelProvider,
  GlobalPromptTemplate,
  GlobalSkill,
} from '@/lib/types'
import { deleteApiAgentsId } from '@/lib/api/generated/clients/deleteApiAgentsId'
import { patchApiAgentsId } from '@/lib/api/generated/clients/patchApiAgentsId'
import { patchApiAgentsIdResources } from '@/lib/api/generated/clients/patchApiAgentsIdResources'
import { postApiAgentsIdAssign } from '@/lib/api/generated/clients/postApiAgentsIdAssign'
import { postApiAgentsIdDuplicate } from '@/lib/api/generated/clients/postApiAgentsIdDuplicate'
import { refreshAfterMutation } from '@/lib/api/refresh'
import {
  ActionButton,
  ConfirmDialog,
  Label,
  Panel,
  Tag,
  TextInput,
  Toggle,
  BracketButton,
} from '@/components/pi-ui'
import { cn } from '@/lib/utils'

const TABS = [
  'Overview',
  'Skills',
  'Prompts',
  'MCP',
  'Models',
  'Sessions',
  'Settings',
] as const
type TabName = (typeof TABS)[number]
const thinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
const settingsSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  defaultCwd: z.string().optional(),
  tags: z.string().optional(),
})
type SettingsForm = z.infer<typeof settingsSchema>

export function AgentDetail({
  agent,
  skills,
  prompts,
  mcpConfigs,
  providers,
  sessions,
}: {
  agent: AgentProfile
  skills: GlobalSkill[]
  prompts: GlobalPromptTemplate[]
  mcpConfigs: GlobalMcpConfig[]
  providers: GlobalModelProvider[]
  sessions: AgentSessionSummary[]
}) {
  const [tab, setTab] = useState<TabName>('Overview')
  const [pending, setPending] = useState<string | null>(null)
  const [deleteRequested, setDeleteRequested] = useState(false)
  const router = useRouter()

  const duplicateAgent = async () => {
    setPending('duplicate')
    try {
      await postApiAgentsIdDuplicate(agent.id)
      refreshAfterMutation()
    } finally {
      setPending(null)
    }
  }

  const deleteAgent = async () => {
    setPending('delete')
    try {
      await deleteApiAgentsId(agent.id)
      router.push('/')
      router.refresh()
    } finally {
      setPending(null)
      setDeleteRequested(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <Link
          href="/"
          className="mb-3 inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Agents
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="flex size-11 items-center justify-center border"
              style={{
                backgroundColor: `color-mix(in oklch, ${agent.color} 14%, transparent)`,
                borderColor: `color-mix(in oklch, ${agent.color} 40%, transparent)`,
                color: agent.color,
              }}
            >
              <span className="font-serif text-2xl italic">
                {agent.name.charAt(0)}
              </span>
            </div>
            <div>
              <h1 className="font-serif text-2xl italic text-foreground">
                {agent.name}
              </h1>
              <div className="mt-1 flex items-center gap-1.5">
                {agent.tags.map((t) => (
                  <Tag key={t} tone="outline">
                    {t}
                  </Tag>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ActionButton onClick={duplicateAgent} disabled={pending === 'duplicate'}>
              Duplicate
            </ActionButton>
            <Link href={`/chat?agent=${agent.id}`}>
              <ActionButton variant="accent">
                <MessageSquare className="size-3.5" />
                Start Chat
              </ActionButton>
            </Link>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0 overflow-x-auto border-b border-border px-4">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'border-b-2 px-4 py-2.5 font-mono text-xs uppercase tracking-wider transition-colors',
              tab === t
                ? 'border-accent text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
        {tab === 'Overview' && <OverviewTab agent={agent} sessions={sessions} />}
        {tab === 'Skills' && (
          <ResourcePicker
            title="Skills"
            agentId={agent.id}
            kind="skill"
            items={skills.map((s) => ({
              id: s.id,
              name: s.name,
              description: s.description,
              tags: s.tags,
              meta: s.source,
            }))}
            selectedIds={agent.selectedSkillIds}
          />
        )}
        {tab === 'Prompts' && (
          <ResourcePicker
            title="Prompts"
            agentId={agent.id}
            kind="prompt"
            items={prompts.map((p) => ({
              id: p.id,
              name: p.name,
              description: p.description ?? '',
              tags: p.tags,
              meta: 'template',
            }))}
            selectedIds={agent.selectedPromptIds}
          />
        )}
        {tab === 'MCP' && (
          <ResourcePicker
            title="MCP configs"
            agentId={agent.id}
            kind="mcp"
            items={mcpConfigs.map((m) => ({
              id: m.id,
              name: m.name,
              description: m.description ?? '',
              tags: m.tags,
              meta: m.command,
            }))}
            selectedIds={agent.selectedMcpConfigIds}
          />
        )}
        {tab === 'Models' && <ModelsTab agent={agent} providers={providers} />}
        {tab === 'Sessions' && <SessionsTab agent={agent} sessions={sessions} />}
        {tab === 'Settings' && (
          <SettingsTab
            agent={agent}
            onDelete={() => setDeleteRequested(true)}
            deleting={pending === 'delete'}
          />
        )}
      </div>
      <ConfirmDialog
        open={deleteRequested}
        title="Delete agent"
        description={`Delete agent "${agent.name}"? This cannot be undone.`}
        confirmLabel="Delete agent"
        busy={pending === 'delete'}
        onCancel={() => setDeleteRequested(false)}
        onConfirm={() => void deleteAgent()}
      />
    </div>
  )
}

function OverviewTab({
  agent,
  sessions,
}: {
  agent: AgentProfile
  sessions: AgentSessionSummary[]
}) {
  const stats = [
    { icon: Sparkles, value: agent.selectedSkillIds.length, label: 'Skills' },
    { icon: FileText, value: agent.selectedPromptIds.length, label: 'Prompts' },
    { icon: Plug, value: agent.selectedMcpConfigIds.length, label: 'MCP' },
    { icon: Cpu, value: agent.selectedModelIds.length, label: 'Models' },
    { icon: History, value: agent.sessionCount, label: 'Sessions' },
  ]
  const meta = [
    ['Name', agent.name],
    ['Description', agent.description ?? '—'],
    ['Default working dir', agent.defaultCwd ?? '—'],
    ['Default provider', agent.defaultProviderId ?? '—'],
    ['Default model', agent.defaultModelId ?? '—'],
    ['Default thinking', agent.defaultThinkingLevel],
    ['Created', agent.createdAt],
    ['Updated', agent.updatedAt],
  ]

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {stats.map((s) => {
            const Icon = s.icon
            return (
              <Panel key={s.label} className="flex flex-col gap-1.5 p-3">
                <Icon className="size-4 text-accent" />
                <span className="font-serif text-2xl italic text-foreground">
                  {s.value}
                </span>
                <Label>{s.label}</Label>
              </Panel>
            )
          })}
        </div>

        <Panel>
          <div className="border-b border-border bg-panel px-4 py-2.5">
            <Label>Metadata</Label>
          </div>
          <dl className="divide-y divide-border">
            {meta.map(([k, v]) => (
              <div
                key={k}
                className="grid grid-cols-3 gap-4 px-4 py-2.5 text-sm"
              >
                <dt className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  {k}
                </dt>
                <dd className="col-span-2 font-mono text-[13px] text-foreground">
                  {v}
                </dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>

      <Panel className="h-fit">
        <div className="border-b border-border bg-panel px-4 py-2.5">
          <Label>Recent sessions</Label>
        </div>
        <ul className="divide-y divide-border">
          {sessions.length === 0 && (
            <li className="px-4 py-6 text-center font-mono text-xs text-muted-foreground">
              No sessions yet
            </li>
          )}
          {sessions.map((s) => (
            <li key={s.id} className="px-4 py-3">
              <p className="truncate font-mono text-[13px] text-foreground">
                {s.name}
              </p>
              <p className="mt-1 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                <span>{s.updatedAt}</span>
                <span>·</span>
                <span>{s.messageCount} msgs</span>
              </p>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}

interface PickerItem {
  id: string
  name: string
  description: string
  tags: string[]
  meta: string
}

function ResourcePicker({
  title,
  agentId,
  kind,
  items,
  selectedIds,
}: {
  title: string
  agentId: string
  kind: 'skill' | 'prompt' | 'mcp'
  items: PickerItem[]
  selectedIds: string[]
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(selectedIds))
  const [query, setQuery] = useState('')
  const [pendingId, setPendingId] = useState<string | null>(null)

  const toggle = async (id: string) => {
    const enabled = !selected.has(id)
    setPendingId(id)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    try {
      await postApiAgentsIdAssign(agentId, {
        kind,
        resourceId: id,
        enabled,
      })
    } catch (error) {
      setSelected((prev) => {
        const next = new Set(prev)
        if (enabled) next.delete(id)
        else next.add(id)
        return next
      })
      throw error
    } finally {
      setPendingId(null)
    }
  }

  const filtered = items.filter(
    (i) =>
      !query ||
      i.name.toLowerCase().includes(query.toLowerCase()) ||
      i.tags.some((t) => t.includes(query.toLowerCase())),
  )
  const enabled = items.filter((i) => selected.has(i.id))

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      {/* Global list */}
      <Panel>
        <div className="flex items-center justify-between gap-3 border-b border-border bg-panel px-4 py-2.5">
          <Label>Global {title}</Label>
          <TextInput
            value={query}
            onChange={setQuery}
            placeholder="Filter…"
            icon={<Search className="size-3.5" />}
            className="w-48"
          />
        </div>
        <ul className="divide-y divide-border">
          {filtered.map((item) => {
            const on = selected.has(item.id)
            return (
              <li
                key={item.id}
                className="flex items-start gap-3 px-4 py-3 hover:bg-panel"
              >
                <button
                  type="button"
                  onClick={() => toggle(item.id)}
                  disabled={pendingId === item.id}
                  className={cn(
                    'mt-0.5 flex size-4.5 shrink-0 items-center justify-center border transition-colors',
                    on
                      ? 'border-accent bg-accent text-accent-foreground'
                      : 'border-border-strong bg-card',
                  )}
                  aria-label={on ? 'Disable' : 'Enable'}
                >
                  {on && <Check className="size-3" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[13px] text-foreground">
                      {item.name}
                    </span>
                    <Tag tone="outline">{item.meta}</Tag>
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-[13px] text-muted-foreground">
                    {item.description}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      </Panel>

      {/* Enabled */}
      <Panel className="h-fit">
        <div className="flex items-center justify-between border-b border-border bg-panel px-4 py-2.5">
          <Label>Enabled</Label>
          <span className="font-mono text-xs text-accent">{enabled.length}</span>
        </div>
        {enabled.length === 0 ? (
          <p className="px-4 py-8 text-center font-mono text-xs text-muted-foreground">
            Nothing enabled yet
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {enabled.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-2 px-4 py-2.5"
              >
                <span className="truncate font-mono text-[13px] text-foreground">
                  {item.name}
                </span>
                <button
                  type="button"
                  onClick={() => toggle(item.id)}
                  disabled={pendingId === item.id}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Remove"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

function ModelsTab({
  agent,
  providers,
}: {
  agent: AgentProfile
  providers: GlobalModelProvider[]
}) {
  const [enabledProviders, setEnabledProviders] = useState(
    new Set(agent.selectedProviderIds),
  )
  const [enabledModels, setEnabledModels] = useState(
    new Set(agent.selectedModelIds),
  )
  const [thinking, setThinking] = useState(agent.defaultThinkingLevel)
  const [pending, setPending] = useState<string | null>(null)

  const toggleResource = async (
    kind: 'provider' | 'model',
    resourceId: string,
    selected: Set<string>,
    setSelected: React.Dispatch<React.SetStateAction<Set<string>>>,
  ) => {
    const enabled = !selected.has(resourceId)
    setPending(`${kind}:${resourceId}`)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(resourceId)) next.delete(resourceId)
      else next.add(resourceId)
      return next
    })
    try {
      await postApiAgentsIdAssign(agent.id, { kind, resourceId, enabled })
    } catch (error) {
      setSelected((prev) => {
        const next = new Set(prev)
        if (enabled) next.delete(resourceId)
        else next.add(resourceId)
        return next
      })
      throw error
    } finally {
      setPending(null)
    }
  }

  const setDefaultThinking = async (level: AgentProfile['defaultThinkingLevel']) => {
    setPending(`thinking:${level}`)
    const previous = thinking
    setThinking(level)
    try {
      await patchApiAgentsIdResources(agent.id, { defaultThinkingLevel: level })
    } catch (error) {
      setThinking(previous)
      throw error
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="space-y-6">
      <Panel>
        <div className="border-b border-border bg-panel px-4 py-2.5">
          <Label>Allowed providers &amp; models</Label>
        </div>
        <div className="divide-y divide-border">
          {providers.map((p) => {
            const pOn = enabledProviders.has(p.id)
            return (
              <div key={p.id}>
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Toggle
                      checked={pOn}
                      onChange={() =>
                        toggleResource(
                          'provider',
                          p.id,
                          enabledProviders,
                          setEnabledProviders,
                        )
                      }
                    />
                    <span className="font-mono text-[13px] text-foreground">
                      {p.name}
                    </span>
                    <Tag tone="outline">{p.api}</Tag>
                  </div>
                  {agent.defaultProviderId === p.id && (
                    <Tag tone="accent">default</Tag>
                  )}
                </div>
                {pOn && (
                  <div className="grid pl-4 sm:grid-cols-2">
                    {p.models.map((m) => {
                      const resourceId = `${p.id}::${m.id}`
                      const mOn = enabledModels.has(resourceId)
                      return (
                        <label
                          key={resourceId}
                          className="flex cursor-pointer items-center gap-2.5 border-t border-border bg-card px-4 py-2.5 sm:odd:border-r"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              toggleResource(
                                'model',
                                resourceId,
                                enabledModels,
                                setEnabledModels,
                              )
                            }
                            disabled={pending === `model:${resourceId}`}
                            className={cn(
                              'flex size-4 items-center justify-center border',
                              mOn
                                ? 'border-accent bg-accent text-accent-foreground'
                                : 'border-border-strong bg-panel',
                            )}
                          >
                            {mOn && <Check className="size-2.5" />}
                          </button>
                          <span className="font-mono text-xs text-foreground">
                            {m.name}
                          </span>
                          {m.reasoning && <Tag tone="accent">reasoning</Tag>}
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Panel>

      <Panel className="p-4">
        <Label className="mb-3 block">Default thinking level</Label>
        <div className="flex flex-wrap gap-1.5">
          {thinkingLevels.map((lvl) => (
            <BracketButton
              key={lvl}
              active={thinking === lvl}
              onClick={() => setDefaultThinking(lvl)}
              disabled={pending === `thinking:${lvl}`}
            >
              {lvl}
            </BracketButton>
          ))}
        </div>
      </Panel>
    </div>
  )
}

function SessionsTab({
  agent,
  sessions,
}: {
  agent: AgentProfile
  sessions: AgentSessionSummary[]
}) {
  const list = sessions
  return (
    <Panel>
      <div className="flex items-center justify-between border-b border-border bg-panel px-4 py-2.5">
        <Label>Sessions for {agent.name}</Label>
        <span className="font-mono text-xs text-muted-foreground">
          {list.length} total
        </span>
      </div>
      {list.length === 0 ? (
        <p className="px-4 py-10 text-center font-mono text-xs text-muted-foreground">
          No sessions recorded for this agent.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-panel"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-[13px] text-foreground">
                  {s.name}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
                  <span>{s.cwd}</span>
                  <span className="flex items-center gap-1">
                    <History className="size-3" />
                    {s.messageCount}
                  </span>
                  <span className="flex items-center gap-1">
                    <Coins className="size-3" />${s.totalCost?.toFixed(2)}
                  </span>
                  <span>{s.branchCount} branches</span>
                  <span>{s.updatedAt}</span>
                </p>
              </div>
              <Link href={`/chat?agent=${agent.id}&session=${s.id}`}>
                <ActionButton>Open</ActionButton>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function SettingsTab({
  agent,
  onDelete,
  deleting,
}: {
  agent: AgentProfile
  onDelete: () => void
  deleting?: boolean
}) {
  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<SettingsForm>({
    resolver: zodResolver(settingsSchema as never),
    defaultValues: {
      name: agent.name,
      description: agent.description ?? '',
      defaultCwd: agent.defaultCwd ?? '',
      tags: agent.tags.join(', '),
    },
  })

  const save = async (values: SettingsForm) => {
    await patchApiAgentsId(agent.id, {
      name: values.name,
      description: values.description,
      defaultCwd: values.defaultCwd,
      tags: (values.tags ?? '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    })
    refreshAfterMutation()
  }

  return (
    <form onSubmit={handleSubmit(save)} className="max-w-2xl space-y-5">
      <Panel className="p-4 space-y-4">
        <Field label="Agent name" error={errors.name?.message}>
          <input
            {...register('name')}
            className="w-full border border-input bg-panel px-3 py-2 font-mono text-[13px] text-foreground outline-none focus:border-ring"
          />
        </Field>
        <Field label="Description">
          <textarea
            {...register('description')}
            rows={3}
            className="w-full resize-none border border-input bg-panel px-3 py-2 font-mono text-[13px] text-foreground outline-none focus:border-ring"
          />
        </Field>
        <Field label="Default working directory">
          <input
            {...register('defaultCwd')}
            className="w-full border border-input bg-panel px-3 py-2 font-mono text-[13px] text-foreground outline-none focus:border-ring"
          />
        </Field>
        <Field label="Tags (comma separated)">
          <input
            {...register('tags')}
            className="w-full border border-input bg-panel px-3 py-2 font-mono text-[13px] text-foreground outline-none focus:border-ring"
          />
        </Field>
      </Panel>
      <div className="flex items-center justify-between">
        <ActionButton
          variant="danger"
          onClick={onDelete}
          disabled={deleting || isSubmitting}
        >
          Delete agent
        </ActionButton>
        <ActionButton variant="accent" type="submit" disabled={isSubmitting}>
          Save changes
        </ActionButton>
      </div>
    </form>
  )
}

function Field({
  label,
  children,
  error,
}: {
  label: string
  children: React.ReactNode
  error?: string
}) {
  return (
    <div>
      <Label className="mb-1.5 block">{label}</Label>
      {children}
      {error && (
        <p className="mt-1 font-mono text-[11px] text-destructive">{error}</p>
      )}
    </div>
  )
}

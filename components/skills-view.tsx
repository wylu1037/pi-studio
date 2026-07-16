'use client'

import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import {
  AlertCircle,
  Search,
  RefreshCw,
  Download,
  FileText,
  Package,
  Sparkles,
  Eye,
  Pencil,
  Trash2,
  UserPlus,
  X,
  Check,
} from 'lucide-react'
import type { AgentProfile, GlobalSkill, SkillSource } from '@/lib/types'
import { deleteApiSkillsId } from '@/lib/api/generated/clients/deleteApiSkillsId'
import { getApiSkillsRegistrySearch } from '@/lib/api/generated/clients/getApiSkillsRegistrySearch'
import { postApiAgentsIdAssign } from '@/lib/api/generated/clients/postApiAgentsIdAssign'
import { postApiSkills } from '@/lib/api/generated/clients/postApiSkills'
import type { PostApiSkillsMutationRequest } from '@/lib/api/generated/types/PostApiSkills'
import { postApiSkillsMutationRequestSchema } from '@/lib/api/generated/zod/postApiSkillsSchema'
import { refreshAfterMutation } from '@/lib/api/refresh'
import { errorMessage, showToast } from '@/lib/toast'
import {
  ActionButton,
  BracketButton,
  ConfirmDialog,
  Label,
  PageHeader,
  Panel,
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
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

const sourceTone: Record<SkillSource, 'accent' | 'default' | 'outline'> = {
  'skills.sh': 'accent',
  local: 'default',
  git: 'outline',
  manual: 'outline',
}

type RegistrySkill = {
  id: string
  name: string
  author: string
  description: string
  tags: string[]
  installed: boolean
  source: string
  sourceType?: string
  installUrl?: string
  url?: string
  installs?: number
}

function formatRegistryInstalls(installs?: number) {
  if (typeof installs !== 'number') return 'installs unknown'
  if (installs >= 1_000_000) {
    return `${(installs / 1_000_000).toFixed(1).replace(/\.0$/, '')}M installs`
  }
  if (installs >= 1_000) {
    return `${(installs / 1_000).toFixed(1).replace(/\.0$/, '')}K installs`
  }
  return `${installs} install${installs === 1 ? '' : 's'}`
}

function registrySkillKey(skill: RegistrySkill) {
  return skill.installUrl || skill.id || `${skill.source}/${skill.name}`
}

export function SkillsView({ agents, skills }: { agents: AgentProfile[]; skills: GlobalSkill[] }) {
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<SkillSource | 'all'>('all')
  const [showBrowser, setShowBrowser] = useState(false)
  const [viewing, setViewing] = useState<GlobalSkill | null>(null)
  const [assigning, setAssigning] = useState<GlobalSkill | null>(null)
  const [editing, setEditing] = useState<GlobalSkill | null>(null)
  const [creating, setCreating] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [registryQuery, setRegistryQuery] = useState('')
  const [registry, setRegistry] = useState<RegistrySkill[]>([])
  const [registryLoading, setRegistryLoading] = useState(false)
  const [registryError, setRegistryError] = useState<string | null>(null)
  const [registryReloadKey, setRegistryReloadKey] = useState(0)
  const [deleteTarget, setDeleteTarget] = useState<GlobalSkill | null>(null)

  const filtered = skills.filter((s) => {
    const q =
      !query ||
      s.name.toLowerCase().includes(query.toLowerCase()) ||
      s.description.toLowerCase().includes(query.toLowerCase())
    const src = source === 'all' || s.source === source
    return q && src
  })

  const sources: (SkillSource | 'all')[] = ['all', 'skills.sh', 'local', 'git', 'manual']

  useEffect(() => {
    if (!showBrowser) return
    let alive = true
    setRegistryLoading(true)
    setRegistryError(null)
    getApiSkillsRegistrySearch({ q: registryQuery })
      .then((items) => {
        if (alive) setRegistry(items)
      })
      .catch((error) => {
        if (!alive) return
        setRegistry([])
        setRegistryError(
          error instanceof Error ? error.message : 'Unable to load skills.sh registry',
        )
      })
      .finally(() => {
        if (alive) setRegistryLoading(false)
      })
    return () => {
      alive = false
    }
  }, [showBrowser, registryQuery, registryReloadKey])

  const importManualSkill = () => {
    setEditing(null)
    setCreating(true)
  }

  const importRegistrySkill = async (skill: RegistrySkill) => {
    const importKey = registrySkillKey(skill)
    setPendingId(`import:${importKey}`)
    try {
      await postApiSkills({
        name: skill.name,
        author: skill.author,
        description: skill.description,
        source: 'skills.sh',
        path: skill.installUrl || `skills.sh/${skill.id || skill.source || skill.name}`,
        tags: skill.tags,
      })
      refreshAfterMutation(`${skill.name} imported successfully.`)
    } catch (error) {
      showToast({
        tone: 'error',
        title: 'Import failed',
        message: errorMessage(error, 'Unable to import skill.'),
      })
    } finally {
      setPendingId(null)
    }
  }

  const deleteSkill = async (skill: GlobalSkill) => {
    setPendingId(`delete:${skill.id}`)
    try {
      await deleteApiSkillsId(skill.id)
      refreshAfterMutation()
    } finally {
      setPendingId(null)
      setDeleteTarget(null)
    }
  }

  const assignSkill = async (skill: GlobalSkill, agent: AgentProfile, enabled: boolean) => {
    const key = `assign:${skill.id}:${agent.id}`
    setPendingId(key)
    try {
      await postApiAgentsIdAssign(agent.id, {
        kind: 'skill',
        resourceId: skill.id,
        enabled,
      })
      refreshAfterMutation()
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Skills"
        subtitle="The global skill pool. Enable skills per-agent from their configuration. Import from skills.sh, git, or local directories."
      >
        <ActionButton onClick={() => setShowBrowser(true)}>
          <Search className="size-3.5" />
          Browse skills.sh
        </ActionButton>
        <ActionButton variant="accent" onClick={importManualSkill}>
          <Download className="size-3.5" />
          Import
        </ActionButton>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-3">
        <TextInput
          value={query}
          onChange={setQuery}
          placeholder="Search local skills…"
          icon={<Search className="size-3.5" />}
          className="w-64"
        />
        <div className="flex items-center gap-1.5">
          <Label className="mr-1">Source</Label>
          {sources.map((s) => (
            <BracketButton key={s} active={source === s} onClick={() => setSource(s)}>
              {s}
            </BracketButton>
          ))}
        </div>
        <ActionButton variant="ghost" className="ml-auto" onClick={refreshAfterMutation}>
          <RefreshCw className="size-3.5" />
          Refresh
        </ActionButton>
      </div>

      {/* Table */}
      <div className="scrollbar-thin flex-1 overflow-y-auto p-6">
        {skills.length === 0 ? (
          <SkillsEmptyState onBrowse={() => setShowBrowser(true)} onImport={importManualSkill} />
        ) : (
          <Panel>
            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_112px_176px] items-center gap-4 border-b border-border bg-panel px-4 py-2.5">
              <Label>Skill</Label>
              <Label>Path</Label>
              <Label>Source</Label>
              <Label className="text-right">Actions</Label>
            </div>
            {filtered.length === 0 ? (
              <p className="px-4 py-12 text-center font-mono text-xs text-muted-foreground">
                No skills match the current filters
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {filtered.map((s) => (
                  <li
                    key={s.id}
                    className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_112px_176px] items-center gap-4 px-4 py-3 hover:bg-panel"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[13px] text-foreground">{s.name}</span>
                        {s.version && (
                          <span className="font-mono text-[11px] text-muted-foreground">
                            v{s.version}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-[13px] text-muted-foreground">
                        {s.description}
                      </p>
                      <div className="mt-1 flex items-center gap-1.5">
                        {s.tags.map((t) => (
                          <Tag key={t} tone="outline">
                            {t}
                          </Tag>
                        ))}
                        <span className="font-mono text-[10px] text-muted-foreground">
                          used by {s.usedByAgents} agents
                        </span>
                      </div>
                    </div>
                    <code className="truncate font-mono text-[11px] text-muted-foreground">
                      {s.path}
                    </code>
                    <div className="min-w-0">
                      <Tag tone={sourceTone[s.source]}>{s.source}</Tag>
                    </div>
                    <div className="flex min-w-0 items-center justify-end gap-0.5">
                      <ActionButton
                        variant="ghost"
                        title="View skill details"
                        onClick={() => setViewing(s)}
                      >
                        <Eye className="size-3.5" />
                      </ActionButton>
                      <ActionButton
                        variant="ghost"
                        title="Assign to agent"
                        onClick={() => setAssigning(s)}
                      >
                        <UserPlus className="size-3.5" />
                      </ActionButton>
                      <ActionButton variant="ghost" title="Edit" onClick={() => setEditing(s)}>
                        <Pencil className="size-3.5" />
                      </ActionButton>
                      <ActionButton
                        variant="ghost"
                        title="Delete"
                        onClick={() => setDeleteTarget(s)}
                        disabled={pendingId === `delete:${s.id}`}
                      >
                        <Trash2 className="size-3.5" />
                      </ActionButton>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>

      {showBrowser && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setShowBrowser(false)}
            className="absolute inset-0 bg-foreground/20"
          />
          <div className="relative flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border bg-panel px-4 py-3">
              <div>
                <h2 className="font-serif text-lg text-foreground italic">skills.sh</h2>
                <Label>community skill registry</Label>
              </div>
              <button
                type="button"
                onClick={() => setShowBrowser(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="border-b border-border p-3">
              <TextInput
                value={registryQuery}
                onChange={setRegistryQuery}
                placeholder="Search skills.sh…"
                icon={<Search className="size-3.5" />}
              />
            </div>
            <div className="scrollbar-thin flex-1 space-y-3 overflow-y-auto p-4">
              {registryLoading ? (
                <RegistrySkeleton />
              ) : registryError ? (
                <Panel className="flex flex-col items-center gap-3 p-6 text-center">
                  <div className="flex size-11 items-center justify-center border border-destructive/30 bg-destructive/10">
                    <AlertCircle className="size-5 text-destructive" />
                  </div>
                  <div>
                    <h3 className="font-mono text-[13px] text-foreground">
                      Unable to load registry
                    </h3>
                    <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
                      {registryError}
                    </p>
                  </div>
                  <ActionButton onClick={() => setRegistryReloadKey((key) => key + 1)}>
                    <RefreshCw className="size-3.5" />
                    Retry
                  </ActionButton>
                </Panel>
              ) : registry.length === 0 ? (
                <RegistryEmptyState query={registryQuery} />
              ) : (
                registry.map((m) => {
                  const importKey = registrySkillKey(m)
                  return (
                    <Panel key={importKey} className="p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[13px] text-foreground">{m.name}</span>
                        {m.installed ? (
                          <Tag tone="success">
                            <Check className="size-2.5" />
                            installed
                          </Tag>
                        ) : (
                          <ActionButton
                            variant="accent"
                            onClick={() => importRegistrySkill(m)}
                            disabled={pendingId === `import:${importKey}`}
                          >
                            <Download className="size-3" />
                            {pendingId === `import:${importKey}` ? 'Importing' : 'Import'}
                          </ActionButton>
                        )}
                      </div>
                      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        by {m.author}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
                        <span className="inline-flex min-w-0 items-center gap-1.5">
                          <Package className="size-3 shrink-0" />
                          <span className="truncate">{m.source}</span>
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <Download className="size-3 shrink-0" />
                          {formatRegistryInstalls(m.installs)}
                        </span>
                      </div>
                    </Panel>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}

      {viewing && (
        <SkillDetailsDialog skill={viewing} agents={agents} onClose={() => setViewing(null)} />
      )}
      {assigning && (
        <AssignSkillDialog
          skill={assigning}
          agents={agents}
          pendingId={pendingId}
          onClose={() => setAssigning(null)}
          onToggle={assignSkill}
        />
      )}
      {(editing || creating) && (
        <SkillEditor
          skill={editing}
          onClose={() => {
            setEditing(null)
            setCreating(false)
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete skill"
        description={`Delete skill "${deleteTarget?.name ?? ''}" from Pi Studio and remove its installed files from pi's skills directory when present? This cannot be undone.`}
        confirmLabel="Delete skill"
        busy={deleteTarget ? pendingId === `delete:${deleteTarget.id}` : false}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) void deleteSkill(deleteTarget)
        }}
      />
    </div>
  )
}

function SkillEditor({ skill, onClose }: { skill: GlobalSkill | null; onClose: () => void }) {
  const {
    register,
    setValue,
    watch,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<PostApiSkillsMutationRequest>({
    resolver: zodResolver(postApiSkillsMutationRequestSchema as never),
    defaultValues: {
      id: skill?.id,
      name: skill?.name ?? '',
      description: skill?.description ?? '',
      source: skill?.source ?? 'manual',
      path: skill?.path ?? '',
      version: skill?.version ?? '',
      author: skill?.author ?? '',
      tags: skill?.tags ?? [],
    },
  })

  const save = async (values: PostApiSkillsMutationRequest) => {
    await postApiSkills(values)
    refreshAfterMutation()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-foreground/25"
      />
      <form
        onSubmit={handleSubmit(save)}
        className="relative w-full max-w-lg border border-border bg-card shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border bg-panel px-4 py-3">
          <h2 className="font-serif text-lg text-foreground italic">
            {skill ? `Edit ${skill.name}` : 'Import skill'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-4 p-4">
          <EditorField label="Name" error={errors.name?.message}>
            <input
              {...register('name')}
              className="w-full border border-input bg-panel px-3 py-1.5 font-mono text-[13px] text-foreground outline-none focus:border-ring"
            />
          </EditorField>
          <EditorField label="Description">
            <textarea
              {...register('description')}
              rows={3}
              className="w-full resize-none border border-input bg-panel px-3 py-1.5 text-[13px] text-foreground outline-none focus:border-ring"
            />
          </EditorField>
          <EditorField label="Path" error={errors.path?.message}>
            <input
              {...register('path')}
              className="w-full border border-input bg-panel px-3 py-1.5 font-mono text-[13px] text-foreground outline-none focus:border-ring"
            />
          </EditorField>
          <div className="grid gap-3 sm:grid-cols-2">
            <EditorField label="Source">
              <input type="hidden" {...register('source')} />
              <Select
                value={watch('source')}
                onValueChange={(value) => {
                  if (value === null) return
                  setValue('source', value as SkillSource, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }}
              >
                <SelectTrigger className="w-full text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectItem value="manual">manual</SelectItem>
                  <SelectItem value="skills.sh">skills.sh</SelectItem>
                  <SelectItem value="local">local</SelectItem>
                  <SelectItem value="git">git</SelectItem>
                </SelectContent>
              </Select>
            </EditorField>
            <EditorField label="Version">
              <input
                {...register('version')}
                className="w-full border border-input bg-panel px-3 py-1.5 font-mono text-[13px] text-foreground outline-none focus:border-ring"
              />
            </EditorField>
          </div>
          <EditorField label="Author">
            <input
              {...register('author')}
              className="w-full border border-input bg-panel px-3 py-1.5 font-mono text-[13px] text-foreground outline-none focus:border-ring"
            />
          </EditorField>
          <EditorField label="Tags (comma separated)">
            <input
              {...register('tags', {
                setValueAs: (value) =>
                  String(value)
                    .split(',')
                    .map((tag) => tag.trim())
                    .filter(Boolean),
              })}
              className="w-full border border-input bg-panel px-3 py-1.5 font-mono text-[13px] text-foreground outline-none focus:border-ring"
            />
          </EditorField>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border bg-panel px-4 py-3">
          <ActionButton onClick={onClose}>Cancel</ActionButton>
          <ActionButton variant="accent" type="submit" disabled={isSubmitting}>
            Save
          </ActionButton>
        </div>
      </form>
    </div>
  )
}

function EditorField({
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
      {error && <p className="mt-1 font-mono text-[11px] text-destructive">{error}</p>}
    </div>
  )
}

function SkillDetailsDialog({
  skill,
  agents,
  onClose,
}: {
  skill: GlobalSkill
  agents: AgentProfile[]
  onClose: () => void
}) {
  const assignedAgents = agents.filter((agent) => agent.selectedSkillIds.includes(skill.id))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close skill details"
        onClick={onClose}
        className="absolute inset-0 bg-foreground/25"
      />
      <div className="relative w-full max-w-2xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border bg-panel px-4 py-3">
          <div>
            <h2 className="font-serif text-lg text-foreground italic">{skill.name}</h2>
            <Label>skill details</Label>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Panel className="p-3 sm:col-span-2">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center border border-border-strong bg-panel">
                <FileText className="size-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <Label>Description</Label>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {skill.description || 'No description provided.'}
                </p>
              </div>
            </div>
          </Panel>
          <SkillField label="Source" value={skill.source} />
          <SkillField label="Used by" value={`${skill.usedByAgents} agents`} />
          <SkillField label="Path" value={skill.path} wide />
          <SkillField label="Author" value={skill.author ?? '—'} />
          <SkillField label="Version" value={skill.version ?? '—'} />
          <SkillField label="Installed" value={skill.installedAt} />
          <SkillField label="Updated" value={skill.updatedAt} />
          <Panel className="p-3 sm:col-span-2">
            <Label>Assigned agents</Label>
            {assignedAgents.length === 0 ? (
              <p className="mt-2 font-mono text-xs text-muted-foreground">
                Not assigned to any agent.
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {assignedAgents.map((agent) => (
                  <Tag key={agent.id} tone="outline">
                    {agent.name}
                  </Tag>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}

function SkillField({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <Panel className={wide ? 'p-3 sm:col-span-2' : 'p-3'}>
      <Label>{label}</Label>
      <p className="mt-1 font-mono text-xs wrap-break-word text-foreground">{value}</p>
    </Panel>
  )
}

function AssignSkillDialog({
  skill,
  agents,
  pendingId,
  onClose,
  onToggle,
}: {
  skill: GlobalSkill
  agents: AgentProfile[]
  pendingId: string | null
  onClose: () => void
  onToggle: (skill: GlobalSkill, agent: AgentProfile, enabled: boolean) => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close assign skill"
        onClick={onClose}
        className="absolute inset-0 bg-foreground/25"
      />
      <div className="relative w-full max-w-xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border bg-panel px-4 py-3">
          <div>
            <h2 className="font-serif text-lg text-foreground italic">Assign {skill.name}</h2>
            <Label>enable skill per agent</Label>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-4">
          {agents.length === 0 ? (
            <Panel className="p-6 text-center">
              <Label>No agents available</Label>
              <p className="mt-2 text-sm text-muted-foreground">
                Create an agent before assigning skills.
              </p>
            </Panel>
          ) : (
            <ul className="divide-y divide-border border border-border">
              {agents.map((agent) => {
                const enabled = agent.selectedSkillIds.includes(skill.id)
                const key = `assign:${skill.id}:${agent.id}`
                return (
                  <li
                    key={agent.id}
                    className="flex items-center justify-between gap-4 bg-card px-3 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="size-2.5 shrink-0 border border-border-strong"
                          style={{ backgroundColor: agent.color }}
                        />
                        <span className="truncate font-mono text-[13px] text-foreground">
                          {agent.name}
                        </span>
                        {enabled && <Tag tone="success">enabled</Tag>}
                      </div>
                      {agent.description && (
                        <p className="mt-1 line-clamp-1 text-[13px] text-muted-foreground">
                          {agent.description}
                        </p>
                      )}
                    </div>
                    <ActionButton
                      variant={enabled ? 'danger' : 'accent'}
                      disabled={pendingId === key}
                      onClick={() => onToggle(skill, agent, !enabled)}
                    >
                      {pendingId === key ? 'Saving' : enabled ? 'Disable' : 'Enable'}
                    </ActionButton>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function RegistrySkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, index) => (
        <Panel key={index} className="p-3">
          <div className="flex items-center justify-between gap-4">
            <div className="h-3 w-28 animate-pulse bg-muted" />
            <div className="h-7 w-20 animate-pulse bg-muted" />
          </div>
          <div className="mt-2 h-2.5 w-20 animate-pulse bg-muted" />
          <div className="mt-3 space-y-1.5">
            <div className="h-2.5 w-full animate-pulse bg-muted" />
            <div className="h-2.5 w-4/5 animate-pulse bg-muted" />
          </div>
          <div className="mt-3 flex gap-1.5">
            <div className="h-4 w-14 animate-pulse bg-muted" />
            <div className="h-4 w-16 animate-pulse bg-muted" />
          </div>
        </Panel>
      ))}
    </>
  )
}

function RegistryEmptyState({ query }: { query: string }) {
  const hasQuery = query.trim().length > 0
  return (
    <Empty className="border py-8">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Search />
        </EmptyMedia>
        <EmptyTitle>{hasQuery ? 'No matching skills' : 'Search skills.sh'}</EmptyTitle>
        <EmptyDescription>
          {hasQuery
            ? 'Try a broader name, tag, or capability.'
            : 'Type at least 2 characters to browse the external registry.'}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function SkillsEmptyState({ onBrowse, onImport }: { onBrowse: () => void; onImport: () => void }) {
  return (
    <Empty className="py-24">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Sparkles />
        </EmptyMedia>
        <EmptyTitle>No skills yet</EmptyTitle>
        <EmptyDescription>
          Import a local skill or browse skills.sh to build a reusable global skill pool for your
          agents.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center">
        <ActionButton onClick={onBrowse}>
          <Search className="size-3.5" />
          Browse skills.sh
        </ActionButton>
        <ActionButton variant="accent" onClick={onImport}>
          <Download className="size-3.5" />
          Import
        </ActionButton>
      </EmptyContent>
    </Empty>
  )
}

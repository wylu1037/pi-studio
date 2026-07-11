'use client'

import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import {
  Search,
  RefreshCw,
  Download,
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

const sourceTone: Record<SkillSource, 'accent' | 'default' | 'outline'> = {
  'skills.sh': 'accent',
  local: 'default',
  git: 'outline',
  manual: 'outline',
}

type RegistrySkill = {
  name: string
  author: string
  description: string
  tags: string[]
  installed: boolean
}

export function SkillsView({
  agents,
  skills,
}: {
  agents: AgentProfile[]
  skills: GlobalSkill[]
}) {
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<SkillSource | 'all'>('all')
  const [showBrowser, setShowBrowser] = useState(false)
  const [editing, setEditing] = useState<GlobalSkill | null>(null)
  const [creating, setCreating] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [registryQuery, setRegistryQuery] = useState('')
  const [registry, setRegistry] = useState<RegistrySkill[]>([])
  const [deleteTarget, setDeleteTarget] = useState<GlobalSkill | null>(null)

  const filtered = skills.filter((s) => {
    const q =
      !query ||
      s.name.toLowerCase().includes(query.toLowerCase()) ||
      s.description.toLowerCase().includes(query.toLowerCase())
    const src = source === 'all' || s.source === source
    return q && src
  })

  const sources: (SkillSource | 'all')[] = [
    'all',
    'skills.sh',
    'local',
    'git',
    'manual',
  ]

  useEffect(() => {
    if (!showBrowser) return
    let alive = true
    getApiSkillsRegistrySearch({ q: registryQuery }).then((items) => {
      if (alive) setRegistry(items)
    })
    return () => {
      alive = false
    }
  }, [showBrowser, registryQuery])

  const importManualSkill = () => {
    setEditing(null)
    setCreating(true)
  }

  const importRegistrySkill = async (skill: RegistrySkill) => {
    setPendingId(`import:${skill.name}`)
    try {
      await postApiSkills({
        name: skill.name,
        author: skill.author,
        description: skill.description,
        source: 'skills.sh',
        path: `skills.sh/${skill.name}`,
        tags: skill.tags,
      })
      refreshAfterMutation()
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

  const assignSkill = async (skill: GlobalSkill) => {
    const label = agents.map((agent) => `${agent.name} (${agent.id})`).join('\n')
    const answer = window.prompt(`Assign "${skill.name}" to which agent?\n${label}`)
    if (!answer) return
    const agent = agents.find((item) => item.id === answer || item.name === answer)
    if (!agent) return window.alert('Agent not found')
    setPendingId(`assign:${skill.id}`)
    try {
      await postApiAgentsIdAssign(agent.id, {
        kind: 'skill',
        resourceId: skill.id,
        enabled: true,
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
            <BracketButton
              key={s}
              active={source === s}
              onClick={() => setSource(s)}
            >
              {s}
            </BracketButton>
          ))}
        </div>
        <ActionButton
          variant="ghost"
          className="ml-auto"
          onClick={refreshAfterMutation}
        >
          <RefreshCw className="size-3.5" />
          Refresh
        </ActionButton>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
        {skills.length === 0 ? (
          <SkillsEmptyState
            onBrowse={() => setShowBrowser(true)}
            onImport={importManualSkill}
          />
        ) : (
          <Panel>
            <div className="grid grid-cols-[1.4fr_1fr_100px_90px] items-center gap-4 border-b border-border bg-panel px-4 py-2.5">
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
                    className="grid grid-cols-[1.4fr_1fr_100px_90px] items-center gap-4 px-4 py-3 hover:bg-panel"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[13px] text-foreground">
                          {s.name}
                        </span>
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
                    <div>
                      <Tag tone={sourceTone[s.source]}>{s.source}</Tag>
                    </div>
                    <div className="flex items-center justify-end gap-0.5">
                      <ActionButton variant="ghost" title="View">
                        <Eye className="size-3.5" />
                      </ActionButton>
                      <ActionButton
                        variant="ghost"
                        title="Assign to agent"
                        onClick={() => assignSkill(s)}
                        disabled={pendingId === `assign:${s.id}`}
                      >
                        <UserPlus className="size-3.5" />
                      </ActionButton>
                      <ActionButton
                        variant="ghost"
                        title="Edit"
                        onClick={() => setEditing(s)}
                      >
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
                <h2 className="font-serif text-lg italic text-foreground">
                  skills.sh
                </h2>
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
            <div className="flex-1 space-y-3 overflow-y-auto scrollbar-thin p-4">
              {registry.map((m) => (
                <Panel key={m.name} className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[13px] text-foreground">
                      {m.name}
                    </span>
                    {m.installed ? (
                      <Tag tone="success">
                        <Check className="size-2.5" />
                        installed
                      </Tag>
                    ) : (
                      <ActionButton
                        variant="accent"
                        onClick={() => importRegistrySkill(m)}
                        disabled={pendingId === `import:${m.name}`}
                      >
                        <Download className="size-3" />
                        Import
                      </ActionButton>
                    )}
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                    by {m.author}
                  </p>
                  <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">
                    {m.description}
                  </p>
                  <div className="mt-2 flex gap-1.5">
                    {m.tags.map((t) => (
                      <Tag key={t} tone="outline">
                        {t}
                      </Tag>
                    ))}
                  </div>
                </Panel>
              ))}
            </div>
          </div>
        </div>
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
        description={`Delete skill "${deleteTarget?.name ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete skill"
        busy={
          deleteTarget ? pendingId === `delete:${deleteTarget.id}` : false
        }
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) void deleteSkill(deleteTarget)
        }}
      />
    </div>
  )
}

function SkillEditor({
  skill,
  onClose,
}: {
  skill: GlobalSkill | null
  onClose: () => void
}) {
  const {
    register,
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
          <h2 className="font-serif text-lg italic text-foreground">
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
            <input {...register('name')} className="w-full border border-input bg-panel px-3 py-1.5 font-mono text-[13px] text-foreground outline-none focus:border-ring" />
          </EditorField>
          <EditorField label="Description">
            <textarea {...register('description')} rows={3} className="w-full resize-none border border-input bg-panel px-3 py-1.5 text-[13px] text-foreground outline-none focus:border-ring" />
          </EditorField>
          <EditorField label="Path" error={errors.path?.message}>
            <input {...register('path')} className="w-full border border-input bg-panel px-3 py-1.5 font-mono text-[13px] text-foreground outline-none focus:border-ring" />
          </EditorField>
          <div className="grid gap-3 sm:grid-cols-2">
            <EditorField label="Source">
              <select {...register('source')} className="w-full border border-input bg-panel px-3 py-1.5 font-mono text-[13px] text-foreground outline-none focus:border-ring">
                <option value="manual">manual</option>
                <option value="skills.sh">skills.sh</option>
                <option value="local">local</option>
                <option value="git">git</option>
              </select>
            </EditorField>
            <EditorField label="Version">
              <input {...register('version')} className="w-full border border-input bg-panel px-3 py-1.5 font-mono text-[13px] text-foreground outline-none focus:border-ring" />
            </EditorField>
          </div>
          <EditorField label="Author">
            <input {...register('author')} className="w-full border border-input bg-panel px-3 py-1.5 font-mono text-[13px] text-foreground outline-none focus:border-ring" />
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
      {error && (
        <p className="mt-1 font-mono text-[11px] text-destructive">{error}</p>
      )}
    </div>
  )
}

function SkillsEmptyState({
  onBrowse,
  onImport,
}: {
  onBrowse: () => void
  onImport: () => void
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-4 py-24 text-center">
      <div className="flex size-14 items-center justify-center border border-border-strong bg-card">
        <Sparkles className="size-6 text-muted-foreground" />
      </div>
      <div>
        <h2 className="font-serif text-2xl italic text-foreground">
          No skills yet
        </h2>
        <p className="mt-2 text-sm text-muted-foreground text-pretty">
          Import a local skill or browse skills.sh to build a reusable global
          skill pool for your agents.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <ActionButton onClick={onBrowse}>
          <Search className="size-3.5" />
          Browse skills.sh
        </ActionButton>
        <ActionButton variant="accent" onClick={onImport}>
          <Download className="size-3.5" />
          Import
        </ActionButton>
      </div>
    </div>
  )
}

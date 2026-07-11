'use client'

import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import {
  Plus,
  Info,
  Pencil,
  Copy,
  Trash2,
  UserPlus,
  X,
  Plug,
  Server,
} from 'lucide-react'
import type { AgentProfile, GlobalMcpConfig } from '@/lib/types'
import { deleteApiMcpId } from '@/lib/api/generated/clients/deleteApiMcpId'
import { postApiAgentsIdAssign } from '@/lib/api/generated/clients/postApiAgentsIdAssign'
import { postApiMcp } from '@/lib/api/generated/clients/postApiMcp'
import { refreshAfterMutation } from '@/lib/api/refresh'
import {
  ActionButton,
  ConfirmDialog,
  Label,
  PageHeader,
  Panel,
  Tag,
  Toggle,
} from '@/components/pi-ui'

const mcpEditorSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  command: z.string().min(1),
  argsText: z.string().optional(),
  envText: z.string().optional(),
  tagsText: z.string().optional(),
  enabledGlobally: z.boolean(),
})
type McpEditorForm = z.infer<typeof mcpEditorSchema>

export function McpView({
  agents,
  configs,
}: {
  agents: AgentProfile[]
  configs: GlobalMcpConfig[]
}) {
  const [editing, setEditing] = useState<GlobalMcpConfig | null>(null)
  const [creating, setCreating] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<GlobalMcpConfig | null>(null)

  const saveConfig = async (config: GlobalMcpConfig, patch: Partial<GlobalMcpConfig>) => {
    setPendingId(`save:${config.id}`)
    try {
      await postApiMcp({ ...config, ...patch })
      refreshAfterMutation()
    } finally {
      setPendingId(null)
    }
  }

  const duplicateConfig = async (config: GlobalMcpConfig) => {
    setPendingId(`duplicate:${config.id}`)
    try {
      await postApiMcp({
        name: `${config.name} Copy`,
        description: config.description,
        command: config.command,
        args: config.args,
        env: config.env,
        tags: config.tags,
        enabledGlobally: config.enabledGlobally,
      })
      refreshAfterMutation()
    } finally {
      setPendingId(null)
    }
  }

  const deleteConfig = async (config: GlobalMcpConfig) => {
    setPendingId(`delete:${config.id}`)
    try {
      await deleteApiMcpId(config.id)
      refreshAfterMutation()
    } finally {
      setPendingId(null)
      setDeleteTarget(null)
    }
  }

  const assignConfig = async (config: GlobalMcpConfig) => {
    const label = agents.map((agent) => `${agent.name} (${agent.id})`).join('\n')
    const answer = window.prompt(`Assign "${config.name}" to which agent?\n${label}`)
    if (!answer) return
    const agent = agents.find((item) => item.id === answer || item.name === answer)
    if (!agent) return window.alert('Agent not found')
    setPendingId(`assign:${config.id}`)
    try {
      await postApiAgentsIdAssign(agent.id, {
        kind: 'mcp',
        resourceId: config.id,
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
        title="MCP"
        subtitle="Model Context Protocol server configurations. Enable them per-agent to expose tools."
      >
        <ActionButton variant="accent" onClick={() => setCreating(true)}>
          <Plus className="size-3.5" />
          Add MCP
        </ActionButton>
      </PageHeader>

      <div className="flex items-start gap-2.5 border-b border-border bg-panel px-6 py-2.5">
        <Info className="mt-0.5 size-4 shrink-0 text-accent" />
        <p className="text-[13px] text-muted-foreground">
          This release manages MCP configuration only. Servers are not launched
          from Pi Studio yet.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
        {configs.length === 0 ? (
          <McpEmptyState onCreate={() => setCreating(true)} />
        ) : (
          <Panel>
            <div className="grid grid-cols-[1.4fr_1.2fr_70px_120px_90px] items-center gap-4 border-b border-border bg-panel px-4 py-2.5">
              <Label>Server</Label>
              <Label>Command</Label>
              <Label>Env</Label>
              <Label>Global</Label>
              <Label className="text-right">Actions</Label>
            </div>
            <ul className="divide-y divide-border">
              {configs.map((c) => (
                <li
                  key={c.id}
                  className="grid grid-cols-[1.4fr_1.2fr_70px_120px_90px] items-center gap-4 px-4 py-3 hover:bg-panel"
                >
                  <div className="flex items-start gap-2.5">
                    <Server className="mt-0.5 size-4 shrink-0 text-accent" />
                    <div className="min-w-0">
                      <span className="font-mono text-[13px] text-foreground">
                        {c.name}
                      </span>
                      <p className="line-clamp-1 text-[13px] text-muted-foreground">
                        {c.description}
                      </p>
                      <div className="mt-1 flex gap-1.5">
                        {c.tags.map((t) => (
                          <Tag key={t} tone="outline">
                            {t}
                          </Tag>
                        ))}
                        <span className="font-mono text-[10px] text-muted-foreground">
                          used by {c.usedByAgents}
                        </span>
                      </div>
                    </div>
                  </div>
                  <code className="truncate font-mono text-[11px] text-muted-foreground">
                    {c.command} {c.args.join(' ')}
                  </code>
                  <span className="font-mono text-[13px] text-foreground">
                    {Object.keys(c.env).length}
                  </span>
                  <div>
                    <Toggle
                      checked={c.enabledGlobally}
                      onChange={(enabledGlobally) =>
                        saveConfig(c, { enabledGlobally })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-end gap-0.5">
                    <ActionButton
                      variant="ghost"
                      title="Edit"
                      onClick={() => setEditing(c)}
                    >
                      <Pencil className="size-3.5" />
                    </ActionButton>
                    <ActionButton
                      variant="ghost"
                      title="Duplicate"
                      onClick={() => duplicateConfig(c)}
                      disabled={pendingId === `duplicate:${c.id}`}
                    >
                      <Copy className="size-3.5" />
                    </ActionButton>
                    <ActionButton
                      variant="ghost"
                      title="Assign"
                      onClick={() => assignConfig(c)}
                      disabled={pendingId === `assign:${c.id}`}
                    >
                      <UserPlus className="size-3.5" />
                    </ActionButton>
                    <ActionButton
                      variant="ghost"
                      title="Delete"
                      onClick={() => setDeleteTarget(c)}
                      disabled={pendingId === `delete:${c.id}`}
                    >
                      <Trash2 className="size-3.5" />
                    </ActionButton>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>

      {(editing || creating) && (
        <McpEditor
          config={editing}
          onClose={() => {
            setEditing(null)
            setCreating(false)
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete MCP config"
        description={`Delete MCP config "${deleteTarget?.name ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete config"
        busy={
          deleteTarget ? pendingId === `delete:${deleteTarget.id}` : false
        }
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) void deleteConfig(deleteTarget)
        }}
      />
    </div>
  )
}

function McpEditor({
  config,
  onClose,
}: {
  config: GlobalMcpConfig | null
  onClose: () => void
}) {
  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<McpEditorForm>({
    resolver: zodResolver(mcpEditorSchema as never),
    defaultValues: {
      name: config?.name ?? '',
      description: config?.description ?? '',
      command: config?.command ?? 'npx',
      argsText: config?.args.join(' ') ?? '',
      envText: JSON.stringify(config?.env ?? {}, null, 2),
      tagsText: config?.tags.join(', ') ?? '',
      enabledGlobally: config?.enabledGlobally ?? false,
    },
  })

  const save = async (values: McpEditorForm) => {
    let env: Record<string, string> = {}
    if (values.envText?.trim()) {
      env = JSON.parse(values.envText) as Record<string, string>
    }
    await postApiMcp({
      id: config?.id,
      name: values.name,
      description: values.description,
      command: values.command,
      args: values.argsText?.split(' ').map((arg) => arg.trim()).filter(Boolean) ?? [],
      env,
      tags: values.tagsText?.split(',').map((tag) => tag.trim()).filter(Boolean) ?? [],
      enabledGlobally: values.enabledGlobally,
    })
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
            {config ? `Edit ${config.name}` : 'New MCP config'}
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
            <input {...register('name')} className="w-full border border-input bg-panel px-3 py-1.5 text-[13px] text-foreground outline-none focus:border-ring" />
          </EditorField>
          <EditorField
            label="Description"
          >
            <input {...register('description')} className="w-full border border-input bg-panel px-3 py-1.5 text-[13px] text-foreground outline-none focus:border-ring" />
          </EditorField>
          <EditorField label="Command" error={errors.command?.message}>
            <input {...register('command')} className="w-full border border-input bg-panel px-3 py-1.5 font-mono text-[13px] text-foreground outline-none focus:border-ring" />
          </EditorField>
          <EditorField label="Args (space separated)">
            <input {...register('argsText')} className="w-full border border-input bg-panel px-3 py-1.5 font-mono text-[13px] text-foreground outline-none focus:border-ring" />
          </EditorField>
          <EditorField label="Tags (comma separated)">
            <input {...register('tagsText')} className="w-full border border-input bg-panel px-3 py-1.5 font-mono text-[13px] text-foreground outline-none focus:border-ring" />
          </EditorField>
          <label className="flex items-center gap-2">
            <input type="checkbox" {...register('enabledGlobally')} />
            <Label>Enable globally</Label>
          </label>
          <div>
            <Label className="mb-1.5 block">Environment variables</Label>
            <div className="space-y-2">
              <textarea
                {...register('envText')}
                rows={5}
                className="w-full resize-none border border-input bg-panel px-3 py-1.5 font-mono text-[13px] text-foreground outline-none focus:border-ring"
              />
            </div>
          </div>
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

function McpEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-4 py-24 text-center">
      <div className="flex size-14 items-center justify-center border border-border-strong bg-card">
        <Plug className="size-6 text-muted-foreground" />
      </div>
      <div>
        <h2 className="font-serif text-2xl italic text-foreground">
          No MCP configs yet
        </h2>
        <p className="mt-2 text-sm text-muted-foreground text-pretty">
          Add an MCP server configuration, then assign it to agents that need
          access to its tools.
        </p>
      </div>
      <ActionButton variant="accent" onClick={onCreate}>
        <Plus className="size-3.5" />
        Add MCP
      </ActionButton>
    </div>
  )
}

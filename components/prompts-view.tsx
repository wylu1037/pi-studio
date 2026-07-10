'use client'

import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Search, Plus, Save, Trash2, Eye, Pencil } from 'lucide-react'
import type { GlobalPromptTemplate } from '@/lib/types'
import { deleteApiPromptsId } from '@/lib/api/generated/clients/deleteApiPromptsId'
import { postApiPrompts } from '@/lib/api/generated/clients/postApiPrompts'
import type { PostApiPromptsMutationRequest } from '@/lib/api/generated/types/PostApiPrompts'
import { postApiPromptsMutationRequestSchema } from '@/lib/api/generated/zod/postApiPromptsSchema'
import { refreshAfterMutation } from '@/lib/api/refresh'
import {
  ActionButton,
  ConfirmDialog,
  Label,
  Tag,
  TextInput,
} from '@/components/pi-ui'
import { cn } from '@/lib/utils'

function promptDefaults(
  prompt?: GlobalPromptTemplate,
): PostApiPromptsMutationRequest {
  return {
    id: prompt?.id,
    name: prompt?.name ?? '',
    description: prompt?.description ?? '',
    content: prompt?.content ?? '',
    path: prompt?.path,
    tags: prompt?.tags ?? [],
  }
}

export function PromptsView({ prompts }: { prompts: GlobalPromptTemplate[] }) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(prompts[0]?.id)
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [pending, setPending] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const filtered = prompts.filter(
    (p) => !query || p.name.toLowerCase().includes(query.toLowerCase()),
  )
  const selected = prompts.find((p) => p.id === selectedId)
  const form = useForm<PostApiPromptsMutationRequest>({
    resolver: zodResolver(postApiPromptsMutationRequestSchema as never),
    defaultValues: promptDefaults(selected),
  })
  const content = form.watch('content')

  useEffect(() => {
    form.reset(promptDefaults(selected))
  }, [form, selected])

  const createPrompt = async () => {
    setPending('new')
    try {
      await postApiPrompts({
        name: 'New prompt',
        description: '',
        content: 'Write your reusable prompt here.',
        tags: [],
      })
      refreshAfterMutation()
    } finally {
      setPending(null)
    }
  }

  const savePrompt = async (values: PostApiPromptsMutationRequest) => {
    await postApiPrompts(values)
    refreshAfterMutation()
  }

  const deletePrompt = async () => {
    if (!selected) return
    setPending('delete')
    try {
      await deleteApiPromptsId(selected.id)
      refreshAfterMutation()
    } finally {
      setPending(null)
      setConfirmDelete(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-5">
        <div>
          <h1 className="font-serif text-3xl italic text-foreground">
            Prompts
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Reusable prompt templates. Enable them per-agent from the agent
            config.
          </p>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-[280px_1fr] overflow-hidden">
        {/* List */}
        <div className="flex flex-col border-r border-border">
          <div className="flex items-center gap-2 border-b border-border p-3">
            <TextInput
              value={query}
              onChange={setQuery}
              placeholder="Search…"
              icon={<Search className="size-3.5" />}
              className="flex-1"
            />
            <ActionButton
              variant="accent"
              title="New prompt"
              onClick={createPrompt}
              disabled={pending === 'new'}
            >
              <Plus className="size-3.5" />
            </ActionButton>
          </div>
          <ul className="flex-1 overflow-y-auto scrollbar-thin">
            {filtered.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={cn(
                    'flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left transition-colors',
                    selectedId === p.id
                      ? 'bg-card'
                      : 'hover:bg-panel',
                  )}
                >
                  <span
                    className={cn(
                      'font-mono text-[13px]',
                      selectedId === p.id
                        ? 'text-accent'
                        : 'text-foreground',
                    )}
                  >
                    {p.name}
                  </span>
                  <span className="line-clamp-1 text-xs text-muted-foreground">
                    {p.description}
                  </span>
                  <div className="mt-0.5 flex gap-1">
                    {p.tags.map((t) => (
                      <Tag key={t} tone="outline">
                        {t}
                      </Tag>
                    ))}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Editor */}
        {selected ? (
          <form
            onSubmit={form.handleSubmit(savePrompt)}
            className="flex flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between border-b border-border bg-panel px-4 py-2.5">
              <input
                {...form.register('name')}
                className="border-none bg-transparent font-mono text-sm text-foreground outline-none"
              />
              <div className="flex items-center gap-2">
                <div className="flex border border-border-strong">
                  <button
                    type="button"
                    onClick={() => setMode('edit')}
                    className={cn(
                      'flex items-center gap-1.5 px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider',
                      mode === 'edit'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted',
                    )}
                  >
                    <Pencil className="size-3" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('preview')}
                    className={cn(
                      'flex items-center gap-1.5 px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider',
                      mode === 'preview'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted',
                    )}
                  >
                    <Eye className="size-3" />
                    Preview
                  </button>
                </div>
                <ActionButton
                  variant="accent"
                  type="submit"
                  disabled={form.formState.isSubmitting}
                >
                  <Save className="size-3.5" />
                  Save
                </ActionButton>
                <ActionButton
                  variant="danger"
                  title="Delete"
                  onClick={() => setConfirmDelete(true)}
                  disabled={pending === 'delete' || form.formState.isSubmitting}
                >
                  <Trash2 className="size-3.5" />
                </ActionButton>
              </div>
            </div>

            <div className="grid flex-1 grid-cols-[1fr_260px] overflow-hidden">
              <div className="overflow-y-auto scrollbar-thin p-4">
                {mode === 'edit' ? (
                  <textarea
                    {...form.register('content')}
                    className="h-full min-h-[420px] w-full resize-none border border-input bg-panel p-4 font-mono text-[13px] leading-relaxed text-foreground outline-none focus:border-ring"
                  />
                ) : (
                  <div className="prose-preview whitespace-pre-wrap border border-border bg-panel p-4 font-mono text-[13px] leading-relaxed text-foreground">
                    {content}
                  </div>
                )}
              </div>

              <div className="border-l border-border p-4">
                <Label className="mb-2 block">Description</Label>
                <textarea
                  {...form.register('description')}
                  rows={3}
                  className="mb-4 w-full resize-none border border-input bg-panel px-3 py-2 text-[13px] text-foreground outline-none focus:border-ring"
                />
                <Label className="mb-2 block">Tags</Label>
                <input
                  {...form.register('tags', {
                    setValueAs: (value) =>
                      String(value)
                        .split(',')
                        .map((tag) => tag.trim())
                        .filter(Boolean),
                  })}
                  className="mb-4 w-full border border-input bg-panel px-3 py-2 font-mono text-[13px] text-foreground outline-none focus:border-ring"
                />
                <Label className="mb-2 block">Path</Label>
                <code className="mb-4 block break-all font-mono text-[11px] text-muted-foreground">
                  {selected.path}
                </code>
                <Label className="mb-2 block">
                  Used by {selected.usedByAgents} agents
                </Label>
                <p className="font-mono text-[11px] text-muted-foreground">
                  Updated {selected.updatedAt}
                </p>
              </div>
            </div>
          </form>
        ) : (
          <div className="flex items-center justify-center font-mono text-sm text-muted-foreground">
            Select a prompt
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete prompt"
        description={`Delete prompt "${selected?.name ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete prompt"
        busy={pending === 'delete'}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void deletePrompt()}
      />
    </div>
  )
}

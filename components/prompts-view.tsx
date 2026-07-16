'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Search, Plus, Save, Trash2, FileText, Eye, Pencil } from 'lucide-react'
import type { GlobalPromptTemplate } from '@/lib/types'
import { deleteApiPromptsId } from '@/lib/api/generated/clients/deleteApiPromptsId'
import { postApiPrompts } from '@/lib/api/generated/clients/postApiPrompts'
import type { PostApiPromptsMutationRequest } from '@/lib/api/generated/types/PostApiPrompts'
import { postApiPromptsMutationRequestSchema } from '@/lib/api/generated/zod/postApiPromptsSchema'
import { refreshAfterMutation } from '@/lib/api/refresh'
import { errorMessage, showToast } from '@/lib/toast'
import { ActionButton, ConfirmDialog, Label, Tag, TextInput } from '@/components/pi-ui'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { MarkdownContent } from '@/components/markdown-content'

function promptDefaults(prompt?: GlobalPromptTemplate): PostApiPromptsMutationRequest {
  return {
    id: prompt?.id,
    name: prompt?.name ?? '',
    description: prompt?.description ?? '',
    argumentHint: prompt?.argumentHint ?? '',
    content: prompt?.content ?? '',
    path: prompt?.path,
    source: prompt?.source ?? 'studio',
    scope: prompt?.scope ?? 'global',
    tags: prompt?.tags ?? [],
  }
}

export function PromptsView({ prompts }: { prompts: GlobalPromptTemplate[] }) {
  const router = useRouter()
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
      const names = new Set(prompts.map((prompt) => prompt.name))
      let name = 'new-prompt'
      let suffix = 2
      while (names.has(name)) name = `new-prompt-${suffix++}`
      await postApiPrompts({
        name,
        description: '',
        argumentHint: '',
        content: 'Write your reusable prompt here.',
        source: 'studio',
        scope: 'global',
        tags: [],
      })
      refreshAfterMutation(`Prompt /${name} created.`)
    } catch (error) {
      showToast({
        tone: 'error',
        title: 'Unable to create prompt',
        message: errorMessage(error),
      })
    } finally {
      setPending(null)
    }
  }

  const savePrompt = async (values: PostApiPromptsMutationRequest) => {
    try {
      const updated = await postApiPrompts(values)
      showToast({
        tone: 'success',
        message: `Prompt /${updated.name} saved.`,
      })
      form.reset(values)
      router.refresh()
    } catch (error) {
      showToast({
        tone: 'error',
        title: 'Unable to save prompt',
        message: errorMessage(error),
      })
    }
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
          <h1 className="font-serif text-3xl text-foreground italic">Prompts</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Pi prompt templates invoked with slash commands and enabled per agent.
          </p>
        </div>
      </div>

      {prompts.length === 0 ? (
        <PromptsEmptyState onCreate={createPrompt} disabled={pending === 'new'} />
      ) : (
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
            <ScrollArea className="min-h-0 flex-1" viewportClassName="pr-3">
              <ul>
                {filtered.length === 0 ? (
                  <li className="px-4 py-12 text-center font-mono text-xs text-muted-foreground">
                    No prompts match your filters
                  </li>
                ) : (
                  filtered.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(p.id)}
                        className={cn(
                          'flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left transition-colors',
                          selectedId === p.id ? 'bg-card' : 'hover:bg-panel',
                        )}
                      >
                        <span
                          className={cn(
                            'font-mono text-[13px]',
                            selectedId === p.id ? 'text-accent' : 'text-foreground',
                          )}
                        >
                          /{p.name}
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
                  ))
                )}
              </ul>
            </ScrollArea>
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
                  aria-label="Prompt command name"
                  className="border-none bg-transparent font-mono text-sm text-foreground outline-none"
                />
                <div className="flex items-center gap-2">
                  <div className="flex h-8 items-center">
                    <Switch
                      checked={mode === 'preview'}
                      onCheckedChange={(checked) => setMode(checked ? 'preview' : 'edit')}
                      icons={{
                        unchecked: <Pencil className="size-3.5" />,
                        checked: <Eye className="size-3.5" />,
                      }}
                      aria-label={
                        mode === 'preview' ? 'Switch to prompt editor' : 'Switch to prompt preview'
                      }
                      title={mode === 'preview' ? 'Preview mode' : 'Edit mode'}
                    />
                  </div>
                  <ActionButton
                    variant="accent"
                    type="submit"
                    className="h-8 py-0"
                    disabled={form.formState.isSubmitting}
                  >
                    <Save className="size-3.5" />
                    Save
                  </ActionButton>
                  <ActionButton
                    variant="danger"
                    className="size-8 p-0"
                    title="Delete"
                    onClick={() => setConfirmDelete(true)}
                    disabled={pending === 'delete' || form.formState.isSubmitting}
                  >
                    <Trash2 className="size-3.5" />
                  </ActionButton>
                </div>
              </div>

              <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_260px] overflow-hidden">
                <ScrollArea
                  className="h-full min-h-0"
                  viewportClassName="p-4 pr-6"
                  contentClassName="h-full"
                >
                  {mode === 'edit' ? (
                    <textarea
                      {...form.register('content')}
                      className="h-full min-h-0 w-full resize-none border border-input bg-panel p-4 font-mono text-[13px] leading-relaxed text-foreground outline-none focus:border-ring"
                    />
                  ) : (
                    <div className="min-h-full border border-border bg-panel p-5">
                      {content.trim() ? (
                        <MarkdownContent content={content} accentBorder={false} />
                      ) : (
                        <p className="font-mono text-[12px] text-muted-foreground">
                          Nothing to preview.
                        </p>
                      )}
                    </div>
                  )}
                </ScrollArea>

                <div className="border-l border-border p-4">
                  <Label className="mb-2 block">Command</Label>
                  <div className="mb-4 border border-border bg-panel px-3 py-2 font-mono text-[12px] text-accent">
                    /{form.watch('name') || 'prompt'} {form.watch('argumentHint')}
                  </div>
                  <Label className="mb-2 block">Description</Label>
                  <textarea
                    {...form.register('description')}
                    rows={3}
                    className="mb-4 w-full resize-none border border-input bg-panel px-3 py-2 text-[13px] text-foreground outline-none focus:border-ring"
                  />
                  <Label className="mb-2 block">Argument hint</Label>
                  <input
                    {...form.register('argumentHint')}
                    placeholder="[focus] or <file>"
                    className="mb-4 w-full border border-input bg-panel px-3 py-2 font-mono text-[13px] text-foreground outline-none focus:border-ring"
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
                  <div className="mb-4 grid grid-cols-2 gap-3">
                    <div>
                      <Label className="mb-2 block">Source</Label>
                      <input type="hidden" {...form.register('source')} />
                      <div className="border border-border bg-panel px-2 py-2 font-mono text-[11px] text-muted-foreground">
                        {form.watch('source')}
                      </div>
                    </div>
                    <div>
                      <Label className="mb-2 block">Scope</Label>
                      <input type="hidden" {...form.register('scope')} />
                      <Select
                        value={form.watch('scope')}
                        onValueChange={(value) => {
                          if (value === 'global' || value === 'project') {
                            form.setValue('scope', value, {
                              shouldDirty: true,
                              shouldValidate: true,
                            })
                          }
                        }}
                      >
                        <SelectTrigger className="w-full text-[11px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="start">
                          <SelectItem value="global">Global</SelectItem>
                          <SelectItem value="project">Project</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Label className="mb-2 block">Path</Label>
                  <code className="mb-4 block font-mono text-[11px] break-all text-muted-foreground">
                    {selected.path}
                  </code>
                  <Label className="mb-2 block">Used by {selected.usedByAgents} agents</Label>
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
      )}
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

function PromptsEmptyState({ onCreate, disabled }: { onCreate: () => void; disabled?: boolean }) {
  return (
    <Empty className="py-24">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileText />
        </EmptyMedia>
        <EmptyTitle>No prompts yet</EmptyTitle>
        <EmptyDescription>
          Create a reusable prompt template, then enable it on agents that need the same instruction
          pattern.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <ActionButton variant="accent" onClick={onCreate} disabled={disabled}>
          <Plus className="size-3.5" />
          New prompt
        </ActionButton>
      </EmptyContent>
    </Empty>
  )
}

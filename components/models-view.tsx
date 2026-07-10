'use client'

import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import {
  Plus,
  Info,
  Star,
  Zap,
  Check,
  Circle,
  AlertTriangle,
  Save,
  Trash2,
  Eye,
  EyeOff,
} from 'lucide-react'
import type { GlobalModel, GlobalModelProvider, ProviderApi } from '@/lib/types'
import { deleteApiModelProvidersId } from '@/lib/api/generated/clients/deleteApiModelProvidersId'
import { deleteApiModelsId } from '@/lib/api/generated/clients/deleteApiModelsId'
import { postApiModelProviders } from '@/lib/api/generated/clients/postApiModelProviders'
import { postApiModelProvidersIdDefault } from '@/lib/api/generated/clients/postApiModelProvidersIdDefault'
import { postApiModelProvidersIdModels } from '@/lib/api/generated/clients/postApiModelProvidersIdModels'
import { postApiModelProvidersIdTest } from '@/lib/api/generated/clients/postApiModelProvidersIdTest'
import type { PostApiModelProvidersIdModelsMutationRequest } from '@/lib/api/generated/types/PostApiModelProvidersIdModels'
import { postApiModelProvidersIdModelsMutationRequestSchema } from '@/lib/api/generated/zod/postApiModelProvidersIdModelsSchema'
import { refreshAfterMutation } from '@/lib/api/refresh'
import {
  ActionButton,
  ConfirmDialog,
  Label,
  PageHeader,
  Panel,
  Tag,
} from '@/components/pi-ui'
import { cn } from '@/lib/utils'

const providerFormSchema = z.object({
  name: z.string().min(1),
  baseUrl: z.string().min(1),
  api: z.enum([
    'openai-completions',
    'openai-responses',
    'anthropic-messages',
    'google-generative-ai',
  ]),
  apiKey: z.string().optional(),
  headersText: z.string().optional(),
})
type ProviderForm = z.infer<typeof providerFormSchema>
const addModelFormSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  reasoning: z.boolean(),
  inputText: z.string().min(1).refine(
    (value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .every((item) => item === 'text' || item === 'image'),
    'Use text, image, or both separated by commas.',
  ),
  contextWindow: z
    .string()
    .optional()
    .refine((value) => !value || Number.isFinite(Number(value)), 'Use a number.'),
  maxTokens: z
    .string()
    .optional()
    .refine((value) => !value || Number.isFinite(Number(value)), 'Use a number.'),
})
type AddModelForm = z.infer<typeof addModelFormSchema>
const providerApis: ProviderApi[] = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai',
]

export function ModelsView({
  providers,
}: {
  providers: GlobalModelProvider[]
}) {
  const [providerList, setProviderList] = useState(providers)
  const [selectedId, setSelectedId] = useState(providers[0]?.id)
  const selected = providerList.find((p) => p.id === selectedId)
  const [pending, setPending] = useState<string | null>(null)

  const updateProvider = (provider: GlobalModelProvider) => {
    setProviderList((current) =>
      current.map((item) => {
        if (provider.isDefault && item.id !== provider.id) {
          return { ...item, isDefault: false }
        }
        return item.id === provider.id ? provider : item
      }),
    )
  }

  const addProvider = async () => {
    setPending('new-provider')
    try {
      const provider = await postApiModelProviders({
        name: 'New Provider',
        baseUrl: 'https://api.openai.com/v1',
        api: 'openai-responses',
        headers: {},
        status: 'untested',
      })
      setProviderList((current) => [provider, ...current])
      setSelectedId(provider.id)
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Models"
        subtitle="Providers and models available to your agents. Backed by pi's models.json."
      >
        <ActionButton
          variant="accent"
          onClick={addProvider}
          disabled={pending === 'new-provider'}
        >
          <Plus className="size-3.5" />
          Add Provider
        </ActionButton>
      </PageHeader>

      <div className="flex items-start gap-2.5 border-b border-border bg-panel px-6 py-2.5">
        <Info className="mt-0.5 size-4 shrink-0 text-accent" />
        <p className="text-[13px] text-muted-foreground">
          This release supports API key mode. OAuth login is a future TODO.
        </p>
      </div>

      <div className="grid flex-1 grid-cols-[300px_1fr] overflow-hidden">
        {/* Provider list */}
        <div className="flex flex-col border-r border-border">
          <div className="border-b border-border bg-panel px-4 py-2.5">
            <Label>Providers</Label>
          </div>
          <ul className="flex-1 overflow-y-auto scrollbar-thin">
            {providerList.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={cn(
                    'flex w-full flex-col gap-1.5 border-b border-border px-4 py-3 text-left transition-colors',
                    selectedId === p.id ? 'bg-card' : 'hover:bg-panel',
                  )}
                >
                  <div className="flex items-center gap-2">
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
                    {p.isDefault && (
                      <Star className="size-3 fill-warning text-warning" />
                    )}
                  </div>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {p.api}
                  </span>
                  <div className="flex items-center gap-2">
                    <StatusDot status={p.status} />
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {p.models.length} models
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Detail */}
        {selected && (
          <div className="overflow-y-auto scrollbar-thin p-6">
            <ProviderDetail
              key={selected.id}
              provider={selected}
              onProviderUpdate={updateProvider}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function StatusDot({
  status,
}: {
  status: GlobalModelProvider['status']
}) {
  if (status === 'connected')
    return (
      <span className="flex items-center gap-1 font-mono text-[10px] text-success">
        <Check className="size-3" />
        connected
      </span>
    )
  if (status === 'error')
    return (
      <span className="flex items-center gap-1 font-mono text-[10px] text-destructive">
        <AlertTriangle className="size-3" />
        error
      </span>
    )
  return (
    <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
      <Circle className="size-2.5" />
      untested
    </span>
  )
}

function ProviderDetail({
  provider,
  onProviderUpdate,
}: {
  provider: GlobalModelProvider
  onProviderUpdate: (provider: GlobalModelProvider) => void
}) {
  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<ProviderForm>({
    resolver: zodResolver(providerFormSchema as never),
    defaultValues: {
      name: provider.name,
      baseUrl: provider.baseUrl,
      api: provider.api,
      apiKey: provider.apiKey ?? '',
      headersText: JSON.stringify(provider.headers ?? {}, null, 2),
    },
  })
  const [pending, setPending] = useState<string | null>(null)
  const [displayModels, setDisplayModels] = useState<GlobalModel[]>(
    provider.models,
  )
  const [confirmProviderDelete, setConfirmProviderDelete] = useState(false)
  const [modelDeleteTarget, setModelDeleteTarget] = useState<string | null>(null)
  const [showAddModel, setShowAddModel] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [testResult, setTestResult] = useState<{
    ok: boolean
    status: string
    message?: string
  } | null>(null)
  const [saveResult, setSaveResult] = useState<string | null>(null)
  const [modelResult, setModelResult] = useState<string | null>(null)

  const saveProvider = async (values: ProviderForm) => {
    setSaveResult(null)
    let headers: Record<string, string> = {}
    if (values.headersText?.trim()) {
      headers = JSON.parse(values.headersText) as Record<string, string>
    }
    const updated = await postApiModelProviders({
      id: provider.id,
      name: values.name,
      baseUrl: values.baseUrl,
      api: values.api,
      apiKey: values.apiKey,
      headers,
      isDefault: provider.isDefault,
      status: provider.status,
    })
    onProviderUpdate(updated)
    setSaveResult('Provider saved.')
  }

  const testProvider = async () => {
    setPending('test')
    setTestResult(null)
    try {
      const result = await postApiModelProvidersIdTest(provider.id)
      if (result.status === 'connected' || result.status === 'error') {
        onProviderUpdate({ ...provider, status: result.status })
      }
      setTestResult({
        ok: result.ok,
        status: result.status,
        message: result.message,
      })
    } catch (error) {
      setTestResult({
        ok: false,
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Connection test failed.',
      })
    } finally {
      setPending(null)
    }
  }

  const setDefault = async () => {
    setPending('default')
    try {
      const updated = await postApiModelProvidersIdDefault(provider.id)
      onProviderUpdate(updated)
    } finally {
      setPending(null)
    }
  }

  const deleteProvider = async () => {
    setPending('delete')
    try {
      await deleteApiModelProvidersId(provider.id)
      refreshAfterMutation()
    } finally {
      setPending(null)
      setConfirmProviderDelete(false)
    }
  }

  const addModel = async (model: PostApiModelProvidersIdModelsMutationRequest) => {
    setModelResult(null)
    setPending('model:add')
    try {
      const updated = await postApiModelProvidersIdModels(provider.id, model)
      setDisplayModels(updated.models as GlobalModel[])
      setModelResult(`Model "${model.id}" added.`)
      setShowAddModel(false)
    } finally {
      setPending(null)
    }
  }

  const deleteModel = async (id: string) => {
    setPending(`model:${id}`)
    try {
      const updated = await deleteApiModelsId(id)
      setDisplayModels(updated.models as GlobalModel[])
    } finally {
      setPending(null)
      setModelDeleteTarget(null)
    }
  }

  return (
    <>
    <form onSubmit={handleSubmit(saveProvider)} className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-serif text-2xl italic text-foreground">
            {provider.name}
          </h2>
          {provider.isDefault && <Tag tone="warning">default</Tag>}
        </div>
        <div className="flex items-center gap-2">
          <ActionButton onClick={testProvider} disabled={pending === 'test'}>
            <Zap className="size-3.5" />
            {pending === 'test' ? 'Testing' : 'Test connection'}
          </ActionButton>
          <ActionButton onClick={setDefault} disabled={pending === 'default'}>
            <Star className="size-3.5" />
            {provider.isDefault ? 'Unset default' : 'Set default'}
          </ActionButton>
          <ActionButton variant="accent" type="submit" disabled={isSubmitting}>
            <Save className="size-3.5" />
            Save
          </ActionButton>
          <ActionButton
            variant="danger"
            onClick={() => setConfirmProviderDelete(true)}
            disabled={pending === 'delete' || isSubmitting}
          >
            <Trash2 className="size-3.5" />
          </ActionButton>
        </div>
      </div>
      {testResult && (
        <div className="flex items-center justify-between gap-3 border border-border bg-panel px-3 py-2">
          <span className="font-mono text-xs text-foreground">
            {testResult.message}
          </span>
          <Tag tone={testResult.ok ? 'success' : 'warning'}>
            {testResult.status}
          </Tag>
        </div>
      )}
      {saveResult && (
        <div className="flex items-center justify-between gap-3 border border-border bg-panel px-3 py-2">
          <span className="font-mono text-xs text-foreground">
            {saveResult}
          </span>
          <Tag tone="success">saved</Tag>
        </div>
      )}
      {modelResult && (
        <div className="flex items-center justify-between gap-3 border border-border bg-panel px-3 py-2">
          <span className="font-mono text-xs text-foreground">
            {modelResult}
          </span>
          <Tag tone="success">added</Tag>
        </div>
      )}

      {/* Config */}
      <Panel className="p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Config label="Name" error={errors.name?.message}>
            <input {...register('name')} className="w-full border border-input bg-panel px-3 py-1.5 text-[13px] text-foreground outline-none focus:border-ring" />
          </Config>
          <Config label="Base URL" error={errors.baseUrl?.message}>
            <input {...register('baseUrl')} className="w-full border border-input bg-panel px-3 py-1.5 font-mono text-[13px] text-foreground outline-none focus:border-ring" />
          </Config>
          <Config label="API type">
            <select {...register('api')} className="w-full border border-input bg-panel px-3 py-1.5 font-mono text-[13px] text-foreground outline-none focus:border-ring">
              {providerApis.map((api) => (
                <option key={api} value={api}>
                  {api}
                </option>
              ))}
            </select>
          </Config>
          <Config label="API key">
            <div className="flex border border-input bg-panel focus-within:border-ring">
              <input
                {...register('apiKey')}
                type={showApiKey ? 'text' : 'password'}
                className="min-w-0 flex-1 bg-transparent px-3 py-1.5 font-mono text-[13px] text-foreground outline-none"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((value) => !value)}
                className="flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
                aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
              >
                {showApiKey ? (
                  <EyeOff className="size-3.5" />
                ) : (
                  <Eye className="size-3.5" />
                )}
              </button>
            </div>
          </Config>
        </div>
        <div className="mt-4">
          <Label className="mb-1.5 block">Custom headers</Label>
          <textarea
            {...register('headersText')}
            rows={5}
            className="w-full resize-none border border-input bg-panel px-3 py-1.5 font-mono text-[12px] text-foreground outline-none focus:border-ring"
          />
        </div>
      </Panel>

      {/* Models table */}
      <Panel>
        <div className="flex items-center justify-between border-b border-border bg-panel px-4 py-2.5">
          <Label>Models</Label>
          <ActionButton
            variant="ghost"
            onClick={() => setShowAddModel(true)}
            disabled={pending === 'model:add'}
          >
            <Plus className="size-3.5" />
            Add model
          </ActionButton>
        </div>
        <div className="grid grid-cols-[1.4fr_90px_90px_110px_90px_42px] items-center gap-4 border-b border-border px-4 py-2 font-mono-label text-[10px] text-muted-foreground">
          <span>Model</span>
          <span>Reasoning</span>
          <span>Input</span>
          <span>Context</span>
          <span>Max out</span>
          <span />
        </div>
        <ul className="divide-y divide-border">
          {displayModels.map((m) => (
            <li
              key={m.id}
              className="grid grid-cols-[1.4fr_90px_90px_110px_90px_42px] items-center gap-4 px-4 py-2.5"
            >
              <div className="min-w-0">
                <span className="font-mono text-[13px] text-foreground">
                  {m.name}
                </span>
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {m.id}
                </p>
              </div>
              <span>
                {m.reasoning ? (
                  <Tag tone="accent">yes</Tag>
                ) : (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    no
                  </span>
                )}
              </span>
              <div className="flex gap-1">
                {m.input.map((i) => (
                  <Tag key={i} tone="outline">
                    {i}
                  </Tag>
                ))}
              </div>
              <span className="font-mono text-[12px] text-muted-foreground">
                {m.contextWindow?.toLocaleString()}
              </span>
              <span className="font-mono text-[12px] text-muted-foreground">
                {m.maxTokens?.toLocaleString()}
              </span>
              <ActionButton
                variant="ghost"
                title="Delete model"
                onClick={() => setModelDeleteTarget(m.id)}
                disabled={pending === `model:${m.id}`}
              >
                <Trash2 className="size-3.5" />
              </ActionButton>
            </li>
          ))}
        </ul>
      </Panel>
    </form>
    <ConfirmDialog
      open={confirmProviderDelete}
      title="Delete provider"
      description={`Delete provider "${provider.name}"? This cannot be undone.`}
      confirmLabel="Delete provider"
      busy={pending === 'delete'}
      onCancel={() => setConfirmProviderDelete(false)}
      onConfirm={() => void deleteProvider()}
    />
    <ConfirmDialog
      open={Boolean(modelDeleteTarget)}
      title="Delete model"
      description={`Delete model "${modelDeleteTarget ?? ''}"? This cannot be undone.`}
      confirmLabel="Delete model"
      busy={
        modelDeleteTarget ? pending === `model:${modelDeleteTarget}` : false
      }
      onCancel={() => setModelDeleteTarget(null)}
      onConfirm={() => {
        if (modelDeleteTarget) void deleteModel(modelDeleteTarget)
      }}
    />
    <AddModelDialog
      open={showAddModel}
      busy={pending === 'model:add'}
      onCancel={() => setShowAddModel(false)}
      onSubmit={(model) => void addModel(model)}
    />
    </>
  )
}

function AddModelDialog({
  open,
  busy,
  onCancel,
  onSubmit,
}: {
  open: boolean
  busy?: boolean
  onCancel: () => void
  onSubmit: (model: PostApiModelProvidersIdModelsMutationRequest) => void
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AddModelForm>({
    resolver: zodResolver(addModelFormSchema as never),
    defaultValues: {
      id: '',
      name: '',
      reasoning: false,
      inputText: 'text',
      contextWindow: '',
      maxTokens: '',
    },
  })

  const submit = (values: AddModelForm) => {
    const model = postApiModelProvidersIdModelsMutationRequestSchema.parse({
      id: values.id,
      name: values.name || values.id,
      reasoning: values.reasoning,
      input: values.inputText
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      contextWindow: values.contextWindow
        ? Number(values.contextWindow)
        : undefined,
      maxTokens: values.maxTokens ? Number(values.maxTokens) : undefined,
    })
    onSubmit(model)
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-model-title"
    >
      <button
        type="button"
        aria-label="Close add model"
        onClick={busy ? undefined : onCancel}
        className="absolute inset-0 bg-foreground/25"
      />
      <form
        onSubmit={handleSubmit(submit)}
        className="relative w-full max-w-lg border border-border bg-card shadow-xl"
      >
        <div className="border-b border-border bg-panel px-4 py-3">
          <h2
            id="add-model-title"
            className="font-serif text-lg italic text-foreground"
          >
            Add model
          </h2>
        </div>
        <div className="space-y-4 p-4">
          <Config label="Model ID" error={errors.id?.message}>
            <input
              {...register('id')}
              className="w-full border border-input bg-panel px-3 py-1.5 font-mono text-[13px] text-foreground outline-none focus:border-ring"
            />
          </Config>
          <Config label="Display name">
            <input
              {...register('name')}
              className="w-full border border-input bg-panel px-3 py-1.5 text-[13px] text-foreground outline-none focus:border-ring"
            />
          </Config>
          <Config label="Input types (comma separated)" error={errors.inputText?.message}>
            <input
              {...register('inputText')}
              className="w-full border border-input bg-panel px-3 py-1.5 font-mono text-[13px] text-foreground outline-none focus:border-ring"
            />
          </Config>
          <div className="grid gap-4 sm:grid-cols-2">
            <Config label="Context window">
              <input
                {...register('contextWindow')}
                inputMode="numeric"
                className="w-full border border-input bg-panel px-3 py-1.5 font-mono text-[13px] text-foreground outline-none focus:border-ring"
              />
            </Config>
            <Config label="Max output">
              <input
                {...register('maxTokens')}
                inputMode="numeric"
                className="w-full border border-input bg-panel px-3 py-1.5 font-mono text-[13px] text-foreground outline-none focus:border-ring"
              />
            </Config>
          </div>
          <label className="flex items-center gap-2 font-mono text-xs text-foreground">
            <input type="checkbox" {...register('reasoning')} />
            Reasoning model
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border bg-panel px-4 py-3">
          <ActionButton onClick={onCancel} disabled={busy}>
            Cancel
          </ActionButton>
          <ActionButton variant="accent" type="submit" disabled={busy}>
            Add model
          </ActionButton>
        </div>
      </form>
    </div>
  )
}

function Config({
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

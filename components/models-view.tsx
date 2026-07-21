'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import {
  Plus,
  Info,
  CircleHelp,
  Star,
  Zap,
  Check,
  Circle,
  Cpu,
  AlertTriangle,
  Save,
  Trash2,
  Eye,
  EyeOff,
  Pencil,
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
import { errorMessage, showToast } from '@/lib/toast'
import { ActionButton, ConfirmDialog, Label, PageHeader, Panel, Tag } from '@/components/pi-ui'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { NumberField } from '@/components/ui/number-field'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { cn } from '@/lib/utils'

const DEFAULT_CONTEXT_WINDOW = 128_000
const DEFAULT_MAX_OUTPUT = 8_192
const inputTypeOptions = [
  { value: 'text', label: 'Text' },
  { value: 'image', label: 'Image' },
] as const

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
  userAgent: z.string().optional(),
})
type ProviderForm = z.infer<typeof providerFormSchema>
const addModelFormSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  reasoning: z.boolean(),
  inputTypes: z.array(z.enum(['text', 'image'])).min(1, 'Select at least one input type.'),
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

const CUSTOM_USER_AGENT = '__custom__'
const USER_AGENT_PRESETS = [
  { value: 'Pi-Studio/1.0', label: 'Pi Studio' },
  { value: 'claude-cli/2.1.202 (external, cli)', label: 'Claude Code CLI' },
  {
    value: 'claude-cli/2.1.202 (external, claude-vscode, agent-sdk/0.3.202)',
    label: 'Claude VS Code',
  },
  {
    value: 'codex_cli_rs/0.144.5 (Mac OS 15.5.0; aarch64) Apple_Terminal',
    label: 'Codex CLI (macOS ARM)',
  },
  { value: 'OpenAI-Compatible-Client/1.0', label: 'OpenAI-compatible client' },
  { value: 'Anthropic-Compatible-Client/1.0', label: 'Anthropic-compatible client' },
  { value: 'curl/8.0.1', label: 'curl' },
  { value: 'Mozilla/5.0', label: 'Browser-like' },
] as const

const providerBrand: Record<ProviderApi, { label: string }> = {
  'openai-completions': {
    label: 'OPENAI',
  },
  'openai-responses': {
    label: 'OPENAI',
  },
  'anthropic-messages': {
    label: 'CLAUDE',
  },
  'google-generative-ai': {
    label: 'GEMINI',
  },
}

function headerValue(headers: Record<string, string> | undefined, name: string) {
  const expected = name.toLowerCase()
  return Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === expected)?.[1] ?? ''
}

function withUserAgent(headers: Record<string, string>, userAgent: string) {
  const next = Object.fromEntries(
    Object.entries(headers).filter(([key]) => key.toLowerCase() !== 'user-agent'),
  )
  const trimmed = userAgent.trim()
  if (trimmed) next['User-Agent'] = trimmed
  return next
}

export function ModelsView({ providers }: { providers: GlobalModelProvider[] }) {
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
      showToast({ tone: 'success', message: 'Provider created.' })
    } catch (error) {
      showToast({ tone: 'error', message: errorMessage(error) })
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
        <ActionButton variant="accent" onClick={addProvider} disabled={pending === 'new-provider'}>
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

      {providerList.length === 0 ? (
        <ModelsEmptyState onAdd={addProvider} disabled={pending === 'new-provider'} />
      ) : (
        <div className="grid flex-1 grid-cols-[300px_1fr] overflow-hidden">
          {/* Provider list */}
          <div className="flex flex-col border-r border-border">
            <div className="border-b border-border bg-panel px-4 py-2.5">
              <Label>Providers</Label>
            </div>
            <ul className="scrollbar-thin flex-1 overflow-y-auto">
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
                    <div className="flex items-center gap-2.5">
                      <ProviderLogo api={p.api} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              'truncate font-mono text-[13px]',
                              selectedId === p.id ? 'text-accent' : 'text-foreground',
                            )}
                          >
                            {p.name}
                          </span>
                          {p.isDefault && (
                            <Star className="size-3 shrink-0 fill-warning text-warning" />
                          )}
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <StatusDot status={p.status} />
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {p.models.length} models
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Detail */}
          {selected && (
            <div className="scrollbar-thin overflow-y-auto p-6">
              <ProviderDetail
                key={selected.id}
                provider={selected}
                onProviderUpdate={updateProvider}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatusDot({ status }: { status: GlobalModelProvider['status'] }) {
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

function ModelsEmptyState({ onAdd, disabled }: { onAdd: () => void; disabled?: boolean }) {
  return (
    <Empty className="py-24">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Cpu />
        </EmptyMedia>
        <EmptyTitle>No model providers yet</EmptyTitle>
        <EmptyDescription>
          Add a provider with its base URL, API key, and model ids before agents can use local Pi
          chat runs.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <ActionButton variant="accent" onClick={onAdd} disabled={disabled}>
          <Plus className="size-3.5" />
          Add Provider
        </ActionButton>
      </EmptyContent>
    </Empty>
  )
}

export function ProviderLogo({ api }: { api: ProviderApi }) {
  const brand = providerBrand[api]
  return (
    <span title={brand.label} className="flex size-8 shrink-0 items-center justify-center">
      {api === 'anthropic-messages' ? (
        <ClaudeLogo />
      ) : api === 'google-generative-ai' ? (
        <GeminiLogo />
      ) : (
        <OpenAILogo />
      )}
    </span>
  )
}

function OpenAILogo() {
  return (
    <svg
      viewBox="-1 -.1 949.1 959.8"
      aria-hidden="true"
      focusable="false"
      className="size-5 fill-foreground"
    >
      <path d="m925.8 456.3c10.4 23.2 17 48 19.7 73.3 2.6 25.3 1.3 50.9-4.1 75.8-5.3 24.9-14.5 48.8-27.3 70.8-8.4 14.7-18.3 28.5-29.7 41.2-11.3 12.6-23.9 24-37.6 34-13.8 10-28.5 18.4-44.1 25.3-15.5 6.8-31.7 12-48.3 15.4-7.8 24.2-19.4 47.1-34.4 67.7-14.9 20.6-33 38.7-53.6 53.6-20.6 15-43.4 26.6-67.6 34.4-24.2 7.9-49.5 11.8-75 11.8-16.9.1-33.9-1.7-50.5-5.1-16.5-3.5-32.7-8.8-48.2-15.7s-30.2-15.5-43.9-25.5c-13.6-10-26.2-21.5-37.4-34.2-25 5.4-50.6 6.7-75.9 4.1-25.3-2.7-50.1-9.3-73.4-19.7-23.2-10.3-44.7-24.3-63.6-41.4s-35-37.1-47.7-59.1c-8.5-14.7-15.5-30.2-20.8-46.3s-8.8-32.7-10.6-49.6c-1.8-16.8-1.7-33.8.1-50.7 1.8-16.8 5.5-33.4 10.8-49.5-17-18.9-31-40.4-41.4-63.6-10.3-23.3-17-48-19.6-73.3-2.7-25.3-1.3-50.9 4-75.8s14.5-48.8 27.3-70.8c8.4-14.7 18.3-28.6 29.6-41.2s24-24 37.7-34 28.5-18.5 44-25.3c15.6-6.9 31.8-12 48.4-15.4 7.8-24.3 19.4-47.1 34.3-67.7 15-20.6 33.1-38.7 53.7-53.7 20.6-14.9 43.4-26.5 67.6-34.4 24.2-7.8 49.5-11.8 75-11.7 16.9-.1 33.9 1.6 50.5 5.1s32.8 8.7 48.3 15.6c15.5 7 30.2 15.5 43.9 25.5 13.7 10.1 26.3 21.5 37.5 34.2 24.9-5.3 50.5-6.6 75.8-4s50 9.3 73.3 19.6c23.2 10.4 44.7 24.3 63.6 41.4 18.9 17 35 36.9 47.7 59 8.5 14.6 15.5 30.1 20.8 46.3 5.3 16.1 8.9 32.7 10.6 49.6 1.8 16.9 1.8 33.9-.1 50.8-1.8 16.9-5.5 33.5-10.8 49.6 17.1 18.9 31 40.3 41.4 63.6zm-333.2 426.9c21.8-9 41.6-22.3 58.3-39s30-36.5 39-58.4c9-21.8 13.7-45.2 13.7-68.8v-223q-.1-.3-.2-.7-.1-.3-.3-.6-.2-.3-.5-.5-.3-.3-.6-.4l-80.7-46.6v269.4c0 2.7-.4 5.5-1.1 8.1-.7 2.7-1.7 5.2-3.1 7.6s-3 4.6-5 6.5a32.1 32.1 0 0 1 -6.5 5l-191.1 110.3c-1.6 1-4.3 2.4-5.7 3.2 7.9 6.7 16.5 12.6 25.5 17.8 9.1 5.2 18.5 9.6 28.3 13.2 9.8 3.5 19.9 6.2 30.1 8 10.3 1.8 20.7 2.7 31.1 2.7 23.6 0 47-4.7 68.8-13.8zm-455.1-151.4c11.9 20.5 27.6 38.3 46.3 52.7 18.8 14.4 40.1 24.9 62.9 31s46.6 7.7 70 4.6 45.9-10.7 66.4-22.5l193.2-111.5.5-.5q.2-.2.3-.6.2-.3.3-.6v-94l-233.2 134.9c-2.4 1.4-4.9 2.4-7.5 3.2-2.7.7-5.4 1-8.2 1-2.7 0-5.4-.3-8.1-1-2.6-.8-5.2-1.8-7.6-3.2l-191.1-110.4c-1.7-1-4.2-2.5-5.6-3.4-1.8 10.3-2.7 20.7-2.7 31.1s1 20.8 2.8 31.1c1.8 10.2 4.6 20.3 8.1 30.1 3.6 9.8 8 19.2 13.2 28.2zm-50.2-417c-11.8 20.5-19.4 43.1-22.5 66.5s-1.5 47.1 4.6 70c6.1 22.8 16.6 44.1 31 62.9 14.4 18.7 32.3 34.4 52.7 46.2l193.1 111.6q.3.1.7.2h.7q.4 0 .7-.2.3-.1.6-.3l81-46.8-233.2-134.6c-2.3-1.4-4.5-3.1-6.5-5a32.1 32.1 0 0 1 -5-6.5c-1.3-2.4-2.4-4.9-3.1-7.6-.7-2.6-1.1-5.3-1-8.1v-227.1c-9.8 3.6-19.3 8-28.3 13.2-9 5.3-17.5 11.3-25.5 18-7.9 6.7-15.3 14.1-22 22.1-6.7 7.9-12.6 16.5-17.8 25.5zm663.3 154.4c2.4 1.4 4.6 3 6.6 5 1.9 1.9 3.6 4.1 5 6.5 1.3 2.4 2.4 5 3.1 7.6.6 2.7 1 5.4.9 8.2v227.1c32.1-11.8 60.1-32.5 80.8-59.7 20.8-27.2 33.3-59.7 36.2-93.7s-3.9-68.2-19.7-98.5-39.9-55.5-69.5-72.5l-193.1-111.6q-.3-.1-.7-.2h-.7q-.3.1-.7.2-.3.1-.6.3l-80.6 46.6 233.2 134.7zm80.5-121h-.1v.1zm-.1-.1c5.8-33.6 1.9-68.2-11.3-99.7-13.1-31.5-35-58.6-63-78.2-28-19.5-61-30.7-95.1-32.2-34.2-1.4-68 6.9-97.6 23.9l-193.1 111.5q-.3.2-.5.5l-.4.6q-.1.3-.2.7-.1.3-.1.7v93.2l233.2-134.7c2.4-1.4 5-2.4 7.6-3.2 2.7-.7 5.4-1 8.1-1 2.8 0 5.5.3 8.2 1 2.6.8 5.1 1.8 7.5 3.2l191.1 110.4c1.7 1 4.2 2.4 5.6 3.3zm-505.3-103.2c0-2.7.4-5.4 1.1-8.1.7-2.6 1.7-5.2 3.1-7.6 1.4-2.3 3-4.5 5-6.5 1.9-1.9 4.1-3.6 6.5-4.9l191.1-110.3c1.8-1.1 4.3-2.5 5.7-3.2-26.2-21.9-58.2-35.9-92.1-40.2-33.9-4.4-68.3 1-99.2 15.5-31 14.5-57.2 37.6-75.5 66.4-18.3 28.9-28 62.3-28 96.5v223q.1.4.2.7.1.3.3.6.2.3.5.6.2.2.6.4l80.7 46.6zm43.8 294.7 103.9 60 103.9-60v-119.9l-103.8-60-103.9 60z" />
    </svg>
  )
}

function ClaudeLogo() {
  return (
    <svg viewBox="0 -.01 39.5 39.53" aria-hidden="true" focusable="false" className="size-5">
      <path
        d="m7.75 26.27 7.77-4.36.13-.38-.13-.21h-.38l-1.3-.08-4.44-.12-3.85-.16-3.73-.2-.94-.2-.88-1.16.09-.58.79-.53 1.13.1 2.5.17 3.75.26 2.72.16 4.03.42h.64l.09-.26-.22-.16-.17-.16-3.88-2.63-4.2-2.78-2.2-1.6-1.19-.81-.6-.76-.26-1.66 1.08-1.19 1.45.1.37.1 1.47 1.13 3.14 2.43 4.1 3.02.6.5.24-.17.03-.12-.27-.45-2.23-4.03-2.38-4.1-1.06-1.7-.28-1.02c-.1-.42-.17-.77-.17-1.2l1.23-1.67.68-.22 1.64.22.69.6 1.02 2.33 1.65 3.67 2.56 4.99.75 1.48.4 1.37.15.42h.26v-.24l.21-2.81.39-3.45.38-4.44.13-1.25.62-1.5 1.23-.81.96.46.79 1.13-.11.73-.47 3.05-.92 4.78-.6 3.2h.35l.4-.4 1.62-2.15 2.72-3.4 1.2-1.35 1.4-1.49.9-.71h1.7l1.25 1.86-.56 1.92-1.75 2.22-1.45 1.88-2.08 2.8-1.3 2.24.12.18.31-.03 4.7-1 2.54-.46 3.03-.52 1.37.64.15.65-.54 1.33-3.24.8-3.8.76-5.66 1.34-.07.05.08.1 2.55.24 1.09.06h2.67l4.97.37 1.3.86.78 1.05-.13.8-2 1.02-2.7-.64-6.3-1.5-2.16-.54h-.3v.18l1.8 1.76 3.3 2.98 4.13 3.84.21.95-.53.75-.56-.08-3.63-2.73-1.4-1.23-3.17-2.67h-.21v.28l.73 1.07 3.86 5.8.2 1.78-.28.58-1 .35-1.1-.2-2.26-3.17-2.33-3.57-1.88-3.2-.23.13-1.11 11.95-.52.61-1.2.46-1-.76-.53-1.23.53-2.43.64-3.17.52-2.52.47-3.13.28-1.04-.02-.07-.23.03-2.36 3.24-3.59 4.85-2.84 3.04-.68.27-1.18-.61.11-1.09.66-.97 3.93-5 2.37-3.1 1.53-1.79-.01-.26h-.09l-10.44 6.78-1.86.24-.8-.75.1-1.23.38-.4 3.14-2.16z"
        fill="#d97757"
      />
    </svg>
  )
}

function GeminiLogo() {
  const gradientId = useId().replace(/:/g, '')
  return (
    <svg viewBox="0 0 28.01 28" aria-hidden="true" focusable="false" className="size-5">
      <radialGradient
        id={gradientId}
        cx="-576.08"
        cy="491.7"
        gradientTransform="matrix(28.2302 9.54441 76.4642 -226.16369 -21336.18 116711.38)"
        gradientUnits="userSpaceOnUse"
        r="1"
      >
        <stop offset=".07" stopColor="#9168c0" />
        <stop offset=".34" stopColor="#5684d1" />
        <stop offset=".67" stopColor="#1ba1e3" />
      </radialGradient>
      <path
        d="M14 28c0-1.94-.37-3.76-1.12-5.46-.72-1.7-1.72-3.19-2.98-4.45s-2.74-2.25-4.44-2.97C3.76 14.37 1.94 14 0 14c1.94 0 3.76-.36 5.46-1.09 1.7-.75 3.19-1.75 4.44-3.01 1.26-1.26 2.25-2.74 2.98-4.44C13.63 3.76 14 1.94 14 0c0 1.94.36 3.76 1.09 5.46.75 1.7 1.75 3.19 3.01 4.44 1.26 1.26 2.74 2.26 4.45 3.01 1.7.72 3.52 1.09 5.46 1.09-1.94 0-3.76.37-5.46 1.12-1.7.72-3.19 1.71-4.45 2.97s-2.26 2.74-3.01 4.45A13.86 13.86 0 0 0 14 28z"
        fill={`url(#${gradientId})`}
      />
    </svg>
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
    control,
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
      userAgent: headerValue(provider.headers, 'user-agent'),
    },
  })
  const [pending, setPending] = useState<string | null>(null)
  const [displayModels, setDisplayModels] = useState<GlobalModel[]>(provider.models)
  const [confirmProviderDelete, setConfirmProviderDelete] = useState(false)
  const [modelDeleteTarget, setModelDeleteTarget] = useState<string | null>(null)
  const [showAddModel, setShowAddModel] = useState(false)
  const [editingModel, setEditingModel] = useState<GlobalModel | null>(null)
  const [showApiKey, setShowApiKey] = useState(true)
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string }>>([])
  const [loadingModels, setLoadingModels] = useState(false)

  const saveProvider = async (values: ProviderForm) => {
    try {
      let headers: Record<string, string> = {}
      if (values.headersText?.trim()) {
        headers = JSON.parse(values.headersText) as Record<string, string>
      }
      headers = withUserAgent(headers, values.userAgent ?? '')
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
      showToast({ tone: 'success', message: `Provider "${values.name}" saved.` })
    } catch (error) {
      showToast({ tone: 'error', message: errorMessage(error) })
    }
  }

  const testProvider = async () => {
    setPending('test')
    try {
      const result = await postApiModelProvidersIdTest(provider.id)
      if (result.status === 'connected' || result.status === 'error') {
        onProviderUpdate({ ...provider, status: result.status })
      }
      showToast({
        tone: result.ok ? 'success' : 'error',
        title: result.ok ? 'Connection successful' : 'Connection failed',
        message: result.message,
      })
    } catch (error) {
      showToast({
        tone: 'error',
        title: 'Connection failed',
        message: errorMessage(error, 'Connection test failed.'),
      })
    } finally {
      setPending(null)
    }
  }

  const openAddModel = async () => {
    setShowAddModel(true)
    setLoadingModels(true)
    try {
      const response = await fetch(
        `/api/model-providers/${encodeURIComponent(provider.id)}/available-models`,
      )
      const body = (await response.json()) as
        Array<{ id: string; name: string }> | { error?: string }
      if (!response.ok || !Array.isArray(body)) {
        throw new Error(Array.isArray(body) ? 'Unable to load models.' : body.error)
      }
      setAvailableModels(body)
    } catch (error) {
      setAvailableModels([])
      showToast({ tone: 'error', title: 'Unable to load models', message: errorMessage(error) })
    } finally {
      setLoadingModels(false)
    }
  }

  const setDefault = async () => {
    setPending('default')
    try {
      const updated = await postApiModelProvidersIdDefault(provider.id)
      onProviderUpdate(updated)
      showToast({
        tone: 'success',
        message: updated.isDefault
          ? `${provider.name} set as default.`
          : `${provider.name} is no longer default.`,
      })
    } catch (error) {
      showToast({ tone: 'error', message: errorMessage(error) })
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

  const upsertModel = async (
    model: PostApiModelProvidersIdModelsMutationRequest,
    mode: 'add' | 'edit',
  ) => {
    setPending(mode === 'add' ? 'model:add' : `model:edit:${model.originalId ?? model.id}`)
    try {
      const updated = await postApiModelProvidersIdModels(provider.id, model)
      setDisplayModels(updated.models as GlobalModel[])
      onProviderUpdate(updated)
      showToast({
        tone: 'success',
        message: mode === 'add' ? `Model "${model.id}" added.` : `Model "${model.id}" updated.`,
      })
      setShowAddModel(false)
      setEditingModel(null)
    } catch (error) {
      showToast({ tone: 'error', message: errorMessage(error) })
    } finally {
      setPending(null)
    }
  }

  const deleteModel = async (id: string) => {
    setPending(`model:${id}`)
    try {
      const updated = await deleteApiModelsId(id, { providerId: provider.id })
      setDisplayModels(updated.models as GlobalModel[])
      onProviderUpdate(updated)
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
            <h2 className="font-serif text-2xl text-foreground italic">{provider.name}</h2>
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

        {/* Config */}
        <Panel className="p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Config label="Name" error={errors.name?.message}>
              <input
                {...register('name')}
                className="w-full border border-input bg-panel px-3 py-1.5 text-[13px] text-foreground outline-none focus:border-ring"
              />
            </Config>
            <Config label="Base URL" error={errors.baseUrl?.message}>
              <input
                {...register('baseUrl')}
                className="w-full border border-input bg-panel px-3 py-1.5 font-mono text-[13px] text-foreground outline-none focus:border-ring"
              />
            </Config>
            <Config label="API type">
              <Controller
                control={control}
                name="api"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(value) => {
                      if (value !== null) field.onChange(value)
                    }}
                  >
                    <SelectTrigger
                      ref={field.ref}
                      onBlur={field.onBlur}
                      className="w-full text-[13px]"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start">
                      {providerApis.map((api) => (
                        <SelectItem key={api} value={api}>
                          {api}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Config>
            <Config label="API key">
              <div className="flex border border-input bg-panel focus-within:border-ring">
                <Controller
                  control={control}
                  name="apiKey"
                  render={({ field }) => (
                    <input
                      ref={field.ref}
                      name={field.name}
                      type="text"
                      value={
                        showApiKey
                          ? (field.value ?? '')
                          : field.value
                            ? '*'.repeat(field.value.length)
                            : ''
                      }
                      readOnly={!showApiKey}
                      onBlur={field.onBlur}
                      onChange={showApiKey ? field.onChange : undefined}
                      className={cn(
                        'min-w-0 flex-1 bg-transparent px-3 py-1.5 font-mono text-[13px] outline-none',
                        showApiKey ? 'text-foreground' : 'cursor-default text-muted-foreground',
                      )}
                    />
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((value) => !value)}
                  className="flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
                  aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                >
                  {showApiKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
              </div>
            </Config>
          </div>
          <div className="mt-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Config label="User-Agent">
                <Controller
                  control={control}
                  name="userAgent"
                  render={({ field }) => {
                    const preset =
                      USER_AGENT_PRESETS.find((item) => item.value === field.value)?.value ??
                      CUSTOM_USER_AGENT
                    return (
                      <div className="flex gap-2">
                        <Input
                          ref={field.ref}
                          name={field.name}
                          value={field.value ?? ''}
                          onBlur={field.onBlur}
                          onChange={field.onChange}
                          placeholder="Enter a custom User-Agent"
                          className="min-w-0 flex-1 rounded-none border-input bg-panel font-mono text-[12px]"
                        />
                        <Select
                          value={preset}
                          onValueChange={(value) => {
                            if (value === CUSTOM_USER_AGENT) field.onChange('')
                            else if (value !== null) field.onChange(value)
                          }}
                        >
                          <SelectTrigger className="shrink-0">
                            <SelectValue>
                              {preset === CUSTOM_USER_AGENT ? 'Custom' : 'Preset'}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent
                            align="end"
                            alignItemWithTrigger={false}
                            className="w-max min-w-(--anchor-width)"
                          >
                            <SelectGroup>
                              {USER_AGENT_PRESETS.map((item) => (
                                <SelectItem key={item.value} value={item.value}>
                                  {item.label}
                                </SelectItem>
                              ))}
                              <SelectItem value={CUSTOM_USER_AGENT}>Custom</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>
                    )
                  }}
                />
              </Config>
              <Config label="Custom headers">
                <textarea
                  {...register('headersText')}
                  rows={5}
                  className="w-full resize-none border border-input bg-panel px-3 py-1.5 font-mono text-[12px] text-foreground outline-none focus:border-ring"
                />
              </Config>
            </div>
          </div>
        </Panel>

        {/* Models table */}
        <Panel>
          <div className="flex items-center justify-between border-b border-border bg-panel px-4 py-2.5">
            <Label>Models</Label>
            <ActionButton
              variant="ghost"
              onClick={() => void openAddModel()}
              disabled={pending === 'model:add'}
            >
              <Plus className="size-3.5" />
              Add model
            </ActionButton>
          </div>
          <div className="font-mono-label grid grid-cols-[1.4fr_90px_90px_110px_90px_84px] items-center gap-4 border-b border-border px-4 py-2 text-[10px] text-muted-foreground">
            <span>Model</span>
            <span>Reasoning</span>
            <span>Input</span>
            <span>Context</span>
            <span>Max out</span>
            <span className="text-right">Actions</span>
          </div>
          {displayModels.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
              <Cpu className="size-6 text-muted-foreground/50" />
              <div>
                <p className="font-mono text-sm text-muted-foreground">
                  No models configured for this provider
                </p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  Add a model id before assigning this provider to agents.
                </p>
              </div>
              <ActionButton onClick={() => void openAddModel()}>
                <Plus className="size-3.5" />
                Add model
              </ActionButton>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {displayModels.map((m) => (
                <li
                  key={m.id}
                  className="grid grid-cols-[1.4fr_90px_90px_110px_90px_84px] items-center gap-4 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <span className="font-mono text-[13px] text-foreground">{m.name}</span>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">{m.id}</p>
                  </div>
                  <span>
                    {m.reasoning ? (
                      <Tag tone="accent">yes</Tag>
                    ) : (
                      <span className="font-mono text-[11px] text-muted-foreground">no</span>
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
                  <div className="flex items-center justify-end gap-1">
                    <ActionButton
                      variant="ghost"
                      title="Edit model"
                      onClick={() => setEditingModel(m)}
                      disabled={pending === `model:edit:${m.id}`}
                    >
                      <Pencil className="size-3.5" />
                    </ActionButton>
                    <ActionButton
                      variant="ghost"
                      title="Delete model"
                      onClick={() => setModelDeleteTarget(m.id)}
                      disabled={pending === `model:${m.id}`}
                    >
                      <Trash2 className="size-3.5" />
                    </ActionButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
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
        busy={modelDeleteTarget ? pending === `model:${modelDeleteTarget}` : false}
        onCancel={() => setModelDeleteTarget(null)}
        onConfirm={() => {
          if (modelDeleteTarget) void deleteModel(modelDeleteTarget)
        }}
      />
      <ModelDialog
        open={showAddModel}
        busy={pending === 'model:add'}
        mode="add"
        availableModels={availableModels}
        loadingModels={loadingModels}
        onCancel={() => setShowAddModel(false)}
        onSubmit={(model) => void upsertModel(model, 'add')}
      />
      <ModelDialog
        key={editingModel?.id ?? 'edit-model'}
        open={Boolean(editingModel)}
        busy={editingModel ? pending === `model:edit:${editingModel.id}` : false}
        mode="edit"
        model={editingModel ?? undefined}
        onCancel={() => setEditingModel(null)}
        onSubmit={(model) => void upsertModel(model, 'edit')}
      />
    </>
  )
}

function ModelDialog({
  open,
  busy,
  mode,
  model,
  availableModels = [],
  loadingModels,
  onCancel,
  onSubmit,
}: {
  open: boolean
  busy?: boolean
  mode: 'add' | 'edit'
  model?: GlobalModel
  availableModels?: Array<{ id: string; name: string }>
  loadingModels?: boolean
  onCancel: () => void
  onSubmit: (model: PostApiModelProvidersIdModelsMutationRequest) => void
}) {
  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<AddModelForm>({
    resolver: zodResolver(addModelFormSchema as never),
    defaultValues: {
      id: model?.id ?? '',
      name: model?.name ?? '',
      reasoning: model?.reasoning ?? false,
      inputTypes: model?.input ?? ['text'],
      contextWindow: String(model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW),
      maxTokens: String(model?.maxTokens ?? DEFAULT_MAX_OUTPUT),
    },
  })
  const modelId = useWatch({ control, name: 'id' })
  const displayNameEdited = useRef(mode === 'edit')

  useEffect(() => {
    if (mode === 'add' && !displayNameEdited.current && modelId) {
      setValue('name', modelId)
    }
  }, [mode, modelId, setValue])

  const displayNameField = register('name', {
    onChange: () => {
      displayNameEdited.current = true
    },
  })

  const submit = (values: AddModelForm) => {
    const payload = postApiModelProvidersIdModelsMutationRequestSchema.parse({
      id: values.id,
      originalId: mode === 'edit' ? model?.id : undefined,
      name: values.name || values.id,
      reasoning: values.reasoning,
      input: values.inputTypes,
      contextWindow: values.contextWindow ? Number(values.contextWindow) : undefined,
      maxTokens: values.maxTokens ? Number(values.maxTokens) : undefined,
    })
    onSubmit(payload)
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="model-dialog-title"
    >
      <button
        type="button"
        aria-label="Close model editor"
        onClick={busy ? undefined : onCancel}
        className="absolute inset-0 bg-foreground/25"
      />
      <form
        onSubmit={handleSubmit(submit)}
        className="relative w-full max-w-lg border border-border bg-card shadow-xl"
      >
        <header className="border-b border-border bg-panel px-4 py-3">
          <h2 id="model-dialog-title" className="font-serif text-lg text-foreground italic">
            {mode === 'add' ? 'Add model' : 'Edit model'}
          </h2>
        </header>
        <div className="space-y-4 p-4">
          <Config label="Model ID" error={errors.id?.message}>
            {mode === 'add' && (loadingModels || availableModels.length > 0) ? (
              <Controller
                control={control}
                name="id"
                render={({ field }) => (
                  <Select
                    value={field.value || null}
                    onValueChange={(value) => field.onChange(value ?? '')}
                    disabled={loadingModels}
                  >
                    <SelectTrigger
                      ref={field.ref}
                      onBlur={field.onBlur}
                      className="w-full text-[13px]"
                    >
                      <SelectValue
                        placeholder={loadingModels ? 'Loading models…' : 'Select a model'}
                      />
                    </SelectTrigger>
                    <SelectContent align="start">
                      {availableModels.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name === item.id ? item.id : `${item.name} · ${item.id}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            ) : (
              <input
                {...register('id')}
                placeholder={mode === 'add' ? 'Enter model ID manually' : undefined}
                className="w-full border border-input bg-panel px-3 py-1.5 font-mono text-[13px] text-foreground outline-none focus:border-ring"
              />
            )}
          </Config>
          <Config label="Display name">
            <input
              {...displayNameField}
              className="w-full border border-input bg-panel px-3 py-1.5 text-[13px] text-foreground outline-none focus:border-ring"
            />
          </Config>
          <Config label="Input types" error={errors.inputTypes?.message}>
            <Controller
              control={control}
              name="inputTypes"
              render={({ field }) => (
                <Select<'text' | 'image', true>
                  multiple
                  items={inputTypeOptions}
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger
                    ref={field.ref}
                    onBlur={field.onBlur}
                    aria-invalid={Boolean(errors.inputTypes)}
                    className="w-full text-[13px]"
                  >
                    <SelectValue placeholder="Select input types">
                      {(value) =>
                        Array.isArray(value) && value.length > 0
                          ? value
                              .map(
                                (item) =>
                                  inputTypeOptions.find((option) => option.value === item)?.label ??
                                  item,
                              )
                              .join(', ')
                          : 'Select input types'
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start">
                    {inputTypeOptions.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Config>
          <div className="grid gap-4 sm:grid-cols-2">
            <Config
              label={
                <>
                  Context window
                  <FieldHint text="Maximum number of tokens the model can use across the prompt, conversation history, tools, and output." />
                </>
              }
              error={errors.contextWindow?.message}
            >
              <Controller
                control={control}
                name="contextWindow"
                render={({ field }) => (
                  <NumberField
                    name={field.name}
                    ref={field.ref}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    min={1}
                    aria-invalid={Boolean(errors.contextWindow)}
                  />
                )}
              />
            </Config>
            <Config
              label={
                <>
                  Max output
                  <FieldHint text="Maximum number of tokens the model may generate in a single response, including reasoning tokens." />
                </>
              }
              error={errors.maxTokens?.message}
            >
              <Controller
                control={control}
                name="maxTokens"
                render={({ field }) => (
                  <NumberField
                    name={field.name}
                    ref={field.ref}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    min={1}
                    aria-invalid={Boolean(errors.maxTokens)}
                  />
                )}
              />
            </Config>
          </div>
          <label className="flex items-center gap-2 font-mono text-xs text-foreground">
            <input type="checkbox" {...register('reasoning')} />
            Reasoning model
          </label>
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-border bg-panel px-4 py-3">
          <ActionButton onClick={onCancel} disabled={busy}>
            Cancel
          </ActionButton>
          <ActionButton variant="accent" type="submit" disabled={busy}>
            {mode === 'add' ? 'Add model' : 'Save model'}
          </ActionButton>
        </footer>
      </form>
    </div>
  )
}

function Config({
  label,
  children,
  error,
}: {
  label: React.ReactNode
  children: React.ReactNode
  error?: string
}) {
  return (
    <div>
      <Label className="mb-1.5 flex items-center gap-1.5">{label}</Label>
      {children}
      {error && <p className="mt-1 font-mono text-[11px] text-destructive">{error}</p>}
    </div>
  )
}

function FieldHint({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={text}
        className="inline-flex size-4 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
      >
        <CircleHelp className="size-3.5" aria-hidden="true" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-56 -translate-x-1/2 border border-border bg-popover px-2.5 py-2 text-left font-mono text-[10px] leading-relaxed tracking-normal text-popover-foreground normal-case opacity-0 shadow-md transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
      >
        {text}
      </span>
    </span>
  )
}

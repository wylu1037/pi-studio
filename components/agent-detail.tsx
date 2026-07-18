'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import {
  ArrowLeft,
  Search,
  Check,
  Sparkles,
  FileText,
  Cpu,
  History,
  Coins,
  Package,
  Puzzle,
  ChevronUp,
  Folder,
  LoaderCircle,
  MessageSquare,
  GitBranch,
  Clock,
  ExternalLink,
  Star,
  X,
} from 'lucide-react'
import type {
  AgentProfile,
  AgentSessionSummary,
  GlobalModelProvider,
  GlobalPackage,
  GlobalPromptTemplate,
  GlobalSkill,
  StudioExtension,
} from '@/lib/types'
import { deleteApiAgentsId } from '@/lib/api/generated/clients/deleteApiAgentsId'
import { patchApiAgentsId } from '@/lib/api/generated/clients/patchApiAgentsId'
import { postApiAgentsIdAssign } from '@/lib/api/generated/clients/postApiAgentsIdAssign'
import { refreshAfterMutation } from '@/lib/api/refresh'
import { errorMessage, showToast } from '@/lib/toast'
import {
  ActionButton,
  ConfirmDialog,
  Label,
  Panel,
  Tag,
  TextInput,
  BracketButton,
} from '@/components/pi-ui'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AvatarPresetPicker } from '@/components/avatar-preset-picker'
import { agentAvatarPresets } from '@/components/chat-avatar'
import { ProviderLogo } from '@/components/models-view'
import { agentAvatarPresetIds, normalizeAgentAvatarPreset } from '@/lib/profile-settings'
import { cn } from '@/lib/utils'

const TABS = [
  'Overview',
  'Extensions',
  'Packages',
  'Skills',
  'Prompts',
  'Models',
  'Sessions',
  'Settings',
] as const
const thinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
const providerApiLabels: Record<GlobalModelProvider['api'], string> = {
  'openai-completions': 'OpenAI Completions',
  'openai-responses': 'OpenAI Responses',
  'anthropic-messages': 'Anthropic Messages',
  'google-generative-ai': 'Google Generative AI',
}
const compactModelNumber = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

function formatModelLimit(value?: number) {
  return value ? compactModelNumber.format(value) : '—'
}

const settingsSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  icon: z.enum(agentAvatarPresetIds),
  defaultCwd: z.string().optional(),
  defaultProviderId: z.string().optional(),
  defaultModelId: z.string().optional(),
  defaultThinkingLevel: z.enum(thinkingLevels),
})
type SettingsForm = z.infer<typeof settingsSchema>

function mergeTags(current: string[], value: string) {
  const existing = new Set(current.map((tag) => tag.toLocaleLowerCase()))
  const additions = value
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => {
      if (!tag) return false
      const normalized = tag.toLocaleLowerCase()
      if (existing.has(normalized)) return false
      existing.add(normalized)
      return true
    })
  return additions.length > 0 ? [...current, ...additions] : current
}

export function AgentDetail({
  agent,
  extensions,
  packages,
  skills,
  prompts,
  providers,
  sessions,
}: {
  agent: AgentProfile
  extensions: StudioExtension[]
  packages: GlobalPackage[]
  skills: GlobalSkill[]
  prompts: GlobalPromptTemplate[]
  providers: GlobalModelProvider[]
  sessions: AgentSessionSummary[]
}) {
  const [pending, setPending] = useState<string | null>(null)
  const [deleteRequested, setDeleteRequested] = useState(false)
  const router = useRouter()

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
              <span className="font-serif text-2xl italic">{agent.name.charAt(0)}</span>
            </div>
            <div>
              <h1 className="font-serif text-2xl text-foreground italic">{agent.name}</h1>
              <div className="mt-1 flex items-center gap-1.5">
                {agent.tags.map((t) => (
                  <Tag key={t} tone="outline">
                    {t}
                  </Tag>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <Tabs defaultValue="Overview" className="min-h-0 flex-1 gap-0">
        <div className="overflow-x-auto border-b border-border px-4">
          <TabsList
            variant="line"
            className="h-auto gap-0 p-0 group-data-horizontal/tabs:h-auto data-[variant=line]:gap-0"
          >
            {TABS.map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="h-auto flex-none rounded-none border-0 px-4 py-2.5 font-mono text-xs tracking-wider text-muted-foreground uppercase after:bg-accent group-data-horizontal/tabs:after:bottom-0 hover:text-foreground data-active:text-foreground"
              >
                {tab}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-6">
          <TabsContent value="Overview">
            <OverviewTab agent={agent} providers={providers} />
          </TabsContent>
          <TabsContent value="Extensions">
            <ResourcePicker
              title="Extensions"
              agentId={agent.id}
              kind="extension"
              items={extensions.map((extension) => ({
                id: extension.id,
                name: extension.name,
                description: extension.description || 'Pi Studio extension library source.',
                tags: [],
                meta: 'library',
              }))}
              selectedIds={agent.selectedExtensionIds}
            />
          </TabsContent>
          <TabsContent value="Packages">
            <ResourcePicker
              title="Packages"
              agentId={agent.id}
              kind="package"
              items={packages.map((pkg) => ({
                id: pkg.id,
                name: pkg.name,
                description: pkg.description,
                tags: [pkg.type],
                meta: pkg.version,
              }))}
              selectedIds={packages
                .filter((pkg) => agent.selectedPackageSources.includes(pkg.source))
                .map((pkg) => pkg.id)}
            />
          </TabsContent>
          <TabsContent value="Skills">
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
          </TabsContent>
          <TabsContent value="Prompts">
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
          </TabsContent>
          <TabsContent value="Models">
            <ModelsTab agent={agent} providers={providers} />
          </TabsContent>
          <TabsContent value="Sessions">
            <SessionsTab agent={agent} sessions={sessions} />
          </TabsContent>
          <TabsContent value="Settings">
            <SettingsTab
              agent={agent}
              providers={providers}
              onDelete={() => setDeleteRequested(true)}
              deleting={pending === 'delete'}
            />
          </TabsContent>
        </div>
      </Tabs>
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
  providers,
}: {
  agent: AgentProfile
  providers: GlobalModelProvider[]
}) {
  const stats = [
    { icon: Puzzle, value: agent.selectedExtensionIds.length, label: 'Extensions' },
    { icon: Package, value: agent.selectedPackageSources.length, label: 'Packages' },
    { icon: Sparkles, value: agent.selectedSkillIds.length, label: 'Skills' },
    { icon: FileText, value: agent.selectedPromptIds.length, label: 'Prompts' },
    { icon: Cpu, value: agent.selectedModelIds.length, label: 'Models' },
    { icon: History, value: agent.sessionCount, label: 'Sessions' },
  ]
  const meta = [
    ['Name', agent.name],
    ['Description', agent.description ?? '—'],
    ['Default working dir', agent.defaultCwd ?? '—'],
    [
      'Default provider',
      providers.find((provider) => provider.id === agent.defaultProviderId)?.name ?? '—',
    ],
    ['Default model', agent.defaultModelId ?? '—'],
    ['Default thinking', agent.defaultThinkingLevel],
    ['Created', agent.createdAt],
    ['Updated', agent.updatedAt],
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        {stats.map((s) => {
          const Icon = s.icon
          return (
            <Panel key={s.label} className="flex flex-col gap-1.5 p-3">
              <Icon className="size-4 text-accent" />
              <span className="font-serif text-2xl text-foreground italic">{s.value}</span>
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
            <div key={k} className="grid grid-cols-3 gap-4 px-4 py-2.5 text-sm">
              <dt className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
                {k}
              </dt>
              <dd className="col-span-2 font-mono text-[13px] text-foreground">{v}</dd>
            </div>
          ))}
        </dl>
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
  kind: 'extension' | 'package' | 'skill' | 'prompt'
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
      showToast({
        tone: 'success',
        message: `${title} ${enabled ? 'enabled' : 'disabled'}.`,
      })
    } catch (error) {
      setSelected((prev) => {
        const next = new Set(prev)
        if (enabled) next.delete(id)
        else next.add(id)
        return next
      })
      showToast({ tone: 'error', message: errorMessage(error) })
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
  const ResourceIcon = {
    extension: Puzzle,
    package: Package,
    skill: Sparkles,
    prompt: FileText,
  }[kind]

  return (
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
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3.5 transition-colors hover:bg-panel"
            >
              <div className="flex min-w-0 items-start gap-3">
                <div
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center border transition-colors',
                    on
                      ? 'border-accent/40 bg-accent/10 text-accent'
                      : 'border-border-strong bg-panel text-muted-foreground',
                  )}
                >
                  <ResourceIcon className="size-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="truncate font-mono text-[13px] text-foreground">
                      {item.name}
                    </span>
                    {item.tags.slice(0, 3).map((tag) => (
                      <Tag key={tag} tone="outline">
                        {tag}
                      </Tag>
                    ))}
                  </div>
                  <p className="mt-1 line-clamp-1 max-w-3xl text-[13px] text-muted-foreground">
                    {item.description}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Tag tone="outline" className="hidden sm:inline-flex">
                  {item.meta}
                </Tag>
                <span
                  className={cn(
                    'hidden w-16 text-right font-mono text-[10px] tracking-wider uppercase sm:inline',
                    on ? 'text-accent' : 'text-muted-foreground',
                  )}
                >
                  {on ? 'Enabled' : 'Disabled'}
                </span>
                <Switch
                  checked={on}
                  onCheckedChange={() => void toggle(item.id)}
                  disabled={pendingId === item.id}
                  aria-label={`${on ? 'Disable' : 'Enable'} ${item.name}`}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

function ModelsTab({
  agent,
  providers,
}: {
  agent: AgentProfile
  providers: GlobalModelProvider[]
}) {
  const [enabledProviders, setEnabledProviders] = useState(new Set(agent.selectedProviderIds))
  const [enabledModels, setEnabledModels] = useState(new Set(agent.selectedModelIds))
  const [pendingResources, setPendingResources] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const router = useRouter()

  const toggleResource = async (
    kind: 'provider' | 'model',
    resourceId: string,
    enabled: boolean,
    setSelected: React.Dispatch<React.SetStateAction<Set<string>>>,
    label: string,
    pendingResourceId = resourceId,
  ) => {
    const pendingKey = `${kind}:${pendingResourceId}`
    setPendingResources((current) => new Set(current).add(pendingKey))
    setSelected((prev) => {
      const next = new Set(prev)
      if (enabled) next.add(resourceId)
      else next.delete(resourceId)
      return next
    })
    try {
      await postApiAgentsIdAssign(agent.id, { kind, resourceId, enabled })
      showToast({
        tone: 'success',
        message: `${label} ${enabled ? 'enabled' : 'disabled'}.`,
      })
      router.refresh()
    } catch (error) {
      setSelected((prev) => {
        const next = new Set(prev)
        if (enabled) next.delete(resourceId)
        else next.add(resourceId)
        return next
      })
      showToast({ tone: 'error', message: errorMessage(error) })
    } finally {
      setPendingResources((current) => {
        const next = new Set(current)
        next.delete(pendingKey)
        return next
      })
    }
  }

  const selectedModelResourceId = (providerId: string, modelId: string) => {
    const resourceId = `${providerId}::${modelId}`
    if (enabledModels.has(resourceId)) return resourceId
    if (enabledModels.has(modelId)) return modelId
    return resourceId
  }

  const modelIsEnabled = (providerId: string, modelId: string) =>
    enabledModels.has(`${providerId}::${modelId}`) || enabledModels.has(modelId)

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredProviders = providers.flatMap((provider) => {
    const providerMatches =
      !normalizedQuery ||
      provider.name.toLocaleLowerCase().includes(normalizedQuery) ||
      provider.api.toLocaleLowerCase().includes(normalizedQuery) ||
      provider.baseUrl.toLocaleLowerCase().includes(normalizedQuery) ||
      provider.status.toLocaleLowerCase().includes(normalizedQuery)
    const models = provider.models.filter(
      (model) =>
        providerMatches ||
        model.name?.toLocaleLowerCase().includes(normalizedQuery) ||
        model.id.toLocaleLowerCase().includes(normalizedQuery) ||
        (model.reasoning && 'reasoning'.includes(normalizedQuery)) ||
        model.input.some((input) => input.includes(normalizedQuery)),
    )
    return providerMatches || models.length > 0 ? [{ provider, models }] : []
  })
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <TextInput
          value={query}
          onChange={setQuery}
          placeholder="Filter providers or models"
          ariaLabel="Search providers or models"
          icon={<Search className="size-3.5" aria-hidden="true" />}
          className="w-full sm:w-64"
        />
      </div>

      <Panel className="overflow-hidden">
        {providers.length === 0 ? (
          <Empty className="rounded-none border-0 py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Cpu aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle className="font-mono text-[13px]">No providers available</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : filteredProviders.length === 0 ? (
          <Empty className="rounded-none border-0 py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Search aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle className="font-mono text-[13px]">No matching models</EmptyTitle>
              <EmptyDescription className="font-mono text-xs">
                Try a different provider, model, status, or capability.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table className="min-w-[760px] table-fixed">
            <colgroup>
              <col className="w-[26%]" />
              <col className="w-[62%]" />
              <col className="w-[12%]" />
            </colgroup>
            <TableHeader className="bg-panel">
              <TableRow className="hover:bg-panel">
                <TableHead className="px-4 text-center font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                  Provider
                </TableHead>
                <TableHead className="border-l border-border px-4 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                  Models
                </TableHead>
                <TableHead className="border-l border-border px-4 text-center font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                  Access
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProviders.map(({ provider, models }) => {
                const providerEnabled = enabledProviders.has(provider.id)
                const providerPending = pendingResources.has(`provider:${provider.id}`)
                const providerIsDefault = provider.id === agent.defaultProviderId
                return (
                  <TableRow
                    key={provider.id}
                    className={cn('hover:bg-transparent', providerEnabled && 'bg-accent/[0.02]')}
                    aria-busy={providerPending}
                  >
                    <TableCell className="border-r border-border p-4 align-middle whitespace-normal">
                      <div className="flex min-w-0 items-center justify-center">
                        <div className="flex max-w-72 min-w-0 items-center gap-3 text-left">
                          <span
                            className="flex size-10 shrink-0 items-center justify-center"
                            title={providerApiLabels[provider.api]}
                          >
                            <ProviderLogo api={provider.api} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                              <span className="truncate font-mono text-[13px] font-medium text-foreground">
                                {provider.name}
                              </span>
                              {providerIsDefault && (
                                <span
                                  className="inline-flex text-accent"
                                  title="Agent default provider"
                                  aria-label="Agent default provider"
                                >
                                  <Star className="size-3 fill-current" aria-hidden="true" />
                                </span>
                              )}
                            </div>
                            <div className="mt-1 flex min-w-0 items-center gap-1.5">
                              <span className="truncate font-mono text-[10px] text-muted-foreground">
                                {providerApiLabels[provider.api]}
                              </span>
                              <span
                                className={cn(
                                  'inline-flex shrink-0',
                                  provider.status === 'connected'
                                    ? 'text-success'
                                    : provider.status === 'error'
                                      ? 'text-destructive'
                                      : 'text-muted-foreground',
                                )}
                                title={provider.status}
                                aria-label={`Status: ${provider.status}`}
                              >
                                {provider.status === 'connected' ? (
                                  <Check className="size-3" aria-hidden="true" />
                                ) : provider.status === 'error' ? (
                                  <X className="size-3" aria-hidden="true" />
                                ) : (
                                  <Clock className="size-3" aria-hidden="true" />
                                )}
                              </span>
                            </div>
                            <p
                              className="mt-1.5 truncate font-mono text-[9px] text-muted-foreground/80"
                              title={provider.baseUrl}
                            >
                              {provider.baseUrl}
                            </p>
                          </div>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell className="p-0 align-top whitespace-normal">
                      {models.length === 0 ? (
                        <p className="px-4 py-6 font-mono text-xs text-muted-foreground">
                          No models configured for this provider.
                        </p>
                      ) : (
                        <ul className="divide-y divide-border">
                          {models.map((model) => {
                            const modelResourceId = `${provider.id}::${model.id}`
                            const persistedResourceId = selectedModelResourceId(
                              provider.id,
                              model.id,
                            )
                            const modelEnabled = modelIsEnabled(provider.id, model.id)
                            const modelPending = pendingResources.has(`model:${modelResourceId}`)
                            const modelIsDefault =
                              providerIsDefault && agent.defaultModelId === model.id

                            return (
                              <li key={modelResourceId}>
                                <button
                                  type="button"
                                  aria-pressed={modelEnabled}
                                  aria-busy={modelPending}
                                  aria-label={`${modelEnabled ? 'Disable' : 'Enable'} ${
                                    model.name ?? model.id
                                  }${
                                    modelIsDefault
                                      ? '. Agent default model. Change it in Settings before disabling.'
                                      : ''
                                  }`}
                                  onClick={() => {
                                    if (modelIsDefault && modelEnabled) {
                                      showToast({
                                        tone: 'info',
                                        message:
                                          'Change the default model in Settings before disabling it.',
                                      })
                                      return
                                    }
                                    void toggleResource(
                                      'model',
                                      persistedResourceId,
                                      !modelEnabled,
                                      setEnabledModels,
                                      model.name ?? model.id,
                                      modelResourceId,
                                    )
                                  }}
                                  disabled={!providerEnabled || providerPending || modelPending}
                                  title={
                                    !providerEnabled ? `Enable ${provider.name} first.` : undefined
                                  }
                                  className={cn(
                                    'grid min-h-14 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 disabled:active:translate-y-0',
                                    modelEnabled && providerEnabled && 'bg-accent/5',
                                  )}
                                >
                                  <span
                                    className={cn(
                                      'row-span-2 flex size-4 items-center justify-center border',
                                      modelEnabled
                                        ? 'border-accent bg-accent text-accent-foreground'
                                        : 'border-border-strong bg-panel text-muted-foreground',
                                    )}
                                    aria-hidden="true"
                                  >
                                    {modelPending ? (
                                      <LoaderCircle className="size-2.5 animate-spin" />
                                    ) : (
                                      modelEnabled && <Check className="size-2.5" />
                                    )}
                                  </span>

                                  <span className="min-w-0">
                                    <span className="block truncate font-mono text-xs text-foreground">
                                      {model.name ?? model.id}
                                    </span>
                                    {model.name && model.name !== model.id && (
                                      <span className="mt-0.5 block truncate font-mono text-[9px] text-muted-foreground">
                                        {model.id}
                                      </span>
                                    )}
                                  </span>

                                  <span className="flex shrink-0 items-center gap-3 font-mono text-[9px] tracking-wide text-muted-foreground">
                                    <span
                                      title={`Context window: ${model.contextWindow?.toLocaleString() ?? 'Unknown'}`}
                                    >
                                      {formatModelLimit(model.contextWindow)} ctx
                                    </span>
                                    <span
                                      title={`Max output: ${model.maxTokens?.toLocaleString() ?? 'Unknown'}`}
                                    >
                                      {formatModelLimit(model.maxTokens)} out
                                    </span>
                                  </span>

                                  <span className="col-start-2 col-end-4 flex min-w-0 flex-wrap items-center gap-1.5">
                                    {model.reasoning && <Tag tone="accent">reasoning</Tag>}
                                    {model.input.map((input) => (
                                      <Tag key={input} tone="outline">
                                        {input}
                                      </Tag>
                                    ))}
                                    {modelIsDefault && (
                                      <span
                                        className="inline-flex text-accent"
                                        title="Agent default model"
                                        aria-label="Agent default model"
                                      >
                                        <Star className="size-3 fill-current" aria-hidden="true" />
                                      </span>
                                    )}
                                  </span>
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </TableCell>

                    <TableCell className="border-l border-border p-4 align-middle whitespace-normal">
                      <div className="flex flex-col items-center justify-center gap-2.5 text-center">
                        {providerPending ? (
                          <LoaderCircle
                            className="size-4 animate-spin text-muted-foreground"
                            aria-label={`Updating ${provider.name}`}
                          />
                        ) : (
                          <Switch
                            checked={providerEnabled}
                            onCheckedChange={(checked) => {
                              if (!checked && providerIsDefault) {
                                showToast({
                                  tone: 'info',
                                  message:
                                    'Change the default provider in Settings before disabling it.',
                                })
                                return
                              }
                              void toggleResource(
                                'provider',
                                provider.id,
                                checked,
                                setEnabledProviders,
                                provider.name,
                              )
                            }}
                            aria-label={`${providerEnabled ? 'Disable' : 'Enable'} ${provider.name}${
                              providerIsDefault
                                ? '. Agent default provider. Change it in Settings before disabling.'
                                : ''
                            }`}
                          />
                        )}
                        <span
                          className={cn(
                            'font-mono text-[9px] tracking-wider uppercase',
                            providerEnabled ? 'text-accent' : 'text-muted-foreground',
                          )}
                        >
                          {providerEnabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
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
        <span className="font-mono text-xs text-muted-foreground">{list.length} total</span>
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
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[13px] text-foreground">{s.name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
                  <span
                    className="inline-flex max-w-full min-w-0 items-center gap-1.5 sm:max-w-md"
                    title={s.cwd}
                  >
                    <Folder className="size-3 shrink-0 text-accent/80" aria-hidden="true" />
                    <span className="truncate">{s.cwd}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <MessageSquare className="size-3 shrink-0 text-accent/80" aria-hidden="true" />
                    {s.messageCount} messages
                  </span>
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <Coins className="size-3 shrink-0 text-accent/80" aria-hidden="true" />$
                    {(s.totalCost ?? 0).toFixed(2)}
                  </span>
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <GitBranch className="size-3 shrink-0 text-accent/80" aria-hidden="true" />
                    {s.branchCount} branches
                  </span>
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <Clock className="size-3 shrink-0 text-accent/80" aria-hidden="true" />
                    <time dateTime={s.updatedAt}>{s.updatedAt}</time>
                  </span>
                </div>
              </div>
              <Link
                href={`/chat?agent=${agent.id}&session=${s.id}`}
                title="Open session"
                aria-label={`Open ${s.name ?? 'session'}`}
                className="flex size-8 shrink-0 items-center justify-center border border-border-strong bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ExternalLink className="size-3.5" aria-hidden="true" />
                <span className="sr-only">Open session</span>
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
  providers,
  onDelete,
  deleting,
}: {
  agent: AgentProfile
  providers: GlobalModelProvider[]
  onDelete: () => void
  deleting?: boolean
}) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { isSubmitting, errors },
  } = useForm<SettingsForm>({
    resolver: zodResolver(settingsSchema as never),
    defaultValues: {
      name: agent.name,
      description: agent.description ?? '',
      icon: normalizeAgentAvatarPreset(agent.icon),
      defaultCwd: agent.defaultCwd ?? '',
      defaultProviderId: agent.defaultProviderId ?? '',
      defaultModelId: agent.defaultModelId ?? '',
      defaultThinkingLevel: agent.defaultThinkingLevel,
    },
  })
  const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false)
  const [tags, setTags] = useState(agent.tags)
  const [tagDraft, setTagDraft] = useState('')
  const defaultCwd = watch('defaultCwd')
  const defaultProviderId = watch('defaultProviderId')
  const defaultModelId = watch('defaultModelId')
  const defaultThinkingLevel = watch('defaultThinkingLevel')
  const icon = watch('icon')
  const enabledProviderIds = new Set(agent.selectedProviderIds)
  const enabledModelIds = new Set(agent.selectedModelIds)
  const enabledModelsFor = (provider: GlobalModelProvider) =>
    provider.models.filter(
      (model) =>
        enabledModelIds.has(`${provider.id}::${model.id}`) || enabledModelIds.has(model.id),
    )
  const availableProviders = providers.filter(
    (provider) => enabledProviderIds.has(provider.id) && enabledModelsFor(provider).length > 0,
  )
  const selectedProvider = availableProviders.find((provider) => provider.id === defaultProviderId)
  const availableModels = selectedProvider ? enabledModelsFor(selectedProvider) : []
  const selectedModel = availableModels.find((model) => model.id === defaultModelId)

  const addTags = (value: string) => {
    setTags((current) => mergeTags(current, value))
    setTagDraft('')
  }

  const removeTag = (index: number) => {
    setTags((current) => current.filter((_, tagIndex) => tagIndex !== index))
  }

  const save = async (values: SettingsForm) => {
    await patchApiAgentsId(agent.id, {
      name: values.name,
      description: values.description,
      icon: values.icon,
      defaultCwd: values.defaultCwd,
      defaultProviderId: values.defaultProviderId || undefined,
      defaultModelId: values.defaultModelId || undefined,
      defaultThinkingLevel: values.defaultThinkingLevel,
      tags: mergeTags(tags, tagDraft),
    })
    refreshAfterMutation()
  }

  return (
    <form onSubmit={handleSubmit(save)} className="max-w-2xl space-y-5">
      <Panel className="space-y-4 p-4">
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
        <Field label="Assistant avatar">
          <AvatarPresetPicker
            presets={agentAvatarPresets}
            selected={icon}
            role="assistant"
            onSelect={(preset) => setValue('icon', preset, { shouldDirty: true })}
          />
        </Field>
        <Field label="Default working directory">
          <button
            type="button"
            onClick={() => setDirectoryPickerOpen(true)}
            className="flex w-full items-center gap-2 border border-input bg-panel px-3 py-2 text-left transition-colors outline-none hover:bg-muted focus:border-ring"
          >
            <Folder className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-foreground">
              {defaultCwd || 'Select a folder'}
            </span>
            <span className="font-mono text-[11px] text-accent">Browse</span>
          </button>
        </Field>
        <Field label="Default provider">
          <Select
            value={defaultProviderId || null}
            disabled={availableProviders.length === 0}
            onValueChange={(providerId) => {
              if (!providerId) return
              const provider = availableProviders.find((candidate) => candidate.id === providerId)
              const nextModels = provider ? enabledModelsFor(provider) : []
              const nextModel =
                nextModels.find((model) => model.id === defaultModelId) ?? nextModels[0]
              setValue('defaultProviderId', providerId, { shouldDirty: true })
              setValue('defaultModelId', nextModel?.id ?? '', { shouldDirty: true })
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {selectedProvider?.name ??
                  (availableProviders.length === 0
                    ? 'No enabled providers with models'
                    : 'Select a provider')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {availableProviders.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Default model">
          <Select
            value={defaultModelId || null}
            disabled={!selectedProvider || availableModels.length === 0}
            onValueChange={(modelId) => {
              if (!modelId) return
              setValue('defaultModelId', modelId, { shouldDirty: true })
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {selectedModel?.name ??
                  selectedModel?.id ??
                  (availableModels.length > 0
                    ? 'Select a model'
                    : selectedProvider
                      ? 'No enabled models'
                      : 'Select a provider first')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {availableModels.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.name ?? model.id}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Default thinking level">
          <div className="flex flex-nowrap gap-1.5">
            {thinkingLevels.map((level) => (
              <BracketButton
                key={level}
                active={defaultThinkingLevel === level}
                onClick={() => setValue('defaultThinkingLevel', level, { shouldDirty: true })}
                disabled={isSubmitting}
              >
                {level}
              </BracketButton>
            ))}
          </div>
        </Field>
        <Field label="Tags">
          <input
            value={tagDraft}
            onChange={(event) => setTagDraft(event.target.value)}
            onBlur={() => addTags(tagDraft)}
            onKeyDown={(event) => {
              if ((event.key === 'Enter' || event.key === ',') && !event.nativeEvent.isComposing) {
                event.preventDefault()
                addTags(tagDraft)
                return
              }
              if (event.key === 'Backspace' && tagDraft.length === 0 && tags.length > 0) {
                removeTag(tags.length - 1)
              }
            }}
            placeholder="Add tag"
            className="w-full border border-input bg-panel px-3 py-2 font-mono text-[13px] text-foreground outline-none focus:border-ring"
          />
          {tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Agent tags">
              {tags.map((tag, index) => (
                <Tag key={`${tag}:${index}`} tone="outline" className="gap-1 py-1 pr-1 pl-2">
                  <span>{tag}</span>
                  <button
                    type="button"
                    onClick={() => removeTag(index)}
                    className="inline-flex size-4 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                    aria-label={`Remove ${tag}`}
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </Tag>
              ))}
            </div>
          )}
        </Field>
      </Panel>
      <div className="flex items-center justify-between">
        <ActionButton variant="danger" onClick={onDelete} disabled={deleting || isSubmitting}>
          Delete agent
        </ActionButton>
        <ActionButton variant="accent" type="submit" disabled={isSubmitting}>
          Save changes
        </ActionButton>
      </div>
      <DirectoryPickerDialog
        open={directoryPickerOpen}
        initialPath={defaultCwd}
        onClose={() => setDirectoryPickerOpen(false)}
        onSelect={(path) => {
          setValue('defaultCwd', path, { shouldDirty: true })
          setDirectoryPickerOpen(false)
        }}
      />
    </form>
  )
}

type DirectoryEntry = {
  name: string
  path: string
}

type DirectoryListing = {
  path: string
  parent?: string
  entries: DirectoryEntry[]
}

function DirectoryPickerDialog({
  open,
  initialPath,
  onClose,
  onSelect,
}: {
  open: boolean
  initialPath?: string
  onClose: () => void
  onSelect: (path: string) => void
}) {
  const [requestedPath, setRequestedPath] = useState('')
  const [directory, setDirectory] = useState<DirectoryListing | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!open) return
    setRequestedPath(initialPath || '')
  }, [initialPath, open])

  useEffect(() => {
    if (!open) return

    const controller = new AbortController()
    const query = new URLSearchParams()
    if (requestedPath) query.set('path', requestedPath)

    setLoading(true)
    setError(null)
    fetch(`/api/directories?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as DirectoryListing & { error?: string }
        if (!response.ok) throw new Error(body.error ?? 'Unable to load this directory.')
        setDirectory(body)
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return
        setDirectory(null)
        setError(
          requestError instanceof Error ? requestError.message : 'Unable to load this directory.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [open, reloadKey, requestedPath])

  useEffect(() => {
    if (!open) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose, open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="directory-picker-title"
    >
      <button
        type="button"
        aria-label="Close folder picker"
        onClick={onClose}
        className="absolute inset-0 bg-foreground/25"
      />
      <div className="relative flex w-full max-w-xl flex-col border border-border bg-card shadow-xl">
        <header className="border-b border-border bg-panel px-4 py-3">
          <h2 id="directory-picker-title" className="font-serif text-lg text-foreground italic">
            Select working directory
          </h2>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            Choose the folder used for new conversations with this agent.
          </p>
        </header>

        <div className="space-y-3 p-4">
          <div className="flex items-center gap-2 border border-input bg-panel p-2">
            <ActionButton
              title="Go to parent folder"
              onClick={() => directory?.parent && setRequestedPath(directory.parent)}
              disabled={!directory?.parent || loading}
              className="px-2"
            >
              <ChevronUp className="size-3.5" />
            </ActionButton>
            <p
              className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground"
              title={directory?.path}
            >
              {directory?.path ?? (loading ? 'Loading directory…' : 'Choose a directory')}
            </p>
          </div>

          <div className="h-72 overflow-y-auto border border-border bg-panel">
            {loading && !directory ? (
              <div className="flex h-full items-center justify-center gap-2 font-mono text-xs text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                Loading folders
              </div>
            ) : error ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="font-mono text-xs text-destructive">{error}</p>
                <div className="flex items-center gap-2">
                  {requestedPath && (
                    <ActionButton onClick={() => setRequestedPath('')}>
                      Open home folder
                    </ActionButton>
                  )}
                  <ActionButton onClick={() => setReloadKey((value) => value + 1)}>
                    Retry
                  </ActionButton>
                </div>
              </div>
            ) : directory?.entries.length === 0 ? (
              <p className="px-4 py-10 text-center font-mono text-xs text-muted-foreground">
                No subfolders in this directory.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {directory?.entries.map((entry) => (
                  <li key={entry.path}>
                    <button
                      type="button"
                      onClick={() => setRequestedPath(entry.path)}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted"
                    >
                      <Folder className="size-4 shrink-0 text-accent" />
                      <span className="truncate font-mono text-[13px] text-foreground">
                        {entry.name}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border bg-panel px-4 py-3">
          <ActionButton onClick={onClose}>Cancel</ActionButton>
          <ActionButton
            variant="accent"
            onClick={() => directory && onSelect(directory.path)}
            disabled={!directory || loading}
          >
            Select folder
          </ActionButton>
        </footer>
      </div>
    </div>
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
      {error && <p className="mt-1 font-mono text-[11px] text-destructive">{error}</p>}
    </div>
  )
}

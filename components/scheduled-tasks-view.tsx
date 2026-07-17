'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Dialog } from '@base-ui/react/dialog'
import { CalendarClock, Pencil, Play, Trash2, X } from 'lucide-react'
import { ActionButton, ConfirmDialog, Label, Panel, Tag, TextInput } from '@/components/pi-ui'
import {
  Select,
  SelectContent,
  SelectGroup,
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
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TimePicker } from '@/components/time-picker'
import { RunAtCalendar } from '@/components/p-calendar-18'
import { errorMessage, showToast } from '@/lib/toast'
import type {
  AgentProfile,
  AgentSessionSummary,
  GlobalModel,
  GlobalModelProvider,
  ScheduledTask,
  ScheduledTaskScheduleType,
  ThinkingLevel,
} from '@/lib/types'
import { COMMON_TIME_ZONES } from '@/lib/scheduler/timezones'
import { cn } from '@/lib/utils'

type TaskForm = {
  name: string
  agentId: string
  sessionId: string
  sessionName: string
  prompt: string
  providerId: string
  modelId: string
  thinkingLevel: ThinkingLevel
  scheduleType: ScheduledTaskScheduleType
  intervalMinutes: string
  weekday: string
  timeOfDay: string
  scheduledAt: string
  cronExpression: string
  timezone: string
  enabled: boolean
}

type TaskModelProvider = Pick<GlobalModelProvider, 'id' | 'name' | 'models'>

type TaskModelOption = {
  provider: TaskModelProvider
  model: GlobalModel
}

const WEEKDAYS = [
  ['1', 'Monday'],
  ['2', 'Tuesday'],
  ['3', 'Wednesday'],
  ['4', 'Thursday'],
  ['5', 'Friday'],
  ['6', 'Saturday'],
  ['0', 'Sunday'],
]

const SCHEDULE_TYPES: Array<{ value: ScheduledTaskScheduleType; label: string }> = [
  { value: 'weekly', label: 'Every week' },
  { value: 'interval', label: 'Repeat every N minutes' },
  { value: 'cron', label: 'Cron expression' },
  { value: 'once', label: 'Run once' },
]

const THINKING_LEVELS: Array<{ value: ThinkingLevel; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Light' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' },
  { value: 'max', label: 'Ultra' },
]

function toLocalInput(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function modelOptionsFor(
  agentId: string,
  agents: AgentProfile[],
  providers: TaskModelProvider[],
): TaskModelOption[] {
  const agent = agents.find((candidate) => candidate.id === agentId)
  if (!agent) return []
  const enabledProviders = new Set(agent.selectedProviderIds)
  const enabledModels = new Set(agent.selectedModelIds)
  return providers
    .filter((provider) => enabledProviders.has(provider.id))
    .flatMap((provider) =>
      provider.models
        .filter(
          (model) =>
            enabledModels.has(`${provider.id}::${model.id}`) || enabledModels.has(model.id),
        )
        .map((model) => ({ provider, model })),
    )
}

function selectedModelFor(
  task: ScheduledTask | undefined,
  agent: AgentProfile | undefined,
  options: TaskModelOption[],
) {
  return (
    options.find(
      ({ provider, model }) => provider.id === task?.providerId && model.id === task?.modelId,
    ) ??
    options.find(
      ({ provider, model }) =>
        provider.id === agent?.defaultProviderId && model.id === agent?.defaultModelId,
    ) ??
    options[0]
  )
}

function formFor(
  task: ScheduledTask | undefined,
  agents: AgentProfile[],
  providers: TaskModelProvider[],
): TaskForm {
  const agentId = task?.agentId ?? agents[0]?.id ?? ''
  const agent = agents.find((candidate) => candidate.id === agentId)
  const model = selectedModelFor(task, agent, modelOptionsFor(agentId, agents, providers))
  return {
    name: task?.name ?? '',
    agentId,
    sessionId: task?.sessionId ?? 'new',
    sessionName: task?.sessionName ?? '',
    prompt: task?.prompt ?? '',
    providerId: model?.provider.id ?? '',
    modelId: model?.model.id ?? '',
    thinkingLevel: task?.thinkingLevel ?? agent?.defaultThinkingLevel ?? 'medium',
    scheduleType: task?.scheduleType ?? 'weekly',
    intervalMinutes: String(task?.intervalMinutes ?? 10),
    weekday: String(task?.weekday ?? 1),
    timeOfDay: task?.timeOfDay ?? '09:00',
    scheduledAt: toLocalInput(task?.scheduledAt),
    cronExpression: task?.cronExpression ?? '0 9 * * 1',
    timezone: task?.timezone ?? 'Asia/Shanghai',
    enabled: task?.enabled ?? true,
  }
}

function timeZoneOptions(value: string) {
  return COMMON_TIME_ZONES.some((zone) => zone.value === value)
    ? COMMON_TIME_ZONES
    : [{ value, label: value }, ...COMMON_TIME_ZONES]
}

function scheduleSummary(task: ScheduledTask) {
  if (task.scheduleType === 'interval') return `Every ${task.intervalMinutes} min`
  if (task.scheduleType === 'weekly') {
    return `${WEEKDAYS.find(([value]) => value === String(task.weekday))?.[1] ?? 'Weekly'} ${task.timeOfDay ?? ''}`
  }
  if (task.scheduleType === 'cron') return task.cronExpression ?? 'Cron schedule'
  return task.scheduledAt ? `Once ${new Date(task.scheduledAt).toLocaleString()}` : 'Once'
}

function nextRunLabel(task: ScheduledTask) {
  if (!task.nextRunAt) return task.scheduleType === 'once' ? 'Completed' : 'Not scheduled'
  return new Date(task.nextRunAt).toLocaleString()
}

function thinkingLabel(level: ThinkingLevel) {
  return THINKING_LEVELS.find((option) => option.value === level)?.label ?? level
}

export function ScheduledTasksView({
  agents,
  providers,
  initialSessions,
  initialTasks,
}: {
  agents: AgentProfile[]
  providers: TaskModelProvider[]
  initialSessions: AgentSessionSummary[]
  initialTasks: ScheduledTask[]
}) {
  const router = useRouter()
  const [tasks, setTasks] = useState(initialTasks)
  const [activeTab, setActiveTab] = useState<'manage' | 'create'>('manage')
  const [editing, setEditing] = useState<ScheduledTask | null | undefined>(undefined)
  const [form, setForm] = useState<TaskForm>(() => formFor(undefined, agents, providers))
  const [pending, setPending] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ScheduledTask | null>(null)
  const canCreate = agents.length > 0
  const agentNames = useMemo(() => new Map(agents.map((agent) => [agent.id, agent.name])), [agents])
  const sessionNames = useMemo(
    () =>
      new Map(initialSessions.map((session) => [session.id, session.name ?? 'Untitled session'])),
    [initialSessions],
  )
  const providerNames = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider.name])),
    [providers],
  )

  const openCreate = () => {
    setEditing(null)
    setForm(formFor(undefined, agents, providers))
    setActiveTab('create')
  }

  const openEdit = (task: ScheduledTask) => {
    setEditing(task)
    setForm(formFor(task, agents, providers))
    setActiveTab('manage')
  }

  const payload = () => ({
    name: form.name.trim(),
    agentId: form.agentId,
    sessionId: form.sessionId === 'new' ? null : form.sessionId,
    sessionName: form.sessionId === 'new' ? form.sessionName.trim() || null : null,
    prompt: form.prompt.trim(),
    providerId: form.providerId || undefined,
    modelId: form.modelId || undefined,
    thinkingLevel: form.thinkingLevel,
    scheduleType: form.scheduleType,
    intervalMinutes: form.scheduleType === 'interval' ? Number(form.intervalMinutes) : undefined,
    weekday: form.scheduleType === 'weekly' ? Number(form.weekday) : undefined,
    timeOfDay: form.scheduleType === 'weekly' ? form.timeOfDay : undefined,
    scheduledAt:
      form.scheduleType === 'once' && form.scheduledAt
        ? new Date(form.scheduledAt).toISOString()
        : undefined,
    cronExpression: form.scheduleType === 'cron' ? form.cronExpression.trim() : undefined,
    timezone: form.timezone.trim() || 'Asia/Shanghai',
    enabled: form.enabled,
  })

  const save = async () => {
    const body = payload()
    const isEditing = Boolean(editing)
    if (!body.name || !body.agentId || !body.prompt) return
    if (!body.providerId || !body.modelId) {
      showToast({
        tone: 'error',
        title: 'Model required',
        message: 'Choose a provider and model for this task.',
      })
      return
    }
    if (body.scheduleType === 'once' && !body.scheduledAt) {
      showToast({
        tone: 'error',
        title: 'Run time required',
        message: 'Choose when this task should run.',
      })
      return
    }
    setPending('save')
    try {
      const response = await fetch(
        editing ? `/api/scheduled-tasks/${encodeURIComponent(editing.id)}` : '/api/scheduled-tasks',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'Unable to save scheduled task.')
      const task = result as ScheduledTask
      setTasks((current) =>
        isEditing ? current.map((item) => (item.id === task.id ? task : item)) : [task, ...current],
      )
      if (!isEditing) setForm(formFor(undefined, agents, providers))
      setEditing(undefined)
      setActiveTab('manage')
      router.refresh()
      showToast({
        tone: 'success',
        title: isEditing ? 'Task updated' : 'Task scheduled',
        message: 'The schedule has been saved.',
      })
    } catch (error) {
      showToast({ tone: 'error', title: 'Unable to save task', message: errorMessage(error) })
    } finally {
      setPending(null)
    }
  }

  const updateTask = async (
    task: ScheduledTask,
    updates: Partial<Pick<ScheduledTask, 'enabled'>>,
  ) => {
    setPending(`update:${task.id}`)
    try {
      const response = await fetch(`/api/scheduled-tasks/${encodeURIComponent(task.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: task.name,
          agentId: task.agentId,
          sessionId: task.sessionId ?? null,
          sessionName: task.sessionName,
          prompt: task.prompt,
          scheduleType: task.scheduleType,
          intervalMinutes: task.intervalMinutes,
          weekday: task.weekday,
          timeOfDay: task.timeOfDay,
          scheduledAt: task.scheduledAt,
          cronExpression: task.cronExpression,
          timezone: task.timezone,
          enabled: updates.enabled ?? task.enabled,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'Unable to update task.')
      setTasks((current) => current.map((item) => (item.id === task.id ? result : item)))
      router.refresh()
    } catch (error) {
      showToast({ tone: 'error', title: 'Unable to update task', message: errorMessage(error) })
    } finally {
      setPending(null)
    }
  }

  const runNow = async (task: ScheduledTask) => {
    setPending(`run:${task.id}`)
    try {
      const response = await fetch(`/api/scheduled-tasks/${encodeURIComponent(task.id)}/run`, {
        method: 'POST',
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'Unable to run task.')
      setTasks((current) =>
        current.map((item) =>
          item.id === task.id
            ? { ...item, sessionId: result.sessionId, lastRunStatus: 'queued' }
            : item,
        ),
      )
      showToast({
        tone: 'success',
        title: 'Task started',
        message: 'The agent run is now in the linked session.',
      })
      router.refresh()
    } catch (error) {
      showToast({ tone: 'error', title: 'Unable to run task', message: errorMessage(error) })
    } finally {
      setPending(null)
    }
  }

  const remove = async () => {
    if (!deleteTarget) return
    setPending(`delete:${deleteTarget.id}`)
    try {
      const response = await fetch(`/api/scheduled-tasks/${encodeURIComponent(deleteTarget.id)}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error('Unable to delete task.')
      setTasks((current) => current.filter((task) => task.id !== deleteTarget.id))
      setDeleteTarget(null)
      router.refresh()
    } catch (error) {
      showToast({ tone: 'error', title: 'Unable to delete task', message: errorMessage(error) })
    } finally {
      setPending(null)
    }
  }

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => {
        if (value === 'create') openCreate()
        else {
          setEditing(undefined)
          setActiveTab('manage')
        }
      }}
      className="h-full min-h-0 gap-0"
    >
      <PageHeader
        title="Schedule"
        subtitle="Run agents on a recurring cadence or at a specific future time."
      >
        <TabsList className="h-auto rounded-none border border-border-strong bg-panel p-0.5 group-data-horizontal/tabs:h-auto">
          <TabsTrigger
            value="manage"
            className="h-auto flex-none rounded-none px-4 py-1.5 font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase hover:bg-muted hover:text-foreground active:scale-[0.98] data-active:bg-primary data-active:text-primary-foreground"
          >
            Manage
          </TabsTrigger>
          <TabsTrigger
            value="create"
            className="h-auto flex-none rounded-none px-4 py-1.5 font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase hover:bg-muted hover:text-foreground active:scale-[0.98] data-active:bg-primary data-active:text-primary-foreground"
            disabled={!canCreate}
          >
            Create
          </TabsTrigger>
        </TabsList>
      </PageHeader>

      <TabsContent value="manage" className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col overflow-auto p-6">
          {tasks.length === 0 ? (
              <Empty className="py-24">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <CalendarClock />
                  </EmptyMedia>
                  <EmptyTitle>No scheduled tasks</EmptyTitle>
                  <EmptyDescription>
                    Create a task to run an agent on a cadence, by cron expression, or at a specific
                    future time.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <ActionButton variant="accent" onClick={openCreate} disabled={!canCreate}>
                    Create task
                  </ActionButton>
                </EmptyContent>
              </Empty>
          ) : (
              <Panel>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-210 border-collapse text-left">
                    <thead className="bg-panel">
                      <tr className="border-b border-border">
                        {[
                          'Task',
                          'Agent',
                          'Session',
                          'Schedule',
                          'Next run',
                          'Last run',
                          'Status',
                          'Enabled',
                          '',
                        ].map((header) => (
                          <th
                            key={header}
                            className={cn(
                              'font-mono-label px-4 py-2.5 text-[10px] text-muted-foreground',
                              header === 'Enabled' && 'w-20 text-center',
                              header === '' && 'w-36',
                            )}
                          >
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.map((task) => (
                        <tr
                          key={task.id}
                          className="border-b border-border last:border-0 hover:bg-muted/30"
                        >
                          <td className="max-w-64 px-4 py-3">
                            <div className="truncate font-medium text-foreground">{task.name}</div>
                            <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                              {task.prompt}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">
                            <div>{agentNames.get(task.agentId) ?? task.agentId}</div>
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                              {task.modelId
                                ? `${providerNames.get(task.providerId ?? '') ?? task.providerId ?? 'Default provider'} · ${task.modelId} · ${thinkingLabel(task.thinkingLevel ?? 'medium')}`
                                : 'Agent defaults'}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                            {task.sessionId
                              ? (sessionNames.get(task.sessionId) ?? task.sessionId)
                              : task.sessionName || 'Create on first run'}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                            {scheduleSummary(task)}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                            {nextRunLabel(task)}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                            {task.lastRunAt ? new Date(task.lastRunAt).toLocaleString() : 'Never'}
                          </td>
                          <td className="px-4 py-3">
                            <Tag
                              tone={
                                task.lastRunStatus === 'failed'
                                  ? 'danger'
                                  : task.lastRunStatus === 'completed'
                                    ? 'success'
                                    : 'default'
                              }
                            >
                              {task.lastRunStatus}
                            </Tag>
                          </td>
                          <td className="w-20 px-4 py-3">
                            <div className="flex justify-center">
                              <Switch
                                checked={task.enabled}
                                disabled={pending === `update:${task.id}`}
                                aria-label={
                                  task.enabled ? `Pause ${task.name}` : `Enable ${task.name}`
                                }
                                onCheckedChange={(enabled) => updateTask(task, { enabled })}
                              />
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-1">
                              {task.sessionId && (
                                <Link
                                  href={`/chat?agent=${encodeURIComponent(task.agentId)}&session=${encodeURIComponent(task.sessionId)}`}
                                  title="Open linked session"
                                  className="inline-flex size-7 items-center justify-center border border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground"
                                >
                                  <CalendarClock className="size-3.5" />
                                </Link>
                              )}
                              <button
                                type="button"
                                title="Run now"
                                onClick={() => runNow(task)}
                                disabled={pending !== null}
                                className="inline-flex size-7 items-center justify-center border border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground disabled:opacity-40"
                              >
                                <Play className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                title="Edit task"
                                onClick={() => openEdit(task)}
                                disabled={pending !== null}
                                className="inline-flex size-7 items-center justify-center border border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground disabled:opacity-40"
                              >
                                <Pencil className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                title="Delete task"
                                onClick={() => setDeleteTarget(task)}
                                disabled={pending !== null}
                                className="inline-flex size-7 items-center justify-center border border-transparent text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
          )}
        </div>
      </TabsContent>

      <TabsContent value="create" className="min-h-0 flex-1 overflow-auto">
        <TaskEditor
          form={form}
          agents={agents}
          providers={providers}
          sessions={initialSessions}
          editing={null}
          pending={pending === 'save'}
          onChange={(updates) => setForm((current) => ({ ...current, ...updates }))}
          onCancel={() => setActiveTab('manage')}
          onSave={save}
        />
      </TabsContent>

      {editing && (
        <Dialog.Root
          open
          onOpenChange={(open) => {
            if (!open && pending !== 'save') setEditing(undefined)
          }}
        >
          <Dialog.Portal>
            <Dialog.Backdrop className="fixed inset-0 bg-foreground/25 backdrop-blur-[1px] data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
            <Dialog.Viewport className="fixed inset-0 flex items-center justify-center p-4">
              <Dialog.Popup className="flex max-h-[90dvh] w-[min(96vw,72rem)] flex-col overflow-hidden border border-border-strong bg-card shadow-2xl outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
                <div className="flex shrink-0 items-center justify-between border-b border-border bg-panel px-5 py-3">
                  <Dialog.Title className="font-serif text-lg text-foreground italic">
                    Edit task
                  </Dialog.Title>
                  <Dialog.Close
                    render={
                      <button
                        type="button"
                        title="Close editor"
                        aria-label="Close task editor"
                        disabled={pending === 'save'}
                        className="inline-flex size-7 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                      />
                    }
                  >
                    <X className="size-4" />
                  </Dialog.Close>
                </div>
                <TaskEditor
                  form={form}
                  agents={agents}
                  providers={providers}
                  sessions={initialSessions}
                  editing={editing}
                  pending={pending === 'save'}
                  onChange={(updates) => setForm((current) => ({ ...current, ...updates }))}
                  onCancel={() => setEditing(undefined)}
                  onSave={save}
                />
              </Dialog.Popup>
            </Dialog.Viewport>
          </Dialog.Portal>
        </Dialog.Root>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete scheduled task"
        description={`Delete "${deleteTarget?.name ?? ''}"? Its linked session and existing runs will remain available.`}
        busy={pending === `delete:${deleteTarget?.id}`}
        onConfirm={remove}
        onCancel={() => setDeleteTarget(null)}
      />
    </Tabs>
  )
}

function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border px-6 py-5">
      <div>
        <h1 className="font-serif text-3xl italic">{title}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function TaskEditor({
  form,
  agents,
  providers,
  sessions,
  editing,
  pending,
  onChange,
  onCancel,
  onSave,
}: {
  form: TaskForm
  agents: AgentProfile[]
  providers: TaskModelProvider[]
  sessions: AgentSessionSummary[]
  editing: ScheduledTask | null
  pending: boolean
  onChange: (updates: Partial<TaskForm>) => void
  onCancel: () => void
  onSave: () => void
}) {
  const creating = editing === null
  const agentSessions = sessions.filter((session) => session.agentId === form.agentId)
  const selectedSession = agentSessions.find((session) => session.id === form.sessionId)
  const agent = agents.find((candidate) => candidate.id === form.agentId)
  const modelOptions = modelOptionsFor(form.agentId, agents, providers)
  const availableProviders = providers.filter((provider) =>
    modelOptions.some((option) => option.provider.id === provider.id),
  )
  const availableModels = modelOptions.filter((option) => option.provider.id === form.providerId)
  const selectedProvider = availableProviders.find((provider) => provider.id === form.providerId)
  const selectedModel = availableModels.find((option) => option.model.id === form.modelId)?.model

  return (
    <div
      className={cn(
        'min-h-0 flex-1 overflow-auto',
        creating && 'px-6 py-6',
      )}
    >
      <Panel
        as="form"
        className={cn('w-full border-0 bg-transparent', !creating && 'flex min-h-full flex-col')}
        onSubmit={(event) => {
          event.preventDefault()
          onSave()
        }}
      >
        <div className={cn('grid gap-4 lg:grid-cols-2', !creating && 'flex-1 p-5')}>
          <label className="flex flex-col gap-1.5">
            <Label>Name</Label>
            <TextInput
              value={form.name}
              onChange={(name) => onChange({ name })}
              placeholder="Weekly GitHub agent roundup"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <Label>Agent</Label>
            <Select
              value={form.agentId}
              onValueChange={(agentId) => {
                if (!agentId) return
                const nextAgent = agents.find((candidate) => candidate.id === agentId)
                const nextModel = selectedModelFor(
                  undefined,
                  nextAgent,
                  modelOptionsFor(agentId, agents, providers),
                )
                const keepSession = sessions.some(
                  (session) => session.id === form.sessionId && session.agentId === agentId,
                )
                onChange({
                  agentId,
                  sessionId: keepSession ? form.sessionId : 'new',
                  providerId: nextModel?.provider.id ?? '',
                  modelId: nextModel?.model.id ?? '',
                  thinkingLevel: nextAgent?.defaultThinkingLevel ?? 'medium',
                })
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{agents.find((agent) => agent.id === form.agentId)?.name}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <Label>Session</Label>
            <Select
              value={form.sessionId}
              onValueChange={(sessionId) => sessionId && onChange({ sessionId })}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {form.sessionId === 'new'
                    ? 'Create on first run'
                    : selectedSession?.name || 'Untitled session'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="new">Create on first run</SelectItem>
                  {agentSessions.map((session) => (
                    <SelectItem key={session.id} value={session.id}>
                      {session.name || 'Untitled session'}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </label>
          {form.sessionId === 'new' && (
            <label className="flex flex-col gap-1.5">
              <Label>New session name</Label>
              <TextInput
                value={form.sessionName}
                onChange={(sessionName) => onChange({ sessionName })}
                placeholder={
                  form.name.trim() ? `Scheduled · ${form.name.trim()}` : 'Scheduled task'
                }
              />
            </label>
          )}
          <label className="flex flex-col gap-1.5 lg:col-span-2">
            <Label>Message</Label>
            <textarea
              value={form.prompt}
              onChange={(event) => onChange({ prompt: event.target.value })}
              placeholder="Research the most popular GitHub projects about AI agents from last week and summarize the findings."
              className="min-h-24 w-full resize-y border border-input bg-background px-3 py-2 font-mono text-[13px] outline-none focus:border-ring"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <Label>Provider</Label>
            <Select
              value={form.providerId}
              onValueChange={(providerId) => {
                if (!providerId) return
                const providerModels = modelOptions.filter(
                  (option) => option.provider.id === providerId,
                )
                const nextModel =
                  providerModels.find((option) => option.model.id === agent?.defaultModelId) ??
                  providerModels[0]
                onChange({ providerId, modelId: nextModel?.model.id ?? '' })
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{selectedProvider?.name ?? 'No providers available'}</SelectValue>
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
          </label>
          <label className="flex flex-col gap-1.5">
            <Label>Model</Label>
            <Select
              value={form.modelId}
              onValueChange={(modelId) => modelId && onChange({ modelId })}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {selectedModel?.name ?? selectedModel?.id ?? 'No models available'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {availableModels.map(({ model }) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.name ?? model.id}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <Label className="flex h-5 items-center">Reasoning</Label>
            <Select
              value={form.thinkingLevel}
              onValueChange={(thinkingLevel) =>
                thinkingLevel && onChange({ thinkingLevel: thinkingLevel as ThinkingLevel })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue>{thinkingLabel(form.thinkingLevel)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {THINKING_LEVELS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </label>
          <div className="flex flex-col gap-1.5">
            <div className="flex h-5 items-center justify-between gap-3">
              <Label>Schedule</Label>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-muted-foreground uppercase">
                  {form.enabled ? 'Enabled' : 'Paused'}
                </span>
                <Switch
                  checked={form.enabled}
                  aria-label={form.enabled ? 'Pause scheduled task' : 'Enable scheduled task'}
                  onCheckedChange={(enabled) => onChange({ enabled })}
                />
              </div>
            </div>
            <Select
              value={form.scheduleType}
              onValueChange={(scheduleType) =>
                scheduleType &&
                onChange({ scheduleType: scheduleType as ScheduledTaskScheduleType })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {SCHEDULE_TYPES.find((type) => type.value === form.scheduleType)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {SCHEDULE_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          {form.scheduleType === 'interval' && (
            <label className="flex flex-col gap-1.5">
              <Label>Interval (minutes)</Label>
              <TextInput
                value={form.intervalMinutes}
                onChange={(intervalMinutes) => onChange({ intervalMinutes })}
              />
            </label>
          )}
          {form.scheduleType === 'weekly' && (
            <>
              <label className="flex flex-col gap-1.5">
                <Label>Day</Label>
                <Select
                  value={form.weekday}
                  onValueChange={(weekday) => weekday && onChange({ weekday })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {WEEKDAYS.find(([value]) => value === form.weekday)?.[1]}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {WEEKDAYS.map(([value, day]) => (
                        <SelectItem key={value} value={value}>
                          {day}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-1.5">
                <Label>Time</Label>
                <TimePicker
                  value={form.timeOfDay}
                  onValueChange={(timeOfDay) => onChange({ timeOfDay })}
                />
              </label>
            </>
          )}
          {form.scheduleType === 'once' && (
            <div className="flex flex-col gap-1.5">
              <Label>Run at</Label>
              <RunAtCalendar
                value={form.scheduledAt ? new Date(form.scheduledAt) : undefined}
                onValueChange={(date) =>
                  onChange({ scheduledAt: date ? toLocalInput(date.toISOString()) : '' })
                }
              />
            </div>
          )}
          {form.scheduleType === 'cron' && (
            <label className="flex flex-col gap-1.5">
              <Label>Cron expression</Label>
              <TextInput
                value={form.cronExpression}
                onChange={(cronExpression) => onChange({ cronExpression })}
                placeholder="0 9 * * 1"
              />
            </label>
          )}
          <label className="flex flex-col gap-1.5">
            <Label>Timezone</Label>
            <Select
              value={form.timezone}
              onValueChange={(timezone) => timezone && onChange({ timezone })}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {
                    timeZoneOptions(form.timezone).find((zone) => zone.value === form.timezone)
                      ?.label
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {timeZoneOptions(form.timezone).map((zone) => (
                    <SelectItem key={zone.value} value={zone.value}>
                      {zone.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </label>
        </div>
        <div
          className={cn(
            'flex items-center justify-end border-border',
            creating ? 'mt-6 pt-4' : 'shrink-0 border-t bg-panel px-5 py-3',
          )}
        >
          <div className="flex gap-2">
            {!creating && (
              <ActionButton onClick={onCancel} disabled={pending}>
                Cancel
              </ActionButton>
            )}
            <ActionButton
              variant="accent"
              type="submit"
              disabled={pending || agents.length === 0 || !form.providerId || !form.modelId}
            >
              Save task
            </ActionButton>
          </div>
        </div>
      </Panel>
    </div>
  )
}

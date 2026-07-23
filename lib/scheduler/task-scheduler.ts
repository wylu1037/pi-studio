import { startSessionPrompt } from '@/lib/chat/run-session-prompt'
import { nextCronRunAt } from '@/lib/scheduler/cron'
import { isSupportedTimeZone } from '@/lib/scheduler/timezones'
import {
  claimScheduledTaskExecution,
  createSession,
  getScheduledTask,
  getSession,
  listDueScheduledTasks,
  listInterruptedScheduledTasks,
  resolveAgentRunConfig,
  updateScheduledTaskExecution,
  type ScheduledTask,
} from '@/lib/db/repository'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MAX_CONCURRENT_SCHEDULED_TASKS = 3

declare global {
  var __piStudioTaskScheduler: ReturnType<typeof setInterval> | undefined
  var __piStudioTaskSchedulerTick: Promise<void> | undefined
  var __piStudioTaskSchedulerRecovered: boolean | undefined
  var __piStudioScheduledTaskRuns: Map<string, Promise<void>> | undefined
}

export function nextRunAt(
  input: Pick<
    ScheduledTask,
    | 'scheduleType'
    | 'intervalMinutes'
    | 'weekday'
    | 'timeOfDay'
    | 'scheduledAt'
    | 'cronExpression'
    | 'timezone'
  >,
  from = new Date(),
) {
  if (input.scheduleType === 'once') return input.scheduledAt ?? null
  if (input.scheduleType === 'cron') {
    const timezone = isSupportedTimeZone(input.timezone) ? input.timezone : 'Asia/Shanghai'
    return nextCronRunAt(input.cronExpression, timezone, from)
  }
  if (input.scheduleType === 'interval') {
    const minutes = input.intervalMinutes ?? 0
    return minutes > 0 ? new Date(from.getTime() + minutes * 60_000).toISOString() : null
  }
  if (input.weekday == null || !input.timeOfDay) return null

  const timezone = isSupportedTimeZone(input.timezone) ? input.timezone : 'Asia/Shanghai'
  const current = zonedParts(from, timezone)
  const today = DAY_NAMES.indexOf(current.weekday)
  const [hour = 0, minute = 0] = input.timeOfDay.split(':').map(Number)
  const date = new Date(Date.UTC(current.year, current.month - 1, current.day))
  const days = (input.weekday - today + 7) % 7
  date.setUTCDate(date.getUTCDate() + days)
  let next = zonedDateToUtc(
    {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour,
      minute,
    },
    timezone,
  )
  if (next <= from) {
    date.setUTCDate(date.getUTCDate() + 7)
    next = zonedDateToUtc(
      {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour,
        minute,
      },
      timezone,
    )
  }
  return next.toISOString()
}

export function ensureTaskScheduler() {
  if (globalThis.__piStudioTaskScheduler) return
  recoverInterruptedScheduledTasks()
  globalThis.__piStudioTaskScheduler = setInterval(() => void tickScheduledTasks(), 30_000)
  void tickScheduledTasks()
}

export async function tickScheduledTasks() {
  if (globalThis.__piStudioTaskSchedulerTick) return globalThis.__piStudioTaskSchedulerTick
  const tick = (async () => {
    const capacity = MAX_CONCURRENT_SCHEDULED_TASKS - scheduledTaskRuns().size
    if (capacity <= 0) return
    const due = listDueScheduledTasks(new Date().toISOString(), capacity)
    await Promise.allSettled(
      due.map((task) => executeScheduledTask(task.id, { requireDue: true })),
    )
  })().finally(() => {
    globalThis.__piStudioTaskSchedulerTick = undefined
  })
  globalThis.__piStudioTaskSchedulerTick = tick
  return tick
}

export async function executeScheduledTask(
  taskId: string,
  options: { requireDue?: boolean } = {},
) {
  const task = getScheduledTask(taskId)
  if (!task) throw new Error('Scheduled task not found.')
  if (scheduledTaskRuns().size >= MAX_CONCURRENT_SCHEDULED_TASKS) {
    throw new Error('The scheduled task concurrency limit has been reached.')
  }

  const now = new Date()
  const claimedAt = now.toISOString()
  const next = task.enabled && task.scheduleType !== 'once' ? nextRunAt(task, now) : null
  const claimedTask = claimScheduledTaskExecution(task.id, {
    expectedUpdatedAt: task.updatedAt,
    claimedAt,
    nextRunAt: next,
    disable: task.scheduleType === 'once',
    requireDue: options.requireDue ?? false,
  })
  if (!claimedTask) throw new Error('This scheduled task is already running or has changed.')

  let runConfig: ReturnType<typeof scheduledTaskRunConfig>
  try {
    runConfig = scheduledTaskRunConfig(claimedTask)
  } catch (error) {
    finishScheduledTaskExecution(task.id, 'failed')
    throw error
  }

  const existing = claimedTask.sessionId ? getSession(claimedTask.sessionId) : null
  const session =
    existing && existing.agentId === claimedTask.agentId
      ? existing
      : createSession({
          agentId: claimedTask.agentId,
          name: claimedTask.sessionName?.trim() || `Scheduled · ${claimedTask.name}`,
        })
  if (!session) {
    finishScheduledTaskExecution(task.id, 'failed')
    throw new Error('The scheduled task agent is no longer available.')
  }

  updateScheduledTaskExecution(task.id, { sessionId: session.id, lastRunStatus: 'running' })

  const execution = startSessionPrompt({
    sessionId: session.id,
    prompt: claimedTask.prompt,
    providerId: runConfig.providerId ?? undefined,
    modelId: runConfig.modelId ?? undefined,
    thinkingLevel: runConfig.thinkingLevel,
  })
    .then(async (result) => {
      if (result.status !== 'started') {
        finishScheduledTaskExecution(task.id, 'failed')
        return
      }
      const status = await result.completion
      finishScheduledTaskExecution(task.id, status === 'completed' ? 'completed' : 'failed')
    })
    .catch(() => finishScheduledTaskExecution(task.id, 'failed'))
    .finally(() => {
      scheduledTaskRuns().delete(task.id)
      void tickScheduledTasks()
    })
  scheduledTaskRuns().set(task.id, execution)
  return { sessionId: session.id }
}

function scheduledTaskRuns() {
  globalThis.__piStudioScheduledTaskRuns ??= new Map<string, Promise<void>>()
  return globalThis.__piStudioScheduledTaskRuns
}

function recoverInterruptedScheduledTasks() {
  if (globalThis.__piStudioTaskSchedulerRecovered) return
  globalThis.__piStudioTaskSchedulerRecovered = true
  for (const task of listInterruptedScheduledTasks()) {
    finishScheduledTaskExecution(task.id, 'failed')
  }
}

function finishScheduledTaskExecution(
  taskId: string,
  status: 'completed' | 'failed',
) {
  const task = getScheduledTask(taskId)
  if (!task) return
  updateScheduledTaskExecution(task.id, {
    lastRunStatus: status,
    nextRunAt: task.enabled && task.scheduleType !== 'once' ? nextRunAt(task) : null,
  })
}

function scheduledTaskRunConfig(task: ScheduledTask) {
  const config = resolveAgentRunConfig(task.agentId, task.providerId)
  if (!config?.provider) throw new Error('The scheduled task agent has no enabled provider.')
  if (task.providerId && config.provider.id !== task.providerId) {
    throw new Error('The scheduled task provider is no longer enabled for this agent.')
  }

  const model = task.modelId
    ? config.provider.models.find((candidate) => candidate.id === task.modelId)
    : (config.provider.models.find(
        (candidate) =>
          config.provider?.id === config.agent.defaultProviderId &&
          candidate.id === config.agent.defaultModelId,
      ) ?? config.provider.models[0])
  if (!model) throw new Error('The scheduled task model is no longer enabled for this agent.')

  return {
    providerId: config.provider.id,
    modelId: model.id,
    thinkingLevel: task.thinkingLevel ?? config.agent.defaultThinkingLevel,
  }
}

function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date)
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  return {
    weekday: parts.find((part) => part.type === 'weekday')?.value ?? 'Mon',
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
  }
}

function zonedDateToUtc(
  parts: { year: number; month: number; day: number; hour: number; minute: number },
  timezone: string,
) {
  const desired = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
  let result = new Date(desired)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const actual = zonedParts(result, timezone)
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
    )
    result = new Date(result.getTime() + desired - actualAsUtc)
  }
  return result
}

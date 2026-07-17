import { prepareRun } from '@/lib/chat/run-registry'
import { startRunExecution } from '@/lib/chat/run-execution'
import { matchesCron, parseCronExpression } from '@/lib/scheduler/cron'
import { isSupportedTimeZone } from '@/lib/scheduler/timezones'
import {
  createRun,
  createSession,
  getRun,
  getScheduledTask,
  getSession,
  listScheduledTasks,
  resolveAgentRunConfig,
  updateScheduledTask,
  updateScheduledTaskExecution,
  type ScheduledTask,
} from '@/lib/db/repository'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

declare global {
  var __piStudioTaskScheduler: ReturnType<typeof setInterval> | undefined
  var __piStudioTaskSchedulerTick: Promise<void> | undefined
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
  if (input.scheduleType === 'cron')
    return nextCronRunAt(input.cronExpression, input.timezone, from)
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

function nextCronRunAt(expression: string | undefined, timezone: string, from: Date) {
  if (!expression) return null
  const schedule = parseCronExpression(expression)
  if (!schedule) return null
  const resolvedTimeZone = isSupportedTimeZone(timezone) ? timezone : 'Asia/Shanghai'
  const candidate = new Date(from)
  candidate.setUTCSeconds(0, 0)
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1)
  const limit = 527_040
  for (let index = 0; index < limit; index += 1) {
    const parts = zonedParts(candidate, resolvedTimeZone)
    const weekday = DAY_NAMES.indexOf(parts.weekday)
    if (
      matchesCron(schedule, {
        minute: parts.minute,
        hour: parts.hour,
        day: parts.day,
        month: parts.month,
        weekday,
      })
    ) {
      return candidate.toISOString()
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1)
  }
  return null
}

export function ensureTaskScheduler() {
  if (globalThis.__piStudioTaskScheduler) return
  globalThis.__piStudioTaskScheduler = setInterval(() => void tickScheduledTasks(), 30_000)
  void tickScheduledTasks()
}

export async function tickScheduledTasks() {
  if (globalThis.__piStudioTaskSchedulerTick) return globalThis.__piStudioTaskSchedulerTick
  const tick = (async () => {
    const now = new Date()
    const due = listScheduledTasks().filter(
      (task) =>
        task.enabled &&
        task.nextRunAt &&
        new Date(task.nextRunAt) <= now &&
        task.lastRunStatus !== 'queued' &&
        task.lastRunStatus !== 'running',
    )
    await Promise.all(due.map((task) => executeScheduledTask(task.id)))
  })().finally(() => {
    globalThis.__piStudioTaskSchedulerTick = undefined
  })
  globalThis.__piStudioTaskSchedulerTick = tick
  return tick
}

export async function executeScheduledTask(taskId: string) {
  const task = getScheduledTask(taskId)
  if (!task) throw new Error('Scheduled task not found.')
  if (task.lastRunStatus === 'queued' || task.lastRunStatus === 'running') {
    throw new Error('This scheduled task is already running.')
  }

  const now = new Date()
  const next = task.scheduleType === 'once' ? null : nextRunAt(task, now)
  if (task.scheduleType === 'once') {
    updateScheduledTask(task.id, { enabled: false, nextRunAt: null })
  }
  updateScheduledTaskExecution(task.id, {
    lastRunAt: now.toISOString(),
    lastRunStatus: 'queued',
    nextRunAt: next,
  })

  let runConfig: ReturnType<typeof scheduledTaskRunConfig>
  try {
    runConfig = scheduledTaskRunConfig(task)
  } catch (error) {
    updateScheduledTaskExecution(task.id, { lastRunStatus: 'failed' })
    throw error
  }

  const existing = task.sessionId ? getSession(task.sessionId) : null
  const session =
    existing && existing.agentId === task.agentId
      ? existing
      : createSession({
          agentId: task.agentId,
          name: task.sessionName?.trim() || `Scheduled · ${task.name}`,
        })
  if (!session) {
    updateScheduledTaskExecution(task.id, { lastRunStatus: 'failed' })
    throw new Error('The scheduled task agent is no longer available.')
  }

  updateScheduledTaskExecution(task.id, { sessionId: session.id })
  const run = createRun({
    sessionId: session.id,
    agentId: task.agentId,
    prompt: task.prompt,
    providerId: runConfig.providerId,
    modelId: runConfig.modelId,
    thinkingLevel: runConfig.thinkingLevel,
    cwd: session.cwd,
  })
  if (!run) {
    updateScheduledTaskExecution(task.id, { lastRunStatus: 'failed' })
    throw new Error('Unable to create the scheduled run.')
  }

  prepareRun(run.id)
  void startRunExecution(run.id).then(
    () => {
      const finished = getRun(run.id)
      updateScheduledTaskExecution(task.id, {
        lastRunStatus: finished?.status === 'completed' ? 'completed' : 'failed',
        nextRunAt: task.scheduleType === 'once' ? null : nextRunAt(task),
      })
    },
    () =>
      updateScheduledTaskExecution(task.id, {
        lastRunStatus: 'failed',
        nextRunAt: task.scheduleType === 'once' ? null : nextRunAt(task),
      }),
  )
  return { runId: run.id, sessionId: session.id }
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

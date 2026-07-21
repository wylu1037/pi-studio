import assert from 'node:assert/strict'
import test from 'node:test'
import {
  claimScheduledTaskExecution,
  createAgent,
  createScheduledTask,
  deleteAgent,
  deleteScheduledTask,
  getScheduledTask,
  listDueScheduledTasks,
  updateScheduledTaskExecution,
} from '@/lib/db/repository'

test('claims a due scheduled task exactly once', () => {
  const agent = createAgent({ name: `Scheduled task claim ${Date.now()}` })
  assert.ok(agent)
  const dueAt = new Date(Date.now() - 60_000).toISOString()
  const claimedAt = new Date().toISOString()
  const task = createScheduledTask({
    name: 'Due task',
    agentId: agent.id,
    prompt: 'Run the due task.',
    scheduleType: 'once',
    scheduledAt: dueAt,
    timezone: 'UTC',
    enabled: true,
    nextRunAt: dueAt,
  })

  try {
    assert.ok(task)
    assert.ok(listDueScheduledTasks(claimedAt).some((candidate) => candidate.id === task.id))

    const claimed = claimScheduledTaskExecution(task.id, {
      expectedUpdatedAt: task.updatedAt,
      claimedAt,
      nextRunAt: null,
      disable: true,
      requireDue: true,
    })
    assert.equal(claimed?.lastRunStatus, 'queued')
    assert.equal(claimed?.enabled, false)

    assert.equal(
      claimScheduledTaskExecution(task.id, {
        expectedUpdatedAt: claimed!.updatedAt,
        claimedAt: new Date().toISOString(),
        nextRunAt: null,
        disable: true,
        requireDue: false,
      }),
      null,
    )
  } finally {
    if (task) deleteScheduledTask(task.id)
    deleteAgent(agent.id)
  }
})

test('does not automatically claim a task before its next run time', () => {
  const agent = createAgent({ name: `Scheduled task future ${Date.now()}` })
  assert.ok(agent)
  const futureAt = new Date(Date.now() + 60 * 60_000).toISOString()
  const claimedAt = new Date().toISOString()
  const task = createScheduledTask({
    name: 'Future task',
    agentId: agent.id,
    prompt: 'Run the future task.',
    scheduleType: 'once',
    scheduledAt: futureAt,
    timezone: 'UTC',
    enabled: true,
    nextRunAt: futureAt,
  })

  try {
    assert.ok(task)
    assert.equal(
      claimScheduledTaskExecution(task.id, {
        expectedUpdatedAt: task.updatedAt,
        claimedAt,
        nextRunAt: null,
        disable: true,
        requireDue: true,
      }),
      null,
    )
    assert.equal(getScheduledTask(task.id)?.lastRunStatus, 'idle')

    const manualClaim = claimScheduledTaskExecution(task.id, {
      expectedUpdatedAt: task.updatedAt,
      claimedAt,
      nextRunAt: null,
      disable: true,
      requireDue: false,
    })
    assert.equal(manualClaim?.lastRunStatus, 'queued')
    updateScheduledTaskExecution(task.id, { lastRunStatus: 'failed' })
  } finally {
    if (task) deleteScheduledTask(task.id)
    deleteAgent(agent.id)
  }
})

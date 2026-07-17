import assert from 'node:assert/strict'
import test from 'node:test'
import { isCronExpression, matchesCron, parseCronExpression } from './cron'

test('parses five-field cron expressions with ranges, lists, and steps', () => {
  const schedule = parseCronExpression('*/10 9-17 * * 1,3,5')
  assert.ok(schedule)
  assert.equal(matchesCron(schedule, { minute: 20, hour: 9, day: 14, month: 7, weekday: 1 }), true)
  assert.equal(matchesCron(schedule, { minute: 21, hour: 9, day: 14, month: 7, weekday: 1 }), false)
  assert.equal(matchesCron(schedule, { minute: 20, hour: 9, day: 14, month: 7, weekday: 2 }), false)
})

test('accepts Sunday as either 0 or 7 and rejects invalid cron expressions', () => {
  const schedule = parseCronExpression('0 0 * * 7')
  assert.ok(schedule)
  assert.equal(matchesCron(schedule, { minute: 0, hour: 0, day: 14, month: 7, weekday: 0 }), true)
  assert.equal(isCronExpression('0 9 * * 1'), true)
  assert.equal(isCronExpression('every monday'), false)
  assert.equal(isCronExpression('* * * * * *'), false)
})

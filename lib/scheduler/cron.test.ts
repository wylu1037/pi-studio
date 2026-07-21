import assert from 'node:assert/strict'
import test from 'node:test'
import { isCronExpression, nextCronRunAt } from './cron'

test('validates five-field cron expressions with ranges, lists, and steps', () => {
  assert.equal(isCronExpression('*/10 9-17 * * 1,3,5'), true)
  assert.equal(isCronExpression('every monday'), false)
  assert.equal(isCronExpression('* * * * * *'), false)
})

test('calculates the next run with IANA timezone and Sunday aliases', () => {
  assert.equal(
    nextCronRunAt('0 9 * * 1', 'Asia/Shanghai', new Date('2026-07-19T00:00:00.000Z')),
    '2026-07-20T01:00:00.000Z',
  )
  assert.equal(
    nextCronRunAt('0 0 * * 7', 'UTC', new Date('2026-07-14T00:00:00.000Z')),
    '2026-07-19T00:00:00.000Z',
  )
})

test('handles daylight-saving transitions through cron-parser', () => {
  assert.equal(
    nextCronRunAt(
      '30 2 * * *',
      'America/New_York',
      new Date('2026-03-07T12:00:00.000Z'),
    ),
    '2026-03-08T07:30:00.000Z',
  )
})

import { CronExpressionParser } from 'cron-parser'

function hasFiveFields(expression: string) {
  return expression.trim().split(/\s+/).length === 5
}

export function isCronExpression(expression: string) {
  if (!hasFiveFields(expression)) return false
  try {
    CronExpressionParser.parse(expression, { currentDate: new Date(0), tz: 'UTC' })
    return true
  } catch {
    return false
  }
}

export function nextCronRunAt(expression: string | undefined, timezone: string, from: Date) {
  if (!expression || !hasFiveFields(expression)) return null
  try {
    return CronExpressionParser.parse(expression, {
      currentDate: from,
      tz: timezone,
    })
      .next()
      .toDate()
      .toISOString()
  } catch {
    return null
  }
}

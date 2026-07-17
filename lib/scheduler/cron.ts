const FIELD_RANGES = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
] as const

export type CronSchedule = {
  minutes: Set<number>
  hours: Set<number>
  daysOfMonth: Set<number>
  months: Set<number>
  daysOfWeek: Set<number>
  dayOfMonthWildcard: boolean
  dayOfWeekWildcard: boolean
}

export function parseCronExpression(expression: string): CronSchedule | null {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const parsed = fields.map((field, index) => parseField(field, FIELD_RANGES[index]))
  if (parsed.some((field) => field === null)) return null
  const [minutes, hours, daysOfMonth, months, daysOfWeek] = parsed as Set<number>[]
  return {
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek: new Set([...daysOfWeek].map((value) => (value === 7 ? 0 : value))),
    dayOfMonthWildcard: fields[2] === '*',
    dayOfWeekWildcard: fields[4] === '*',
  }
}

function parseField(value: string, range: readonly [number, number]) {
  const values = new Set<number>()
  for (const segment of value.split(',')) {
    const match = segment.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/)
    if (!match) return null
    const step = match[2] ? Number(match[2]) : 1
    if (!Number.isInteger(step) || step < 1) return null
    const [start, end] = parseSegmentRange(match[1], range)
    if (start == null || end == null) return null
    for (let current = start; current <= end; current += step) values.add(current)
  }
  return values.size > 0 ? values : null
}

function parseSegmentRange(value: string, [minimum, maximum]: readonly [number, number]) {
  if (value === '*') return [minimum, maximum] as const
  const [startText, endText] = value.split('-')
  const start = Number(startText)
  const end = endText ? Number(endText) : start
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < minimum ||
    end > maximum ||
    start > end
  ) {
    return [null, null] as const
  }
  return [start, end] as const
}

export function isCronExpression(value: string) {
  return parseCronExpression(value) !== null
}

export function matchesCron(
  schedule: CronSchedule,
  date: { minute: number; hour: number; day: number; month: number; weekday: number },
) {
  if (
    !schedule.minutes.has(date.minute) ||
    !schedule.hours.has(date.hour) ||
    !schedule.months.has(date.month)
  ) {
    return false
  }
  const dayOfMonthMatches = schedule.daysOfMonth.has(date.day)
  const dayOfWeekMatches = schedule.daysOfWeek.has(date.weekday)
  const dayMatches =
    schedule.dayOfMonthWildcard && schedule.dayOfWeekWildcard
      ? true
      : schedule.dayOfMonthWildcard
        ? dayOfWeekMatches
        : schedule.dayOfWeekWildcard
          ? dayOfMonthMatches
          : dayOfMonthMatches || dayOfWeekMatches
  return dayMatches
}

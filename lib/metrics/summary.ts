import { sqlite } from '@/lib/db/client'
import {
  METRIC_DEFINITIONS,
  metricIntervalSeconds,
  metricRangeMilliseconds,
  type MetricId,
  type MetricRange,
} from '@/lib/metrics/catalog'
import type { MetricSeries, MetricSeriesPoint, MetricsSummary } from '@/lib/metrics/types'
import { percentile } from '@/lib/metrics/math'
import { getAppSettings } from '@/lib/runtime/app-settings'

export { percentile } from '@/lib/metrics/math'

type ValueRow = { value: number; capturedAt: string }
type TimestampValue = { timestamp: string; value: number }

const MAX_PERCENTILE_ROWS = 100_000

export function getMetricsSummary(range: MetricRange): MetricsSummary {
  const settings = getAppSettings().metrics
  const enabledMetricIds = new Set(settings.enabledMetricIds)
  const generatedAt = new Date()
  const cutoff = new Date(generatedAt.getTime() - metricRangeMilliseconds(range)).toISOString()
  const runtime = currentRuntimeMetrics(enabledMetricIds)
  const hasApiMetric =
    enabledMetricIds.has('api.requestRate') ||
    enabledMetricIds.has('api.errorRate') ||
    enabledMetricIds.has('api.latency')
  const apiLatencies = enabledMetricIds.has('api.latency')
    ? sampleValues('api.latency', cutoff, MAX_PERCENTILE_ROWS)
    : []
  const apiRequests = hasApiMetric ? sampleCount('api.latency', cutoff) : 0
  const apiErrors = enabledMetricIds.has('api.errorRate') ? sampleCount('api.error', cutoff) : 0
  const apiErrorRate =
    enabledMetricIds.has('api.errorRate') && apiRequests > 0
      ? (apiErrors / apiRequests) * 100
      : null
  const runCounts = rangeRunCounts(cutoff)
  const activeRuns = currentRunCounts()
  const durations = runDurations(cutoff)
  const timeToFirstResponse = runTimeToFirstResponse(cutoff)
  const usage = usageSummary(cutoff)
  const scheduler = schedulerSummary()
  const lastSampleAt = latestSampleAt()
  const sampleCountValue = totalSampleCount()
  const terminalRuns = runCounts.completed + runCounts.failed + runCounts.aborted
  const warnings = buildWarnings({
    eventLoopLagMs: runtime.eventLoopLagMs,
    rssBytes: runtime.rssBytes,
    apiRequests,
    apiErrorRate,
    terminalRuns: enabledMetricIds.has('runs.successRate') ? terminalRuns : 0,
    failedRuns: enabledMetricIds.has('runs.successRate') ? runCounts.failed : 0,
    schedulerFailures: enabledMetricIds.has('scheduler.failures') ? scheduler.failed : 0,
  })
  if (settings.enabled && settings.enabledMetricIds.length === 0) {
    warnings.unshift({
      id: 'metrics-empty',
      title: 'No metrics are selected',
      detail: 'Collection is enabled, but the metric catalog has no active signals.',
      severity: 'warning',
    })
  }
  const periodicMetricIds = settings.enabledMetricIds.filter((metricId) => {
    const kind = METRIC_DEFINITIONS.get(metricId)?.kind
    return kind === 'gauge' || kind === 'snapshot'
  })
  const periodicSamples = periodicMetricIds.map((metricId) => ({
    metricId,
    capturedAt: latestMetricCapturedAt(metricId),
  }))
  const missingPeriodicMetrics = periodicSamples.filter((sample) => sample.capturedAt === null)
  const stalePeriodicMetrics = periodicSamples.filter(
    (sample) =>
      sample.capturedAt !== null &&
      generatedAt.getTime() - Date.parse(sample.capturedAt) >
        metricIntervalSeconds(sample.metricId, settings) * 3 * 1000,
  )
  if (stalePeriodicMetrics.length > 0) {
    const labels = stalePeriodicMetrics.map(
      ({ metricId }) => METRIC_DEFINITIONS.get(metricId)?.label ?? metricId,
    )
    warnings.unshift({
      id: 'metrics-stale',
      title: 'Metrics are stale',
      detail: `${formatList(labels)} ${labels.length === 1 ? 'has' : 'have'} not updated on schedule.`,
      severity: 'warning',
    })
  }
  const health = !settings.enabled
    ? 'disabled'
    : missingPeriodicMetrics.length > 0
      ? 'warming'
      : warnings.some((warning) => warning.severity === 'critical')
        ? 'critical'
        : warnings.length > 0
          ? 'degraded'
          : 'healthy'

  return {
    generatedAt: generatedAt.toISOString(),
    range,
    health,
    lastSampleAt,
    sampleCount: sampleCountValue,
    runtime: {
      uptimeSeconds: Math.floor(process.uptime()),
      ...runtime,
    },
    api: {
      requests: apiRequests,
      errorRate: apiErrorRate,
      p95LatencyMs: percentile(apiLatencies, 0.95),
    },
    runs: {
      ...activeRuns,
      ...runCounts,
      successRate: terminalRuns > 0 ? (runCounts.completed / terminalRuns) * 100 : null,
      averageDurationMs: average(durations),
      p95DurationMs: percentile(durations, 0.95),
      p95TimeToFirstResponseMs: percentile(timeToFirstResponse, 0.95),
    },
    usage,
    scheduler,
    warnings,
  }
}

export function getMetricSeries(metricId: MetricId, range: MetricRange): MetricSeries {
  const cutoff = new Date(Date.now() - metricRangeMilliseconds(range)).toISOString()
  const bucketSeconds = rangeBucketSeconds(range)
  let points: MetricSeriesPoint[] = []

  if (
    metricId === 'runtime.cpu' ||
    metricId === 'runtime.rss' ||
    metricId === 'runtime.heap' ||
    metricId === 'runtime.eventLoopLag' ||
    metricId === 'storage.database' ||
    metricId === 'storage.logs'
  ) {
    points = aggregateStoredMetric(metricId, cutoff, bucketSeconds, 'average')
  } else if (metricId === 'api.latency') {
    points = aggregateRows(
      sampleRows('api.latency', cutoff, MAX_PERCENTILE_ROWS),
      bucketSeconds,
      (values) => percentile(values, 0.95),
    )
  } else if (metricId === 'api.requestRate') {
    points = aggregateStoredMetric('api.latency', cutoff, bucketSeconds, 'rate')
  } else if (metricId === 'api.errorRate') {
    points = apiErrorRateSeries(cutoff, bucketSeconds)
  } else if (metricId === 'runs.duration') {
    points = aggregateRows(runDurationRows(cutoff), bucketSeconds, (values) =>
      percentile(values, 0.95),
    )
  } else if (metricId === 'runs.successRate') {
    points = runSuccessSeries(cutoff, bucketSeconds)
  } else if (metricId === 'usage.tokens') {
    points = usageSeries(cutoff, bucketSeconds, 'tokens')
  } else if (metricId === 'usage.cost') {
    points = usageSeries(cutoff, bucketSeconds, 'cost')
  }

  return { metricId, range, points }
}

function currentRuntimeMetrics(enabledMetricIds: Set<MetricId>) {
  return {
    cpuPercent: enabledMetricIds.has('runtime.cpu') ? latestMetricValue('runtime.cpu') : null,
    rssBytes: enabledMetricIds.has('runtime.rss') ? latestMetricValue('runtime.rss') : null,
    heapBytes: enabledMetricIds.has('runtime.heap') ? latestMetricValue('runtime.heap') : null,
    eventLoopLagMs: enabledMetricIds.has('runtime.eventLoopLag')
      ? latestMetricValue('runtime.eventLoopLag')
      : null,
  }
}

function latestMetricValue(metricId: string) {
  const row = sqlite
    .prepare(
      'SELECT value FROM metric_samples WHERE metric_id = ? ORDER BY captured_at DESC LIMIT 1',
    )
    .get(metricId) as { value: number } | undefined
  return row?.value ?? null
}

function latestSampleAt() {
  const row = sqlite.prepare('SELECT MAX(captured_at) AS capturedAt FROM metric_samples').get() as {
    capturedAt: string | null
  }
  return row.capturedAt
}

function latestMetricCapturedAt(metricId: MetricId) {
  const row = sqlite
    .prepare(
      'SELECT captured_at AS capturedAt FROM metric_samples WHERE metric_id = ? ORDER BY captured_at DESC LIMIT 1',
    )
    .get(metricId) as { capturedAt: string } | undefined
  return row?.capturedAt ?? null
}

function totalSampleCount() {
  const row = sqlite.prepare('SELECT COUNT(*) AS count FROM metric_samples').get() as {
    count: number
  }
  return row.count
}

function sampleValues(metricId: string, cutoff: string, limit: number) {
  return sampleRows(metricId, cutoff, limit).map((row) => row.value)
}

function sampleRows(metricId: string, cutoff: string, limit: number) {
  return sqlite
    .prepare(
      `SELECT value, captured_at AS capturedAt
       FROM metric_samples
       WHERE metric_id = ? AND captured_at >= ?
       ORDER BY captured_at DESC
       LIMIT ?`,
    )
    .all(metricId, cutoff, limit) as ValueRow[]
}

function sampleCount(metricId: string, cutoff: string) {
  const row = sqlite
    .prepare(
      'SELECT COUNT(*) AS count FROM metric_samples WHERE metric_id = ? AND captured_at >= ?',
    )
    .get(metricId, cutoff) as { count: number }
  return row.count
}

function currentRunCounts() {
  const row = sqlite
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
         SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS active
       FROM chat_runs`,
    )
    .get() as { queued: number | null; active: number | null }
  return { queued: row.queued ?? 0, active: row.active ?? 0 }
}

function rangeRunCounts(cutoff: string) {
  const row = sqlite
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN status = 'aborted' THEN 1 ELSE 0 END) AS aborted
       FROM chat_runs
       WHERE COALESCE(completed_at, created_at) >= ?`,
    )
    .get(cutoff) as { completed: number | null; failed: number | null; aborted: number | null }
  return { completed: row.completed ?? 0, failed: row.failed ?? 0, aborted: row.aborted ?? 0 }
}

function runDurations(cutoff: string) {
  return runDurationRows(cutoff).map((row) => row.value)
}

function runDurationRows(cutoff: string): TimestampValue[] {
  const rows = sqlite
    .prepare(
      `SELECT started_at AS startedAt, completed_at AS completedAt
       FROM chat_runs
       WHERE completed_at >= ? AND started_at IS NOT NULL`,
    )
    .all(cutoff) as Array<{ startedAt: string; completedAt: string }>
  return rows
    .map((row) => ({
      timestamp: row.completedAt,
      value: Date.parse(row.completedAt) - Date.parse(row.startedAt),
    }))
    .filter((row) => Number.isFinite(row.value) && row.value >= 0)
}

function runTimeToFirstResponse(cutoff: string) {
  const rows = sqlite
    .prepare(
      `SELECT r.started_at AS startedAt, MIN(e.created_at) AS firstAt
       FROM chat_runs r
       JOIN chat_run_events e ON e.run_id = r.id
       WHERE r.started_at >= ?
         AND e.type IN ('assistant_message_start', 'message_delta', 'thinking_delta', 'tool_call_delta')
       GROUP BY r.id`,
    )
    .all(cutoff) as Array<{ startedAt: string; firstAt: string }>
  return rows
    .map((row) => Date.parse(row.firstAt) - Date.parse(row.startedAt))
    .filter((value) => Number.isFinite(value) && value >= 0)
}

function usageSummary(cutoff: string) {
  const row = sqlite
    .prepare(
      `SELECT
         COALESCE(SUM(usage_input_tokens), 0) AS inputTokens,
         COALESCE(SUM(usage_output_tokens), 0) AS outputTokens,
         COALESCE(SUM(usage_cache_read_tokens), 0) AS cacheReadTokens,
         COALESCE(SUM(usage_cache_write_tokens), 0) AS cacheWriteTokens,
         COALESCE(SUM(usage_cost_total), 0) AS cost
       FROM chat_messages
       WHERE created_at >= ?`,
    )
    .get(cutoff) as {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    cost: number
  }
  const inputSide = row.inputTokens + row.cacheReadTokens
  return {
    ...row,
    totalTokens: row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheWriteTokens,
    cacheHitRate: inputSide > 0 ? (row.cacheReadTokens / inputSide) * 100 : null,
  }
}

function schedulerSummary() {
  const row = sqlite
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN last_run_status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM scheduled_tasks`,
    )
    .get() as { total: number; failed: number | null }
  return { total: row.total, failed: row.failed ?? 0 }
}

function buildWarnings(input: {
  eventLoopLagMs: number | null
  rssBytes: number | null
  apiRequests: number
  apiErrorRate: number | null
  terminalRuns: number
  failedRuns: number
  schedulerFailures: number
}): MetricsSummary['warnings'] {
  const warnings: MetricsSummary['warnings'] = []
  if (input.eventLoopLagMs !== null && input.eventLoopLagMs >= 500) {
    warnings.push({
      id: 'event-loop-critical',
      title: 'Event loop is heavily delayed',
      detail: `P95 event-loop lag is ${input.eventLoopLagMs.toFixed(0)} ms.`,
      severity: 'critical',
    })
  } else if (input.eventLoopLagMs !== null && input.eventLoopLagMs >= 200) {
    warnings.push({
      id: 'event-loop-warning',
      title: 'Event loop is delayed',
      detail: `P95 event-loop lag is ${input.eventLoopLagMs.toFixed(0)} ms.`,
      severity: 'warning',
    })
  }
  if (input.rssBytes !== null && input.rssBytes >= 1.5 * 1024 ** 3) {
    warnings.push({
      id: 'memory-critical',
      title: 'Server memory is high',
      detail: 'Resident memory is above 1.5 GB.',
      severity: 'critical',
    })
  } else if (input.rssBytes !== null && input.rssBytes >= 1024 ** 3) {
    warnings.push({
      id: 'memory-warning',
      title: 'Server memory is elevated',
      detail: 'Resident memory is above 1 GB.',
      severity: 'warning',
    })
  }
  if (input.apiRequests >= 20 && input.apiErrorRate !== null && input.apiErrorRate >= 20) {
    warnings.push({
      id: 'api-errors-critical',
      title: 'API error rate is critical',
      detail: `${input.apiErrorRate.toFixed(1)}% of local API requests failed.`,
      severity: 'critical',
    })
  } else if (input.apiRequests >= 20 && input.apiErrorRate !== null && input.apiErrorRate >= 5) {
    warnings.push({
      id: 'api-errors-warning',
      title: 'API errors are elevated',
      detail: `${input.apiErrorRate.toFixed(1)}% of local API requests failed.`,
      severity: 'warning',
    })
  }
  if (input.terminalRuns >= 5 && input.failedRuns / input.terminalRuns >= 0.2) {
    warnings.push({
      id: 'run-failures',
      title: 'Agent run failures are elevated',
      detail: `${input.failedRuns} of ${input.terminalRuns} terminal runs failed.`,
      severity: 'warning',
    })
  }
  if (input.schedulerFailures > 0) {
    warnings.push({
      id: 'scheduler-failures',
      title: 'Scheduled tasks need attention',
      detail: `${input.schedulerFailures} scheduled task${input.schedulerFailures === 1 ? '' : 's'} last failed.`,
      severity: 'warning',
    })
  }
  return warnings
}

function rangeBucketSeconds(range: MetricRange) {
  switch (range) {
    case '1h':
      return 60
    case '24h':
      return 10 * 60
    case '7d':
      return 60 * 60
    case '30d':
      return 6 * 60 * 60
  }
}

function aggregateStoredMetric(
  metricId: string,
  cutoff: string,
  bucketSeconds: number,
  mode: 'average' | 'rate',
) {
  const aggregate = mode === 'average' ? 'AVG(value)' : 'COUNT(*)'
  const rows = sqlite
    .prepare(
      `SELECT
         CAST(strftime('%s', captured_at) AS INTEGER) / ? * ? AS bucket,
         ${aggregate} AS value
       FROM metric_samples
       WHERE metric_id = ? AND captured_at >= ?
       GROUP BY bucket
       ORDER BY bucket`,
    )
    .all(bucketSeconds, bucketSeconds, metricId, cutoff) as Array<{ bucket: number; value: number }>
  return rows.map((row) => ({
    timestamp: new Date(row.bucket * 1000).toISOString(),
    value: mode === 'rate' ? row.value * (60 / bucketSeconds) : row.value,
  }))
}

function apiErrorRateSeries(cutoff: string, bucketSeconds: number) {
  const rows = sqlite
    .prepare(
      `SELECT
         CAST(strftime('%s', captured_at) AS INTEGER) / ? * ? AS bucket,
         SUM(CASE WHEN metric_id = 'api.latency' THEN 1 ELSE 0 END) AS requests,
         SUM(CASE WHEN metric_id = 'api.error' THEN 1 ELSE 0 END) AS errors
       FROM metric_samples
       WHERE metric_id IN ('api.latency', 'api.error') AND captured_at >= ?
       GROUP BY bucket
       ORDER BY bucket`,
    )
    .all(bucketSeconds, bucketSeconds, cutoff) as Array<{
    bucket: number
    requests: number
    errors: number
  }>
  return rows.map((row) => ({
    timestamp: new Date(row.bucket * 1000).toISOString(),
    value: row.requests > 0 ? (row.errors / row.requests) * 100 : 0,
  }))
}

function runSuccessSeries(cutoff: string, bucketSeconds: number) {
  const rows = sqlite
    .prepare(
      `SELECT
         CAST(strftime('%s', COALESCE(completed_at, created_at)) AS INTEGER) / ? * ? AS bucket,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
         COUNT(*) AS total
       FROM chat_runs
       WHERE COALESCE(completed_at, created_at) >= ? AND status IN ('completed', 'failed', 'aborted')
       GROUP BY bucket
       ORDER BY bucket`,
    )
    .all(bucketSeconds, bucketSeconds, cutoff) as Array<{
    bucket: number
    completed: number
    total: number
  }>
  return rows.map((row) => ({
    timestamp: new Date(row.bucket * 1000).toISOString(),
    value: row.total > 0 ? (row.completed / row.total) * 100 : 0,
  }))
}

function usageSeries(cutoff: string, bucketSeconds: number, mode: 'tokens' | 'cost') {
  const expression =
    mode === 'tokens'
      ? 'COALESCE(SUM(COALESCE(usage_input_tokens, 0) + COALESCE(usage_output_tokens, 0) + COALESCE(usage_cache_read_tokens, 0) + COALESCE(usage_cache_write_tokens, 0)), 0)'
      : 'COALESCE(SUM(usage_cost_total), 0)'
  const rows = sqlite
    .prepare(
      `SELECT
         CAST(strftime('%s', created_at) AS INTEGER) / ? * ? AS bucket,
         ${expression} AS value
       FROM chat_messages
       WHERE created_at >= ?
       GROUP BY bucket
       ORDER BY bucket`,
    )
    .all(bucketSeconds, bucketSeconds, cutoff) as Array<{ bucket: number; value: number }>
  return rows.map((row) => ({
    timestamp: new Date(row.bucket * 1000).toISOString(),
    value: row.value,
  }))
}

function aggregateRows(
  rows: Array<ValueRow | TimestampValue>,
  bucketSeconds: number,
  summarize: (values: number[]) => number | null,
) {
  const buckets = new Map<number, number[]>()
  for (const row of rows) {
    const timestamp = 'capturedAt' in row ? row.capturedAt : row.timestamp
    const bucket = Math.floor(Date.parse(timestamp) / 1000 / bucketSeconds) * bucketSeconds
    const values = buckets.get(bucket) ?? []
    values.push(row.value)
    buckets.set(bucket, values)
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([bucket, values]) => {
      const value = summarize(values)
      return value === null ? [] : [{ timestamp: new Date(bucket * 1000).toISOString(), value }]
    })
}

function average(values: number[]) {
  return values.length > 0
    ? values.reduce((total, value) => total + value, 0) / values.length
    : null
}

function formatList(items: string[]) {
  if (items.length <= 3) return new Intl.ListFormat('en', { type: 'conjunction' }).format(items)
  return `${items.slice(0, 2).join(', ')} and ${items.length - 2} more metrics`
}

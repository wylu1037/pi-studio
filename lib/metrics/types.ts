import type {
  MetricDefinition,
  MetricId,
  MetricRange,
  MetricsDetailLevel,
  MetricsIntervalSeconds,
  MetricsRetentionDays,
} from '@/lib/metrics/catalog'

export type MetricsSettings = {
  enabled: boolean
  detailLevel: MetricsDetailLevel
  intervalSeconds: MetricsIntervalSeconds
  retentionDays: MetricsRetentionDays
  enabledMetricIds: MetricId[]
  intervalOverrides: Partial<Record<MetricId, MetricsIntervalSeconds>>
  diagnosticUntil: string | null
}

export type MetricsSettingsResponse = {
  settings: MetricsSettings
  catalog: MetricDefinition[]
}

export type MetricsHealth = 'healthy' | 'degraded' | 'critical' | 'disabled' | 'warming'

export type MetricsSummary = {
  generatedAt: string
  range: MetricRange
  health: MetricsHealth
  lastSampleAt: string | null
  sampleCount: number
  runtime: {
    uptimeSeconds: number
    cpuPercent: number | null
    rssBytes: number | null
    heapBytes: number | null
    eventLoopLagMs: number | null
  }
  api: {
    requests: number
    errorRate: number | null
    p95LatencyMs: number | null
  }
  runs: {
    queued: number
    active: number
    completed: number
    failed: number
    aborted: number
    successRate: number | null
    averageDurationMs: number | null
    p95DurationMs: number | null
    p95TimeToFirstResponseMs: number | null
  }
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    totalTokens: number
    cost: number
    cacheHitRate: number | null
  }
  scheduler: {
    total: number
    failed: number
  }
  warnings: Array<{
    id: string
    title: string
    detail: string
    severity: 'warning' | 'critical'
  }>
}

export type MetricSeriesPoint = {
  timestamp: string
  value: number
}

export type MetricSeries = {
  metricId: MetricId
  range: MetricRange
  points: MetricSeriesPoint[]
}

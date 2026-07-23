export const METRICS_DETAIL_LEVELS = ['essential', 'standard', 'diagnostic', 'custom'] as const
export type MetricsDetailLevel = (typeof METRICS_DETAIL_LEVELS)[number]

export const METRICS_INTERVAL_SECONDS = [5, 15, 30, 60, 300] as const
export type MetricsIntervalSeconds = (typeof METRICS_INTERVAL_SECONDS)[number]

export const METRICS_RETENTION_DAYS = [1, 7, 30, 90] as const
export type MetricsRetentionDays = (typeof METRICS_RETENTION_DAYS)[number]

export const METRIC_RANGES = ['1h', '24h', '7d', '30d'] as const
export type MetricRange = (typeof METRIC_RANGES)[number]

export const METRIC_IDS = [
  'runtime.uptime',
  'runtime.cpu',
  'runtime.rss',
  'runtime.heap',
  'runtime.eventLoopLag',
  'api.requestRate',
  'api.errorRate',
  'api.latency',
  'runs.active',
  'runs.successRate',
  'runs.duration',
  'runs.ttft',
  'usage.tokens',
  'usage.cost',
  'usage.cacheHitRate',
  'scheduler.failures',
  'storage.database',
  'storage.logs',
] as const

export type MetricId = (typeof METRIC_IDS)[number]
export type MetricGroup = 'resources' | 'api' | 'runs' | 'usage' | 'scheduler' | 'storage'
export type MetricKind = 'gauge' | 'event' | 'snapshot' | 'derived'

export type MetricDefinition = {
  id: MetricId
  label: string
  description: string
  group: MetricGroup
  kind: MetricKind
  unit: 'percent' | 'bytes' | 'milliseconds' | 'seconds' | 'count' | 'tokens' | 'currency'
  minimumDetailLevel: Exclude<MetricsDetailLevel, 'custom'>
  minimumIntervalSeconds?: MetricsIntervalSeconds
  supportsSeries: boolean
}

export const METRIC_CATALOG: MetricDefinition[] = [
  {
    id: 'runtime.uptime',
    label: 'Server uptime',
    description: 'Time since the local Pi Studio server started.',
    group: 'resources',
    kind: 'derived',
    unit: 'seconds',
    minimumDetailLevel: 'essential',
    supportsSeries: false,
  },
  {
    id: 'runtime.cpu',
    label: 'Server CPU',
    description: 'CPU consumed by the local Pi Studio server process.',
    group: 'resources',
    kind: 'gauge',
    unit: 'percent',
    minimumDetailLevel: 'essential',
    minimumIntervalSeconds: 5,
    supportsSeries: true,
  },
  {
    id: 'runtime.rss',
    label: 'Resident memory',
    description: 'Physical memory held by the local server process.',
    group: 'resources',
    kind: 'gauge',
    unit: 'bytes',
    minimumDetailLevel: 'essential',
    minimumIntervalSeconds: 5,
    supportsSeries: true,
  },
  {
    id: 'runtime.heap',
    label: 'Heap memory',
    description: 'JavaScript heap currently used by the local server.',
    group: 'resources',
    kind: 'gauge',
    unit: 'bytes',
    minimumDetailLevel: 'standard',
    minimumIntervalSeconds: 5,
    supportsSeries: true,
  },
  {
    id: 'runtime.eventLoopLag',
    label: 'Event-loop lag',
    description: 'P95 delay observed by the Node.js event loop.',
    group: 'resources',
    kind: 'gauge',
    unit: 'milliseconds',
    minimumDetailLevel: 'standard',
    minimumIntervalSeconds: 5,
    supportsSeries: true,
  },
  {
    id: 'api.requestRate',
    label: 'API request rate',
    description: 'Local API requests handled per minute.',
    group: 'api',
    kind: 'event',
    unit: 'count',
    minimumDetailLevel: 'standard',
    supportsSeries: true,
  },
  {
    id: 'api.errorRate',
    label: 'API error rate',
    description: 'Share of local API responses with a 5xx status.',
    group: 'api',
    kind: 'event',
    unit: 'percent',
    minimumDetailLevel: 'standard',
    supportsSeries: true,
  },
  {
    id: 'api.latency',
    label: 'API latency',
    description: 'P95 latency for local API requests.',
    group: 'api',
    kind: 'event',
    unit: 'milliseconds',
    minimumDetailLevel: 'standard',
    supportsSeries: true,
  },
  {
    id: 'runs.active',
    label: 'Active runs',
    description: 'Agent runs currently queued or executing.',
    group: 'runs',
    kind: 'derived',
    unit: 'count',
    minimumDetailLevel: 'essential',
    supportsSeries: false,
  },
  {
    id: 'runs.successRate',
    label: 'Run success rate',
    description: 'Completed runs divided by terminal runs in the selected range.',
    group: 'runs',
    kind: 'derived',
    unit: 'percent',
    minimumDetailLevel: 'essential',
    supportsSeries: true,
  },
  {
    id: 'runs.duration',
    label: 'Run duration',
    description: 'P95 wall-clock duration of completed agent runs.',
    group: 'runs',
    kind: 'derived',
    unit: 'milliseconds',
    minimumDetailLevel: 'standard',
    supportsSeries: true,
  },
  {
    id: 'runs.ttft',
    label: 'Time to first response',
    description: 'P95 delay from run start to the first assistant event.',
    group: 'runs',
    kind: 'derived',
    unit: 'milliseconds',
    minimumDetailLevel: 'standard',
    supportsSeries: false,
  },
  {
    id: 'usage.tokens',
    label: 'Model tokens',
    description: 'Input and output tokens consumed in the selected range.',
    group: 'usage',
    kind: 'derived',
    unit: 'tokens',
    minimumDetailLevel: 'essential',
    supportsSeries: true,
  },
  {
    id: 'usage.cost',
    label: 'Model cost',
    description: 'Reported provider cost in the selected range.',
    group: 'usage',
    kind: 'derived',
    unit: 'currency',
    minimumDetailLevel: 'essential',
    supportsSeries: true,
  },
  {
    id: 'usage.cacheHitRate',
    label: 'Cache hit rate',
    description: 'Cached input tokens divided by all input-side tokens.',
    group: 'usage',
    kind: 'derived',
    unit: 'percent',
    minimumDetailLevel: 'standard',
    supportsSeries: false,
  },
  {
    id: 'scheduler.failures',
    label: 'Scheduled task failures',
    description: 'Scheduled tasks whose latest execution failed.',
    group: 'scheduler',
    kind: 'derived',
    unit: 'count',
    minimumDetailLevel: 'essential',
    supportsSeries: false,
  },
  {
    id: 'storage.database',
    label: 'Database footprint',
    description: 'Combined SQLite database, WAL, and shared-memory files.',
    group: 'storage',
    kind: 'snapshot',
    unit: 'bytes',
    minimumDetailLevel: 'essential',
    minimumIntervalSeconds: 300,
    supportsSeries: true,
  },
  {
    id: 'storage.logs',
    label: 'Log footprint',
    description: 'Combined application log file size.',
    group: 'storage',
    kind: 'snapshot',
    unit: 'bytes',
    minimumDetailLevel: 'standard',
    minimumIntervalSeconds: 300,
    supportsSeries: true,
  },
]

export const ESSENTIAL_METRIC_IDS: MetricId[] = METRIC_CATALOG.filter(
  (metric) => metric.minimumDetailLevel === 'essential',
).map((metric) => metric.id)

export const STANDARD_METRIC_IDS: MetricId[] = METRIC_CATALOG.filter(
  (metric) => metric.minimumDetailLevel !== 'diagnostic',
).map((metric) => metric.id)

export const DEFAULT_METRIC_IDS = STANDARD_METRIC_IDS

export const METRIC_DEFINITIONS = new Map(METRIC_CATALOG.map((metric) => [metric.id, metric]))

export function isMetricId(value: unknown): value is MetricId {
  return typeof value === 'string' && METRIC_IDS.includes(value as MetricId)
}

export function metricIntervalSeconds(
  metricId: MetricId,
  settings: {
    intervalSeconds: MetricsIntervalSeconds
    intervalOverrides: Partial<Record<MetricId, MetricsIntervalSeconds>>
  },
) {
  const definition = METRIC_DEFINITIONS.get(metricId)
  const requested = settings.intervalOverrides[metricId] ?? settings.intervalSeconds
  return Math.max(requested, definition?.minimumIntervalSeconds ?? requested)
}

export function metricRangeMilliseconds(range: MetricRange) {
  switch (range) {
    case '1h':
      return 60 * 60 * 1000
    case '24h':
      return 24 * 60 * 60 * 1000
    case '7d':
      return 7 * 24 * 60 * 60 * 1000
    case '30d':
      return 30 * 24 * 60 * 60 * 1000
  }
}

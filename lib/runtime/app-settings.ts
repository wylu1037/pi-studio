import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { piStudioDataDir } from '@/lib/runtime/paths'
import {
  DEFAULT_METRIC_IDS,
  METRICS_DETAIL_LEVELS,
  METRICS_INTERVAL_SECONDS,
  METRICS_RETENTION_DAYS,
  METRIC_DEFINITIONS,
  STANDARD_METRIC_IDS,
  isMetricId,
  type MetricId,
  type MetricsDetailLevel,
  type MetricsIntervalSeconds,
  type MetricsRetentionDays,
} from '@/lib/metrics/catalog'
import type { MetricsSettings } from '@/lib/metrics/types'

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

export type AppSettings = {
  schemaVersion: 1
  logLevel: LogLevel
  metrics: MetricsSettings
}

export const DEFAULT_METRICS_SETTINGS: MetricsSettings = {
  enabled: true,
  detailLevel: 'standard',
  intervalSeconds: 15,
  retentionDays: 7,
  enabledMetricIds: [...DEFAULT_METRIC_IDS],
  intervalOverrides: {},
  diagnosticUntil: null,
}

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 1,
  logLevel: 'info',
  metrics: DEFAULT_METRICS_SETTINGS,
}

let cachedSettings: AppSettings | null = null

export function appSettingsPath() {
  return join(piStudioDataDir(), 'settings.json')
}

export function getAppSettings(): AppSettings {
  if (cachedSettings) {
    cachedSettings = normalizeAppSettings(cachedSettings)
    return cachedSettings
  }
  try {
    const stored = JSON.parse(readFileSync(appSettingsPath(), 'utf8')) as unknown
    cachedSettings = normalizeAppSettings(stored)
  } catch {
    cachedSettings = normalizeAppSettings(DEFAULT_SETTINGS)
  }
  return cachedSettings
}

export type AppSettingsUpdate = Omit<Partial<AppSettings>, 'metrics'> & {
  metrics?: Partial<MetricsSettings>
}

export function updateAppSettings(input: AppSettingsUpdate): AppSettings {
  const current = getAppSettings()
  const next = mergeAppSettings(current, input)
  const path = appSettingsPath()
  const temporaryPath = `${path}.tmp`
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  renameSync(temporaryPath, path)
  cachedSettings = next
  return next
}

export function mergeAppSettings(
  current: AppSettings,
  input: AppSettingsUpdate,
  now = new Date(),
): AppSettings {
  return normalizeAppSettings(
    {
      ...current,
      ...input,
      metrics: input.metrics ? { ...current.metrics, ...input.metrics } : current.metrics,
    },
    now,
  )
}

export function normalizeAppSettings(value: unknown, now = new Date()): AppSettings {
  const record = objectValue(value)
  return {
    schemaVersion: 1,
    logLevel: LOG_LEVELS.includes(record.logLevel as LogLevel)
      ? (record.logLevel as LogLevel)
      : DEFAULT_SETTINGS.logLevel,
    metrics: normalizeMetricsSettings(record.metrics, now),
  }
}

export function normalizeMetricsSettings(value: unknown, now = new Date()): MetricsSettings {
  const record = objectValue(value)
  const requestedLevel = METRICS_DETAIL_LEVELS.includes(record.detailLevel as MetricsDetailLevel)
    ? (record.detailLevel as MetricsDetailLevel)
    : DEFAULT_METRICS_SETTINGS.detailLevel
  const diagnosticUntil = futureIso(record.diagnosticUntil, now)
  const expiredDiagnostic = requestedLevel === 'diagnostic' && !diagnosticUntil
  const detailLevel = expiredDiagnostic ? 'standard' : requestedLevel
  const intervalSeconds = expiredDiagnostic
    ? DEFAULT_METRICS_SETTINGS.intervalSeconds
    : METRICS_INTERVAL_SECONDS.includes(record.intervalSeconds as MetricsIntervalSeconds)
      ? (record.intervalSeconds as MetricsIntervalSeconds)
      : detailLevel === 'essential'
        ? 60
        : detailLevel === 'diagnostic'
          ? 5
          : DEFAULT_METRICS_SETTINGS.intervalSeconds
  const retentionDays = METRICS_RETENTION_DAYS.includes(
    record.retentionDays as MetricsRetentionDays,
  )
    ? (record.retentionDays as MetricsRetentionDays)
    : DEFAULT_METRICS_SETTINGS.retentionDays
  const enabledMetricIds = expiredDiagnostic
    ? [...STANDARD_METRIC_IDS]
    : Array.isArray(record.enabledMetricIds)
      ? [...new Set(record.enabledMetricIds.filter(isMetricId))]
      : [...DEFAULT_METRICS_SETTINGS.enabledMetricIds]
  const intervalOverrides = expiredDiagnostic
    ? {}
    : normalizeIntervalOverrides(record.intervalOverrides)

  return {
    enabled:
      typeof record.enabled === 'boolean' ? record.enabled : DEFAULT_METRICS_SETTINGS.enabled,
    detailLevel,
    intervalSeconds,
    retentionDays,
    enabledMetricIds,
    intervalOverrides,
    diagnosticUntil: detailLevel === 'diagnostic' ? diagnosticUntil : null,
  }
}

function normalizeIntervalOverrides(value: unknown) {
  const record = objectValue(value)
  const overrides: Partial<Record<MetricId, MetricsIntervalSeconds>> = {}
  for (const [key, interval] of Object.entries(record)) {
    if (!isMetricId(key)) continue
    if (!METRICS_INTERVAL_SECONDS.includes(interval as MetricsIntervalSeconds)) continue
    const definition = METRIC_DEFINITIONS.get(key)
    if (definition?.kind !== 'gauge' && definition?.kind !== 'snapshot') continue
    const requested = interval as MetricsIntervalSeconds
    const minimum = definition.minimumIntervalSeconds ?? requested
    overrides[key] = Math.max(requested, minimum) as MetricsIntervalSeconds
  }
  return overrides
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function futureIso(value: unknown, now: Date) {
  if (typeof value !== 'string') return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && timestamp > now.getTime()
    ? new Date(timestamp).toISOString()
    : null
}

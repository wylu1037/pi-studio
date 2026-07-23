import {
  ESSENTIAL_METRIC_IDS,
  METRIC_IDS,
  STANDARD_METRIC_IDS,
  type MetricsDetailLevel,
} from '@/lib/metrics/catalog'
import type { MetricsSettings } from '@/lib/metrics/types'

const DIAGNOSTIC_DURATION_MS = 60 * 60 * 1000

export function applyMetricsPreset(
  current: MetricsSettings,
  detailLevel: MetricsDetailLevel,
  now = new Date(),
): MetricsSettings {
  switch (detailLevel) {
    case 'essential':
      return {
        ...current,
        detailLevel,
        intervalSeconds: 60,
        enabledMetricIds: [...ESSENTIAL_METRIC_IDS],
        intervalOverrides: {},
        diagnosticUntil: null,
      }
    case 'standard':
      return {
        ...current,
        detailLevel,
        intervalSeconds: 15,
        enabledMetricIds: [...STANDARD_METRIC_IDS],
        intervalOverrides: {},
        diagnosticUntil: null,
      }
    case 'diagnostic':
      return {
        ...current,
        detailLevel,
        intervalSeconds: 5,
        enabledMetricIds: [...METRIC_IDS],
        intervalOverrides: {},
        diagnosticUntil: new Date(now.getTime() + DIAGNOSTIC_DURATION_MS).toISOString(),
      }
    case 'custom':
      return {
        ...current,
        detailLevel,
        diagnosticUntil: null,
      }
  }
}

export function markMetricsSettingsCustom(current: MetricsSettings): MetricsSettings {
  return current.detailLevel === 'custom'
    ? current
    : { ...current, detailLevel: 'custom', diagnosticUntil: null }
}

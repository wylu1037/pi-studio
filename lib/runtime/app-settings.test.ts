import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_METRICS_SETTINGS,
  mergeAppSettings,
  normalizeAppSettings,
  normalizeMetricsSettings,
} from './app-settings'

test('adds default metrics settings to legacy app settings', () => {
  const settings = normalizeAppSettings({ logLevel: 'warn' })

  assert.equal(settings.schemaVersion, 1)
  assert.equal(settings.logLevel, 'warn')
  assert.deepEqual(settings.metrics, DEFAULT_METRICS_SETTINGS)
})

test('normalizes invalid metrics values and removes unknown metric IDs', () => {
  const settings = normalizeMetricsSettings({
    enabled: 'yes',
    detailLevel: 'verbose',
    intervalSeconds: 7,
    retentionDays: 8,
    enabledMetricIds: ['runtime.cpu', 'unknown.metric', 'runtime.cpu'],
    intervalOverrides: { 'runtime.cpu': 7, 'unknown.metric': 15 },
  })

  assert.equal(settings.enabled, true)
  assert.equal(settings.detailLevel, 'standard')
  assert.equal(settings.intervalSeconds, 15)
  assert.equal(settings.retentionDays, 7)
  assert.deepEqual(settings.enabledMetricIds, ['runtime.cpu'])
  assert.deepEqual(settings.intervalOverrides, {})
})

test('deep-merges a partial metrics update without dropping sibling settings', () => {
  const current = normalizeAppSettings({
    logLevel: 'debug',
    metrics: {
      enabled: false,
      detailLevel: 'custom',
      intervalSeconds: 30,
      retentionDays: 30,
      enabledMetricIds: ['runtime.cpu'],
      intervalOverrides: { 'runtime.cpu': 60 },
      diagnosticUntil: null,
    },
  })

  const next = mergeAppSettings(current, { metrics: { retentionDays: 90 } })

  assert.equal(next.logLevel, 'debug')
  assert.equal(next.metrics.enabled, false)
  assert.equal(next.metrics.detailLevel, 'custom')
  assert.equal(next.metrics.intervalSeconds, 30)
  assert.deepEqual(next.metrics.enabledMetricIds, ['runtime.cpu'])
  assert.deepEqual(next.metrics.intervalOverrides, { 'runtime.cpu': 60 })
  assert.equal(next.metrics.retentionDays, 90)
})

test('clamps storage sampling overrides to the five-minute minimum', () => {
  const settings = normalizeMetricsSettings({
    intervalOverrides: {
      'storage.database': 5,
      'storage.logs': 60,
      'api.latency': 15,
    },
  })

  assert.deepEqual(settings.intervalOverrides, {
    'storage.database': 300,
    'storage.logs': 300,
  })
})

test('returns expired diagnostic collection to the standard preset', () => {
  const now = new Date('2026-07-23T08:00:00.000Z')
  const settings = normalizeMetricsSettings(
    {
      detailLevel: 'diagnostic',
      intervalSeconds: 5,
      enabledMetricIds: ['runtime.cpu'],
      intervalOverrides: { 'runtime.cpu': 5 },
      diagnosticUntil: '2026-07-23T07:59:59.000Z',
    },
    now,
  )

  assert.equal(settings.detailLevel, 'standard')
  assert.equal(settings.intervalSeconds, 15)
  assert.deepEqual(settings.enabledMetricIds, DEFAULT_METRICS_SETTINGS.enabledMetricIds)
  assert.deepEqual(settings.intervalOverrides, {})
  assert.equal(settings.diagnosticUntil, null)
})

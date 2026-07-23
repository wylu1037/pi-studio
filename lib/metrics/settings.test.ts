import assert from 'node:assert/strict'
import test from 'node:test'
import { ESSENTIAL_METRIC_IDS, METRIC_IDS, STANDARD_METRIC_IDS } from './catalog'
import { applyMetricsPreset, markMetricsSettingsCustom } from './settings'
import type { MetricsSettings } from './types'

const baseSettings: MetricsSettings = {
  enabled: true,
  detailLevel: 'custom',
  intervalSeconds: 30,
  retentionDays: 30,
  enabledMetricIds: ['runtime.cpu'],
  intervalOverrides: { 'runtime.cpu': 60 },
  diagnosticUntil: null,
}

test('applies essential and standard collection presets', () => {
  const essential = applyMetricsPreset(baseSettings, 'essential')
  assert.equal(essential.intervalSeconds, 60)
  assert.deepEqual(essential.enabledMetricIds, ESSENTIAL_METRIC_IDS)
  assert.deepEqual(essential.intervalOverrides, {})

  const standard = applyMetricsPreset(baseSettings, 'standard')
  assert.equal(standard.intervalSeconds, 15)
  assert.deepEqual(standard.enabledMetricIds, STANDARD_METRIC_IDS)
  assert.deepEqual(standard.intervalOverrides, {})
})

test('applies a one-hour diagnostic preset without changing retention', () => {
  const now = new Date('2026-07-23T08:00:00.000Z')
  const diagnostic = applyMetricsPreset(baseSettings, 'diagnostic', now)

  assert.equal(diagnostic.intervalSeconds, 5)
  assert.equal(diagnostic.retentionDays, 30)
  assert.deepEqual(diagnostic.enabledMetricIds, [...METRIC_IDS])
  assert.deepEqual(diagnostic.intervalOverrides, {})
  assert.equal(diagnostic.diagnosticUntil, '2026-07-23T09:00:00.000Z')
})

test('marks manual changes custom and clears diagnostic expiration', () => {
  const diagnostic = applyMetricsPreset(baseSettings, 'diagnostic', new Date(0))
  const custom = markMetricsSettingsCustom(diagnostic)

  assert.equal(custom.detailLevel, 'custom')
  assert.equal(custom.diagnosticUntil, null)
  assert.equal(custom.intervalSeconds, 5)
  assert.deepEqual(custom.enabledMetricIds, [...METRIC_IDS])
})

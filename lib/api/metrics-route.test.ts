import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { ESSENTIAL_METRIC_IDS, METRIC_IDS } from '../metrics/catalog'

test('serves and updates metrics settings, summary, and series', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-studio-metrics-route-'))
  const previousDatabaseUrl = process.env.DATABASE_URL
  const previousDataDir = process.env.PI_STUDIO_DATA_DIR
  const previousMigrationsDir = process.env.PI_STUDIO_MIGRATIONS_DIR

  process.env.DATABASE_URL = join(root, 'metrics.sqlite')
  process.env.PI_STUDIO_DATA_DIR = root
  process.env.PI_STUDIO_MIGRATIONS_DIR = resolve(process.cwd(), 'drizzle')

  try {
    const { GET, PUT } = await import('../../app/api/[[...route]]/route')
    const settingsResponse = await GET(new Request('http://localhost/api/settings/metrics'))
    assert.equal(settingsResponse.status, 200)

    const initial = (await settingsResponse.json()) as {
      settings: Record<string, unknown>
      catalog: Array<{ id: string }>
    }
    assert.equal(initial.catalog.length, METRIC_IDS.length)

    const invalidOverrideResponse = await PUT(
      new Request('http://localhost/api/settings/metrics', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...initial.settings,
          intervalOverrides: { 'api.latency': 15 },
        }),
      }),
    )
    assert.equal(invalidOverrideResponse.status, 400)

    const updateResponse = await PUT(
      new Request('http://localhost/api/settings/metrics', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...initial.settings,
          enabled: false,
          detailLevel: 'essential',
          intervalSeconds: 60,
          enabledMetricIds: ESSENTIAL_METRIC_IDS,
          intervalOverrides: {},
          diagnosticUntil: null,
        }),
      }),
    )
    assert.equal(updateResponse.status, 200)
    const updated = (await updateResponse.json()) as {
      settings: { enabled: boolean; detailLevel: string; intervalSeconds: number }
    }
    assert.equal(updated.settings.enabled, false)
    assert.equal(updated.settings.detailLevel, 'essential')
    assert.equal(updated.settings.intervalSeconds, 60)

    const summaryResponse = await GET(new Request('http://localhost/api/metrics/summary?range=1h'))
    assert.equal(summaryResponse.status, 200)
    const summary = (await summaryResponse.json()) as { health: string; range: string }
    assert.equal(summary.health, 'disabled')
    assert.equal(summary.range, '1h')

    const seriesResponse = await GET(
      new Request('http://localhost/api/metrics/series?metricId=runtime.cpu&range=1h'),
    )
    assert.equal(seriesResponse.status, 200)
    assert.deepEqual(await seriesResponse.json(), {
      metricId: 'runtime.cpu',
      range: '1h',
      points: [],
    })

    const emptyUpdateResponse = await PUT(
      new Request('http://localhost/api/settings/metrics', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...initial.settings,
          enabled: true,
          detailLevel: 'custom',
          enabledMetricIds: [],
          intervalOverrides: {},
          diagnosticUntil: null,
        }),
      }),
    )
    assert.equal(emptyUpdateResponse.status, 200)

    const emptySummaryResponse = await GET(
      new Request('http://localhost/api/metrics/summary?range=1h'),
    )
    const emptySummary = (await emptySummaryResponse.json()) as {
      health: string
      warnings: Array<{ id: string }>
    }
    assert.equal(emptySummary.health, 'degraded')
    assert.ok(emptySummary.warnings.some((warning) => warning.id === 'metrics-empty'))
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
    if (previousDataDir === undefined) delete process.env.PI_STUDIO_DATA_DIR
    else process.env.PI_STUDIO_DATA_DIR = previousDataDir
    if (previousMigrationsDir === undefined) delete process.env.PI_STUDIO_MIGRATIONS_DIR
    else process.env.PI_STUDIO_MIGRATIONS_DIR = previousMigrationsDir
    await rm(root, { recursive: true, force: true })
  }
})

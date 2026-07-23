import { statSync } from 'node:fs'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { randomUUID } from 'node:crypto'

import { sqlite, databasePath } from '@/lib/db/client'
import { applicationLogPaths } from '@/lib/runtime/log-files'
import { getAppSettings } from '@/lib/runtime/app-settings'
import { logger } from '@/lib/runtime/logger'
import { metricIntervalSeconds, type MetricId } from '@/lib/metrics/catalog'

type ApiEvent = { durationMs: number; error: boolean; capturedAt: string }
type MetricSample = { metricId: string; value: number; capturedAt: string }

const TICK_INTERVAL_MS = 5_000
const MAX_PENDING_API_EVENTS = 5_000
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000
const ERROR_LOG_INTERVAL_MS = 60 * 1000

class MetricsService {
  readonly id = randomUUID()
  private timer: NodeJS.Timeout | null = null
  private apiEvents: ApiEvent[] = []
  private lastCaptured = new Map<MetricId, number>()
  private lastCpuUsage = process.cpuUsage()
  private lastCpuAt = performance.now()
  private lastCleanupAt = 0
  private lastErrorLogAt = 0
  private readonly eventLoopDelay = monitorEventLoopDelay({ resolution: 20 })

  start() {
    if (this.timer) return this
    this.eventLoopDelay.enable()
    this.schedule(250)
    return this
  }

  stop() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.eventLoopDelay.disable()
  }

  reschedule() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.schedule(50)
  }

  recordApiRequest(durationMs: number, status: number) {
    const settings = getAppSettings().metrics
    if (!settings.enabled) return
    if (
      !settings.enabledMetricIds.includes('api.latency') &&
      !settings.enabledMetricIds.includes('api.requestRate') &&
      !settings.enabledMetricIds.includes('api.errorRate')
    ) {
      return
    }
    if (this.apiEvents.length >= MAX_PENDING_API_EVENTS) this.apiEvents.shift()
    this.apiEvents.push({
      durationMs: Math.max(0, durationMs),
      error: status >= 500,
      capturedAt: new Date().toISOString(),
    })
  }

  private schedule(delay = TICK_INTERVAL_MS) {
    this.timer = setTimeout(() => {
      this.timer = null
      try {
        this.tick()
      } catch (error) {
        const now = Date.now()
        if (now - this.lastErrorLogAt >= ERROR_LOG_INTERVAL_MS) {
          this.lastErrorLogAt = now
          logger.warn('Metrics sampling failed.', error)
        }
      } finally {
        this.schedule()
      }
    }, delay)
    this.timer.unref?.()
  }

  private tick() {
    const settings = getAppSettings().metrics
    if (!settings.enabled) {
      this.apiEvents = []
      this.eventLoopDelay.reset()
      this.lastCpuUsage = process.cpuUsage()
      this.lastCpuAt = performance.now()
      return
    }

    const now = Date.now()
    const capturedAt = new Date(now).toISOString()
    const samples = [...this.collectRuntimeSamples(settings, now, capturedAt)]
    samples.push(...this.collectStorageSamples(settings, now, capturedAt))
    samples.push(...this.flushApiEvents(settings.enabledMetricIds))
    if (samples.length > 0) insertSamples(samples)

    if (now - this.lastCleanupAt >= CLEANUP_INTERVAL_MS) {
      this.lastCleanupAt = now
      deleteSamplesBefore(
        new Date(now - settings.retentionDays * 24 * 60 * 60 * 1000).toISOString(),
      )
    }
  }

  private collectRuntimeSamples(
    settings: ReturnType<typeof getAppSettings>['metrics'],
    now: number,
    capturedAt: string,
  ) {
    const samples: MetricSample[] = []
    const due = (metricId: MetricId) => this.metricDue(metricId, settings, now)
    const memory = process.memoryUsage()
    const cpuAt = performance.now()
    const currentCpuUsage = process.cpuUsage()
    const cpu = {
      user: currentCpuUsage.user - this.lastCpuUsage.user,
      system: currentCpuUsage.system - this.lastCpuUsage.system,
    }
    const elapsedMs = Math.max(1, cpuAt - this.lastCpuAt)

    if (settings.enabledMetricIds.includes('runtime.cpu') && due('runtime.cpu')) {
      samples.push({
        metricId: 'runtime.cpu',
        value: ((cpu.user + cpu.system) / 1000 / elapsedMs) * 100,
        capturedAt,
      })
    }
    this.lastCpuUsage = currentCpuUsage
    this.lastCpuAt = cpuAt

    if (settings.enabledMetricIds.includes('runtime.rss') && due('runtime.rss')) {
      samples.push({ metricId: 'runtime.rss', value: memory.rss, capturedAt })
    }
    if (settings.enabledMetricIds.includes('runtime.heap') && due('runtime.heap')) {
      samples.push({ metricId: 'runtime.heap', value: memory.heapUsed, capturedAt })
    }
    if (settings.enabledMetricIds.includes('runtime.eventLoopLag') && due('runtime.eventLoopLag')) {
      const p95 = Number(this.eventLoopDelay.percentile(95)) / 1_000_000
      if (Number.isFinite(p95)) {
        samples.push({ metricId: 'runtime.eventLoopLag', value: p95, capturedAt })
      }
      this.eventLoopDelay.reset()
    }

    return samples
  }

  private collectStorageSamples(
    settings: ReturnType<typeof getAppSettings>['metrics'],
    now: number,
    capturedAt: string,
  ) {
    const samples: MetricSample[] = []
    if (
      settings.enabledMetricIds.includes('storage.database') &&
      this.metricDue('storage.database', settings, now)
    ) {
      const size = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`].reduce(
        (total, path) => total + fileSize(path),
        0,
      )
      samples.push({ metricId: 'storage.database', value: size, capturedAt })
    }
    if (
      settings.enabledMetricIds.includes('storage.logs') &&
      this.metricDue('storage.logs', settings, now)
    ) {
      const size = applicationLogPaths().reduce((total, path) => total + fileSize(path), 0)
      samples.push({ metricId: 'storage.logs', value: size, capturedAt })
    }
    return samples
  }

  private flushApiEvents(enabledMetricIds: MetricId[]) {
    const events = this.apiEvents
    this.apiEvents = []
    const samples: MetricSample[] = []
    for (const event of events) {
      if (
        enabledMetricIds.includes('api.latency') ||
        enabledMetricIds.includes('api.requestRate') ||
        enabledMetricIds.includes('api.errorRate')
      ) {
        samples.push({
          metricId: 'api.latency',
          value: event.durationMs,
          capturedAt: event.capturedAt,
        })
      }
      if (event.error && enabledMetricIds.includes('api.errorRate')) {
        samples.push({ metricId: 'api.error', value: 1, capturedAt: event.capturedAt })
      }
    }
    return samples
  }

  private metricDue(
    metricId: MetricId,
    settings: ReturnType<typeof getAppSettings>['metrics'],
    now: number,
  ) {
    const intervalMs = metricIntervalSeconds(metricId, settings) * 1000
    const last = this.lastCaptured.get(metricId) ?? 0
    if (now - last < intervalMs) return false
    this.lastCaptured.set(metricId, now)
    return true
  }
}

const insertSamplesStatement = sqlite.prepare(
  'INSERT INTO metric_samples (metric_id, value, captured_at) VALUES (?, ?, ?)',
)

const insertSamples = sqlite.transaction((samples: MetricSample[]) => {
  for (const sample of samples) {
    if (!Number.isFinite(sample.value)) continue
    insertSamplesStatement.run(sample.metricId, sample.value, sample.capturedAt)
  }
})

const deleteSamplesStatement = sqlite.prepare('DELETE FROM metric_samples WHERE captured_at < ?')

function deleteSamplesBefore(cutoff: string) {
  deleteSamplesStatement.run(cutoff)
}

function fileSize(path: string) {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

declare global {
  var __piStudioMetricsService: MetricsService | undefined
}

export function ensureMetricsService() {
  globalThis.__piStudioMetricsService ??= new MetricsService()
  return globalThis.__piStudioMetricsService.start()
}

export function recordApiMetric(durationMs: number, status: number) {
  ensureMetricsService().recordApiRequest(durationMs, status)
}

export function notifyMetricsSettingsChanged() {
  ensureMetricsService().reschedule()
}

export function clearMetricHistory() {
  return sqlite.prepare('DELETE FROM metric_samples').run().changes
}

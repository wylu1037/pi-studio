/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { streamSSE } from 'hono/streaming'
import { startSessionPrompt } from '@/lib/chat/run-session-prompt'
import {
  getSessionRunController,
  peekSessionRunController,
} from '@/lib/chat/session-run-controller'
import { runNpx } from '@/lib/npx'
import { loadPiPackageCatalog } from '@/lib/packages/pi-dev-gallery'
import { materializeInstalledSkill, removeStoredSkill, studioRootDir } from '@/lib/skills/store'
import { LOG_LEVELS, getAppSettings, updateAppSettings } from '@/lib/runtime/app-settings'
import { clearApplicationLogs, readApplicationLogs } from '@/lib/runtime/log-files'
import { logger } from '@/lib/runtime/logger'
import { piStudioDataDir } from '@/lib/runtime/paths'
import {
  METRICS_DETAIL_LEVELS,
  METRICS_INTERVAL_SECONDS,
  METRICS_RETENTION_DAYS,
  METRIC_CATALOG,
  METRIC_DEFINITIONS,
  METRIC_IDS,
  METRIC_RANGES,
  isMetricId,
} from '@/lib/metrics/catalog'
import {
  clearMetricHistory,
  notifyMetricsSettingsChanged,
  recordApiMetric,
} from '@/lib/metrics/service'
import { getMetricSeries, getMetricsSummary } from '@/lib/metrics/summary'
import {
  createAgent,
  createForkedSessionRecord,
  createScheduledTask,
  createSession,
  clearSessionMessages,
  deleteAgent,
  deleteModel,
  deletePrompt,
  deleteProvider,
  deleteScheduledTask,
  duplicateAgent,
  duplicateSession,
  getAgent,
  getModelCapabilities,
  getProvider,
  getSession,
  getSessionTree,
  getPackageCatalogItem,
  listAgents,
  listPrompts,
  listProviders,
  listScheduledTasks,
  listSessionMessages,
  listSessions,
  listSkills,
  resolveAgentRunConfig,
  setDefaultProvider,
  testProviderConnection,
  updateAgent,
  updateAgentResources,
  updateScheduledTask,
  updateSession,
  updateSessionComposerConfig,
  upsertSkill,
  upsertModel,
  upsertPrompt,
  upsertProvider,
  deleteSession,
  deleteSkill,
} from '@/lib/db/repository'
import {
  AssignToAgentSchema,
  AgentQueueMessageSchema,
  AgentInputSchema,
  AgentResourcesSchema,
  AgentSchema,
  ChatMessageSchema,
  CreateSessionSchema,
  ErrorSchema,
  CreateExtensionSchema,
  ExtensionDiagnosticSchema,
  ExtensionFileContentSchema,
  ExtensionFileQuerySchema,
  ExtensionFileSchema,
  ExtensionListQuerySchema,
  ExtensionReloadResultSchema,
  ExtensionReloadSchema,
  ExtensionSchema,
  ExtensionSourceSchema,
  ExtensionStateSchema,
  ExtensionUiResponseSchema,
  ExtensionUiSnapshotSchema,
  ExtensionValidationSchema,
  ExtensionWorkspaceSchema,
  ModelCapabilitiesSchema,
  InstallPackageSchema,
  ModelInputSchema,
  PackageCollectionSchema,
  PiPackageCatalogQuerySchema,
  PiPackageCatalogSchema,
  PromptInputSchema,
  PromptSchema,
  ProviderInputSchema,
  ProviderSchema,
  ProviderTestResultSchema,
  ProjectTrustInputSchema,
  ProjectTrustStateSchema,
  ScheduledTaskInputSchema,
  ScheduledTaskSchema,
  SessionSchema,
  SessionExtensionSnapshotSchema,
  UpdateSessionSchema,
  UpdateSessionComposerSchema,
  SessionBranchContextSchema,
  SessionEntryActionSchema,
  SessionTreeNodeSchema,
  SdkSessionTreeSchema,
  SkillRegistryItemSchema,
  SkillInputSchema,
  SkillSchema,
  StartRunSchema,
  StartRunResultSchema,
  ToggleExtensionSchema,
} from './schemas'
import { executeScheduledTask, nextRunAt } from '@/lib/scheduler/task-scheduler'

const json = <T extends z.ZodTypeAny>(schema: T) => ({
  content: {
    'application/json': {
      schema,
    },
  },
  description: 'OK',
})

export const api = new OpenAPIHono().basePath('/api')

api.use('*', async (c, next) => {
  const path = c.req.path
  const shouldRecord =
    !path.startsWith('/api/metrics') &&
    !path.startsWith('/api/settings/metrics') &&
    path !== '/api/health'
  if (!shouldRecord) return next()

  const startedAt = performance.now()
  let failed = false
  try {
    await next()
  } catch (error) {
    failed = true
    throw error
  } finally {
    recordApiMetric(performance.now() - startedAt, failed ? 500 : c.res.status)
  }
})

async function runtimePackageCollection(cwd: string) {
  const { listRuntimePackages } = await import('@/lib/packages/package-service')
  const catalog = await loadPiPackageCatalog()
  return listRuntimePackages(cwd, catalog.packages)
}

function normalizeRegistryKey(value: string) {
  return value.trim().toLowerCase()
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*m/g
const SKILLS_SEARCH_API_BASE = process.env.SKILLS_API_URL || 'https://skills.sh'
const SKILLS_SEARCH_LIMIT = 50

const skillsShSearchSkillSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    skillId: z.string().optional(),
    source: z.string().optional(),
    installs: z.number().optional(),
  })
  .passthrough()

const skillsShSearchResponseSchema = z
  .object({
    skills: z.array(skillsShSearchSkillSchema).default([]),
  })
  .passthrough()

function formatInstallCount(installs?: number) {
  if (typeof installs !== 'number') return null
  if (installs >= 1_000_000) {
    return `${(installs / 1_000_000).toFixed(1).replace(/\.0$/, '')}M installs`
  }
  if (installs >= 1_000) {
    return `${(installs / 1_000).toFixed(1).replace(/\.0$/, '')}K installs`
  }
  return `${installs} install${installs === 1 ? '' : 's'}`
}

function parseFormattedInstalls(value: string) {
  const match = value.match(/^([\d.]+)([KMB])?\s+installs?$/)
  if (!match) return undefined
  const parsed = Number(match[1])
  if (!Number.isFinite(parsed)) return undefined
  const multiplier =
    match[2] === 'B' ? 1_000_000_000 : match[2] === 'M' ? 1_000_000 : match[2] === 'K' ? 1_000 : 1
  return parsed * multiplier
}

function packageSpec(source: string | undefined, name: string, id: string) {
  if (source) return `${source}@${name}`
  if (id.includes('/')) {
    const lastSlash = id.lastIndexOf('/')
    return `${id.slice(0, lastSlash)}@${id.slice(lastSlash + 1)}`
  }
  return name
}

function cleanSkillsCliError(value: string) {
  const clean = value
    // eslint-disable-next-line no-control-regex
    .replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, '')
    .replace(/\r/g, '\n')
  const noMatch = clean.match(/No matching skills found:[\s\S]*/)?.[0]
  const useful = noMatch ?? clean
  return useful
    .split('\n')
    .map((line) => line.trim())
    .filter((line, index, lines) => line && line !== lines[index - 1])
    .join(' ')
    .slice(0, 600)
}

async function searchSkillsApi(query: string) {
  const url = new URL('/api/search', SKILLS_SEARCH_API_BASE)
  url.searchParams.set('q', query)
  url.searchParams.set('limit', String(SKILLS_SEARCH_LIMIT))

  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`skills.sh search failed: HTTP ${response.status}`)

  const payload = skillsShSearchResponseSchema.parse(await response.json())
  return payload.skills.map((skill) => {
    const skillName = skill.skillId || skill.name
    return {
      id: skill.id,
      name: skillName,
      author: skill.source?.split('/')[0] || 'skills.sh',
      description: [skill.source || skill.id, formatInstallCount(skill.installs)]
        .filter(Boolean)
        .join(' · '),
      tags: [],
      source: skill.source || skill.id,
      sourceType: 'skills.sh',
      installUrl: packageSpec(skill.source, skillName, skill.id),
      url: `${SKILLS_SEARCH_API_BASE}/${skill.id}`,
      installs: skill.installs,
    }
  })
}

function parseSkillsFindOutput(raw: string) {
  const clean = raw.replace(ANSI_RE, '')
  const lines = clean.split(/\r?\n/)
  const results = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    const match = line.match(/^([\w.-]+\/[\w.:-]+@[\w.:-]+)\s+([\d.,]+[KMB]?\s+installs?)$/)
    if (!match) continue

    const spec = match[1]
    const installs = match[2].replace(',', '')
    const [source = '', name = spec] = spec.split('@')
    const urlLine = lines[index + 1]?.trim().replace(/^└\s*/, '')

    results.push({
      id: spec,
      name,
      author: source.split('/')[0] || 'skills.sh',
      description: [source, installs].filter(Boolean).join(' · '),
      tags: [],
      source,
      sourceType: 'skills.sh',
      installUrl: spec,
      url: urlLine?.startsWith('https://') ? urlLine : undefined,
      installs: parseFormattedInstalls(installs),
    })
  }

  return results
}

async function searchSkillsCli(query: string) {
  const { stdout, stderr } = await runNpx(['skills', 'find', query], {
    timeout: 20_000,
    env: { ...process.env, FORCE_COLOR: '0' },
  })
  return parseSkillsFindOutput(stdout + stderr).slice(0, SKILLS_SEARCH_LIMIT)
}

async function fetchSkillsShRegistry(query: string) {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  try {
    return await searchSkillsApi(trimmed)
  } catch {
    return searchSkillsCli(trimmed)
  }
}

async function installSkillPackage(pkg: string, options: { skill?: string } = {}) {
  mkdirSync(studioRootDir(), { recursive: true })
  const args = ['skills', 'add', pkg.trim()]
  // `--skill` selects a specific skill inside a multi-skill repo (e.g. a GitHub
  // URL such as https://github.com/owner/repo --skill my-skill). skills.sh
  // package specs already point at a single skill, so the selector is optional.
  if (options.skill) args.push('--skill', options.skill)
  args.push('-y', '--copy')
  try {
    await runNpx(args, {
      timeout: 60_000,
      cwd: studioRootDir(),
      env: { ...process.env, FORCE_COLOR: '0' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(cleanSkillsCliError(message), { cause: error })
  }
}

async function fetchProviderModelCatalog(providerId: string) {
  const provider = getProvider(providerId)
  if (!provider) return null
  const { resolvePiProviderConnection } = await import('@/lib/models/provider-connection')
  const connection = resolvePiProviderConnection({
    baseUrl: provider.baseUrl,
    api: provider.api,
    apiKey: provider.apiKey ?? undefined,
    headers: JSON.parse(provider.headersJson || '{}'),
  })
  const url = new URL(connection.baseUrl)
  if (!url.pathname.replace(/\/$/, '').endsWith('/models')) {
    url.pathname = `${url.pathname.replace(/\/$/, '')}/models`
  }
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...connection.headers,
  }
  if (provider.api === 'anthropic-messages') {
    headers['anthropic-version'] ??= '2023-06-01'
  }
  if (connection.apiKey) {
    if (provider.api === 'anthropic-messages') {
      headers['x-api-key'] = connection.apiKey
    } else if (provider.api === 'google-generative-ai') {
      headers['x-goog-api-key'] = connection.apiKey
    } else {
      headers.authorization = `Bearer ${connection.apiKey}`
    }
  }
  const response = await fetch(url, { headers, cache: 'no-store' })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300)
    throw new Error(`Model catalog request failed (${response.status}): ${detail}`)
  }
  const payload = (await response.json()) as {
    data?: Array<{ id?: string; name?: string; display_name?: string }>
    models?: Array<{ id?: string; name?: string; displayName?: string }>
  }
  const entries = payload.data ?? payload.models ?? []
  return Array.from(
    new Map(
      entries
        .map((item) => {
          const rawId = item.id ?? item.name
          if (!rawId) return null
          const id = rawId.replace(/^models\//, '')
          return [id, { id, name: item.display_name ?? item.displayName ?? id }] as const
        })
        .filter((item): item is readonly [string, { id: string; name: string }] => item !== null),
    ).values(),
  ).sort((a, b) => a.id.localeCompare(b.id))
}

api.onError((error, c) => {
  logger.error(error)
  return c.json(
    {
      error: error.message,
      stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
    },
    500,
  )
})

api.doc('/openapi.json', {
  openapi: '3.0.0',
  info: {
    title: 'Pi Studio API',
    version: '0.1.0',
  },
})

api.openapi(
  createRoute({
    method: 'get',
    path: '/model-providers/{id}/available-models',
    tags: ['Models'],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: json(z.array(z.object({ id: z.string(), name: z.string() }))),
      404: json(ErrorSchema),
      502: json(ErrorSchema),
    },
  }),
  async (c) => {
    try {
      const models = await fetchProviderModelCatalog(c.req.valid('param').id)
      if (!models) return c.json({ error: 'Provider not found' }, 404)
      return c.json(models)
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unable to load models.' },
        502,
      )
    }
  },
)

const LogFileSchema = z.object({
  name: z.enum(['server.log', 'main.log']),
  path: z.string(),
  size: z.number(),
  content: z.string(),
  truncated: z.boolean(),
})

const LogSnapshotSchema = z.object({
  files: z.array(LogFileSchema),
  totalSize: z.number(),
})

api.openapi(
  createRoute({
    method: 'get',
    path: '/settings/logging/output',
    tags: ['System'],
    responses: { 200: json(LogSnapshotSchema) },
  }),
  async (c) => c.json(await readApplicationLogs()),
)

api.openapi(
  createRoute({
    method: 'delete',
    path: '/settings/logging/output',
    tags: ['System'],
    responses: { 200: json(z.object({ cleared: z.number() })) },
  }),
  async (c) => c.json(await clearApplicationLogs()),
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/packages/gallery',
    tags: ['Packages'],
    request: { query: PiPackageCatalogQuerySchema },
    responses: { 200: json(PiPackageCatalogSchema) },
  }),
  async (c) => c.json(await loadPiPackageCatalog(c.req.valid('query'))),
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/health',
    tags: ['System'],
    responses: { 200: json(z.object({ ok: z.boolean() })) },
  }),
  (c) => c.json({ ok: true }),
)

const LoggingSettingsSchema = z.object({
  level: z.enum(LOG_LEVELS),
  logDirectory: z.string(),
})

api.openapi(
  createRoute({
    method: 'get',
    path: '/settings/logging',
    tags: ['System'],
    responses: { 200: json(LoggingSettingsSchema) },
  }),
  (c) => c.json({ level: getAppSettings().logLevel, logDirectory: piStudioDataDir() }),
)

const MetricIdSchema = z.enum(METRIC_IDS)
const MetricRangeSchema = z.enum(METRIC_RANGES)
const MetricsDetailLevelSchema = z.enum(METRICS_DETAIL_LEVELS)
const MetricsIntervalSchema = z.union(METRICS_INTERVAL_SECONDS.map((value) => z.literal(value)))
const MetricsRetentionSchema = z.union(METRICS_RETENTION_DAYS.map((value) => z.literal(value)))

const MetricsSettingsSchema = z
  .object({
    enabled: z.boolean(),
    detailLevel: MetricsDetailLevelSchema,
    intervalSeconds: MetricsIntervalSchema,
    retentionDays: MetricsRetentionSchema,
    enabledMetricIds: z
      .array(MetricIdSchema)
      .max(METRIC_IDS.length)
      .refine((items) => new Set(items).size === items.length, 'Metric IDs must be unique.'),
    intervalOverrides: z.record(z.string(), MetricsIntervalSchema),
    diagnosticUntil: z.string().datetime().nullable(),
  })
  .strict()
  .superRefine((settings, context) => {
    for (const [metricId, interval] of Object.entries(settings.intervalOverrides)) {
      if (!isMetricId(metricId)) {
        context.addIssue({
          code: 'custom',
          path: ['intervalOverrides', metricId],
          message: 'Unknown metric ID.',
        })
        continue
      }
      const definition = METRIC_DEFINITIONS.get(metricId)
      if (definition?.kind !== 'gauge' && definition?.kind !== 'snapshot') {
        context.addIssue({
          code: 'custom',
          path: ['intervalOverrides', metricId],
          message: 'Only gauges and snapshots support sampling overrides.',
        })
        continue
      }
      const minimum = definition.minimumIntervalSeconds
      if (minimum && interval < minimum) {
        context.addIssue({
          code: 'custom',
          path: ['intervalOverrides', metricId],
          message: `This metric cannot be sampled faster than every ${minimum} seconds.`,
        })
      }
    }
    if (settings.detailLevel === 'diagnostic' && !settings.diagnosticUntil) {
      context.addIssue({
        code: 'custom',
        path: ['diagnosticUntil'],
        message: 'Diagnostic collection requires an expiration time.',
      })
    }
  })

const MetricDefinitionSchema = z.object({
  id: MetricIdSchema,
  label: z.string(),
  description: z.string(),
  group: z.enum(['resources', 'api', 'runs', 'usage', 'scheduler', 'storage']),
  kind: z.enum(['gauge', 'event', 'snapshot', 'derived']),
  unit: z.enum(['percent', 'bytes', 'milliseconds', 'seconds', 'count', 'tokens', 'currency']),
  minimumDetailLevel: z.enum(['essential', 'standard', 'diagnostic']),
  minimumIntervalSeconds: MetricsIntervalSchema.optional(),
  supportsSeries: z.boolean(),
})

const MetricWarningSchema = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string(),
  severity: z.enum(['warning', 'critical']),
})

const NullableNumberSchema = z.number().nullable()

const MetricsSummarySchema = z.object({
  generatedAt: z.string(),
  range: MetricRangeSchema,
  health: z.enum(['healthy', 'degraded', 'critical', 'disabled', 'warming']),
  lastSampleAt: z.string().nullable(),
  sampleCount: z.number(),
  runtime: z.object({
    uptimeSeconds: z.number(),
    cpuPercent: NullableNumberSchema,
    rssBytes: NullableNumberSchema,
    heapBytes: NullableNumberSchema,
    eventLoopLagMs: NullableNumberSchema,
  }),
  api: z.object({
    requests: z.number(),
    errorRate: NullableNumberSchema,
    p95LatencyMs: NullableNumberSchema,
  }),
  runs: z.object({
    queued: z.number(),
    active: z.number(),
    completed: z.number(),
    failed: z.number(),
    aborted: z.number(),
    successRate: NullableNumberSchema,
    averageDurationMs: NullableNumberSchema,
    p95DurationMs: NullableNumberSchema,
    p95TimeToFirstResponseMs: NullableNumberSchema,
  }),
  usage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number(),
    cacheWriteTokens: z.number(),
    totalTokens: z.number(),
    cost: z.number(),
    cacheHitRate: NullableNumberSchema,
  }),
  scheduler: z.object({ total: z.number(), failed: z.number() }),
  warnings: z.array(MetricWarningSchema),
})

const MetricSeriesSchema = z.object({
  metricId: MetricIdSchema,
  range: MetricRangeSchema,
  points: z.array(z.object({ timestamp: z.string(), value: z.number() })),
})

api.openapi(
  createRoute({
    method: 'get',
    path: '/settings/metrics',
    tags: ['System'],
    responses: {
      200: json(
        z.object({ settings: MetricsSettingsSchema, catalog: z.array(MetricDefinitionSchema) }),
      ),
    },
  }),
  (c) => c.json({ settings: getAppSettings().metrics, catalog: METRIC_CATALOG }),
)

api.openapi(
  createRoute({
    method: 'put',
    path: '/settings/metrics',
    tags: ['System'],
    request: { body: json(MetricsSettingsSchema) },
    responses: {
      200: json(
        z.object({ settings: MetricsSettingsSchema, catalog: z.array(MetricDefinitionSchema) }),
      ),
    },
  }),
  (c) => {
    const settings = updateAppSettings({ metrics: c.req.valid('json') }).metrics
    notifyMetricsSettingsChanged()
    logger.info(
      `Metrics collection changed to ${settings.enabled ? settings.detailLevel : 'disabled'}.`,
    )
    return c.json({ settings, catalog: METRIC_CATALOG })
  },
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/metrics/summary',
    tags: ['System'],
    request: { query: z.object({ range: MetricRangeSchema.default('24h') }) },
    responses: { 200: json(MetricsSummarySchema) },
  }),
  (c) => c.json(getMetricsSummary(c.req.valid('query').range)),
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/metrics/series',
    tags: ['System'],
    request: {
      query: z.object({ metricId: MetricIdSchema, range: MetricRangeSchema.default('24h') }),
    },
    responses: { 200: json(MetricSeriesSchema) },
  }),
  (c) => {
    const query = c.req.valid('query')
    return c.json(getMetricSeries(query.metricId, query.range))
  },
)

api.openapi(
  createRoute({
    method: 'delete',
    path: '/metrics/history',
    tags: ['System'],
    responses: { 200: json(z.object({ cleared: z.number() })) },
  }),
  (c) => c.json({ cleared: clearMetricHistory() }),
)

api.openapi(
  createRoute({
    method: 'put',
    path: '/settings/logging',
    tags: ['System'],
    request: { body: json(z.object({ level: z.enum(LOG_LEVELS) })) },
    responses: { 200: json(LoggingSettingsSchema) },
  }),
  (c) => {
    const settings = updateAppSettings({ logLevel: c.req.valid('json').level })
    logger.info(`Log level changed to ${settings.logLevel}.`)
    return c.json({ level: settings.logLevel, logDirectory: piStudioDataDir() })
  },
)

function scheduledTaskRunConfigError(input: {
  agentId: string
  providerId?: string
  modelId?: string
}) {
  if (!input.providerId && !input.modelId) return null
  const config = resolveAgentRunConfig(input.agentId, input.providerId)
  if (config?.provider?.id !== input.providerId) {
    return 'Selected provider is not enabled for this agent.'
  }
  if (!config.provider.models.some((model) => model.id === input.modelId)) {
    return 'Selected model is not enabled for this agent.'
  }
  return null
}

// Unified session event stream. One connection per session carries the running
// state (first frame + activity_start/activity_end) and the forwarded SDK
// events. The controller lives in a session-scoped registry independent of the
// SDK session lifecycle, so this endpoint works even before the first prompt
// creates an AgentSession. `Last-Event-ID` replays buffered frames after a
// same-process reconnect.
api.get('/sessions/:id/events', async (c) => {
  const sessionId = c.req.param('id')
  const controller = getSessionRunController(sessionId)
  const afterSequence = parseLastEventId(c.req.header('Last-Event-ID'))

  return streamSSE(c, async (stream) => {
    const queue: import('@/lib/chat/session-run-controller').SequencedFrame[] = []
    let aborted = false
    let wake: (() => void) | null = null
    let lastSent = afterSequence
    const notify = () => {
      wake?.()
      wake = null
    }

    const writeFrame = async (
      entry: import('@/lib/chat/session-run-controller').SequencedFrame,
    ) => {
      // De-dupe: replay and live delivery can overlap around subscribe time.
      if (entry.sequence <= lastSent) return
      lastSent = entry.sequence
      await stream.writeSSE({
        id: String(entry.sequence),
        event: 'frame',
        data: JSON.stringify(entry.frame),
      })
    }

    // Subscribe first so no frame emitted during replay is lost; the queue and
    // the replay both flow through writeFrame's sequence de-dupe.
    const unsubscribe = controller.subscribe((entry) => {
      queue.push(entry)
      notify()
    })

    // Replay buffered frames the client missed (same-process reconnect).
    for (const entry of controller.bufferedFrames(afterSequence)) {
      await writeFrame(entry)
    }

    // A state frame so a fresh client (or one whose buffer was pruned)
    // immediately knows idle vs running, regardless of replay contents.
    await stream.writeSSE({
      event: 'state',
      data: JSON.stringify(controller.stateFrame()),
    })

    stream.onAbort(() => {
      aborted = true
      notify()
    })
    const heartbeat = setInterval(() => {
      void stream.write(`: heartbeat ${Date.now()}\n\n`)
    }, 30000)

    try {
      while (!aborted) {
        while (!aborted && queue.length > 0) {
          const entry = queue.shift()
          if (entry) await writeFrame(entry)
        }
        if (aborted) break
        await new Promise<void>((resolve) => {
          wake = resolve
          if (aborted || queue.length > 0) {
            wake = null
            resolve()
          }
        })
      }
    } finally {
      clearInterval(heartbeat)
      unsubscribe()
    }
  })
})

for (const behavior of ['steer', 'follow-up'] as const) {
  api.openapi(
    createRoute({
      method: 'post',
      path: `/sessions/{id}/${behavior}`,
      tags: ['Chat'],
      request: {
        params: z.object({ id: z.string() }),
        body: json(AgentQueueMessageSchema),
      },
      responses: {
        200: json(z.object({ ok: z.boolean() })),
        409: json(ErrorSchema),
      },
    }),
    async (c) => {
      const { followUpSdkSession, steerSdkSession } = await import('@/lib/chat/sdk-session-manager')
      const id = c.req.valid('param').id
      const { message } = c.req.valid('json')
      const ok =
        behavior === 'steer'
          ? await steerSdkSession(id, message)
          : await followUpSdkSession(id, message)
      if (!ok) return c.json({ error: 'Agent session is not active or has already finished.' }, 409)
      return c.json({ ok: true })
    },
  )
}

api.openapi(
  createRoute({
    method: 'post',
    path: '/sessions/{id}/abort',
    tags: ['Chat'],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: json(z.object({ ok: z.boolean() })),
      409: json(ErrorSchema),
    },
  }),
  async (c) => {
    const { abortSdkSession } = await import('@/lib/chat/sdk-session-manager')
    const id = c.req.valid('param').id
    // The controller owns the running truth: aborting stops the live SDK activity
    // and marks the chatRuns row aborted. Idempotent when nothing is running.
    await abortSdkSession(id)
    return c.json({ ok: true })
  },
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/agents',
    tags: ['Agents'],
    responses: { 200: json(z.array(AgentSchema)) },
  }),
  (c) => c.json(listAgents()),
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/agents',
    tags: ['Agents'],
    request: { body: json(AgentInputSchema) },
    responses: { 200: json(AgentSchema), 400: json(ErrorSchema) },
  }),
  async (c) => {
    const agent = createAgent(c.req.valid('json'))
    if (!agent) return c.json({ error: 'Unable to create agent' }, 400)
    return c.json(agent)
  },
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/agents/{id}',
    tags: ['Agents'],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: json(AgentSchema), 404: json(ErrorSchema) },
  }),
  async (c) => {
    const agent = getAgent(c.req.valid('param').id)
    if (!agent) return c.json({ error: 'Agent not found' }, 404)
    return c.json(agent)
  },
)

api.openapi(
  createRoute({
    method: 'patch',
    path: '/agents/{id}',
    tags: ['Agents'],
    request: {
      params: z.object({ id: z.string() }),
      body: json(AgentInputSchema.partial()),
    },
    responses: { 200: json(AgentSchema), 404: json(ErrorSchema) },
  }),
  async (c) => {
    const agent = updateAgent(c.req.valid('param').id, c.req.valid('json'))
    if (!agent) return c.json({ error: 'Agent not found' }, 404)
    return c.json(agent)
  },
)

api.openapi(
  createRoute({
    method: 'patch',
    path: '/sessions/{id}',
    tags: ['Sessions'],
    request: {
      params: z.object({ id: z.string() }),
      body: json(UpdateSessionSchema),
    },
    responses: { 200: json(SessionSchema), 404: json(ErrorSchema) },
  }),
  (c) => {
    const session = updateSession(c.req.valid('param').id, c.req.valid('json'))
    if (!session) return c.json({ error: 'Session not found' }, 404)
    return c.json(session)
  },
)

api.openapi(
  createRoute({
    method: 'delete',
    path: '/agents/{id}',
    tags: ['Agents'],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: json(z.object({ ok: z.boolean() })) },
  }),
  (c) => {
    deleteAgent(c.req.valid('param').id)
    return c.json({ ok: true })
  },
)

api.openapi(
  createRoute({
    method: 'patch',
    path: '/sessions/{id}/composer',
    tags: ['Sessions'],
    request: {
      params: z.object({ id: z.string() }),
      body: json(UpdateSessionComposerSchema),
    },
    responses: { 200: json(SessionSchema), 404: json(ErrorSchema) },
  }),
  (c) => {
    const session = updateSessionComposerConfig(c.req.valid('param').id, c.req.valid('json'))
    if (!session) return c.json({ error: 'Session not found' }, 404)
    return c.json(session)
  },
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/agents/{id}/duplicate',
    tags: ['Agents'],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: json(AgentSchema), 404: json(ErrorSchema) },
  }),
  (c) => {
    const agent = duplicateAgent(c.req.valid('param').id)
    if (!agent) return c.json({ error: 'Agent not found' }, 404)
    return c.json(agent)
  },
)

api.openapi(
  createRoute({
    method: 'patch',
    path: '/agents/{id}/resources',
    tags: ['Agents'],
    request: {
      params: z.object({ id: z.string() }),
      body: json(AgentResourcesSchema),
    },
    responses: { 200: json(AgentSchema), 404: json(ErrorSchema) },
  }),
  (c) => {
    const agent = updateAgentResources(c.req.valid('param').id, c.req.valid('json'))
    if (!agent) return c.json({ error: 'Agent not found' }, 404)
    return c.json(agent)
  },
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/skills',
    tags: ['Skills'],
    responses: { 200: json(z.array(SkillSchema)) },
  }),
  (c) => c.json(listSkills()),
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/skills',
    tags: ['Skills'],
    request: { body: json(SkillInputSchema) },
    responses: { 200: json(SkillSchema), 400: json(ErrorSchema) },
  }),
  async (c) => {
    const input = c.req.valid('json')
    // `skill` is an install-time selector (CLI `--skill`), not a stored column.
    const { skill: skillSelector, ...skillInput } = input
    // skills.sh and git/GitHub sources are both fetched via the `skills` CLI;
    // git sources may additionally target one skill inside a multi-skill repo.
    if (!input.id && (input.source === 'skills.sh' || input.source === 'git')) {
      let installError: unknown = null
      try {
        await installSkillPackage(input.path, { skill: skillSelector })
      } catch (error) {
        installError = error
      }
      try {
        // The CLI writes the installed dir under the skill's own name; with a
        // `--skill` selector that's the selector, otherwise fall back to name.
        skillInput.path = materializeInstalledSkill(skillSelector || input.name)
      } catch (materializeError) {
        return c.json(
          {
            error:
              installError instanceof Error
                ? installError.message
                : materializeError instanceof Error
                  ? materializeError.message
                  : `Unable to install ${input.source} package`,
          },
          400,
        )
      }
    }

    const skill = upsertSkill(skillInput)
    if (!skill) return c.json({ error: 'Unable to create skill' }, 400)
    return c.json(skill)
  },
)

api.openapi(
  createRoute({
    method: 'delete',
    path: '/skills/{id}',
    tags: ['Skills'],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: json(z.object({ ok: z.boolean() })) },
  }),
  async (c) => {
    const id = c.req.valid('param').id
    const skill = listSkills().find((item) => item.id === id)
    if (!skill) return c.json({ error: 'Skill not found' }, 404)
    removeStoredSkill(skill)
    deleteSkill(id)
    return c.json({ ok: true })
  },
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/skills/registry/search',
    tags: ['Skills'],
    request: { query: z.object({ q: z.string().optional() }) },
    responses: {
      200: json(z.array(SkillRegistryItemSchema)),
      502: json(ErrorSchema),
    },
  }),
  async (c) => {
    const query = c.req.valid('query').q ?? ''
    const installedSkills = listSkills()
    const installedKeys = new Set(
      installedSkills
        .filter((skill) => skill.source === 'skills.sh')
        .flatMap((skill) => [
          normalizeRegistryKey(skill.name),
          normalizeRegistryKey(skill.path.replace(/^skills\.sh\//, '')),
          normalizeRegistryKey(skill.path),
        ]),
    )
    try {
      const externalSkills = await fetchSkillsShRegistry(query)
      const items = externalSkills.map((skill) => {
        const source = skill.source || skill.id
        const installed =
          installedKeys.has(normalizeRegistryKey(skill.id)) ||
          installedKeys.has(normalizeRegistryKey(skill.name)) ||
          installedKeys.has(normalizeRegistryKey(source)) ||
          installedKeys.has(normalizeRegistryKey(`skills.sh/${skill.id}`)) ||
          installedKeys.has(normalizeRegistryKey(`skills.sh/${skill.name}`))

        return {
          id: skill.id,
          name: skill.name,
          author: skill.author,
          description: skill.description,
          tags: skill.tags,
          installed,
          source,
          sourceType: skill.sourceType,
          installUrl: skill.installUrl,
          url: skill.url,
          installs: skill.installs,
        }
      })

      return c.json(items)
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : 'Unable to load skills.sh registry',
        },
        502,
      )
    }
  },
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/prompts',
    tags: ['Prompts'],
    responses: { 200: json(z.array(PromptSchema)) },
  }),
  (c) => c.json(listPrompts()),
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/prompts',
    tags: ['Prompts'],
    request: { body: json(PromptInputSchema) },
    responses: { 200: json(PromptSchema), 400: json(ErrorSchema) },
  }),
  (c) => {
    try {
      const prompt = upsertPrompt(c.req.valid('json'))
      if (!prompt) return c.json({ error: 'Unable to save prompt' }, 400)
      return c.json(prompt)
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unable to save prompt' },
        400,
      )
    }
  },
)

api.openapi(
  createRoute({
    method: 'delete',
    path: '/prompts/{id}',
    tags: ['Prompts'],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: json(z.object({ ok: z.boolean() })) },
  }),
  (c) => {
    deletePrompt(c.req.valid('param').id)
    return c.json({ ok: true })
  },
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/model-providers',
    tags: ['Models'],
    responses: { 200: json(z.array(ProviderSchema)) },
  }),
  (c) => c.json(listProviders()),
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/model-providers',
    tags: ['Models'],
    request: { body: json(ProviderInputSchema) },
    responses: { 200: json(ProviderSchema), 400: json(ErrorSchema) },
  }),
  (c) => {
    const provider = upsertProvider(c.req.valid('json'))
    if (!provider) return c.json({ error: 'Unable to save provider' }, 400)
    return c.json(provider)
  },
)

api.openapi(
  createRoute({
    method: 'delete',
    path: '/model-providers/{id}',
    tags: ['Models'],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: json(z.object({ ok: z.boolean() })) },
  }),
  (c) => {
    deleteProvider(c.req.valid('param').id)
    return c.json({ ok: true })
  },
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/model-providers/{id}/models',
    tags: ['Models'],
    request: {
      params: z.object({ id: z.string() }),
      body: json(ModelInputSchema),
    },
    responses: {
      200: json(ProviderSchema),
      404: json(ErrorSchema),
      409: json(ErrorSchema),
    },
  }),
  (c) => {
    try {
      const provider = upsertModel(c.req.valid('param').id, c.req.valid('json'))
      if (!provider) return c.json({ error: 'Provider not found' }, 404)
      return c.json(provider)
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unable to update model.' },
        409,
      )
    }
  },
)

api.openapi(
  createRoute({
    method: 'delete',
    path: '/models/{id}',
    tags: ['Models'],
    request: {
      params: z.object({ id: z.string() }),
      query: z.object({ providerId: z.string() }),
    },
    responses: { 200: json(ProviderSchema), 404: json(ErrorSchema) },
  }),
  (c) => {
    const provider = deleteModel(c.req.valid('query').providerId, c.req.valid('param').id)
    if (!provider) return c.json({ error: 'Model not found' }, 404)
    return c.json(provider)
  },
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/model-providers/{providerId}/models/{modelId}/capabilities',
    tags: ['Models'],
    request: {
      params: z.object({ providerId: z.string(), modelId: z.string() }),
    },
    responses: {
      200: json(ModelCapabilitiesSchema),
      404: json(ErrorSchema),
    },
  }),
  async (c) => {
    const { providerId, modelId } = c.req.valid('param')
    const capabilities = await getModelCapabilities(providerId, modelId)
    if (!capabilities) return c.json({ error: 'Model not found' }, 404)
    return c.json(capabilities)
  },
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/model-providers/{id}/default',
    tags: ['Models'],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: json(ProviderSchema), 404: json(ErrorSchema) },
  }),
  (c) => {
    const provider = setDefaultProvider(c.req.valid('param').id)
    if (!provider) return c.json({ error: 'Provider not found' }, 404)
    return c.json(provider)
  },
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/model-providers/{id}/test',
    tags: ['Models'],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: json(ProviderTestResultSchema), 404: json(ErrorSchema) },
  }),
  async (c) => {
    const result = await testProviderConnection(c.req.valid('param').id)
    if (!result) return c.json({ error: 'Provider not found' }, 404)
    return c.json(result)
  },
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/packages',
    tags: ['Packages'],
    responses: {
      200: json(PackageCollectionSchema),
    },
  }),
  async (c) => {
    return c.json(await runtimePackageCollection(process.cwd()))
  },
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/extensions',
    tags: ['Extensions'],
    request: { query: ExtensionListQuerySchema },
    responses: { 200: json(z.array(ExtensionSchema)) },
  }),
  async (c) => {
    const query = c.req.valid('query')
    const extensionService = await import('@/lib/extensions/extension-service')
    try {
      const extensions = await extensionService.listExtensionsWithRuntime(
        query.cwd ?? process.cwd(),
      )
      return c.json(
        query.scope && query.scope !== 'effective'
          ? extensions.filter((extension) => extension.scope === query.scope)
          : extensions,
      )
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unable to list extensions.' },
        400,
      )
    }
  },
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/extensions/workspaces',
    tags: ['Extensions'],
    responses: { 200: json(z.array(ExtensionWorkspaceSchema)) },
  }),
  async (c) => {
    const { listExtensionWorkspaces } = await import('@/lib/extensions/workspaces')
    return c.json(listExtensionWorkspaces())
  },
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/extensions/trust',
    tags: ['Extensions'],
    request: { query: z.object({ cwd: z.string() }) },
    responses: { 200: json(ProjectTrustStateSchema), 400: json(ErrorSchema) },
  }),
  async (c) => {
    try {
      const { assertExtensionWorkspace } = await import('@/lib/extensions/workspaces')
      const { getProjectTrustState } = await import('@/lib/extensions/project-trust')
      return c.json(getProjectTrustState(assertExtensionWorkspace(c.req.valid('query').cwd)))
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unable to read project trust.' },
        400,
      )
    }
  },
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/extensions/trust',
    tags: ['Extensions'],
    request: { body: json(ProjectTrustInputSchema) },
    responses: { 200: json(ProjectTrustStateSchema), 400: json(ErrorSchema) },
  }),
  async (c) => {
    try {
      const input = c.req.valid('json')
      const { assertExtensionWorkspace } = await import('@/lib/extensions/workspaces')
      const { setProjectTrust } = await import('@/lib/extensions/project-trust')
      const cwd = assertExtensionWorkspace(input.cwd)
      const state = setProjectTrust(cwd, input.decision)
      const { reloadSdkSessions } = await import('@/lib/chat/sdk-session-manager')
      await reloadSdkSessions({ cwd, mode: 'idle-only' })
      return c.json(state)
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unable to update project trust.' },
        400,
      )
    }
  },
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/extensions/{id}',
    tags: ['Extensions'],
    request: {
      params: z.object({ id: z.string() }),
      query: z.object({ cwd: z.string() }),
    },
    responses: { 200: json(ExtensionSchema), 404: json(ErrorSchema) },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const { cwd } = c.req.valid('query')
    const { listExtensionsWithRuntime } = await import('@/lib/extensions/extension-service')
    const extension = (await listExtensionsWithRuntime(cwd)).find((item) => item.id === id)
    return extension ? c.json(extension) : c.json({ error: 'Extension not found.' }, 404)
  },
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/extensions/{id}/diagnostics',
    tags: ['Extensions'],
    request: {
      params: z.object({ id: z.string() }),
      query: z.object({ cwd: z.string() }),
    },
    responses: { 200: json(z.array(ExtensionDiagnosticSchema)), 404: json(ErrorSchema) },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const { cwd } = c.req.valid('query')
    const { listExtensionsWithRuntime } = await import('@/lib/extensions/extension-service')
    const extension = (await listExtensionsWithRuntime(cwd)).find((item) => item.id === id)
    if (!extension) return c.json({ error: 'Extension not found.' }, 404)
    const runtime = await import('@/lib/chat/sdk-session-manager')
    return c.json(
      runtime
        .listSdkExtensionDiagnostics(cwd)
        .filter(
          (diagnostic) =>
            diagnostic.extensionPath &&
            resolve(diagnostic.extensionPath) === resolve(extension.path),
        ),
    )
  },
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/extensions/{id}/source',
    tags: ['Extensions'],
    request: {
      params: z.object({ id: z.string() }),
      query: z.object({ cwd: z.string() }),
    },
    responses: { 200: json(ExtensionSourceSchema), 400: json(ErrorSchema), 404: json(ErrorSchema) },
  }),
  async (c) => {
    try {
      const { getExtensionSource } = await import('@/lib/extensions/extension-service')
      return c.json(await getExtensionSource(c.req.valid('param').id, c.req.valid('query').cwd))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to read extension source.'
      return c.json({ error: message }, /not found/i.test(message) ? 404 : 400)
    }
  },
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/extensions/create',
    tags: ['Extensions'],
    request: { body: json(CreateExtensionSchema) },
    responses: { 200: json(ExtensionSchema), 400: json(ErrorSchema) },
  }),
  async (c) => {
    try {
      const { createLocalExtension } = await import('@/lib/extensions/extension-service')
      return c.json(await createLocalExtension(c.req.valid('json')))
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unable to create extension.' },
        400,
      )
    }
  },
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/extensions/{id}/files',
    tags: ['Extensions'],
    request: {
      params: z.object({ id: z.string() }),
      query: z.object({ cwd: z.string() }),
    },
    responses: { 200: json(z.array(ExtensionFileSchema)), 400: json(ErrorSchema) },
  }),
  async (c) => {
    try {
      const { listExtensionFiles } = await import('@/lib/extensions/extension-service')
      return c.json(await listExtensionFiles(c.req.valid('param').id, c.req.valid('query').cwd))
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unable to list extension files.' },
        400,
      )
    }
  },
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/extensions/{id}/files/content',
    tags: ['Extensions'],
    request: { params: z.object({ id: z.string() }), query: ExtensionFileQuerySchema },
    responses: { 200: json(ExtensionFileContentSchema), 400: json(ErrorSchema) },
  }),
  async (c) => {
    try {
      const { readExtensionFile } = await import('@/lib/extensions/extension-service')
      const query = c.req.valid('query')
      return c.json(await readExtensionFile(c.req.valid('param').id, query.cwd, query.path))
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unable to read extension file.' },
        400,
      )
    }
  },
)

api.openapi(
  createRoute({
    method: 'put',
    path: '/extensions/{id}/files/content',
    tags: ['Extensions'],
    request: {
      params: z.object({ id: z.string() }),
      query: z.object({ cwd: z.string() }),
      body: json(ExtensionFileContentSchema),
    },
    responses: { 200: json(ExtensionFileContentSchema), 400: json(ErrorSchema) },
  }),
  async (c) => {
    try {
      const { writeExtensionFile } = await import('@/lib/extensions/extension-service')
      const input = c.req.valid('json')
      return c.json(
        await writeExtensionFile(
          c.req.valid('param').id,
          c.req.valid('query').cwd,
          input.path,
          input.content,
        ),
      )
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unable to save extension file.' },
        400,
      )
    }
  },
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/extensions/{id}/validate',
    tags: ['Extensions'],
    request: {
      params: z.object({ id: z.string() }),
      query: z.object({ cwd: z.string() }),
    },
    responses: { 200: json(ExtensionValidationSchema), 400: json(ErrorSchema) },
  }),
  async (c) => {
    try {
      const { validateLocalExtension } = await import('@/lib/extensions/extension-service')
      return c.json(await validateLocalExtension(c.req.valid('param').id, c.req.valid('query').cwd))
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unable to validate extension.' },
        400,
      )
    }
  },
)

api.openapi(
  createRoute({
    method: 'delete',
    path: '/extensions/{id}',
    tags: ['Extensions'],
    request: {
      params: z.object({ id: z.string() }),
      query: z.object({ cwd: z.string() }),
    },
    responses: { 200: json(z.object({ deleted: z.boolean() })), 400: json(ErrorSchema) },
  }),
  async (c) => {
    try {
      const { deleteLocalExtension } = await import('@/lib/extensions/extension-service')
      return c.json(await deleteLocalExtension(c.req.valid('param').id, c.req.valid('query').cwd))
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unable to delete extension.' },
        400,
      )
    }
  },
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/extensions/reload',
    tags: ['Extensions'],
    request: { body: json(ExtensionReloadSchema) },
    responses: { 200: json(z.array(ExtensionReloadResultSchema)) },
  }),
  async (c) => {
    const runtime = await import('@/lib/chat/sdk-session-manager')
    return c.json(await runtime.reloadSdkSessions(c.req.valid('json')))
  },
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/sessions/{id}/extensions',
    tags: ['Extensions'],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: json(SessionExtensionSnapshotSchema), 404: json(ErrorSchema) },
  }),
  async (c) => {
    const runtime = await import('@/lib/chat/sdk-session-manager')
    const snapshot = runtime.getSdkSessionExtensions(c.req.valid('param').id)
    return snapshot ? c.json(snapshot) : c.json({ error: 'SDK session is not active.' }, 404)
  },
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/sessions/{id}/extensions/diagnostics',
    tags: ['Extensions'],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: json(z.array(ExtensionDiagnosticSchema)), 404: json(ErrorSchema) },
  }),
  async (c) => {
    const runtime = await import('@/lib/chat/sdk-session-manager')
    const diagnostics = runtime.getSdkSessionExtensionDiagnostics(c.req.valid('param').id)
    return diagnostics ? c.json(diagnostics) : c.json({ error: 'SDK session is not active.' }, 404)
  },
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/sessions/{id}/extensions/commands/{command}',
    tags: ['Extensions'],
    request: {
      params: z.object({ id: z.string(), command: z.string() }),
      body: json(z.object({ args: z.string().optional() })),
    },
    responses: {
      200: json(
        z.object({
          status: z.enum([
            'completed',
            'failed',
            'session-not-active',
            'session-running',
            'command-not-found',
          ]),
          error: z.string().optional(),
        }),
      ),
    },
  }),
  async (c) => {
    const runtime = await import('@/lib/chat/sdk-session-manager')
    const params = c.req.valid('param')
    return c.json(
      await runtime.executeSdkExtensionCommand(
        params.id,
        params.command,
        c.req.valid('json').args ?? '',
      ),
    )
  },
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/sessions/{id}/extensions/ui',
    tags: ['Extensions'],
    request: {
      params: z.object({ id: z.string() }),
      query: z.object({ afterNotification: z.coerce.number().int().nonnegative().optional() }),
    },
    responses: { 200: json(ExtensionUiSnapshotSchema), 404: json(ErrorSchema) },
  }),
  async (c) => {
    const runtime = await import('@/lib/chat/sdk-session-manager')
    const snapshot = runtime.getSdkSessionExtensionUi(
      c.req.valid('param').id,
      c.req.valid('query').afterNotification ?? 0,
    )
    return snapshot ? c.json(snapshot) : c.json({ error: 'SDK session is not active.' }, 404)
  },
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/sessions/{id}/extensions/ui/respond',
    tags: ['Extensions'],
    request: {
      params: z.object({ id: z.string() }),
      body: json(ExtensionUiResponseSchema),
    },
    responses: { 200: json(z.object({ accepted: z.boolean() })), 404: json(ErrorSchema) },
  }),
  async (c) => {
    const runtime = await import('@/lib/chat/sdk-session-manager')
    const input = c.req.valid('json')
    const accepted = runtime.respondToSdkSessionExtensionUi(
      c.req.valid('param').id,
      input.interactionId,
      input.value,
      input.cancelled,
    )
    return accepted ? c.json({ accepted }) : c.json({ error: 'Interaction not found.' }, 404)
  },
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/extensions/{id}/state',
    tags: ['Extensions'],
    request: {
      params: z.object({ id: z.string() }),
      body: json(ExtensionStateSchema),
    },
    responses: {
      200: json(z.array(ExtensionSchema)),
      400: json(ErrorSchema),
      404: json(ErrorSchema),
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const input = c.req.valid('json')
    const extensionService = await import('@/lib/packages/package-service')
    try {
      const { assertExtensionWorkspace } = await import('@/lib/extensions/workspaces')
      const cwd = assertExtensionWorkspace(input.cwd ?? process.cwd())
      await extensionService.setRuntimeExtensionState({ id, enabled: input.enabled, cwd })
      const { listExtensionsWithRuntime } = await import('@/lib/extensions/extension-service')
      return c.json(await listExtensionsWithRuntime(cwd))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update extension.'
      return c.json({ error: message }, /not found/i.test(message) ? 404 : 400)
    }
  },
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/extensions/toggle',
    tags: ['Extensions'],
    request: { body: json(ToggleExtensionSchema) },
    responses: { 200: json(z.array(ExtensionSchema)) },
  }),
  async (c) => {
    const input = c.req.valid('json')
    const extensionService = await import('@/lib/packages/package-service')
    const { assertExtensionWorkspace } = await import('@/lib/extensions/workspaces')
    const cwd = assertExtensionWorkspace(input.cwd ?? process.cwd())
    await extensionService.setRuntimeExtensionEnabled({ ...input, cwd })
    const { listExtensionsWithRuntime } = await import('@/lib/extensions/extension-service')
    return c.json(await listExtensionsWithRuntime(cwd))
  },
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/packages',
    tags: ['Packages'],
    request: { body: json(InstallPackageSchema) },
    responses: { 200: json(PackageCollectionSchema) },
  }),
  async (c) => {
    const input = c.req.valid('json')
    const packageService = await import('@/lib/packages/package-service')
    const cwd = input.cwd ?? process.cwd()
    await packageService.installRuntimePackage({
      source: input.source,
      scope: input.scope,
      cwd,
    })
    return c.json(await runtimePackageCollection(cwd))
  },
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/packages/{id}/install',
    tags: ['Packages'],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: json(PackageCollectionSchema), 404: json(ErrorSchema) },
  }),
  async (c) => {
    const id = c.req.valid('param').id
    const packageService = await import('@/lib/packages/package-service')
    const decoded = packageService.decodePackageId(id)
    const catalog = decoded ? null : getPackageCatalogItem(id)
    const target = decoded ?? (catalog ? { source: catalog.source, scope: catalog.scope } : null)
    if (!target) return c.json({ error: 'Package not found' }, 404)
    await packageService.installRuntimePackage({ ...target, cwd: process.cwd() })
    return c.json(await runtimePackageCollection(process.cwd()))
  },
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/packages/{id}/update',
    tags: ['Packages'],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: json(PackageCollectionSchema), 404: json(ErrorSchema) },
  }),
  async (c) => {
    const packageService = await import('@/lib/packages/package-service')
    const target = packageService.decodePackageId(c.req.valid('param').id)
    if (!target) return c.json({ error: 'Package not found' }, 404)
    await packageService.updateRuntimePackage({
      source: target.source,
      cwd: process.cwd(),
    })
    return c.json(await runtimePackageCollection(process.cwd()))
  },
)

api.openapi(
  createRoute({
    method: 'delete',
    path: '/packages/{id}',
    tags: ['Packages'],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: json(z.object({ ok: z.boolean() })) },
  }),
  async (c) => {
    const packageService = await import('@/lib/packages/package-service')
    const target = packageService.decodePackageId(c.req.valid('param').id)
    if (target) {
      await packageService.removeRuntimePackage({ ...target, cwd: process.cwd() })
    }
    return c.json({ ok: true })
  },
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/agents/{id}/assign',
    tags: ['Agents'],
    request: {
      params: z.object({ id: z.string() }),
      body: json(AssignToAgentSchema.omit({ agentId: true })),
    },
    responses: { 200: json(AgentSchema), 404: json(ErrorSchema) },
  }),
  async (c) => {
    const id = c.req.valid('param').id
    const body = c.req.valid('json')
    const agent = getAgent(id)
    if (!agent) return c.json({ error: 'Agent not found' }, 404)
    const toggle = (values: string[]) =>
      body.enabled
        ? Array.from(new Set([...values, body.resourceId]))
        : values.filter((value) => value !== body.resourceId)
    const packageService =
      body.kind === 'package' ? await import('@/lib/packages/package-service') : null
    const packageSource = packageService?.decodePackageId(body.resourceId)?.source
    if (body.kind === 'package' && !packageSource) {
      return c.json({ error: 'Package not found' }, 404)
    }
    const updated = updateAgentResources(id, {
      selectedExtensionIds:
        body.kind === 'extension' ? toggle(agent.selectedExtensionIds) : undefined,
      selectedPackageSources:
        body.kind === 'package' && packageSource
          ? body.enabled
            ? Array.from(new Set([...agent.selectedPackageSources, packageSource]))
            : agent.selectedPackageSources.filter((source) => source !== packageSource)
          : undefined,
      selectedSkillIds: body.kind === 'skill' ? toggle(agent.selectedSkillIds) : undefined,
      selectedPromptIds: body.kind === 'prompt' ? toggle(agent.selectedPromptIds) : undefined,
      selectedProviderIds: body.kind === 'provider' ? toggle(agent.selectedProviderIds) : undefined,
      selectedModelIds: body.kind === 'model' ? toggle(agent.selectedModelIds) : undefined,
      defaultProviderId: agent.defaultProviderId,
      defaultModelId: agent.defaultModelId,
      defaultThinkingLevel: agent.defaultThinkingLevel,
    })
    if (!updated) return c.json({ error: 'Agent not found' }, 404)
    return c.json(updated)
  },
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/sessions',
    tags: ['Sessions'],
    request: { query: z.object({ agentId: z.string().optional() }) },
    responses: { 200: json(z.array(SessionSchema)) },
  }),
  async (c) => {
    const { hydrateSessionSummariesFromSdk } = await import('@/lib/chat/session-branches')
    return c.json(
      hydrateSessionSummariesFromSdk(listSessions({ agentId: c.req.valid('query').agentId })),
    )
  },
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/scheduled-tasks',
    tags: ['Scheduled tasks'],
    responses: { 200: json(z.array(ScheduledTaskSchema)) },
  }),
  (c) => c.json(listScheduledTasks()),
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/scheduled-tasks',
    tags: ['Scheduled tasks'],
    request: { body: json(ScheduledTaskInputSchema) },
    responses: { 200: json(ScheduledTaskSchema), 400: json(ErrorSchema) },
  }),
  (c) => {
    const input = c.req.valid('json')
    const selectedSession = input.sessionId ? getSession(input.sessionId) : null
    if (input.sessionId && selectedSession?.agentId !== input.agentId) {
      return c.json({ error: 'Selected session does not belong to this agent.' }, 400)
    }
    const runConfigError = scheduledTaskRunConfigError(input)
    if (runConfigError) return c.json({ error: runConfigError }, 400)
    const task = createScheduledTask({
      ...input,
      nextRunAt: input.enabled ? (nextRunAt(input) ?? undefined) : undefined,
    })
    if (!task) return c.json({ error: 'Agent not found.' }, 400)
    return c.json(task)
  },
)

api.openapi(
  createRoute({
    method: 'patch',
    path: '/scheduled-tasks/{id}',
    tags: ['Scheduled tasks'],
    request: {
      params: z.object({ id: z.string() }),
      body: json(ScheduledTaskInputSchema),
    },
    responses: {
      200: json(ScheduledTaskSchema),
      400: json(ErrorSchema),
      404: json(ErrorSchema),
    },
  }),
  (c) => {
    const input = c.req.valid('json')
    const selectedSession = input.sessionId ? getSession(input.sessionId) : null
    if (input.sessionId && selectedSession?.agentId !== input.agentId) {
      return c.json({ error: 'Selected session does not belong to this agent.' }, 400)
    }
    const runConfigError = scheduledTaskRunConfigError(input)
    if (runConfigError) return c.json({ error: runConfigError }, 400)
    const task = updateScheduledTask(c.req.valid('param').id, {
      ...input,
      nextRunAt: input.enabled ? nextRunAt(input) : null,
    })
    if (!task) return c.json({ error: 'Scheduled task not found.' }, 404)
    return c.json(task)
  },
)

api.openapi(
  createRoute({
    method: 'delete',
    path: '/scheduled-tasks/{id}',
    tags: ['Scheduled tasks'],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: json(z.object({ ok: z.boolean() })) },
  }),
  (c) => {
    deleteScheduledTask(c.req.valid('param').id)
    return c.json({ ok: true })
  },
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/scheduled-tasks/{id}/run',
    tags: ['Scheduled tasks'],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: json(z.object({ sessionId: z.string() })),
      404: json(ErrorSchema),
      409: json(ErrorSchema),
    },
  }),
  async (c) => {
    try {
      return c.json(await executeScheduledTask(c.req.valid('param').id))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to run scheduled task.'
      return c.json({ error: message }, /not found/i.test(message) ? 404 : 409)
    }
  },
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/sessions',
    tags: ['Sessions'],
    request: { body: json(CreateSessionSchema) },
    responses: { 200: json(SessionSchema), 404: json(ErrorSchema) },
  }),
  (c) => {
    const session = createSession(c.req.valid('json'))
    if (!session) return c.json({ error: 'Agent not found' }, 404)
    return c.json(session)
  },
)

api.openapi(
  createRoute({
    method: 'delete',
    path: '/sessions/{id}',
    tags: ['Sessions'],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: json(z.object({ ok: z.boolean() })) },
  }),
  (c) => {
    deleteSession(c.req.valid('param').id)
    return c.json({ ok: true })
  },
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/sessions/{id}/clear',
    tags: ['Sessions'],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: json(z.object({ ok: z.boolean() })),
      404: json(ErrorSchema),
      409: json(ErrorSchema),
      500: json(ErrorSchema),
    },
  }),
  async (c) => {
    const id = c.req.valid('param').id
    const session = getSession(id)
    if (!session) return c.json({ error: 'Session not found' }, 404)

    const controller = peekSessionRunController(id)
    if (controller?.getSnapshot().running) {
      return c.json({ error: 'Stop the active run before clearing this session.' }, 409)
    }

    const { disposeSdkSession } = await import('@/lib/chat/sdk-session-manager')
    const disposed = disposeSdkSession(id)
    if (disposed.status === 'running') {
      return c.json({ error: 'Stop the active run before clearing this session.' }, 409)
    }

    try {
      rmSync(session.filePath, { force: true })
      clearSessionMessages(id)
      return c.json({ ok: true })
    } catch (error) {
      logger.error(`Unable to clear session ${id}:`, error instanceof Error ? error.message : error)
      return c.json({ error: 'Unable to clear the session.' }, 500)
    }
  },
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/sessions/{id}/duplicate',
    tags: ['Sessions'],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: json(SessionSchema), 404: json(ErrorSchema) },
  }),
  (c) => {
    const session = duplicateSession(c.req.valid('param').id)
    if (!session) return c.json({ error: 'Session not found' }, 404)
    return c.json(session)
  },
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/sessions/{id}/messages',
    tags: ['Sessions'],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: json(z.array(ChatMessageSchema)) },
  }),
  async (c) => {
    const id = c.req.valid('param').id
    const session = getSession(id)
    if (!session) return c.json([])
    const { readSdkSessionContext } = await import('@/lib/chat/session-branches')
    return c.json(readSdkSessionContext(session.filePath)?.messages ?? listSessionMessages(id))
  },
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/sessions/{id}/tree',
    tags: ['Sessions'],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: json(SessionTreeNodeSchema.nullable()) },
  }),
  async (c) => {
    const id = c.req.valid('param').id
    const session = getSession(id)
    if (!session) return c.json(null)
    const { readSdkSessionTree } = await import('@/lib/chat/session-branches')
    return c.json(readSdkSessionTree(session.filePath)?.roots[0] ?? getSessionTree(id))
  },
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/sessions/{id}/sdk-tree',
    tags: ['Sessions'],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: json(SdkSessionTreeSchema), 404: json(ErrorSchema) },
  }),
  async (c) => {
    const session = getSession(c.req.valid('param').id)
    if (!session) return c.json({ error: 'Session not found' }, 404)
    const { readSdkSessionTree } = await import('@/lib/chat/session-branches')
    const tree = readSdkSessionTree(session.filePath)
    if (!tree) return c.json({ error: 'Session file not found' }, 404)
    return c.json(tree)
  },
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/sessions/{id}/context',
    tags: ['Sessions'],
    request: {
      params: z.object({ id: z.string() }),
      query: z.object({ leafId: z.string().optional() }),
    },
    responses: { 200: json(SessionBranchContextSchema), 404: json(ErrorSchema) },
  }),
  async (c) => {
    const session = getSession(c.req.valid('param').id)
    if (!session) return c.json({ error: 'Session not found' }, 404)
    const { readSdkSessionContext } = await import('@/lib/chat/session-branches')
    const context = readSdkSessionContext(session.filePath, c.req.valid('query').leafId)
    if (!context) return c.json({ error: 'Session file not found' }, 404)
    return c.json(context)
  },
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/sessions/{id}/navigate',
    tags: ['Sessions'],
    request: {
      params: z.object({ id: z.string() }),
      body: json(SessionEntryActionSchema),
    },
    responses: {
      200: json(z.object({ ok: z.boolean() })),
      409: json(ErrorSchema),
    },
  }),
  async (c) => {
    const { selectSdkBranch } = await import('@/lib/chat/sdk-session-manager')
    const ok = await selectSdkBranch(c.req.valid('param').id, c.req.valid('json').entryId)
    if (!ok) return c.json({ error: 'Session is currently running.' }, 409)
    return c.json({ ok: true })
  },
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/sessions/{id}/fork',
    tags: ['Sessions'],
    request: {
      params: z.object({ id: z.string() }),
      body: json(SessionEntryActionSchema),
    },
    responses: { 200: json(SessionSchema), 404: json(ErrorSchema) },
  }),
  async (c) => {
    const source = getSession(c.req.valid('param').id)
    if (!source) return c.json({ error: 'Session not found' }, 404)
    const { forkSdkSessionFile } = await import('@/lib/chat/session-branches')
    const filePath = forkSdkSessionFile(source.filePath, c.req.valid('json').entryId)
    if (!filePath) return c.json({ error: 'Unable to fork session' }, 404)
    const fork = createForkedSessionRecord({ sourceSessionId: source.id, filePath })
    if (!fork) return c.json({ error: 'Unable to create fork session' }, 404)
    return c.json(fork)
  },
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/sessions/{id}/runs',
    tags: ['Chat'],
    request: {
      params: z.object({ id: z.string() }),
      body: json(StartRunSchema),
    },
    responses: { 200: json(StartRunResultSchema) },
  }),
  async (c) => {
    const body = c.req.valid('json')
    const result = await startSessionPrompt({
      sessionId: c.req.valid('param').id,
      prompt: body.message,
      providerId: body.providerId,
      modelId: body.modelId,
      thinkingLevel: body.thinkingLevel,
    })
    // Always 200 with a discriminated status so the client can branch on the
    // outcome. The unified event stream carries the run's frames; the activityId
    // is the identifier that stream uses.
    if (result.status !== 'started') return c.json({ status: result.status })
    return c.json({ status: 'started', activityId: result.activityId, runId: result.runId })
  },
)

function parseLastEventId(value?: string) {
  const sequence = Number(value ?? 0)
  return Number.isInteger(sequence) && sequence > 0 ? sequence : 0
}

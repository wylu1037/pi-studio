/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { streamSSE } from 'hono/streaming'
import { abortRun as abortRegisteredRun, prepareRun } from '@/lib/chat/run-registry'
import { getRunCoordinator, RUN_TERMINAL_EVENT } from '@/lib/chat/run-coordinator'
import { startRunExecution } from '@/lib/chat/run-execution'
import { runNpx } from '@/lib/npx'
import { loadPiPackageCatalog } from '@/lib/packages/pi-dev-gallery'
import { materializeInstalledSkill, removeStoredSkill, studioRootDir } from '@/lib/skills/store'
import { LOG_LEVELS, getAppSettings, updateAppSettings } from '@/lib/runtime/app-settings'
import { clearApplicationLogs, readApplicationLogs } from '@/lib/runtime/log-files'
import { logger } from '@/lib/runtime/logger'
import { piStudioDataDir } from '@/lib/runtime/paths'
import {
  createAgent,
  createForkedSessionRecord,
  createRun,
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
  getActiveRunForSession,
  getModelCapabilities,
  getProvider,
  getRun,
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
  markRun,
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
  AgentSessionStateSchema,
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
  RunSchema,
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

async function installSkillsShPackage(pkg: string) {
  mkdirSync(studioRootDir(), { recursive: true })
  try {
    await runNpx(['skills', 'add', pkg.trim(), '-y', '--copy'], {
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

api.openapi(
  createRoute({
    method: 'get',
    path: '/sessions/{id}/agent-state',
    tags: ['Chat'],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: json(AgentSessionStateSchema) },
  }),
  async (c) => {
    const { getSdkSessionState } = await import('@/lib/chat/sdk-session-manager')
    const sessionId = c.req.valid('param').id
    const state = getSdkSessionState(sessionId)
    const storedActiveRun = getActiveRunForSession(sessionId)
    const activeRunSnapshot = storedActiveRun
      ? getRunCoordinator().getSnapshot(storedActiveRun.id)
      : null
    const activeRunId =
      activeRunSnapshot && !activeRunSnapshot.terminal ? (storedActiveRun?.id ?? null) : null
    return c.json(
      state
        ? {
            active: true,
            ...state,
            activeRunId,
            sdkSessionId: state.sessionId,
          }
        : {
            active: false,
            running: Boolean(activeRunId),
            activeRunId,
            isStreaming: false,
            isCompacting: false,
            model: null,
            thinkingLevel: null,
            sessionFile: null,
            sdkSessionId: null,
          },
    )
  },
)

api.get('/sessions/:id/live-events', async (c) => {
  const { getSdkSession } = await import('@/lib/chat/sdk-session-manager')
  const session = getSdkSession(c.req.param('id'))
  if (!session) return c.json({ error: 'Agent session is not active.' }, 404)

  return streamSSE(c, async (stream) => {
    const queue: import('@/lib/chat/pi-events').PiRunEvent[] = []
    let aborted = false
    let wake: (() => void) | null = null
    const notify = () => {
      wake?.()
      wake = null
    }
    const unsubscribe = session.subscribePiEvents((event) => {
      queue.push(event)
      notify()
    })
    stream.onAbort(() => {
      aborted = true
      notify()
    })

    try {
      while (!aborted && (!session.inner.isIdle || queue.length > 0)) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, 1000)
            wake = () => {
              clearTimeout(timeout)
              resolve()
            }
          })
        }
        while (!aborted && queue.length > 0) {
          const event = queue.shift()
          if (event) await stream.writeSSE({ event: event.type, data: JSON.stringify(event) })
        }
      }
      if (!aborted)
        await stream.writeSSE({ event: 'done', data: JSON.stringify({ recovered: true }) })
    } finally {
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
    const skillInput = { ...input }
    if (!input.id && input.source === 'skills.sh') {
      let installError: unknown = null
      try {
        await installSkillsShPackage(input.path)
      } catch (error) {
        installError = error
      }
      try {
        skillInput.path = materializeInstalledSkill(input.name)
      } catch (materializeError) {
        return c.json(
          {
            error:
              installError instanceof Error
                ? installError.message
                : materializeError instanceof Error
                  ? materializeError.message
                  : 'Unable to install skills.sh package',
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
      200: json(z.object({ runId: z.string(), sessionId: z.string() })),
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

    const hasActiveRun = () => {
      const activeRun = getActiveRunForSession(id)
      const snapshot = activeRun ? getRunCoordinator().getSnapshot(activeRun.id) : null
      return Boolean(snapshot && !snapshot.terminal)
    }
    if (hasActiveRun()) {
      return c.json({ error: 'Stop the active run before clearing this session.' }, 409)
    }

    const { disposeSdkSession } = await import('@/lib/chat/sdk-session-manager')
    if (hasActiveRun()) {
      return c.json({ error: 'Stop the active run before clearing this session.' }, 409)
    }
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
    responses: { 200: json(RunSchema), 404: json(ErrorSchema) },
  }),
  (c) => {
    const session = getSession(c.req.valid('param').id)
    if (!session) return c.json({ error: 'Session not found' }, 404)
    const body = c.req.valid('json')
    const run = createRun({
      sessionId: session.id,
      agentId: session.agentId,
      prompt: body.message,
      providerId: body.providerId,
      modelId: body.modelId,
      thinkingLevel: body.thinkingLevel,
      cwd: session.cwd,
    })
    if (!run) return c.json({ error: 'Unable to start run' }, 404)
    prepareRun(run.id)
    startRunExecution(run.id)
    return c.json(run)
  },
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/runs/{id}',
    tags: ['Chat'],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: json(RunSchema), 404: json(ErrorSchema) },
  }),
  (c) => {
    const run = getRun(c.req.valid('param').id)
    if (!run) return c.json({ error: 'Run not found' }, 404)
    return c.json(run)
  },
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/runs/{id}/abort',
    tags: ['Chat'],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: json(z.object({ ok: z.boolean() })) },
  }),
  (c) => {
    const id = c.req.valid('param').id
    getRunCoordinator().requestAbort(id)
    abortRegisteredRun(id)
    markRun(id, 'aborted')
    return c.json({ ok: true })
  },
)

api.get('/runs/:id/events', (c) => {
  const runId = c.req.param('id')
  const run = getRun(runId)
  if (!run) return c.json({ error: 'Run not found' }, 404)
  const coordinator = getRunCoordinator()
  const afterSequence = parseLastEventId(c.req.header('Last-Event-ID'))

  return streamSSE(c, async (stream) => {
    const snapshot = coordinator.getSnapshot(runId)
    if (!snapshot) {
      await stream.writeSSE({ event: 'connected', data: JSON.stringify({ runId }) })
      const unavailable = run.status === 'queued' || run.status === 'running'
      const status = unavailable ? 'failed' : run.status
      const message = unavailable
        ? 'The run stream is no longer available after the server restarted.'
        : run.error
      if (unavailable) markRun(runId, 'failed', message)
      if (status === 'failed') {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ message: message ?? 'Run failed.' }),
        })
      }
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ runId, status }),
      })
      return
    }

    const queue = []
    let aborted = false
    let wake = null
    const notify = () => {
      wake?.()
      wake = null
    }
    const subscription = coordinator.subscribe(runId, {
      afterSequence,
      onEvent: (event) => {
        queue.push(event)
        notify()
      },
    })
    stream.onAbort(() => {
      aborted = true
      notify()
    })
    const heartbeat = setInterval(() => {
      void stream.write(`: heartbeat ${Date.now()}\n\n`)
    }, 30000)

    try {
      await subscription.drained()
      while (!aborted) {
        while (!aborted && queue.length > 0) {
          const event = queue.shift()
          if (!event || event.type === RUN_TERMINAL_EVENT) continue
          await stream.writeSSE({
            id: String(event.sequence),
            event: event.type,
            data: JSON.stringify(withEventSequence(event.payload, event.sequence)),
          })
        }
        if (subscription.terminal && queue.length === 0) break
        if (queue.length === 0) {
          await new Promise((resolve) => {
            wake = resolve
            if (aborted || queue.length > 0 || subscription.terminal) {
              wake = null
              resolve()
            }
          })
        }
      }
    } finally {
      clearInterval(heartbeat)
      subscription.unsubscribe()
    }
  })
})

function parseLastEventId(value?: string) {
  const sequence = Number(value ?? 0)
  return Number.isInteger(sequence) && sequence > 0 ? sequence : 0
}

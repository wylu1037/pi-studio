/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { mkdirSync } from 'node:fs'
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { streamSSE } from 'hono/streaming'
import { abortRun as abortRegisteredRun } from '@/lib/chat/run-registry'
import { defaultPiSessionDir, runPiCli, type PiUsage } from '@/lib/chat/pi-adapter'
import { runNpx } from '@/lib/npx'
import { loadPackageGallery } from '@/lib/packages/pi-dev-gallery'
import { materializeInstalledSkill, removeStoredSkill, studioRootDir } from '@/lib/skills/store'
import {
  appendMessage,
  appendRunEvent,
  createAgent,
  createForkedSessionRecord,
  createRun,
  createSession,
  deleteAgent,
  deleteMcp,
  deleteModel,
  deletePrompt,
  deleteProvider,
  duplicateAgent,
  duplicateSession,
  getAgent,
  getModelCapabilities,
  getProvider,
  getRun,
  getSession,
  getSessionTree,
  getPackageCatalogItem,
  listAgents,
  listMcpConfigs,
  listPackageGallery,
  listPrompts,
  listProviders,
  listSessionMessages,
  listSessions,
  listSkills,
  markRun,
  resolveAgentRunConfig,
  setDefaultProvider,
  testProviderConnection,
  updateAgent,
  updateAgentResources,
  updateSession,
  upsertSkill,
  upsertMcp,
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
  ExtensionSchema,
  McpInputSchema,
  McpSchema,
  ModelCapabilitiesSchema,
  InstallPackageSchema,
  ModelInputSchema,
  PackageCollectionSchema,
  PromptInputSchema,
  PromptSchema,
  ProviderInputSchema,
  ProviderSchema,
  ProviderTestResultSchema,
  RunSchema,
  SessionSchema,
  UpdateSessionSchema,
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
  const gallery = await loadPackageGallery(listPackageGallery())
  return listRuntimePackages(cwd, gallery)
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
  const url = new URL(provider.baseUrl)
  if (!url.pathname.replace(/\/$/, '').endsWith('/models')) {
    url.pathname = `${url.pathname.replace(/\/$/, '')}/models`
  }
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...JSON.parse(provider.headersJson || '{}'),
  }
  if (provider.apiKey) {
    if (provider.api === 'anthropic-messages') {
      headers['x-api-key'] = provider.apiKey
      headers['anthropic-version'] ??= '2023-06-01'
    } else if (provider.api === 'google-generative-ai') {
      headers['x-goog-api-key'] = provider.apiKey
    } else {
      headers.authorization = `Bearer ${provider.apiKey}`
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
  console.error(error)
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

api.openapi(
  createRoute({
    method: 'get',
    path: '/health',
    tags: ['System'],
    responses: { 200: json(z.object({ ok: z.boolean() })) },
  }),
  (c) => c.json({ ok: true }),
)

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
    const state = getSdkSessionState(c.req.valid('param').id)
    return c.json(
      state
        ? {
            active: true,
            ...state,
            sdkSessionId: state.sessionId,
          }
        : {
            active: false,
            running: false,
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
      if (!ok) return c.json({ error: 'Agent session is not active.' }, 409)
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
  (c) => {
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
  (c) => {
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
  (c) => {
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
    path: '/mcp',
    tags: ['MCP'],
    responses: { 200: json(z.array(McpSchema)) },
  }),
  (c) => c.json(listMcpConfigs()),
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/mcp',
    tags: ['MCP'],
    request: { body: json(McpInputSchema) },
    responses: { 200: json(McpSchema), 400: json(ErrorSchema) },
  }),
  (c) => {
    const mcp = upsertMcp(c.req.valid('json'))
    if (!mcp) return c.json({ error: 'Unable to save MCP config' }, 400)
    return c.json(mcp)
  },
)

api.openapi(
  createRoute({
    method: 'delete',
    path: '/mcp/{id}',
    tags: ['MCP'],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: json(z.object({ ok: z.boolean() })) },
  }),
  (c) => {
    deleteMcp(c.req.valid('param').id)
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
    responses: { 200: json(z.array(ExtensionSchema)) },
  }),
  async (c) => {
    const { listRuntimeExtensions } = await import('@/lib/packages/package-service')
    return c.json(await listRuntimeExtensions(process.cwd()))
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
    const cwd = input.cwd ?? process.cwd()
    await extensionService.setRuntimeExtensionEnabled({ ...input, cwd })
    return c.json(await extensionService.listRuntimeExtensions(cwd))
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
  (c) => {
    const id = c.req.valid('param').id
    const body = c.req.valid('json')
    const agent = getAgent(id)
    if (!agent) return c.json({ error: 'Agent not found' }, 404)
    const toggle = (values: string[]) =>
      body.enabled
        ? Array.from(new Set([...values, body.resourceId]))
        : values.filter((value) => value !== body.resourceId)
    const updated = updateAgentResources(id, {
      selectedSkillIds: body.kind === 'skill' ? toggle(agent.selectedSkillIds) : undefined,
      selectedPromptIds: body.kind === 'prompt' ? toggle(agent.selectedPromptIds) : undefined,
      selectedMcpConfigIds: body.kind === 'mcp' ? toggle(agent.selectedMcpConfigIds) : undefined,
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
  (c) => c.json(listSessions({ agentId: c.req.valid('query').agentId })),
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
  (c) => c.json(listSessionMessages(c.req.valid('param').id)),
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/sessions/{id}/tree',
    tags: ['Sessions'],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: json(SessionTreeNodeSchema.nullable()) },
  }),
  (c) => c.json(getSessionTree(c.req.valid('param').id)),
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
    appendMessage({ sessionId: session.id, type: 'user', content: body.message })
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
    abortRegisteredRun(id)
    markRun(id, 'aborted')
    return c.json({ ok: true })
  },
)

api.get('/runs/:id/events', (c) => {
  const runId = c.req.param('id')
  const run = getRun(runId)
  if (!run) return c.json({ error: 'Run not found' }, 404)
  const config = resolveAgentRunConfig(run.agentId, run.providerId)
  if (!config) return c.json({ error: 'Agent not found' }, 404)
  const provider = piProviderName(config.provider?.api)
  let assistantContent = ''
  let thinkingContent = ''
  let assistantTokens: number | undefined
  let assistantUsage: PiUsage | undefined
  const processMessages: Array<{
    type: 'tool_call' | 'tool_result' | 'bash'
    title?: string
    content: string
  }> = []

  return streamSSE(c, async (stream) => {
    const heartbeat = setInterval(() => {
      void stream.write(`: heartbeat ${Date.now()}\n\n`)
    }, 30000)
    const send = async (event: string, payload: unknown) => {
      appendRunEvent(runId, event, payload)
      await stream.writeSSE({ event, data: JSON.stringify(payload) })
    }

    try {
      await send('connected', { runId })
      markRun(runId, 'running')
      await send('started', { runId })

      for await (const event of runPiCli({
        agentId: config.agent.id,
        agentName: config.agent.name,
        runId,
        sessionId: run.sessionId,
        sessionDir: defaultPiSessionDir(),
        sessionFile: getSession(run.sessionId)?.filePath,
        cwd: run.cwd,
        prompt: run.prompt,
        provider,
        providerConfig: config.provider ?? undefined,
        providerConfigs: config.providers ?? [],
        apiKey: config.provider?.apiKey ?? undefined,
        baseUrl: config.provider?.baseUrl ?? undefined,
        model: run.modelId ?? config.agent.defaultModelId,
        thinkingLevel: run.thinkingLevel,
        skills: config.skills.map((skill) => ({
          name: skill.name,
          path: skill.path,
        })),
        prompts: config.prompts.map((prompt) => prompt.path),
        mcpConfigs: (config.mcpConfigs ?? []).map((mcp) => ({
          id: mcp.id,
          name: mcp.name,
          description: mcp.description,
          command: mcp.command,
          args: mcp.args,
          env: mcp.env,
        })),
      })) {
        if (event.type === 'message_delta') {
          assistantContent += event.content
          assistantTokens = event.usage?.totalTokens || assistantTokens
          assistantUsage = event.usage ?? assistantUsage
        }
        if (event.type === 'thinking_delta') thinkingContent += event.content
        if (event.type === 'tool_call_delta') {
          processMessages.push({
            type: 'tool_call',
            title: event.title ?? 'Tool call',
            content: event.content,
          })
        }
        if (event.type === 'tool_result_delta') {
          processMessages.push({
            type: 'tool_result',
            title: event.title ?? 'Tool result',
            content: event.content,
          })
        }
        if (event.type === 'bash_output') {
          const last = processMessages.at(-1)
          if (last?.type === 'bash' && last.title === event.stream) {
            last.content += event.content
          } else {
            processMessages.push({
              type: 'bash',
              title: event.stream,
              content: event.content,
            })
          }
        }
        if (event.type === 'usage') {
          assistantTokens = event.usage.totalTokens || assistantTokens
          assistantUsage = event.usage
        }
        if (event.type === 'error') {
          throw new Error(event.message)
        }
        if (event.type === 'done') {
          appendRunEvent(runId, 'process_done', event)
          if (event.exitCode && event.exitCode !== 0) {
            throw new Error(`pi exited with code ${event.exitCode}`)
          }
          continue
        }
        await send(event.type, event)
      }

      if (thinkingContent.trim()) {
        appendMessage({
          sessionId: run.sessionId,
          type: 'thinking',
          title: 'Thinking',
          content: thinkingContent.trim(),
        })
      }
      for (const message of processMessages) {
        if (!message.content.trim()) continue
        appendMessage({
          sessionId: run.sessionId,
          type: message.type,
          title: message.title,
          content: message.content.trim(),
        })
      }
      if (assistantContent.trim()) {
        appendMessage({
          sessionId: run.sessionId,
          type: 'assistant',
          content: assistantContent.trim(),
          tokens: assistantTokens,
          usage: assistantUsage,
        })
      }
      if (getRun(runId)?.status !== 'aborted') markRun(runId, 'completed')
      await send('done', { runId })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown pi error'
      if (getRun(runId)?.status !== 'aborted') {
        markRun(runId, 'failed', message)
        appendMessage({ sessionId: run.sessionId, type: 'error', content: message })
      }
      await send('error', { message })
    } finally {
      clearInterval(heartbeat)
    }
  })
})

function piProviderName(api?: string | null) {
  if (!api) return undefined
  if (api.startsWith('anthropic')) return 'anthropic'
  if (api.startsWith('google')) return 'google'
  if (api.startsWith('openai')) return 'openai'
  return undefined
}

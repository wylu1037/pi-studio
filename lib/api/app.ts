/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { streamSSE } from 'hono/streaming'
import {
  abortRun as abortRegisteredRun,
} from '@/lib/chat/run-registry'
import { defaultPiSessionDir, runPiCli } from '@/lib/chat/pi-adapter'
import {
  appendMessage,
  appendRunEvent,
  createAgent,
  createRun,
  createSession,
  deleteAgent,
  deleteMcp,
  deleteModel,
  deletePackage,
  deletePrompt,
  deleteProvider,
  duplicateAgent,
  duplicateSession,
  getAgent,
  getRun,
  getSession,
  getSessionTree,
  installPackage,
  listAgents,
  listMcpConfigs,
  listPackages,
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
  updatePackage,
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
  AgentInputSchema,
  AgentResourcesSchema,
  AgentSchema,
  ChatMessageSchema,
  CreateSessionSchema,
  ErrorSchema,
  McpInputSchema,
  McpSchema,
  ModelInputSchema,
  PackageCollectionSchema,
  PromptInputSchema,
  PromptSchema,
  ProviderInputSchema,
  ProviderSchema,
  ProviderTestResultSchema,
  RunSchema,
  SessionSchema,
  SessionTreeNodeSchema,
  SkillInputSchema,
  SkillSchema,
  StartRunSchema,
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
    path: '/health',
    tags: ['System'],
    responses: { 200: json(z.object({ ok: z.boolean() })) },
  }),
  (c) => c.json({ ok: true }),
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
  (c) => {
    const skill = upsertSkill(c.req.valid('json'))
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
  (c) => {
    deleteSkill(c.req.valid('param').id)
    return c.json({ ok: true })
  },
)

api.openapi(
  createRoute({
    method: 'get',
    path: '/skills/registry/search',
    tags: ['Skills'],
    request: { query: z.object({ q: z.string().optional() }) },
    responses: { 200: json(z.array(SkillSchema.pick({ name: true, description: true, tags: true }).extend({ author: z.string(), installed: z.boolean() }))) },
  }),
  (c) => {
    c.req.valid('query')
    return c.json([])
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
    const prompt = upsertPrompt(c.req.valid('json'))
    if (!prompt) return c.json({ error: 'Unable to save prompt' }, 400)
    return c.json(prompt)
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
    responses: { 200: json(ProviderSchema), 404: json(ErrorSchema) },
  }),
  (c) => {
    const provider = upsertModel(c.req.valid('param').id, c.req.valid('json'))
    if (!provider) return c.json({ error: 'Provider not found' }, 404)
    return c.json(provider)
  },
)

api.openapi(
  createRoute({
    method: 'delete',
    path: '/models/{id}',
    tags: ['Models'],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: json(ProviderSchema), 404: json(ErrorSchema) },
  }),
  (c) => {
    const provider = deleteModel(c.req.valid('param').id)
    if (!provider) return c.json({ error: 'Model not found' }, 404)
    return c.json(provider)
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
  (c) => c.json(listPackages()),
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/packages/{id}/install',
    tags: ['Packages'],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: json(PackageCollectionSchema), 404: json(ErrorSchema) },
  }),
  (c) => {
    const collection = installPackage(c.req.valid('param').id)
    if (!collection) return c.json({ error: 'Package not found' }, 404)
    return c.json(collection)
  },
)

api.openapi(
  createRoute({
    method: 'post',
    path: '/packages/{id}/update',
    tags: ['Packages'],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: json(PackageCollectionSchema) },
  }),
  (c) => c.json(updatePackage(c.req.valid('param').id)),
)

api.openapi(
  createRoute({
    method: 'delete',
    path: '/packages/{id}',
    tags: ['Packages'],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: json(z.object({ ok: z.boolean() })) },
  }),
  (c) => {
    deletePackage(c.req.valid('param').id)
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
        cwd: run.cwd,
        prompt: run.prompt,
        provider,
        providerConfig: config.provider ?? undefined,
        apiKey: config.provider?.apiKey ?? undefined,
        baseUrl: config.provider?.baseUrl ?? undefined,
        model: run.modelId ?? config.agent.defaultModelId,
        thinkingLevel: run.thinkingLevel,
        skills: config.skills.map((skill) => skill.path),
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
        if (event.type === 'message_delta') assistantContent += event.content
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

      if (assistantContent.trim()) {
        appendMessage({
          sessionId: run.sessionId,
          type: 'assistant',
          content: assistantContent.trim(),
        })
      }
      markRun(runId, 'completed')
      await send('done', { runId })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown pi error'
      markRun(runId, 'failed', message)
      appendMessage({ sessionId: run.sessionId, type: 'error', content: message })
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

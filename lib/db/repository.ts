import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { and, eq, inArray } from 'drizzle-orm'
import type {
  AgentProfile,
  AgentSessionSummary,
  ChatMessage,
  GlobalMcpConfig,
  GlobalModel,
  GlobalModelProvider,
  GlobalPackage,
  GlobalPromptTemplate,
  GlobalSkill,
  StudioExtension,
  SessionTreeNode,
} from '@/lib/types'
import { piStudioDataDir } from '@/lib/runtime/paths'
import { ensureStoredPrompt, removeStoredPrompt, writeStoredPrompt } from '@/lib/prompts/store'
import { installedPackagePaths } from '@/lib/packages/studio-package-store'
import { buildPromptWithAttachments, parsePromptWithAttachments } from '@/lib/chat/attachments'
import { db, sqlite } from './client'
import {
  agentMcpConfigs,
  agentPackageSources,
  agentExtensions,
  agentModelProviders,
  agentModels,
  agentPrompts,
  agents,
  agentSkills,
  agentTags,
  chatMessages,
  chatRunEvents,
  chatRuns,
  globalPrompts,
  globalSkills,
  mcpConfigs,
  mcpTags,
  modelProviders,
  models,
  packages,
  promptTags,
  sessions,
  sessionTreeNodes,
  skillTags,
  studioExtensions,
} from './schema'

type Row = Record<string, unknown>

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function now() {
  return new Date().toISOString()
}

function tags(table: string, idColumn: string, id: string) {
  return sqlite
    .prepare(`select tag from ${table} where ${idColumn} = ? order by tag`)
    .all(id)
    .map((row) => String((row as Row).tag))
}

function ids(table: string, idColumn: string, valueColumn: string, id: string) {
  return sqlite
    .prepare(`select ${valueColumn} from ${table} where ${idColumn} = ?`)
    .all(id)
    .map((row) => String((row as Row)[valueColumn]))
}

function selectedModelResourceIds(agentId: string) {
  return db
    .select({ modelId: agentModels.modelId })
    .from(agentModels)
    .where(eq(agentModels.agentId, agentId))
    .all()
    .map(({ modelId }) => {
      const model = db.select().from(models).where(eq(models.id, modelId)).get()
      return model
        ? modelStorageId(model.providerId, externalModelId(model.providerId, model.id))
        : modelId
    })
}

function count(table: string, column: string, value: string) {
  const row = sqlite
    .prepare(`select count(*) as value from ${table} where ${column} = ?`)
    .get(value) as { value: number }
  return row.value
}

export function listAgents(): AgentProfile[] {
  const rows = db.select().from(agents).all()
  return rows.map((agent) => ({
    id: agent.id,
    name: agent.name,
    description: agent.description ?? undefined,
    icon: agent.icon ?? undefined,
    color: agent.color,
    defaultCwd: agent.defaultCwd ?? undefined,
    defaultProviderId: agent.defaultProviderId ?? undefined,
    defaultModelId: agent.defaultModelId ?? undefined,
    defaultThinkingLevel: agent.defaultThinkingLevel as AgentProfile['defaultThinkingLevel'],
    tags: tags('agent_tags', 'agent_id', agent.id),
    selectedExtensionIds: ids('agent_extensions', 'agent_id', 'extension_id', agent.id),
    selectedPackageSources: ids('agent_package_sources', 'agent_id', 'source', agent.id),
    selectedSkillIds: ids('agent_skills', 'agent_id', 'skill_id', agent.id),
    selectedPromptIds: ids('agent_prompts', 'agent_id', 'prompt_id', agent.id),
    selectedMcpConfigIds: ids('agent_mcp_configs', 'agent_id', 'mcp_config_id', agent.id),
    selectedProviderIds: ids('agent_model_providers', 'agent_id', 'provider_id', agent.id),
    selectedModelIds: selectedModelResourceIds(agent.id),
    sessionCount: count('sessions', 'agent_id', agent.id),
    lastUsed: agent.lastUsed ?? agent.updatedAt,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  }))
}

export function getAgent(id: string) {
  return listAgents().find((agent) => agent.id === id) ?? null
}

export function createAgent(input: {
  name: string
  description?: string
  tags?: string[]
  defaultCwd?: string
  defaultProviderId?: string
  defaultModelId?: string
  defaultThinkingLevel?: AgentProfile['defaultThinkingLevel']
}) {
  const id = `ag-${randomUUID()}`
  const createdAt = now()
  db.insert(agents)
    .values({
      id,
      name: input.name,
      description: input.description,
      color: '#7c8cf8',
      defaultCwd: input.defaultCwd,
      defaultProviderId: input.defaultProviderId,
      defaultModelId: input.defaultModelId,
      defaultThinkingLevel: input.defaultThinkingLevel ?? 'medium',
      lastUsed: createdAt,
      createdAt,
      updatedAt: createdAt,
    })
    .run()
  for (const tag of input.tags ?? []) {
    db.insert(agentTags).values({ agentId: id, tag }).run()
  }
  return getAgent(id)
}

export function updateAgent(id: string, input: Partial<AgentProfile>) {
  db.update(agents)
    .set({
      name: input.name,
      description: input.description,
      defaultCwd: input.defaultCwd,
      defaultProviderId: input.defaultProviderId,
      defaultModelId: input.defaultModelId,
      defaultThinkingLevel: input.defaultThinkingLevel,
      updatedAt: now(),
    })
    .where(eq(agents.id, id))
    .run()
  if (input.tags) {
    db.delete(agentTags).where(eq(agentTags.agentId, id)).run()
    for (const tag of input.tags) db.insert(agentTags).values({ agentId: id, tag }).run()
  }
  return getAgent(id)
}

export function deleteAgent(id: string) {
  db.delete(agents).where(eq(agents.id, id)).run()
}

export function removePackageSourceFromAgents(source: string) {
  db.delete(agentPackageSources).where(eq(agentPackageSources.source, source)).run()
}

export function updateAgentResources(
  id: string,
  input: {
    selectedSkillIds?: string[]
    selectedExtensionIds?: string[]
    selectedPackageSources?: string[]
    selectedPromptIds?: string[]
    selectedMcpConfigIds?: string[]
    selectedProviderIds?: string[]
    selectedModelIds?: string[]
    defaultProviderId?: string
    defaultModelId?: string
    defaultThinkingLevel?: AgentProfile['defaultThinkingLevel']
  },
) {
  const replace = (table: typeof agentSkills, column: 'skillId', values: string[] | undefined) => {
    if (!values) return
    db.delete(table).where(eq(table.agentId, id)).run()
    for (const value of values)
      db.insert(table)
        .values({ agentId: id, [column]: value })
        .run()
  }
  replace(agentSkills, 'skillId', input.selectedSkillIds)
  if (input.selectedPackageSources) {
    db.delete(agentPackageSources).where(eq(agentPackageSources.agentId, id)).run()
    for (const source of input.selectedPackageSources) {
      db.insert(agentPackageSources).values({ agentId: id, source }).run()
    }
  }
  if (input.selectedExtensionIds) {
    db.delete(agentExtensions).where(eq(agentExtensions.agentId, id)).run()
    for (const extensionId of input.selectedExtensionIds) {
      db.insert(agentExtensions).values({ agentId: id, extensionId }).run()
    }
  }
  if (input.selectedPromptIds) {
    db.delete(agentPrompts).where(eq(agentPrompts.agentId, id)).run()
    for (const promptId of input.selectedPromptIds)
      db.insert(agentPrompts).values({ agentId: id, promptId }).run()
  }
  if (input.selectedMcpConfigIds) {
    db.delete(agentMcpConfigs).where(eq(agentMcpConfigs.agentId, id)).run()
    for (const mcpConfigId of input.selectedMcpConfigIds)
      db.insert(agentMcpConfigs).values({ agentId: id, mcpConfigId }).run()
  }
  if (input.selectedProviderIds) {
    db.delete(agentModelProviders).where(eq(agentModelProviders.agentId, id)).run()
    for (const providerId of input.selectedProviderIds)
      db.insert(agentModelProviders).values({ agentId: id, providerId }).run()
  }
  if (input.selectedModelIds) {
    db.delete(agentModels).where(eq(agentModels.agentId, id)).run()
    for (const resourceId of input.selectedModelIds) {
      const exact = db.select().from(models).where(eq(models.id, resourceId)).get()
      const separator = resourceId.indexOf('::')
      const providerId = separator >= 0 ? resourceId.slice(0, separator) : null
      const externalId = separator >= 0 ? resourceId.slice(separator + 2) : resourceId
      const legacy = providerId
        ? db
            .select()
            .from(models)
            .where(and(eq(models.providerId, providerId), eq(models.id, externalId)))
            .get()
        : null
      const storedModelId = exact?.id ?? legacy?.id
      if (storedModelId) {
        db.insert(agentModels).values({ agentId: id, modelId: storedModelId }).run()
      }
    }
  }
  db.update(agents)
    .set({
      defaultProviderId: input.defaultProviderId,
      defaultModelId: input.defaultModelId,
      defaultThinkingLevel: input.defaultThinkingLevel,
      updatedAt: now(),
    })
    .where(eq(agents.id, id))
    .run()
  return getAgent(id)
}

export function duplicateAgent(id: string) {
  const agent = getAgent(id)
  if (!agent) return null
  const copy = createAgent({
    name: `${agent.name} Copy`,
    description: agent.description,
    tags: agent.tags,
    defaultCwd: agent.defaultCwd,
    defaultProviderId: agent.defaultProviderId,
    defaultModelId: agent.defaultModelId,
    defaultThinkingLevel: agent.defaultThinkingLevel,
  })
  if (!copy) return null
  updateAgentResources(copy.id, {
    selectedExtensionIds: agent.selectedExtensionIds,
    selectedPackageSources: agent.selectedPackageSources,
    selectedSkillIds: agent.selectedSkillIds,
    selectedPromptIds: agent.selectedPromptIds,
    selectedMcpConfigIds: agent.selectedMcpConfigIds,
    selectedProviderIds: agent.selectedProviderIds,
    selectedModelIds: agent.selectedModelIds,
  })
  return getAgent(copy.id)
}

export function listSkills(): GlobalSkill[] {
  return db
    .select()
    .from(globalSkills)
    .all()
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      source: skill.source as GlobalSkill['source'],
      path: skill.path,
      version: skill.version ?? undefined,
      author: skill.author ?? undefined,
      tags: tags('skill_tags', 'skill_id', skill.id),
      installedAt: skill.installedAt,
      updatedAt: skill.updatedAt,
      usedByAgents: count('agent_skills', 'skill_id', skill.id),
    }))
}

export function listStudioExtensions(): StudioExtension[] {
  return db
    .select()
    .from(studioExtensions)
    .all()
    .map((extension) => {
      const assignedAgentIds = ids('agent_extensions', 'extension_id', 'agent_id', extension.id)
      return {
        id: extension.id,
        name: extension.name,
        description: extension.description,
        path: extension.path,
        assignedAgentIds,
        usedByAgents: assignedAgentIds.length,
        createdAt: extension.createdAt,
        updatedAt: extension.updatedAt,
      }
    })
}

export function getStudioExtension(id: string) {
  return listStudioExtensions().find((extension) => extension.id === id) ?? null
}

export function createStudioExtension(input: { name: string; description?: string; path: string }) {
  const id = `ex-${randomUUID()}`
  const at = now()
  db.insert(studioExtensions)
    .values({
      id,
      name: input.name,
      description: input.description ?? '',
      path: input.path,
      createdAt: at,
      updatedAt: at,
    })
    .run()
  return getStudioExtension(id)
}

export function deleteStudioExtension(id: string) {
  db.delete(studioExtensions).where(eq(studioExtensions.id, id)).run()
}

export function createSkill(
  input: Omit<GlobalSkill, 'id' | 'usedByAgents' | 'installedAt' | 'updatedAt'>,
) {
  const id = `sk-${randomUUID()}`
  const at = now()
  db.insert(globalSkills)
    .values({ ...input, id, installedAt: at, createdAt: at, updatedAt: at })
    .run()
  for (const tag of input.tags) db.insert(skillTags).values({ skillId: id, tag }).run()
  return listSkills().find((skill) => skill.id === id) ?? null
}

export function upsertSkill(
  input: Partial<GlobalSkill> & {
    id?: string
    name: string
    description?: string
    source?: GlobalSkill['source']
    path: string
  },
) {
  const id = input.id ?? `sk-${randomUUID()}`
  const at = now()
  const existing = db.select().from(globalSkills).where(eq(globalSkills.id, id)).get()
  const values = {
    name: input.name,
    description: input.description ?? '',
    source: input.source ?? 'manual',
    path: input.path,
    version: input.version,
    author: input.author,
    updatedAt: at,
  }
  if (existing) {
    db.update(globalSkills).set(values).where(eq(globalSkills.id, id)).run()
    db.delete(skillTags).where(eq(skillTags.skillId, id)).run()
  } else {
    db.insert(globalSkills)
      .values({ ...values, id, installedAt: at, createdAt: at })
      .run()
  }
  for (const tag of input.tags ?? []) db.insert(skillTags).values({ skillId: id, tag }).run()
  return listSkills().find((skill) => skill.id === id) ?? null
}

export function deleteSkill(id: string) {
  db.delete(globalSkills).where(eq(globalSkills.id, id)).run()
}

export function listPrompts(): GlobalPromptTemplate[] {
  return db
    .select()
    .from(globalPrompts)
    .all()
    .map((prompt) => {
      const path =
        prompt.source === 'studio'
          ? ensureStoredPrompt({
              name: prompt.name,
              description: prompt.description ?? undefined,
              argumentHint: prompt.argumentHint ?? undefined,
              content: prompt.content,
            })
          : prompt.path
      if (path !== prompt.path) {
        db.update(globalPrompts).set({ path }).where(eq(globalPrompts.id, prompt.id)).run()
      }
      return {
        id: prompt.id,
        name: prompt.name,
        description: prompt.description ?? undefined,
        argumentHint: prompt.argumentHint ?? undefined,
        content: prompt.content,
        path,
        source: prompt.source as GlobalPromptTemplate['source'],
        scope: prompt.scope as GlobalPromptTemplate['scope'],
        tags: tags('prompt_tags', 'prompt_id', prompt.id),
        createdAt: prompt.createdAt,
        updatedAt: prompt.updatedAt,
        usedByAgents: count('agent_prompts', 'prompt_id', prompt.id),
      }
    })
}

export function upsertPrompt(
  input: Partial<GlobalPromptTemplate> & { id?: string; name: string; content: string },
) {
  const at = now()
  const id = input.id ?? `pr-${randomUUID()}`
  const existing = db.select().from(globalPrompts).where(eq(globalPrompts.id, id)).get()
  if (existing) {
    const path = writeStoredPrompt(
      {
        name: input.name,
        description: input.description,
        argumentHint: input.argumentHint,
        content: input.content,
      },
      existing.path,
    )
    db.update(globalPrompts)
      .set({
        name: input.name,
        description: input.description,
        argumentHint: input.argumentHint,
        content: input.content,
        path,
        source: input.source ?? existing.source,
        scope: input.scope ?? existing.scope,
        updatedAt: at,
      })
      .where(eq(globalPrompts.id, id))
      .run()
    db.delete(promptTags).where(eq(promptTags.promptId, id)).run()
  } else {
    const path = writeStoredPrompt({
      name: input.name,
      description: input.description,
      argumentHint: input.argumentHint,
      content: input.content,
    })
    db.insert(globalPrompts)
      .values({
        id,
        name: input.name,
        description: input.description,
        argumentHint: input.argumentHint,
        content: input.content,
        path,
        source: input.source ?? 'studio',
        scope: input.scope ?? 'global',
        createdAt: at,
        updatedAt: at,
      })
      .run()
  }
  for (const tag of input.tags ?? []) db.insert(promptTags).values({ promptId: id, tag }).run()
  return listPrompts().find((prompt) => prompt.id === id) ?? null
}

export function deletePrompt(id: string) {
  const prompt = db.select().from(globalPrompts).where(eq(globalPrompts.id, id)).get()
  if (prompt) removeStoredPrompt(prompt.path)
  db.delete(globalPrompts).where(eq(globalPrompts.id, id)).run()
}

export function listMcpConfigs(): GlobalMcpConfig[] {
  return db
    .select()
    .from(mcpConfigs)
    .all()
    .map((mcp) => ({
      id: mcp.id,
      name: mcp.name,
      description: mcp.description ?? undefined,
      command: mcp.command,
      args: parseJson<string[]>(mcp.argsJson, []),
      env: parseJson<Record<string, string>>(mcp.envJson, {}),
      tags: tags('mcp_tags', 'mcp_config_id', mcp.id),
      enabledGlobally: mcp.enabledGlobally,
      usedByAgents: count('agent_mcp_configs', 'mcp_config_id', mcp.id),
      createdAt: mcp.createdAt,
      updatedAt: mcp.updatedAt,
    }))
}

export function upsertMcp(
  input: Partial<GlobalMcpConfig> & { id?: string; name: string; command: string },
) {
  const id = input.id ?? `mcp-${randomUUID()}`
  const at = now()
  const values = {
    name: input.name,
    description: input.description,
    command: input.command,
    argsJson: JSON.stringify(input.args ?? []),
    envJson: JSON.stringify(input.env ?? {}),
    enabledGlobally: input.enabledGlobally ?? false,
    updatedAt: at,
  }
  const existing = db.select().from(mcpConfigs).where(eq(mcpConfigs.id, id)).get()
  if (existing) {
    db.update(mcpConfigs).set(values).where(eq(mcpConfigs.id, id)).run()
    db.delete(mcpTags).where(eq(mcpTags.mcpConfigId, id)).run()
  } else {
    db.insert(mcpConfigs)
      .values({ ...values, id, createdAt: at })
      .run()
  }
  for (const tag of input.tags ?? []) db.insert(mcpTags).values({ mcpConfigId: id, tag }).run()
  return listMcpConfigs().find((mcp) => mcp.id === id) ?? null
}

export function deleteMcp(id: string) {
  db.delete(mcpConfigs).where(eq(mcpConfigs.id, id)).run()
}

export function listProviders(): GlobalModelProvider[] {
  return db
    .select()
    .from(modelProviders)
    .all()
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      api: provider.api as GlobalModelProvider['api'],
      apiKey: provider.apiKey ?? undefined,
      headers: parseJson<Record<string, string>>(provider.headersJson, {}),
      models: listModels(provider.id),
      isDefault: provider.isDefault,
      status: provider.status as GlobalModelProvider['status'],
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt,
    }))
}

export function getProvider(id?: string | null) {
  if (!id) return null
  return db.select().from(modelProviders).where(eq(modelProviders.id, id)).get() ?? null
}

function modelStorageId(providerId: string, modelId: string) {
  return `${providerId}::${modelId}`
}

function externalModelId(providerId: string, storedId: string) {
  const prefix = `${providerId}::`
  return storedId.startsWith(prefix) ? storedId.slice(prefix.length) : storedId
}

export function listModels(providerId: string): GlobalModel[] {
  return db
    .select()
    .from(models)
    .where(eq(models.providerId, providerId))
    .all()
    .map((model) => ({
      id: externalModelId(providerId, model.id),
      name: model.name ?? undefined,
      reasoning: model.reasoning,
      input: parseJson<Array<'text' | 'image'>>(model.inputJson, ['text']),
      contextWindow: model.contextWindow ?? undefined,
      maxTokens: model.maxTokens ?? undefined,
    }))
}

export function upsertProvider(
  input: Partial<GlobalModelProvider> & { id?: string; name: string; baseUrl: string; api: string },
) {
  const id = input.id ?? `pv-${randomUUID()}`
  const at = now()
  const values = {
    name: input.name,
    baseUrl: input.baseUrl,
    api: input.api,
    apiKey: input.apiKey,
    headersJson: JSON.stringify(input.headers ?? {}),
    isDefault: input.isDefault ?? false,
    status: input.status ?? 'untested',
    updatedAt: at,
  }
  const existing = db.select().from(modelProviders).where(eq(modelProviders.id, id)).get()
  if (existing) db.update(modelProviders).set(values).where(eq(modelProviders.id, id)).run()
  else
    db.insert(modelProviders)
      .values({ ...values, id, createdAt: at })
      .run()
  return listProviders().find((provider) => provider.id === id) ?? null
}

export function upsertModel(providerId: string, input: GlobalModel & { originalId?: string }) {
  const provider = getProvider(providerId)
  if (!provider) return null
  const originalId = input.originalId ?? input.id
  const originalStorageId = modelStorageId(providerId, originalId)
  const nextStorageId = modelStorageId(providerId, input.id)
  const existing =
    db
      .select()
      .from(models)
      .where(and(eq(models.providerId, providerId), eq(models.id, originalStorageId)))
      .get() ??
    db
      .select()
      .from(models)
      .where(and(eq(models.providerId, providerId), eq(models.id, originalId)))
      .get()
  const existingStorageId = existing?.id ?? originalStorageId
  const values = {
    providerId,
    name: input.name,
    reasoning: input.reasoning ?? false,
    inputJson: JSON.stringify(input.input ?? ['text']),
    contextWindow: input.contextWindow,
    maxTokens: input.maxTokens,
  }
  if (existing && existingStorageId !== nextStorageId) {
    const conflict = db.select().from(models).where(eq(models.id, nextStorageId)).get()
    if (conflict) throw new Error(`Model ID "${input.id}" already exists.`)
    sqlite.transaction(() => {
      db.insert(models)
        .values({ id: nextStorageId, ...values })
        .run()
      db.update(agentModels)
        .set({ modelId: nextStorageId })
        .where(eq(agentModels.modelId, existingStorageId))
        .run()
      db.update(agents)
        .set({ defaultModelId: input.id })
        .where(and(eq(agents.defaultProviderId, providerId), eq(agents.defaultModelId, originalId)))
        .run()
      db.delete(models).where(eq(models.id, existingStorageId)).run()
    })()
  } else if (existing) {
    db.update(models).set(values).where(eq(models.id, existingStorageId)).run()
  } else {
    db.insert(models)
      .values({ id: nextStorageId, ...values })
      .run()
  }
  db.update(modelProviders).set({ updatedAt: now() }).where(eq(modelProviders.id, providerId)).run()
  return listProviders().find((item) => item.id === providerId) ?? null
}

export function deleteModel(providerId: string, id: string) {
  const storageId = modelStorageId(providerId, id)
  const existing =
    db.select().from(models).where(eq(models.id, storageId)).get() ??
    db
      .select()
      .from(models)
      .where(and(eq(models.providerId, providerId), eq(models.id, id)))
      .get()
  if (!existing) return null
  db.delete(models).where(eq(models.id, existing.id)).run()
  db.update(modelProviders)
    .set({ updatedAt: now() })
    .where(eq(modelProviders.id, existing.providerId))
    .run()
  return listProviders().find((provider) => provider.id === existing.providerId) ?? null
}

export function deleteProvider(id: string) {
  db.delete(modelProviders).where(eq(modelProviders.id, id)).run()
}

export function setDefaultProvider(id: string) {
  const provider = db.select().from(modelProviders).where(eq(modelProviders.id, id)).get()
  if (!provider) return null
  const nextDefault = !provider.isDefault
  if (nextDefault) db.update(modelProviders).set({ isDefault: false }).run()
  db.update(modelProviders)
    .set({ isDefault: nextDefault, updatedAt: now() })
    .where(eq(modelProviders.id, id))
    .run()
  return listProviders().find((provider) => provider.id === id) ?? null
}

export async function testProviderConnection(id: string) {
  const provider = db.select().from(modelProviders).where(eq(modelProviders.id, id)).get()
  if (!provider) return null
  if (!provider.apiKey) {
    db.update(modelProviders)
      .set({ status: 'untested', updatedAt: now() })
      .where(eq(modelProviders.id, id))
      .run()
    return {
      ok: false,
      status: 'missing-api-key',
      message: 'API key is required before testing the connection.',
    }
  }

  let status = 'connected'
  let message = 'Connection test succeeded.'
  try {
    const { testPiModel } = await import('@/lib/models/pi-ai')
    const model = listModels(provider.id)[0]
    if (!model) throw new Error('Add at least one model before testing the provider.')
    await testPiModel(
      {
        id: provider.id,
        baseUrl: provider.baseUrl,
        api: provider.api as GlobalModelProvider['api'],
        apiKey: provider.apiKey,
        headers: parseJson<Record<string, string>>(provider.headersJson, {}),
      },
      model,
    )
  } catch (error) {
    status = 'error'
    message = error instanceof Error ? error.message : 'Connection test failed.'
  }
  db.update(modelProviders).set({ status, updatedAt: now() }).where(eq(modelProviders.id, id)).run()
  return { ok: status === 'connected', status, message }
}

export async function getModelCapabilities(providerId: string, modelId: string) {
  const provider = listProviders().find((item) => item.id === providerId)
  const model = provider?.models.find((item) => item.id === modelId)
  if (!provider || !model) return null
  const { supportedThinkingLevels } = await import('@/lib/models/pi-ai')
  return {
    thinkingLevels: supportedThinkingLevels(provider, model),
    reasoning: model.reasoning ?? false,
    input: model.input,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  }
}

export function listPackages() {
  const rows = db.select().from(packages).all()
  const mapped = rows.map<GlobalPackage>((pkg) => ({
    id: pkg.id,
    name: pkg.name,
    source: pkg.source,
    type: pkg.type as GlobalPackage['type'],
    version: pkg.version,
    scope: pkg.scope as GlobalPackage['scope'],
    author: pkg.author,
    description: pkg.description,
    downloads: pkg.downloads,
    resources: parseJson<GlobalPackage['resources']>(pkg.resourcesJson, {
      extensions: 0,
      skills: 0,
      prompts: 0,
      themes: 0,
    }),
    hasExtensions: pkg.hasExtensions,
    status: pkg.status as GlobalPackage['status'],
    updatedAt: pkg.updatedAt,
  }))
  return {
    installed: mapped.filter((pkg) => !rows.find((row) => row.id === pkg.id)?.isGallery),
    gallery: mapped.filter((pkg) => rows.find((row) => row.id === pkg.id)?.isGallery),
  }
}

export function listPackageGallery() {
  return listPackages().gallery
}

export function getPackageCatalogItem(id: string) {
  const item = db.select().from(packages).where(eq(packages.id, id)).get()
  if (!item) return null
  return listPackages().gallery.find((pkg) => pkg.id === id) ?? null
}

export function listSessions(filter?: { agentId?: string }): AgentSessionSummary[] {
  const rows = filter?.agentId
    ? db.select().from(sessions).where(eq(sessions.agentId, filter.agentId)).all()
    : db.select().from(sessions).all()
  return rows.map((session) => {
    const messages = db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, session.id))
      .all()
    const firstUser = messages.find((message) => message.type === 'user')
    const last = messages.at(-1)
    return {
      id: session.id,
      agentId: session.agentId,
      name: session.name ?? undefined,
      filePath: session.filePath,
      cwd: session.cwd,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: messages.length,
      firstUserMessage: firstUser?.content,
      lastMessagePreview: last?.content,
      totalTokens: session.totalTokens ?? undefined,
      totalCost: session.totalCost ?? undefined,
      branchCount: count('session_tree_nodes', 'session_id', session.id),
      tags: tags('session_tags', 'session_id', session.id),
    }
  })
}

export function createSession(input: { agentId: string; name?: string; cwd?: string }) {
  const agent = getAgent(input.agentId)
  if (!agent) return null
  const id = randomUUID()
  const at = now()
  const cwd = input.cwd ?? agent.defaultCwd ?? process.cwd()
  db.insert(sessions)
    .values({
      id,
      agentId: input.agentId,
      name: input.name ?? 'Untitled session',
      filePath: join(piStudioDataDir(), 'pi-sessions', `${id}.jsonl`),
      cwd,
      createdAt: at,
      updatedAt: at,
    })
    .run()
  return listSessions().find((session) => session.id === id) ?? null
}

export function getSession(id: string) {
  return listSessions().find((session) => session.id === id) ?? null
}

export function updateSessionFilePath(id: string, filePath: string) {
  db.update(sessions).set({ filePath, updatedAt: now() }).where(eq(sessions.id, id)).run()
}

export function updateSession(id: string, input: { name: string; cwd: string }) {
  const existing = db.select().from(sessions).where(eq(sessions.id, id)).get()
  if (!existing) return null
  db.update(sessions)
    .set({ name: input.name, cwd: input.cwd, updatedAt: now() })
    .where(eq(sessions.id, id))
    .run()
  return getSession(id)
}

export function createForkedSessionRecord(input: { sourceSessionId: string; filePath: string }) {
  const source = db.select().from(sessions).where(eq(sessions.id, input.sourceSessionId)).get()
  if (!source) return null
  const id = randomUUID()
  const at = now()
  db.insert(sessions)
    .values({
      id,
      agentId: source.agentId,
      name: `${source.name ?? 'Untitled session'} · Fork`,
      filePath: input.filePath,
      cwd: source.cwd,
      createdAt: at,
      updatedAt: at,
    })
    .run()
  return listSessions().find((session) => session.id === id) ?? null
}

export function listSessionMessages(sessionId: string): ChatMessage[] {
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .all()
    .map((message) => {
      const parsed =
        message.type === 'user'
          ? parsePromptWithAttachments(message.content)
          : { message: message.content, attachments: [] }
      return {
        id: message.id,
        type: message.type as ChatMessage['type'],
        title: message.title ?? undefined,
        content: parsed.message,
        attachments: parsed.attachments.length > 0 ? parsed.attachments : undefined,
        timestamp: message.createdAt,
        tokens: message.tokens ?? undefined,
        usage: messageUsage(message),
      }
    })
}

export function getSessionTree(sessionId: string): SessionTreeNode | null {
  const rows = db
    .select()
    .from(sessionTreeNodes)
    .where(eq(sessionTreeNodes.sessionId, sessionId))
    .all()
  if (rows.length === 0) return null
  const byId = new Map<string, SessionTreeNode>()
  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      parentId: row.parentId,
      type: row.type as SessionTreeNode['type'],
      role: (row.role ?? undefined) as SessionTreeNode['role'],
      preview: row.preview,
      timestamp: row.createdAt,
      children: [],
      label: row.label ?? undefined,
      isCurrent: row.isCurrent,
    })
  }
  let root: SessionTreeNode | null = null
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId)?.children.push(node)
    else root = node
  }
  return root
}

export function createRun(input: {
  sessionId: string
  agentId: string
  prompt: string
  providerId?: string
  modelId?: string
  thinkingLevel: string
  cwd: string
}) {
  const id = randomUUID()
  db.insert(chatRuns)
    .values({
      id,
      sessionId: input.sessionId,
      agentId: input.agentId,
      status: 'queued',
      prompt: input.prompt,
      providerId: input.providerId,
      modelId: input.modelId,
      thinkingLevel: input.thinkingLevel,
      cwd: input.cwd,
      createdAt: now(),
    })
    .run()
  return getRun(id)
}

export function getRun(id: string) {
  return db.select().from(chatRuns).where(eq(chatRuns.id, id)).get() ?? null
}

export function markRun(
  id: string,
  status: 'running' | 'completed' | 'failed' | 'aborted',
  error?: string,
) {
  db.update(chatRuns)
    .set({
      status,
      error,
      startedAt: status === 'running' ? now() : undefined,
      completedAt: status !== 'running' ? now() : undefined,
    })
    .where(eq(chatRuns.id, id))
    .run()
}

export function appendRunEvent(runId: string, type: string, payload: unknown) {
  db.insert(chatRunEvents)
    .values({
      id: randomUUID(),
      runId,
      type,
      payloadJson: JSON.stringify(payload),
      createdAt: now(),
    })
    .run()
}

export function appendMessage(input: {
  sessionId: string
  type: ChatMessage['type']
  content: string
  title?: string
  tokens?: number
  usage?: ChatMessage['usage']
}) {
  const id = randomUUID()
  const createdAt = now()
  const tokens = input.tokens ?? (input.usage ? input.usage.input + input.usage.output : undefined)
  db.insert(chatMessages)
    .values({
      id,
      sessionId: input.sessionId,
      type: input.type,
      title: input.title,
      content: input.content,
      tokens,
      usageInputTokens: input.usage?.input,
      usageOutputTokens: input.usage?.output,
      usageCacheReadTokens: input.usage?.cacheRead,
      usageCacheWriteTokens: input.usage?.cacheWrite,
      usageCostInput: input.usage?.cost?.input,
      usageCostOutput: input.usage?.cost?.output,
      usageCostCacheRead: input.usage?.cost?.cacheRead,
      usageCostCacheWrite: input.usage?.cost?.cacheWrite,
      usageCostTotal: input.usage?.cost?.total,
      createdAt,
    })
    .run()
  db.insert(sessionTreeNodes)
    .values({
      id: `node-${id}`,
      sessionId: input.sessionId,
      parentId: null,
      type: 'message',
      role: input.type === 'user' ? 'user' : input.type === 'assistant' ? 'assistant' : 'custom',
      preview: input.content.slice(0, 120),
      isCurrent: true,
      createdAt,
    })
    .run()
  const session = db.select().from(sessions).where(eq(sessions.id, input.sessionId)).get()
  db.update(sessions)
    .set({
      updatedAt: createdAt,
      activeNodeId: `node-${id}`,
      totalTokens: tokens ? (session?.totalTokens ?? 0) + tokens : session?.totalTokens,
      totalCost: input.usage?.cost?.total
        ? (session?.totalCost ?? 0) + input.usage.cost.total
        : session?.totalCost,
    })
    .where(eq(sessions.id, input.sessionId))
    .run()
  return id
}

function messageUsage(message: typeof chatMessages.$inferSelect): ChatMessage['usage'] | undefined {
  const hasUsage =
    message.usageInputTokens != null ||
    message.usageOutputTokens != null ||
    message.usageCacheReadTokens != null ||
    message.usageCacheWriteTokens != null ||
    message.usageCostInput != null ||
    message.usageCostOutput != null ||
    message.usageCostCacheRead != null ||
    message.usageCostCacheWrite != null ||
    message.usageCostTotal != null
  if (!hasUsage) return undefined

  const cost =
    message.usageCostInput != null ||
    message.usageCostOutput != null ||
    message.usageCostCacheRead != null ||
    message.usageCostCacheWrite != null ||
    message.usageCostTotal != null
      ? {
          input: message.usageCostInput ?? undefined,
          output: message.usageCostOutput ?? undefined,
          cacheRead: message.usageCostCacheRead ?? undefined,
          cacheWrite: message.usageCostCacheWrite ?? undefined,
          total: message.usageCostTotal ?? undefined,
        }
      : undefined

  return {
    input: message.usageInputTokens ?? 0,
    output: message.usageOutputTokens ?? 0,
    cacheRead: message.usageCacheReadTokens ?? 0,
    cacheWrite: message.usageCacheWriteTokens ?? 0,
    cost,
  }
}

export function resolveAgentRunConfig(agentId: string, providerId?: string | null) {
  const agent = getAgent(agentId)
  if (!agent) return null
  const selectedExtensionSet = new Set(agent.selectedExtensionIds)
  const packagePaths = installedPackagePaths(agent.selectedPackageSources, process.cwd())
  const selectedSkillSet = new Set(agent.selectedSkillIds)
  const selectedPromptSet = new Set(agent.selectedPromptIds)
  const selectedMcpSet = new Set(agent.selectedMcpConfigIds)
  const selectedProviderSet = new Set(agent.selectedProviderIds)
  const selectedModelSet = new Set(agent.selectedModelIds)
  const agentProviders = listProviders()
    .filter((provider) => selectedProviderSet.has(provider.id))
    .map((provider) => ({
      ...provider,
      models: provider.models.filter(
        (model) =>
          selectedModelSet.has(modelStorageId(provider.id, model.id)) ||
          selectedModelSet.has(model.id),
      ),
    }))
  const selectedProvider =
    agentProviders.find((provider) => provider.id === providerId) ??
    agentProviders.find((provider) => provider.id === agent.defaultProviderId) ??
    agentProviders.find((provider) => provider.isDefault) ??
    agentProviders[0] ??
    null
  return {
    agent,
    extensions: listStudioExtensions().filter((extension) =>
      selectedExtensionSet.has(extension.id),
    ),
    packagePaths,
    skills: listSkills().filter((skill) => selectedSkillSet.has(skill.id)),
    prompts: listPrompts().filter((prompt) => selectedPromptSet.has(prompt.id)),
    mcpConfigs: listMcpConfigs().filter((mcp) => selectedMcpSet.has(mcp.id)),
    providers: agentProviders,
    provider: selectedProvider,
  }
}

export function deleteManySessions(sessionIds: string[]) {
  if (sessionIds.length === 0) return
  db.delete(sessions).where(inArray(sessions.id, sessionIds)).run()
}

export function deleteSession(id: string) {
  db.delete(sessions).where(eq(sessions.id, id)).run()
}

export function duplicateSession(id: string) {
  const source = db.select().from(sessions).where(eq(sessions.id, id)).get()
  if (!source) return null
  const copy = createSession({
    agentId: source.agentId,
    name: `${source.name ?? 'Untitled session'} Copy`,
    cwd: source.cwd,
  })
  if (!copy) return null
  const sourceMessages = listSessionMessages(id)
  for (const message of sourceMessages) {
    appendMessage({
      sessionId: copy.id,
      type: message.type,
      title: message.title,
      content:
        message.type === 'user'
          ? buildPromptWithAttachments(message.content, message.attachments ?? [])
          : message.content,
      tokens: message.tokens,
    })
  }
  return getSession(copy.id)
}

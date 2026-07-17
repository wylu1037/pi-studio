import { abortRun as abortRegisteredRun, unregisterRun } from '@/lib/chat/run-registry'
import { getRunCoordinator } from '@/lib/chat/run-coordinator'
import { defaultPiSessionDir, runPiCli } from '@/lib/chat/pi-adapter'
import {
  appendRunEvent,
  getRun,
  getSession,
  markRun,
  resolveAgentRunConfig,
} from '@/lib/db/repository'

export function startRunExecution(runId: string) {
  const coordinator = getRunCoordinator()
  const handle = coordinator.start(runId, async (context) => {
    const run = getRun(runId)
    const config = run ? resolveAgentRunConfig(run.agentId, run.providerId) : null
    const publish = (event: string, payload: unknown) => {
      const envelope = context.publish(event, payload)
      appendRunEvent(runId, event, withEventSequence(payload, envelope.sequence))
      return envelope
    }

    context.onAbort(() => {
      abortRegisteredRun(runId)
    })

    if (!run || !config) {
      const message = run ? 'Agent not found' : 'Run not found'
      if (run) markRun(runId, 'failed', message)
      publish('error', { message })
      publish('done', { runId, status: 'failed' })
      context.fail(message)
      return
    }

    if (context.isAbortRequested()) {
      markRun(runId, 'aborted')
      publish('done', { runId, status: 'aborted' })
      context.abort()
      return
    }

    const provider = piProviderName(config.provider?.api)
    try {
      publish('connected', { runId })
      markRun(runId, 'running')
      publish('started', { runId })

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
        extensions: config.extensions.map((extension) => ({
          id: extension.id,
          path: extension.path,
        })),
        skills: config.skills.map((skill) => ({ name: skill.name, path: skill.path })),
        prompts: config.prompts.map((prompt) => prompt.path),
        packagePaths: config.packagePaths,
        mcpConfigs: (config.mcpConfigs ?? []).map((mcp) => ({
          id: mcp.id,
          name: mcp.name,
          description: mcp.description,
          command: mcp.command,
          args: mcp.args,
          env: mcp.env,
        })),
      })) {
        if (event.type === 'error') throw new Error(event.message)
        if (event.type === 'done') {
          appendRunEvent(runId, 'process_done', event)
          if (event.exitCode && event.exitCode !== 0)
            throw new Error(`pi exited with code ${event.exitCode}`)
          continue
        }
        publish(event.type, event)
      }

      if (context.isAbortRequested() || getRun(runId)?.status === 'aborted') {
        markRun(runId, 'aborted')
        publish('done', { runId, status: 'aborted' })
        context.abort()
        return
      }

      markRun(runId, 'completed')
      publish('done', { runId, status: 'completed' })
      context.complete()
    } catch (error) {
      if (context.isAbortRequested() || getRun(runId)?.status === 'aborted') {
        markRun(runId, 'aborted')
        publish('done', { runId, status: 'aborted' })
        context.abort()
        return
      }

      const message = error instanceof Error ? error.message : 'Unknown pi error'
      markRun(runId, 'failed', message)
      publish('error', { message })
      publish('done', { runId, status: 'failed' })
      context.fail(error)
    }
  })
  return handle.completion.finally(() => unregisterRun(runId))
}

function withEventSequence(payload: unknown, sequence: number) {
  return payload && typeof payload === 'object'
    ? { ...payload, sequence }
    : { value: payload, sequence }
}

function piProviderName(api?: string | null) {
  if (!api) return undefined
  if (api.startsWith('anthropic')) return 'anthropic'
  if (api.startsWith('google')) return 'google'
  if (api.startsWith('openai')) return 'openai'
  return undefined
}

import {
  getSupportedThinkingLevels,
  type Api,
  type Model,
  type ModelThinkingLevel,
} from '@earendil-works/pi-ai'
import { completeSimple } from '@earendil-works/pi-ai/compat'
import type { GlobalModel, GlobalModelProvider } from '@/lib/types'

export function toPiModel(
  provider: Pick<GlobalModelProvider, 'id' | 'baseUrl' | 'api' | 'headers'>,
  model: GlobalModel,
): Model<Api> {
  return {
    id: model.id,
    name: model.name ?? model.id,
    api: provider.api,
    provider: `pi-studio-${provider.id}`,
    baseUrl: provider.baseUrl,
    reasoning: model.reasoning ?? false,
    input: model.input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: model.contextWindow ?? 128_000,
    maxTokens: model.maxTokens ?? 8_192,
    headers: provider.headers,
  }
}

export function supportedThinkingLevels(
  provider: Pick<GlobalModelProvider, 'id' | 'baseUrl' | 'api' | 'headers'>,
  model: GlobalModel,
): ModelThinkingLevel[] {
  return getSupportedThinkingLevels(toPiModel(provider, model))
}

export async function testPiModel(
  provider: Pick<GlobalModelProvider, 'id' | 'baseUrl' | 'api' | 'apiKey' | 'headers'>,
  model: GlobalModel,
) {
  const result = await completeSimple(
    toPiModel(provider, model),
    {
      messages: [
        {
          role: 'user',
          content: 'Reply with exactly: OK',
          timestamp: Date.now(),
        },
      ],
    },
    {
      apiKey: provider.apiKey,
      headers: provider.headers,
      maxTokens: 8,
      signal: AbortSignal.timeout(15_000),
    },
  )

  if (result.stopReason === 'error' || result.stopReason === 'aborted') {
    throw new Error(result.errorMessage ?? `Model test ${result.stopReason}.`)
  }
  return result
}

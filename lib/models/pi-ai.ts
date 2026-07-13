import {
  getSupportedThinkingLevels,
  type Api,
  type Model,
  type ModelThinkingLevel,
  type ProviderHeaders,
  type SimpleStreamOptions,
} from '@earendil-works/pi-ai'
import { completeSimple, registerApiProvider, type ApiProvider } from '@earendil-works/pi-ai/compat'
import {
  stream as streamAnthropicMessages,
  streamSimple as streamSimpleAnthropicMessages,
  type AnthropicOptions,
} from '@earendil-works/pi-ai/api/anthropic-messages'
import type { GlobalModel, GlobalModelProvider } from '@/lib/types'

type PiProviderConnection = Pick<GlobalModelProvider, 'baseUrl' | 'api' | 'apiKey' | 'headers'>

function hasHeader(headers: Record<string, string> | undefined, name: string) {
  const expected = name.toLowerCase()
  return Object.keys(headers ?? {}).some((key) => key.toLowerCase() === expected)
}

function hasProviderHeader(headers: ProviderHeaders | undefined, name: string) {
  const expected = name.toLowerCase()
  return Object.keys(headers ?? {}).some((key) => key.toLowerCase() === expected)
}

function isOfficialAnthropicEndpoint(baseUrl: string) {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === 'api.anthropic.com'
  } catch {
    return false
  }
}

/**
 * The Anthropic SDK appends `/v1/messages` itself. Accept URLs copied from
 * provider dashboards without producing `/v1/v1/messages`.
 */
export function normalizePiBaseUrl(api: string, baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (api !== 'anthropic-messages') return trimmed

  try {
    const url = new URL(trimmed)
    url.pathname = url.pathname.replace(/\/(?:v1\/messages|v1)\/?$/, '') || '/'
    return url.toString().replace(/\/$/, '')
  } catch {
    return trimmed.replace(/\/(?:v1\/messages|v1)\/?$/, '')
  }
}

/** Anthropic Messages uses x-api-key unless custom headers explicitly own auth. */
export function resolvePiProviderConnection(provider: PiProviderConnection) {
  const headers = { ...(provider.headers ?? {}) }
  let apiKey = provider.apiKey?.trim() || undefined

  if (
    provider.api === 'anthropic-messages' &&
    (hasHeader(headers, 'authorization') || hasHeader(headers, 'x-api-key'))
  ) {
    // Header-owned authentication must not also make the Anthropic SDK inject
    // a second x-api-key header.
    apiKey = undefined
  }

  return {
    baseUrl: normalizePiBaseUrl(provider.api, provider.baseUrl),
    apiKey,
    headers,
  }
}

function thirdPartyAnthropicHeaders(
  model: Model<'anthropic-messages'>,
  headers: ProviderHeaders | undefined,
) {
  if (!model.provider.startsWith('pi-studio-') || isOfficialAnthropicEndpoint(model.baseUrl)) {
    return headers
  }

  const next: ProviderHeaders = { ...(headers ?? {}) }
  if (!hasProviderHeader(next, 'anthropic-beta')) next['anthropic-beta'] = null
  if (!hasProviderHeader(next, 'anthropic-dangerous-direct-browser-access')) {
    next['anthropic-dangerous-direct-browser-access'] = null
  }
  return next
}

const studioAnthropicProvider: ApiProvider<'anthropic-messages', AnthropicOptions> = {
  api: 'anthropic-messages',
  stream(model, context, options) {
    return streamAnthropicMessages(model, context, {
      ...options,
      interleavedThinking:
        model.provider.startsWith('pi-studio-') && !isOfficialAnthropicEndpoint(model.baseUrl)
          ? false
          : options?.interleavedThinking,
      headers: thirdPartyAnthropicHeaders(model, options?.headers),
    })
  },
  streamSimple(model, context, options?: SimpleStreamOptions) {
    return streamSimpleAnthropicMessages(model, context, {
      ...options,
      headers: thirdPartyAnthropicHeaders(model, options?.headers),
    })
  },
}

/** Re-register after Pi's ModelRegistry refresh resets built-in API providers. */
export function registerPiStudioApiProviders() {
  registerApiProvider(studioAnthropicProvider, 'pi-studio-anthropic-compat')
}

export function toPiModel(
  provider: Pick<GlobalModelProvider, 'id' | 'baseUrl' | 'api' | 'headers'>,
  model: GlobalModel,
): Model<Api> {
  return {
    id: model.id,
    name: model.name ?? model.id,
    api: provider.api,
    provider: `pi-studio-${provider.id}`,
    baseUrl: normalizePiBaseUrl(provider.api, provider.baseUrl),
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
  registerPiStudioApiProviders()
  const connection = resolvePiProviderConnection(provider)
  const result = await completeSimple(
    toPiModel({ ...provider, baseUrl: connection.baseUrl, headers: connection.headers }, model),
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
      apiKey: connection.apiKey,
      headers: connection.headers,
      maxTokens: 8,
      signal: AbortSignal.timeout(15_000),
    },
  )

  if (result.stopReason === 'error' || result.stopReason === 'aborted') {
    const message = result.errorMessage ?? `Model test ${result.stopReason}.`
    if (provider.api === 'anthropic-messages' && /(?:403|blocked)/i.test(message)) {
      throw new Error(
        `The Anthropic-compatible gateway blocked the request (403). Verify that ${connection.baseUrl} supports /v1/messages and that model "${model.id}" is enabled for this API key.`,
      )
    }
    throw new Error(message)
  }
  return result
}

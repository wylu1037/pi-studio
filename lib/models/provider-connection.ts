import type { GlobalModelProvider } from '@/lib/types'

type PiProviderConnection = Pick<GlobalModelProvider, 'baseUrl' | 'api' | 'apiKey' | 'headers'>

function hasHeader(headers: Record<string, string> | undefined, name: string) {
  const expected = name.toLowerCase()
  return Object.keys(headers ?? {}).some((key) => key.toLowerCase() === expected)
}

/** Normalize provider URLs before they are handed to Pi provider adapters. */
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
    apiKey = undefined
  }

  return {
    baseUrl: normalizePiBaseUrl(provider.api, provider.baseUrl),
    apiKey,
    headers,
  }
}

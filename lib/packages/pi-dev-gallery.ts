import type {
  GlobalPackage,
  PiPackageCatalog,
  PiPackageSort,
  PiPackageTypeFilter,
} from '@/lib/types'

const PI_PACKAGES_URL = 'https://pi.dev/packages'
const PAGE_SIZE = 50

export interface PiPackageCatalogQuery {
  name?: string
  type?: PiPackageTypeFilter
  sort?: PiPackageSort
  page?: number
}

function decodeHtml(value: string) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
}

function stripHtml(value: string) {
  return decodeHtml(
    value
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}

function packageId(name: string) {
  return `pi-dev:${Buffer.from(name).toString('base64url')}`
}

function packageSource(name: string) {
  return `npm:${name}`
}

function packageResources(types: Set<string>) {
  return {
    extensions: types.has('extension') ? 1 : 0,
    skills: types.has('skill') ? 1 : 0,
    prompts: types.has('prompt') ? 1 : 0,
    themes: types.has('theme') ? 1 : 0,
  }
}

function packageLinks(body: string) {
  const linksBody = /<div class="packages-links"[\s\S]*?>([\s\S]*?)<\/div>/.exec(body)?.[1] ?? ''
  const links = [...linksBody.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
  const byLabel = new Map(
    links.map((link) => [stripHtml(link[2]).toLowerCase(), decodeHtml(link[1])]),
  )
  const npmUrl = byLabel.get('npm')
  const repoUrl = byLabel.get('repo')
  const reportUrl = byLabel.get('report')
  return {
    ...(npmUrl ? { npmUrl } : {}),
    ...(repoUrl ? { repoUrl } : {}),
    ...(reportUrl ? { reportUrl } : {}),
  }
}

function parsePackageCard(attributes: string, body: string): GlobalPackage | null {
  const name = decodeHtml(/data-package-name="([^"]+)"/.exec(attributes)?.[1] ?? '')
  if (!name) return null
  const description = stripHtml(/<p class="packages-desc">([\s\S]*?)<\/p>/.exec(body)?.[1] ?? '')
  const metaBody = /<div class="packages-meta">([\s\S]*?)<\/div>/.exec(body)?.[1] ?? ''
  const meta = [...metaBody.matchAll(/<span>([\s\S]*?)<\/span>/g)].map((item) => stripHtml(item[1]))
  const types = new Set(
    decodeHtml(/data-package-types="([^"]*)"/.exec(attributes)?.[1] ?? '')
      .split(/\s+/)
      .filter(Boolean),
  )
  const downloads = decodeHtml(/data-package-downloads="([^"]*)"/.exec(attributes)?.[1] ?? '0')
  const publishedTimestamp = Number(/data-package-date="(\d+)"/.exec(attributes)?.[1])
  const resources = packageResources(types)
  const links = packageLinks(body)
  return {
    id: packageId(name),
    name,
    source: packageSource(name),
    type: 'npm',
    version: 'latest',
    scope: 'global',
    author: meta[0] ?? '',
    description,
    downloads: meta[1] ?? (downloads ? `${Number(downloads).toLocaleString()}/mo` : ''),
    resources,
    hasExtensions: resources.extensions > 0,
    status: 'installed',
    updatedAt: Number.isFinite(publishedTimestamp)
      ? new Date(publishedTimestamp).toISOString()
      : new Date().toISOString(),
    publishedAt: meta[2],
    ...links,
  }
}

function parseRecentPackage(body: string): GlobalPackage | null {
  const name = stripHtml(/<strong>([\s\S]*?)<\/strong>/.exec(body)?.[1] ?? '')
  if (!name) return null
  const values = [...body.matchAll(/<(?:span|small)>([\s\S]*?)<\/(?:span|small)>/g)].map((item) =>
    stripHtml(item[1]),
  )
  return {
    id: packageId(name),
    name,
    source: packageSource(name),
    type: 'npm',
    version: 'latest',
    scope: 'global',
    author: '',
    description: values[0] ?? '',
    downloads: '',
    resources: { extensions: 0, skills: 0, prompts: 0, themes: 0 },
    hasExtensions: false,
    status: 'installed',
    updatedAt: new Date().toISOString(),
    publishedAt: values[1],
  }
}

export function parsePiPackageCatalog(
  html: string,
  query: PiPackageCatalogQuery = {},
): PiPackageCatalog {
  const packages = [
    ...html.matchAll(/<article[^>]*data-package-card="true"([^>]*)>([\s\S]*?)<\/article>/g),
  ]
    .map((match) => parsePackageCard(match[1], match[2]))
    .filter((pkg): pkg is GlobalPackage => pkg !== null)

  const recentlyPublished = [
    ...html.matchAll(/<a[^>]*class="packages-recent-item"[^>]*>([\s\S]*?)<\/a>/g),
  ]
    .map((match) => parseRecentPackage(match[1]))
    .filter((pkg): pkg is GlobalPackage => pkg !== null)

  const count = /class="packages-count">\s*(\d+)-(\d+)\s*\/\s*(\d+)/.exec(html)
  const page = Math.max(1, query.page ?? 1)
  const total = Number(count?.[3] ?? packages.length)
  const start = Number(count?.[1] ?? (packages.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1))
  const end = Number(count?.[2] ?? start + packages.length - 1)
  return {
    packages,
    recentlyPublished,
    page,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    start,
    end,
  }
}

export async function listPiDevPackageCatalog(
  query: PiPackageCatalogQuery = {},
): Promise<PiPackageCatalog> {
  const url = new URL(PI_PACKAGES_URL)
  if (query.name?.trim()) url.searchParams.set('name', query.name.trim())
  if (query.type) url.searchParams.set('type', query.type)
  if (query.sort) url.searchParams.set('sort', query.sort)
  if (query.page && query.page > 1) url.searchParams.set('page', String(query.page))
  const response = await fetch(url, {
    headers: { accept: 'text/html' },
    next: { revalidate: 60 },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`pi.dev returned HTTP ${response.status}`)
  return parsePiPackageCatalog(await response.text(), query)
}

export async function loadPiPackageCatalog(query: PiPackageCatalogQuery = {}) {
  try {
    return await listPiDevPackageCatalog(query)
  } catch {
    return {
      packages: [],
      recentlyPublished: [],
      page: Math.max(1, query.page ?? 1),
      total: 0,
      totalPages: 1,
      start: 0,
      end: 0,
    } satisfies PiPackageCatalog
  }
}

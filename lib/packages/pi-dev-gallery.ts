import type { GlobalPackage } from '@/lib/types'

const PI_PACKAGES_URL = 'https://pi.dev/packages'

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

export async function listPiDevPackages(): Promise<GlobalPackage[]> {
  const response = await fetch(PI_PACKAGES_URL, {
    headers: { accept: 'text/html' },
    next: { revalidate: 15 * 60 },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`pi.dev returned HTTP ${response.status}`)
  const html = await response.text()
  const packages: GlobalPackage[] = []
  const articles = html.matchAll(
    /<article[^>]*data-package-card="true"([^>]*)>([\s\S]*?)<\/article>/g,
  )

  for (const match of articles) {
    const attributes = match[1]
    const body = match[2]
    const name = decodeHtml(/data-package-name="([^"]+)"/.exec(attributes)?.[1] ?? '')
    if (!name) continue
    const description = stripHtml(/<p class="packages-desc">([\s\S]*?)<\/p>/.exec(body)?.[1] ?? '')
    const metaBody = /<div class="packages-meta">([\s\S]*?)<\/div>/.exec(body)?.[1] ?? ''
    const meta = [...metaBody.matchAll(/<span>([\s\S]*?)<\/span>/g)].map((item) =>
      stripHtml(item[1]),
    )
    const types = new Set(
      decodeHtml(/data-package-types="([^"]*)"/.exec(attributes)?.[1] ?? '')
        .split(/\s+/)
        .filter(Boolean),
    )
    const downloads = /data-package-downloads="([^"]*)"/.exec(attributes)?.[1] ?? '0'
    packages.push({
      id: packageId(name),
      name,
      source: `npm:${name}`,
      type: 'npm',
      version: 'latest',
      scope: 'global',
      author: meta[0] ?? '',
      description,
      downloads: downloads ? `${Number(downloads).toLocaleString()}/mo` : '',
      resources: {
        extensions: types.has('extension') ? 1 : 0,
        skills: types.has('skill') ? 1 : 0,
        prompts: types.has('prompt') ? 1 : 0,
        themes: types.has('theme') ? 1 : 0,
      },
      hasExtensions: types.has('extension'),
      status: 'installed',
      updatedAt: new Date().toISOString(),
    })
    if (packages.length >= 48) break
  }
  return packages
}

export async function loadPackageGallery() {
  try {
    return await listPiDevPackages()
  } catch {
    return []
  }
}

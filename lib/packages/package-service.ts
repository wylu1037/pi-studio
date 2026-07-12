import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  DefaultPackageManager,
  getAgentDir,
  SettingsManager,
  type ResolvedPaths,
  type ResolvedResource,
} from '@earendil-works/pi-coding-agent'
import type { GlobalPackage, PackageType } from '@/lib/types'

type PackageScope = GlobalPackage['scope']
type GalleryPackage = GlobalPackage

function packageId(source: string, scope: PackageScope) {
  return `pi-package:${scope}:${Buffer.from(source).toString('base64url')}`
}

export function decodePackageId(id: string) {
  const match = /^pi-package:(global|project):(.+)$/.exec(id)
  if (!match) return null
  try {
    return {
      scope: match[1] as PackageScope,
      source: Buffer.from(match[2], 'base64url').toString('utf8'),
    }
  } catch {
    return null
  }
}

function sourceType(source: string): PackageType {
  if (source.startsWith('npm:') || (!source.includes('/') && !source.startsWith('.'))) {
    return 'npm'
  }
  if (
    source.startsWith('git:') ||
    source.startsWith('http://') ||
    source.startsWith('https://') ||
    source.startsWith('git@')
  ) {
    return 'git'
  }
  return 'local'
}

function emptyResources() {
  return { extensions: 0, skills: 0, prompts: 0, themes: 0 }
}

function packageMetadata(installedPath?: string) {
  if (!installedPath || !existsSync(installedPath)) return {}
  try {
    const packageJson = statSync(installedPath).isDirectory()
      ? join(installedPath, 'package.json')
      : join(dirname(installedPath), 'package.json')
    if (!existsSync(packageJson)) return {}
    const value = JSON.parse(readFileSync(packageJson, 'utf8')) as {
      name?: string
      version?: string
      author?: string | { name?: string }
      description?: string
    }
    return {
      name: value.name,
      version: value.version,
      author: typeof value.author === 'string' ? value.author : value.author?.name,
      description: value.description,
    }
  } catch {
    return {}
  }
}

function collectResourceCounts(paths: ResolvedPaths) {
  const result = new Map<string, ReturnType<typeof emptyResources>>()
  const add = (resource: ResolvedResource, kind: keyof ReturnType<typeof emptyResources>) => {
    if (!resource.enabled || resource.metadata.origin !== 'package') return
    const scope: PackageScope = resource.metadata.scope === 'project' ? 'project' : 'global'
    const key = packageId(resource.metadata.source, scope)
    const counts = result.get(key) ?? emptyResources()
    counts[kind] += 1
    result.set(key, counts)
  }
  paths.extensions.forEach((resource) => add(resource, 'extensions'))
  paths.skills.forEach((resource) => add(resource, 'skills'))
  paths.prompts.forEach((resource) => add(resource, 'prompts'))
  paths.themes.forEach((resource) => add(resource, 'themes'))
  return result
}

function createManager(cwd: string) {
  const agentDir = getAgentDir()
  const settingsManager = SettingsManager.create(cwd, agentDir, {
    projectTrusted: true,
  })
  return {
    settingsManager,
    packageManager: new DefaultPackageManager({ cwd, agentDir, settingsManager }),
  }
}

export async function listRuntimePackages(
  cwd: string,
  gallery: GalleryPackage[] = [],
) {
  const { packageManager } = createManager(cwd)
  const diagnostics = new Set<string>()
  const resolved = await packageManager.resolve(async (source) => {
    diagnostics.add(source)
    return 'skip'
  })
  const counts = collectResourceCounts(resolved)
  const installed = packageManager.listConfiguredPackages().map<GlobalPackage>((pkg) => {
    const scope: PackageScope = pkg.scope === 'project' ? 'project' : 'global'
    const metadata = packageMetadata(pkg.installedPath)
    const id = packageId(pkg.source, scope)
    const resources = counts.get(id) ?? emptyResources()
    return {
      id,
      name: metadata.name ?? pkg.source.replace(/^npm:/, ''),
      source: pkg.source,
      type: sourceType(pkg.source),
      version: metadata.version ?? 'unknown',
      scope,
      author: metadata.author ?? '',
      description:
        metadata.description ??
        (diagnostics.has(pkg.source)
          ? 'Configured package is not installed or could not be resolved.'
          : 'Pi package'),
      downloads: '',
      resources,
      hasExtensions: resources.extensions > 0,
      status: diagnostics.has(pkg.source) ? 'error' : 'installed',
      updatedAt: new Date().toISOString(),
    }
  })
  const installedSources = new Set(installed.map((pkg) => pkg.source))
  return {
    installed,
    gallery: gallery.filter((pkg) => !installedSources.has(pkg.source)),
  }
}

async function refreshSessions() {
  const { disposeAllSdkSessions } = await import('@/lib/chat/sdk-session-manager')
  disposeAllSdkSessions()
}

export async function installRuntimePackage(input: {
  source: string
  scope: PackageScope
  cwd: string
}) {
  const { packageManager } = createManager(input.cwd)
  await packageManager.installAndPersist(input.source, {
    local: input.scope === 'project',
  })
  await refreshSessions()
}

export async function updateRuntimePackage(input: {
  source?: string
  cwd: string
}) {
  const { packageManager } = createManager(input.cwd)
  await packageManager.update(input.source)
  await refreshSessions()
}

export async function removeRuntimePackage(input: {
  source: string
  scope: PackageScope
  cwd: string
}) {
  const { packageManager } = createManager(input.cwd)
  await packageManager.removeAndPersist(input.source, {
    local: input.scope === 'project',
  })
  await refreshSessions()
}

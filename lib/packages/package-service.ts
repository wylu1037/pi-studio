import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import {
  DefaultPackageManager,
  getAgentDir,
  SettingsManager,
  type PackageSource,
  type ResolvedPaths,
  type ResolvedResource,
} from '@earendil-works/pi-coding-agent'
import type { GlobalExtension, GlobalPackage, PackageType } from '@/lib/types'
import { setLocalExtensionEnabled, setPackageExtensionEnabled } from './extension-filters'
import { getProjectTrustState, isProjectTrusted } from '@/lib/extensions/project-trust'

export { setPackageExtensionEnabled } from './extension-filters'

type PackageScope = GlobalPackage['scope']
type GalleryPackage = GlobalPackage

function packageId(source: string, scope: PackageScope) {
  return `pi-package:${scope}:${Buffer.from(source).toString('base64url')}`
}

export function extensionId(resource: ResolvedResource) {
  const scope: PackageScope = resource.metadata.scope === 'project' ? 'project' : 'global'
  return `pi-extension:${scope}:${Buffer.from(resource.metadata.source).toString('base64url')}:${Buffer.from(resource.path).toString('base64url')}`
}

export function decodeExtensionId(id: string) {
  const match = /^pi-extension:(global|project):([^:]+):(.+)$/.exec(id)
  if (!match) return null
  try {
    return {
      scope: match[1] as PackageScope,
      source: Buffer.from(match[2], 'base64url').toString('utf8'),
      path: Buffer.from(match[3], 'base64url').toString('utf8'),
    }
  } catch {
    return null
  }
}

function extensionName(path: string) {
  const file = path.split('/').at(-1) ?? path
  const name = file.replace(/\.(?:m?[jt]s|c[jt]s)$/, '') || file
  if (name === 'index') {
    return path.split('/').slice(0, -1).at(-1) ?? name
  }
  return name
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

function createManager(cwd: string, projectTrusted = isProjectTrusted(cwd)) {
  const agentDir = getAgentDir()
  const settingsManager = SettingsManager.create(cwd, agentDir, {
    projectTrusted,
  })
  return {
    settingsManager,
    packageManager: new DefaultPackageManager({ cwd, agentDir, settingsManager }),
  }
}

export async function listRuntimePackages(cwd: string, gallery: GalleryPackage[] = []) {
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

export async function listRuntimeExtensions(cwd: string): Promise<GlobalExtension[]> {
  const { packageManager } = createManager(cwd)
  const resolved = await packageManager.resolve(async () => 'skip')
  const trust = getProjectTrustState(cwd)
  const trustedPackageManager = trust.trusted
    ? packageManager
    : createManager(cwd, true).packageManager
  const allResolved = trust.trusted
    ? resolved
    : await trustedPackageManager.resolve(async () => 'skip')
  const resolvedExtensions = trust.trusted
    ? resolved.extensions
    : mergeUntrustedProjectExtensions(resolved.extensions, allResolved.extensions)
  const packages = new Map(
    trustedPackageManager.listConfiguredPackages().map((pkg) => {
      const scope: PackageScope = pkg.scope === 'project' ? 'project' : 'global'
      return [
        `${scope}:${pkg.source}`,
        { ...pkg, scope, metadata: packageMetadata(pkg.installedPath) },
      ]
    }),
  )
  return resolvedExtensions.map((resource) => ({
    id: extensionId(resource),
    name: extensionName(resource.path),
    path: resource.path,
    relativePath: resource.metadata.baseDir
      ? relative(resource.metadata.baseDir, resource.path).replaceAll('\\', '/')
      : undefined,
    source: resource.metadata.source,
    scope: resource.metadata.scope === 'project' ? 'project' : 'global',
    origin: resource.metadata.origin,
    enabled: resource.enabled,
    packageManaged: resource.metadata.origin === 'package',
    status:
      !trust.trusted && resource.metadata.scope === 'project'
        ? 'trust-required'
        : resource.enabled
          ? 'enabled'
          : 'disabled',
    package:
      resource.metadata.origin === 'package'
        ? (() => {
            const scope: PackageScope = resource.metadata.scope === 'project' ? 'project' : 'global'
            const pkg = packages.get(`${scope}:${resource.metadata.source}`)
            return {
              source: resource.metadata.source,
              name: pkg?.metadata.name,
              version: pkg?.metadata.version,
              installedPath: pkg?.installedPath,
            }
          })()
        : undefined,
    capabilities: {
      tools: [],
      commands: [],
      shortcuts: [],
      flags: [],
      providers: [],
      hooks: [],
      ui: false,
    },
  }))
}

function mergeUntrustedProjectExtensions(visible: ResolvedResource[], trusted: ResolvedResource[]) {
  const visibleKeys = new Set(
    visible.map((resource) => `${resource.metadata.scope}:${resource.path}`),
  )
  return [
    ...visible,
    ...trusted.filter(
      (resource) =>
        resource.metadata.scope === 'project' &&
        !visibleKeys.has(`${resource.metadata.scope}:${resource.path}`),
    ),
  ]
}

function packageSourceValue(entry: PackageSource) {
  return typeof entry === 'string' ? entry : entry.source
}

function setPackageExtensionsEnabled(entries: PackageSource[], source: string, enabled: boolean) {
  return entries.map((entry): PackageSource => {
    if (packageSourceValue(entry) !== source) return entry
    if (!enabled) {
      return {
        ...(typeof entry === 'string' ? { source: entry } : entry),
        extensions: [],
      }
    }
    if (typeof entry === 'string') return entry
    const { extensions: _extensions, ...rest } = entry
    return rest
  })
}

export async function setRuntimeExtensionEnabled(input: {
  source: string
  scope: PackageScope
  enabled: boolean
  extensionId?: string
  relativePath?: string
  cwd: string
}) {
  const { settingsManager } = createManager(input.cwd)
  const decoded = input.extensionId ? decodeExtensionId(input.extensionId) : null
  const source = decoded?.source ?? input.source
  const scope = decoded?.scope ?? input.scope
  let relativePath = input.relativePath
  if (!relativePath && decoded) {
    const extension = (await listRuntimeExtensions(input.cwd)).find(
      (item) => item.id === input.extensionId,
    )
    relativePath = extension?.relativePath
  }
  const update = (entries: PackageSource[]) =>
    relativePath
      ? setPackageExtensionEnabled(entries, source, relativePath, input.enabled)
      : setPackageExtensionsEnabled(entries, source, input.enabled)

  if (scope === 'project') {
    settingsManager.setProjectPackages(update(settingsManager.getProjectSettings().packages ?? []))
  } else {
    settingsManager.setPackages(update(settingsManager.getGlobalSettings().packages ?? []))
  }
  await settingsManager.flush()
  await refreshSessions(input.cwd)
}

export async function setRuntimeExtensionState(input: {
  id: string
  enabled: boolean
  cwd: string
}) {
  const extension = (await listRuntimeExtensions(input.cwd)).find((item) => item.id === input.id)
  if (!extension) throw new Error('Extension not found.')
  if (!extension.relativePath) {
    throw new Error('This extension cannot be toggled individually.')
  }
  if (!extension.packageManaged) {
    const { settingsManager } = createManager(input.cwd)
    if (extension.scope === 'project') {
      settingsManager.setProjectExtensionPaths(
        setLocalExtensionEnabled(
          settingsManager.getProjectSettings().extensions ?? [],
          extension.relativePath,
          input.enabled,
        ),
      )
    } else {
      settingsManager.setExtensionPaths(
        setLocalExtensionEnabled(
          settingsManager.getGlobalSettings().extensions ?? [],
          extension.relativePath,
          input.enabled,
        ),
      )
    }
    await settingsManager.flush()
    await refreshSessions(input.cwd)
    return listRuntimeExtensions(input.cwd)
  }
  await setRuntimeExtensionEnabled({
    source: extension.source,
    scope: extension.scope,
    enabled: input.enabled,
    extensionId: extension.id,
    relativePath: extension.relativePath,
    cwd: input.cwd,
  })
  return listRuntimeExtensions(input.cwd)
}

async function refreshSessions(cwd: string) {
  const { reloadSdkSessions } = await import('@/lib/chat/sdk-session-manager')
  await reloadSdkSessions({ cwd, mode: 'idle-only' })
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
  await refreshSessions(input.cwd)
}

export async function updateRuntimePackage(input: { source?: string; cwd: string }) {
  const { packageManager } = createManager(input.cwd)
  await packageManager.update(input.source)
  await refreshSessions(input.cwd)
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
  await refreshSessions(input.cwd)
}

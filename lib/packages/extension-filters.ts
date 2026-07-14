export interface PackageSourceObject {
  source: string
  autoload?: boolean
  extensions?: string[]
}

export type PackageSourceLike = string | PackageSourceObject

function packageSourceValue(entry: PackageSourceLike) {
  return typeof entry === 'string' ? entry : entry.source
}

function normalizedRelativePath(value: string) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '')
}

function patternTargetsPath(pattern: string, relativePath: string) {
  const target = pattern.replace(/^[!+-]/, '')
  return normalizedRelativePath(target) === normalizedRelativePath(relativePath)
}

export function setPackageExtensionEnabled<T extends PackageSourceLike>(
  entries: T[],
  source: string,
  relativePath: string,
  enabled: boolean,
) {
  const normalizedPath = normalizedRelativePath(relativePath)
  return entries.map((entry): T => {
    if (packageSourceValue(entry) !== source) return entry

    const objectEntry: PackageSourceObject =
      typeof entry === 'string' ? { source: entry } : { ...entry }
    const existingPatterns = objectEntry.extensions

    if (enabled && existingPatterns === undefined) return entry
    if (!enabled && existingPatterns?.length === 0) return entry

    const nextPatterns = (existingPatterns ?? []).filter(
      (pattern) => !patternTargetsPath(pattern, normalizedPath),
    )

    if (!enabled) {
      nextPatterns.push(`-${normalizedPath}`)
      return { ...objectEntry, extensions: [...new Set(nextPatterns)] } as T
    }

    if (objectEntry.autoload === false) {
      nextPatterns.push(`+${normalizedPath}`)
      return { ...objectEntry, extensions: [...new Set(nextPatterns)] } as T
    }

    if (existingPatterns?.length === 0) {
      return { ...objectEntry, extensions: [normalizedPath] } as T
    }

    const hasPositiveIncludes = nextPatterns.some((pattern) => !/^[!+-]/.test(pattern))
    const hasExclusionPattern = nextPatterns.some((pattern) => pattern.startsWith('!'))
    if (hasPositiveIncludes || hasExclusionPattern) nextPatterns.push(`+${normalizedPath}`)

    if (nextPatterns.length === 0) {
      const { extensions: _extensions, ...rest } = objectEntry
      return (Object.keys(rest).length === 1 && rest.source === source ? source : rest) as T
    }

    return { ...objectEntry, extensions: [...new Set(nextPatterns)] } as T
  })
}

export function setLocalExtensionEnabled(
  entries: string[],
  relativePath: string,
  enabled: boolean,
) {
  const normalizedPath = normalizedRelativePath(relativePath)
  const next = entries.filter(
    (entry) => !/^[!+-]/.test(entry) || !patternTargetsPath(entry, normalizedPath),
  )
  if (!enabled) next.push(`-${normalizedPath}`)
  return [...new Set(next)]
}

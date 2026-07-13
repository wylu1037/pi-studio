import { realpathSync, statSync } from 'node:fs'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'

export const audioExtensions = ['.mp3'] as const
export const imageExtensions = ['.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp'] as const
export const mediaExtensions = [...audioExtensions, ...imageExtensions] as const

export function resolveSessionMediaPath(
  cwd: string,
  href: string,
  allowedExtensions: readonly string[] = mediaExtensions,
) {
  const requestedPath = localPathFromHref(href)
  if (!requestedPath || !allowedExtensions.includes(extname(requestedPath).toLowerCase())) {
    return null
  }

  let root: string
  try {
    root = realpathSync(cwd)
  } catch {
    return null
  }

  const candidates = isAbsolute(requestedPath)
    ? [requestedPath, resolve(root, 'public', `.${requestedPath}`)]
    : [resolve(root, requestedPath)]

  for (const candidate of candidates) {
    try {
      const resolved = realpathSync(candidate)
      const relativePath = relative(root, resolved)
      if (
        relativePath &&
        !relativePath.startsWith(`..${sep}`) &&
        relativePath !== '..' &&
        !isAbsolute(relativePath) &&
        statSync(resolved).isFile()
      ) {
        return resolved
      }
    } catch {
      // Try the next supported local-path form.
    }
  }

  return null
}

export function parseMediaRange(range: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  if (!match || size <= 0) return null

  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) return null

  let start: number
  let end: number
  if (!rawStart) {
    const suffixLength = Number(rawEnd)
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null
    start = Math.max(0, size - suffixLength)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd ? Number(rawEnd) : size - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null
    end = Math.min(end, size - 1)
  }

  if (start < 0 || start >= size || end < start) return null
  return { start, end }
}

function localPathFromHref(href: string) {
  const cleanHref = href.split(/[?#]/, 1)[0]
  if (/^https?:\/\//i.test(cleanHref)) {
    try {
      const url = new URL(cleanHref)
      if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null
      return decodePath(url.pathname)
    } catch {
      return null
    }
  }
  return decodePath(cleanHref)
}

function decodePath(path: string) {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

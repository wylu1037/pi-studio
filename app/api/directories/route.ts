import { readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import type { NextRequest } from 'next/server'

const MAX_DIRECTORY_ENTRIES = 500

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const rawPath = request.nextUrl.searchParams.get('path')?.trim()
  const requestedPath =
    rawPath === '~'
      ? homedir()
      : rawPath?.startsWith('~/')
        ? resolve(homedir(), rawPath.slice(2))
        : rawPath || homedir()

  try {
    const path = await realpath(resolve(requestedPath))
    if (!(await stat(path)).isDirectory()) {
      return Response.json({ error: 'The selected path is not a directory.' }, { status: 400 })
    }

    const children = await readdir(path, { withFileTypes: true })
    const entries = children
      .filter((entry) => entry.isDirectory())
      .sort((left, right) =>
        left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }),
      )
      .slice(0, MAX_DIRECTORY_ENTRIES)
      .map((entry) => ({ name: entry.name, path: resolve(path, entry.name) }))
    const parent = dirname(path)
    return Response.json({
      path,
      parent: parent === path ? undefined : parent,
      entries,
    })
  } catch {
    return Response.json({ error: 'The requested directory could not be opened.' }, { status: 404 })
  }
}

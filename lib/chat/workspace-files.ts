import { lstat, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

export type WorkspaceEntry = {
  name: string
  path: string
  type: 'directory' | 'file' | 'symlink'
}

export type WorkspaceDirectory = {
  entries: WorkspaceEntry[]
  truncated: boolean
}

const MAX_DIRECTORY_ENTRIES = 500

export class WorkspaceFilesError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'WorkspaceFilesError'
  }
}

export async function listWorkspaceDirectory(
  cwd: string,
  requestedPath = '',
): Promise<WorkspaceDirectory> {
  const root = resolve(cwd)
  const target = resolve(root, requestedPath || '.')
  const pathFromRoot = relative(root, target)

  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new WorkspaceFilesError('The requested path is outside the agent workspace.', 403)
  }

  let realRoot: string
  let realTarget: string
  let stats
  try {
    ;[realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)])
    stats = await lstat(realTarget)
  } catch {
    throw new WorkspaceFilesError('The requested workspace path was not found.', 404)
  }

  const realPathFromRoot = relative(realRoot, realTarget)
  if (
    realPathFromRoot === '..' ||
    realPathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(realPathFromRoot)
  ) {
    throw new WorkspaceFilesError('The requested path is outside the agent workspace.', 403)
  }

  if (!stats.isDirectory()) {
    throw new WorkspaceFilesError('The requested workspace path is not a directory.', 400)
  }

  try {
    const directoryEntries = await readdir(realTarget, { withFileTypes: true })
    const entries = directoryEntries
      .map<WorkspaceEntry>((entry) => ({
        name: entry.name,
        path: toWorkspacePath(join(pathFromRoot, entry.name)),
        type: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'file',
      }))
      .sort(compareWorkspaceEntries)

    return {
      entries: entries.slice(0, MAX_DIRECTORY_ENTRIES),
      truncated: entries.length > MAX_DIRECTORY_ENTRIES,
    }
  } catch (error) {
    if (error instanceof WorkspaceFilesError) throw error
    throw new WorkspaceFilesError('Unable to read this workspace directory.', 403)
  }
}

function toWorkspacePath(path: string) {
  if (path === '.') return ''
  return path.split(sep).join('/')
}

function compareWorkspaceEntries(left: WorkspaceEntry, right: WorkspaceEntry) {
  if (left.type === 'directory' && right.type !== 'directory') return -1
  if (left.type !== 'directory' && right.type === 'directory') return 1
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
}

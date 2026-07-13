import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

export const MAX_ENV_FILE_BYTES = 1024 * 1024

export class EnvFileError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'EnvFileError'
    this.status = status
  }
}

export function readEnvFile(inputPath: string, baseDir = process.cwd()) {
  const path = resolveEnvFilePath(inputPath, baseDir)
  if (!existsSync(path)) {
    return { path, content: '', exists: false, byteSize: 0, updatedAt: null }
  }

  const stats = statSync(path)
  return {
    path,
    content: readFileSync(path, 'utf8'),
    exists: true,
    byteSize: stats.size,
    updatedAt: stats.mtime.toISOString(),
  }
}

export function writeEnvFile(inputPath: string, content: string, baseDir = process.cwd()) {
  const byteSize = Buffer.byteLength(content, 'utf8')
  if (byteSize > MAX_ENV_FILE_BYTES) {
    throw new EnvFileError('Environment file must be 1 MB or smaller.', 413)
  }

  const path = resolveEnvFilePath(inputPath, baseDir)
  const temporaryPath = join(dirname(path), `.${basename(path)}.pi-studio-${randomUUID()}.tmp`)
  try {
    writeFileSync(temporaryPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    renameSync(temporaryPath, path)
    chmodSync(path, 0o600)
  } catch (error) {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
    throw error
  }

  const stats = statSync(path)
  return {
    path,
    exists: true,
    byteSize: stats.size,
    updatedAt: stats.mtime.toISOString(),
  }
}

export function resolveEnvFilePath(inputPath: string, baseDir = process.cwd()) {
  const trimmed = inputPath.trim()
  if (!trimmed) throw new EnvFileError('Enter an environment file path.', 400)

  const expanded =
    trimmed === '~'
      ? homedir()
      : trimmed.startsWith('~/')
        ? join(homedir(), trimmed.slice(2))
        : trimmed
  const requested = resolve(baseDir, expanded)
  const filename = basename(requested)
  if (!/^\.env(?:\.[A-Za-z0-9_-]+)*$/.test(filename)) {
    throw new EnvFileError('File name must be .env or a variant such as .env.local.', 400)
  }

  let parent: string
  try {
    parent = realpathSync(dirname(requested))
  } catch {
    throw new EnvFileError('Parent directory does not exist.', 400)
  }

  const path = join(parent, filename)
  if (existsSync(path)) {
    const stats = lstatSync(path)
    if (stats.isSymbolicLink()) {
      throw new EnvFileError('Symbolic links are not supported for environment files.', 400)
    }
    if (!stats.isFile()) throw new EnvFileError('Selected path is not a file.', 400)
    if (stats.size > MAX_ENV_FILE_BYTES) {
      throw new EnvFileError('Environment file must be 1 MB or smaller.', 413)
    }
  }

  return path
}

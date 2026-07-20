import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { EnvFileError, MAX_ENV_FILE_BYTES, readEnvFile, writeEnvFile } from '@/lib/env-files'
import { piStudioDataDir } from '@/lib/runtime/paths'

const ENV_VERSION_SCHEMA = 1

export const MAX_ENV_VERSION_NOTE_LENGTH = 500

type StoredEnvVersion = {
  id: string
  number: number
  note: string
  byteSize: number
  variableCount: number
  createdAt: string
  updatedAt: string
}

type EnvVersionManifest = {
  schemaVersion: number
  path: string
  activeVersionId: string
  nextVersion: number
  versions: StoredEnvVersion[]
}

export type EnvVersionSummary = StoredEnvVersion & {
  label: string
  active: boolean
}

export type EnvVersionFilePayload = {
  path: string
  exists: boolean
  diskByteSize: number
  diskUpdatedAt: string | null
  activeVersionId: string
  inSync: boolean
  versions: EnvVersionSummary[]
  selectedVersion: EnvVersionSummary & { content: string }
}

type EnvVersionStoreOptions = {
  baseDir?: string
  storeDir?: string
}

export function envVersionStoreDir() {
  return join(piStudioDataDir(), 'environment-versions')
}

export function getEnvVersionFile(
  inputPath: string,
  selectedVersionId?: string,
  options: EnvVersionStoreOptions = {},
) {
  const context = loadVersionContext(inputPath, options)
  return createPayload(context, selectedVersionId)
}

export function copyEnvVersion(
  inputPath: string,
  sourceVersionId: string,
  note = '',
  options: EnvVersionStoreOptions = {},
) {
  const context = loadVersionContext(inputPath, options)
  const source = findVersion(context.manifest, sourceVersionId)
  const content = readVersionContent(context.directory, source.id)
  const now = new Date().toISOString()
  const version: StoredEnvVersion = {
    id: randomUUID(),
    number: context.manifest.nextVersion,
    note: normalizeNote(note),
    byteSize: Buffer.byteLength(content, 'utf8'),
    variableCount: countVariables(content),
    createdAt: now,
    updatedAt: now,
  }

  writeSecureFile(versionContentPath(context.directory, version.id), content)
  try {
    context.manifest.versions.push(version)
    context.manifest.nextVersion += 1
    writeManifest(context.directory, context.manifest)
  } catch (error) {
    unlinkIfExists(versionContentPath(context.directory, version.id))
    throw error
  }

  return createPayload(context, version.id)
}

export function saveEnvVersion(
  inputPath: string,
  versionId: string,
  content: string,
  note: string,
  options: EnvVersionStoreOptions = {},
) {
  validateContent(content)
  const normalizedNote = normalizeNote(note)
  const context = loadVersionContext(inputPath, options)
  const version = findVersion(context.manifest, versionId)
  const previousContent = readVersionContent(context.directory, version.id)
  const active = context.manifest.activeVersionId === version.id

  if (active) writeEnvFile(context.manifest.path, content)

  try {
    writeSecureFile(versionContentPath(context.directory, version.id), content)
  } catch (error) {
    if (active) restoreDiskFile(context.manifest.path, context.disk.exists, previousContent)
    throw error
  }

  version.note = normalizedNote
  version.byteSize = Buffer.byteLength(content, 'utf8')
  version.variableCount = countVariables(content)
  version.updatedAt = new Date().toISOString()
  writeManifest(context.directory, context.manifest)

  return createPayload(loadVersionContext(inputPath, options), version.id)
}

export function activateEnvVersion(
  inputPath: string,
  versionId: string,
  options: EnvVersionStoreOptions = {},
) {
  const context = loadVersionContext(inputPath, options)
  const version = findVersion(context.manifest, versionId)
  const content = readVersionContent(context.directory, version.id)
  const previousActiveVersionId = context.manifest.activeVersionId

  writeEnvFile(context.manifest.path, content)
  try {
    context.manifest.activeVersionId = version.id
    writeManifest(context.directory, context.manifest)
  } catch (error) {
    context.manifest.activeVersionId = previousActiveVersionId
    restoreDiskFile(context.manifest.path, context.disk.exists, context.disk.content)
    throw error
  }

  return createPayload(loadVersionContext(inputPath, options), version.id)
}

export function deleteEnvVersionHistory(
  canonicalPath: string,
  options: Pick<EnvVersionStoreOptions, 'storeDir'> = {},
) {
  const path = canonicalPath.trim()
  if (!path) throw new EnvFileError('Enter an environment file path.', 400)
  const storeDir = options.storeDir ?? envVersionStoreDir()
  rmSync(join(storeDir, createPathKey(path)), { recursive: true, force: true })
  return { path, deleted: true }
}

export function deleteEnvVersion(
  inputPath: string,
  versionId: string,
  selectedVersionId?: string,
  options: EnvVersionStoreOptions = {},
) {
  const context = loadVersionContext(inputPath, options)
  const version = findVersion(context.manifest, versionId)
  if (version.id === context.manifest.activeVersionId) {
    throw new EnvFileError('Activate another version before deleting this one.', 400)
  }
  if (context.manifest.versions.length <= 1) {
    throw new EnvFileError('At least one environment version must be kept.', 400)
  }

  const contentPath = versionContentPath(context.directory, version.id)
  const content = readVersionContent(context.directory, version.id)
  const previousVersions = context.manifest.versions
  const remainingVersions = previousVersions.filter((candidate) => candidate.id !== version.id)

  unlinkIfExists(contentPath)
  try {
    context.manifest.versions = remainingVersions
    writeManifest(context.directory, context.manifest)
  } catch (error) {
    context.manifest.versions = previousVersions
    writeSecureFile(contentPath, content)
    throw error
  }

  const nextSelectedVersionId =
    selectedVersionId && remainingVersions.some((candidate) => candidate.id === selectedVersionId)
      ? selectedVersionId
      : context.manifest.activeVersionId
  return createPayload(loadVersionContext(inputPath, options), nextSelectedVersionId)
}

function loadVersionContext(inputPath: string, options: EnvVersionStoreOptions) {
  const disk = readEnvFile(inputPath, options.baseDir)
  const storeDir = options.storeDir ?? envVersionStoreDir()
  const directory = join(storeDir, createPathKey(disk.path))
  const manifestPath = join(directory, 'manifest.json')

  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)

  let manifest: EnvVersionManifest
  if (existsSync(manifestPath)) {
    manifest = parseManifest(readFileSync(manifestPath, 'utf8'), disk.path)
  } else {
    const now = new Date().toISOString()
    const initialVersion: StoredEnvVersion = {
      id: randomUUID(),
      number: 0,
      note: 'Initial snapshot',
      byteSize: disk.byteSize,
      variableCount: countVariables(disk.content),
      createdAt: now,
      updatedAt: now,
    }
    manifest = {
      schemaVersion: ENV_VERSION_SCHEMA,
      path: disk.path,
      activeVersionId: initialVersion.id,
      nextVersion: 1,
      versions: [initialVersion],
    }
    writeSecureFile(versionContentPath(directory, initialVersion.id), disk.content)
    writeManifest(directory, manifest)
  }

  return { disk, directory, manifest }
}

function createPayload(
  context: ReturnType<typeof loadVersionContext>,
  selectedVersionId?: string,
): EnvVersionFilePayload {
  const selected = findVersion(
    context.manifest,
    selectedVersionId ?? context.manifest.activeVersionId,
  )
  const active = findVersion(context.manifest, context.manifest.activeVersionId)
  const activeContent = readVersionContent(context.directory, active.id)
  const versions = [...context.manifest.versions]
    .sort((left, right) => right.number - left.number)
    .map((version) => toSummary(version, context.manifest.activeVersionId))

  return {
    path: context.manifest.path,
    exists: context.disk.exists,
    diskByteSize: context.disk.byteSize,
    diskUpdatedAt: context.disk.updatedAt,
    activeVersionId: context.manifest.activeVersionId,
    inSync: context.disk.content === activeContent,
    versions,
    selectedVersion: {
      ...toSummary(selected, context.manifest.activeVersionId),
      content: readVersionContent(context.directory, selected.id),
    },
  }
}

function parseManifest(raw: string, expectedPath: string): EnvVersionManifest {
  try {
    const value = JSON.parse(raw) as Partial<EnvVersionManifest>
    if (
      value.schemaVersion !== ENV_VERSION_SCHEMA ||
      value.path !== expectedPath ||
      typeof value.activeVersionId !== 'string' ||
      !Number.isInteger(value.nextVersion) ||
      !Array.isArray(value.versions) ||
      !value.versions.every(isStoredVersion) ||
      !value.versions.some((version) => version.id === value.activeVersionId)
    ) {
      throw new Error('Invalid manifest')
    }
    return value as EnvVersionManifest
  } catch {
    throw new EnvFileError('Environment version history is damaged and cannot be opened.', 500)
  }
}

function isStoredVersion(value: unknown): value is StoredEnvVersion {
  if (!value || typeof value !== 'object') return false
  const version = value as Partial<StoredEnvVersion>
  return (
    typeof version.id === 'string' &&
    Number.isInteger(version.number) &&
    typeof version.note === 'string' &&
    typeof version.byteSize === 'number' &&
    typeof version.variableCount === 'number' &&
    typeof version.createdAt === 'string' &&
    typeof version.updatedAt === 'string'
  )
}

function findVersion(manifest: EnvVersionManifest, versionId: string) {
  const version = manifest.versions.find((candidate) => candidate.id === versionId)
  if (!version) throw new EnvFileError('Environment version was not found.', 404)
  return version
}

function toSummary(version: StoredEnvVersion, activeVersionId: string): EnvVersionSummary {
  return {
    ...version,
    label: `v${version.number}`,
    active: version.id === activeVersionId,
  }
}

function writeManifest(directory: string, manifest: EnvVersionManifest) {
  writeSecureFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

function readVersionContent(directory: string, versionId: string) {
  const path = versionContentPath(directory, versionId)
  if (!existsSync(path)) {
    throw new EnvFileError('Environment version content is missing.', 500)
  }
  return readFileSync(path, 'utf8')
}

function versionContentPath(directory: string, versionId: string) {
  return join(directory, `${versionId}.env`)
}

function writeSecureFile(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporaryPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    renameSync(temporaryPath, path)
    chmodSync(path, 0o600)
  } catch (error) {
    unlinkIfExists(temporaryPath)
    throw error
  }
}

function restoreDiskFile(path: string, existed: boolean, content: string) {
  try {
    if (existed) writeEnvFile(path, content)
    else unlinkIfExists(path)
  } catch {
    // Preserve the original error. A later read will report the file as out of sync.
  }
}

function unlinkIfExists(path: string) {
  if (existsSync(path)) unlinkSync(path)
}

function normalizeNote(note: string) {
  const normalized = note.trim()
  if (normalized.length > MAX_ENV_VERSION_NOTE_LENGTH) {
    throw new EnvFileError(
      `Version note must be ${MAX_ENV_VERSION_NOTE_LENGTH} characters or fewer.`,
      400,
    )
  }
  return normalized
}

function validateContent(content: string) {
  if (Buffer.byteLength(content, 'utf8') > MAX_ENV_FILE_BYTES) {
    throw new EnvFileError('Environment file must be 1 MB or smaller.', 413)
  }
}

function createPathKey(path: string) {
  return createHash('sha256').update(path).digest('hex')
}

function countVariables(content: string) {
  return content
    .split(/\r?\n/)
    .filter((line) => /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_.-]*\s*=/.test(line)).length
}

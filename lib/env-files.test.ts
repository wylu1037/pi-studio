import assert from 'node:assert/strict'
import {
  lstatSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  EnvFileError,
  MAX_ENV_FILE_BYTES,
  readEnvFile,
  resolveEnvFilePath,
  writeEnvFile,
} from './env-files.ts'

test('reads, creates, and atomically updates environment files', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'pi-studio-env-'))
  context.after(() => rmSync(root, { recursive: true, force: true }))
  const path = join(root, '.env.local')
  const canonicalPath = join(realpathSync(root), '.env.local')

  assert.deepEqual(readEnvFile(path), {
    path: canonicalPath,
    content: '',
    exists: false,
    byteSize: 0,
    updatedAt: null,
  })

  writeEnvFile(path, 'SERVICE_TOKEN=test-value\n')
  const loaded = readEnvFile(path)
  assert.equal(loaded.content, 'SERVICE_TOKEN=test-value\n')
  assert.equal(loaded.exists, true)
  assert.equal(lstatSync(path).mode & 0o777, 0o600)

  writeEnvFile(path, 'SERVICE_TOKEN=updated\n')
  assert.equal(readEnvFile(path).content, 'SERVICE_TOKEN=updated\n')
})

test('accepts relative paths and supported .env variants', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'pi-studio-env-relative-'))
  context.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'config'))

  assert.equal(
    resolveEnvFilePath('config/.env.production.local', root),
    join(realpathSync(root), 'config', '.env.production.local'),
  )
})

test('rejects unsafe or unsupported environment file paths', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'pi-studio-env-invalid-'))
  context.after(() => rmSync(root, { recursive: true, force: true }))
  const target = join(root, '.env.target')
  writeFileSync(target, 'TOKEN=value\n')
  symlinkSync(target, join(root, '.env'))

  assert.throws(() => resolveEnvFilePath(join(root, 'settings.txt')), EnvFileError)
  assert.throws(() => resolveEnvFilePath(join(root, 'missing', '.env')), EnvFileError)
  assert.throws(() => resolveEnvFilePath(join(root, '.env')), /Symbolic links/)
  assert.throws(
    () => writeEnvFile(join(root, '.env.large'), 'x'.repeat(MAX_ENV_FILE_BYTES + 1)),
    /1 MB or smaller/,
  )
})

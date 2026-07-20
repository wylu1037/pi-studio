import assert from 'node:assert/strict'
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import {
  activateEnvVersion,
  copyEnvVersion,
  deleteEnvVersion,
  deleteEnvVersionHistory,
  getEnvVersionFile,
  saveEnvVersion,
} from './env-versions.ts'

test('creates v0 from the current file and stores snapshots with private permissions', (context) => {
  const root = createTestRoot(context)
  const path = join(root.project, '.env')
  writeFileSync(path, 'API_URL=https://example.com\n')

  const payload = getEnvVersionFile(path, undefined, { storeDir: root.store })

  assert.equal(payload.versions.length, 1)
  assert.equal(payload.selectedVersion.label, 'v0')
  assert.equal(payload.selectedVersion.content, 'API_URL=https://example.com\n')
  assert.equal(payload.selectedVersion.note, 'Initial snapshot')
  assert.equal(payload.inSync, true)

  const storedDirectory = readSingleChildDirectory(root.store)
  assert.equal(lstatSync(storedDirectory).mode & 0o777, 0o700)
  assert.equal(lstatSync(join(storedDirectory, 'manifest.json')).mode & 0o777, 0o600)
})

test('copies and edits an inactive version without changing the live env file', (context) => {
  const root = createTestRoot(context)
  const path = join(root.project, '.env.local')
  writeFileSync(path, 'TOKEN=v0\n')
  const initial = getEnvVersionFile(path, undefined, { storeDir: root.store })

  const copied = copyEnvVersion(path, initial.selectedVersion.id, '', { storeDir: root.store })
  assert.equal(copied.selectedVersion.label, 'v1')
  assert.equal(copied.selectedVersion.content, 'TOKEN=v0\n')

  const saved = saveEnvVersion(path, copied.selectedVersion.id, 'TOKEN=v1\n', 'Staging token', {
    storeDir: root.store,
  })
  assert.equal(saved.selectedVersion.note, 'Staging token')
  assert.equal(saved.selectedVersion.active, false)
  assert.equal(readFileSync(path, 'utf8'), 'TOKEN=v0\n')
})

test('activates a version and writes later edits of the active version through to disk', (context) => {
  const root = createTestRoot(context)
  const path = join(root.project, '.env.production')
  writeFileSync(path, 'TOKEN=v0\n')
  const initial = getEnvVersionFile(path, undefined, { storeDir: root.store })
  const copied = copyEnvVersion(path, initial.selectedVersion.id, '', { storeDir: root.store })
  saveEnvVersion(path, copied.selectedVersion.id, 'TOKEN=v1\n', 'Production', {
    storeDir: root.store,
  })

  const activated = activateEnvVersion(path, copied.selectedVersion.id, { storeDir: root.store })
  assert.equal(activated.selectedVersion.active, true)
  assert.equal(activated.inSync, true)
  assert.equal(readFileSync(path, 'utf8'), 'TOKEN=v1\n')

  const saved = saveEnvVersion(path, copied.selectedVersion.id, 'TOKEN=v1-updated\n', 'Updated', {
    storeDir: root.store,
  })
  assert.equal(saved.inSync, true)
  assert.equal(readFileSync(path, 'utf8'), 'TOKEN=v1-updated\n')
  assert.equal(lstatSync(path).mode & 0o777, 0o600)
})

test('reports external changes as out of sync without overwriting version history', (context) => {
  const root = createTestRoot(context)
  const path = join(root.project, '.env.test')
  writeFileSync(path, 'TOKEN=tracked\n')
  getEnvVersionFile(path, undefined, { storeDir: root.store })

  writeFileSync(path, 'TOKEN=external\n')
  const payload = getEnvVersionFile(path, undefined, { storeDir: root.store })

  assert.equal(payload.inSync, false)
  assert.equal(payload.selectedVersion.content, 'TOKEN=tracked\n')
})

test('removes local version history without deleting the live env file', (context) => {
  const root = createTestRoot(context)
  const path = join(root.project, '.env.development')
  writeFileSync(path, 'TOKEN=keep\n')
  const tracked = getEnvVersionFile(path, undefined, { storeDir: root.store })
  assert.equal(readdirSync(root.store).length, 1)

  deleteEnvVersionHistory(tracked.path, { storeDir: root.store })

  assert.equal(readFileSync(path, 'utf8'), 'TOKEN=keep\n')
  assert.equal(readdirSync(root.store).length, 0)
})

test('deletes an inactive version without renumbering the remaining versions', (context) => {
  const root = createTestRoot(context)
  const path = join(root.project, '.env.preview')
  writeFileSync(path, 'TOKEN=v0\n')
  const initial = getEnvVersionFile(path, undefined, { storeDir: root.store })
  const v1 = copyEnvVersion(path, initial.selectedVersion.id, 'First draft', {
    storeDir: root.store,
  })
  const v2 = copyEnvVersion(path, v1.selectedVersion.id, 'Second draft', {
    storeDir: root.store,
  })

  const deleted = deleteEnvVersion(path, v1.selectedVersion.id, v2.selectedVersion.id, {
    storeDir: root.store,
  })

  assert.deepEqual(
    deleted.versions.map((version) => version.label),
    ['v2', 'v0'],
  )
  assert.equal(deleted.selectedVersion.label, 'v2')
  assert.equal(readFileSync(path, 'utf8'), 'TOKEN=v0\n')
})

test('rejects deletion of the active version', (context) => {
  const root = createTestRoot(context)
  const path = join(root.project, '.env.active')
  writeFileSync(path, 'TOKEN=active\n')
  const initial = getEnvVersionFile(path, undefined, { storeDir: root.store })
  copyEnvVersion(path, initial.selectedVersion.id, '', { storeDir: root.store })

  assert.throws(
    () => deleteEnvVersion(path, initial.selectedVersion.id, undefined, { storeDir: root.store }),
    /Activate another version/,
  )
})

function createTestRoot(context: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'pi-studio-env-versions-'))
  const project = join(root, 'project')
  const store = join(root, 'store')
  chmodSync(root, 0o700)
  requireDirectory(project)
  requireDirectory(store)
  context.after(() => rmSync(root, { recursive: true, force: true }))
  return { project, store }
}

function requireDirectory(path: string) {
  mkdirSync(path, { recursive: true })
}

function readSingleChildDirectory(path: string) {
  const children = readdirSync(path)
  assert.equal(children.length, 1)
  return join(path, children[0])
}

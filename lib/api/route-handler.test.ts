import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { PUT } from '../../app/api/[[...route]]/route'
import { createLocalExtension, deleteLocalExtension } from '../extensions/extension-service'

test('forwards extension save requests to the Hono PUT API', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-studio-save-route-'))
  const previousHome = process.env.HOME
  const name = `save-route-${Date.now()}`
  let extensionId: string | undefined
  const content = 'export default function countCharacters() {}\n'

  try {
    process.env.HOME = root
    const extension = await createLocalExtension({ name, template: 'empty', cwd: process.cwd() })
    extensionId = extension.id
    const request = new Request(
      `http://localhost/api/extensions/${encodeURIComponent(extension.id)}/files/content?cwd=${encodeURIComponent(process.cwd())}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'index.ts', content }),
      },
    )

    const response = await PUT(request)

    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') ?? '', /application\/json/)
    assert.deepEqual(await response.json(), { path: 'index.ts', content })
    assert.equal(await readFile(extension.path, 'utf8'), content)
  } finally {
    if (extensionId) await deleteLocalExtension(extensionId, process.cwd())
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    await rm(root, { recursive: true, force: true })
  }
})

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { PUT } from '../../app/api/[[...route]]/route'

function extensionId(path: string) {
  return `pi-extension:global:${Buffer.from('test').toString('base64url')}:${Buffer.from(path).toString('base64url')}`
}

test('forwards extension save requests to the Hono PUT API', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-studio-save-route-'))
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR
  const extensionDirectory = join(root, 'extensions', 'count-characters')
  const extensionPath = join(extensionDirectory, 'index.ts')
  const content = 'export default function countCharacters() {}\n'

  try {
    process.env.PI_CODING_AGENT_DIR = root
    await mkdir(extensionDirectory, { recursive: true })
    await writeFile(extensionPath, 'export default function previous() {}\n', 'utf8')
    const request = new Request(
      `http://localhost/api/extensions/${encodeURIComponent(extensionId(extensionPath))}/files/content?cwd=${encodeURIComponent(process.cwd())}`,
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
    assert.equal(await readFile(extensionPath, 'utf8'), content)
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir
    await rm(root, { recursive: true, force: true })
  }
})

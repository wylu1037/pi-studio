import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { POST, PUT } from '../../app/api/[[...route]]/route'
import {
  appendMessage,
  appendRunEvent,
  createAgent,
  createRun,
  createSession,
  deleteAgent,
  getRun,
  getSession,
  getSessionTree,
  listSessionMessages,
  updateSessionFilePath,
} from '../db/repository'
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

test('clears session messages without deleting the session', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-studio-clear-session-'))
  const sessionFile = join(root, 'session.jsonl')
  const agent = createAgent({ name: `Clear session test ${Date.now()}` })
  const session = agent ? createSession({ agentId: agent.id, cwd: root }) : null

  try {
    assert.ok(agent)
    assert.ok(session)
    updateSessionFilePath(session!.id, sessionFile)
    await writeFile(sessionFile, '{"type":"session"}\n', 'utf8')
    appendMessage({
      sessionId: session!.id,
      type: 'user',
      content: 'Remove this message',
      usage: { input: 12, output: 0, cacheRead: 0, cacheWrite: 0 },
    })
    const run = createRun({
      sessionId: session!.id,
      agentId: agent!.id,
      prompt: 'Remove this run',
      thinkingLevel: 'medium',
      cwd: root,
    })
    assert.ok(run)
    appendRunEvent(run!.id, 'test', { remove: true })

    const response = await POST(
      new Request(`http://localhost/api/sessions/${encodeURIComponent(session!.id)}/clear`, {
        method: 'POST',
      }),
    )

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })
    assert.equal(getSession(session!.id)?.messageCount, 0)
    assert.equal(getSession(session!.id)?.totalTokens, 0)
    assert.deepEqual(listSessionMessages(session!.id), [])
    assert.equal(getSessionTree(session!.id), null)
    assert.equal(getRun(run!.id), null)
    await assert.rejects(readFile(sessionFile))
  } finally {
    if (agent) deleteAgent(agent.id)
    await rm(root, { recursive: true, force: true })
  }
})

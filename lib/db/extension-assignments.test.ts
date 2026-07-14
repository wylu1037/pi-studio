import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  createAgent,
  createStudioExtension,
  deleteAgent,
  deleteStudioExtension,
  duplicateAgent,
  getAgent,
  resolveAgentRunConfig,
  updateAgentResources,
} from './repository'

test('resolves only extensions assigned to an agent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-studio-agent-extension-'))
  const agent = createAgent({ name: `Extension test ${Date.now()}` })
  const extension = createStudioExtension({
    name: `agent-extension-${Date.now()}`,
    path: root,
  })

  try {
    assert.ok(agent)
    assert.ok(extension)
    updateAgentResources(agent!.id, { selectedExtensionIds: [extension!.id] })

    const config = resolveAgentRunConfig(agent!.id)

    assert.deepEqual(
      config?.extensions.map((item) => ({ id: item.id, path: item.path })),
      [{ id: extension!.id, path: root }],
    )
  } finally {
    if (agent) deleteAgent(agent.id)
    if (extension) deleteStudioExtension(extension.id)
    await rm(root, { recursive: true, force: true })
  }
})

test('persists package sources assigned to an agent and its copy', () => {
  const agent = createAgent({ name: `Package test ${Date.now()}` })
  const source = '/tmp/pi-studio-package-test'

  try {
    assert.ok(agent)
    updateAgentResources(agent!.id, { selectedPackageSources: [source] })
    assert.deepEqual(getAgent(agent!.id)?.selectedPackageSources, [source])

    const copy = duplicateAgent(agent!.id)
    assert.deepEqual(copy?.selectedPackageSources, [source])
    if (copy) deleteAgent(copy.id)
  } finally {
    if (agent) deleteAgent(agent.id)
  }
})

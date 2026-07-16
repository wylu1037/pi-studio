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
  updateAgent,
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

test('persists assistant avatar presets and copies them with the agent', () => {
  const agent = createAgent({ name: `Avatar test ${Date.now()}`, icon: 'robot' })

  try {
    assert.equal(agent?.icon, 'robot')
    if (!agent) return
    updateAgent(agent.id, { icon: 'pi' })
    assert.equal(getAgent(agent.id)?.icon, 'pi')
    const copy = duplicateAgent(agent.id)
    assert.equal(copy?.icon, 'pi')
    if (copy) deleteAgent(copy.id)
  } finally {
    if (agent) deleteAgent(agent.id)
  }
})

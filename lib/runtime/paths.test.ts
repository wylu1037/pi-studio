import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { agentRuntimeDir, piStudioDataDir, studioAgentsDir, studioRootDir } from './paths'

test('studio directories all live under ~/.pi-studio', () => {
  const root = join(homedir(), '.pi-studio')
  assert.equal(studioRootDir(), root)
  assert.equal(studioAgentsDir(), join(root, 'agents'))
  assert.ok(!piStudioDataDir().includes(join(homedir(), '.pi', 'agent')))
})

test('agentRuntimeDir gives each agent its own directory', () => {
  const first = agentRuntimeDir('agent-a')
  const second = agentRuntimeDir('agent-b')
  assert.notEqual(first, second)
  assert.equal(first, join(studioAgentsDir(), 'agent-a'))
})

test('agentRuntimeDir rejects ids that could escape the agents directory', () => {
  assert.throws(() => agentRuntimeDir('../evil'))
  assert.throws(() => agentRuntimeDir('a/b'))
  assert.throws(() => agentRuntimeDir(''))
})

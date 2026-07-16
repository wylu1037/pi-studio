import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_AGENT_AVATAR,
  DEFAULT_USER_AVATAR,
  normalizeAgentAvatarPreset,
  normalizeUserAvatarPreset,
  parseStoredProfile,
} from './profile-settings'

test('normalizes user and agent avatar presets', () => {
  assert.equal(normalizeUserAvatarPreset('notion-glasses'), 'notion-glasses')
  assert.equal(normalizeUserAvatarPreset('unknown'), DEFAULT_USER_AVATAR)
  assert.equal(normalizeAgentAvatarPreset('robot'), 'robot')
  assert.equal(normalizeAgentAvatarPreset('unknown'), DEFAULT_AGENT_AVATAR)
})

test('parses locally stored profile settings safely', () => {
  assert.deepEqual(parseStoredProfile('{"avatar":"notion-cap"}'), { avatar: 'notion-cap' })
  assert.deepEqual(parseStoredProfile('{broken'), { avatar: DEFAULT_USER_AVATAR })
  assert.deepEqual(parseStoredProfile(null), { avatar: DEFAULT_USER_AVATAR })
})

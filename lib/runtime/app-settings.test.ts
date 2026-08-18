import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeAppSettings, normalizeAppSettings } from './app-settings'

test('normalizes missing and invalid app settings', () => {
  assert.deepEqual(normalizeAppSettings({}), { schemaVersion: 1, logLevel: 'info' })
  assert.deepEqual(normalizeAppSettings({ logLevel: 'warn', retired: { enabled: true } }), {
    schemaVersion: 1,
    logLevel: 'warn',
  })
  assert.equal(normalizeAppSettings({ logLevel: 'verbose' }).logLevel, 'info')
})

test('merges app settings without retaining removed fields', () => {
  const current = normalizeAppSettings({ logLevel: 'debug', retired: { enabled: true } })
  const next = mergeAppSettings(current, { logLevel: 'error' })

  assert.deepEqual(next, { schemaVersion: 1, logLevel: 'error' })
})

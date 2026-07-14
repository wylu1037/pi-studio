import assert from 'node:assert/strict'
import test from 'node:test'
import { setLocalExtensionEnabled, setPackageExtensionEnabled } from './extension-filters'

test('disables one extension without disabling the rest of a package', () => {
  assert.deepEqual(
    setPackageExtensionEnabled(['npm:example'], 'npm:example', 'extensions/git.ts', false),
    [
      {
        source: 'npm:example',
        extensions: ['-extensions/git.ts'],
      },
    ],
  )
})

test('enables only the selected extension when all package extensions are disabled', () => {
  assert.deepEqual(
    setPackageExtensionEnabled(
      [{ source: 'npm:example', extensions: [] }],
      'npm:example',
      'extensions/git.ts',
      true,
    ),
    [
      {
        source: 'npm:example',
        extensions: ['extensions/git.ts'],
      },
    ],
  )
})

test('removes an exact exclusion without changing other package filters', () => {
  assert.deepEqual(
    setPackageExtensionEnabled(
      [
        {
          source: 'npm:example',
          extensions: ['-extensions/git.ts', '-extensions/legacy.ts'],
          skills: [],
        },
      ],
      'npm:example',
      'extensions/git.ts',
      true,
    ),
    [
      {
        source: 'npm:example',
        extensions: ['-extensions/legacy.ts'],
        skills: [],
      },
    ],
  )
})

test('uses an exact force include for autoload false package deltas', () => {
  assert.deepEqual(
    setPackageExtensionEnabled(
      [{ source: 'npm:example', autoload: false, extensions: [] }],
      'npm:example',
      'extensions/git.ts',
      true,
    ),
    [
      {
        source: 'npm:example',
        autoload: false,
        extensions: ['+extensions/git.ts'],
      },
    ],
  )
})

test('force includes an extension when a broader exclusion pattern remains', () => {
  assert.deepEqual(
    setPackageExtensionEnabled(
      [{ source: 'npm:example', extensions: ['!extensions/legacy/**'] }],
      'npm:example',
      'extensions/legacy/git.ts',
      true,
    ),
    [
      {
        source: 'npm:example',
        extensions: ['!extensions/legacy/**', '+extensions/legacy/git.ts'],
      },
    ],
  )
})

test('toggles one auto-discovered local extension with an exact override', () => {
  assert.deepEqual(
    setLocalExtensionEnabled(['-extensions/legacy.ts'], 'extensions/git.ts', false),
    ['-extensions/legacy.ts', '-extensions/git.ts'],
  )
  assert.deepEqual(
    setLocalExtensionEnabled(
      ['-extensions/legacy.ts', '-extensions/git.ts'],
      'extensions/git.ts',
      true,
    ),
    ['-extensions/legacy.ts'],
  )
  assert.deepEqual(
    setLocalExtensionEnabled(
      ['extensions/custom.ts', '-extensions/custom.ts'],
      'extensions/custom.ts',
      true,
    ),
    ['extensions/custom.ts'],
  )
})

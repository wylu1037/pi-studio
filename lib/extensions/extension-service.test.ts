import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  createLocalExtension,
  deleteLocalExtension,
  validateLocalExtension,
  writeExtensionFile,
} from './extension-service'

test('validates ESM-style TypeScript extensions stored in the Studio library', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-studio-extension-'))
  const previousHome = process.env.HOME
  const name = `count-characters-${Date.now()}`
  let extensionId: string | undefined

  try {
    process.env.HOME = root
    const extension = await createLocalExtension({ name, template: 'tool', cwd: process.cwd() })
    extensionId = extension.id
    await writeExtensionFile(
      extension.id,
      process.cwd(),
      'index.ts',
      [
        "import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'",
        "import { Type } from 'typebox'",
        '',
        'export default function textTools(pi: ExtensionAPI) {',
        '  pi.registerTool({',
        "    name: 'count_characters',",
        "    label: 'Count characters',",
        "    description: 'Count the number of characters in some text.',",
        '    parameters: Type.Object({',
        "      text: Type.String({ description: 'Text to analyze' }),",
        '    }),',
        '    async execute(_toolCallId, params) {',
        '      const count = params.text.length',
        '      return {',
        "        content: [{ type: 'text', text: `The text contains ${count} characters.` }],",
        '        details: { count },',
        '      }',
        '    },',
        '  })',
        '}',
        '',
      ].join('\n'),
    )

    const result = await validateLocalExtension(extension.id, process.cwd())

    assert.equal(result.valid, true)
    assert.deepEqual(result.diagnostics, [])
    assert.deepEqual(result.capabilities.tools, ['count_characters'])
  } finally {
    if (extensionId) await deleteLocalExtension(extensionId, process.cwd())
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    await rm(root, { recursive: true, force: true })
  }
})

test('creates lifecycle extensions without direct console logging', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-studio-extension-lifecycle-'))
  const previousHome = process.env.HOME
  const name = `lifecycle-status-${Date.now()}`
  let extensionId: string | undefined

  try {
    process.env.HOME = root
    const extension = await createLocalExtension({
      name,
      template: 'lifecycle',
      cwd: process.cwd(),
    })
    extensionId = extension.id

    const source = await readFile(extension.path, 'utf8')
    const result = await validateLocalExtension(extension.id, process.cwd())

    assert.doesNotMatch(source, /console\./)
    assert.match(source, /ctx\.ui\.setStatus/)
    assert.equal(result.valid, true)
    assert.deepEqual(result.diagnostics, [])
  } finally {
    if (extensionId) await deleteLocalExtension(extensionId, process.cwd())
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    await rm(root, { recursive: true, force: true })
  }
})

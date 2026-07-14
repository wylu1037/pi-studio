import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { validateLocalExtension } from './extension-service'

function extensionId(path: string) {
  return `pi-extension:global:${Buffer.from('test').toString('base64url')}:${Buffer.from(path).toString('base64url')}`
}

test('validates ESM-style TypeScript extensions outside a module package', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-studio-extension-'))
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR
  const extensionPath = join(root, 'extensions', 'count-characters', 'index.ts')

  try {
    process.env.PI_CODING_AGENT_DIR = root
    await mkdir(join(root, 'extensions', 'count-characters'), { recursive: true })
    await writeFile(
      extensionPath,
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
      'utf8',
    )

    const result = await validateLocalExtension(extensionId(extensionPath), process.cwd())

    assert.equal(result.valid, true)
    assert.deepEqual(result.diagnostics, [])
    assert.deepEqual(result.capabilities.tools, ['count_characters'])
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir
    await rm(root, { recursive: true, force: true })
  }
})

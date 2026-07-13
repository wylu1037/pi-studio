import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { listWorkspaceDirectory, WorkspaceFilesError } from './workspace-files'

test('lists workspace directories before files and returns relative paths', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'pi-studio-workspace-'))
  context.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'components'))
  writeFileSync(join(root, 'README.md'), '# Workspace')
  writeFileSync(join(root, 'components', 'chat.tsx'), 'export {}')

  const rootListing = await listWorkspaceDirectory(root)
  assert.deepEqual(rootListing, {
    entries: [
      { name: 'components', path: 'components', type: 'directory' },
      { name: 'README.md', path: 'README.md', type: 'file' },
    ],
    truncated: false,
  })

  const childListing = await listWorkspaceDirectory(root, 'components')
  assert.deepEqual(childListing.entries, [
    { name: 'chat.tsx', path: 'components/chat.tsx', type: 'file' },
  ])
})

test('rejects traversal and symbolic links that escape the workspace', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'pi-studio-workspace-root-'))
  const outside = mkdtempSync(join(tmpdir(), 'pi-studio-workspace-outside-'))
  context.after(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })
  symlinkSync(outside, join(root, 'linked-directory'))

  await assert.rejects(
    () => listWorkspaceDirectory(root, '../'),
    (error: unknown) => error instanceof WorkspaceFilesError && error.status === 403,
  )
  await assert.rejects(
    () => listWorkspaceDirectory(root, 'linked-directory'),
    (error: unknown) => error instanceof WorkspaceFilesError && error.status === 403,
  )
})

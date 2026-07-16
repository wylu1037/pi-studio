import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  AttachmentFilesError,
  MAX_ATTACHMENT_COUNT,
  sanitizeAttachmentFilename,
  saveSessionAttachments,
} from './attachment-files'
import { buildPromptWithAttachments, parsePromptWithAttachments } from './attachments'

function attachment(name: string, content: string, type = 'text/plain') {
  const bytes = Buffer.from(content)
  return {
    name,
    size: bytes.byteLength,
    type,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    },
  }
}

test('sanitizes user-controlled filenames', () => {
  assert.equal(sanitizeAttachmentFilename('../../secret?.txt'), 'secret-.txt')
  assert.equal(sanitizeAttachmentFilename('..\\..\\report: final.md'), 'report- final.md')
  assert.equal(sanitizeAttachmentFilename('\u0000...'), 'attachment')
})

test('saves attachments beneath the workspace with private permissions', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'pi-studio-attachments-'))
  context.after(() => rmSync(root, { recursive: true, force: true }))

  const [upload] = await saveSessionAttachments(root, [attachment('../notes.txt', 'hello')])
  assert.equal(upload.name, 'notes.txt')
  assert.match(upload.path, /^\.pi-studio\/attachments\/[\w-]+-notes\.txt$/)
  assert.equal(readFileSync(join(root, upload.path), 'utf8'), 'hello')
})

test('rejects attachment directories that escape through a symbolic link', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'pi-studio-attachments-root-'))
  const outside = mkdtempSync(join(tmpdir(), 'pi-studio-attachments-outside-'))
  context.after(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })
  mkdirSync(join(root, '.pi-studio'))
  symlinkSync(outside, join(root, '.pi-studio', 'attachments'))

  await assert.rejects(
    () => saveSessionAttachments(root, [attachment('notes.txt', 'hello')]),
    (error: unknown) => error instanceof AttachmentFilesError && error.status === 403,
  )
})

test('enforces the attachment count limit before writing files', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'pi-studio-attachment-limit-'))
  context.after(() => rmSync(root, { recursive: true, force: true }))
  const files = Array.from({ length: MAX_ATTACHMENT_COUNT + 1 }, (_, index) =>
    attachment(`${index}.txt`, 'x'),
  )

  await assert.rejects(
    () => saveSessionAttachments(root, files),
    (error: unknown) => error instanceof AttachmentFilesError && error.status === 413,
  )
})

test('builds a structured attachment prompt without changing text-only prompts', () => {
  assert.equal(buildPromptWithAttachments('  explain this  ', []), 'explain this')
  const prompt = buildPromptWithAttachments('', [
    {
      name: 'notes.txt',
      path: '.pi-studio/attachments/id-notes.txt',
      size: 5,
      type: 'text/plain',
    },
  ])
  assert.match(prompt, /^<pi-studio-attachments>/)
  assert.match(prompt, /"path": "\.pi-studio\/attachments\/id-notes\.txt"/)
  assert.match(prompt, /<\/pi-studio-attachments>$/)

  const parsed = parsePromptWithAttachments(`explain this\n\n${prompt}`)
  assert.equal(parsed.message, 'explain this')
  assert.equal(parsed.attachments[0]?.name, 'notes.txt')
  assert.equal(parsed.attachments[0]?.path, '.pi-studio/attachments/id-notes.txt')
})

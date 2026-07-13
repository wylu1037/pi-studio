import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseMediaRange, resolveSessionMediaPath } from './media-files'

test('resolves supported media only from the session working directory', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'pi-studio-media-'))
  const outside = mkdtempSync(join(tmpdir(), 'pi-studio-media-outside-'))
  context.after(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })

  const audioPath = join(root, 'answer.mp3')
  const imagePath = join(root, 'cover.png')
  const outsidePath = join(outside, 'private.png')
  writeFileSync(audioPath, 'audio')
  writeFileSync(imagePath, 'image')
  writeFileSync(outsidePath, 'private')
  symlinkSync(outsidePath, join(root, 'linked.png'))

  assert.equal(resolveSessionMediaPath(root, 'answer.mp3'), realpathSync(audioPath))
  assert.equal(resolveSessionMediaPath(root, 'cover.png'), realpathSync(imagePath))
  assert.equal(resolveSessionMediaPath(root, outsidePath), null)
  assert.equal(resolveSessionMediaPath(root, 'linked.png'), null)
  assert.equal(resolveSessionMediaPath(root, 'answer.wav'), null)
})

test('maps public and localhost-wrapped media links to workspace files', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'pi-studio-public-media-'))
  context.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'public', 'images'), { recursive: true })
  const publicPath = join(root, 'public', 'images', 'cover.png')
  const localPath = join(root, 'cover.png')
  writeFileSync(publicPath, 'public image')
  writeFileSync(localPath, 'local image')

  assert.equal(resolveSessionMediaPath(root, '/images/cover.png'), realpathSync(publicPath))
  assert.equal(
    resolveSessionMediaPath(root, `http://localhost:3000${localPath}`),
    realpathSync(localPath),
  )
  assert.equal(resolveSessionMediaPath(root, 'https://example.com/cover.png'), null)
})

test('parses browser byte ranges', () => {
  assert.deepEqual(parseMediaRange('bytes=10-19', 100), { start: 10, end: 19 })
  assert.deepEqual(parseMediaRange('bytes=90-', 100), { start: 90, end: 99 })
  assert.deepEqual(parseMediaRange('bytes=-10', 100), { start: 90, end: 99 })
  assert.equal(parseMediaRange('bytes=100-110', 100), null)
  assert.equal(parseMediaRange('items=0-10', 100), null)
})

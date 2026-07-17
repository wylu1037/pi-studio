import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { clearApplicationLogs, readApplicationLogs } from './log-files'

test('reads and clears application log files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-studio-logs-'))
  try {
    await writeFile(join(directory, 'server.log'), 'server output\n', 'utf8')
    await writeFile(join(directory, 'main.log'), 'main output\n', 'utf8')

    const snapshot = await readApplicationLogs(directory)
    assert.equal(snapshot.files[0]?.content, 'server output\n')
    assert.equal(snapshot.files[1]?.content, 'main output\n')
    assert.equal(
      snapshot.totalSize,
      Buffer.byteLength('server output\n') + Buffer.byteLength('main output\n'),
    )

    const result = await clearApplicationLogs(directory)
    assert.equal(result.cleared, 2)
    assert.equal(await readFile(join(directory, 'server.log'), 'utf8'), '')
    assert.equal(await readFile(join(directory, 'main.log'), 'utf8'), '')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

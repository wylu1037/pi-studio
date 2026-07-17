import { open, stat, truncate } from 'node:fs/promises'
import { join } from 'node:path'

import { piStudioDataDir } from '@/lib/runtime/paths'

const LOG_FILE_NAMES = ['server.log', 'main.log'] as const
const MAX_LOG_PREVIEW_BYTES = 256 * 1024

export type ApplicationLogFile = {
  name: (typeof LOG_FILE_NAMES)[number]
  path: string
  size: number
  content: string
  truncated: boolean
}

export async function readApplicationLogs(directory = piStudioDataDir()) {
  const files = await Promise.all(
    LOG_FILE_NAMES.map(async (name): Promise<ApplicationLogFile> => {
      const path = join(directory, name)
      try {
        const info = await stat(path)
        const bytesToRead = Math.min(info.size, MAX_LOG_PREVIEW_BYTES)
        const handle = await open(path, 'r')
        try {
          const buffer = Buffer.alloc(bytesToRead)
          await handle.read(buffer, 0, bytesToRead, Math.max(0, info.size - bytesToRead))
          return {
            name,
            path,
            size: info.size,
            content: buffer.toString('utf8'),
            truncated: info.size > bytesToRead,
          }
        } finally {
          await handle.close()
        }
      } catch {
        return { name, path, size: 0, content: '', truncated: false }
      }
    }),
  )
  return {
    files,
    totalSize: files.reduce((total, file) => total + file.size, 0),
  }
}

export async function clearApplicationLogs(directory = piStudioDataDir()) {
  let cleared = 0
  await Promise.all(
    LOG_FILE_NAMES.map(async (name) => {
      try {
        await truncate(join(directory, name), 0)
        cleared += 1
      } catch {
        // Missing log files are already clear.
      }
    }),
  )
  return { cleared }
}

export function applicationLogPaths(directory = piStudioDataDir()) {
  return LOG_FILE_NAMES.map((name) => join(directory, name))
}

import { lstat, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { defaultPiSessionDir } from '@/lib/chat/pi-adapter'
import { databasePath, sqlite } from '@/lib/db/client'
import { studioPromptsDir } from '@/lib/prompts/store'
import { skillSourcePath, studioSkillsDir } from '@/lib/skills/store'

export type StorageEntry = {
  id: 'database' | 'attachments' | 'skills' | 'prompts' | 'sessions'
  label: string
  description: string
  paths: string[]
  count: number
  countLabel: string
  size: number
}

export type StorageStats = {
  generatedAt: string
  entries: StorageEntry[]
}

type FileStats = { count: number; size: number }

async function fileStats(path: string): Promise<FileStats> {
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink()) return { count: 0, size: 0 }
    if (info.isFile()) return { count: 1, size: info.size }
    if (!info.isDirectory()) return { count: 0, size: 0 }

    const children = await readdir(path)
    const stats = await Promise.all(children.map((child) => fileStats(join(path, child))))
    return stats.reduce(
      (total, child) => ({ count: total.count + child.count, size: total.size + child.size }),
      { count: 0, size: 0 },
    )
  } catch {
    return { count: 0, size: 0 }
  }
}

async function aggregatePaths(paths: string[]) {
  const uniquePaths = [...new Set(paths.map((path) => resolve(path)))]
  const stats = await Promise.all(uniquePaths.map(fileStats))
  return {
    paths: uniquePaths,
    count: stats.reduce((total, item) => total + item.count, 0),
    size: stats.reduce((total, item) => total + item.size, 0),
  }
}

export async function getStorageStats(): Promise<StorageStats> {
  const sessions = sqlite
    .prepare('SELECT cwd, file_path AS filePath FROM sessions')
    .all() as Array<{
    cwd: string
    filePath: string
  }>
  const skills = sqlite.prepare('SELECT name, path FROM global_skills').all() as Array<{
    name: string
    path: string
  }>
  const prompts = sqlite.prepare('SELECT path FROM global_prompts').all() as Array<{ path: string }>
  const attachmentPaths = sessions.map(({ cwd }) => join(cwd, '.pi-studio', 'attachments'))
  const sessionLocations = [
    defaultPiSessionDir(),
    ...sessions.map(({ filePath }) => dirname(filePath)),
  ]
  const skillPaths = skills.map((skill) => skillSourcePath(skill))
  const promptPaths = prompts.map(({ path }) => path)

  const [databaseFiles, attachments, skillFiles, promptFiles, sessionFiles] = await Promise.all([
    aggregatePaths([databasePath, `${databasePath}-wal`, `${databasePath}-shm`]),
    aggregatePaths(attachmentPaths),
    aggregatePaths(skillPaths),
    aggregatePaths(promptPaths),
    aggregatePaths(sessions.map(({ filePath }) => filePath)),
  ])

  return {
    generatedAt: new Date().toISOString(),
    entries: [
      {
        id: 'database',
        label: 'SQLite database',
        description: 'Application metadata, configuration, messages, and indexes.',
        paths: [databasePath],
        count: databaseFiles.count,
        countLabel: 'files',
        size: databaseFiles.size,
      },
      {
        id: 'attachments',
        label: 'Attachments',
        description: 'Files uploaded to chat, stored inside each active session workspace.',
        paths: attachments.paths,
        count: attachments.count,
        countLabel: 'files',
        size: attachments.size,
      },
      {
        id: 'skills',
        label: 'Skills',
        description: 'Registered skill source files available to agents.',
        paths:
          skillPaths.length > 0
            ? [...new Set(skillPaths.map((path) => resolve(path)))]
            : [studioSkillsDir()],
        count: skills.length,
        countLabel: 'skills',
        size: skillFiles.size,
      },
      {
        id: 'prompts',
        label: 'Prompts',
        description: 'Markdown prompt templates managed by Pi Studio.',
        paths:
          promptPaths.length > 0
            ? [...new Set(promptPaths.map((path) => dirname(resolve(path))))]
            : [studioPromptsDir()],
        count: prompts.length,
        countLabel: 'prompts',
        size: promptFiles.size,
      },
      {
        id: 'sessions',
        label: 'Sessions',
        description: 'Pi session history stored as JSONL files.',
        paths: [...new Set(sessionLocations.map((path) => resolve(path)))],
        count: sessions.length,
        countLabel: 'sessions',
        size: sessionFiles.size,
      },
    ],
  }
}

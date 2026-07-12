import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import type { GlobalSkill } from '@/lib/types'

export function piAgentDir() {
  return join(homedir(), '.pi', 'agent')
}

export function piSkillsDir() {
  return join(piAgentDir(), 'skills')
}

export function studioSkillsDir() {
  return join(homedir(), '.pi-studio', 'skills')
}

export function studioRootDir() {
  return join(homedir(), '.pi-studio')
}

export function safeSkillDirName(value?: string) {
  if (!value) return null
  const name = basename(value.trim())
  return /^[\w.-]+$/.test(name) ? name : null
}

export function isInside(parent: string, child: string) {
  const parentPath = resolve(parent)
  const childPath = resolve(child)
  const relative = childPath.slice(parentPath.length)
  return relative === '' || relative.startsWith(sep)
}

export function studioSkillPath(skillName: string) {
  const dirName = safeSkillDirName(skillName)
  if (!dirName) throw new Error(`Invalid skill name: ${skillName}`)
  return join(studioSkillsDir(), dirName)
}

export function skillSourcePath(skill: Pick<GlobalSkill, 'name' | 'path'>) {
  if (isAbsolute(skill.path)) {
    try {
      if (existsSync(skill.path) && lstatSync(skill.path).isDirectory()) {
        return skill.path
      }
    } catch {
      return skill.path
    }
    return dirname(skill.path)
  }

  return studioSkillPath(skill.name)
}

function legacyRuntimeSkillPath(skillName: string) {
  const dirName = safeSkillDirName(skillName)
  return dirName ? join(piSkillsDir(), dirName) : null
}

export function ensureStoredSkill(skill: Pick<GlobalSkill, 'name' | 'path'>) {
  const source = skillSourcePath(skill)
  if (existsSync(source)) return source

  const legacy = legacyRuntimeSkillPath(skill.name)
  if (!legacy || !existsSync(legacy)) return source

  try {
    if (lstatSync(legacy).isSymbolicLink()) return source
  } catch {
    return source
  }

  const target = studioSkillPath(skill.name)
  mkdirSync(studioSkillsDir(), { recursive: true })
  rmSync(target, { recursive: true, force: true })
  renameSync(legacy, target)
  return target
}

export function materializeInstalledSkill(skillName: string) {
  const dirName = safeSkillDirName(skillName)
  if (!dirName) throw new Error(`Invalid skill name: ${skillName}`)

  const root = studioSkillsDir()
  const target = join(root, dirName)
  mkdirSync(root, { recursive: true })

  const source = [
    join(studioRootDir(), '.agents', 'skills', dirName),
    join(studioRootDir(), '.pi', 'skills', dirName),
    join(piSkillsDir(), dirName),
  ].find((candidate) => existsSync(candidate))

  if (!source) {
    throw new Error(`Installed skill not found after install: ${dirName}`)
  }
  rmSync(target, { recursive: true, force: true })
  if (lstatSync(source).isSymbolicLink()) {
    const resolvedSource = realpathSync(source)
    if (!lstatSync(resolvedSource).isDirectory()) {
      throw new Error(`Installed skill does not point to a directory: ${source}`)
    }
    cpSync(resolvedSource, target, { recursive: true })
    rmSync(source, { force: true })
  } else {
    renameSync(source, target)
  }
  return target
}

export function removeStoredSkill(skill: Pick<GlobalSkill, 'name' | 'path'>) {
  const dirName = safeSkillDirName(skill.name)
  if (dirName) {
    const runtimeLink = join(piSkillsDir(), dirName)
    try {
      if (existsSync(runtimeLink) && lstatSync(runtimeLink).isSymbolicLink()) {
        const linkedTo = readlinkSync(runtimeLink)
        const resolved = resolve(dirname(runtimeLink), linkedTo)
        if (isInside(studioSkillsDir(), resolved)) {
          rmSync(runtimeLink, { force: true })
        }
      } else if (existsSync(runtimeLink)) {
        rmSync(runtimeLink, { recursive: true, force: true })
      }
    } catch {
      // Leave user-managed runtime entries alone.
    }
  }

  const candidates = Array.from(
    new Set(
      [
        skillSourcePath(skill),
        studioSkillPath(skill.name),
      ].filter(Boolean),
    ),
  )

  for (const candidate of candidates) {
    if (!isInside(studioSkillsDir(), candidate) || !existsSync(candidate)) continue
    rmSync(candidate, { recursive: true, force: true })
  }
}

export function syncPiSkillLinks(skills: Array<Pick<GlobalSkill, 'name' | 'path'>>) {
  const targetDir = piSkillsDir()
  const storeRoot = studioSkillsDir()
  mkdirSync(targetDir, { recursive: true })

  for (const entry of readdirSafe(targetDir)) {
    const path = join(targetDir, entry)
    try {
      const stat = lstatSync(path)
      if (!stat.isSymbolicLink()) continue
      const linkedTo = readlinkSync(path)
      const resolved = resolve(dirname(path), linkedTo)
      if (isInside(storeRoot, resolved)) rmSync(path, { force: true })
    } catch {
      // Ignore broken entries and leave non-managed user files alone.
    }
  }

  for (const skill of skills) {
    const dirName = safeSkillDirName(skill.name)
    if (!dirName) continue
    const source = ensureStoredSkill(skill)
    if (!existsSync(source)) continue

    const link = join(targetDir, dirName)
    if (existsSync(link)) {
      try {
        const stat = lstatSync(link)
        if (!stat.isSymbolicLink()) continue
        rmSync(link, { force: true })
      } catch {
        continue
      }
    }

    symlinkSync(source, link, 'dir')
  }
}

function readdirSafe(path: string) {
  try {
    return readdirSync(path)
  } catch {
    return []
  }
}

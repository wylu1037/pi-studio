import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import type { GlobalPromptTemplate } from '@/lib/types'

export function studioPromptsDir() {
  return join(homedir(), '.pi-studio', 'prompts')
}

export function safePromptName(value: string) {
  const name = basename(value.trim()).replace(/\.md$/i, '')
  return /^[a-zA-Z0-9][\w.-]*$/.test(name) ? name : null
}

export function studioPromptPath(name: string) {
  const safeName = safePromptName(name)
  if (!safeName)
    throw new Error('Prompt name may only contain letters, numbers, dots, dashes, and underscores.')
  return join(studioPromptsDir(), `${safeName}.md`)
}

function insideStudioPrompts(path: string) {
  const root = resolve(studioPromptsDir())
  const candidate = resolve(path)
  return candidate === root || candidate.startsWith(`${root}${sep}`)
}

export function serializePromptTemplate(prompt: {
  description?: string
  argumentHint?: string
  content: string
}) {
  const frontmatter = [
    '---',
    prompt.description ? `description: ${JSON.stringify(prompt.description)}` : null,
    prompt.argumentHint ? `argument-hint: ${JSON.stringify(prompt.argumentHint)}` : null,
    '---',
  ].filter(Boolean)
  return `${frontmatter.join('\n')}\n${prompt.content.trim()}\n`
}

export function writeStoredPrompt(
  prompt: Pick<GlobalPromptTemplate, 'name' | 'description' | 'argumentHint' | 'content'>,
  previousPath?: string,
) {
  const target = studioPromptPath(prompt.name)
  mkdirSync(studioPromptsDir(), { recursive: true })
  writeFileSync(target, serializePromptTemplate(prompt), 'utf8')
  if (
    previousPath &&
    previousPath !== target &&
    insideStudioPrompts(previousPath) &&
    existsSync(previousPath)
  ) {
    rmSync(previousPath, { force: true })
  }
  return target
}

export function ensureStoredPrompt(
  prompt: Pick<GlobalPromptTemplate, 'name' | 'description' | 'argumentHint' | 'content'>,
) {
  const target = studioPromptPath(prompt.name)
  if (existsSync(target)) return target
  return writeStoredPrompt(prompt)
}

export function removeStoredPrompt(path: string) {
  if (insideStudioPrompts(path) && existsSync(path)) rmSync(path, { force: true })
}

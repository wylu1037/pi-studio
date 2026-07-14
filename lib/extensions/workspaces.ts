import { basename } from 'node:path'
import { listAgents, listSessions } from '@/lib/db/repository'
import { canonicalWorkspacePath } from './project-trust'

export interface ExtensionWorkspace {
  path: string
  label: string
  sources: Array<'studio' | 'agent' | 'session'>
}

export function listExtensionWorkspaces(): ExtensionWorkspace[] {
  const paths = new Map<string, Set<ExtensionWorkspace['sources'][number]>>()
  const add = (value: string | undefined, source: ExtensionWorkspace['sources'][number]) => {
    if (!value) return
    const path = canonicalWorkspacePath(value)
    const sources = paths.get(path) ?? new Set()
    sources.add(source)
    paths.set(path, sources)
  }

  add(process.cwd(), 'studio')
  for (const agent of listAgents()) add(agent.defaultCwd, 'agent')
  for (const session of listSessions()) add(session.cwd, 'session')

  return [...paths.entries()]
    .map(([path, sources]) => ({
      path,
      label: basename(path) || path,
      sources: [...sources],
    }))
    .sort((left, right) => left.label.localeCompare(right.label))
}

export function assertExtensionWorkspace(cwd: string) {
  const canonical = canonicalWorkspacePath(cwd)
  if (!listExtensionWorkspaces().some((workspace) => workspace.path === canonical)) {
    throw new Error('The requested CWD is not a configured Pi Studio workspace.')
  }
  return canonical
}

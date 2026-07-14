import { existsSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  getAgentDir,
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
} from '@earendil-works/pi-coding-agent'

export type ProjectTrustDecision = 'once' | 'always' | 'deny' | 'reset'

export interface ProjectTrustState {
  cwd: string
  requiresTrust: boolean
  trusted: boolean
  savedDecision: boolean | null
  options: Array<{
    label: string
    trusted: boolean
    updates: Array<{ path: string; decision: boolean | null }>
    savedPath?: string
  }>
}

declare global {
  var __piStudioTrustedProjects: Set<string> | undefined
}

function trustedProjects() {
  globalThis.__piStudioTrustedProjects ??= new Set<string>()
  return globalThis.__piStudioTrustedProjects
}

export function canonicalWorkspacePath(cwd: string) {
  const absolute = resolve(cwd)
  if (!existsSync(absolute)) return absolute
  try {
    return realpathSync.native(absolute)
  } catch {
    return absolute
  }
}

export function isProjectTrusted(cwd: string) {
  const canonical = canonicalWorkspacePath(cwd)
  if (!hasTrustRequiringProjectResources(canonical)) return true
  if (trustedProjects().has(canonical)) return true
  return new ProjectTrustStore(getAgentDir()).get(canonical) === true
}

export function getProjectTrustState(cwd: string): ProjectTrustState {
  const canonical = canonicalWorkspacePath(cwd)
  const store = new ProjectTrustStore(getAgentDir())
  const savedDecision = store.get(canonical)
  const requiresTrust = hasTrustRequiringProjectResources(canonical)
  return {
    cwd: canonical,
    requiresTrust,
    trusted: !requiresTrust || isProjectTrusted(canonical),
    savedDecision,
    options: [
      { label: 'Trust once', trusted: true, updates: [] },
      {
        label: 'Always trust this project',
        trusted: true,
        updates: [{ path: canonical, decision: true }],
        savedPath: canonical,
      },
      {
        label: 'Do not trust',
        trusted: false,
        updates: [{ path: canonical, decision: false }],
        savedPath: canonical,
      },
    ],
  }
}

export function setProjectTrust(cwd: string, decision: ProjectTrustDecision) {
  const canonical = canonicalWorkspacePath(cwd)
  const store = new ProjectTrustStore(getAgentDir())
  if (decision === 'once') {
    trustedProjects().add(canonical)
  } else if (decision === 'always') {
    trustedProjects().add(canonical)
    store.set(canonical, true)
  } else if (decision === 'deny') {
    trustedProjects().delete(canonical)
    store.set(canonical, false)
  } else {
    trustedProjects().delete(canonical)
    store.set(canonical, null)
  }
  return getProjectTrustState(canonical)
}

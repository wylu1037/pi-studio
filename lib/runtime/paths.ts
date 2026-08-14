import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

export function studioRootDir() {
  return join(homedir(), '.pi-studio')
}

export function piStudioDataDir() {
  return resolve(process.env.PI_STUDIO_DATA_DIR ?? join(studioRootDir(), 'data'))
}

export function studioAgentsDir() {
  return join(studioRootDir(), 'agents')
}

export function agentRuntimeDir(agentId: string) {
  const name = basename(agentId.trim())
  if (!/^[\w.-]+$/.test(name) || name !== agentId.trim()) {
    throw new Error(`Invalid agent id for runtime directory: ${agentId}`)
  }
  return join(studioAgentsDir(), name)
}

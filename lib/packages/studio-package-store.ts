import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DefaultPackageManager, SettingsManager } from '@earendil-works/pi-coding-agent'

export function studioPackagesDir() {
  return join(homedir(), '.pi-studio', 'packages')
}

export function createStudioPackageManager(cwd: string) {
  const agentDir = studioPackagesDir()
  mkdirSync(agentDir, { recursive: true })
  const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true })
  return {
    agentDir,
    settingsManager,
    packageManager: new DefaultPackageManager({ cwd, agentDir, settingsManager }),
  }
}

export function installedPackagePaths(sources: string[], cwd: string) {
  if (sources.length === 0) return []
  const { packageManager } = createStudioPackageManager(cwd)
  const selected = new Set(sources)
  return packageManager
    .listConfiguredPackages()
    .filter((pkg) => selected.has(pkg.source) && pkg.installedPath && existsSync(pkg.installedPath))
    .map((pkg) => pkg.installedPath!)
}

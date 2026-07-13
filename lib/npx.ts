import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { execPath } from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface RunNpxOptions {
  timeout?: number
  cwd?: string
  env?: NodeJS.ProcessEnv
}

export interface RunNpxResult {
  stdout: string
  stderr: string
}

function findNpxCli() {
  const nodeDir = dirname(execPath)
  const candidates = [
    join(nodeDir, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  ]

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      // Ignore inaccessible Node installation paths.
    }
  }

  return null
}

export async function runNpx(args: string[], options: RunNpxOptions = {}): Promise<RunNpxResult> {
  const npxCli = findNpxCli()
  const command = npxCli ? execPath : 'npx'
  const commandArgs = npxCli ? [npxCli, ...args] : args

  try {
    return await execFileAsync(command, commandArgs, {
      timeout: options.timeout,
      cwd: options.cwd,
      env: options.env,
    })
  } catch (error) {
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error
        ? String(error.stderr).trim()
        : ''
    const stdout =
      typeof error === 'object' && error !== null && 'stdout' in error
        ? String(error.stdout).trim()
        : ''
    const detail = stderr || stdout
    if (detail) throw new Error(detail, { cause: error })
    throw error
  }
}

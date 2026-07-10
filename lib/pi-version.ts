import { execFileSync } from 'node:child_process'

export function getPiVersionLabel() {
  try {
    const version = execFileSync('pi', ['--version'], {
      encoding: 'utf8',
      timeout: 3000,
    }).trim()
    if (!version) return 'pi unavailable'
    return version.startsWith('pi ') ? version : `pi v${version.replace(/^v/, '')}`
  } catch {
    return 'pi unavailable'
  }
}

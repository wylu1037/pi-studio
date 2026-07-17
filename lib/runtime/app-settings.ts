import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { piStudioDataDir } from '@/lib/runtime/paths'

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

export type AppSettings = {
  logLevel: LogLevel
}

const DEFAULT_SETTINGS: AppSettings = {
  logLevel: 'info',
}

let cachedSettings: AppSettings | null = null

export function appSettingsPath() {
  return join(piStudioDataDir(), 'settings.json')
}

export function getAppSettings(): AppSettings {
  if (cachedSettings) return cachedSettings
  try {
    const stored = JSON.parse(readFileSync(appSettingsPath(), 'utf8')) as Partial<AppSettings>
    cachedSettings = normalizeSettings(stored)
  } catch {
    cachedSettings = { ...DEFAULT_SETTINGS }
  }
  return cachedSettings
}

export function updateAppSettings(input: Partial<AppSettings>): AppSettings {
  const next = normalizeSettings({ ...getAppSettings(), ...input })
  const path = appSettingsPath()
  const temporaryPath = `${path}.tmp`
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  renameSync(temporaryPath, path)
  cachedSettings = next
  return next
}

function normalizeSettings(value: Partial<AppSettings>): AppSettings {
  return {
    logLevel: LOG_LEVELS.includes(value.logLevel as LogLevel)
      ? (value.logLevel as LogLevel)
      : DEFAULT_SETTINGS.logLevel,
  }
}

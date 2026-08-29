import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { piStudioDataDir } from '@/lib/runtime/paths'

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

export type AppSettings = {
  schemaVersion: 1
  logLevel: LogLevel
}

const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 1,
  logLevel: 'info',
}

let cachedSettings: AppSettings | null = null

function appSettingsPath() {
  return join(piStudioDataDir(), 'settings.json')
}

export function getAppSettings(): AppSettings {
  if (cachedSettings) {
    cachedSettings = normalizeAppSettings(cachedSettings)
    return cachedSettings
  }
  try {
    const stored = JSON.parse(readFileSync(appSettingsPath(), 'utf8')) as unknown
    cachedSettings = normalizeAppSettings(stored)
  } catch {
    cachedSettings = normalizeAppSettings(DEFAULT_SETTINGS)
  }
  return cachedSettings
}

export type AppSettingsUpdate = Partial<AppSettings>

export function updateAppSettings(input: AppSettingsUpdate): AppSettings {
  const current = getAppSettings()
  const next = mergeAppSettings(current, input)
  const path = appSettingsPath()
  const temporaryPath = `${path}.tmp`
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  renameSync(temporaryPath, path)
  cachedSettings = next
  return next
}

export function mergeAppSettings(current: AppSettings, input: AppSettingsUpdate): AppSettings {
  return normalizeAppSettings({
    ...current,
    ...input,
  })
}

export function normalizeAppSettings(value: unknown): AppSettings {
  const record = objectValue(value)
  return {
    schemaVersion: 1,
    logLevel: LOG_LEVELS.includes(record.logLevel as LogLevel)
      ? (record.logLevel as LogLevel)
      : DEFAULT_SETTINGS.logLevel,
  }
}


function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

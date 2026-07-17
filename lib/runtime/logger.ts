import { getAppSettings, type LogLevel } from '@/lib/runtime/app-settings'

const PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: Number.POSITIVE_INFINITY,
}

function enabled(level: Exclude<LogLevel, 'silent'>) {
  return PRIORITY[level] >= PRIORITY[getAppSettings().logLevel]
}

function prefix(level: Exclude<LogLevel, 'silent'>) {
  return `[pi-studio] ${new Date().toISOString()} ${level.toUpperCase()}`
}

export const logger = {
  debug(...values: unknown[]) {
    if (enabled('debug')) console.debug(prefix('debug'), ...values)
  },
  info(...values: unknown[]) {
    if (enabled('info')) console.info(prefix('info'), ...values)
  },
  warn(...values: unknown[]) {
    if (enabled('warn')) console.warn(prefix('warn'), ...values)
  },
  error(...values: unknown[]) {
    if (enabled('error')) console.error(prefix('error'), ...values)
  },
}

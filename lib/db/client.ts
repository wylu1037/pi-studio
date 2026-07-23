import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { dirname, join, resolve } from 'node:path'
import { mkdirSync, rmSync, statSync } from 'node:fs'
import * as schema from './schema'
import { piStudioDataDir } from '@/lib/runtime/paths'

export const databasePath = resolve(
  process.env.DATABASE_URL ?? join(piStudioDataDir(), 'pi-studio.sqlite'),
)
mkdirSync(dirname(databasePath), { recursive: true })

const sqlite = new Database(databasePath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')
sqlite.pragma('busy_timeout = 30000')

export const db = drizzle(sqlite, { schema })
withMigrationLock(() => {
  migrate(db, {
    migrationsFolder: process.env.PI_STUDIO_MIGRATIONS_DIR ?? join(process.cwd(), 'drizzle'),
  })
})

// Reap orphaned runs on every boot. In-memory run state (the SessionRunController
// and its SDK session) does not survive a process restart, so any run still marked
// queued/running in the DB is a crash/restart leftover with no live owner. Mark
// them failed once at startup so metrics and the clear-session guard stay honest.
sqlite
  .prepare(
    `UPDATE chat_runs
     SET status = 'failed',
         error = COALESCE(error, 'Interrupted by a server restart.'),
         completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
     WHERE status IN ('queued', 'running')`,
  )
  .run()

export { sqlite }

function withMigrationLock(run: () => void) {
  const lockPath = `${databasePath}.migration-lock`
  const deadline = Date.now() + 30_000
  const waitBuffer = new Int32Array(new SharedArrayBuffer(4))

  while (true) {
    try {
      mkdirSync(lockPath)
      break
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > 60_000) {
          rmSync(lockPath, { recursive: true, force: true })
          continue
        }
      } catch {
        continue
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for database migrations: ${databasePath}`, {
          cause: error,
        })
      }
      Atomics.wait(waitBuffer, 0, 0, 50)
    }
  }

  try {
    run()
  } finally {
    rmSync(lockPath, { recursive: true, force: true })
  }
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

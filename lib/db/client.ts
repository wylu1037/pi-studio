import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { dirname, join, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import * as schema from './schema'
import { piStudioDataDir } from '@/lib/runtime/paths'

export const databasePath = resolve(
  process.env.DATABASE_URL ?? join(piStudioDataDir(), 'pi-studio.sqlite'),
)
mkdirSync(dirname(databasePath), { recursive: true })

const sqlite = new Database(databasePath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

export const db = drizzle(sqlite, { schema })
migrate(db, {
  migrationsFolder: process.env.PI_STUDIO_MIGRATIONS_DIR ?? join(process.cwd(), 'drizzle'),
})
export { sqlite }

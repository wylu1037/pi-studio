import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'
import * as schema from './schema'
import { piStudioDataDir } from '@/lib/runtime/paths'

const dbPath = process.env.DATABASE_URL ?? join(piStudioDataDir(), 'pi-studio.sqlite')
mkdirSync(dirname(dbPath), { recursive: true })

const sqlite = new Database(dbPath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

export const db = drizzle(sqlite, { schema })
migrate(db, {
  migrationsFolder: process.env.PI_STUDIO_MIGRATIONS_DIR ?? join(process.cwd(), 'drizzle'),
})
export { sqlite }

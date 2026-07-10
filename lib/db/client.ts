import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import * as schema from './schema'

const dbPath = process.env.DATABASE_URL ?? './data/pi-studio.sqlite'
mkdirSync(dirname(dbPath), { recursive: true })

const sqlite = new Database(dbPath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

export const db = drizzle(sqlite, { schema })
export { sqlite }

/* global process */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const standalone = join(root, '.next', 'standalone')
const staging = join(root, '.electron-staging')
const web = join(staging, 'web')
if (!existsSync(join(standalone, 'server.js'))) {
  throw new Error('Next.js standalone output is missing. Run `pnpm build` first.')
}

rmSync(staging, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })
cpSync(standalone, web, { recursive: true })

function internalizeStandaloneLinks(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      internalizeStandaloneLinks(path)
      continue
    }
    if (!entry.isSymbolicLink()) continue

    const sourceTarget = readlinkSync(path)
    const absoluteTarget = resolve(dirname(path), sourceTarget)
    if (!absoluteTarget.startsWith(`${standalone}${sep}`)) continue

    const stagedTarget = join(web, relative(standalone, absoluteTarget))
    rmSync(path, { force: true })
    symlinkSync(
      process.platform === 'win32' ? stagedTarget : relative(dirname(path), stagedTarget),
      path,
      process.platform === 'win32' ? 'junction' : undefined,
    )
  }
}

internalizeStandaloneLinks(web)

rmSync(join(web, '.env'), { force: true })
rmSync(join(web, 'drizzle'), { recursive: true, force: true })

const targets = [
  [join(root, '.next', 'static'), join(web, '.next', 'static')],
  [join(root, 'public'), join(web, 'public')],
]

for (const [source, target] of targets) {
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  cpSync(source, target, { recursive: true })
}

// The staging tree is disposable and isolated from both the source standalone
// output and pnpm's store. Replace the traced package with a complete copy so
// Electron native compilation never mutates development dependencies.
const sourceBetterSqlite = realpathSync(join(root, 'node_modules', 'better-sqlite3'))
const stagedBetterSqlite = realpathSync(join(web, 'node_modules', 'better-sqlite3'))
rmSync(stagedBetterSqlite, { recursive: true, force: true })
mkdirSync(stagedBetterSqlite, { recursive: true })
cpSync(sourceBetterSqlite, stagedBetterSqlite, { recursive: true })

process.stdout.write(`Electron staging bundle prepared at ${web}\n`)

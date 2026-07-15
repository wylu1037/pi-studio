/* global process */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { realpathSync, readdirSync, rmSync } from 'node:fs'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const electronVersion = require('electron/package.json').version
const electronPath = require('electron')
const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js')
const rootBetterSqlite = realpathSync(join(root, 'node_modules', 'better-sqlite3'))
const betterSqliteRequire = createRequire(join(rootBetterSqlite, 'package.json'))
const prebuildInstall = betterSqliteRequire.resolve('prebuild-install/bin.js')
const packageDir = realpathSync(
  join(root, '.electron-staging', 'web', 'node_modules', 'better-sqlite3'),
)

process.stdout.write(
  `Preparing staged better-sqlite3 for Electron ${electronVersion} (${process.arch})...\n`,
)

const nativeEnv = {
  ...process.env,
  npm_config_runtime: 'electron',
  npm_config_target: electronVersion,
  npm_config_arch: process.arch,
  npm_config_dist_url: 'https://electronjs.org/headers',
}

const prebuild = spawnSync(
  process.execPath,
  [prebuildInstall, '--runtime=electron', `--target=${electronVersion}`, `--arch=${process.arch}`],
  {
    cwd: packageDir,
    env: nativeEnv,
    stdio: 'inherit',
  },
)

if (prebuild.status !== 0) {
  process.stdout.write('No compatible prebuilt binary found; compiling from source.\n')
  const compileEnv = { ...nativeEnv }
  if (process.platform === 'darwin') {
    const sdk = spawnSync('xcrun', ['--show-sdk-path'], { encoding: 'utf8' })
    const sdkPath = sdk.status === 0 ? sdk.stdout.trim() : ''
    if (sdkPath) {
      const libcxx = join(sdkPath, 'usr', 'include', 'c++', 'v1')
      compileEnv.SDKROOT = sdkPath
      compileEnv.CPLUS_INCLUDE_PATH = [libcxx, process.env.CPLUS_INCLUDE_PATH]
        .filter(Boolean)
        .join(':')
    }
  }
  const rebuild = spawnSync(
    process.execPath,
    [
      nodeGyp,
      'rebuild',
      '--release',
      `--target=${electronVersion}`,
      `--arch=${process.arch}`,
      '--dist-url=https://electronjs.org/headers',
    ],
    {
      cwd: packageDir,
      env: compileEnv,
      stdio: 'inherit',
    },
  )
  if (rebuild.status !== 0) process.exit(rebuild.status ?? 1)
}

const verificationCode = `
  const Database = require(${JSON.stringify(packageDir)});
  const database = new Database(':memory:');
  database.close();
  process.stdout.write('Electron native module verified.\\n');
`
const verification = spawnSync(electronPath, ['-e', verificationCode], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit',
})

if (verification.status !== 0) process.exit(verification.status ?? 1)

for (const path of ['binding.gyp', 'src', 'deps']) {
  rmSync(join(packageDir, path), { recursive: true, force: true })
}
const releaseDir = join(packageDir, 'build', 'Release')
for (const entry of readdirSync(releaseDir)) {
  if (entry !== 'better_sqlite3.node') {
    rmSync(join(releaseDir, entry), { recursive: true, force: true })
  }
}
for (const path of [
  'Makefile',
  'binding.Makefile',
  'config.gypi',
  'better_sqlite3.target.mk',
  'test_extension.target.mk',
]) {
  rmSync(join(packageDir, 'build', path), { force: true })
}

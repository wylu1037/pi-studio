/* eslint-disable @typescript-eslint/no-require-imports */
/* global URL, process, require, setTimeout */
const { app, BrowserWindow, dialog, shell, utilityProcess } = require('electron')
const { createServer } = require('node:net')
const { delimiter, join } = require('node:path')
const {
  appendFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} = require('node:fs')
const http = require('node:http')

const LOG_PRIORITY = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: Number.POSITIVE_INFINITY,
}

let mainWindow = null
let serverProcess = null
let serverLogStream = null
let serverUrl = null
let quitting = false

app.setAppUserModelId('com.pistudio.desktop')

function mainLogLevel() {
  try {
    const settings = JSON.parse(
      readFileSync(join(app.getPath('userData'), 'settings.json'), 'utf8'),
    )
    return Object.hasOwn(LOG_PRIORITY, settings.logLevel) ? settings.logLevel : 'info'
  } catch {
    return 'info'
  }
}

function mainLog(level, ...values) {
  if (LOG_PRIORITY[level] < LOG_PRIORITY[mainLogLevel()]) return false
  const message = values
    .map((value) =>
      value instanceof Error
        ? value.stack || value.message
        : typeof value === 'string'
          ? value
          : String(value),
    )
    .join(' ')
  const line = `[pi-studio-main] ${new Date().toISOString()} ${level.toUpperCase()} ${message}\n`
  process.stderr.write(line)
  try {
    appendFileSync(join(app.getPath('userData'), 'main.log'), line)
  } catch {
    // The terminal output above remains available if the log file cannot be written.
  }
  return true
}

function executablePath(homeDir) {
  const candidates = [
    process.env.PATH,
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    join(homeDir, '.local', 'bin'),
    join(homeDir, 'Library', 'pnpm'),
    join(homeDir, '.bun', 'bin'),
    join(homeDir, '.volta', 'bin'),
    join(homeDir, '.asdf', 'shims'),
    join(homeDir, '.local', 'share', 'mise', 'shims'),
    ...versionedBinDirs(join(homeDir, '.nvm', 'versions', 'node')),
    ...versionedBinDirs(
      join(homeDir, '.local', 'share', 'fnm', 'node-versions'),
      'installation/bin',
    ),
    ...versionedBinDirs(
      join(homeDir, 'Library', 'Application Support', 'fnm', 'node-versions'),
      'installation/bin',
    ),
  ]
  return [...new Set(candidates.flatMap((value) => (value ? value.split(delimiter) : [])))]
    .filter((value) => value && existsSync(value))
    .join(delimiter)
}

function versionedBinDirs(parent, suffix = 'bin') {
  if (!existsSync(parent)) return []
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(parent, entry.name, suffix))
    .filter(existsSync)
    .sort()
    .reverse()
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 3000
      server.close(() => resolve(port))
    })
  })
}

function waitForServer(url, timeoutMs = 30000) {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const probe = () => {
      const request = http.get(`${url}/api/health`, (response) => {
        response.resume()
        if (response.statusCode && response.statusCode < 500) return resolve()
        retry()
      })
      request.on('error', retry)
      request.setTimeout(1500, () => request.destroy())
    }
    const retry = () => {
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`Pi Studio server did not start within ${timeoutMs}ms.`))
        return
      }
      setTimeout(probe, 250)
    }
    probe()
  })
}

async function startProductionServer() {
  const port = await availablePort()
  const webRoot = join(process.resourcesPath, 'web')
  const serverPath = join(webRoot, 'server.js')
  const dataDir = app.getPath('userData')
  const workspaceDir = join(dataDir, 'workspace')
  const serverLog = join(dataDir, 'server.log')
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(workspaceDir, { recursive: true })
  serverLogStream = createWriteStream(serverLog, { flags: 'a' })

  serverProcess = utilityProcess.fork(serverPath, [], {
    cwd: workspaceDir,
    env: {
      ...process.env,
      PATH: executablePath(app.getPath('home')),
      NODE_ENV: 'production',
      HOSTNAME: '127.0.0.1',
      PORT: String(port),
      PI_STUDIO_DATA_DIR: dataDir,
      DATABASE_URL: join(dataDir, 'pi-studio.sqlite'),
      PI_STUDIO_MIGRATIONS_DIR: join(process.resourcesPath, 'drizzle'),
    },
    stdio: 'pipe',
    serviceName: 'Pi Studio Server',
  })
  serverProcess.stdout?.pipe(serverLogStream, { end: false })
  serverProcess.stderr?.pipe(serverLogStream, { end: false })
  serverProcess.once('exit', (code) => {
    if (code && !quitting) mainLog('error', `Pi Studio server exited with code ${code}.`)
  })

  const url = `http://127.0.0.1:${port}`
  await waitForServer(url)
  return url
}

function createWindow(url) {
  const allowedOrigin = new URL(url).origin
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#f4f3ef',
    title: 'Pi Studio',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.once('closed', () => {
    mainWindow = null
  })
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith('http://') || target.startsWith('https://'))
      void shell.openExternal(target)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, target) => {
    try {
      if (new URL(target).origin === allowedOrigin) return
    } catch {
      // Invalid navigation targets are blocked below.
    }
    event.preventDefault()
    if (target.startsWith('http://') || target.startsWith('https://'))
      void shell.openExternal(target)
  })
  void mainWindow.loadURL(url)
}

const hasLock = app.requestSingleInstanceLock()
if (!hasLock) app.quit()

app.on('second-instance', () => {
  if (!mainWindow && serverUrl) createWindow(serverUrl)
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

app.whenReady().then(async () => {
  try {
    serverUrl = app.isPackaged
      ? await startProductionServer()
      : process.env.PI_STUDIO_DEV_URL || 'http://localhost:3000'
    createWindow(serverUrl)
  } catch (error) {
    const logged = mainLog('error', error)
    const logPath = join(app.getPath('userData'), 'main.log')
    dialog.showErrorBox(
      'Pi Studio failed to start',
      `${error instanceof Error ? error.message : String(error)}${logged ? `\n\nLog: ${logPath}` : ''}`,
    )
    app.quit()
  }
})

app.on('before-quit', () => {
  quitting = true
  if (serverProcess) serverProcess.kill()
  serverLogStream?.end()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (!mainWindow && serverUrl) createWindow(serverUrl)
  else if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show()
})

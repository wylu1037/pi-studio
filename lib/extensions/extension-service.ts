import { existsSync } from 'node:fs'
import { lstat, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { getAgentDir, withFileMutationQueue } from '@earendil-works/pi-coding-agent'
import ts from 'typescript'
import { decodeExtensionId, listRuntimeExtensions } from '@/lib/packages/package-service'
import { canonicalWorkspacePath, isProjectTrusted, setProjectTrust } from './project-trust'
import { assertExtensionWorkspace } from './workspaces'

export type ExtensionTemplate =
  | 'empty'
  | 'tool'
  | 'command'
  | 'permission-gate'
  | 'lifecycle'
  | 'context-modifier'
  | 'provider'
  | 'session-state'

export interface ExtensionFileEntry {
  path: string
  type: 'file' | 'directory'
  size?: number
}

export interface ExtensionValidationDiagnostic {
  file?: string
  line?: number
  column?: number
  severity: 'error' | 'warning'
  code: string
  message: string
}

export interface ExtensionStaticCapabilities {
  tools: string[]
  commands: string[]
  hooks: string[]
  providers: string[]
  ui: string[]
}

const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_FILES = 300
const MANAGED_MARKER = '.pi-studio-extension.json'
const EDITABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt'])
const BLOCKED_SEGMENTS = new Set(['.env', '.git', 'node_modules', 'data'])

function normalizeRelativePath(path: string) {
  const normalized = path.replaceAll('\\', '/')
  if (!normalized || normalized === '.' || isAbsolute(normalized)) {
    throw new Error('A relative extension file path is required.')
  }
  const segments = normalized.split('/')
  if (segments.some((segment) => !segment || segment === '..' || BLOCKED_SEGMENTS.has(segment))) {
    throw new Error('This extension file path is not allowed.')
  }
  return normalized
}

function pathInside(root: string, target: string) {
  const value = relative(root, target)
  return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value))
}

function extensionScopeRoot(scope: 'global' | 'project', cwd: string) {
  return scope === 'global'
    ? join(getAgentDir(), 'extensions')
    : join(canonicalWorkspacePath(cwd), '.pi', 'extensions')
}

async function resolveExtensionRoot(id: string, cwd: string) {
  const decoded = decodeExtensionId(id)
  if (!decoded) throw new Error('Invalid extension ID.')
  const workspace = assertExtensionWorkspace(cwd)
  const scopeRoot = extensionScopeRoot(decoded.scope, workspace)
  const absolutePath = resolve(decoded.path)
  const parent = dirname(absolutePath)
  const isDirectoryEntry =
    basename(absolutePath).replace(/\.(?:m?[jt]s|c[jt]s)$/, '') === 'index' &&
    resolve(parent) !== resolve(scopeRoot)
  const candidate = parent

  if (!pathInside(resolve(scopeRoot), candidate)) {
    throw new Error('The extension is outside the editable extension roots.')
  }

  const existingRoot = existsSync(candidate) ? await realpath(candidate) : resolve(candidate)
  const existingScopeRoot = existsSync(scopeRoot) ? await realpath(scopeRoot) : resolve(scopeRoot)
  if (!pathInside(existingScopeRoot, existingRoot)) {
    throw new Error('The extension path escapes its configured root.')
  }

  return {
    scope: decoded.scope,
    cwd: workspace,
    root: existingRoot,
    scopeRoot: existingScopeRoot,
    singleFile: isDirectoryEntry ? undefined : basename(absolutePath),
  }
}

async function targetExtensionFile(id: string, cwd: string, requestedPath: string) {
  const workspace = await resolveExtensionRoot(id, cwd)
  const relativePath = normalizeRelativePath(requestedPath)
  if (workspace.singleFile && relativePath !== workspace.singleFile) {
    throw new Error('This top-level extension exposes only its source file.')
  }
  const target = resolve(workspace.root, relativePath)
  if (!pathInside(workspace.root, target)) throw new Error('The extension path escapes its root.')

  const parent = dirname(target)
  await mkdir(parent, { recursive: true })
  const realParent = await realpath(parent)
  if (!pathInside(workspace.root, realParent)) {
    throw new Error('The extension path uses a symlink outside its root.')
  }
  if (existsSync(target)) {
    const details = await lstat(target)
    if (details.isSymbolicLink()) throw new Error('Editing symbolic links is not allowed.')
  }
  return { ...workspace, target, relativePath }
}

async function collectFiles(root: string, base = root, result: ExtensionFileEntry[] = []) {
  if (result.length >= MAX_FILES) return result
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (result.length >= MAX_FILES) break
    if (BLOCKED_SEGMENTS.has(entry.name) || entry.name === MANAGED_MARKER) continue
    const absolute = join(root, entry.name)
    const path = relative(base, absolute).split(sep).join('/')
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      result.push({ path, type: 'directory' })
      await collectFiles(absolute, base, result)
    } else if (entry.isFile() && EDITABLE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      result.push({ path, type: 'file', size: (await stat(absolute)).size })
    }
  }
  return result
}

export async function listExtensionFiles(id: string, cwd: string) {
  const workspace = await resolveExtensionRoot(id, cwd)
  if (workspace.singleFile) {
    const details = await stat(workspace.root)
    return [{ path: workspace.singleFile, type: 'file' as const, size: details.size }]
  }
  return collectFiles(workspace.root)
}

export async function readExtensionFile(id: string, cwd: string, path: string) {
  const file = await targetExtensionFile(id, cwd, path)
  const details = await stat(file.target)
  if (!details.isFile()) throw new Error('The requested extension path is not a file.')
  if (details.size > MAX_FILE_BYTES) throw new Error('The requested extension file is too large.')
  return { path: file.relativePath, content: await readFile(file.target, 'utf8') }
}

export async function writeExtensionFile(id: string, cwd: string, path: string, content: string) {
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
    throw new Error('The extension file is too large.')
  }
  const file = await targetExtensionFile(id, cwd, path)
  if (file.scope === 'project' && !isProjectTrusted(file.cwd)) {
    throw new Error('Trust this project before editing its extensions.')
  }
  await withFileMutationQueue(file.target, () => writeFile(file.target, content, 'utf8'))
  return { path: file.relativePath, content }
}

export async function getExtensionSource(id: string, cwd: string) {
  const workspace = assertExtensionWorkspace(cwd)
  const extension = (await listRuntimeExtensions(workspace)).find((item) => item.id === id)
  if (!extension) throw new Error('Extension not found.')
  const existingSource = await realpath(extension.path)
  const details = await stat(existingSource)
  if (!details.isFile() || details.size > MAX_FILE_BYTES) {
    throw new Error('The extension source cannot be previewed.')
  }
  return { path: existingSource, content: await readFile(existingSource, 'utf8') }
}

export async function listExtensionsWithRuntime(cwd: string) {
  const workspace = assertExtensionWorkspace(cwd)
  const [extensions, runtime] = await Promise.all([
    listRuntimeExtensions(workspace),
    import('@/lib/chat/sdk-session-manager'),
  ])
  const snapshots = runtime.listSdkSessionExtensionSnapshots(workspace)
  const diagnostics = runtime.listSdkExtensionDiagnostics(workspace)

  return Promise.all(
    extensions.map(async (extension) => {
      const extensionPath = resolve(extension.path)
      const loadedIn = snapshots.filter((snapshot) =>
        snapshot.extensions.some((item) => resolve(item.path) === extensionPath),
      )
      const tools = loadedIn.flatMap((snapshot) =>
        snapshot.extensions
          .filter((item) => resolve(item.path) === extensionPath)
          .flatMap((item) => item.tools.map((tool) => tool.name)),
      )
      const commands = loadedIn.flatMap((snapshot) =>
        snapshot.extensions
          .filter((item) => resolve(item.path) === extensionPath)
          .flatMap((item) => item.commands.map((command) => command.name)),
      )
      const flags = loadedIn.flatMap((snapshot) =>
        snapshot.extensions
          .filter((item) => resolve(item.path) === extensionPath)
          .flatMap((item) => item.flags.map((flag) => flag.name)),
      )
      const extensionDiagnostics = diagnostics.filter(
        (diagnostic) =>
          diagnostic.extensionPath && resolve(diagnostic.extensionPath) === extensionPath,
      )
      const latestDiagnostic = [...extensionDiagnostics].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      )[0]
      const lastError = latestDiagnostic?.level === 'error' ? latestDiagnostic : undefined
      let staticCapabilities: ExtensionStaticCapabilities = {
        tools: [],
        commands: [],
        hooks: [],
        providers: [],
        ui: [],
      }
      try {
        const details = await stat(extension.path)
        if (details.isFile() && details.size <= MAX_FILE_BYTES) {
          staticCapabilities = inspectSource(
            await readFile(extension.path, 'utf8'),
            extension.path,
          ).capabilities
        }
      } catch {
        // Runtime metadata remains useful when source inspection is unavailable.
      }
      const hasTuiOnlyCapability = staticCapabilities.ui.some((capability) =>
        ['custom', 'setFooter', 'setHeader', 'setEditorComponent'].includes(capability),
      )
      const hasWebUiCapability = staticCapabilities.ui.some((capability) =>
        ['notify', 'select', 'confirm', 'input', 'editor', 'setStatus', 'setWidget'].includes(
          capability,
        ),
      )
      return {
        ...extension,
        canToggle: Boolean(extension.relativePath),
        compatibility: hasTuiOnlyCapability
          ? hasWebUiCapability
            ? ('partial' as const)
            : ('tui-only' as const)
          : ('web' as const),
        status:
          extension.status === 'trust-required'
            ? extension.status
            : lastError
              ? ('load-error' as const)
              : loadedIn.length > 0
                ? ('loaded' as const)
                : extension.status,
        capabilities: {
          tools: [...new Set([...tools, ...staticCapabilities.tools])],
          commands: [...new Set([...commands, ...staticCapabilities.commands])],
          shortcuts: extension.capabilities?.shortcuts ?? [],
          flags: [...new Set(flags)],
          providers: [
            ...new Set([
              ...(extension.capabilities?.providers ?? []),
              ...staticCapabilities.providers,
            ]),
          ],
          hooks: [
            ...new Set([...(extension.capabilities?.hooks ?? []), ...staticCapabilities.hooks]),
          ],
          ui: Boolean(extension.capabilities?.ui || staticCapabilities.ui.length),
        },
        runtime: {
          loaded: loadedIn.length > 0,
          sessionIds: loadedIn.map((snapshot) => snapshot.sessionId),
          lastLoadedAt: loadedIn
            .map((snapshot) => snapshot.loadedAt)
            .sort()
            .at(-1),
          lastErrorAt: lastError?.createdAt,
        },
        diagnosticCount: extensionDiagnostics.length,
      }
    }),
  )
}

function templateSource(name: string, template: ExtensionTemplate) {
  const extensionName = name.replaceAll('-', ' ')
  const header = `import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'\n`
  if (template === 'tool') {
    return `${header}import { Type } from 'typebox'\n\nexport default function ${toIdentifier(name)}(pi: ExtensionAPI) {\n  pi.registerTool({\n    name: '${name}',\n    label: '${titleCase(extensionName)}',\n    description: 'Describe what this tool does.',\n    parameters: Type.Object({\n      input: Type.String({ description: 'Input to process' }),\n    }),\n    async execute(_toolCallId, params) {\n      return {\n        content: [{ type: 'text', text: params.input }],\n        details: {},\n      }\n    },\n  })\n}\n`
  }
  if (template === 'command') {
    return `${header}\nexport default function ${toIdentifier(name)}(pi: ExtensionAPI) {\n  pi.registerCommand('${name}', {\n    description: 'Describe this command.',\n    async handler(args, ctx) {\n      ctx.ui.notify(args || '${titleCase(extensionName)}', 'info')\n    },\n  })\n}\n`
  }
  if (template === 'permission-gate') {
    return `${header}\nexport default function ${toIdentifier(name)}(pi: ExtensionAPI) {\n  pi.on('tool_call', async (event, ctx) => {\n    if (event.toolName !== 'bash') return\n    const command = String((event.input as { command?: unknown }).command ?? '')\n    if (!command.includes('rm ')) return\n    const allowed = await ctx.ui.confirm('Review command', command)\n    if (!allowed) return { block: true, reason: 'Blocked by ${name}' }\n  })\n}\n`
  }
  if (template === 'lifecycle') {
    return `${header}\nexport default function ${toIdentifier(name)}(pi: ExtensionAPI) {\n  pi.on('session_start', (_event, ctx) => {\n    ctx.ui.notify('${titleCase(extensionName)} loaded', 'info')\n  })\n\n  pi.on('turn_end', (event) => {\n    console.info('[${name}] turn completed', event)\n  })\n}\n`
  }
  if (template === 'context-modifier') {
    return `${header}\nexport default function ${toIdentifier(name)}(pi: ExtensionAPI) {\n  pi.on('before_agent_start', async (event) => ({\n    systemPrompt: \`${'${event.systemPrompt}'}\\n\\nFollow the project-specific guidance from ${name}.\`,\n  }))\n}\n`
  }
  if (template === 'provider') {
    return `${header}\nexport default function ${toIdentifier(name)}(pi: ExtensionAPI) {\n  // Register a provider here. Provider adapters execute with full Node.js permissions.\n  // pi.registerProvider('${name}', { ... })\n  pi.on('session_start', (_event, ctx) => {\n    ctx.ui.notify('${titleCase(extensionName)} provider extension loaded', 'info')\n  })\n}\n`
  }
  if (template === 'session-state') {
    return `${header}\nconst ENTRY_TYPE = '${name}-state'\n\nexport default function ${toIdentifier(name)}(pi: ExtensionAPI) {\n  let count = 0\n\n  pi.registerCommand('${name}', {\n    description: 'Update and persist extension session state.',\n    async handler(_args, ctx) {\n      count += 1\n      pi.appendEntry(ENTRY_TYPE, { count })\n      ctx.ui.notify(\`Count: ${'${count}'}\`, 'info')\n    },\n  })\n}\n`
  }
  return `${header}\nexport default function ${toIdentifier(name)}(pi: ExtensionAPI) {\n  pi.on('session_start', (_event, ctx) => {\n    ctx.ui.notify('${titleCase(extensionName)} loaded', 'info')\n  })\n}\n`
}

function toIdentifier(value: string) {
  const identifier = value
    .split(/[^a-zA-Z0-9_$]+/)
    .filter(Boolean)
    .map((part, index) =>
      index === 0 ? part.toLowerCase() : part[0]?.toUpperCase() + part.slice(1).toLowerCase(),
    )
    .join('')
  return /^[a-zA-Z_$]/.test(identifier) ? identifier : `extension${identifier}`
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export async function createLocalExtension(input: {
  name: string
  scope: 'global' | 'project'
  cwd: string
  template: ExtensionTemplate
}) {
  const name = input.name.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) {
    throw new Error(
      'Extension names may contain lowercase letters, numbers, hyphens, and underscores.',
    )
  }
  const cwd = assertExtensionWorkspace(input.cwd)
  if (input.scope === 'project' && !isProjectTrusted(cwd)) {
    throw new Error('Trust this project before creating a project extension.')
  }
  if (input.scope === 'project') setProjectTrust(cwd, 'once')
  const scopeRoot = extensionScopeRoot(input.scope, cwd)
  const root = join(scopeRoot, name)
  if (existsSync(root)) throw new Error('An extension with this name already exists.')

  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'index.ts'), templateSource(name, input.template), 'utf8')
  await writeFile(
    join(root, 'README.md'),
    `# ${titleCase(name.replaceAll('-', ' '))}\n\nCreated by Pi Studio. Review the source before enabling it.\n`,
    'utf8',
  )
  await writeFile(
    join(root, MANAGED_MARKER),
    `${JSON.stringify({ version: 1, createdAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  )

  const path = await realpath(join(root, 'index.ts'))
  const extension = (await listRuntimeExtensions(cwd)).find((item) => resolve(item.path) === path)
  if (!extension) throw new Error('The extension was created but could not be discovered.')
  return extension
}

export async function deleteLocalExtension(id: string, cwd: string) {
  const workspace = await resolveExtensionRoot(id, cwd)
  if (workspace.singleFile)
    throw new Error('Only Pi Studio managed extension folders can be deleted.')
  if (!existsSync(join(workspace.root, MANAGED_MARKER))) {
    throw new Error('This extension was not created by Pi Studio and will not be deleted.')
  }
  if (workspace.scope === 'project' && !isProjectTrusted(workspace.cwd)) {
    throw new Error('Trust this project before deleting its extensions.')
  }
  await rm(workspace.root, { recursive: true, force: false })
  return { deleted: true }
}

function flattenMessage(message: string | ts.DiagnosticMessageChain) {
  return ts.flattenDiagnosticMessageText(message, '\n')
}

function diagnosticFromTs(diagnostic: ts.Diagnostic): ExtensionValidationDiagnostic {
  const position =
    diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      : undefined
  return {
    file: diagnostic.file?.fileName,
    line: position ? position.line + 1 : undefined,
    column: position ? position.character + 1 : undefined,
    severity: diagnostic.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
    code: `TS${diagnostic.code}`,
    message: flattenMessage(diagnostic.messageText),
  }
}

function inspectSource(sourceText: string, fileName: string) {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true)
  const capabilities: ExtensionStaticCapabilities = {
    tools: [],
    commands: [],
    hooks: [],
    providers: [],
    ui: [],
  }
  let hasDefaultExport = false
  const visit = (node: ts.Node) => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
    ) {
      hasDefaultExport = true
    }
    if (ts.isExportAssignment(node) && !node.isExportEquals) hasDefaultExport = true
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression)
    ) {
      const owner = node.expression.expression.text
      const method = node.expression.name.text
      const first = node.arguments[0]
      const literal = first && ts.isStringLiteralLike(first) ? first.text : undefined
      if (owner === 'pi' && method === 'registerCommand' && literal)
        capabilities.commands.push(literal)
      if (owner === 'pi' && method === 'on' && literal) capabilities.hooks.push(literal)
      if (owner === 'pi' && method === 'registerProvider' && literal)
        capabilities.providers.push(literal)
      if (
        owner === 'pi' &&
        method === 'registerTool' &&
        first &&
        ts.isObjectLiteralExpression(first)
      ) {
        const nameProperty = first.properties.find(
          (property) =>
            ts.isPropertyAssignment(property) &&
            ((ts.isIdentifier(property.name) && property.name.text === 'name') ||
              (ts.isStringLiteralLike(property.name) && property.name.text === 'name')),
        )
        if (
          nameProperty &&
          ts.isPropertyAssignment(nameProperty) &&
          ts.isStringLiteralLike(nameProperty.initializer)
        ) {
          capabilities.tools.push(nameProperty.initializer.text)
        }
      }
      if (owner === 'ui' || (owner === 'ctx' && method === 'ui')) capabilities.ui.push(method)
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      ts.isIdentifier(node.expression.expression.expression) &&
      node.expression.expression.expression.text === 'ctx' &&
      node.expression.expression.name.text === 'ui'
    ) {
      capabilities.ui.push(node.expression.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  for (const key of Object.keys(capabilities) as Array<keyof ExtensionStaticCapabilities>) {
    capabilities[key] = [...new Set(capabilities[key])]
  }
  return { hasDefaultExport, capabilities }
}

export async function validateLocalExtension(id: string, cwd: string) {
  const files = (await listExtensionFiles(id, cwd)).filter(
    (file) => file.type === 'file' && /\.[cm]?[jt]sx?$/.test(file.path),
  )
  const workspace = await resolveExtensionRoot(id, cwd)
  const rootNames = files.map((file) => join(workspace.root, file.path))
  const compilerOptions: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
  }
  const host = ts.createCompilerHost(compilerOptions)
  host.resolveModuleNames = (moduleNames, containingFile) =>
    moduleNames.map(
      (moduleName) =>
        ts.resolveModuleName(moduleName, containingFile, compilerOptions, host).resolvedModule ??
        ts.resolveModuleName(
          moduleName,
          join(process.cwd(), '__pi_studio_extension__.ts'),
          compilerOptions,
          host,
        ).resolvedModule,
    )
  const program = ts.createProgram({ rootNames, options: compilerOptions, host })
  const diagnostics = ts.getPreEmitDiagnostics(program).map(diagnosticFromTs)
  const entryPath =
    rootNames.find((path) => /(?:^|[/\\])index\.[cm]?[jt]sx?$/.test(path)) ?? rootNames[0]
  let capabilities: ExtensionStaticCapabilities = {
    tools: [],
    commands: [],
    hooks: [],
    providers: [],
    ui: [],
  }
  if (!entryPath) {
    diagnostics.push({
      severity: 'error',
      code: 'EXT_ENTRY_MISSING',
      message: 'No TypeScript or JavaScript extension entry file was found.',
    })
  } else {
    const source = await readFile(entryPath, 'utf8')
    const inspection = inspectSource(source, entryPath)
    capabilities = inspection.capabilities
    if (!inspection.hasDefaultExport) {
      diagnostics.push({
        file: entryPath,
        severity: 'error',
        code: 'EXT_DEFAULT_EXPORT',
        message: 'The extension entry must have a default export factory.',
      })
    }
  }
  return {
    valid: diagnostics.every((diagnostic) => diagnostic.severity !== 'error'),
    diagnostics,
    capabilities,
    checkedAt: new Date().toISOString(),
  }
}

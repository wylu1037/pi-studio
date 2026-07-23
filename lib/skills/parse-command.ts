export interface ParsedSkillsCommand {
  /** The package spec: a GitHub URL, `owner/repo`, or skills.sh spec. */
  package: string
  /** The `--skill` / `-s` selector, when the command targets one skill. */
  skill?: string
  /** True when the command installs globally (`-g` / `--global`). */
  global: boolean
}

// Flags that take a value we care about or must skip so their argument is not
// mistaken for the package spec.
const VALUE_FLAGS = new Set([
  '--skill',
  '-s',
  '--agent',
  '-a',
  '--metadata',
  '--subagent',
])

/**
 * Tokenize a shell-ish command line, honoring single/double quotes so values
 * like `--metadata '{"a":1}'` stay intact. This is not a full shell parser; it
 * covers the quoting people actually paste into a skills-add command.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let hasToken = false

  for (const char of input) {
    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      hasToken = true
      continue
    }
    if (/\s/.test(char)) {
      if (hasToken) {
        tokens.push(current)
        current = ''
        hasToken = false
      }
      continue
    }
    current += char
    hasToken = true
  }
  if (hasToken) tokens.push(current)
  return tokens
}

/**
 * Parse a `npx skills add …` (or bare `skills add …`) command into its package
 * spec and options. Returns null when the command is not a recognizable
 * skills-add invocation or lacks a package spec.
 *
 * Accepts variations people paste:
 *   npx skills add https://github.com/owner/repo --skill my-skill
 *   npx -y skills add owner/repo -s my-skill -g
 *   skills a owner/repo --skill=my-skill
 */
export function parseSkillsAddCommand(raw: string): ParsedSkillsCommand | null {
  const tokens = tokenize(raw.trim())
  if (tokens.length === 0) return null

  // Locate the `skills` binary token, tolerating a leading `npx`/`pnpm dlx`/
  // `bunx` and their flags (e.g. `npx -y skills`).
  let index = 0
  const runners = new Set(['npx', 'bunx', 'pnpm', 'pnpx', 'yarn'])
  if (runners.has(tokens[index])) {
    index += 1
    if (tokens[index - 1] === 'pnpm' && tokens[index] === 'dlx') index += 1
    // Skip runner flags such as `-y` / `--yes` before the binary name.
    while (index < tokens.length && tokens[index].startsWith('-')) index += 1
  }
  if (tokens[index] === 'skills') index += 1

  // Next meaningful token must be the add subcommand (`add` or its alias `a`).
  if (tokens[index] !== 'add' && tokens[index] !== 'a') return null
  index += 1

  let packageSpec: string | undefined
  let skill: string | undefined
  let isGlobal = false

  for (; index < tokens.length; index += 1) {
    const token = tokens[index]

    if (token.startsWith('--skill=')) {
      skill = token.slice('--skill='.length)
      continue
    }
    if (token.startsWith('-s=')) {
      skill = token.slice('-s='.length)
      continue
    }
    if (token === '-g' || token === '--global') {
      isGlobal = true
      continue
    }
    if (VALUE_FLAGS.has(token)) {
      const value = tokens[index + 1]
      if ((token === '--skill' || token === '-s') && value) skill = value
      index += 1 // consume the flag's value
      continue
    }
    if (token.startsWith('-')) {
      // Standalone boolean flag (e.g. --copy, -y, --full-depth); ignore.
      continue
    }
    // First bare token is the package spec.
    if (!packageSpec) packageSpec = token
  }

  if (!packageSpec) return null
  return { package: packageSpec, skill: skill || undefined, global: isGlobal }
}

/**
 * Derive a sensible default skill name from a parsed command: prefer the
 * explicit `--skill` selector, otherwise the last path segment of the package
 * spec (repo name), stripped of a trailing `.git`.
 */
export function inferSkillName(parsed: ParsedSkillsCommand): string {
  if (parsed.skill) return parsed.skill
  const spec = parsed.package.replace(/\.git$/, '').replace(/\/+$/, '')
  const segment = spec.split('/').pop() ?? spec
  return segment.replace(/^@/, '')
}

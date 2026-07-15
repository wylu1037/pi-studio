export const supportedCodeLanguages = [
  'bash',
  'c',
  'cpp',
  'csharp',
  'css',
  'diff',
  'dockerfile',
  'go',
  'graphql',
  'html',
  'java',
  'javascript',
  'json',
  'jsx',
  'kotlin',
  'markdown',
  'php',
  'python',
  'ruby',
  'rust',
  'sql',
  'swift',
  'toml',
  'tsx',
  'typescript',
  'xml',
  'yaml',
] as const

export type SupportedCodeLanguage = (typeof supportedCodeLanguages)[number]
export type NormalizedCodeLanguage = SupportedCodeLanguage | 'text'

const supportedCodeLanguageSet = new Set<string>(supportedCodeLanguages)

const codeLanguageAliases: Record<string, SupportedCodeLanguage> = {
  'c#': 'csharp',
  'c++': 'cpp',
  cs: 'csharp',
  docker: 'dockerfile',
  golang: 'go',
  htm: 'html',
  js: 'javascript',
  kt: 'kotlin',
  kts: 'kotlin',
  md: 'markdown',
  node: 'javascript',
  pgsql: 'sql',
  postgresql: 'sql',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'bash',
  shell: 'bash',
  shellscript: 'bash',
  ts: 'typescript',
  yml: 'yaml',
  zsh: 'bash',
}

const codeLanguageLabels: Partial<Record<SupportedCodeLanguage, string>> = {
  bash: 'Bash',
  cpp: 'C++',
  csharp: 'C#',
  css: 'CSS',
  dockerfile: 'Dockerfile',
  go: 'Go',
  graphql: 'GraphQL',
  html: 'HTML',
  java: 'Java',
  javascript: 'JavaScript',
  json: 'JSON',
  jsx: 'JSX',
  kotlin: 'Kotlin',
  markdown: 'Markdown',
  php: 'PHP',
  python: 'Python',
  ruby: 'Ruby',
  rust: 'Rust',
  sql: 'SQL',
  swift: 'Swift',
  toml: 'TOML',
  tsx: 'TSX',
  typescript: 'TypeScript',
  xml: 'XML',
  yaml: 'YAML',
}

function cleanCodeLanguage(language?: string) {
  return (language ?? '')
    .trim()
    .toLowerCase()
    .replace(/^language-/, '')
}

export function normalizeCodeLanguage(language?: string): NormalizedCodeLanguage {
  const cleaned = cleanCodeLanguage(language)
  if (!cleaned || cleaned === 'text' || cleaned === 'txt' || cleaned === 'plaintext') {
    return 'text'
  }
  if (codeLanguageAliases[cleaned]) return codeLanguageAliases[cleaned]
  return supportedCodeLanguageSet.has(cleaned) ? (cleaned as SupportedCodeLanguage) : 'text'
}

export function codeLanguageLabel(language?: string) {
  const cleaned = cleanCodeLanguage(language)
  const normalized = normalizeCodeLanguage(cleaned)
  if (normalized === 'text') return cleaned || 'Plain text'
  return codeLanguageLabels[normalized] ?? normalized
}

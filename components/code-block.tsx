'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { createHighlighterCore, type LanguageRegistration } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import githubLightDefault from 'shiki/themes/github-light-default.mjs'
import {
  codeLanguageLabel,
  normalizeCodeLanguage,
  type SupportedCodeLanguage,
} from '@/lib/markdown/code-languages'
import { showToast } from '@/lib/toast'

type LanguageLoader = () => Promise<LanguageRegistration[]>

const languageLoaders: Record<SupportedCodeLanguage, LanguageLoader> = {
  bash: () => import('shiki/langs/bash.mjs').then((module) => module.default),
  c: () => import('shiki/langs/c.mjs').then((module) => module.default),
  cpp: () => import('shiki/langs/cpp.mjs').then((module) => module.default),
  csharp: () => import('shiki/langs/csharp.mjs').then((module) => module.default),
  css: () => import('shiki/langs/css.mjs').then((module) => module.default),
  diff: () => import('shiki/langs/diff.mjs').then((module) => module.default),
  dockerfile: () => import('shiki/langs/dockerfile.mjs').then((module) => module.default),
  go: () => import('shiki/langs/go.mjs').then((module) => module.default),
  graphql: () => import('shiki/langs/graphql.mjs').then((module) => module.default),
  html: () => import('shiki/langs/html.mjs').then((module) => module.default),
  java: () => import('shiki/langs/java.mjs').then((module) => module.default),
  javascript: () => import('shiki/langs/javascript.mjs').then((module) => module.default),
  json: () => import('shiki/langs/json.mjs').then((module) => module.default),
  jsx: () => import('shiki/langs/jsx.mjs').then((module) => module.default),
  kotlin: () => import('shiki/langs/kotlin.mjs').then((module) => module.default),
  markdown: () => import('shiki/langs/markdown.mjs').then((module) => module.default),
  php: () => import('shiki/langs/php.mjs').then((module) => module.default),
  python: () => import('shiki/langs/python.mjs').then((module) => module.default),
  ruby: () => import('shiki/langs/ruby.mjs').then((module) => module.default),
  rust: () => import('shiki/langs/rust.mjs').then((module) => module.default),
  sql: () => import('shiki/langs/sql.mjs').then((module) => module.default),
  swift: () => import('shiki/langs/swift.mjs').then((module) => module.default),
  toml: () => import('shiki/langs/toml.mjs').then((module) => module.default),
  tsx: () => import('shiki/langs/tsx.mjs').then((module) => module.default),
  typescript: () => import('shiki/langs/typescript.mjs').then((module) => module.default),
  xml: () => import('shiki/langs/xml.mjs').then((module) => module.default),
  yaml: () => import('shiki/langs/yaml.mjs').then((module) => module.default),
}

let highlighterPromise: ReturnType<typeof createHighlighterCore> | null = null
const languageLoadPromises = new Map<SupportedCodeLanguage, Promise<void>>()
const highlightedCodeCache = new Map<string, string>()
const HIGHLIGHT_CACHE_LIMIT = 120

function getHighlighter() {
  highlighterPromise ??= createHighlighterCore({
    themes: [githubLightDefault],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  })
  return highlighterPromise
}

async function ensureLanguage(language: SupportedCodeLanguage) {
  const existing = languageLoadPromises.get(language)
  if (existing) return existing

  const pending = Promise.all([getHighlighter(), languageLoaders[language]()]).then(
    async ([highlighter, registrations]) => {
      await highlighter.loadLanguage(...registrations)
    },
  )
  languageLoadPromises.set(language, pending)
  void pending.catch(() => languageLoadPromises.delete(language))
  return pending
}

async function highlightCode(code: string, language: SupportedCodeLanguage) {
  const cacheKey = `${language}\u0000${code}`
  const cached = highlightedCodeCache.get(cacheKey)
  if (cached) return cached

  await ensureLanguage(language)
  const highlighter = await getHighlighter()
  const html = highlighter.codeToHtml(code, {
    lang: language,
    theme: 'github-light-default',
  })

  if (highlightedCodeCache.size >= HIGHLIGHT_CACHE_LIMIT) {
    const oldestKey = highlightedCodeCache.keys().next().value
    if (oldestKey) highlightedCodeCache.delete(oldestKey)
  }
  highlightedCodeCache.set(cacheKey, html)
  return html
}

type HighlightState = {
  cacheKey: string
  html: string | null
  status: 'fallback' | 'loading' | 'ready'
}

export function CodeBlock({
  code,
  language,
  highlight = true,
}: {
  code: string
  language?: string
  highlight?: boolean
}) {
  const normalizedLanguage = highlight ? normalizeCodeLanguage(language) : 'text'
  const label = codeLanguageLabel(language)
  const cacheKey = `${normalizedLanguage}\u0000${code}`
  const [highlightState, setHighlightState] = useState<HighlightState>({
    cacheKey,
    html: null,
    status: normalizedLanguage === 'text' ? 'fallback' : 'loading',
  })
  const [copied, setCopied] = useState(false)
  const currentHighlight =
    highlightState.cacheKey === cacheKey
      ? highlightState
      : {
          cacheKey,
          html: null,
          status: normalizedLanguage === 'text' ? 'fallback' : ('loading' as const),
        }

  useEffect(() => {
    let cancelled = false

    if (normalizedLanguage === 'text') {
      setHighlightState({ cacheKey, html: null, status: 'fallback' })
      return () => {
        cancelled = true
      }
    }

    const cached = highlightedCodeCache.get(cacheKey)
    if (cached) {
      setHighlightState({ cacheKey, html: cached, status: 'ready' })
      return () => {
        cancelled = true
      }
    }

    setHighlightState({ cacheKey, html: null, status: 'loading' })
    void highlightCode(code, normalizedLanguage)
      .then((html) => {
        if (!cancelled) setHighlightState({ cacheKey, html, status: 'ready' })
      })
      .catch(() => {
        if (!cancelled) setHighlightState({ cacheKey, html: null, status: 'fallback' })
      })

    return () => {
      cancelled = true
    }
  }, [cacheKey, code, normalizedLanguage])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

  const copyLabel = copied ? 'Copied code' : 'Copy code'
  const fallbackCode = useMemo(
    () => (
      <pre className="w-max min-w-full p-3 font-mono text-[11px] leading-relaxed whitespace-pre text-foreground/90">
        <code>{code}</code>
      </pre>
    ),
    [code],
  )

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
    } catch {
      setCopied(false)
      showToast({
        tone: 'error',
        title: 'Copy failed',
        message: 'Unable to access the clipboard.',
      })
    }
  }

  return (
    <div className="max-w-full overflow-hidden border border-border bg-card">
      <div className="flex h-7 items-center justify-between border-b border-border bg-panel px-3">
        <span className="truncate font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
        <button
          type="button"
          onClick={() => void copyCode()}
          className="flex size-6 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-ring active:translate-y-px"
          title={copyLabel}
          aria-label={copyLabel}
        >
          {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
        </button>
      </div>
      <div
        className="scrollbar-thin max-w-full overflow-x-auto bg-card/70 [&_.shiki]:m-0! [&_.shiki]:w-max! [&_.shiki]:min-w-full! [&_.shiki]:bg-transparent! [&_.shiki]:p-3! [&_.shiki]:font-mono [&_.shiki]:text-[11px] [&_.shiki]:leading-relaxed"
        tabIndex={0}
        aria-label={`${label} code`}
        aria-busy={currentHighlight.status === 'loading'}
      >
        {currentHighlight.html ? (
          <div dangerouslySetInnerHTML={{ __html: currentHighlight.html }} />
        ) : (
          fallbackCode
        )}
      </div>
    </div>
  )
}

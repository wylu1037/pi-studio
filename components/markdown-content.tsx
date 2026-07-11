import type { ReactNode } from 'react'
import { MermaidDiagram } from '@/components/mermaid-diagram'

type MarkdownBlock =
  | { type: 'code'; language?: string; content: string }
  | { type: 'heading'; level: number; content: string }
  | { type: 'paragraph'; content: string }
  | { type: 'quote'; content: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'hr' }

const blockStartPattern = /^(#{1,6}\s+|```|>\s?|[-*]\s+|\d+\.\s+|---+\s*$)/
const inlinePattern = /(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g

export function MarkdownContent({ content }: { content: string }) {
  const blocks = parseMarkdown(content)
  return (
    <div className="min-w-0 max-w-full space-y-3 overflow-hidden border-l-2 border-accent/50 pl-3.5 text-sm leading-relaxed text-foreground wrap-break-word">
      {blocks.map((block, index) => renderBlock(block, index))}
    </div>
  );
}

function parseMarkdown(content: string) {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }

    const fence = line.match(/^```\s*([^`]*)\s*$/)
    if (fence) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !lines[index].startsWith('```')) {
        code.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push({ type: 'code', language: fence[1]?.trim(), content: code.join('\n') })
      continue
    }

    if (/^---+\s*$/.test(line.trim())) {
      blocks.push({ type: 'hr' })
      index += 1
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, content: heading[2] })
      index += 1
      continue
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push({ type: 'quote', content: quote.join('\n') })
      continue
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*]\s+/, ''))
        index += 1
      }
      blocks.push({ type: 'list', ordered: false, items })
      continue
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s+/, ''))
        index += 1
      }
      blocks.push({ type: 'list', ordered: true, items })
      continue
    }

    const paragraph: string[] = []
    while (
      index < lines.length &&
      lines[index].trim() &&
      !blockStartPattern.test(lines[index])
    ) {
      paragraph.push(lines[index])
      index += 1
    }
    blocks.push({ type: 'paragraph', content: paragraph.join('\n') })
  }

  return blocks
}

function renderBlock(block: MarkdownBlock, key: number) {
  switch (block.type) {
    case 'code':
      if (block.language?.toLowerCase() === 'mermaid') {
        return <MermaidDiagram key={key} chart={block.content} />
      }
      return (
        <div
          key={key}
          className="max-w-full overflow-hidden border border-border bg-code"
        >
          {block.language && (
            <div className="border-b border-border px-3 py-1 font-mono text-[10px] uppercase text-muted-foreground">
              {block.language}
            </div>
          )}
          <pre className="max-w-full overflow-hidden whitespace-pre-wrap wrap-break-word p-3 font-mono text-[11px] leading-relaxed text-foreground/90">
            <code>{block.content}</code>
          </pre>
        </div>
      );
    case 'heading': {
      const level = Math.min(6, Math.max(1, block.level))
      return (
        <div
          key={key}
          role="heading"
          aria-level={level}
          className="font-mono text-[13px] font-semibold leading-snug text-foreground"
        >
          {renderInline(block.content)}
        </div>
      )
    }
    case 'quote':
      return (
        <blockquote key={key} className="border-l-2 border-border-strong pl-3 font-mono text-[12px] italic text-muted-foreground">
          {renderInlineWithBreaks(block.content)}
        </blockquote>
      )
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag key={key} className={block.ordered ? 'list-decimal space-y-1 pl-5' : 'list-disc space-y-1 pl-5'}>
          {block.items.map((item, index) => (
            <li key={`${key}-${index}`}>{renderInline(item)}</li>
          ))}
        </Tag>
      )
    }
    case 'hr':
      return <div key={key} className="h-px bg-border" />
    case 'paragraph':
      return <p key={key}>{renderInlineWithBreaks(block.content)}</p>
  }
}

function renderInlineWithBreaks(content: string) {
  return content.split('\n').flatMap((line, index) => (
    index === 0 ? renderInline(line) : [<br key={`br-${index}`} />, ...renderInline(line)]
  ))
}

function renderInline(content: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let cursor = 0

  for (const match of content.matchAll(inlinePattern)) {
    const [token] = match
    const index = match.index ?? 0
    if (index > cursor) nodes.push(content.slice(cursor, index))
    nodes.push(renderInlineToken(token, nodes.length))
    cursor = index + token.length
  }

  if (cursor < content.length) nodes.push(content.slice(cursor))
  return nodes
}

function renderInlineToken(token: string, key: number) {
  if (token.startsWith('`')) {
    return (
      <code key={key} className="border border-border bg-muted px-1 py-0.5 font-mono text-[0.92em] text-foreground">
        {token.slice(1, -1)}
      </code>
    )
  }
  if (token.startsWith('**') || token.startsWith('__')) {
    return <strong key={key}>{token.slice(2, -2)}</strong>
  }
  if (token.startsWith('*') || token.startsWith('_')) {
    return <em key={key}>{token.slice(1, -1)}</em>
  }

  const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
  if (link) {
    const href = safeHref(link[2].trim())
    return (
      <a key={key} href={href} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
        {link[1]}
      </a>
    )
  }

  return token
}

function safeHref(href: string) {
  if (/^(https?:|mailto:|\/|#)/.test(href)) return href
  return '#'
}

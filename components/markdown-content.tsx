import { Fragment, type ReactNode } from 'react'
import { MermaidDiagram } from '@/components/mermaid-diagram'

type MarkdownBlock =
  | { type: 'code'; language?: string; content: string }
  | { type: 'heading'; level: number; content: string }
  | { type: 'paragraph'; content: string }
  | { type: 'quote'; content: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | {
      type: 'table'
      headers: string[]
      alignments: Array<'left' | 'center' | 'right'>
      rows: string[][]
    }
  | { type: 'hr' }

const blockStartPattern = /^\s*(#{1,6}\s+|`{3,}|~{3,}|>\s?|[-*]\s+|\d+\.\s+|---+\s*$)/
const inlinePattern = /(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g

const headingClasses: Record<number, string> = {
  1: 'text-xl font-semibold leading-tight tracking-tight text-foreground',
  2: 'text-lg font-semibold leading-tight tracking-tight text-foreground',
  3: 'text-base font-semibold leading-snug text-foreground',
  4: 'text-sm font-semibold leading-snug text-foreground',
  5: 'text-[12px] font-semibold leading-snug uppercase tracking-wide text-foreground/85',
  6: 'text-[11px] font-medium leading-snug uppercase tracking-wider text-muted-foreground',
}

export function MarkdownContent({
  content,
  accentBorder = false,
}: {
  content: string
  accentBorder?: boolean
}) {
  const blocks = parseMarkdown(content)
  return (
    <div
      className={`max-w-full min-w-0 space-y-3 overflow-hidden text-sm leading-relaxed wrap-break-word text-foreground ${accentBorder ? 'border-l-2 border-accent/50 pl-3.5' : ''}`}
    >
      {blocks.map((block, index) => renderBlock(block, index))}
    </div>
  )
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

    const fence = line.match(/^\s*(`{3,}|~{3,})\s*([^\s`]*)?.*$/)
    if (fence) {
      const code: string[] = []
      const marker = fence[1]
      const closingFence = new RegExp(
        `^\\s*${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`,
      )
      index += 1
      while (index < lines.length && !closingFence.test(lines[index])) {
        code.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push({
        type: 'code',
        language: fence[2]?.trim(),
        content: code.join('\n'),
      })
      continue
    }

    if (/^---+\s*$/.test(line.trim())) {
      blocks.push({ type: 'hr' })
      index += 1
      continue
    }

    if (isTableStart(lines, index)) {
      const headers = splitTableRow(line)
      const alignments = parseTableAlignments(lines[index + 1], headers.length)
      const rows: string[][] = []
      index += 2

      while (
        index < lines.length &&
        lines[index].trim() &&
        hasTablePipes(lines[index]) &&
        !isTableDelimiter(lines[index])
      ) {
        rows.push(normalizeTableRow(splitTableRow(lines[index]), headers.length))
        index += 1
      }

      blocks.push({
        type: 'table',
        headers,
        alignments,
        rows,
      })
      continue
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, content: heading[2] })
      index += 1
      continue
    }

    if (/^\s{0,3}>\s?/.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^\s{0,3}>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s{0,3}>\s?/, ''))
        index += 1
      }
      blocks.push({ type: 'quote', content: quote.join('\n') })
      continue
    }

    if (/^\s{0,3}[-*]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s{0,3}[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s{0,3}[-*]\s+/, ''))
        index += 1
      }
      blocks.push({ type: 'list', ordered: false, items })
      continue
    }

    if (/^\s{0,3}\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s{0,3}\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s{0,3}\d+\.\s+/, ''))
        index += 1
      }
      blocks.push({ type: 'list', ordered: true, items })
      continue
    }

    const paragraph: string[] = []
    while (
      index < lines.length &&
      lines[index].trim() &&
      !blockStartPattern.test(lines[index]) &&
      !isTableStart(lines, index)
    ) {
      paragraph.push(lines[index])
      index += 1
    }
    if (paragraph.length === 0) {
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
        <div key={key} className="bg-code max-w-full overflow-hidden border border-border">
          {block.language && (
            <div className="border-b border-border px-3 py-1 font-mono text-[10px] text-muted-foreground uppercase">
              {block.language}
            </div>
          )}
          <pre className="max-w-full overflow-hidden p-3 font-mono text-[11px] leading-relaxed wrap-break-word whitespace-pre-wrap text-foreground/90">
            <code>{block.content}</code>
          </pre>
        </div>
      )
    case 'heading': {
      const level = Math.min(6, Math.max(1, block.level))
      return (
        <div
          key={key}
          role="heading"
          aria-level={level}
          className={`pt-1 font-mono first:pt-0 ${headingClasses[level]}`}
        >
          {renderInline(block.content)}
        </div>
      )
    }
    case 'quote':
      return (
        <blockquote
          key={key}
          className="border-l-2 border-border-strong pl-3 font-mono text-[12px] text-muted-foreground italic"
        >
          {renderInlineWithBreaks(block.content)}
        </blockquote>
      )
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag
          key={key}
          className={block.ordered ? 'list-decimal space-y-1 pl-5' : 'list-disc space-y-1 pl-5'}
        >
          {block.items.map((item, index) => (
            <li key={`${key}-${index}`}>{renderInline(item)}</li>
          ))}
        </Tag>
      )
    }
    case 'table':
      return (
        <div key={key} className="max-w-full overflow-x-auto border border-border bg-panel/40">
          <table className="min-w-full border-collapse text-left text-[12px] leading-relaxed">
            <thead className="bg-muted/60">
              <tr>
                {block.headers.map((header, index) => (
                  <th
                    key={`${key}-head-${index}`}
                    className="border-r border-b border-border px-3 py-2 font-mono text-[11px] font-semibold text-foreground last:border-r-0"
                    style={{ textAlign: block.alignments[index] }}
                  >
                    {renderInline(header)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr
                  key={`${key}-row-${rowIndex}`}
                  className="border-b border-border last:border-b-0"
                >
                  {block.headers.map((_, cellIndex) => (
                    <td
                      key={`${key}-cell-${rowIndex}-${cellIndex}`}
                      className="max-w-[18rem] border-r border-border px-3 py-2 align-top wrap-break-word text-muted-foreground last:border-r-0"
                      style={{ textAlign: block.alignments[cellIndex] }}
                    >
                      {renderInline(row[cellIndex] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'hr':
      return <div key={key} className="h-px bg-border" />
    case 'paragraph':
      return <p key={key}>{renderInlineWithBreaks(block.content)}</p>
  }
}

function isTableStart(lines: string[], index: number) {
  const line = lines[index]
  const delimiter = lines[index + 1]
  return Boolean(
    line &&
    delimiter &&
    hasTablePipes(line) &&
    isTableDelimiter(delimiter) &&
    splitTableRow(line).length >= 2,
  )
}

function hasTablePipes(line: string) {
  return line.includes('|')
}

function isTableDelimiter(line: string) {
  const cells = splitTableRow(line)
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function splitTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function parseTableAlignments(line: string, count: number) {
  const cells = normalizeTableRow(splitTableRow(line), count)
  return cells.map((cell) => {
    if (cell.startsWith(':') && cell.endsWith(':')) return 'center'
    if (cell.endsWith(':')) return 'right'
    return 'left'
  })
}

function normalizeTableRow(cells: string[], count: number) {
  return Array.from({ length: count }, (_, index) => cells[index] ?? '')
}

function renderInlineWithBreaks(content: string) {
  const nodes: ReactNode[] = []
  content.split('\n').forEach((line, lineIndex) => {
    if (lineIndex > 0) nodes.push(<br key={`br-${lineIndex}`} />)
    renderInline(line).forEach((node, nodeIndex) => {
      nodes.push(<Fragment key={`line-${lineIndex}-${nodeIndex}`}>{node}</Fragment>)
    })
  })
  return nodes
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
      <code
        key={key}
        className="border border-border bg-muted px-1 py-0.5 font-mono text-[0.92em] text-foreground"
      >
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
      <a
        key={key}
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-accent underline underline-offset-2"
      >
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

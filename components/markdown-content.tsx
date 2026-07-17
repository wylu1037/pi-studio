import { Fragment, memo, type ReactNode, useMemo } from 'react'
import { AudioLines } from 'lucide-react'
import { CodeBlock } from '@/components/code-block'
import { MermaidDiagram } from '@/components/mermaid-diagram'
import { MarkdownImage } from '@/components/markdown-image'
import { parseMarkdown, type MarkdownBlock } from '@/lib/markdown/streaming-markdown'
import { cn } from '@/lib/utils'

const inlinePattern = /(!?\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g
export const markdownContentClassName =
  'max-w-full min-w-0 space-y-3 overflow-hidden text-sm leading-relaxed wrap-break-word text-foreground'

const headingClasses: Record<number, string> = {
  1: 'text-xl font-semibold leading-tight tracking-tight text-foreground',
  2: 'text-lg font-semibold leading-tight tracking-tight text-foreground',
  3: 'text-base font-semibold leading-snug text-foreground',
  4: 'text-sm font-semibold leading-snug text-foreground',
  5: 'text-[12px] font-semibold leading-snug uppercase tracking-wide text-foreground/85',
  6: 'text-[11px] font-medium leading-snug uppercase tracking-wider text-muted-foreground',
}

type MarkdownContentProps = {
  content: string
  accentBorder?: boolean
  mediaSessionId?: string
}

export const MarkdownContent = memo(function MarkdownContent({
  content,
  accentBorder = false,
  mediaSessionId,
}: MarkdownContentProps) {
  const blocks = useMemo(() => parseMarkdown(content, { idPrefix: 'markdown' }), [content])
  return (
    <div
      className={cn(markdownContentClassName, accentBorder && 'border-l-2 border-accent/50 pl-3.5')}
    >
      <MarkdownBlocks blocks={blocks} mediaSessionId={mediaSessionId} />
    </div>
  )
})

export const MarkdownBlocks = memo(function MarkdownBlocks({
  blocks,
  mediaSessionId,
}: {
  blocks: readonly MarkdownBlock[]
  mediaSessionId?: string
}) {
  return blocks.map((block) => (
    <MarkdownBlockView key={block.id} block={block} mediaSessionId={mediaSessionId} />
  ))
})

const MarkdownBlockView = memo(function MarkdownBlockView({
  block,
  mediaSessionId,
}: {
  block: MarkdownBlock
  mediaSessionId?: string
}) {
  switch (block.type) {
    case 'code':
      if (block.language?.toLowerCase() === 'mermaid') {
        return <MermaidDiagram chart={block.content} />
      }
      return <CodeBlock code={block.content} language={block.language} />
    case 'heading': {
      const level = Math.min(6, Math.max(1, block.level))
      return (
        <div
          role="heading"
          aria-level={level}
          className={`pt-1 font-mono first:pt-0 ${headingClasses[level]}`}
        >
          {renderInline(block.content, mediaSessionId)}
        </div>
      )
    }
    case 'quote':
      return (
        <blockquote className="border-l-2 border-border-strong pl-3 font-mono text-[12px] text-muted-foreground italic">
          {renderInlineWithBreaks(block.content, mediaSessionId)}
        </blockquote>
      )
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag className={block.ordered ? 'list-decimal space-y-1 pl-5' : 'list-disc space-y-1 pl-5'}>
          {block.items.map((item, index) => (
            <li key={`${block.id}-${index}`}>{renderInline(item, mediaSessionId)}</li>
          ))}
        </Tag>
      )
    }
    case 'table':
      return (
        <div className="max-w-full overflow-x-auto border border-border bg-panel/40">
          <table className="min-w-full border-collapse text-left text-[12px] leading-relaxed">
            <thead className="bg-muted/60">
              <tr>
                {block.headers.map((header, index) => (
                  <th
                    key={`${block.id}-head-${index}`}
                    className="border-r border-b border-border px-3 py-2 font-mono text-[11px] font-semibold text-foreground last:border-r-0"
                    style={{ textAlign: block.alignments[index] }}
                  >
                    {renderInline(header, mediaSessionId)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr
                  key={`${block.id}-row-${rowIndex}`}
                  className="border-b border-border last:border-b-0"
                >
                  {block.headers.map((_, cellIndex) => (
                    <td
                      key={`${block.id}-cell-${rowIndex}-${cellIndex}`}
                      className="max-w-[18rem] border-r border-border px-3 py-2 align-top wrap-break-word text-muted-foreground last:border-r-0"
                      style={{ textAlign: block.alignments[cellIndex] }}
                    >
                      {renderInline(row[cellIndex] ?? '', mediaSessionId)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'hr':
      return <div className="h-px bg-border" />
    case 'paragraph':
      return <p>{renderInlineWithBreaks(block.content, mediaSessionId)}</p>
  }
})

function renderInlineWithBreaks(content: string, mediaSessionId?: string) {
  const nodes: ReactNode[] = []
  content.split('\n').forEach((line, lineIndex) => {
    if (lineIndex > 0) nodes.push(<br key={`br-${lineIndex}`} />)
    renderInline(line, mediaSessionId).forEach((node, nodeIndex) => {
      nodes.push(<Fragment key={`line-${lineIndex}-${nodeIndex}`}>{node}</Fragment>)
    })
  })
  return nodes
}

function renderInline(content: string, mediaSessionId?: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let cursor = 0

  for (const match of content.matchAll(inlinePattern)) {
    const [token] = match
    const index = match.index ?? 0
    if (index > cursor) nodes.push(content.slice(cursor, index))
    nodes.push(renderInlineToken(token, nodes.length, mediaSessionId))
    cursor = index + token.length
  }

  if (cursor < content.length) nodes.push(content.slice(cursor))
  return nodes
}

function renderInlineToken(token: string, key: number, mediaSessionId?: string) {
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

  const link = token.match(/^!?\[([^\]]+)\]\(([^)]+)\)$/)
  if (link) {
    const rawHref = link[2].trim()
    if (mediaSessionId && isImageHref(rawHref)) {
      return (
        <MarkdownImage
          key={key}
          src={mediaSrc(rawHref, mediaSessionId)}
          alt={link[1]}
          location={rawHref}
        />
      )
    }
    if (mediaSessionId && isMp3Href(rawHref)) {
      const src = mediaSrc(rawHref, mediaSessionId)
      return (
        <span
          key={key}
          className="my-2 flex w-full max-w-md items-center gap-3 border border-border-strong bg-card p-3"
        >
          <span className="flex size-8 shrink-0 items-center justify-center border border-border bg-muted text-accent">
            <AudioLines className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="mb-1.5 block truncate font-mono text-[11px] text-foreground">
              {link[1]}
            </span>
            <audio className="block h-8 w-full" controls preload="metadata" src={src}>
              <a href={src}>Play {link[1]}</a>
            </audio>
          </span>
        </span>
      )
    }

    const href = safeHref(rawHref)
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

function isMp3Href(href: string) {
  return href.split(/[?#]/, 1)[0].toLowerCase().endsWith('.mp3')
}

function isImageHref(href: string) {
  return /\.(?:avif|gif|jpe?g|png|webp)$/i.test(href.split(/[?#]/, 1)[0])
}

function mediaSrc(href: string, sessionId: string) {
  if (/^https?:\/\//i.test(href)) {
    try {
      const url = new URL(href)
      if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return href
    } catch {
      return '#'
    }
  }
  return `/api/media?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(href)}`
}

function safeHref(href: string) {
  if (/^(https?:|mailto:|\/|#)/.test(href)) return href
  return '#'
}

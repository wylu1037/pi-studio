import { Fragment, memo } from 'react'
import { CodeBlock } from '@/components/code-block'
import { MarkdownBlocks, markdownContentClassName } from '@/components/markdown-content'
import type {
  StreamingMarkdownLiveBlock,
  StreamingMarkdownSnapshot,
} from '@/lib/markdown/streaming-markdown'

type StreamingMarkdownContentProps = {
  snapshot: StreamingMarkdownSnapshot
  mediaSessionId?: string
}

export const StreamingMarkdownContent = memo(function StreamingMarkdownContent({
  snapshot,
  mediaSessionId,
}: StreamingMarkdownContentProps) {
  return (
    <div className={markdownContentClassName}>
      {snapshot.segments.map((segment) => (
        <Fragment key={segment.id}>
          <MarkdownBlocks blocks={segment.committedBlocks} mediaSessionId={mediaSessionId} />
          {segment.liveBlock && <StreamingMarkdownTail block={segment.liveBlock} />}
        </Fragment>
      ))}
    </div>
  )
})

const StreamingMarkdownTail = memo(function StreamingMarkdownTail({
  block,
}: {
  block: StreamingMarkdownLiveBlock
}) {
  const content = block.content.replace(/^(?:\r?\n)+/, '')
  if (!content) return null

  if (block.mode === 'fenced-code') {
    const { code, language } = parseLiveFence(content)
    return <CodeBlock code={code} language={language} highlight={false} />
  }

  return <p className="whitespace-pre-wrap">{content}</p>
})

function parseLiveFence(content: string) {
  const normalized = content.replace(/\r\n?/g, '\n')
  const [opener = '', ...lines] = normalized.split('\n')
  const fence = opener.match(/^\s*(`{3,}|~{3,})\s*([^\s`]*)?.*$/)
  return {
    language: fence?.[2]?.trim(),
    code: fence ? lines.join('\n') : normalized,
  }
}

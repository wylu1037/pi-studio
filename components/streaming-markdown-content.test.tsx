import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { StreamingMarkdownContent } from './streaming-markdown-content'
import { StreamingMarkdownAssembler } from '@/lib/markdown/streaming-markdown'

test('renders committed blocks while keeping the active paragraph as a lightweight tail', () => {
  const assembler = new StreamingMarkdownAssembler({ idPrefix: 'message-1' })
  assembler.append('# Result\n\nPartial **answer')

  const markup = renderToStaticMarkup(<StreamingMarkdownContent snapshot={assembler.snapshot} />)

  assert.match(markup, /role="heading"/)
  assert.match(markup, />Result</)
  assert.match(markup, /Partial \*\*answer/)
  assert.doesNotMatch(markup, /<strong>/)
})

test('renders an open code fence without starting syntax highlighting', () => {
  const assembler = new StreamingMarkdownAssembler({ idPrefix: 'message-1' })
  assembler.append('```ts\nconst answer = 42')

  const markup = renderToStaticMarkup(<StreamingMarkdownContent snapshot={assembler.snapshot} />)

  assert.match(markup, /aria-label="TypeScript code"/)
  assert.match(markup, /aria-busy="false"/)
  assert.match(markup, /const answer = 42/)
})

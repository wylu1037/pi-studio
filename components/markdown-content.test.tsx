import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownContent } from './markdown-content'

test('renders a local MP3 markdown link as a playable audio control', () => {
  const markup = renderToStaticMarkup(
    <MarkdownContent content="[answer.mp3](/workspace/answer.mp3)" mediaSessionId="session 1" />,
  )

  assert.match(markup, /<audio[^>]+controls=""/)
  assert.match(
    markup,
    /src="\/api\/media\?sessionId=session%201&amp;path=%2Fworkspace%2Fanswer.mp3"/,
  )
  assert.match(markup, />answer\.mp3</)
})

test('renders local PDF links as previewable document cards', () => {
  const markup = renderToStaticMarkup(
    <MarkdownContent content="[notes](/notes.pdf)" mediaSessionId="session-1" />,
  )

  assert.match(markup, /aria-label="Preview notes"/)
  assert.match(markup, /PDF DOCUMENT/)
  assert.match(markup, /aria-label="Download notes"/)
})

test('renders Word and Excel links with preview actions and download fallbacks', () => {
  const markup = renderToStaticMarkup(
    <MarkdownContent
      content={'[report.docx](/out/report.docx)\n\n[data.xlsx](/out/data.xlsx)'}
      mediaSessionId="session-1"
    />,
  )

  assert.match(markup, /WORD DOCUMENT/)
  assert.match(markup, /EXCEL DOCUMENT/)
  assert.match(markup, /aria-label="Download report.docx"/)
  assert.match(markup, /aria-label="Download data.xlsx"/)
})

test('plays remote MP3 links directly', () => {
  const markup = renderToStaticMarkup(
    <MarkdownContent
      content="[answer.mp3](https://cdn.example.com/answer.mp3)"
      mediaSessionId="session-1"
    />,
  )

  assert.match(markup, /<audio[^>]+src="https:\/\/cdn\.example\.com\/answer\.mp3"/)
})

test('renders linked image files as clickable previews', () => {
  const markup = renderToStaticMarkup(
    <MarkdownContent
      content="[weather.png](http://localhost:3000/workspace/out/weather.png)"
      mediaSessionId="session-1"
    />,
  )

  assert.match(markup, /<img[^>]+alt="weather\.png"/)
  assert.match(
    markup,
    /src="\/api\/media\?sessionId=session-1&amp;path=http%3A%2F%2Flocalhost%3A3000%2Fworkspace%2Fout%2Fweather.png"/,
  )
  assert.match(markup, /aria-label="Preview weather\.png"/)
  assert.match(markup, /aria-label="Open image preview"/)
  assert.match(markup, />http:\/\/localhost:3000\/workspace\/out\/weather\.png</)
  assert.match(markup, /aria-label="Zoom in image"/)
  assert.match(markup, /aria-label="Zoom out image"/)
  assert.match(markup, /download="weather\.png"/)
  assert.doesNotMatch(markup, /aspect-\[16\/10\]/)
  assert.match(markup, /class="[^"]*h-auto max-w-full[^"]*"/)
})

test('supports standard markdown image syntax and direct remote previews', () => {
  const markup = renderToStaticMarkup(
    <MarkdownContent
      content="![weather](https://cdn.example.com/weather.webp)"
      mediaSessionId="session-1"
    />,
  )

  assert.match(markup, /<img[^>]+src="https:\/\/cdn\.example\.com\/weather\.webp"/)
  assert.doesNotMatch(markup, />!</)
})

test('renders fenced code with its normalized language and a readable fallback', () => {
  const markup = renderToStaticMarkup(
    <MarkdownContent content={'```ts\nconst answer: number = 42\n```'} />,
  )

  assert.match(markup, />TypeScript</)
  assert.match(markup, /aria-label="TypeScript code"/)
  assert.match(markup, /const answer: number = 42/)
  assert.match(markup, /aria-busy="true"/)
})

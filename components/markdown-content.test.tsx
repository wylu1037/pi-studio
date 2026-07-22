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
  assert.match(markup, /PDF document/)
  assert.match(markup, /data-file-kind="pdf"/)
  assert.match(markup, /data-file-logo="pdf"/)
  assert.match(markup, /ring-0/)
  assert.match(markup, /class="!size-9" data-file-logo="pdf"/)
  assert.match(markup, /viewBox="4 1 32 38"/)
  assert.match(markup, /aria-label="Download notes"/)
})

test('renders angle-wrapped file links inside prose as preview cards', () => {
  const markup = renderToStaticMarkup(
    <MarkdownContent
      content={
        '文件：[Golang 后端开发一面题解手册.pdf](</output/golang-interview-kami/Golang 后端开发一面题解手册.pdf>)'
      }
      mediaSessionId="session-1"
    />,
  )

  assert.match(markup, /aria-label="Preview Golang 后端开发一面题解手册.pdf"/)
  assert.match(markup, /PDF document/)
  assert.match(
    markup,
    /path=%2Foutput%2Fgolang-interview-kami%2FGolang%20%E5%90%8E%E7%AB%AF%E5%BC%80%E5%8F%91%E4%B8%80%E9%9D%A2%E9%A2%98%E8%A7%A3%E6%89%8B%E5%86%8C.pdf/,
  )
  assert.doesNotMatch(markup, /path=%3C/)
})

test('uses a file-like link label when a download URL has no extension', () => {
  const markup = renderToStaticMarkup(
    <MarkdownContent
      content="[guide.pdf](https://files.example.com/download?id=guide)"
      mediaSessionId="session-1"
    />,
  )

  assert.match(markup, /aria-label="Preview guide.pdf"/)
  assert.match(markup, /PDF document/)
  assert.match(markup, /href="https:\/\/files.example.com\/download\?id=guide"/)
})

test('renders Word and Excel links with preview actions and download fallbacks', () => {
  const markup = renderToStaticMarkup(
    <MarkdownContent
      content={'[report.docx](/out/report.docx)\n\n[data.xlsx](/out/data.xlsx)'}
      mediaSessionId="session-1"
    />,
  )

  assert.match(markup, /Word document/)
  assert.match(markup, /Excel document/)
  assert.match(markup, /data-file-kind="word"/)
  assert.match(markup, /data-file-kind="excel"/)
  assert.match(markup, /data-file-logo="word"/)
  assert.match(markup, /data-file-logo="excel"/)
  assert.match(markup, /ring-0/)
  assert.match(markup, /aria-label="Download report.docx"/)
  assert.match(markup, /aria-label="Download data.xlsx"/)
})

test('renders standalone and code-wrapped document paths as previewable cards', () => {
  const markup = renderToStaticMarkup(
    <MarkdownContent
      content={
        '/Users/demo/output/guide.pdf\n\noutput/report.xlsx\n\nnotes.pdf\n\n`/Users/demo/output/interview questions.docx`'
      }
      mediaSessionId="session-1"
    />,
  )

  assert.match(markup, /aria-label="Preview guide.pdf"/)
  assert.match(markup, /aria-label="Preview report.xlsx"/)
  assert.match(markup, /aria-label="Preview notes.pdf"/)
  assert.match(markup, /aria-label="Preview interview questions.docx"/)
  assert.match(markup, /PDF document/)
  assert.match(markup, /Word document/)
})

test('renders script files as preview cards with language-specific file icons', () => {
  const markup = renderToStaticMarkup(
    <MarkdownContent
      content={
        '[app.js](/src/app.js)\n\n`/src/index.tsx`\n\n[tool.py](/scripts/tool.py)\n\n[query.sql](/db/query.sql)'
      }
      mediaSessionId="session-1"
    />,
  )

  assert.match(markup, /JavaScript source file/)
  assert.match(markup, /TSX source file/)
  assert.match(markup, /Python source file/)
  assert.match(markup, /SQL source file/)
  assert.match(markup, /data-file-kind="javascript"/)
  assert.match(markup, /data-file-kind="tsx"/)
  assert.match(markup, /data-file-kind="python"/)
  assert.match(markup, /data-file-kind="sql"/)
  assert.match(markup, /aria-label="Preview app.js"/)
  assert.match(markup, /aria-label="Preview index.tsx"/)
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

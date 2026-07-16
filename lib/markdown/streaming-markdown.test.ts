import assert from 'node:assert/strict'
import test from 'node:test'
import { parseMarkdown, StreamingMarkdownAssembler, type MarkdownBlock } from './streaming-markdown'

test('preserves the chat renderer block grammar and gives blocks stable source metadata', () => {
  const content = [
    '# Title',
    '',
    'A paragraph',
    'with two lines.',
    '',
    '> Quoted',
    '> text',
    '',
    '- one',
    '- two',
    '',
    '1. first',
    '2. second',
    '',
    '| Name | Value |',
    '| :--- | ---: |',
    '| A | 1 |',
    '',
    '---',
    '',
    '```ts',
    'const answer = 42',
    '```',
  ].join('\r\n')

  const blocks = parseMarkdown(content, { idPrefix: 'message-7' })
  assert.deepEqual(
    blocks.map((block) => block.type),
    ['heading', 'paragraph', 'quote', 'list', 'list', 'table', 'hr', 'code'],
  )
  assert.equal(blocks[0].id, 'message-7:heading:0')
  assert.equal(blocks[0].sourceStart, 0)
  assert.equal(blocks[0].sourceEnd, 7)
  assert.equal(blocks.at(-1)?.type, 'code')
  assert.equal((blocks.at(-1) as Extract<MarkdownBlock, { type: 'code' }>).closed, true)
  assert.ok(blocks.every((block) => block.sourceEnd >= block.sourceStart))
})

test('reaches the complete parse result for arbitrary stream chunk boundaries', () => {
  const content = [
    '# Result',
    '',
    'The **first** paragraph.',
    '',
    '```ts',
    'const total = 1 + 2',
    '```',
    '',
    '| Name | Value |',
    '| --- | :---: |',
    '| alpha | 3 |',
    '',
    '> Done.',
  ].join('\n')

  for (let width = 1; width <= 13; width += 1) {
    const assembler = new StreamingMarkdownAssembler({ idPrefix: 'stream' })
    for (let offset = 0; offset < content.length; offset += width) {
      assembler.append(content.slice(offset, offset + width))
    }
    const snapshot = assembler.finish()
    assert.deepEqual(
      snapshot.segments[0].committedBlocks,
      parseMarkdown(content, { idPrefix: 'stream:segment:0' }),
    )
    assert.equal(snapshot.segments[0].liveTail, '')
  }
})

test('defers a table until a completed blank line and keeps its stable ID after sealing', () => {
  const assembler = new StreamingMarkdownAssembler({ idPrefix: 'stream' })
  assembler.append('| Name | Value |\n| --- | --- |\n| one | 1 |')
  assert.equal(assembler.committedBlocks.length, 0)
  assert.equal(assembler.liveBlock?.mode, 'table')

  assembler.append('\n\nnext')
  const table = assembler.committedBlocks[0]
  assert.equal(table?.type, 'table')
  assert.equal(table?.id, 'stream:segment:0:table:0')
  assert.equal(assembler.liveTail, '\n\nnext')
})

test('keeps an unclosed fenced block live and finalizes it with complete-parser semantics', () => {
  const content = 'before\n\n```bash\necho partial\n\n'
  const assembler = new StreamingMarkdownAssembler({ idPrefix: 'stream' })
  for (const chunk of ['before\n', '\n```bash\n', 'echo partial\n', '\n']) {
    assembler.append(chunk)
  }

  assert.equal(assembler.committedBlocks[0]?.type, 'paragraph')
  assert.equal(assembler.liveBlock?.mode, 'fenced-code')
  const snapshot = assembler.finish()
  const blocks = snapshot.segments[0].committedBlocks
  assert.deepEqual(blocks, parseMarkdown(content, { idPrefix: 'stream:segment:0' }))
  const code = blocks.at(-1) as Extract<MarkdownBlock, { type: 'code' }>
  assert.equal(code.closed, false)
  assert.equal(code.content, 'echo partial\n\n')
})

test('commits a closed fenced block as soon as its closing line is complete', () => {
  const assembler = new StreamingMarkdownAssembler({ idPrefix: 'stream' })
  assembler.append('```ts\nconst answer = 42\n```\n')

  const code = assembler.committedBlocks[0] as Extract<MarkdownBlock, { type: 'code' }>
  assert.equal(code.type, 'code')
  assert.equal(code.closed, true)
  assert.equal(code.content, 'const answer = 42')
  assert.equal(assembler.liveTail, '\n')
})

test('handles CRLF split across arbitrary delta boundaries', () => {
  const content = 'first\r\n\r\n```txt\r\nsecond\r\n```\r\n'
  const assembler = new StreamingMarkdownAssembler({ idPrefix: 'stream' })
  for (const character of content) assembler.append(character)

  const snapshot = assembler.finish()
  assert.deepEqual(
    snapshot.segments[0].committedBlocks,
    parseMarkdown(content, { idPrefix: 'stream:segment:0' }),
  )
})

test('text segment sealing creates an independent parser boundary without injecting text', () => {
  const assembler = new StreamingMarkdownAssembler({ idPrefix: 'message' })
  assembler.append('first part')
  assembler.sealTextSegment()
  assembler.beginTextSegment(1)
  assembler.append('```ts\nconst x = 1')
  const snapshot = assembler.finish()

  assert.equal(snapshot.segments.length, 2)
  assert.equal(snapshot.segments[0].content, 'first part')
  assert.equal(snapshot.segments[1].content, '```ts\nconst x = 1')
  assert.deepEqual(
    snapshot.segments[0].committedBlocks,
    parseMarkdown('first part', { idPrefix: 'message:segment:0' }),
  )
  assert.deepEqual(
    snapshot.segments[1].committedBlocks,
    parseMarkdown('```ts\nconst x = 1', { idPrefix: 'message:segment:1' }),
  )
})

test('commits safe single-line blocks and preserves committed references on segment seal', () => {
  const assembler = new StreamingMarkdownAssembler({ idPrefix: 'message' })
  assembler.append('# Streaming heading\n')
  const heading = assembler.committedBlocks[0]

  assert.equal(heading?.type, 'heading')
  assembler.append('\nbody')
  assembler.sealTextSegment()

  assert.equal(assembler.committedBlocks[0], heading)
})

test('uses segment identity in block IDs to avoid collisions between content parts', () => {
  const assembler = new StreamingMarkdownAssembler({ idPrefix: 'message' })
  assembler.append('first', 2)
  assembler.sealTextSegment()
  assembler.append('second', 4)
  const snapshot = assembler.finish()

  assert.equal(snapshot.segments[0].committedBlocks[0]?.id, 'message:segment:2:paragraph:0')
  assert.equal(snapshot.segments[1].committedBlocks[0]?.id, 'message:segment:4:paragraph:0')
})

test('uses text-end content as the authoritative segment value', () => {
  const assembler = new StreamingMarkdownAssembler({ idPrefix: 'message' })
  assembler.append('partial')
  assembler.sealTextSegment('complete **answer**')

  assert.equal(assembler.segments[0].content, 'complete **answer**')
  assert.equal(assembler.committedBlocks[0]?.type, 'paragraph')
  assert.equal(
    (assembler.committedBlocks[0] as Extract<MarkdownBlock, { type: 'paragraph' }>).content,
    'complete **answer**',
  )
})

/**
 * The block model intentionally stops before inline Markdown. Inline rendering has
 * media/session concerns, while this module only owns stable structural boundaries.
 */
export type MarkdownAlignment = 'left' | 'center' | 'right'

interface MarkdownBlockBase {
  /** Stable within a source document and parse-id prefix. */
  readonly id: string
  /** UTF-16 offset in the source, inclusive. */
  readonly sourceStart: number
  /** UTF-16 offset in the source, exclusive. Line endings after a block are excluded. */
  readonly sourceEnd: number
}

export type MarkdownBlock =
  | (MarkdownBlockBase & {
      readonly type: 'code'
      readonly language?: string
      readonly content: string
      /** Whether this block has an explicit matching closing fence. */
      readonly closed: boolean
    })
  | (MarkdownBlockBase & {
      readonly type: 'heading'
      readonly level: number
      readonly content: string
    })
  | (MarkdownBlockBase & { readonly type: 'paragraph'; readonly content: string })
  | (MarkdownBlockBase & { readonly type: 'quote'; readonly content: string })
  | (MarkdownBlockBase & {
      readonly type: 'list'
      readonly ordered: boolean
      readonly items: readonly string[]
    })
  | (MarkdownBlockBase & {
      readonly type: 'table'
      readonly headers: readonly string[]
      readonly alignments: readonly MarkdownAlignment[]
      readonly rows: readonly (readonly string[])[]
    })
  | (MarkdownBlockBase & { readonly type: 'hr' })

export interface MarkdownParseOptions {
  /**
   * Prefixes the position-derived IDs. Pass a message ID when blocks from multiple
   * messages will share a React list.
   */
  readonly idPrefix?: string
  /**
   * Adds this amount to every source offset. It is useful when parsing an
   * uncommitted suffix of a streaming text segment.
   */
  readonly sourceOffset?: number
}

interface SourceLine {
  readonly content: string
  readonly start: number
  readonly end: number
  readonly endWithBreak: number
}

const blockStartPattern = /^\s*(#{1,6}\s+|`{3,}|~{3,}|>\s?|[-*]\s+|\d+\.\s+|---+\s*$)/
const fencePattern = /^\s*(`{3,}|~{3,})\s*([^\s`]*)?.*$/
const headingPattern = /^\s{0,3}(#{1,6})\s+(.+)$/
const quotePattern = /^\s{0,3}>\s?/
const unorderedListPattern = /^\s{0,3}[-*]\s+/
const orderedListPattern = /^\s{0,3}\d+\.\s+/

/**
 * Parses the same block grammar used by the chat renderer. It deliberately keeps
 * inline Markdown untouched so media links and rich inline content remain a
 * renderer concern.
 */
export function parseMarkdown(
  content: string,
  options: MarkdownParseOptions = {},
): MarkdownBlock[] {
  const lines = splitSourceLines(content, options.sourceOffset ?? 0)
  const blocks: MarkdownBlock[] = []
  const idPrefix = options.idPrefix ?? 'markdown'
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.content.trim()) {
      index += 1
      continue
    }

    const fence = line.content.match(fencePattern)
    if (fence) {
      const code: string[] = []
      const marker = fence[1]
      const closingFence = new RegExp(
        `^\\s*${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`,
      )
      const startIndex = index
      index += 1
      while (index < lines.length && !closingFence.test(lines[index].content)) {
        code.push(lines[index].content)
        index += 1
      }

      const closed = index < lines.length
      const endIndex = closed ? index : Math.max(startIndex, index - 1)
      if (closed) index += 1
      blocks.push(
        freezeBlock({
          ...createBlockBase('code', lines[startIndex], lines[endIndex], idPrefix),
          type: 'code',
          language: fence[2]?.trim(),
          content: code.join('\n'),
          closed,
        }),
      )
      continue
    }

    if (/^---+\s*$/.test(line.content.trim())) {
      blocks.push(
        freezeBlock({
          ...createBlockBase('hr', line, line, idPrefix),
          type: 'hr',
        }),
      )
      index += 1
      continue
    }

    if (isTableStart(lines, index)) {
      const startIndex = index
      const headers = splitTableRow(line.content)
      const alignments = parseTableAlignments(lines[index + 1].content, headers.length)
      const rows: string[][] = []
      index += 2

      while (
        index < lines.length &&
        lines[index].content.trim() &&
        hasTablePipes(lines[index].content) &&
        !isTableDelimiter(lines[index].content)
      ) {
        rows.push(normalizeTableRow(splitTableRow(lines[index].content), headers.length))
        index += 1
      }

      blocks.push(
        freezeBlock({
          ...createBlockBase('table', lines[startIndex], lines[index - 1], idPrefix),
          type: 'table',
          headers,
          alignments,
          rows,
        }),
      )
      continue
    }

    const heading = line.content.match(headingPattern)
    if (heading) {
      blocks.push(
        freezeBlock({
          ...createBlockBase('heading', line, line, idPrefix),
          type: 'heading',
          level: heading[1].length,
          content: heading[2],
        }),
      )
      index += 1
      continue
    }

    if (quotePattern.test(line.content)) {
      const startIndex = index
      const quote: string[] = []
      while (index < lines.length && quotePattern.test(lines[index].content)) {
        quote.push(lines[index].content.replace(quotePattern, ''))
        index += 1
      }
      blocks.push(
        freezeBlock({
          ...createBlockBase('quote', lines[startIndex], lines[index - 1], idPrefix),
          type: 'quote',
          content: quote.join('\n'),
        }),
      )
      continue
    }

    if (unorderedListPattern.test(line.content)) {
      const startIndex = index
      const items: string[] = []
      while (index < lines.length && unorderedListPattern.test(lines[index].content)) {
        items.push(lines[index].content.replace(unorderedListPattern, ''))
        index += 1
      }
      blocks.push(
        freezeBlock({
          ...createBlockBase('list', lines[startIndex], lines[index - 1], idPrefix),
          type: 'list',
          ordered: false,
          items,
        }),
      )
      continue
    }

    if (orderedListPattern.test(line.content)) {
      const startIndex = index
      const items: string[] = []
      while (index < lines.length && orderedListPattern.test(lines[index].content)) {
        items.push(lines[index].content.replace(orderedListPattern, ''))
        index += 1
      }
      blocks.push(
        freezeBlock({
          ...createBlockBase('list', lines[startIndex], lines[index - 1], idPrefix),
          type: 'list',
          ordered: true,
          items,
        }),
      )
      continue
    }

    const startIndex = index
    const paragraph: string[] = []
    while (
      index < lines.length &&
      lines[index].content.trim() &&
      !blockStartPattern.test(lines[index].content) &&
      !isTableStart(lines, index)
    ) {
      paragraph.push(lines[index].content)
      index += 1
    }
    if (paragraph.length === 0) {
      paragraph.push(lines[index].content)
      index += 1
    }
    blocks.push(
      freezeBlock({
        ...createBlockBase('paragraph', lines[startIndex], lines[index - 1], idPrefix),
        type: 'paragraph',
        content: paragraph.join('\n'),
      }),
    )
  }

  return blocks
}

function createBlockBase(
  type: MarkdownBlock['type'],
  startLine: SourceLine,
  endLine: SourceLine,
  idPrefix: string,
): MarkdownBlockBase {
  return {
    id: `${idPrefix}:${type}:${startLine.start}`,
    sourceStart: startLine.start,
    sourceEnd: endLine.end,
  }
}

function freezeBlock(block: MarkdownBlock): MarkdownBlock {
  switch (block.type) {
    case 'list':
      return Object.freeze({ ...block, items: Object.freeze([...block.items]) })
    case 'table':
      return Object.freeze({
        ...block,
        headers: Object.freeze([...block.headers]),
        alignments: Object.freeze([...block.alignments]),
        rows: Object.freeze(block.rows.map((row) => Object.freeze([...row]))),
      })
    default:
      return Object.freeze({ ...block })
  }
}

function splitSourceLines(content: string, sourceOffset: number): SourceLine[] {
  const lines: SourceLine[] = []
  let start = 0
  let index = 0

  while (index < content.length) {
    const character = content[index]
    if (character !== '\n' && character !== '\r') {
      index += 1
      continue
    }

    const end = index
    if (character === '\r' && content[index + 1] === '\n') index += 1
    index += 1
    lines.push({
      content: content.slice(start, end),
      start: sourceOffset + start,
      end: sourceOffset + end,
      endWithBreak: sourceOffset + index,
    })
    start = index
  }

  lines.push({
    content: content.slice(start),
    start: sourceOffset + start,
    end: sourceOffset + content.length,
    endWithBreak: sourceOffset + content.length,
  })
  return lines
}

function isTableStart(lines: readonly SourceLine[], index: number) {
  const line = lines[index]?.content
  const delimiter = lines[index + 1]?.content
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

function parseTableAlignments(line: string, count: number): MarkdownAlignment[] {
  const cells = normalizeTableRow(splitTableRow(line), count)
  return cells.map((cell) => {
    if (cell.startsWith(':') && cell.endsWith(':')) return 'center'
    if (cell.endsWith(':')) return 'right'
    return 'left'
  })
}

function normalizeTableRow(cells: readonly string[], count: number) {
  return Array.from({ length: count }, (_, index) => cells[index] ?? '')
}

export type StreamingMarkdownLiveMode = 'text' | 'fenced-code' | 'table' | 'list' | 'quote'

/** A deliberately cheap representation for the currently mutable stream suffix. */
export interface StreamingMarkdownLiveBlock {
  readonly type: 'live'
  readonly id: string
  readonly sourceStart: number
  readonly sourceEnd: number
  readonly content: string
  readonly mode: StreamingMarkdownLiveMode
}

export interface StreamingMarkdownSegment {
  /** Content-part identity, normally the Pi SDK contentIndex. */
  readonly id: string
  /** Arrival order, retained in case an upstream identity is reused accidentally. */
  readonly index: number
  /** Raw text for this content part only. No separator is injected between segments. */
  readonly content: string
  readonly committedBlocks: readonly MarkdownBlock[]
  readonly liveTail: string
  readonly liveBlock?: StreamingMarkdownLiveBlock
  readonly sealed: boolean
}

export interface StreamingMarkdownSnapshot {
  readonly segments: readonly StreamingMarkdownSegment[]
  readonly activeSegmentId?: string
  readonly finished: boolean
}

export interface StreamingMarkdownAssemblerOptions extends MarkdownParseOptions {
  /** Starts a segment immediately. Omit it to start lazily from the first delta. */
  readonly initialSegmentId?: string | number
}

interface MutableSegment {
  id: string
  index: number
  content: string
  committedBlocks: MarkdownBlock[]
  /** Raw source offset after the last committed block. */
  cursor: number
  sealed: boolean
  snapshot: StreamingMarkdownSegment
}

/**
 * Incrementally assembles independent assistant text content parts. The mutable
 * suffix is never mounted as expensive UI blocks. Structurally closed blocks are
 * committed during streaming, while `sealTextSegment()` remains the authoritative
 * content-part boundary from a structured agent event.
 */
export class StreamingMarkdownAssembler {
  private readonly parseOptions: MarkdownParseOptions
  private readonly segmentsById = new Map<string, MutableSegment>()
  private segmentsInternal: MutableSegment[] = []
  private segmentsSnapshot: readonly StreamingMarkdownSegment[] = Object.freeze([])
  private committedBlocksSnapshot: readonly MarkdownBlock[] = Object.freeze([])
  private active: MutableSegment | undefined
  private isFinished = false

  constructor(options: StreamingMarkdownAssemblerOptions = {}) {
    const { initialSegmentId, ...parseOptions } = options
    this.parseOptions = parseOptions
    if (initialSegmentId !== undefined) this.beginTextSegment(initialSegmentId)
  }

  get snapshot(): StreamingMarkdownSnapshot {
    return Object.freeze({
      segments: this.segmentsSnapshot,
      activeSegmentId: this.active?.id,
      finished: this.isFinished,
    })
  }

  get segments(): readonly StreamingMarkdownSegment[] {
    return this.segmentsSnapshot
  }

  get activeSegment(): StreamingMarkdownSegment | undefined {
    return this.active?.snapshot
  }

  /** Flattens committed blocks for consumers that do not need content-part grouping. */
  get committedBlocks(): readonly MarkdownBlock[] {
    return this.committedBlocksSnapshot
  }

  get liveTail(): string {
    return this.active?.snapshot.liveTail ?? ''
  }

  get liveBlock(): StreamingMarkdownLiveBlock | undefined {
    return this.active?.snapshot.liveBlock
  }

  /**
   * Starts an independent structured text content part. Starting a new part seals
   * the preceding one, but does not alter either part's raw source text.
   */
  beginTextSegment(segmentId: string | number): StreamingMarkdownSnapshot {
    this.assertNotFinished()
    const id = String(segmentId)
    if (this.active?.id === id) return this.snapshot
    if (this.active && !this.active.sealed) this.sealTextSegment()
    if (this.segmentsById.has(id)) {
      throw new Error(`Markdown text segment "${id}" has already been started.`)
    }

    const segment: MutableSegment = {
      id,
      index: this.segmentsInternal.length,
      content: '',
      committedBlocks: [],
      cursor: 0,
      sealed: false,
      snapshot: undefined as unknown as StreamingMarkdownSegment,
    }
    segment.snapshot = createSegmentSnapshot(segment)
    this.segmentsById.set(id, segment)
    this.segmentsInternal = [...this.segmentsInternal, segment]
    this.active = segment
    this.refreshSegmentsSnapshot()
    return this.snapshot
  }

  /**
   * Appends a text delta. Passing a content-part ID is a convenient shorthand for
   * selecting or starting that structured text segment.
   */
  append(delta: string, segmentId?: string | number): StreamingMarkdownSnapshot {
    this.assertNotFinished()
    if (!delta) return this.snapshot
    if (segmentId !== undefined && this.active?.id !== String(segmentId)) {
      this.beginTextSegment(segmentId)
    }
    if (!this.active) this.beginTextSegment('0')
    const segment = this.active
    if (!segment) throw new Error('A Markdown text segment must be started before appending.')
    if (segment.sealed) {
      throw new Error(`Markdown text segment "${segment.id}" has already been sealed.`)
    }

    segment.content += delta
    this.commitThroughCompletedLineBoundary(segment, hasStableLineBreak(delta, segment.content))
    this.refreshSegmentSnapshot(segment)
    this.refreshSegmentsSnapshot()
    return this.snapshot
  }

  /**
   * Flushes the active Pi text content part. This is a hard UI boundary, not a
   * synthetic newline: a later segment is parsed from its own raw source.
   */
  sealTextSegment(finalContent?: string): StreamingMarkdownSnapshot {
    this.assertNotFinished()
    const segment = this.active
    if (!segment || segment.sealed) return this.snapshot

    const previousContent = segment.content
    if (finalContent !== undefined) segment.content = finalContent
    const parsed = this.parseSegment(segment, segment.content, 0)
    const committedById = new Map(
      segment.content.startsWith(previousContent)
        ? segment.committedBlocks.map((block) => [block.id, block] as const)
        : [],
    )
    segment.committedBlocks = parsed.map((block) => committedById.get(block.id) ?? block)
    segment.cursor = segment.content.length
    segment.sealed = true
    this.refreshSegmentSnapshot(segment)
    this.refreshSegmentsSnapshot()
    return this.snapshot
  }

  /** Seals the final active content part and prevents further changes. */
  finish(): StreamingMarkdownSnapshot {
    if (this.isFinished) return this.snapshot
    if (this.active && !this.active.sealed) this.sealTextSegment()
    this.isFinished = true
    return this.snapshot
  }

  private commitThroughCompletedLineBoundary(
    segment: MutableSegment,
    hasNewStableLineBreak: boolean,
  ) {
    if (!hasNewStableLineBreak) return
    const suffix = segment.content.slice(segment.cursor)
    const parsed = this.parseSegment(segment, suffix, segment.cursor)
    const sourceOffset = this.parseOptions.sourceOffset ?? 0
    const boundary = findStreamingCommitBoundary(
      parsed,
      segment.content,
      sourceOffset,
      segment.cursor,
    )
    if (boundary < 0) return

    const newlyCommitted: MarkdownBlock[] = []
    for (const block of parsed) {
      if (block.sourceEnd > boundary) break
      if (block.type === 'code' && !block.closed) break
      newlyCommitted.push(block)
    }

    if (newlyCommitted.length === 0) return
    segment.committedBlocks = [...segment.committedBlocks, ...newlyCommitted]
    segment.cursor =
      (newlyCommitted.at(-1)?.sourceEnd ?? sourceOffset + segment.cursor) - sourceOffset
  }

  private parseSegment(segment: MutableSegment, content: string, localOffset: number) {
    const idPrefix = this.parseOptions.idPrefix ?? 'markdown'
    return parseMarkdown(content, {
      ...this.parseOptions,
      idPrefix: `${idPrefix}:segment:${segment.id}`,
      sourceOffset: (this.parseOptions.sourceOffset ?? 0) + localOffset,
    })
  }

  private refreshSegmentSnapshot(segment: MutableSegment) {
    segment.snapshot = createSegmentSnapshot(segment)
  }

  private refreshSegmentsSnapshot() {
    this.segmentsSnapshot = Object.freeze(this.segmentsInternal.map((segment) => segment.snapshot))
    this.committedBlocksSnapshot = Object.freeze(
      this.segmentsInternal.flatMap((segment) => segment.committedBlocks),
    )
  }

  private assertNotFinished() {
    if (this.isFinished) throw new Error('This Markdown stream has already finished.')
  }
}

function createSegmentSnapshot(segment: MutableSegment): StreamingMarkdownSegment {
  const liveTail = segment.sealed ? '' : segment.content.slice(segment.cursor)
  const liveBlock = createLiveBlock(segment, liveTail)
  return Object.freeze({
    id: segment.id,
    index: segment.index,
    content: segment.content,
    committedBlocks: Object.freeze([...segment.committedBlocks]),
    liveTail,
    ...(liveBlock ? { liveBlock } : {}),
    sealed: segment.sealed,
  })
}

function createLiveBlock(
  segment: Pick<MutableSegment, 'id' | 'cursor' | 'content' | 'sealed'>,
  liveTail: string,
): StreamingMarkdownLiveBlock | undefined {
  if (segment.sealed || !liveTail.trim()) return undefined
  return Object.freeze({
    type: 'live',
    id: `live:${segment.id}:${segment.cursor}`,
    sourceStart: segment.cursor,
    sourceEnd: segment.content.length,
    content: liveTail,
    mode: classifyLiveMode(liveTail),
  })
}

function classifyLiveMode(content: string): StreamingMarkdownLiveMode {
  const lines = splitSourceLines(content, 0)
  const firstIndex = lines.findIndex((line) => Boolean(line.content.trim()))
  if (firstIndex < 0) return 'text'
  const first = lines[firstIndex].content
  const fence = first.match(fencePattern)
  if (fence) {
    const marker = fence[1]
    const closingFence = new RegExp(`^\\s*${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`)
    if (!lines.slice(firstIndex + 1).some((line) => closingFence.test(line.content))) {
      return 'fenced-code'
    }
  }
  if (isTableStart(lines, firstIndex)) return 'table'
  if (quotePattern.test(first)) return 'quote'
  if (unorderedListPattern.test(first) || orderedListPattern.test(first)) return 'list'
  return 'text'
}

function findLastCompletedBlankLineBoundary(
  content: string,
  fromOffset: number,
): number | undefined {
  let boundary: number | undefined
  for (const line of splitSourceLines(content.slice(fromOffset), fromOffset)) {
    if (line.content.trim() || line.endWithBreak === line.end) continue
    boundary = line.endWithBreak
  }
  return boundary
}

function findStreamingCommitBoundary(
  blocks: readonly MarkdownBlock[],
  source: string,
  sourceOffset: number,
  fromOffset: number,
) {
  const blankBoundary = findLastCompletedBlankLineBoundary(source, fromOffset)
  let boundary = blankBoundary === undefined ? -1 : sourceOffset + blankBoundary

  if (blocks.length > 1) {
    boundary = Math.max(boundary, blocks.at(-2)?.sourceEnd ?? -1)
  }

  const last = blocks.at(-1)
  if (!last) return boundary
  const localEnd = last.sourceEnd - sourceOffset
  const hasCompletedLine = lineBreakLengthAt(source, localEnd) > 0
  if (
    hasCompletedLine &&
    (last.type === 'heading' || last.type === 'hr' || (last.type === 'code' && last.closed))
  ) {
    boundary = Math.max(boundary, last.sourceEnd)
  }

  return boundary
}

function lineBreakLengthAt(content: string, offset: number) {
  if (content[offset] === '\r' && content[offset + 1] === '\n') return 2
  if (content[offset] === '\r' || content[offset] === '\n') return 1
  return 0
}

function hasStableLineBreak(delta: string, content: string) {
  return /[\r\n]/.test(delta) && !content.endsWith('\r')
}

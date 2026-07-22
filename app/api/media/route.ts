import { createReadStream, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { Readable } from 'node:stream'
import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/db/repository'
import { parseMediaRange, resolveSessionMediaPath } from '@/lib/chat/media-files'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const contentTypes: Record<string, string> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.webp': 'image/webp',
}

export function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId')
  const href = request.nextUrl.searchParams.get('path')
  if (!sessionId || !href) return new Response('Missing media file parameters', { status: 400 })

  const session = getSession(sessionId)
  if (!session) return new Response('Session not found', { status: 404 })

  const path = resolveSessionMediaPath(session.cwd, href)
  if (!path) return new Response('Media file not found', { status: 404 })

  const { size } = statSync(path)
  const requestedRange = request.headers.get('range')
  const range = requestedRange ? parseMediaRange(requestedRange, size) : null
  if (requestedRange && !range) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}` },
    })
  }

  const start = range?.start ?? 0
  const end = range?.end ?? size - 1
  const stream = createReadStream(path, { start, end })
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-cache',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(basename(path))}`,
    'Content-Length': String(end - start + 1),
    'Content-Type': contentTypes[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  })
  if (range) headers.set('Content-Range', `bytes ${start}-${end}/${size}`)

  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: range ? 206 : 200,
    headers,
  })
}

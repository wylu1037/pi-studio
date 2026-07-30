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
  '.bash': 'text/plain; charset=utf-8',
  '.c': 'text/plain; charset=utf-8',
  '.cc': 'text/plain; charset=utf-8',
  '.cjs': 'text/plain; charset=utf-8',
  '.cpp': 'text/plain; charset=utf-8',
  '.cs': 'text/plain; charset=utf-8',
  '.css': 'text/plain; charset=utf-8',
  '.cxx': 'text/plain; charset=utf-8',
  '.fish': 'text/plain; charset=utf-8',
  '.go': 'text/plain; charset=utf-8',
  '.groovy': 'text/plain; charset=utf-8',
  '.h': 'text/plain; charset=utf-8',
  '.hpp': 'text/plain; charset=utf-8',
  '.htm': 'text/plain; charset=utf-8',
  '.html': 'text/plain; charset=utf-8',
  '.hxx': 'text/plain; charset=utf-8',
  '.java': 'text/plain; charset=utf-8',
  '.js': 'text/plain; charset=utf-8',
  '.jsx': 'text/plain; charset=utf-8',
  '.kt': 'text/plain; charset=utf-8',
  '.kts': 'text/plain; charset=utf-8',
  '.less': 'text/plain; charset=utf-8',
  '.lua': 'text/plain; charset=utf-8',
  '.mjs': 'text/plain; charset=utf-8',
  '.php': 'text/plain; charset=utf-8',
  '.pl': 'text/plain; charset=utf-8',
  '.pm': 'text/plain; charset=utf-8',
  '.ps1': 'text/plain; charset=utf-8',
  '.py': 'text/plain; charset=utf-8',
  '.r': 'text/plain; charset=utf-8',
  '.rb': 'text/plain; charset=utf-8',
  '.rs': 'text/plain; charset=utf-8',
  '.sass': 'text/plain; charset=utf-8',
  '.scala': 'text/plain; charset=utf-8',
  '.scss': 'text/plain; charset=utf-8',
  '.sh': 'text/plain; charset=utf-8',
  '.sql': 'text/plain; charset=utf-8',
  '.swift': 'text/plain; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.tsx': 'text/plain; charset=utf-8',
  '.vue': 'text/plain; charset=utf-8',
  '.zsh': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
}
const supportedExtensions = Object.keys(contentTypes)

export function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId')
  const href = request.nextUrl.searchParams.get('path')
  if (!sessionId || !href) return new Response('Missing media file parameters', { status: 400 })

  const session = getSession(sessionId)
  if (!session) return new Response('Session not found', { status: 404 })

  const path = resolveSessionMediaPath(session.cwd, href, supportedExtensions)
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

  // HTML is served as text/plain by default so this same-origin endpoint can
  // never be turned into an XSS vector. Only when a preview explicitly asks to
  // render it (`render=html`) do we return text/html — and even then we pin the
  // document into an opaque-origin sandbox via CSP, so its scripts cannot reach
  // this app's cookies/storage/DOM even if the URL is opened directly.
  const ext = extname(path).toLowerCase()
  const renderHtml =
    request.nextUrl.searchParams.get('render') === 'html' && (ext === '.html' || ext === '.htm')

  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-cache',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(basename(path))}`,
    'Content-Length': String(end - start + 1),
    'Content-Type': renderHtml
      ? 'text/html; charset=utf-8'
      : (contentTypes[ext] ?? 'application/octet-stream'),
    'X-Content-Type-Options': 'nosniff',
  })
  if (renderHtml) headers.set('Content-Security-Policy', 'sandbox allow-scripts;')
  if (range) headers.set('Content-Range', `bytes ${start}-${end}/${size}`)

  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: range ? 206 : 200,
    headers,
  })
}

import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/db/repository'
import { listWorkspaceDirectory, WorkspaceFilesError } from '@/lib/chat/workspace-files'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId')
  const path = request.nextUrl.searchParams.get('path') ?? ''

  if (!sessionId) {
    return Response.json({ error: 'A session is required.' }, { status: 400 })
  }

  const session = getSession(sessionId)
  if (!session) {
    return Response.json({ error: 'Session not found.' }, { status: 404 })
  }

  try {
    return Response.json(await listWorkspaceDirectory(session.cwd, path))
  } catch (error) {
    if (error instanceof WorkspaceFilesError) {
      return Response.json({ error: error.message }, { status: error.status })
    }
    return Response.json({ error: 'Unable to read the agent workspace.' }, { status: 500 })
  }
}

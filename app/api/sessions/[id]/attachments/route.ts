import type { NextRequest } from 'next/server'
import {
  AttachmentFilesError,
  saveSessionAttachments,
  type AttachmentFile,
} from '@/lib/chat/attachment-files'
import { getSession } from '@/lib/db/repository'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  context: RouteContext<'/api/sessions/[id]/attachments'>,
) {
  const { id } = await context.params
  const session = getSession(id)
  if (!session) {
    return Response.json({ error: 'Session not found.' }, { status: 404 })
  }

  try {
    const formData = await request.formData()
    const files = formData
      .getAll('files')
      .filter((value): value is File => value instanceof File) as AttachmentFile[]
    const attachments = await saveSessionAttachments(session.cwd, files)
    return Response.json({ attachments })
  } catch (error) {
    if (error instanceof AttachmentFilesError) {
      return Response.json({ error: error.message }, { status: error.status })
    }
    return Response.json({ error: 'Unable to upload the selected files.' }, { status: 400 })
  }
}

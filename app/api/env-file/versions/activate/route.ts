import type { NextRequest } from 'next/server'
import { EnvFileError } from '@/lib/env-files'
import { activateEnvVersion } from '@/lib/env-versions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { path?: unknown; versionId?: unknown }
    if (typeof body.path !== 'string' || typeof body.versionId !== 'string') {
      return Response.json({ error: 'Path and version are required.' }, { status: 400 })
    }
    return Response.json(activateEnvVersion(body.path, body.versionId))
  } catch (error) {
    if (error instanceof EnvFileError) {
      return Response.json({ error: error.message }, { status: error.status })
    }
    return Response.json({ error: 'Unable to activate environment version.' }, { status: 500 })
  }
}

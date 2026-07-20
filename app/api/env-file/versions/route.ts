import type { NextRequest } from 'next/server'
import { EnvFileError } from '@/lib/env-files'
import {
  copyEnvVersion,
  deleteEnvVersion,
  deleteEnvVersionHistory,
  getEnvVersionFile,
  saveEnvVersion,
} from '@/lib/env-versions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get('path')
  const versionId = request.nextUrl.searchParams.get('versionId') ?? undefined
  if (!path) return Response.json({ error: 'Enter an environment file path.' }, { status: 400 })

  try {
    return Response.json(getEnvVersionFile(path, versionId))
  } catch (error) {
    return envVersionErrorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      path?: unknown
      sourceVersionId?: unknown
      note?: unknown
    }
    if (
      typeof body.path !== 'string' ||
      typeof body.sourceVersionId !== 'string' ||
      (body.note !== undefined && typeof body.note !== 'string')
    ) {
      return Response.json({ error: 'Path and source version are required.' }, { status: 400 })
    }
    return Response.json(copyEnvVersion(body.path, body.sourceVersionId, body.note ?? ''))
  } catch (error) {
    return envVersionErrorResponse(error)
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      path?: unknown
      versionId?: unknown
      content?: unknown
      note?: unknown
    }
    if (
      typeof body.path !== 'string' ||
      typeof body.versionId !== 'string' ||
      typeof body.content !== 'string' ||
      typeof body.note !== 'string'
    ) {
      return Response.json(
        { error: 'Path, version, content, and note are required.' },
        { status: 400 },
      )
    }
    return Response.json(saveEnvVersion(body.path, body.versionId, body.content, body.note))
  } catch (error) {
    return envVersionErrorResponse(error)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      path?: unknown
      versionId?: unknown
      selectedVersionId?: unknown
    }
    if (typeof body.path !== 'string') {
      return Response.json({ error: 'Path is required.' }, { status: 400 })
    }
    if (body.versionId !== undefined) {
      if (
        typeof body.versionId !== 'string' ||
        (body.selectedVersionId !== undefined && typeof body.selectedVersionId !== 'string')
      ) {
        return Response.json({ error: 'A valid version is required.' }, { status: 400 })
      }
      return Response.json(deleteEnvVersion(body.path, body.versionId, body.selectedVersionId))
    }
    return Response.json(deleteEnvVersionHistory(body.path))
  } catch (error) {
    return envVersionErrorResponse(error)
  }
}

function envVersionErrorResponse(error: unknown) {
  if (error instanceof EnvFileError) {
    return Response.json({ error: error.message }, { status: error.status })
  }
  return Response.json({ error: 'Unable to access environment versions.' }, { status: 500 })
}

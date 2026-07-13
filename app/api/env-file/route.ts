import type { NextRequest } from 'next/server'
import { EnvFileError, readEnvFile, writeEnvFile } from '@/lib/env-files'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get('path')
  if (!path) return Response.json({ error: 'Enter an environment file path.' }, { status: 400 })

  try {
    return Response.json(readEnvFile(path))
  } catch (error) {
    return envFileErrorResponse(error)
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as { path?: unknown; content?: unknown }
    if (typeof body.path !== 'string' || typeof body.content !== 'string') {
      return Response.json({ error: 'Path and content are required.' }, { status: 400 })
    }
    return Response.json(writeEnvFile(body.path, body.content))
  } catch (error) {
    return envFileErrorResponse(error)
  }
}

function envFileErrorResponse(error: unknown) {
  if (error instanceof EnvFileError) {
    return Response.json({ error: error.message }, { status: error.status })
  }
  return Response.json({ error: 'Unable to access the environment file.' }, { status: 500 })
}

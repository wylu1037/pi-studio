import { listManagedEnvFiles } from '@/lib/env-versions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json(listManagedEnvFiles())
}

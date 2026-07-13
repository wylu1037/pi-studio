import { GET as handleMediaRequest } from '@/app/api/media/route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = handleMediaRequest

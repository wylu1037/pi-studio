import { SessionsView } from '@/components/sessions-view'
import { listAgents, listSessions } from '@/lib/db/repository'

export const dynamic = 'force-dynamic'

export default async function SessionsPage() {
  const { hydrateSessionSummariesFromSdk } = await import('@/lib/chat/session-branches')
  return (
    <SessionsView
      agents={listAgents()}
      sessions={hydrateSessionSummariesFromSdk(listSessions())}
    />
  )
}

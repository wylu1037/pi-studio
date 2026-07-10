import { SessionsView } from '@/components/sessions-view'
import { listAgents, listSessions } from '@/lib/db/repository'

export const dynamic = 'force-dynamic'

export default function SessionsPage() {
  return <SessionsView agents={listAgents()} sessions={listSessions()} />
}

import { AgentsDashboard } from '@/components/agents-dashboard'
import { listAgents } from '@/lib/db/repository'

export const dynamic = 'force-dynamic'

export default function Page() {
  return <AgentsDashboard agents={listAgents()} />
}

import { AgentsDashboard } from '@/components/agents-dashboard'
import { listAgents, listProviders } from '@/lib/db/repository'

export const dynamic = 'force-dynamic'

export default function Page() {
  const providerNames = Object.fromEntries(
    listProviders().map((provider) => [provider.id, provider.name]),
  )

  return <AgentsDashboard agents={listAgents()} providerNames={providerNames} />
}

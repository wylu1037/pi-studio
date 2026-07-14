import { notFound } from 'next/navigation'
import {
  getAgent,
  listMcpConfigs,
  listPrompts,
  listProviders,
  listSessions,
  listSkills,
  listStudioExtensions,
} from '@/lib/db/repository'
import { AgentDetail } from '@/components/agent-detail'

export const dynamic = 'force-dynamic'

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const agent = getAgent(id)
  if (!agent) notFound()
  const { hydrateSessionSummariesFromSdk } = await import('@/lib/chat/session-branches')
  const { listRuntimePackages } = await import('@/lib/packages/package-service')
  const packages = await listRuntimePackages(process.cwd())
  return (
    <AgentDetail
      agent={agent}
      extensions={listStudioExtensions()}
      packages={packages.installed}
      skills={listSkills()}
      prompts={listPrompts()}
      mcpConfigs={listMcpConfigs()}
      providers={listProviders()}
      sessions={hydrateSessionSummariesFromSdk(listSessions({ agentId: agent.id }))}
    />
  )
}

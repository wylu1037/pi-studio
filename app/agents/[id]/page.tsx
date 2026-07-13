import { notFound } from 'next/navigation'
import {
  getAgent,
  listMcpConfigs,
  listPrompts,
  listProviders,
  listSessions,
  listSkills,
} from '@/lib/db/repository'
import { AgentDetail } from '@/components/agent-detail'

export const dynamic = 'force-dynamic'

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const agent = getAgent(id)
  if (!agent) notFound()
  const { hydrateSessionSummariesFromSdk } = await import('@/lib/chat/session-branches')
  return (
    <AgentDetail
      agent={agent}
      skills={listSkills()}
      prompts={listPrompts()}
      mcpConfigs={listMcpConfigs()}
      providers={listProviders()}
      sessions={hydrateSessionSummariesFromSdk(listSessions({ agentId: agent.id }))}
    />
  )
}

import { ChatView } from '@/components/chat-view'
import {
  createSession,
  getAgent,
  getSession,
  getSessionTree,
  listAgents,
  listMcpConfigs,
  listProviders,
  listPrompts,
  listSessionMessages,
  listSessions,
  listSkills,
} from '@/lib/db/repository'

export const dynamic = 'force-dynamic'

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string; session?: string }>
}) {
  const params = await searchParams
  const agents = listAgents()
  const requestedSession = params.session ? getSession(params.session) : undefined
  const activeAgent =
    getAgent(requestedSession?.agentId ?? params.agent ?? agents[0]?.id) ?? agents[0]
  let sessions = activeAgent ? listSessions({ agentId: activeAgent.id }) : []
  const { hydrateSessionSummariesFromSdk, readSdkSessionContext, readSdkSessionTree } =
    await import('@/lib/chat/session-branches')
  sessions = hydrateSessionSummariesFromSdk(sessions)
  let activeSession = sessions.find((session) => session.id === requestedSession?.id) ?? sessions[0]

  if (activeAgent && !activeSession) {
    const created = createSession({
      agentId: activeAgent.id,
      name: 'New conversation',
      cwd: activeAgent.defaultCwd,
    })
    if (created) {
      sessions = [created, ...sessions]
      activeSession = created
    }
  }

  let messages = activeSession ? listSessionMessages(activeSession.id) : []
  let tree = activeSession ? getSessionTree(activeSession.id) : null
  if (activeSession) {
    const sdkTree = readSdkSessionTree(activeSession.filePath)
    const sdkContext = readSdkSessionContext(activeSession.filePath)
    tree = sdkTree?.roots[0] ?? tree
    messages = sdkContext?.messages ?? messages
  }

  return (
    <ChatView
      key={`${activeAgent?.id ?? 'none'}:${activeSession?.id ?? 'none'}`}
      agents={agents}
      activeAgent={activeAgent}
      sessions={sessions}
      activeSession={activeSession}
      messages={messages}
      tree={tree}
      providers={listProviders()}
      skills={listSkills()}
      prompts={listPrompts()}
      mcpConfigs={listMcpConfigs()}
    />
  )
}

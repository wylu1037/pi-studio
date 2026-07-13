import { ChatView } from '@/components/chat-view'
import {
  createSession,
  getAgent,
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
  const activeAgent = getAgent(params.agent ?? agents[0]?.id) ?? agents[0]
  let sessions = activeAgent ? listSessions({ agentId: activeAgent.id }) : []
  let activeSession = params.session
    ? sessions.find((session) => session.id === params.session)
    : sessions[0]

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
    const { readSdkSessionContext, readSdkSessionTree } = await import(
      '@/lib/chat/session-branches'
    )
    const sdkTree = readSdkSessionTree(activeSession.filePath)
    const sdkContext = readSdkSessionContext(activeSession.filePath)
    tree = sdkTree?.roots[0] ?? tree
    messages = sdkContext?.messages ?? messages
  }

  return (
    <ChatView
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

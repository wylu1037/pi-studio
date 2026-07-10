import { McpView } from '@/components/mcp-view'
import { listAgents, listMcpConfigs } from '@/lib/db/repository'

export const dynamic = 'force-dynamic'

export default function McpPage() {
  return <McpView agents={listAgents()} configs={listMcpConfigs()} />
}

import { ExtensionsView } from '@/components/extensions-view'

export const dynamic = 'force-dynamic'

export default async function ExtensionsPage() {
  const { listExtensionsWithRuntime } = await import('@/lib/extensions/extension-service')
  const { listAgents } = await import('@/lib/db/repository')
  const { listExtensionWorkspaces } = await import('@/lib/extensions/workspaces')
  const { getProjectTrustState } = await import('@/lib/extensions/project-trust')
  const workspaces = listExtensionWorkspaces()
  const cwd =
    workspaces.find((workspace) => workspace.path === process.cwd())?.path ??
    workspaces[0]?.path ??
    process.cwd()
  return (
    <ExtensionsView
      initialCwd={cwd}
      initialExtensions={await listExtensionsWithRuntime(cwd)}
      initialAgents={listAgents()}
      initialWorkspaces={workspaces}
      initialTrust={getProjectTrustState(cwd)}
    />
  )
}

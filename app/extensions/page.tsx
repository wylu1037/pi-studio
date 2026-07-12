import { ExtensionsView } from '@/components/extensions-view'

export const dynamic = 'force-dynamic'

export default async function ExtensionsPage() {
  const { listRuntimeExtensions } = await import('@/lib/packages/package-service')
  return <ExtensionsView extensions={await listRuntimeExtensions(process.cwd())} />
}

import { PackagesView } from '@/components/packages-view'
import { loadPiPackageCatalog } from '@/lib/packages/pi-dev-gallery'

export const dynamic = 'force-dynamic'

export default async function PackagesPage() {
  const { listRuntimePackages } = await import('@/lib/packages/package-service')
  const catalog = await loadPiPackageCatalog()
  const collection = await listRuntimePackages(process.cwd(), catalog.packages)
  return <PackagesView installed={collection.installed} catalog={catalog} />
}

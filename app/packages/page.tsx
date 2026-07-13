import { PackagesView } from '@/components/packages-view'
import { listPackageGallery } from '@/lib/db/repository'
import { loadPackageGallery } from '@/lib/packages/pi-dev-gallery'

export const dynamic = 'force-dynamic'

export default async function PackagesPage() {
  const { listRuntimePackages } = await import('@/lib/packages/package-service')
  const gallery = await loadPackageGallery(listPackageGallery())
  const collection = await listRuntimePackages(process.cwd(), gallery)
  return <PackagesView installed={collection.installed} gallery={collection.gallery} />
}

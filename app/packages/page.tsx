import { PackagesView } from '@/components/packages-view'
import { listPackages } from '@/lib/db/repository'

export const dynamic = 'force-dynamic'

export default function PackagesPage() {
  const { installed, gallery } = listPackages()
  return <PackagesView installed={installed} gallery={gallery} />
}

import { ModelsView } from '@/components/models-view'
import { listProviders } from '@/lib/db/repository'

export const dynamic = 'force-dynamic'

export default function ModelsPage() {
  return <ModelsView providers={listProviders()} />
}

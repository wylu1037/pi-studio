import { PromptsView } from '@/components/prompts-view'
import { listPrompts } from '@/lib/db/repository'

export const dynamic = 'force-dynamic'

export default function PromptsPage() {
  return <PromptsView prompts={listPrompts()} />
}

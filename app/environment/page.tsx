import { join } from 'node:path'
import { EnvView } from '@/components/env-view'

export const dynamic = 'force-dynamic'

export default function EnvironmentPage() {
  return <EnvView defaultPath={join(process.cwd(), '.env')} />
}

import { SettingsView } from '@/components/settings-view'
import { getStorageStats } from '@/lib/storage/stats'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const storageStats = await getStorageStats()
  return <SettingsView storageStats={storageStats} />
}

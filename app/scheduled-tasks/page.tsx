import { ScheduledTasksView } from '@/components/scheduled-tasks-view'
import { listAgents, listProviders, listScheduledTasks, listSessions } from '@/lib/db/repository'

export const dynamic = 'force-dynamic'

export default function ScheduledTasksPage() {
  return (
    <ScheduledTasksView
      agents={listAgents()}
      providers={listProviders().map(({ id, name, models }) => ({ id, name, models }))}
      initialSessions={listSessions()}
      initialTasks={listScheduledTasks()}
    />
  )
}

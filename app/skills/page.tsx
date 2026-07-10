import { SkillsView } from '@/components/skills-view'
import { listAgents, listSkills } from '@/lib/db/repository'

export const dynamic = 'force-dynamic'

export default function SkillsPage() {
  return <SkillsView agents={listAgents()} skills={listSkills()} />
}

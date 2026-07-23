import { db, sqlite } from './client'
import {
  agentMcpConfigs,
  agentModelProviders,
  agentModels,
  agentPrompts,
  agents,
  agentSkills,
  agentTags,
  chatMessages,
  chatRuns,
  globalPrompts,
  globalSkills,
  mcpConfigs,
  mcpTags,
  modelProviders,
  models,
  packages,
  promptTags,
  sessions,
  sessionTags,
  sessionTreeNodes,
  skillTags,
} from './schema'

sqlite.transaction(() => {
  db.delete(chatRuns).run()
  db.delete(chatMessages).run()
  db.delete(sessionTreeNodes).run()
  db.delete(sessionTags).run()
  db.delete(sessions).run()
  db.delete(agentModels).run()
  db.delete(agentModelProviders).run()
  db.delete(agentMcpConfigs).run()
  db.delete(agentPrompts).run()
  db.delete(agentSkills).run()
  db.delete(agentTags).run()
  db.delete(agents).run()
  db.delete(models).run()
  db.delete(modelProviders).run()
  db.delete(mcpTags).run()
  db.delete(mcpConfigs).run()
  db.delete(promptTags).run()
  db.delete(globalPrompts).run()
  db.delete(skillTags).run()
  db.delete(globalSkills).run()
  db.delete(packages).run()
})()

console.log('Cleared Pi Studio database')

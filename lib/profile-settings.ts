export const USER_PROFILE_STORAGE_KEY = 'pi-studio:profile'
export const USER_PROFILE_CHANGE_EVENT = 'pi-studio:profile-change'

export const userAvatarPresetIds = [
  'notion-smile',
  'notion-glasses',
  'notion-bob',
  'notion-cap',
] as const

export const agentAvatarPresetIds = ['pi', 'robot'] as const

export type UserAvatarPresetId = (typeof userAvatarPresetIds)[number]
export type AgentAvatarPresetId = (typeof agentAvatarPresetIds)[number]
export type ChatAvatarPresetId = UserAvatarPresetId | AgentAvatarPresetId

export const DEFAULT_USER_AVATAR: UserAvatarPresetId = 'notion-smile'
export const DEFAULT_AGENT_AVATAR: AgentAvatarPresetId = 'pi'

export function isUserAvatarPreset(value: unknown): value is UserAvatarPresetId {
  return userAvatarPresetIds.includes(value as UserAvatarPresetId)
}

export function isAgentAvatarPreset(value: unknown): value is AgentAvatarPresetId {
  return agentAvatarPresetIds.includes(value as AgentAvatarPresetId)
}

export function normalizeUserAvatarPreset(value: unknown): UserAvatarPresetId {
  return isUserAvatarPreset(value) ? value : DEFAULT_USER_AVATAR
}

export function normalizeAgentAvatarPreset(value: unknown): AgentAvatarPresetId {
  return isAgentAvatarPreset(value) ? value : DEFAULT_AGENT_AVATAR
}

export function parseStoredProfile(value: string | null) {
  if (!value) return { avatar: DEFAULT_USER_AVATAR }
  try {
    const parsed = JSON.parse(value) as { avatar?: unknown }
    return { avatar: normalizeUserAvatarPreset(parsed.avatar) }
  } catch {
    return { avatar: DEFAULT_USER_AVATAR }
  }
}

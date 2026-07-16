import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  normalizeAgentAvatarPreset,
  normalizeUserAvatarPreset,
  type AgentAvatarPresetId,
  type ChatAvatarPresetId,
  type UserAvatarPresetId,
} from '@/lib/profile-settings'
import { cn } from '@/lib/utils'

export const userAvatarPresets: Array<{ id: UserAvatarPresetId; label: string }> = [
  { id: 'notion-smile', label: 'Smile' },
  { id: 'notion-glasses', label: 'Glasses' },
  { id: 'notion-bob', label: 'Bob' },
  { id: 'notion-cap', label: 'Cap' },
]

export const agentAvatarPresets: Array<{ id: AgentAvatarPresetId; label: string }> = [
  { id: 'pi', label: 'Pi' },
  { id: 'robot', label: 'Robot' },
]

export function ChatAvatar({
  preset,
  role,
  className,
}: {
  preset?: string
  role: 'user' | 'assistant'
  className?: string
}) {
  const normalized: ChatAvatarPresetId =
    role === 'user' ? normalizeUserAvatarPreset(preset) : normalizeAgentAvatarPreset(preset)

  return (
    <Avatar
      className={cn(
        'size-8 border border-border-strong',
        role === 'assistant' ? 'bg-accent/10 text-accent' : 'bg-secondary text-foreground',
        className,
      )}
    >
      <AvatarFallback>{avatarGlyph(normalized)}</AvatarFallback>
    </Avatar>
  )
}

function avatarGlyph(preset: ChatAvatarPresetId) {
  if (preset === 'pi') return <PiGlyph />
  if (preset === 'robot') return <RobotGlyph />
  return <NotionGlyph preset={preset} />
}

function PiGlyph() {
  return (
    <svg viewBox="0 0 800 800" aria-hidden="true" className="size-5 fill-current">
      <path
        fillRule="evenodd"
        d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"
      />
      <path d="M517.36 400H634.72V634.72H517.36Z" />
    </svg>
  )
}

function RobotGlyph() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      className="size-6 fill-none stroke-current"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M32 10v7" />
      <circle cx="32" cy="8" r="2" fill="currentColor" stroke="none" />
      <rect x="15" y="18" width="34" height="30" rx="10" />
      <path d="M10 30v8M54 30v8M24 48v6M40 48v6" />
      <circle cx="25" cy="31" r="3" fill="currentColor" stroke="none" />
      <circle cx="39" cy="31" r="3" fill="currentColor" stroke="none" />
      <path d="M25 40c4 3 10 3 14 0" />
    </svg>
  )
}

function NotionGlyph({ preset }: { preset: UserAvatarPresetId }) {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      className="size-7 fill-none stroke-current"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="32" cy="34" r="18" />
      {preset === 'notion-smile' && (
        <>
          <path
            d="M15 29c2-12 10-18 20-18 8 0 14 4 17 11-8-2-15-6-20-11-4 7-10 12-17 18Z"
            fill="currentColor"
          />
          <path d="M25 34h.1M39 34h.1M25 42c5 4 9 4 14 0" />
        </>
      )}
      {preset === 'notion-glasses' && (
        <>
          <path d="M15 29c1-13 9-19 18-19 10 0 17 6 19 16-8-5-19-7-37 3Z" fill="currentColor" />
          <rect x="20" y="31" width="10" height="7" rx="3" />
          <rect x="34" y="31" width="10" height="7" rx="3" />
          <path d="M30 34h4M27 43c4 2 7 2 10 0" />
        </>
      )}
      {preset === 'notion-bob' && (
        <>
          <path
            d="M14 33c0-15 7-23 18-23s18 8 18 23v8l-5-3V25c-8 2-16 0-23-5v18l-8 4Z"
            fill="currentColor"
          />
          <path d="M25 34h.1M39 34h.1M27 43c3 2 7 2 10 0" />
        </>
      )}
      {preset === 'notion-cap' && (
        <>
          <path d="M17 25c2-9 8-14 16-14 9 0 15 5 17 14H17Z" fill="currentColor" />
          <path d="M16 25h38M24 34h.1M39 34h.1M26 43c4 3 8 3 12 0" />
        </>
      )}
    </svg>
  )
}

'use client'

import { Check } from 'lucide-react'
import { ChatAvatar } from '@/components/chat-avatar'
import { cn } from '@/lib/utils'

export function AvatarPresetPicker<T extends string>({
  presets,
  selected,
  role,
  onSelect,
}: {
  presets: Array<{ id: T; label: string }>
  selected: T
  role: 'user' | 'assistant'
  onSelect: (preset: T) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {presets.map((preset) => {
        const active = preset.id === selected
        return (
          <button
            key={preset.id}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(preset.id)}
            className={cn(
              'relative flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors active:scale-[0.98]',
              active
                ? 'border-accent bg-accent/8 text-foreground'
                : 'border-border-strong bg-panel text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <ChatAvatar preset={preset.id} role={role} />
            <span className="truncate text-xs font-medium">{preset.label}</span>
            {active && <Check className="absolute top-1.5 right-1.5 size-3 text-accent" />}
          </button>
        )
      })}
    </div>
  )
}

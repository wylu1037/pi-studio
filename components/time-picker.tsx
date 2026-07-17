'use client'

import { Popover } from '@base-ui/react/popover'
import { CheckIcon, ChevronDownIcon, Clock3Icon } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'))
const MINUTES = Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, '0'))

export function TimePicker({
  value,
  onValueChange,
  disabled = false,
}: {
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
}) {
  const [hour = '09', minute = '00'] = value.split(':')
  const update = (nextHour: string, nextMinute: string) =>
    onValueChange(`${nextHour}:${nextMinute}`)

  return (
    <Popover.Root>
      <Popover.Trigger
        disabled={disabled}
        aria-label="Select time"
        className="flex h-8 min-w-32 items-center justify-between gap-2 border border-input bg-panel px-2.5 font-mono text-xs text-foreground transition-colors outline-none hover:border-border-strong hover:bg-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50"
      >
        <span className="flex items-center gap-2">
          <Clock3Icon className="size-3.5 text-muted-foreground" />
          {hour}:{minute}
        </span>
        <ChevronDownIcon className="size-3.5 text-muted-foreground" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" sideOffset={4} align="start" className="z-50">
          <Popover.Popup className="overflow-hidden border border-border-strong bg-popover text-popover-foreground shadow-md outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <div className="grid grid-cols-2 divide-x divide-border">
              <TimeColumn
                label="Hour"
                values={HOURS}
                selected={hour}
                onSelect={(nextHour) => update(nextHour, minute)}
              />
              <TimeColumn
                label="Minute"
                values={MINUTES}
                selected={minute}
                onSelect={(nextMinute) => update(hour, nextMinute)}
              />
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

function TimeColumn({
  label,
  values,
  selected,
  onSelect,
}: {
  label: string
  values: string[]
  selected: string
  onSelect: (value: string) => void
}) {
  return (
    <div className="w-24">
      <div className="font-mono-label border-b border-border bg-panel px-3 py-2 text-[10px] text-muted-foreground">
        {label}
      </div>
      <ScrollArea className="h-48" contentClassName="p-1 pr-3">
        {values.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={selected === item}
            onClick={() => onSelect(item)}
            className={cn(
              'flex h-7 w-full items-center justify-between px-2 font-mono text-xs transition-colors hover:bg-muted',
              selected === item && 'bg-primary text-primary-foreground hover:bg-primary',
            )}
          >
            {item}
            {selected === item && <CheckIcon className="size-3" />}
          </button>
        ))}
      </ScrollArea>
    </div>
  )
}

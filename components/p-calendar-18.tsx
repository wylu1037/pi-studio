'use client'

import { useState } from 'react'
import { Popover } from '@base-ui/react/popover'
import { CalendarDaysIcon } from 'lucide-react'
import { TimePicker } from '@/components/time-picker'
import { Calendar } from '@/components/ui/calendar'
import { Label } from '@/components/pi-ui'

function formatTime(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function withTime(date: Date, time: string) {
  const [hours = 9, minutes = 0] = time.split(':').map(Number)
  const next = new Date(date)
  next.setHours(hours, minutes, 0, 0)
  return next
}

function formatDateTime(date?: Date) {
  if (!date) return 'Select date and time'
  const datePart = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return `${datePart} ${formatTime(date)}`
}

export function RunAtCalendar({
  value,
  onValueChange,
}: {
  value?: Date
  onValueChange: (value?: Date) => void
}) {
  const [draftTime, setDraftTime] = useState(() => (value ? formatTime(value) : '09:00'))
  const time = value ? formatTime(value) : draftTime

  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label="Select run date and time"
        className="flex h-8 w-full items-center gap-2 border border-input bg-background px-2.5 font-mono text-xs text-foreground transition-colors outline-none hover:border-border-strong hover:bg-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <CalendarDaysIcon className="size-3.5 text-muted-foreground" />
        <span className="truncate">{formatDateTime(value)}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" sideOffset={4} align="start" className="z-50">
          <Popover.Popup className="border border-border-strong bg-popover p-3 text-popover-foreground shadow-md outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <div className="flex flex-col gap-3">
              <Calendar
                mode="single"
                defaultMonth={value}
                selected={value}
                onSelect={(date) => onValueChange(date ? withTime(date, time) : undefined)}
              />
              <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                <Label>Time</Label>
                <TimePicker
                  value={time}
                  onValueChange={(nextTime) => {
                    setDraftTime(nextTime)
                    if (value) onValueChange(withTime(value, nextTime))
                  }}
                />
              </div>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

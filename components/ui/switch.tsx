'use client'

import * as React from 'react'
import { Switch as SwitchPrimitive } from '@base-ui/react/switch'
import { cn } from '@/lib/utils'

function Switch({
  className,
  icons,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  icons?: {
    unchecked: React.ReactNode
    checked: React.ReactNode
  }
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'group/switch relative inline-flex shrink-0 cursor-pointer items-center border border-border-strong bg-muted outline-none transition-colors',
        icons ? 'h-8 w-20' : 'h-5 w-9',
        'data-checked:border-primary data-checked:bg-primary focus-visible:ring-2 focus-visible:ring-ring/40',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none block bg-card transition-transform',
          icons
            ? 'h-6 w-9 translate-x-1 shadow-sm data-checked:translate-x-10'
            : 'size-3.5 translate-x-0.5 data-checked:translate-x-[18px]',
        )}
      />
      {icons && (
        <span className="pointer-events-none absolute inset-0 grid grid-cols-2 items-center text-muted-foreground">
          <span className="flex items-center justify-center text-foreground group-data-checked/switch:text-primary-foreground/65">
            {icons.unchecked}
          </span>
          <span className="flex items-center justify-center group-data-checked/switch:text-foreground">
            {icons.checked}
          </span>
        </span>
      )}
    </SwitchPrimitive.Root>
  )
}

export { Switch }

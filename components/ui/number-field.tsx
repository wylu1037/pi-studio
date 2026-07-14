'use client'

import { Minus, Plus } from 'lucide-react'
import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export interface NumberFieldProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange'
> {
  value?: string
  onChange?: (value: string) => void
  min?: number
  max?: number
  step?: number
}

export const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(function NumberField(
  { className, value = '', onChange, min, max, step = 1, disabled, ...props },
  ref,
) {
  const adjust = (direction: 1 | -1) => {
    const current = Number(value)
    const next = (Number.isFinite(current) ? current : (min ?? 0)) + direction * step
    const bounded = Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? 0, next))
    onChange?.(String(bounded))
  }

  return (
    <div
      className={cn(
        'flex w-full border border-input bg-panel font-mono text-[13px] transition-colors focus-within:border-ring',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label="Decrease value"
        disabled={disabled || (min !== undefined && Number(value) <= min)}
        onClick={() => adjust(-1)}
        className="inline-flex w-7 shrink-0 items-center justify-center border-r border-input text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
      >
        <Minus className="size-3" aria-hidden="true" />
      </button>
      <input
        {...props}
        ref={ref}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.value)}
        className="min-w-0 flex-1 bg-transparent px-3 py-1.5 text-center text-foreground outline-none"
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Increase value"
        disabled={disabled || (max !== undefined && Number(value) >= max)}
        onClick={() => adjust(1)}
        className="inline-flex w-7 shrink-0 items-center justify-center border-l border-input text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
      >
        <Plus className="size-3" aria-hidden="true" />
      </button>
    </div>
  )
})

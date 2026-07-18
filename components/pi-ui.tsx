'use client'

import type React from 'react'
import { cn } from '@/lib/utils'

/* Uppercase tracked mono label used for section headers */
export function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('font-mono-label text-[11px] text-muted-foreground', className)}>
      {children}
    </span>
  )
}

/* Bracketed monospace button: [ LABEL ] */
export function BracketButton({
  children,
  onClick,
  active,
  className,
  title,
  disabled,
}: {
  children: React.ReactNode
  onClick?: () => void
  active?: boolean
  className?: string
  title?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 border border-border-strong bg-card px-3 py-1.5 font-mono text-xs tracking-wide whitespace-nowrap text-foreground transition-colors',
        'hover:bg-muted disabled:pointer-events-none disabled:opacity-40',
        active && 'border-primary bg-primary text-primary-foreground',
        className,
      )}
    >
      <span className="text-muted-foreground/70">[</span>
      <span className="uppercase">{children}</span>
      <span className="text-muted-foreground/70">]</span>
    </button>
  )
}

/* Solid accent action button */
export function ActionButton({
  children,
  onClick,
  className,
  variant = 'default',
  type = 'button',
  title,
  disabled,
}: {
  children: React.ReactNode
  onClick?: () => void
  className?: string
  variant?: 'default' | 'accent' | 'ghost' | 'danger'
  type?: 'button' | 'submit'
  title?: string
  disabled?: boolean
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-2 border px-3 py-1.5 font-mono text-xs tracking-wide uppercase transition-colors',
        'disabled:pointer-events-none disabled:opacity-45',
        variant === 'default' && 'border-border-strong bg-card text-foreground hover:bg-muted',
        variant === 'accent' &&
          'border-primary bg-primary text-primary-foreground hover:opacity-90',
        variant === 'ghost' &&
          'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
        variant === 'danger' &&
          'border-destructive/40 bg-transparent text-destructive hover:bg-destructive/10',
        className,
      )}
    >
      {children}
    </button>
  )
}

/* Small uppercase mono tag/badge */
export function Tag({
  children,
  tone = 'default',
  className,
}: {
  children: React.ReactNode
  tone?: 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'outline'
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 font-mono text-[10px] leading-none tracking-wider uppercase',
        tone === 'default' && 'bg-muted text-muted-foreground',
        tone === 'accent' && 'bg-accent/12 text-accent',
        tone === 'success' && 'bg-success/12 text-success',
        tone === 'warning' && 'bg-warning/15 text-warning',
        tone === 'danger' && 'bg-destructive/12 text-destructive',
        tone === 'outline' && 'border border-border-strong text-muted-foreground',
        className,
      )}
    >
      {children}
    </span>
  )
}

/* Bordered panel/card */
export function Panel({
  children,
  className,
  as: Comp = 'div',
  onSubmit,
}: {
  children: React.ReactNode
  className?: string
  as?: React.ElementType
  onSubmit?: React.FormEventHandler<HTMLFormElement>
}) {
  return (
    <Comp className={cn('border border-border bg-card', className)} onSubmit={onSubmit}>
      {children}
    </Comp>
  )
}

export function PanelHeader({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between border-b border-border bg-panel px-4 py-2.5',
        className,
      )}
    >
      {children}
    </div>
  )
}

/* Text/search input in pi style */
export function TextInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className,
  mono = true,
  icon,
}: {
  value?: string
  onChange?: (v: string) => void
  placeholder?: string
  ariaLabel?: string
  className?: string
  mono?: boolean
  icon?: React.ReactNode
}) {
  return (
    <div className={cn('relative flex items-center', className)}>
      {icon && (
        <span className="pointer-events-none absolute left-2.5 text-muted-foreground">{icon}</span>
      )}
      <input
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={cn(
          'w-full border border-input bg-panel px-3 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-ring',
          mono && 'font-mono text-[13px]',
          icon && 'pl-8',
        )}
      />
    </div>
  )
}

/* Terminal-style install command box */
export function CommandBox({ command, className }: { command: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 border border-border bg-panel px-3 py-2',
        className,
      )}
    >
      <code className="truncate font-mono text-xs text-muted-foreground">
        <span className="text-muted-foreground/60">$ </span>
        {command}
      </code>
      <button
        type="button"
        className="shrink-0 border border-border-strong px-2 py-0.5 font-mono text-[10px] tracking-wider text-muted-foreground uppercase hover:bg-muted hover:text-foreground"
      >
        [ Copy ]
      </button>
    </div>
  )
}

/* Toggle switch */
export function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange?: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange?.(!checked)}
      disabled={disabled}
      className={cn(
        'relative h-4.5 w-8 shrink-0 border transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        checked ? 'border-accent bg-accent/80' : 'border-border-strong bg-muted',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 size-3 bg-card transition-all',
          checked ? 'left-4' : 'left-0.5',
        )}
      />
    </button>
  )
}

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border px-6 py-5">
      <div className="min-w-0">
        <h1 className="font-serif text-3xl leading-none text-balance text-foreground italic">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1.5 max-w-2xl text-sm text-pretty text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  )
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-description"
    >
      <button
        type="button"
        aria-label="Close confirmation"
        onClick={busy ? undefined : onCancel}
        className="absolute inset-0 bg-foreground/25"
      />
      <div className="relative w-full max-w-md border border-border bg-card shadow-xl">
        <div className="border-b border-border bg-panel px-4 py-3">
          <h2 id="confirm-dialog-title" className="font-serif text-lg text-foreground italic">
            {title}
          </h2>
        </div>
        <p
          id="confirm-dialog-description"
          className="px-4 py-4 text-sm leading-relaxed text-muted-foreground"
        >
          {description}
        </p>
        <div className="flex items-center justify-end gap-2 border-t border-border bg-panel px-4 py-3">
          <ActionButton onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </ActionButton>
          <ActionButton variant="danger" onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </ActionButton>
        </div>
      </div>
    </div>
  )
}

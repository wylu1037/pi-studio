import * as React from 'react'
import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type AttachmentState = 'idle' | 'uploading' | 'processing' | 'error' | 'done'

const attachmentVariants = cva(
  'group/attachment relative flex min-w-0 shrink-0 items-center gap-2 overflow-hidden rounded-md border border-border bg-muted/40 text-foreground transition-colors data-[state=error]:border-destructive/40 data-[state=error]:bg-destructive/5',
  {
    variants: {
      size: {
        default: 'min-h-14 w-72 px-2.5 py-2',
        sm: 'min-h-11 w-60 px-2 py-1.5',
        xs: 'min-h-9 w-52 gap-1.5 px-1.5 py-1',
      },
      orientation: {
        horizontal: '',
        vertical: 'w-44 flex-col items-stretch',
      },
    },
    defaultVariants: {
      size: 'default',
      orientation: 'horizontal',
    },
  },
)

function AttachmentGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="attachment-group"
      role="list"
      className={cn(
        'scroll-fade-x flex max-w-full min-w-0 items-stretch gap-2 overflow-x-auto overscroll-x-contain py-0.5',
        className,
      )}
      {...props}
    />
  )
}

function Attachment({
  className,
  state = 'idle',
  size = 'default',
  orientation = 'horizontal',
  render,
  ...props
}: useRender.ComponentProps<'div'> &
  VariantProps<typeof attachmentVariants> & {
    state?: AttachmentState
  }) {
  const pending = state === 'uploading' || state === 'processing'

  return useRender({
    defaultTagName: 'div',
    props: mergeProps<'div'>(
      {
        'aria-busy': pending || undefined,
        'aria-invalid': state === 'error' || undefined,
        className: cn(attachmentVariants({ size, orientation, className })),
        role: 'listitem',
      },
      props,
    ),
    render,
    state: {
      slot: 'attachment',
      state,
      size,
      orientation,
    },
  })
}

const attachmentMediaVariants = cva(
  "flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-background text-muted-foreground ring-1 ring-border [&_svg:not([class*='size-'])]:size-4 group-data-[size=sm]/attachment:size-8 group-data-[size=xs]/attachment:size-7 group-data-[size=xs]/attachment:[&_svg:not([class*='size-'])]:size-3.5 group-data-[orientation=vertical]/attachment:aspect-video group-data-[orientation=vertical]/attachment:h-auto group-data-[orientation=vertical]/attachment:w-full",
  {
    variants: {
      variant: {
        icon: '',
        image: '[&>img]:size-full [&>img]:object-cover',
      },
    },
    defaultVariants: {
      variant: 'icon',
    },
  },
)

function AttachmentMedia({
  className,
  variant = 'icon',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof attachmentMediaVariants>) {
  return (
    <div
      data-slot="attachment-media"
      data-variant={variant}
      aria-hidden={variant === 'icon' ? true : undefined}
      className={cn(attachmentMediaVariants({ variant, className }))}
      {...props}
    />
  )
}

function AttachmentContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="attachment-content"
      className={cn(
        'flex min-w-0 flex-1 flex-col justify-center gap-0.5 group-data-[orientation=vertical]/attachment:w-full',
        className,
      )}
      {...props}
    />
  )
}

function AttachmentTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="attachment-title"
      className={cn(
        'group-data-[state=uploading]/attachment:shimmer group-data-[state=processing]/attachment:shimmer truncate text-xs leading-4 font-medium group-data-[state=error]/attachment:text-destructive',
        className,
      )}
      {...props}
    />
  )
}

function AttachmentDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="attachment-description"
      className={cn(
        'truncate text-[11px] leading-4 text-muted-foreground group-data-[state=error]/attachment:text-destructive',
        className,
      )}
      {...props}
    />
  )
}

function AttachmentActions({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="attachment-actions"
      className={cn(
        'flex shrink-0 items-center gap-0.5 group-data-[orientation=vertical]/attachment:absolute group-data-[orientation=vertical]/attachment:top-1.5 group-data-[orientation=vertical]/attachment:right-1.5',
        className,
      )}
      {...props}
    />
  )
}

function AttachmentAction({
  variant = 'ghost',
  size = 'icon-xs',
  ...props
}: React.ComponentProps<typeof Button>) {
  return <Button data-slot="attachment-action" variant={variant} size={size} {...props} />
}

export {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  attachmentMediaVariants,
  attachmentVariants,
  type AttachmentState,
}

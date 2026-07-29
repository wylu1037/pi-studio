import type { ComponentProps } from 'react'
import { LoaderCircle } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * A small loading indicator. Follows the shadcn Spinner pattern (a spinning
 * loader icon), but uses `LoaderCircle` to match the icon already used across
 * the app. Pair it with a verb-form label (e.g. "Testing", "Saving") to show a
 * button's in-flight state.
 */
function Spinner({ className, ...props }: ComponentProps<typeof LoaderCircle>) {
  return (
    <LoaderCircle
      role="status"
      aria-label="Loading"
      className={cn('size-3.5 animate-spin', className)}
      {...props}
    />
  )
}

export { Spinner }

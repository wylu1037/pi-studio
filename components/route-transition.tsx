'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

const easeOut = [0.22, 1, 0.36, 1] as const

export function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const reduceMotion = useReducedMotion()

  return (
    <AnimatePresence initial={false} mode="popLayout">
      <motion.div
        key={pathname}
        className="h-full"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.2, ease: easeOut }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

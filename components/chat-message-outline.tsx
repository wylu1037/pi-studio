'use client'

import { useEffect, useState, type RefObject } from 'react'
import { FileCode2 } from 'lucide-react'
import { motion } from 'motion/react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export type ChatMessageOutlineEntry = {
  id: string
  anchorId: string
  title: string
  summary?: string
  timestamp?: string
  attachmentCount?: number
  references?: string[]
}

export function ChatMessageOutline({
  bottomOffset,
  entries,
  viewportRef,
}: {
  bottomOffset: number
  entries: ChatMessageOutlineEntry[]
  viewportRef: RefObject<HTMLDivElement | null>
}) {
  const [activeId, setActiveId] = useState(entries.at(-1)?.id ?? null)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || entries.length === 0) {
      setActiveId(null)
      return
    }

    let frame = 0
    const updateActiveEntry = () => {
      const viewportRect = viewport.getBoundingClientRect()
      const threshold = viewportRect.top + Math.min(viewport.clientHeight * 0.32, 220)
      let nextActiveId = entries[0].id

      for (const entry of entries) {
        const anchor = document.getElementById(entry.anchorId)
        if (!anchor) continue
        if (anchor.getBoundingClientRect().top <= threshold) nextActiveId = entry.id
        else break
      }

      setActiveId(nextActiveId)
    }
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(updateActiveEntry)
    }

    scheduleUpdate()
    viewport.addEventListener('scroll', scheduleUpdate, { passive: true })
    const resizeObserver = new ResizeObserver(scheduleUpdate)
    resizeObserver.observe(viewport)
    const content = viewport.querySelector<HTMLElement>('[data-slot="scroll-area-content"]')
    if (content) resizeObserver.observe(content)

    return () => {
      window.cancelAnimationFrame(frame)
      viewport.removeEventListener('scroll', scheduleUpdate)
      resizeObserver.disconnect()
    }
  }, [entries, viewportRef])

  if (entries.length === 0) return null

  const markerHeight = Math.max(4, Math.min(14, 280 / entries.length))
  const activeIndex = Math.max(
    0,
    entries.findIndex((entry) => entry.id === activeId),
  )
  const focusedIndex = hoveredIndex ?? activeIndex

  const jumpToEntry = (entry: ChatMessageOutlineEntry) => {
    const viewport = viewportRef.current
    const anchor = document.getElementById(entry.anchorId)
    if (!viewport || !anchor) return

    const viewportRect = viewport.getBoundingClientRect()
    const anchorRect = anchor.getBoundingClientRect()
    const targetTop = viewport.scrollTop + anchorRect.top - viewportRect.top - 24
    setActiveId(entry.id)
    viewport.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })
  }

  return (
    <nav
      aria-label="Conversation outline"
      className="pointer-events-none absolute top-5 right-3 hidden w-14 items-center xl:flex"
      style={{ bottom: bottomOffset }}
    >
      <div
        className="pointer-events-auto flex max-h-full w-full flex-col items-end py-2"
        onMouseLeave={() => setHoveredIndex(null)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setHoveredIndex(null)
        }}
      >
        {entries.map((entry, index) => {
          const focused = index === focusedIndex
          const distance = Math.abs(index - focusedIndex)
          const scaleX =
            hoveredIndex === null
              ? 1
              : focused
                ? 4.25
                : distance === 1
                  ? 3.15
                  : distance === 2
                    ? 2.3
                    : distance === 3
                      ? 1.6
                      : 1
          const opacity = focused
            ? 1
            : hoveredIndex !== null && distance <= 3
              ? 0.52 - distance * 0.07
              : 0.28
          return (
            <Tooltip key={entry.id}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={`Jump to conversation turn ${index + 1}: ${entry.title}`}
                    aria-current={entry.id === activeId ? 'location' : undefined}
                    onClick={() => jumpToEntry(entry)}
                    onMouseEnter={() => setHoveredIndex(index)}
                    onFocus={() => setHoveredIndex(index)}
                    className="group flex w-full shrink-0 items-center justify-end outline-none"
                    style={{ height: markerHeight }}
                  />
                }
              >
                <motion.span
                  initial={false}
                  animate={{ scaleX, opacity }}
                  transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.55 }}
                  className={cn(
                    'block h-0.5 w-3 origin-right will-change-transform',
                    focused ? 'bg-foreground' : 'bg-muted-foreground',
                  )}
                />
              </TooltipTrigger>
              <TooltipContent
                side="left"
                sideOffset={14}
                hideArrow
                className="block w-80 max-w-[min(20rem,calc(100vw-5rem))] rounded-xl border border-border bg-card p-0 text-foreground shadow-xl"
              >
                <div className="min-w-0 p-3.5">
                  <div className="flex items-center justify-between gap-3 font-mono text-[9px] text-muted-foreground/65">
                    <span>TURN {String(index + 1).padStart(2, '0')}</span>
                    {entry.timestamp ? (
                      <span>{formatOutlineTimestamp(entry.timestamp)}</span>
                    ) : null}
                  </div>
                  <p className="mt-2 line-clamp-2 text-[12px] leading-4 font-medium text-foreground">
                    {entry.title}
                  </p>
                  {entry.summary && (
                    <div className="mt-2.5 flex items-start gap-2">
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/45" />
                      <p className="line-clamp-3 text-[11px] leading-4 text-muted-foreground">
                        {entry.summary}
                      </p>
                    </div>
                  )}
                  {(entry.references?.length || entry.attachmentCount) && (
                    <div className="mt-3 flex flex-col gap-1.5 border-t border-border pt-2.5">
                      {entry.references?.map((reference) => (
                        <div
                          key={reference}
                          className="flex min-w-0 items-center gap-2 text-muted-foreground"
                        >
                          <FileCode2 className="size-3.5 shrink-0" />
                          <span className="truncate font-mono text-[10px]">{reference}</span>
                        </div>
                      ))}
                      {entry.attachmentCount ? (
                        <span className="font-mono text-[9px] text-muted-foreground/65">
                          {entry.attachmentCount} attached{' '}
                          {entry.attachmentCount === 1 ? 'file' : 'files'}
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </nav>
  )
}

function formatOutlineTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

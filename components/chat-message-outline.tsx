'use client'

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
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

type ChatMessageOutlineItem = {
  id: string
  startIndex: number
  endIndex: number
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
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null)
  const [availableHeight, setAvailableHeight] = useState(280)
  const outlineRef = useRef<HTMLElement>(null)

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

  useEffect(() => {
    const outline = outlineRef.current
    if (!outline) return
    const updateHeight = () => setAvailableHeight(outline.getBoundingClientRect().height)
    updateHeight()
    const resizeObserver = new ResizeObserver(updateHeight)
    resizeObserver.observe(outline)
    return () => resizeObserver.disconnect()
  }, [])

  const activeIndex = Math.max(
    0,
    entries.findIndex((entry) => entry.id === activeId),
  )
  const trackHeight = Math.max(48, Math.min(280, availableHeight - 16))
  const maxMarkers = Math.max(8, Math.min(48, Math.floor(trackHeight / 5)))
  const outlineItems = useMemo(
    () => buildOutlineItems(entries, maxMarkers, activeIndex),
    [activeIndex, entries, maxMarkers],
  )
  const activeItemIndex = Math.max(
    0,
    outlineItems.findIndex(
      (item) => activeIndex >= item.startIndex && activeIndex <= item.endIndex,
    ),
  )
  const hoveredItemIndex = outlineItems.findIndex((item) => item.id === hoveredItemId)
  const focusedIndex = hoveredItemIndex >= 0 ? hoveredItemIndex : activeItemIndex
  const markerHeight = Math.max(4, Math.min(14, trackHeight / Math.max(1, outlineItems.length)))

  if (entries.length === 0) return null

  const jumpToItem = (item: ChatMessageOutlineItem) => {
    const entryIndex = Math.floor((item.startIndex + item.endIndex) / 2)
    const entry = entries[entryIndex]
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
      ref={outlineRef}
      aria-label="Conversation outline"
      className="pointer-events-none absolute top-5 right-3 hidden w-14 items-center xl:flex"
      style={{ bottom: bottomOffset }}
    >
      <div
        className="pointer-events-auto flex max-h-full w-full flex-col items-end py-2"
        onMouseLeave={() => setHoveredItemId(null)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setHoveredItemId(null)
        }}
      >
        {outlineItems.map((item, index) => {
          const firstEntry = entries[item.startIndex]
          const lastEntry = entries[item.endIndex]
          const aggregated = item.startIndex !== item.endIndex
          const itemActive = activeIndex >= item.startIndex && activeIndex <= item.endIndex
          const focused = index === focusedIndex
          const distance = Math.abs(index - focusedIndex)
          const scaleX =
            hoveredItemIndex < 0
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
            : hoveredItemIndex >= 0 && distance <= 3
              ? 0.52 - distance * 0.07
              : 0.28
          return (
            <Tooltip key={item.id}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={
                      aggregated
                        ? `Jump to conversation turns ${item.startIndex + 1} through ${item.endIndex + 1}`
                        : `Jump to conversation turn ${item.startIndex + 1}: ${firstEntry.title}`
                    }
                    aria-current={itemActive ? 'location' : undefined}
                    onClick={() => jumpToItem(item)}
                    onMouseEnter={() => setHoveredItemId(item.id)}
                    onFocus={() => setHoveredItemId(item.id)}
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
                    <span>
                      {aggregated
                        ? `TURNS ${String(item.startIndex + 1).padStart(2, '0')}–${String(item.endIndex + 1).padStart(2, '0')}`
                        : `TURN ${String(item.startIndex + 1).padStart(2, '0')}`}
                    </span>
                    {firstEntry.timestamp ? (
                      <span>
                        {formatOutlineTimestamp(firstEntry.timestamp)}
                        {aggregated && lastEntry.timestamp
                          ? `–${formatOutlineTimestamp(lastEntry.timestamp)}`
                          : ''}
                      </span>
                    ) : null}
                  </div>
                  {aggregated ? (
                    <div className="mt-2 flex flex-col gap-2">
                      <p className="text-[12px] leading-4 font-medium text-foreground">
                        {item.endIndex - item.startIndex + 1} conversation turns
                      </p>
                      <OutlineSummaryLine>{firstEntry.title}</OutlineSummaryLine>
                      {lastEntry.id !== firstEntry.id && (
                        <OutlineSummaryLine>{lastEntry.title}</OutlineSummaryLine>
                      )}
                    </div>
                  ) : (
                    <>
                      <p className="mt-2 line-clamp-2 text-[12px] leading-4 font-medium text-foreground">
                        {firstEntry.title}
                      </p>
                      {firstEntry.summary && (
                        <div className="mt-2.5 flex items-start gap-2">
                          <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/45" />
                          <p className="line-clamp-3 text-[11px] leading-4 text-muted-foreground">
                            {firstEntry.summary}
                          </p>
                        </div>
                      )}
                    </>
                  )}
                  {!aggregated && (firstEntry.references?.length || firstEntry.attachmentCount) && (
                    <div className="mt-3 flex flex-col gap-1.5 border-t border-border pt-2.5">
                      {firstEntry.references?.map((reference) => (
                        <div
                          key={reference}
                          className="flex min-w-0 items-center gap-2 text-muted-foreground"
                        >
                          <FileCode2 className="size-3.5 shrink-0" />
                          <span className="truncate font-mono text-[10px]">{reference}</span>
                        </div>
                      ))}
                      {firstEntry.attachmentCount ? (
                        <span className="font-mono text-[9px] text-muted-foreground/65">
                          {firstEntry.attachmentCount} attached{' '}
                          {firstEntry.attachmentCount === 1 ? 'file' : 'files'}
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

function OutlineSummaryLine({ children }: { children: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/45" />
      <p className="line-clamp-1 text-[11px] leading-4 text-muted-foreground">{children}</p>
    </div>
  )
}

function buildOutlineItems(
  entries: ChatMessageOutlineEntry[],
  capacity: number,
  activeIndex: number,
) {
  if (entries.length <= capacity) {
    return entries.map((entry, index) => ({
      id: `entry-${entry.id}`,
      startIndex: index,
      endIndex: index,
    }))
  }

  const localStart = Math.max(0, activeIndex - 2)
  const localEnd = Math.min(entries.length - 1, activeIndex + 2)
  const localCount = localEnd - localStart + 1
  const outerSlots = Math.max(2, capacity - localCount)
  const beforeCount = localStart
  const afterCount = entries.length - localEnd - 1
  const outerCount = beforeCount + afterCount
  let beforeSlots =
    beforeCount === 0
      ? 0
      : afterCount === 0
        ? Math.min(beforeCount, outerSlots)
        : Math.max(1, Math.round((outerSlots * beforeCount) / outerCount))
  let afterSlots = Math.min(afterCount, outerSlots - beforeSlots)

  if (afterCount > 0 && afterSlots === 0) {
    afterSlots = 1
    beforeSlots = Math.max(0, beforeSlots - 1)
  }
  beforeSlots = Math.min(beforeSlots, beforeCount)

  return [
    ...partitionOutlineRange(entries, 0, localStart, beforeSlots),
    ...entries.slice(localStart, localEnd + 1).map((entry, offset) => ({
      id: `entry-${entry.id}`,
      startIndex: localStart + offset,
      endIndex: localStart + offset,
    })),
    ...partitionOutlineRange(entries, localEnd + 1, entries.length, afterSlots),
  ]
}

function partitionOutlineRange(
  entries: ChatMessageOutlineEntry[],
  start: number,
  end: number,
  slots: number,
): ChatMessageOutlineItem[] {
  const length = end - start
  if (length <= 0 || slots <= 0) return []
  const count = Math.min(length, slots)

  return Array.from({ length: count }, (_, index) => {
    const itemStart = start + Math.floor((length * index) / count)
    const itemEnd = start + Math.floor((length * (index + 1)) / count) - 1
    return {
      id:
        itemStart === itemEnd
          ? `entry-${entries[itemStart].id}`
          : `range-${entries[itemStart].id}-${entries[itemEnd].id}`,
      startIndex: itemStart,
      endIndex: itemEnd,
    }
  })
}

function formatOutlineTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

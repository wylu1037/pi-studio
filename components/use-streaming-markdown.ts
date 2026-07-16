'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  StreamingMarkdownAssembler,
  type StreamingMarkdownSnapshot,
} from '@/lib/markdown/streaming-markdown'

type PendingMarkdownDelta = {
  messageId: string
  contentIndex: number
  content: string
}

export type StreamingContentBatch = readonly {
  messageId: string
  content: string
}[]

type UseStreamingMarkdownOptions = {
  onFlushContent: (batch: StreamingContentBatch) => void
  onReplaceContent: (messageId: string, content: string) => void
}

const EMPTY_SNAPSHOTS: Readonly<Record<string, StreamingMarkdownSnapshot>> = Object.freeze({})

export function useStreamingMarkdown({
  onFlushContent,
  onReplaceContent,
}: UseStreamingMarkdownOptions) {
  const assemblersRef = useRef(new Map<string, StreamingMarkdownAssembler>())
  const pendingDeltasRef = useRef<PendingMarkdownDelta[]>([])
  const animationFrameRef = useRef<number | null>(null)
  const onFlushContentRef = useRef(onFlushContent)
  const onReplaceContentRef = useRef(onReplaceContent)
  const [snapshots, setSnapshots] = useState(EMPTY_SNAPSHOTS)

  useEffect(() => {
    onFlushContentRef.current = onFlushContent
  }, [onFlushContent])

  useEffect(() => {
    onReplaceContentRef.current = onReplaceContent
  }, [onReplaceContent])

  const ensureAssembler = useCallback((messageId: string) => {
    const existing = assemblersRef.current.get(messageId)
    if (existing) return existing
    const assembler = new StreamingMarkdownAssembler({ idPrefix: messageId })
    assemblersRef.current.set(messageId, assembler)
    return assembler
  }, [])

  const commitSnapshots = useCallback((changed: ReadonlyMap<string, StreamingMarkdownSnapshot>) => {
    if (changed.size === 0) return
    setSnapshots((current) => {
      const next = { ...current }
      for (const [messageId, snapshot] of changed) next[messageId] = snapshot
      return next
    })
  }, [])

  const flush = useCallback(
    (onlyMessageId?: string) => {
      const pending = pendingDeltasRef.current
      if (pending.length === 0) return

      const selected: PendingMarkdownDelta[] = []
      const remaining: PendingMarkdownDelta[] = []
      for (const delta of pending) {
        if (!onlyMessageId || delta.messageId === onlyMessageId) selected.push(delta)
        else remaining.push(delta)
      }
      if (selected.length === 0) return
      pendingDeltasRef.current = remaining

      if (remaining.length === 0 && animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }

      const changed = new Map<string, StreamingMarkdownSnapshot>()
      const contentByMessage = new Map<string, string>()
      for (const delta of selected) {
        const assembler = ensureAssembler(delta.messageId)
        assembler.append(delta.content, delta.contentIndex)
        changed.set(delta.messageId, assembler.snapshot)
        contentByMessage.set(
          delta.messageId,
          (contentByMessage.get(delta.messageId) ?? '') + delta.content,
        )
      }

      onFlushContentRef.current(
        [...contentByMessage].map(([messageId, content]) => ({ messageId, content })),
      )
      commitSnapshots(changed)
    },
    [commitSnapshots, ensureAssembler],
  )

  const scheduleFlush = useCallback(() => {
    if (animationFrameRef.current !== null) return
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null
      flush()
    })
  }, [flush])

  const beginMessage = useCallback(
    (messageId: string) => {
      ensureAssembler(messageId)
    },
    [ensureAssembler],
  )

  const appendDelta = useCallback(
    (messageId: string, contentIndex: number, content: string) => {
      if (!content) return
      ensureAssembler(messageId)
      pendingDeltasRef.current.push({ messageId, contentIndex, content })
      scheduleFlush()
    },
    [ensureAssembler, scheduleFlush],
  )

  const sealTextSegment = useCallback(
    (messageId: string, contentIndex: number, content?: string) => {
      flush(messageId)
      const assembler = ensureAssembler(messageId)
      const segment = assembler.segments.find((candidate) => candidate.id === String(contentIndex))
      if (!segment) {
        assembler.beginTextSegment(contentIndex)
        if (content) assembler.append(content)
      }
      if (assembler.activeSegment?.id === String(contentIndex)) {
        assembler.sealTextSegment(content)
        onReplaceContentRef.current(
          messageId,
          assembler.segments.map((candidate) => candidate.content).join(''),
        )
        commitSnapshots(new Map([[messageId, assembler.snapshot]]))
      }
    },
    [commitSnapshots, ensureAssembler, flush],
  )

  const finishMessage = useCallback(
    (messageId: string) => {
      flush(messageId)
      const assembler = ensureAssembler(messageId)
      assembler.finish()
      commitSnapshots(new Map([[messageId, assembler.snapshot]]))
    },
    [commitSnapshots, ensureAssembler, flush],
  )

  const finishAll = useCallback(() => {
    flush()
    const changed = new Map<string, StreamingMarkdownSnapshot>()
    for (const [messageId, assembler] of assemblersRef.current) {
      assembler.finish()
      changed.set(messageId, assembler.snapshot)
    }
    commitSnapshots(changed)
  }, [commitSnapshots, flush])

  const reset = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    pendingDeltasRef.current = []
    assemblersRef.current.clear()
    setSnapshots(EMPTY_SNAPSHOTS)
  }, [])

  useEffect(
    () => () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
      }
    },
    [],
  )

  return {
    snapshots,
    beginMessage,
    appendDelta,
    sealTextSegment,
    finishMessage,
    finishAll,
    flush,
    reset,
  }
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  SessionEventStream,
  type RunStreamFrame,
  type SessionEventStreamStatus,
} from '@/lib/chat/session-event-stream'

export interface SessionEventStreamCallbacks {
  onFrame: (frame: RunStreamFrame) => void
}

/**
 * Thin React adapter over SessionEventStream: one self-healing connection per
 * active session. Callbacks are read through a ref, so a new callback identity
 * never tears the connection down — only a session change (or unmount) does.
 */
export function useSessionEventStream(
  sessionId: string | undefined,
  callbacks: SessionEventStreamCallbacks,
) {
  const [status, setStatus] = useState<SessionEventStreamStatus>('disposed')
  const streamRef = useRef<SessionEventStream | null>(null)
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks

  useEffect(() => {
    if (!sessionId) {
      setStatus('disposed')
      return
    }
    const stream = new SessionEventStream(sessionId, {
      onFrame: (frame) => callbacksRef.current.onFrame(frame),
      onStatusChange: setStatus,
    })
    streamRef.current = stream
    setStatus(stream.currentStatus)
    return () => {
      if (streamRef.current === stream) streamRef.current = null
      stream.dispose()
    }
  }, [sessionId])

  const reconnect = useCallback(() => streamRef.current?.reconnect(), [])
  const ensureConnected = useCallback(() => streamRef.current?.ensureConnected(), [])

  return { status, reconnect, ensureConnected }
}

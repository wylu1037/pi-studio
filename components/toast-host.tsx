'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, X } from 'lucide-react'
import { Label } from '@/components/pi-ui'
import { errorMessage, takePendingToast, TOAST_EVENT, type ToastPayload } from '@/lib/toast'

type ToastItem = ToastPayload & { id: number }

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(0)

  useEffect(() => {
    const add = (payload: ToastPayload) => {
      const item = { ...payload, id: ++nextId.current }
      setItems((current) => [...current.slice(-2), item])
      window.setTimeout(
        () => {
          setItems((current) => current.filter((entry) => entry.id !== item.id))
        },
        payload.tone === 'error' ? 7000 : 4000,
      )
    }
    const pending = takePendingToast()
    if (pending) add(pending)
    const onToast = (event: Event) => add((event as CustomEvent<ToastPayload>).detail)
    const onRejection = (event: PromiseRejectionEvent) => {
      event.preventDefault()
      add({
        tone: 'error',
        title: 'Save failed',
        message: errorMessage(event.reason),
      })
    }
    window.addEventListener(TOAST_EVENT, onToast)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  if (items.length === 0) return null
  return (
    <div className="pointer-events-none fixed right-5 bottom-5 z-70 flex w-[min(380px,calc(100vw-40px))] flex-col gap-2">
      {items.map((item) => (
        <div
          key={item.id}
          role="status"
          className="pointer-events-auto flex items-start gap-3 border border-border-strong bg-card px-4 py-3 shadow-xl"
        >
          {item.tone === 'success' ? (
            <Check className="mt-0.5 size-4 shrink-0 text-success" />
          ) : (
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          )}
          <div className="min-w-0 flex-1">
            <Label>{item.title ?? (item.tone === 'success' ? 'Saved' : 'Save failed')}</Label>
            <p className="scrollbar-thin mt-1 max-h-28 overflow-auto text-sm leading-relaxed wrap-break-word text-foreground">
              {item.message}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Dismiss notification"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  )
}

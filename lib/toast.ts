export type ToastTone = 'success' | 'error' | 'info' | 'warning'

export type ToastPayload = {
  tone: ToastTone
  title?: string
  message: string
}

export const TOAST_EVENT = 'pi-studio:toast'
const PENDING_TOAST_KEY = 'pi-studio:pending-toast'

export function showToast(payload: ToastPayload) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<ToastPayload>(TOAST_EVENT, { detail: payload }))
}

export function queueToastAfterReload(payload: ToastPayload) {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(PENDING_TOAST_KEY, JSON.stringify(payload))
}

export function takePendingToast(): ToastPayload | null {
  if (typeof window === 'undefined') return null
  const value = window.sessionStorage.getItem(PENDING_TOAST_KEY)
  if (!value) return null
  window.sessionStorage.removeItem(PENDING_TOAST_KEY)
  try {
    return JSON.parse(value) as ToastPayload
  } catch {
    return null
  }
}

export function errorMessage(error: unknown, fallback = 'Unable to save changes.') {
  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof error.response === 'object' &&
    error.response !== null &&
    'data' in error.response &&
    typeof error.response.data === 'object' &&
    error.response.data !== null &&
    'error' in error.response.data &&
    typeof error.response.data.error === 'string'
  ) {
    return error.response.data.error
  }
  return error instanceof Error ? error.message : fallback
}

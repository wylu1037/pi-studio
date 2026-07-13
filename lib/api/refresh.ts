import { queueToastAfterReload } from '@/lib/toast'

export function refreshAfterMutation(message = 'Changes saved successfully.') {
  queueToastAfterReload({ tone: 'success', title: 'Saved', message })
  window.location.reload()
}

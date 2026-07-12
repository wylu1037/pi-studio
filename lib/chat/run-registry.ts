type AbortHandler = () => void | Promise<void>

const runs = new Map<string, AbortHandler>()

export function registerRun(id: string, abort: AbortHandler) {
  runs.set(id, abort)
}

export function unregisterRun(id: string) {
  runs.delete(id)
}

export function abortRun(id: string) {
  const abort = runs.get(id)
  if (!abort) return false
  runs.delete(id)
  void abort()
  return true
}

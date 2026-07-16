type AbortHandler = () => void | Promise<void>

type RunControl = {
  abort?: AbortHandler
  abortRequested: boolean
}

const runs = new Map<string, RunControl>()

export function prepareRun(id: string) {
  if (!runs.has(id)) runs.set(id, { abortRequested: false })
}

export function registerRun(id: string, abort: AbortHandler) {
  const control = runs.get(id) ?? { abortRequested: false }
  control.abort = abort
  runs.set(id, control)
  if (control.abortRequested) void abort()
}

export function unregisterRun(id: string) {
  runs.delete(id)
}

export function abortRun(id: string) {
  const control = runs.get(id) ?? { abortRequested: false }
  if (control.abortRequested) return false
  control.abortRequested = true
  runs.set(id, control)
  if (control.abort) void control.abort()
  return true
}

export function isRunAbortRequested(id: string) {
  return runs.get(id)?.abortRequested ?? false
}

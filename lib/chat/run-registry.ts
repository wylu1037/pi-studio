import type { ChildProcessWithoutNullStreams } from 'node:child_process'

const runs = new Map<string, ChildProcessWithoutNullStreams>()

export function registerRun(id: string, child: ChildProcessWithoutNullStreams) {
  runs.set(id, child)
  child.once('close', () => runs.delete(id))
}

export function abortRun(id: string) {
  const child = runs.get(id)
  if (!child) return false
  child.kill('SIGTERM')
  runs.delete(id)
  return true
}

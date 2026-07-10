import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { registerRun } from './run-registry'

export interface PiRunInput {
  runId: string
  sessionId: string
  sessionDir: string
  cwd: string
  prompt: string
  provider?: string
  model?: string
  thinkingLevel?: string
  skills: string[]
  prompts: string[]
}

export type PiRunEvent =
  | { type: 'message_delta'; content: string }
  | { type: 'tool_call_delta'; content: string }
  | { type: 'bash_output'; stream: 'stdout' | 'stderr'; content: string }
  | { type: 'error'; message: string }
  | { type: 'done'; exitCode: number | null }

export async function* runPiCli(input: PiRunInput): AsyncGenerator<PiRunEvent> {
  mkdirSync(input.sessionDir, { recursive: true })
  const args = [
    '--mode',
    'json',
    '--print',
    '--session-id',
    input.sessionId,
    '--session-dir',
    input.sessionDir,
  ]

  if (input.provider) args.push('--provider', input.provider)
  if (input.model) args.push('--model', input.model)
  if (input.thinkingLevel) args.push('--thinking', input.thinkingLevel)
  for (const skill of input.skills) args.push('--skill', skill)
  for (const prompt of input.prompts) args.push('--prompt-template', prompt)
  args.push(input.prompt)

  const child = spawn('pi', args, {
    cwd: existsSync(input.cwd) ? input.cwd : process.cwd(),
    env: {
      ...process.env,
      PI_CODING_AGENT_SESSION_DIR: input.sessionDir,
    },
  })
  registerRun(input.runId, child)

  const queue: PiRunEvent[] = []
  let done = false
  let wake: (() => void) | null = null
  const notify = () => {
    wake?.()
    wake = null
  }
  const push = (event: PiRunEvent) => {
    queue.push(event)
    notify()
  }

  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')

  child.stdout.on('data', (chunk: string) => {
    for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
      const parsed = parsePiJsonLine(line)
      push(parsed ?? { type: 'message_delta', content: `${line}\n` })
    }
  })
  child.stderr.on('data', (chunk: string) => {
    push({ type: 'bash_output', stream: 'stderr', content: chunk })
  })
  child.on('error', (error) => {
    push({ type: 'error', message: error.message })
  })
  child.on('close', (exitCode) => {
    push({ type: 'done', exitCode })
    done = true
    notify()
  })

  while (!done || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>((resolve) => {
        wake = resolve
      })
    }
    while (queue.length > 0) {
      const event = queue.shift()
      if (event) yield event
    }
  }
}

function parsePiJsonLine(line: string): PiRunEvent | null {
  try {
    const payload = JSON.parse(line) as Record<string, unknown>
    const type = String(payload.type ?? payload.event ?? '')
    const content = String(payload.content ?? payload.text ?? payload.delta ?? '')
    if (type.includes('tool')) return { type: 'tool_call_delta', content: content || line }
    if (type.includes('error')) return { type: 'error', message: content || line }
    return { type: 'message_delta', content: content || `${line}\n` }
  } catch {
    return null
  }
}

export function defaultPiSessionDir() {
  return join(process.cwd(), 'data', 'pi-sessions')
}

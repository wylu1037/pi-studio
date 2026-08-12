/**
 * Repro: edit a user message without changing the text, resubmit.
 *
 * Simulates the server side of resubmitEditedUserMessage with the real SDK
 * SessionManager to answer one question: after the run completes and the page
 * re-opens the session file, how many copies of the edited user message does
 * the leaf-path context contain?
 *
 * Scenario A — navigate applied (branch(U2.parent) before the new prompt).
 * Scenario B — navigate lost (new prompt appended linearly at the old leaf).
 * Scenario C — the fix: session rebuilt (reopen resets the in-memory leaf to
 *              the file tail), then the branch anchor is re-applied right
 *              before the prompt (what startSessionPrompt now does).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionManager, buildSessionContext } from '@earendil-works/pi-coding-agent'

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        block && typeof block === 'object' && 'text' in block ? String(block.text) : '',
      )
      .join('')
  }
  return ''
}

function user(text: string) {
  return {
    role: 'user' as const,
    content: [{ type: 'text' as const, text }],
    timestamp: Date.now(),
  }
}

function assistant(text: string) {
  return {
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text }],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'test',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop' as const,
    timestamp: Date.now(),
  }
}

function runScenario(name: string, mode: 'branch' | 'linear' | 'rebuild-then-branch') {
  const dir = mkdtempSync(join(tmpdir(), 'pi-repro-'))
  try {
    let sm = SessionManager.create(process.cwd(), dir)
    sm.appendMessage(user('first question'))
    sm.appendMessage(assistant('first answer'))
    const u2Id = sm.appendMessage(user('edited question'))
    sm.appendMessage(assistant('second answer'))

    const parentId = sm.getEntry(u2Id)!.parentId!
    if (mode === 'branch') sm.branch(parentId) // what navigateTree does for a non-user target
    if (mode === 'rebuild-then-branch') {
      // /navigate moved the in-memory leaf...
      sm.branch(parentId)
      // ...but the SDK session got rebuilt before the run: reopening the file
      // resets the leaf to the file tail, losing the navigation.
      sm = SessionManager.open(sm.getSessionFile()!, dir)
      // The fix: startSessionPrompt re-applies the anchor just before prompt().
      sm.branch(parentId)
    }

    // The resubmitted prompt (same text) + its reply, appended by the run.
    sm.appendMessage(user('edited question'))
    sm.appendMessage(assistant('new answer'))

    // What the page render does afterwards: re-open the file, build the
    // context from the manager's leaf.
    const reopened = SessionManager.open(sm.getSessionFile()!, dir)
    const context = buildSessionContext(reopened.getEntries(), reopened.getLeafId())
    const users = context.messages
      .filter((message) => message.role === 'user')
      .map((message) => textOf(message.content))
    const editedCopies = users.filter((text) => text === 'edited question').length

    console.log(`\n=== ${name} ===`)
    console.log(`reopened leafId:            ${reopened.getLeafId()}`)
    console.log(`context messages (roles):   ${context.messages.map((m) => m.role).join(', ')}`)
    console.log(`user messages:              ${JSON.stringify(users)}`)
    console.log(`copies of edited question:  ${editedCopies}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

runScenario('A: branch(parent) applied before resubmit (navigate worked)', 'branch')
runScenario('B: no branch — resubmit appended at old leaf (navigate lost)', 'linear')
runScenario(
  'C: fix — rebuild resets the leaf, anchor re-applied before prompt',
  'rebuild-then-branch',
)

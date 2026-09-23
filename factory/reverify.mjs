// factory/reverify.mjs — which adopted tasks' measurements a fold puts back
// in play: every one of them.
//
// `factory/engine.mjs` folds one candidate at a time and, with
// `policy.fold.reverify.enabled` true, re-runs — right after that fold — the
// probes and selected tests of the folded task and of EVERY adopted sibling,
// not only the siblings whose `files` overlap the fold. The overlap rule was
// run-225's seam (2026-09-22): task 2's boot sim pinned how a sibling's
// `record.mjs` rendered a cell, the two tasks shared no file, the fold check
// skipped the sim, and the merged tree was red by hand. A probe reads what
// it reads, not only what its task wrote, so the folded tree is green only
// when every adopted probe is green on it. `proofsAdopted` is that reading,
// kept pure and separate from the engine so it stands as one small answer a
// caller can check with no clone, no `sh`, and no fold at all.

/**
 * The adopted tasks whose measurement belongs on the folded tree: `folded`
 * itself first, then the rest of `adopted` in their own (adoption) order,
 * filtered to a task that qualifies — its own `proofRuns` is non-empty, or
 * `selected[task.id]` (the `{ [taskId]: [paths] }` map of each landing's own
 * selected tests) is a non-empty array — and capped at `cap` entries overall.
 * No path overlap is asked: a sibling's probe may read what the fold changed
 * without its task owning the file.
 */
export function proofsAdopted ({ folded, adopted, tasks, selected, cap }) {
  const byId = new Map((tasks || []).map((t) => [String(t.id), t]))
  const foldedId = String(folded)
  const selectedMap = selected || {}

  const selectedFor = (id) => {
    const direct = selectedMap[id]
    if (Array.isArray(direct)) return direct
    const byString = selectedMap[String(id)]
    return Array.isArray(byString) ? byString : []
  }

  const qualifies = (task) => {
    if (!task) return false
    const hasProofRuns = Array.isArray(task.proofRuns) && task.proofRuns.length > 0
    const hasSelected = selectedFor(task.id).length > 0
    return hasProofRuns || hasSelected
  }

  const orderedIds = [foldedId, ...(adopted || []).map(String).filter((id) => id !== foldedId)]
  const limit = Number.isInteger(cap) ? cap : Infinity

  const out = []
  for (const id of orderedIds) {
    if (out.length >= limit) break
    const task = byId.get(id)
    if (qualifies(task)) out.push(task)
  }
  return out
}

/** The last 2000 characters of a red's captured output — what stands as its
 * "assertion" for the hand-off fact. */
function assertionOf (red) {
  const out = typeof red.out === 'string' ? red.out : ''
  return out.slice(-2000)
}

/** `{ probe, test, cmd }` per red kind — a probe red carries its owning
 *  task's id as `probe`, a test red carries its path as `test`, a check red
 *  carries its `cmd`; the other two of the three are `null`. */
function subjectOf (red) {
  if (red.kind === 'probe') return { probe: red.id, test: null, cmd: null }
  if (red.kind === 'test') return { probe: null, test: red.path, cmd: null }
  return { probe: null, test: null, cmd: red.cmd }
}

function factFor (assertions, hunks) {
  const lines = ['FOLD RED', '']
  lines.push('Assertions:')
  for (const a of assertions) lines.push(a)
  lines.push('')
  lines.push('Fold hunks:')
  lines.push(hunks)
  return lines.join('\n')
}

/**
 * One round on a fold's reds: attribute each to its owner and cause, read
 * `green_before` for a sibling red under `enabled`, collapse the outcome to
 * one re-attempt per task (always `{ role: 'implement', task }` — the owner
 * for `own`/`sibling`, the folded task for `check`), run that round once,
 * and verify. See the task's Machine clauses for the exact shape; this
 * function touches nothing but its arguments — no `fs`, no `sh`, no clone.
 */
export async function foldRound ({ reds, folded, headBefore, head, enabled, hunks, runProofsAt, appendEvent, reattempt, verify }) {
  const on = enabled === true
  const actionOrder = []
  const actionsByKey = new Map()

  const noteAction = (task, assertion) => {
    const key = 'implement|' + task
    let entry = actionsByKey.get(key)
    if (!entry) {
      entry = { task, assertions: [] }
      actionsByKey.set(key, entry)
      actionOrder.push(key)
    }
    entry.assertions.push(assertion)
  }

  for (const red of reds) {
    const { probe, test, cmd } = subjectOf(red)
    let owner = null
    let cause = 'check'
    if (red.kind === 'probe' || red.kind === 'test') {
      if (String(red.id) === String(folded)) { owner = folded; cause = 'own' } else { owner = red.id; cause = 'sibling' }
    }

    let greenBefore = null
    if (on && cause === 'sibling') {
      try {
        const exit = await runProofsAt(red.id, headBefore)
        greenBefore = exit === 0
      } catch {
        greenBefore = null
      }
    }

    const assertion = assertionOf(red)
    const reattemptTask = cause === 'check' ? folded : owner
    const reattemptFor = { role: 'implement', task: reattemptTask }

    const row = {
      kind: 'fold:red',
      task: folded,
      fold: folded,
      head_before: headBefore,
      head,
      exit: red.exit,
      probe,
      test,
      cmd,
      owner,
      cause,
      green_before: greenBefore,
      reattempt: reattemptFor,
    }

    appendEvent(row)
    noteAction(reattemptFor.task, assertion)
  }

  const actions = actionOrder.map((key) => {
    const entry = actionsByKey.get(key)
    return { role: 'implement', task: entry.task, fact: factFor(entry.assertions, hunks) }
  })

  const appendUnresolved = (list) => {
    for (const red of list) {
      const { probe, test, cmd } = subjectOf(red)
      appendEvent({ kind: 'fold:unresolved', task: folded, probe, test, cmd })
    }
  }

  for (const action of actions) {
    let ok
    try {
      ok = await reattempt(action)
    } catch {
      ok = false
    }
    if (ok !== true) {
      appendUnresolved(reds)
      return { unresolved: true, actions }
    }
  }

  let verifyAnswer = null
  try {
    verifyAnswer = await verify()
  } catch {
    verifyAnswer = null
  }
  if (!verifyAnswer) {
    appendUnresolved(reds)
    return { unresolved: true, actions }
  }

  appendEvent({ kind: 'fold:verify', task: folded, ran: verifyAnswer.ran, attempt: 2 })
  const remaining = verifyAnswer.reds || []
  appendUnresolved(remaining)
  return { unresolved: remaining.length > 0, actions }
}

export default { proofsAdopted, foldRound }

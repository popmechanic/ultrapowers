// factory/reverify.mjs — which adopted exams a fold's own touched paths put
// back in play.
//
// `factory/engine.mjs` folds one candidate at a time and, with
// `policy.fold.reverify.enabled` true, wants to know — right after that fold
// — which already-adopted tasks have a stake in the paths the fold just
// touched: the folded task's own exam always, plus any sibling whose `files`
// overlap. `examsTouched` is that reading, kept pure and separate from the
// engine so M1 stands as one small answer a caller can check with no clone,
// no `sh`, and no fold at all.

/**
 * The adopted tasks whose exam belongs on the folded tree: `folded` itself
 * first, then the rest of `adopted` in their own (adoption) order, filtered
 * to a task that both shares at least one path with `touched` and carries a
 * non-empty string `testCmd` — a task with nothing to run is not an exam —
 * and capped at `cap` entries overall.
 */
export function examsTouched ({ folded, touched, adopted, tasks, cap }) {
  const byId = new Map((tasks || []).map((t) => [String(t.id), t]))
  const touchedSet = new Set(touched || [])
  const foldedId = String(folded)

  const qualifies = (task) => {
    if (!task) return false
    if (typeof task.testCmd !== 'string' || task.testCmd.trim() === '') return false
    return (task.files || []).some((f) => touchedSet.has(f))
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
 * "assertion" for judging and for the hand-off fact. */
function assertionOf (red) {
  const out = typeof red.out === 'string' ? red.out : ''
  return out.slice(-2000)
}

/** `{ exam, cmd }` per red kind — an exam red carries its id as `exam` with
 * `cmd: null`, a check red carries its `cmd` with `exam: null`. */
function subjectOf (red) {
  return red.kind === 'exam' ? { exam: red.id, cmd: null } : { exam: null, cmd: red.cmd }
}

function factFor (role, assertions, hunks) {
  const lines = [role === 'exam' ? 'FOLD EXAM-DEFECT' : 'FOLD RED', '']
  if (role === 'exam') {
    lines.push(
      'The fold widened a shape this exam checks against; the row now ' +
      'carries these keys the exam did not expect before. Judge whether ' +
      'the exam itself needs to widen — this is not an implementation defect.'
    )
    lines.push('')
  }
  lines.push('Assertions:')
  for (const a of assertions) lines.push(a)
  lines.push('')
  lines.push('Fold hunks:')
  lines.push(hunks)
  return lines.join('\n')
}

/**
 * One round on a fold's reds: attribute each to its owner and cause, judge
 * the sibling reds whose exam was green before the fold, collapse the
 * outcome to one re-attempt per (role, task), run that round once, and
 * verify. See the task's Machine clauses for the exact shape; this function
 * touches nothing but its arguments — no `fs`, no `sh`, no clone.
 */
export async function foldRound ({ reds, folded, headBefore, head, enabled, hunks, runExamAt, read, appendEvent, reattempt, verify }) {
  const on = enabled === true
  const actionOrder = []
  const actionsByKey = new Map()

  const noteAction = (role, task, assertion) => {
    const key = role + '|' + task
    let entry = actionsByKey.get(key)
    if (!entry) {
      entry = { role, task, assertions: [] }
      actionsByKey.set(key, entry)
      actionOrder.push(key)
    }
    entry.assertions.push(assertion)
  }

  for (const red of reds) {
    const { exam, cmd } = subjectOf(red)
    let owner = null
    let cause = 'check'
    if (red.kind === 'exam') {
      if (String(red.id) === String(folded)) { owner = folded; cause = 'own' } else { owner = red.id; cause = 'sibling' }
    }

    let greenBefore = null
    if (on && cause === 'sibling') {
      try {
        const exit = await runExamAt(red.id, headBefore)
        greenBefore = exit === 0
      } catch {
        greenBefore = null
      }
    }

    const assertion = assertionOf(red)
    let kind = 'fold:red'
    let reattemptFor = { role: 'implement', task: folded }
    let score

    if (!on) {
      reattemptFor = { role: 'implement', task: folded }
    } else if (cause !== 'sibling') {
      reattemptFor = { role: 'implement', task: folded }
    } else if (greenBefore === true) {
      let answer = null
      try {
        answer = await read('readFoldRed', { assertion, hunks, who: { task: owner, label: 'fold:' + folded } })
      } catch {
        answer = null
      }
      if (answer && answer.examDefect === true) {
        kind = 'fold:exam-defect'
        score = answer.score
        reattemptFor = { role: 'exam', task: owner }
      } else {
        reattemptFor = { role: 'implement', task: owner }
      }
    } else {
      reattemptFor = { role: 'implement', task: owner }
    }

    const row = {
      kind,
      task: folded,
      fold: folded,
      head_before: headBefore,
      head,
      exit: red.exit,
      exam,
      cmd,
      owner,
      cause,
      green_before: greenBefore,
      reattempt: reattemptFor
    }
    if (score !== undefined) row.score = score

    appendEvent(row)
    noteAction(reattemptFor.role, reattemptFor.task, assertion)
  }

  const actions = actionOrder.map((key) => {
    const entry = actionsByKey.get(key)
    return { role: entry.role, task: entry.task, fact: factFor(entry.role, entry.assertions, hunks) }
  })

  const appendUnresolved = (list) => {
    for (const red of list) {
      const { exam, cmd } = subjectOf(red)
      appendEvent({ kind: 'fold:unresolved', task: folded, exam, cmd })
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

export default { examsTouched, foldRound }

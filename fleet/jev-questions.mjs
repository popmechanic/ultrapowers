// fleet/jev-questions.mjs — the sitting's question sets, and the two readers
// that put them to the engine's Jev client.
//
// The questions are `jev_notes.py`'s, copied verbatim: the calibration of
// #1095's reading was made against these exact strings, so a reworded question
// is a different question and its numbers mean something else. Both sets are
// frozen for that reason — a caller that mutated one would silently move every
// reading the run records.
//
// The two readers are functions OVER a client, not clients: `readNote(jev, …)`
// and `readAmendment(jev, …)` take `{ ask }` (`fleet/jev-client.mjs`'s
// `makeJevClient`) as their first argument, so the engine hands them the `jev`
// it was handed and these stay pure — no file, no socket, no environment, no
// credential. The edge injects the bearer; nothing here knows one exists.
//
// What comes back is FLATTENED on purpose. The attention rule, the plan-defect
// mirror and the census want numbers and one word, not answer objects: a row
// carrying `{type:'noul', noul:0.96}` would make every consumer unpack it. The
// `kind` answer rides out as `note_kind`, because `kind` is every event's own
// type field.
//
// Jev answers no fact. A call that does not answer — a `null` from the client,
// a throw, a reply missing an answer the caller asked for — is one `jev:` log
// line and a `null` return, and the note or amendment simply carries no
// reading. Neither reader ever throws.

/** The ceiling on a note's text, cut before the call. Well under the client's
 *  own `JEV_STATE_MAX_BYTES`, so a note never trips that budget on its body
 *  alone. */
export const NOTE_MAX_CHARS = 20000

/** The one sentence of context every note question carries, verbatim from the
 *  sitting. */
const CTX = 'A worker (an implementer, examiner or fix session) on a fleet ' +
  "task posted this note on the task's issue while working. The task's Claim " +
  'is given.'

/**
 * The four questions of a note, plus the one score (#1095 proposal 1).
 *
 * Keys, in order: `stuck`, `plan_defect`, `divergence`, `kind`,
 * `operator_should_read`.
 */
export const NOTE_QUESTIONS = Object.freeze({
  stuck: {
    type: 'noul',
    instructions: {
      question: 'Does `note` say the worker cannot proceed, is blocked, or needs a person to decide something?',
      context: CTX,
    },
    criteria: {
      true: 'It reports a blocker, a question it cannot settle, or asks for a human',
      false: 'It reports progress, an approach, or a hand-in',
    },
  },
  plan_defect: {
    type: 'noul',
    instructions: {
      question: 'Does `note` say the task text itself is wrong: a clause, leg, path or literal that is contradictory, absent at base, or impossible to satisfy?',
      context: CTX,
    },
    criteria: {
      true: 'It names a defect in the task text or proof, not in its own work',
      false: 'It does not fault the task text',
    },
  },
  divergence: {
    type: 'noul',
    instructions: {
      question: 'Does `note` disclose that the worker did something the task text did not ask for or forbade: an edit outside its Files, a changed clause, a substituted approach?',
      context: CTX,
    },
    criteria: {
      true: 'It discloses a divergence from the task as written',
      false: 'It stays within the task as written, or says nothing about scope',
    },
  },
  kind: {
    type: 'choice',
    instructions: {
      question: 'What kind of note is `note`?',
      context: CTX,
    },
    criteria: {
      approach: 'A plan of attack before or at the start of work',
      progress: 'A mid-work status with no decision needed',
      handin: 'A completion report: what landed, its commit, its evidence',
      blocker: 'A problem that stops the work',
      disclosure: 'An explanation of a divergence or a judgment call already made',
      reading: "An examiner's reading of the legs or the base before writing",
      other: 'None of these',
    },
  },
  operator_should_read: {
    type: 'score',
    instructions: {
      question: 'Should the operator, who never reads code, be shown `note`?',
      context: CTX,
    },
    // The `score` criteria are arrays of `{what}` objects, exactly as the
    // sitting sent them — the rungs are ordered, and the index is the score.
    criteria: [
      { what: 'No: routine narration' },
      { what: 'Maybe: a judgment call worth knowing after the run' },
      { what: 'Yes, after the run: a decision or divergence that affects the plan' },
      { what: 'Yes, now: the worker needs a person' },
    ],
  },
})

/**
 * The three questions of a declared amendment (#1095 proposal 3). These carry
 * their `instructions` as a plain string, not an object: the amendment already
 * arrives with its own `why`, so the sitting put no separate context on them.
 *
 * Keys, in order: `compelled`, `plan_fault`, `magnitude`.
 */
export const AMENDMENT_QUESTIONS = Object.freeze({
  compelled: {
    type: 'noul',
    instructions: 'Does `amendment.why` show the change was forced: the task as written could not pass its own proof, contradicted the base, or contradicted a sibling?',
    criteria: {
      true: 'No implementation of the task as written could have merged',
      false: 'The worker preferred a different shape; the task as written was passable',
    },
  },
  plan_fault: {
    type: 'noul',
    instructions: 'Is the root cause in `amendment` a defect in the task text that its author should have caught, rather than a fact only visible while implementing?',
    criteria: {
      true: 'A careful author reading the base would have written it right',
      false: 'It only became visible in the tree, or it is a preference',
    },
  },
  magnitude: {
    type: 'score',
    instructions: 'How far does `amendment.what` move the task from what was signed?',
    criteria: [
      { what: 'Cosmetic: a path spelling, a line number, a comment' },
      { what: 'Local: one clause or one extra file, same intent' },
      { what: "Substantive: a clause's meaning, a leg dropped or changed" },
      { what: 'Reframed: the task now does something else' },
    ],
  },
})

/** A literal for a regular expression, so an id of `1.2` matches `1.2` alone. */
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The task's own `**Claim:**` line, read off the plan text.
 *
 * The compiled task carries `id` and `title` and no Claim, so the Claim comes
 * from the plan the engine already opens for its H1. Returns the text after
 * `**Claim:**` on the FIRST such line of the `### Task <id>:` section —
 * trimmed, provenance tag included — and `''` when the plan has no such
 * section, or the section has no such line.
 *
 * The section ends at the next heading of level 3 or shallower, so a Claim
 * belonging to the next task is never read as this one's.
 */
export const taskClaimOf = (planText, id) => {
  const text = String(planText == null ? '' : planText)
  const lines = text.split('\n')
  const heading = new RegExp('^###[ \\t]+Task[ \\t]+' + escapeRegex(id) + '[ \\t]*:')
  let i = lines.findIndex((line) => heading.test(line))
  if (i < 0) return ''
  for (i += 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^#{1,3}[ \t]/.test(line)) return ''
    const claim = /^[ \t]*\*\*Claim:\*\*(.*)$/.exec(line)
    if (claim) return claim[1].trim()
  }
  return ''
}

/** A number that is actually a number — `noul` and `score` both. */
const numberOr = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** One line, one `null`: the single exit every lane that did not answer takes,
 *  so no lane logs twice and none logs nothing. */
const refuse = (log, detail) => {
  try { log('jev: ' + detail) } catch { /* evidence, not control flow */ }
  return null
}

/**
 * One call through a client, or `null`.
 *
 * `read` maps the answers object to the flat row the callers want, and returns
 * `undefined` when any answer it needs is missing or the wrong shape — which
 * is a `null` and one log line, exactly like a call that never answered.
 */
const askOnce = async (jev, what, state, questions, log, read) => {
  // A run with no `jev` is a run that asks nothing: no call, no log line, no
  // row. This is the lane every engine takes when the boot set no base URL.
  if (jev == null) return null
  if (typeof jev.ask !== 'function') return refuse(log, what + ': client has no ask()')
  let answers
  try {
    answers = await jev.ask({ state, questions })
  } catch (e) {
    return refuse(log, what + ': ask threw: ' + String((e && e.message) || e).slice(0, 200))
  }
  // The client already logged its own line on the way to a `null`; this one
  // says which reading went without, which is the line the caller's row needs.
  if (answers == null || typeof answers !== 'object') return refuse(log, what + ': no answers')
  const row = read(answers)
  if (row === undefined) return refuse(log, what + ': answers incomplete')
  return row
}

/**
 * Read a worker's note.
 *
 * `readNote(jev, { title, claim, role, note }, log)` puts `NOTE_QUESTIONS` to
 * `jev` once, with the sitting's exact state shape — `role` is one of `impl`,
 * `exam`, `fix`, and `note` is cut to `NOTE_MAX_CHARS` characters — and
 * resolves `{ stuck, plan_defect, divergence, note_kind, operator_should_read }`
 * or `null`. `log` is optional and defaults to a no-op, so the reader never
 * writes to a console of its own; the engine hands its own.
 */
export const readNote = async (jev, { title, claim, role, note } = {}, log = () => {}) => {
  const state = {
    task: { title, claim },
    note: String(note == null ? '' : note).slice(0, NOTE_MAX_CHARS),
    role,
  }
  return askOnce(jev, 'note', state, NOTE_QUESTIONS, log, (answers) => {
    const stuck = numberOr(answers.stuck && answers.stuck.noul)
    const planDefect = numberOr(answers.plan_defect && answers.plan_defect.noul)
    const divergence = numberOr(answers.divergence && answers.divergence.noul)
    const choice = answers.kind && answers.kind.choice
    const noteKind = typeof choice === 'string' ? choice : undefined
    const operatorShouldRead = numberOr(
      answers.operator_should_read && answers.operator_should_read.score)
    if (stuck === undefined || planDefect === undefined || divergence === undefined ||
      noteKind === undefined || operatorShouldRead === undefined) return undefined
    return {
      stuck,
      plan_defect: planDefect,
      divergence,
      note_kind: noteKind,
      operator_should_read: operatorShouldRead,
    }
  })
}

/**
 * Read a declared amendment.
 *
 * `readAmendment(jev, { title, claim, amendment }, log)` puts
 * `AMENDMENT_QUESTIONS` to `jev` once, with the amendment's three declared
 * fields and nothing else, and resolves `{ compelled, plan_fault, magnitude }`
 * or `null` under the same rules as `readNote`.
 */
export const readAmendment = async (jev, { title, claim, amendment } = {}, log = () => {}) => {
  const { amends, what, why } = amendment || {}
  const state = { task: { title, claim }, amendment: { amends, what, why } }
  return askOnce(jev, 'amendment', state, AMENDMENT_QUESTIONS, log, (answers) => {
    const compelled = numberOr(answers.compelled && answers.compelled.noul)
    const planFault = numberOr(answers.plan_fault && answers.plan_fault.noul)
    const magnitude = numberOr(answers.magnitude && answers.magnitude.score)
    if (compelled === undefined || planFault === undefined || magnitude === undefined) {
      return undefined
    }
    return { compelled, plan_fault: planFault, magnitude }
  })
}

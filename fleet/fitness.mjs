// fleet/fitness.mjs — #322: headless-fitness preflight.
//
// A plan compiled by ultrapowers and dispatched into an unattended fleet
// sandbox has no human in the loop to render a manual-judgment verdict. If a
// task's ONLY possible evidence is a human reading it (the run-14 shape: an
// `implementation`-typed task whose Files entries are all `.md` and which
// carries no `Test:` entry), the gate can only ever emit `deferred:manual` —
// which is honest, but outside the fleet's standing grant, so the run parks.
// Discoverable in ~47 minutes of live drive burn (run-14); this module makes
// it discoverable in one static read of the plan text, before any sandbox
// exists.
//
// Deliberately independent of `compile_plan.py` and the frozen verification
// periphery (see CLAUDE.md): this parses the plan text with its own regexes,
// on the dispatch side only. It is not, and must never become, a second gate.

const TASK_HEADING_RE = /^### Task /m

// A fence OPENS on a line that is up to three spaces of indent then three or
// more backticks/tildes, and CLOSES on a later line of the same character,
// at least as long, with nothing after it but whitespace (CommonMark §4.5).
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const fenceCloses = (line, marker) => {
  const m = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/)
  return m !== null && m[1][0] === marker[0] && m[1].length >= marker.length
}

/**
 * Strip fenced code blocks (``` … ``` and ~~~ … ~~~) so an EXAMPLE inside a
 * task's own body text (e.g. a task demonstrating what a Files block looks
 * like) never drives classification of the task that contains it.
 *
 * Scanned line by line rather than with a single non-greedy regex, because a
 * regex that pairs any ``` with the NEXT ``` anywhere in the document is
 * desynchronized by one inline or odd triple-backtick and then deletes real
 * plan prose — `### Task` headings included — so whole tasks go unassessed and
 * this guard fails open on exactly the class it exists to catch. Line
 * anchoring plus length- and character-matched closers is what keeps a plan
 * that quotes a fence inside a fence (4-backtick outer fences, or a Python
 * string literal holding "```bash…```") parsed the way a reader sees it.
 *
 * Fenced lines are blanked rather than removed so that every surviving line
 * keeps its position and the `^`-anchored matchers below still line up.
 */
const stripFences = (text) => {
  const lines = text.split('\n')
  const out = []
  let marker = null
  for (const line of lines) {
    if (marker === null) {
      const open = line.match(FENCE_OPEN_RE)
      // A backtick info string may not itself contain a backtick (CommonMark).
      if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
        marker = open[1]
        out.push('')
      } else {
        out.push(line)
      }
    } else {
      // An unterminated fence runs to end of document; every line stays blanked.
      if (fenceCloses(line, marker)) marker = null
      out.push('')
    }
  }
  return out.join('\n')
}

/**
 * Split fence-stripped plan text into per-task slices, each headed by its
 * `### Task ...` line (heading text preserved verbatim, up to end of line).
 */
const splitTasks = (text) => {
  if (!TASK_HEADING_RE.test(text)) return []
  const parts = text.split(/^### Task /m).slice(1)
  return parts.map((part) => {
    const newline = part.indexOf('\n')
    const headingRest = newline === -1 ? part : part.slice(0, newline)
    const body = newline === -1 ? '' : part.slice(newline + 1)
    return { label: `Task ${headingRest.trim()}`, body }
  })
}

const FILES_ENTRY_RE = /^-\s*(?:Create|Modify|Test|Delete):\s*`([^`]+)`/gm
const TYPE_RE = /^\*\*Type:\*\*\s*(\S+)/m
const TEST_ENTRY_RE = /^-\s*Test:\s*`([^`]+)`/m

// #425: TypeScript's value here is `tsc --noEmit` catching cross-task
// interface drift — the characteristic parallel-implementation failure. A
// plan that writes .ts files but never typechecks in its gate has given that
// up, probably without meaning to. Say so; never refuse. This module is not a
// second gate (see the header), and a nudge that could block would make it
// one.
const TS_FILE_RE = /\.tsx?$/
const TYPECHECK_RE = /tsc\s+--noEmit/
const GREENFIELD_TEST_CMD = 'bunx tsc --noEmit && bun test'

/**
 * Assess whether a compiled plan is fit to dispatch headlessly: does any task
 * carry a verification surface that can only ever be judged by a human.
 *
 * Also emits advisory `notes` — things worth saying that are NOT grounds to
 * refuse a dispatch. `fit` is computed from `findings` alone; a note can
 * never move it, and `notes` is always an array so callers never branch on
 * `undefined`.
 *
 * @param {string} planText
 * @returns {{fit: boolean, findings: Array<{task: string, reason: string}>,
 *            notes: Array<{task: string, note: string}>}}
 */
export const assessHeadlessFitness = (planText) => {
  const stripped = stripFences(planText ?? '')
  const tasks = splitTasks(stripped)
  const findings = []
  const notes = []
  // The one task the nudge attaches to: the first implementation task that
  // writes TypeScript. Nudging every such task would say the same thing N
  // times about one plan-level omission.
  let firstTsTask = null
  let anyGateTypechecks = false

  for (const { label, body } of tasks) {
    const typeMatch = body.match(TYPE_RE)
    const type = typeMatch ? typeMatch[1] : 'implementation'

    const entries = [...body.matchAll(FILES_ENTRY_RE)].map((m) => m[1])
    if (type === 'gate' && TYPECHECK_RE.test(body)) anyGateTypechecks = true
    if (type === 'implementation' && firstTsTask === null && entries.some((e) => TS_FILE_RE.test(e))) {
      firstTsTask = label
    }

    if (type !== 'implementation') continue

    const filesEntries = entries
    if (filesEntries.length === 0) continue

    const allMarkdown = filesEntries.every((entry) => entry.endsWith('.md'))
    if (!allMarkdown) continue

    const hasTestEntry = TEST_ENTRY_RE.test(body)
    if (hasTestEntry) continue

    findings.push({
      task: label,
      reason:
        'instruction-only doc task — every Files entry is a .md and there is no Test: entry, so ' +
        'the only possible evidence is a human judgment call, which the gate can only ack as ' +
        'deferred:manual (outside the fleet standing grant). Fix: rewrite the verification into ' +
        'runtime/external form (add a pinning Test: entry), or route this task to a local drain.',
    })
  }

  if (firstTsTask !== null && !anyGateTypechecks) {
    notes.push({
      task: firstTsTask,
      note:
        'advisory only (this never blocks a dispatch): this plan writes TypeScript but no gate task ' +
        `typechecks it. The characteristic parallel-implementation failure is cross-task interface ` +
        `drift, and \`tsc --noEmit\` is what catches it before the suite runs. Consider making the ` +
        `gate command \`${GREENFIELD_TEST_CMD}\` (#425).`,
    })
  }

  return { fit: findings.length === 0, findings, notes }
}

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

/**
 * Strip fenced code blocks (``` … ``` and ~~~ … ~~~) so an EXAMPLE inside a
 * task's own step text (e.g. a task demonstrating what a Files block looks
 * like) never drives classification of the task that contains it.
 */
const stripFences = (text) => text.replace(/(```|~~~)[\s\S]*?\1/g, '')

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

/**
 * Assess whether a compiled plan is fit to dispatch headlessly: does any task
 * carry a verification surface that can only ever be judged by a human.
 *
 * @param {string} planText
 * @returns {{fit: boolean, findings: Array<{task: string, reason: string}>}}
 */
export const assessHeadlessFitness = (planText) => {
  const stripped = stripFences(planText ?? '')
  const tasks = splitTasks(stripped)
  const findings = []

  for (const { label, body } of tasks) {
    const typeMatch = body.match(TYPE_RE)
    const type = typeMatch ? typeMatch[1] : 'implementation'
    if (type !== 'implementation') continue

    const filesEntries = [...body.matchAll(FILES_ENTRY_RE)].map((m) => m[1])
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

  return { fit: findings.length === 0, findings }
}

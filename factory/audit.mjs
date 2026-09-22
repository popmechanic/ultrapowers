/**
 * factory/audit.mjs — the one computed row a finished run's record ends
 * with, naming what it should have and doesn't (#1167).
 *
 * Nine factory runs (189–196 and fixture 36) ended `done` without ever
 * closing their hub issue — and a skipped close and a successful one left
 * the same record: nothing. Absence is a fact code can compute, so this
 * module computes it: `auditRows` reads a run's own `events.jsonl` rows and
 * names every kind of row that a `done` run should carry and does not.
 *
 * `auditRows` judges nothing beyond that: a name is in `missing` or it
 * isn't. The CLI at the bottom is the boot's own last call — it must never
 * cost a run, so it always prints exactly one line and exits 0, even over a
 * file it can't read at all.
 */

import { readFileSync } from 'node:fs'

/** The `landing` rows' tasks, each task's id kept exactly once and in the
 *  order its first `landing` row arrived. */
function landedTaskIds (rows) {
  const seen = new Set()
  const ids = []
  for (const row of rows) {
    if (row && row.kind === 'landing' && row.task != null) {
      const id = String(row.task)
      if (!seen.has(id)) {
        seen.add(id)
        ids.push(id)
      }
    }
  }
  return ids
}

/** Whether `code` is an HTTP code in the closed-succeeded range. */
const isCloseCode = (code) => Number.isInteger(code) && code >= 200 && code <= 299

/**
 * `auditRows(rows, { state, bound })` — the one `run:audit` object a
 * finished run's record ends with.
 *
 * For any `state` other than `'done'`, `missing` is always `[]` (M1): an
 * unfinished run has nothing yet to be missing.
 *
 * For `state: 'done'` (M2): every landed task with no `fold:verify` row
 * carrying the same `task` contributes `fold:verify task <id>`, in landing
 * order.
 *
 * For `state: 'done'` with `bound: true` (M3), after those come, in order:
 * `board:close task <id>` for every landed task with no `board:close` row
 * whose `what` is `task <id>` and whose `code` is an integer 200–299; then
 * `board:close run` under the same rule for `what: 'run'`; then
 * `board:leave` when no `board:leave` row has `rc === 0`. With
 * `bound: false` none of those three kinds is ever listed — a hubless run
 * never had a close to miss.
 */
export function auditRows (rows, { state, bound } = {}) {
  const safeRows = Array.isArray(rows) ? rows : []
  const missing = []

  if (state === 'done') {
    const landed = landedTaskIds(safeRows)

    const verifiedTasks = new Set()
    for (const row of safeRows) {
      if (row && row.kind === 'fold:verify' && row.task != null) {
        verifiedTasks.add(String(row.task))
      }
    }
    for (const id of landed) {
      if (!verifiedTasks.has(id)) missing.push(`fold:verify task ${id}`)
    }

    if (bound) {
      const closedWhat = new Set()
      for (const row of safeRows) {
        if (row && row.kind === 'board:close' && isCloseCode(row.code)) {
          closedWhat.add(row.what)
        }
      }
      for (const id of landed) {
        if (!closedWhat.has(`task ${id}`)) missing.push(`board:close task ${id}`)
      }
      if (!closedWhat.has('run')) missing.push('board:close run')

      const leftClean = safeRows.some((row) => row && row.kind === 'board:leave' && row.rc === 0)
      if (!leftClean) missing.push('board:leave')
    }
  }

  return { kind: 'run:audit', state, missing }
}

/** `events.jsonl`'s lines, parsed as JSON and skipping any line that fails
 *  to parse; an unreadable file reads as no rows at all — the audit is a
 *  fact for the record and must never cost a run over a bad path. */
function readRows (eventsPath) {
  let text
  try {
    text = readFileSync(eventsPath, 'utf8')
  } catch {
    return []
  }
  const rows = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      rows.push(JSON.parse(trimmed))
    } catch {
      // Skip a line that doesn't parse — the record is a fact even when one
      // of its own lines is broken.
    }
  }
  return rows
}

/** `node factory/audit.mjs <events.jsonl> <state> [--bound]` — one stdout
 *  line, `JSON.stringify` of `auditRows`'s answer, and exit 0 always. */
function main (argv) {
  const args = argv.slice(2)
  const eventsPath = args[0]
  const state = args[1]
  const bound = args.includes('--bound')

  const rows = eventsPath ? readRows(eventsPath) : []
  const result = auditRows(rows, { state, bound })
  const line = { ts: new Date().toISOString(), ...result }
  process.stdout.write(JSON.stringify(line) + '\n')
  return 0
}

if (import.meta.main) { process.exitCode = main(process.argv) }

export default { auditRows, main }

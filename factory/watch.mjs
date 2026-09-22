/**
 * factory/watch.mjs — the supervisor's four questions, asked a second time
 * over what a worker actually did rather than over its own narration.
 *
 * `observedWork` turns one dispatch's own tool calls and exam runs into the
 * flat facts the questions in `factory/judge.mjs`'s `readSupervisorObserved`
 * are worded to read: elapsed time, time since the last edit, which paths
 * were touched and whether any of them sit outside the task's own Files
 * list, how many times the same tool landed on the same target, and the
 * exam's own exits. `supervisorTick` is the two-reading dispatch itself: the
 * existing narration reading (`readSupervisor`), unconditionally, and this
 * new facts reading (`readSupervisorObserved`), only when the policy turns
 * it on — appending a row for each answer that comes back non-null, and
 * never throwing even when the injected `read` itself rejects.
 *
 * Kept pure and apart from `factory/engine.mjs` on purpose (the file's own
 * note on this task): the engine is over its size budget, and this logic —
 * the tick included — needs no clone, no worker and no real judge to run its
 * own exam, only the two seams (`read`, `appendEvent`) the engine already
 * has lying around.
 */

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

/** Whether `target` is in scope for `taskFiles`: an exact match, or a path
 *  ending with `/` plus a listed file — the way a worker's absolute clone
 *  path (`/c/factory/x.mjs`) reads against a task's own relative Files entry
 *  (`factory/x.mjs`). */
const inScope = (target, taskFiles) =>
  taskFiles.some((f) => target === f || target.endsWith('/' + f))

/**
 * `{ tools, examRuns, taskFiles, startedAt, now }` -> the nine facts named
 * above. `tools` is read in order and never mutated; nothing here throws on
 * a missing or malformed entry beyond what a plain property read tolerates.
 */
export function observedWork ({ tools, examRuns, taskFiles, startedAt, now }) {
  const list = Array.isArray(tools) ? tools : []
  const files = Array.isArray(taskFiles) ? taskFiles : []

  let lastEditAt = null
  let edits = 0
  const tool_counts = {}
  const paths_touched = []
  const pairCounts = new Map()

  for (const t of list) {
    if (!t) continue
    const name = t.tool
    tool_counts[name] = (tool_counts[name] || 0) + 1

    const pairKey = name + '\u0000' + t.target
    pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1)

    if (EDIT_TOOLS.has(name)) {
      edits += 1
      if (lastEditAt === null || t.at > lastEditAt) lastEditAt = t.at
      if (t.target !== undefined && !paths_touched.includes(t.target)) {
        paths_touched.push(t.target)
      }
    }
  }

  const outside_files = paths_touched.filter((p) => !inScope(p, files))
  let repeats = 0
  for (const count of pairCounts.values()) if (count > repeats) repeats = count

  const last_tools = list.slice(-12).map((t) => ({ tool: t.tool, target: t.target }))

  return {
    elapsed_ms: now - startedAt,
    ms_since_last_edit: lastEditAt === null ? null : now - lastEditAt,
    edits,
    tool_counts,
    paths_touched,
    outside_files,
    exam_runs: examRuns,
    repeats,
    last_tools,
  }
}

/**
 * The narration-only reading, as today's first half. Resolves once the one
 * call has settled and never rejects — a `read` that throws or returns a
 * rejected promise, or answers `null`, simply appends no row.
 */
export async function supervisorTick ({
  read, appendEvent, label, task, transcript,
}) {
  const who = { task, label }
  let answers = null
  try { answers = await read('readSupervisor', { label, task, transcript, who }) } catch { answers = null }
  if (answers) appendEvent({ kind: 'supervisor', task, label, answers })
}

/**
 * `makeObservedWatch({ read, appendEvent, observedEnabled, minElapsedMs, label, task })`
 * -> `{ turn, end }`, one pair per dispatch.
 *
 * The observed reading, deferred rather than skipped: held while the worker
 * is under `minElapsedMs` of elapsed time, asked exactly once at or past it,
 * and — for a worker whose stream ends before it was ever asked — recorded
 * as a skipped row naming how far in it was. `observedEnabled` anything but
 * `true` turns the whole thing off: no row, no `read` call, ever.
 */
export function makeObservedWatch ({
  read, appendEvent, observedEnabled, minElapsedMs, label, task,
}) {
  const floor = typeof minElapsedMs === 'number' ? minElapsedMs : 0
  let asked = false
  let ended = false

  const turn = async (observed) => {
    if (observedEnabled !== true) return 'off'
    if (asked) return 'done'
    if (typeof observed.elapsed_ms === 'number' && observed.elapsed_ms < floor) return 'held'
    asked = true
    const who = { task, label }
    let answers = null
    try { answers = await read('readSupervisorObserved', { observed, who }) } catch { answers = null }
    if (answers) appendEvent({ kind: 'supervisor:observed', task, label, answers, observed })
    return 'asked'
  }

  const end = async (observed) => {
    if (observedEnabled !== true) return 'off'
    if (asked || ended) return 'done'
    ended = true
    appendEvent({
      kind: 'supervisor:observed', task, label,
      skipped: 'under floor', elapsed_ms: observed.elapsed_ms, min_elapsed_ms: floor,
    })
    return 'skipped'
  }

  return { turn, end }
}

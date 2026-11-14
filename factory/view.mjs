/**
 * factory/view.mjs — the run's finished picture (pure).
 *
 * `projectRun` reads a run's `events.jsonl` rows, its `status.json` and the plan's parse into the
 * run's state, each task's state and a timeline of every row worth a line; `fleet/run-read.mjs`
 * re-exports it. `renderView` is what the engine writes as the run's view: that projection plus
 * each task's wave, deps, last claiming agent and proof, and the status page's cells. Nothing
 * here reads a file; the engine may not import `fleet/`, so nothing here does either.
 */

const short = (text, n) => { const s = String(text ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }

/** One timeline line for an engine row, or null for a row that is not worth one. `task` is the
 *  task the line belongs to, null for a line about the whole run. */
function lineOf (e) {
  const k = e.kind
  if (k === 'session:start') return { task: e.task, what: `claimed by ${e.agent}` }
  if (k === 'session:end') {
    if (e.objected) return null   // the `objection` row says it
    if (e.released) return { task: e.task, what: `${e.agent} gave it back: ${short(e.released, 140)}` }
    if (e.done) return { task: e.task, what: `done by ${e.agent}` }
    return null
  }
  if (k === 'objection') return { task: e.task, what: `${e.agent} objected: ${short(e.reason, 200)}` }
  if (k === 'task:parked') return { task: e.task, what: e.objected ? 'parked for the operator' : `parked after ${e.releases} give-backs` }
  if (k === 'reopen') return { task: e.task, what: `reopened red (${e.n})` }
  if (k === 'belief' && e.by !== 'host') return { task: e.task ?? null, what: `${e.by} noted: ${short(e.claim, 160)}` }
  if (k === 'main:moved') return { task: null, what: `main moved to ${String(e.to).slice(0, 7)} (${e.why}), ${e.changed} file${e.changed === 1 ? '' : 's'} taken in` }
  if (k === 'main:off') return { task: null, what: `stopped following main: ${short(e.reason ?? e.why, 120)}` }
  if (k === 'conflict:open') return { task: null, what: `conflict opened in ${e.path}${e.created ? ' (both sides created it)' : ''}` }
  if (k === 'conflict:close') return { task: null, what: `conflict in ${e.path} closed by ${e.by}` }
  if (k === 'resolve-task') return { task: `R:${e.path}`, what: 'added by the engine: resolve the conflict' }
  if (k === 'loose-task') return { task: 'L:loose', what: `added by the engine: clean up ${(e.paths || []).join(', ')}` }
  if (k === 'settled') return { task: null, what: `settled green at ${e.snap}` }
  if (k === 'terminal') return { task: null, what: `ended ${e.pr}: ${short(e.why, 200)}` }
  if (k === 'refold') return { task: null, what: e.ok ? 'caught up to a moved main' : `could not catch up to main: ${short(e.reason, 120)}` }
  if (k === 'publish:pr') return { task: null, what: `pull request ${e.draft ? 'opened as a draft' : 'opened'}: ${e.url}` }
  if (k === 'merge') return { task: null, what: `merge answered ${e.code}${e.message ? `: ${short(e.message, 80)}` : ''}` }
  return null
}

/** A task's state after a line: what the line says happened to it. */
function stateAfter (what, was) {
  if (what.startsWith('claimed by ')) return 'claimed'
  if (what.startsWith('done by ')) return 'done'
  if (what.startsWith('parked')) return 'parked'
  if (what.startsWith('reopened red') || what.includes(' gave it back: ')) return 'ready'
  if (what.startsWith('added by the engine')) return 'ready'
  return was
}

/**
 * `{ run, target, state, phase, pr, merged, tasks, timeline, cursor }` for one run, from its
 * `events.jsonl` rows, its `status.json` and, when given, the plan's parse (for task titles).
 * `tasks` is every task the plan names and every one the engine added, each `{ id, title, state,
 * last, lastAt }`; `timeline` is one `{ n, at, task, what }` per line, `n` the row's 1-based
 * place in the log; `cursor` is how many rows were read.
 */
export function projectRun ({ run, target, rows, status = null, plan = null }) {
  const tasks = new Map()
  const titled = new Map((plan && Array.isArray(plan.tasks) ? plan.tasks : []).map((t) => [String(t.id), t.title]))
  const touch = (id) => {
    const key = String(id)
    if (!tasks.has(key)) tasks.set(key, { id: key, title: titled.get(key) ?? '', state: 'filed', last: null, lastAt: null })
    return tasks.get(key)
  }
  for (const id of titled.keys()) touch(id)
  for (const id of Object.keys((status && status.tasks) || {})) touch(id)
  const timeline = []
  const list = Array.isArray(rows) ? rows : []
  list.forEach((e, i) => {
    if (!e || typeof e !== 'object') return
    const line = lineOf(e)
    if (line === null) return
    const at = typeof e.ts === 'string' ? e.ts : null
    const task = line.task === null || line.task === undefined ? null : String(line.task)
    if (task !== null) {
      const t = touch(task)
      t.state = stateAfter(line.what, t.state); t.last = line.what; t.lastAt = at
    }
    timeline.push({ n: i + 1, at, task, what: line.what })
  })
  const s = status && typeof status === 'object' ? status : {}
  return {
    run, target, state: s.state ?? null, phase: s.phase ?? null, pr: s.pr ?? null, merged: s.merged ?? null,
    tasks: [...tasks.values()], timeline, cursor: list.length
  }
}

const ids = (list) => (Array.isArray(list) ? list : []).map((t) => String(t && typeof t === 'object' ? t.id : t))
const later = (a, b) => {
  if (typeof a !== 'string') return typeof b === 'string' ? b : null
  if (typeof b !== 'string') return a
  return Date.parse(b) > Date.parse(a) ? b : a
}

/** A `proof` row's reading: 0 when every exit is 0 and no error was caught, else the first
 *  non-zero exit, else 1. */
function proofOf (e) {
  const exits = Array.isArray(e.exits) ? e.exits : []
  const errs = Array.isArray(e.errs) ? e.errs : []
  const bad = exits.find((x) => x !== 0)
  if (bad !== undefined) return bad
  return errs.length ? 1 : 0
}

/**
 * The run's view: `{ view: 1, run, target, state, phase, pr, merged, error, startedAt, updatedAt,
 * heardAt, costUsd, tasks, timeline, cursor }`. Each task is `projectRun`'s `{ id, title, state,
 * last, lastAt }` plus `wave` (its 1-based launch wave, one past the last for a task the plan does
 * not name), `deps` (the sorted ids it waits on), `agent` (its last claimer) and `proof` (its last
 * `proof` row's reading, null without one).
 */
export function renderView ({ run, target, rows, status = null, plan = null, summary = null }) {
  const p = projectRun({ run, target, rows, status, plan })
  const list = Array.isArray(rows) ? rows : []
  const waves = plan && Array.isArray(plan.launch_waves) ? plan.launch_waves : []
  const waveOf = new Map()
  waves.forEach((w, i) => { for (const id of ids(w)) if (!waveOf.has(id)) waveOf.set(id, i + 1) })
  const deps = new Map()
  const dep = (id, on) => { if (!deps.has(id)) deps.set(id, new Set()); deps.get(id).add(on) }
  for (const t of plan && Array.isArray(plan.tasks) ? plan.tasks : []) for (const on of ids(t.depends_on)) dep(String(t.id), on)
  for (const e of plan && Array.isArray(plan.dag_edges) ? plan.dag_edges : []) if (e) dep(String(e.to), String(e.from))
  const agents = new Map()
  const proofs = new Map()
  for (const e of list) {
    if (!e || typeof e !== 'object' || e.task === undefined || e.task === null) continue
    if (e.kind === 'session:start') agents.set(String(e.task), e.agent ?? null)
    else if (e.kind === 'proof') proofs.set(String(e.task), proofOf(e))
  }
  const s = status && typeof status === 'object' ? status : {}
  const last = list.length ? list[list.length - 1] : null
  return {
    view: 1,
    run,
    target,
    state: s.state ?? null,
    phase: s.phase ?? null,
    pr: s.pr ?? null,
    merged: s.merged ?? null,
    error: s.error ?? null,
    startedAt: s.startedAt ?? null,
    updatedAt: s.updatedAt ?? null,
    heardAt: later(s.updatedAt ?? null, last && typeof last === 'object' ? last.ts ?? null : null),
    costUsd: summary && typeof summary === 'object' ? summary.cost_usd ?? null : null,
    tasks: p.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      state: t.state,
      last: t.last,
      lastAt: t.lastAt,
      wave: waveOf.get(t.id) ?? waves.length + 1,
      deps: [...(deps.get(t.id) ?? [])].sort(),
      agent: agents.get(t.id) ?? null,
      proof: proofs.has(t.id) ? proofs.get(t.id) : null
    })),
    timeline: p.timeline,
    cursor: p.cursor
  }
}

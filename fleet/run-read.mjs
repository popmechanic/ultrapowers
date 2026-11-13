#!/usr/bin/env node
/**
 * fleet/run-read.mjs — a run, read from the evidence record.
 *
 *   node fleet/run-read.mjs --run <N>[,<M>…] --target <owner>/<repo> [--evidence-repo <owner>/<repo>]
 *                           [--since <n>] [--json]
 *   node fleet/run-read.mjs --live [--target <owner>/<repo>] [--evidence-repo <owner>/<repo>] [--json]
 *
 * The sandbox is the one writer of a run, and its record is git: `status.json` and `events.jsonl`
 * under `runs/<owner>-<repo>/<N>/` in the operator's evidence repository, on the run's live branch
 * while it works and on its tag once it has ended. This reads that record and nothing else: no
 * hub, no VM. `projectRun` is pure and answers plain data (the run's state, each task's state and
 * a timeline of every row worth a line), so a page in a browser can use it as it stands; the CLI
 * prints it the way `board-read.mjs` prints the hub's copy, which holds claims and closes only.
 *
 * `--since <n>` prints only timeline rows after the first `n` (the last line of every print is
 * `cursor <rows read>`). `--live` lists the runs that have a live branch. The evidence repository
 * is `--evidence-repo`, else `"evidence"` in `~/.ultrapowers/fleet.json`. Reads go through `gh api`.
 */
import { fileURLToPath } from 'node:url'

import {
  Refusal, defaultExec, liveBranchFor, readEvidenceSetting, runCli, runFolderFor, runTagFor, targetSlug
} from './lobby.mjs'

const fail = (message) => { throw new Refusal(`run-read: ${message}`) }
const short = (text, n) => { const s = String(text ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }
const timeOf = (iso) => (typeof iso === 'string' && iso.length >= 19 ? iso.slice(11, 19) + 'Z' : '-')

// ── The projection (pure) ────────────────────────────────────────────────

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

/** The projection as the operator reads it; `since` drops timeline lines at or before that row. */
export function renderRun (p, { since = 0 } = {}) {
  const lines = [`== run-${p.run} ${p.state ?? 'unknown'}${p.phase ? `: ${p.phase}` : ''}${p.pr ? `  ${p.pr}` : ''}`]
  for (const t of p.tasks) {
    lines.push(`  ${('task ' + t.id).padEnd(10)} ${t.state.padEnd(8)} last ${timeOf(t.lastAt)}  ${t.title}`)
  }
  lines.push('== events')
  for (const r of p.timeline) {
    if (r.n <= since) continue
    lines.push(`  ${timeOf(r.at)} ${(r.task === null ? 'run' : 'task ' + r.task).padEnd(10)} ${r.what}`)
  }
  lines.push(`cursor ${p.cursor}`)
  return lines.join('\n')
}

// ── Reading the record ───────────────────────────────────────────────────

/** One file of the evidence repository at a ref, as text, or null when it is not there. */
async function fileAt (exec, evidence, filePath, ref) {
  const res = await exec('gh', ['api', '-H', 'Accept: application/vnd.github.raw',
    `repos/${evidence}/contents/${filePath}?ref=${encodeURIComponent(ref)}`])
  return res.code === 0 ? String(res.stdout ?? '') : null
}

const jsonOf = (text) => { try { return JSON.parse(text) } catch { return null } }
const rowsOf = (text) => String(text ?? '').split('\n').filter((l) => l.trim() !== '').map(jsonOf).filter((e) => e !== null)

/**
 * A run's record: `{ ref, live, rows, status, plan }`, or null when the evidence repository holds
 * neither a tag nor a live branch for it. The tag is tried first: a run that has ended is read
 * where it will stay, and a run still at work has only its live branch.
 */
export async function readRunRecord ({ exec = defaultExec, evidence, target, run }) {
  const folder = runFolderFor(target, run)
  for (const [ref, live] of [[runTagFor(target, run), false], [liveBranchFor(target, run), true]]) {
    const events = await fileAt(exec, evidence, `${folder}/events.jsonl`, ref)
    const status = await fileAt(exec, evidence, `${folder}/status.json`, ref)
    if (events === null && status === null) continue
    const plan = await fileAt(exec, evidence, `${folder}/plan.json`, ref)
    return { ref, live, rows: rowsOf(events), status: jsonOf(status), plan: jsonOf(plan) }
  }
  return null
}

/** Every run with a live branch: `[{ target, run, branch }]`, `target` as `<owner>-<repo>`;
 *  with `target` given, only that target's. */
export async function listLive ({ exec = defaultExec, evidence, target = null }) {
  const prefix = target === null ? 'live/' : `live/${targetSlug(target)}/`
  const res = await exec('gh', ['api', '--paginate', '--slurp', `repos/${evidence}/git/matching-refs/heads/${prefix}`])
  const pages = res.code === 0 ? jsonOf(res.stdout) : null
  const refs = Array.isArray(pages) ? pages.flat() : []
  const out = []
  for (const r of refs) {
    const m = /^refs\/heads\/(live\/(.+)\/run-([1-9][0-9]*))$/.exec(String(r && r.ref))
    if (m) out.push({ target: m[2], run: Number(m[3]), branch: m[1] })
  }
  return out.sort((a, b) => a.target.localeCompare(b.target) || a.run - b.run)
}

// ── The CLI ──────────────────────────────────────────────────────────────

export function parseArgs (argv) {
  const a = { runs: [], target: null, evidence: null, since: 0, json: false, live: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') a.json = true
    else if (arg === '--live') a.live = true
    else if (arg === '--run') {
      for (const part of String(argv[++i] ?? '').split(',')) {
        if (!/^[1-9][0-9]*$/.test(part.trim())) fail(`--run must be a positive integer, got ${JSON.stringify(part)}`)
        a.runs.push(Number(part.trim()))
      }
    } else if (arg === '--target') a.target = argv[++i] ?? null
    else if (arg === '--evidence-repo') a.evidence = argv[++i] ?? null
    else if (arg === '--since') {
      const v = argv[++i]
      if (!/^[0-9]+$/.test(String(v))) fail(`--since must be a non-negative integer, got ${JSON.stringify(v)}`)
      a.since = Number(v)
    } else fail(`unknown argument ${JSON.stringify(arg)}`)
  }
  for (const [name, v] of [['--target', a.target], ['--evidence-repo', a.evidence]]) {
    if (v !== null && !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(String(v))) fail(`${name} takes owner/repo, not ${JSON.stringify(v)}`)
  }
  if (!a.live && (a.runs.length === 0 || a.target === null)) fail('--run and --target are required (or --live)')
  return a
}

export async function main (argv, { exec = defaultExec, configPath, write = (s) => process.stdout.write(s) } = {}) {
  const args = parseArgs(argv)
  const evidence = args.evidence ?? await readEvidenceSetting(configPath ? { path: configPath } : {})
  if (!evidence) fail('no evidence repository: pass --evidence-repo <owner>/<repo> or set "evidence" in ~/.ultrapowers/fleet.json')
  if (args.live) {
    const live = await listLive({ exec, evidence, target: args.target })
    write(args.json ? `${JSON.stringify(live, null, 2)}\n` : `${live.map((r) => `${r.target} run-${r.run}`).join('\n') || 'no run has a live branch'}\n`)
    return
  }
  const out = []
  for (const run of args.runs) {
    const rec = await readRunRecord({ exec, evidence, target: args.target, run })
    if (rec === null) fail(`no record for run ${run} of ${args.target} in ${evidence}`)
    out.push({ ...projectRun({ run, target: args.target, rows: rec.rows, status: rec.status, plan: rec.plan }), ref: rec.ref, live: rec.live })
  }
  write(args.json ? `${JSON.stringify(out, null, 2)}\n` : `${out.map((p) => renderRun(p, { since: args.since })).join('\n')}\n`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runCli(main, process.argv.slice(2))

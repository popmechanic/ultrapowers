#!/usr/bin/env node
/**
 * fleet/run-read.mjs — a run, read from the evidence record.
 *
 *   node fleet/run-read.mjs --run <N>[,<M>…] --target <owner>/<repo> [--evidence-repo <owner>/<repo>]
 *                           [--since <n>] [--json] [--follow [--quiet <minutes>]]
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
 * `cursor <rows read>`). `--follow` keeps reading every 10 s, prints each new line once, flags a
 * claim or a run gone quiet with `!`, and ends when every asked run's status says it ended; the
 * record is committed every 10 s, so a line is up to about 20 s behind the sandbox. `--live` lists the runs that have a live branch. The evidence repository
 * is `--evidence-repo`, else `"evidence"` in `~/.ultrapowers/fleet.json`. Reads go through `gh api`.
 */
import { fileURLToPath } from 'node:url'

import { projectRun } from '../factory/view.mjs'
import {
  Refusal, defaultExec, liveBranchFor, readEvidenceSetting, runCli, runFolderFor, runTagFor, targetSlug
} from './lobby.mjs'

const fail = (message) => { throw new Refusal(`run-read: ${message}`) }
const timeOf = (iso) => (typeof iso === 'string' && iso.length >= 19 ? iso.slice(11, 19) + 'Z' : '-')

// ── The projection (pure; `factory/view.mjs` holds it, since the engine renders the run's view) ──

export { projectRun }

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
export async function readRunRecord ({ exec = defaultExec, evidence, target, run, liveFirst = false, plan: wantPlan = true }) {
  const folder = runFolderFor(target, run)
  const refs = [[runTagFor(target, run), false], [liveBranchFor(target, run), true]]
  // `liveFirst` is the follower's order: a run at work is on its live branch, so the tag is asked
  // only once that branch is gone. `plan: false` skips the plan's parse, which never changes.
  for (const [ref, live] of liveFirst ? refs.reverse() : refs) {
    const events = await fileAt(exec, evidence, `${folder}/events.jsonl`, ref)
    const status = await fileAt(exec, evidence, `${folder}/status.json`, ref)
    if (events === null && status === null) continue
    const plan = wantPlan ? await fileAt(exec, evidence, `${folder}/plan.json`, ref) : null
    return { ref, live, rows: rowsOf(events), status: jsonOf(status), plan: jsonOf(plan) }
  }
  return null
}

// ── Following a run ──────────────────────────────────────────────────────

/** The states a run's status page ends on (`fleet/janitor.mjs`'s `REAPABLE_STATES`). */
const ENDED = ['done', 'parked', 'failed']

/**
 * `--follow`'s reader: each call answers one projection per asked run, in order, or null for a
 * run whose record holds nothing yet. A run is read live branch first (two requests a look while
 * it works) and its plan once, since the parse the engine read does not change.
 */
export function followReader ({ exec = defaultExec, evidence, target, runs }) {
  const plans = new Map()
  return async () => {
    const out = []
    for (const run of runs) {
      const rec = await readRunRecord({ exec, evidence, target, run, liveFirst: true, plan: !plans.has(run) })
      if (rec === null) { out.push(null); continue }
      if (!plans.has(run) && rec.plan !== null) plans.set(run, rec.plan)
      out.push({ ...projectRun({ run, target, rows: rec.rows, status: rec.status, plan: plans.get(run) ?? null }), ref: rec.ref, live: rec.live })
    }
    return out
  }
}

/**
 * `--follow`: look every `everyMs`, print each timeline line not yet printed, and print one `!`
 * line when something looks wrong: a task claimed `quietMs` ago with nothing since, or no new line
 * from any asked run for `quietMs`. Each warning prints once until the thing it names changes.
 * Ends when every asked run's status page says it ended (one `== run-<N> <state>` line each, and
 * 0) or at `maxMs` (`== gave up` and 3).
 * `read` is `followReader`'s; `now`, `sleep` and `write` are the test's seams.
 */
export async function follow ({ read, write, runs, everyMs = 10000, quietMs = 10 * 60000, maxMs = 240 * 60000, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const start = now()
  const printed = new Map(runs.map((run) => [run, 0]))   // run -> the last log row printed
  const warned = new Set()
  let lastNewAt = start
  for (;;) {
    const looks = await read()
    const t = now()
    let fresh = 0
    looks.forEach((p, i) => {
      if (p === null) return
      const run = runs[i]
      for (const r of p.timeline) {
        if (r.n <= printed.get(run)) continue
        write(`  ${timeOf(r.at)} run-${run} ${(r.task === null ? 'run' : 'task ' + r.task).padEnd(10)} ${r.what}\n`)
        fresh += 1
      }
      printed.set(run, Math.max(printed.get(run), p.cursor))
      for (const task of p.tasks) {
        if (task.state !== 'claimed' || !task.lastAt) continue
        const key = `claim ${run} ${task.id} ${task.lastAt}`
        if (t - Date.parse(task.lastAt) >= quietMs && !warned.has(key)) {
          warned.add(key)
          write(`! run-${run} task ${task.id} ${task.last} ${Math.floor((t - Date.parse(task.lastAt)) / 60000)} min ago, and nothing since\n`)
        }
      }
    })
    if (fresh) lastNewAt = t
    const quietKey = `quiet ${lastNewAt}`
    if (t - lastNewAt >= quietMs && !warned.has(quietKey)) {
      warned.add(quietKey)
      write(`! no new line for ${Math.floor((t - lastNewAt) / 60000)} min\n`)
    }
    if (looks.every((p) => p !== null && ENDED.includes(p.state))) {
      for (const p of looks) write(`== run-${p.run} ${p.state}${p.phase ? `: ${p.phase}` : ''}${p.pr ? `  ${p.pr}` : ''}\n`)
      return 0
    }
    if (t - start >= maxMs) { write('== gave up\n'); return 3 }
    await sleep(everyMs)
  }
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
  const a = { runs: [], target: null, evidence: null, since: 0, json: false, live: false, follow: false, quietMinutes: 10 }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') a.json = true
    else if (arg === '--live') a.live = true
    else if (arg === '--follow') a.follow = true
    else if (arg === '--quiet') {
      const v = argv[++i]
      if (!/^[1-9][0-9]*$/.test(String(v))) fail(`--quiet must be a positive number of minutes, got ${JSON.stringify(v)}`)
      a.quietMinutes = Number(v)
    }
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
  if (a.follow && (a.live || a.json)) fail('--follow prints lines as they come: it takes neither --live nor --json')
  return a
}

export async function main (argv, { exec = defaultExec, configPath, write = (s) => process.stdout.write(s), sleep, now } = {}) {
  const args = parseArgs(argv)
  const evidence = args.evidence ?? await readEvidenceSetting(configPath ? { path: configPath } : {})
  if (!evidence) fail('no evidence repository: pass --evidence-repo <owner>/<repo> or set "evidence" in ~/.ultrapowers/fleet.json')
  if (args.live) {
    const live = await listLive({ exec, evidence, target: args.target })
    write(args.json ? `${JSON.stringify(live, null, 2)}\n` : `${live.map((r) => `${r.target} run-${r.run}`).join('\n') || 'no run has a live branch'}\n`)
    return
  }
  if (args.follow) {
    const read = followReader({ exec, evidence, target: args.target, runs: args.runs })
    write('== following (every 10 s; ! lines flag trouble)\n')
    const rc = await follow({ read, write, runs: args.runs, quietMs: args.quietMinutes * 60000, ...(sleep ? { sleep } : {}), ...(now ? { now } : {}) })
    if (rc) process.exitCode = rc
    return rc
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

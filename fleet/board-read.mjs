/**
 * fleet/board-read.mjs — one laptop command that names a run and prints its
 * tasks (state, latest note) and its event timeline, read off the hub through
 * the same ssh-curl door `fleet/janitor.mjs`'s `openHub` uses, with no token
 * on the command line (#1174, #876).
 *
 * `projectBoard` is the pure heart: two passes over the hub's own event rows
 * — the first learns each issue's run and title, the second projects only the
 * events of issues whose run is asked for. `renderBoard` turns that answer
 * into the CLI's text. `readBoard` (with `since` 0) reads the issues listing
 * to find the asked run's creation event by bisection, then pages
 * `client.events` from there to the feed's end and answers the projection
 * over everything read; with a `since` above `0` it pages from `since`
 * instead, unchanged. `parseBoardArgs` and
 * `main` are the CLI: argument parsing (with its own refusals) and the two
 * hub reads (list the projects, then the feed) through `fleet/kata-client.mjs`'s
 * transport, built exactly as the janitor builds it.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { makeKataClient, runIssueOf, sshTransport } from './kata-client.mjs'
import {
  KATA_HUB_FIX,
  Refusal,
  defaultExec,
  defaultKataEnvPath,
  kataHostOf,
  kataProjectFor,
  parseKataEnv,
  runCli
} from './lobby.mjs'

const fail = (message) => { throw new Refusal(`board-read: ${message}`) }

// ── The projection ───────────────────────────────────────────────────────

/** A diff's `from`/`to` value, spelled: `null` as `null`, an object with
 *  `JSON.stringify`, anything else with `String`. */
const fmt = (value) => {
  if (value === null) return 'null'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** `<title>` → `{ name, title }`: `name` up to the first `:`, `title` the
 *  rest after `: `. */
const splitTitle = (raw) => {
  const title = String(raw ?? '')
  const idx = title.indexOf(':')
  if (idx === -1) return { name: title, title: '' }
  return { name: title.slice(0, idx), title: title.slice(idx + 1).replace(/^ /, '') }
}

/**
 * Pure. Two passes over `events` (the hub's own rows: `event_id`, `type`,
 * `issue_short_id`, `actor`, `created_at`, `payload`). First: learn every
 * issue's run (`payload.metadata.run` on its `issue.created`, or
 * `payload.diff.run.to` on an `issue.metadata_updated`) and its title. Second:
 * project only the events of issues whose run is in `runs` — a `tasks` row
 * per attributed issue and a `timeline` row per attributed event that says
 * something. `cursor` is the last input row's `event_id`, `null` for an empty
 * input.
 */
export function projectBoard (events, { runs } = {}) {
  const runSet = new Set((runs || []).map(Number))
  const rows = events || []

  // First pass: each issue's run and title.
  const info = new Map()
  for (const ev of rows) {
    const issue = ev.issue_short_id
    if (issue == null) continue
    if (!info.has(issue)) info.set(issue, { run: null, title: null })
    const entry = info.get(issue)
    if (ev.type === 'issue.created') {
      if (ev.payload && ev.payload.title !== undefined) entry.title = ev.payload.title
      const metaRun = ev.payload?.metadata?.run
      if (metaRun !== undefined && metaRun !== null) entry.run = Number(metaRun)
    } else if (ev.type === 'issue.metadata_updated') {
      const diff = ev.payload?.diff
      if (diff && Object.prototype.hasOwnProperty.call(diff, 'run')) {
        const to = diff.run?.to
        if (to !== undefined && to !== null) entry.run = Number(to)
      }
    }
  }

  // Second pass: only the events of issues whose run is asked for.
  const tasksMap = new Map()
  const timeline = []
  for (const ev of rows) {
    const issue = ev.issue_short_id
    if (issue == null) continue
    const entry = info.get(issue)
    if (!entry || entry.run === null || !runSet.has(entry.run)) continue
    const run = entry.run
    const { name, title } = splitTitle(entry.title)

    if (!tasksMap.has(issue)) {
      tasksMap.set(issue, { run, issue, name, title, state: 'filed', closed: null, lastAt: null, last: null })
    }
    if (ev.type === 'issue.created') continue
    const task = tasksMap.get(issue)

    if (ev.type === 'issue.metadata_updated') {
      const diff = ev.payload?.diff || {}
      for (const key of Object.keys(diff)) {
        if (key === 'run' || key === 'wave') continue
        const { from, to } = diff[key]
        const what = `${key} ${fmt(from)}->${fmt(to)}`
        timeline.push({ eventId: ev.event_id, at: ev.created_at, run, issue, name, what })
        if (key.endsWith('state')) task.state = to
        task.lastAt = ev.created_at
        task.last = what
      }
    } else if (ev.type === 'issue.commented') {
      const body = String(ev.payload?.body ?? '')
      const what = body.split('\n').slice(0, 3).join(' ').trim().slice(0, 120)
      timeline.push({ eventId: ev.event_id, at: ev.created_at, run, issue, name, what })
      task.lastAt = ev.created_at
      task.last = what
    } else if (ev.type === 'issue.closed') {
      const reason = ev.payload?.reason
      const what = `closed ${reason}`
      timeline.push({ eventId: ev.event_id, at: ev.created_at, run, issue, name, what })
      task.closed = reason
      task.lastAt = ev.created_at
      task.last = what
    }
    // Every other type (`issue.linked`, `issue.assigned`, `issue.labeled`,
    // `issue.snapshot`, `project.created`, …) is ignored.
  }

  const tasks = [...tasksMap.values()].sort((a, b) =>
    a.run - b.run || a.name.localeCompare(b.name, undefined, { numeric: true }))

  const cursor = rows.length === 0 ? null : rows[rows.length - 1].event_id

  return { tasks, timeline, cursor }
}

// ── Rendering ────────────────────────────────────────────────────────────

const timeOf = (at) => at.slice(11, 19) + 'Z'

/** The projection, as the operator reads it: `== now`, one line per task,
 *  `== events`, one line per timeline row, and the last line `cursor <n>`. */
export function renderBoard (projection) {
  const lines = ['== now']
  for (const t of projection.tasks) {
    const state = t.closed ? `closed:${t.closed}` : t.state
    const time = t.lastAt ? timeOf(t.lastAt) : '-'
    lines.push(`  run-${t.run} ${t.name.padEnd(8)} ${state.padEnd(12)} last ${time}  ${t.title}`)
  }
  lines.push('== events')
  for (const r of projection.timeline) {
    lines.push(`  ${timeOf(r.at)} run-${r.run} ${r.name.padEnd(8)} ${r.what}`)
  }
  lines.push(`cursor ${projection.cursor === null ? 'none' : projection.cursor}`)
  return lines.join('\n')
}

// ── Reading the hub ──────────────────────────────────────────────────────

/** The hub's own paging fact (`fleet/CONTRACT.md`'s `events-page` fact,
 *  re-measured at BASE): a page never holds more than this many rows,
 *  whatever `limit` a request asks for — a page short of this, or empty, is
 *  the feed's end. */
const HUB_PAGE_SIZE = 100

/**
 * `client.events(projectId, after)`, memoized on `after` for the lifetime of
 * one `readBoard` call — the bisection below asks about the same `after`
 * more than once, and the forward walk that follows it starts at the very
 * `after` the bisection just settled on.
 */
const pager = (client, projectId, cache) => async (after) => {
  if (cache.has(after)) return cache.get(after)
  const page = await client.events(projectId, after)
  cache.set(after, page)
  return page
}

/**
 * The feed position of the earliest of `runs`' run issues' creation, found by
 * bisection over `after_id` on `created_at` (Context, `readBoard` starts at
 * the asked run's creation event): a page whose first row's `created_at` is
 * at or after `targetAt` is past the start, a page whose first row is
 * earlier is not, and an empty page is past the end. Answers the greatest
 * `after` whose page is still not past the start — the point a forward walk
 * from `after` is guaranteed to reach the target creation event.
 */
async function findBoundary (fetchPage, targetAt) {
  const classify = async (after) => {
    const page = await fetchPage(after)
    const rows = page?.events || []
    if (rows.length === 0) return 'past-end'
    return rows[0].created_at < targetAt ? 'before' : 'at-or-after'
  }

  if (await classify(0) !== 'before') return 0

  // Doubling search for an `after` that is no longer before the start.
  let lo = 0
  let hi = 1
  while (await classify(hi) === 'before') {
    lo = hi
    hi *= 2
  }

  // Bisect the gap for the greatest `after` still before the start.
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (await classify(mid) === 'before') lo = mid
    else hi = mid
  }
  return lo
}

/**
 * With `since` `0`: reads the issues listing, takes the asked runs' run
 * issues (the earliest `created_at` when several are asked — a `Refusal`
 * naming the run(s) when none is listed), finds that creation's feed
 * position by bisection, then pages `client.events` forward from there to
 * the feed's end (a page short of `HUB_PAGE_SIZE`, or empty). With `since`
 * above `0`: no listing, no bisection — pages forward from `since` the same
 * way. Either way, answers `projectBoard` over every row read; `cursor`
 * falls back to `since` when the projection's own is `null` (nothing read).
 */
export async function readBoard ({ client, projectId, runs, since }) {
  const cache = new Map()
  const fetchPage = pager(client, projectId, cache)

  let start = since
  if (since === 0) {
    const listing = await client.listIssues(projectId)
    const issues = listing?.issues || []
    const runList = (runs || []).map(Number)
    const candidates = []
    for (const n of runList) {
      const issue = runIssueOf(issues, n, null)
      if (issue) candidates.push(issue)
    }
    if (candidates.length === 0) {
      fail(`no run issue for run ${runList.join(', ')} in project ${projectId}`)
    }
    candidates.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    const targetAt = candidates[0].created_at
    start = await findBoundary(fetchPage, targetAt)
  }

  const events = []
  let after = start
  for (;;) {
    const page = await fetchPage(after)
    const rows = page?.events || []
    events.push(...rows)
    if (rows.length < HUB_PAGE_SIZE) break
    const nextAfter = page?.next_after_id
    if (nextAfter === after) break
    after = nextAfter
  }
  const projection = projectBoard(events, { runs })
  return { ...projection, cursor: projection.cursor === null ? since : projection.cursor }
}

// ── The CLI ──────────────────────────────────────────────────────────────

const POSITIVE_INT = /^[1-9][0-9]*$/
const NON_NEGATIVE_INT = /^[0-9]+$/

/**
 * `--run <N>` (repeats, and also takes `207,208`), `--target <owner>/<repo>`,
 * `--since <event_id>` (default `0`) and `--json`. A missing `--run` or
 * `--target`, a run that is not a positive integer, or a `--since` that is
 * not a non-negative integer is a `Refusal` beginning `board-read:`.
 */
export function parseBoardArgs (argv) {
  const runs = []
  let target = null
  let since = 0
  let json = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--run') {
      const value = argv[i + 1]
      i += 1
      for (const part of String(value ?? '').split(',')) {
        const piece = part.trim()
        if (!POSITIVE_INT.test(piece)) fail(`--run must be a positive integer, got ${JSON.stringify(part)}`)
        runs.push(Number(piece))
      }
    } else if (arg === '--target') {
      target = argv[i + 1]
      i += 1
    } else if (arg === '--since') {
      const value = argv[i + 1]
      i += 1
      if (!NON_NEGATIVE_INT.test(String(value ?? ''))) {
        fail(`--since must be a non-negative integer, got ${JSON.stringify(value)}`)
      }
      since = Number(value)
    } else if (arg === '--json') {
      json = true
    }
  }

  if (runs.length === 0) fail('--run is required')
  if (!target) fail('--target is required')

  return { runs, target, since, json }
}

/**
 * The CLI: reads the hub host from `kataEnvPath`, lists the projects, matches
 * `<owner>-<repo>`, reads the feed and writes the rendering (or, with
 * `--json`, `JSON.stringify(projection, null, 2)`).
 */
export async function main (argv, { exec = defaultExec, kataEnvPath = defaultKataEnvPath(), write = (s) => process.stdout.write(s) } = {}) {
  const args = parseBoardArgs(argv)

  let text
  try {
    text = await fsp.readFile(kataEnvPath, 'utf8')
  } catch (error) {
    fail(`no kata hub env at ${kataEnvPath} (${error?.code ?? error?.message ?? error}) — ${KATA_HUB_FIX}`)
  }
  const env = parseKataEnv(text)
  const host = kataHostOf(env.url)
  if (host === null) {
    fail(`${kataEnvPath} names KATA_URL ${JSON.stringify(env.url)}, not a url with a host — ${KATA_HUB_FIX}`)
  }

  const transport = sshTransport({ sshHost: host, exec })
  const client = makeKataClient({ transport, actor: 'board-read' })

  const projectName = kataProjectFor(args.target)
  const listing = await client.listProjects()
  const project = (listing?.projects || []).find((p) => p.name === projectName)
  if (!project) {
    fail(`no hub project named ${JSON.stringify(projectName)} for target ${JSON.stringify(args.target)} — ${KATA_HUB_FIX}`)
  }

  const projection = await readBoard({ client, projectId: project.id, runs: args.runs, since: args.since })
  write(args.json ? `${JSON.stringify(projection, null, 2)}\n` : `${renderBoard(projection)}\n`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await runCli(main, process.argv.slice(2))
}

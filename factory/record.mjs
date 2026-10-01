/**
 * factory/record.mjs — the run's renderer (#1167, #1205, #1222).
 *
 * This module decides nothing: it takes what the boot and `factory/publish.mjs` already know
 * and turns it into the bytes they write — the twelve-cell status page (`status`, the
 * projection over `events.jsonl` the boot commits) and the pull request body (`pr-body`, the
 * plan's summary, the receipt, provenance, a draft's reason, Jev's step readings and the
 * closes). Nothing here writes a file or reads an environment variable; each subcommand prints
 * one thing to stdout and its exit code says whether that printing happened. The JSON the
 * publish used to build here by hand is `publish.mjs`'s own now (#1441).
 */

import { readFileSync } from 'node:fs'
import { readEventRows } from './flock/io.mjs'
import { parsedPlan } from './flock/plan.mjs'

/** A `key=value` token split at its FIRST `=`; a token with no `=` is the
 *  whole token as the key and an empty string as the value. */
function splitToken (token) {
  const idx = token.indexOf('=')
  if (idx === -1) return [token, '']
  return [token.slice(0, idx), token.slice(idx + 1)]
}

/** One `{"key":value,...}` object, keys and values rendered in the order
 *  given — never a plain JS object, whose own key order reorders an
 *  integer-looking string key ahead of insertion order. */
function renderObject (entries) {
  return '{' + entries.map(([k, v]) => JSON.stringify(k) + ':' + JSON.stringify(v)).join(',') + '}'
}

/** `events.jsonl`'s lines, parsed as JSON in file order; a line that fails to
 *  parse is skipped — the projection is a fact over what did land, not a reason
 *  to fail over what didn't — and a file that is missing or empty gives no rows. */
export { readEventRows }

/** The status page's `tasks` cell: one entry per task a `landing` or
 *  `parked` row names, in the order each task first appears, its state and
 *  park overwritten (position kept) by a later row for the same task. */
export function projectTasks (eventsPath) {
  const order = []
  const state = {}
  const park = {}
  const note = (id, st, pk) => {
    if (!(id in state)) order.push(id)
    state[id] = st
    park[id] = pk
  }
  for (const row of readEventRows(eventsPath)) {
    if (!row || row.task == null) continue
    const id = String(row.task)
    if (row.kind === 'landing') {
      note(id, 'folded', null)
    } else if (row.kind === 'parked') {
      const reason = Object.prototype.hasOwnProperty.call(row, 'reason') ? row.reason : null
      note(id, 'failed', reason)
    }
  }
  const tasks = {}
  for (const id of order) {
    tasks[id] = { state: state[id], park: park[id] }
  }
  return tasks
}

/** A field the boot handed over as `key=` — a string, or `null` when the
 *  value is absent or empty. */
function stringOrNull (value) {
  return value === undefined || value === '' ? null : value
}

/** A field that is always a string on the page — `""` when absent or empty. */
function stringOrEmpty (value) {
  return value === undefined ? '' : value
}

/** `status key=value ... --events <file>` — the twelve-cell page, `tasks`
 *  last, `updatedAt` stamped fresh on every call. */
export function renderStatus (fields, eventsPath) {
  const tasks = eventsPath ? projectTasks(eventsPath) : {}
  const entries = [
    ['run', stringOrEmpty(fields.run)],
    ['state', stringOrEmpty(fields.state)],
    ['phase', stringOrEmpty(fields.phase)],
    ['pr', stringOrNull(fields.pr)],
    ['prAuthor', stringOrNull(fields.prAuthor)],
    ['merged', stringOrNull(fields.merged)],
    ['branch', stringOrEmpty(fields.branch)],
    ['vm', stringOrNull(fields.vm)],
    ['startedAt', stringOrEmpty(fields.startedAt)],
    ['updatedAt', new Date().toISOString()],
    ['error', stringOrNull(fields.error)],
    ['tasks', tasks]
  ]
  return renderObject(entries)
}

/** The plan's `**Summary:**` paragraph: that line (its prefix and one
 *  optional following space removed) down to but not including the first
 *  blank line, each kept verbatim; no such line gives no lines at all. */
function planSummaryLines (planText) {
  const lines = planText.split('\n')
  let started = false
  const out = []
  for (const line of lines) {
    if (!started) {
      if (/^\*\*Summary:\*\*/.test(line)) {
        started = true
        out.push(line.replace(/^\*\*Summary:\*\*[ ]?/, ''))
      }
      continue
    }
    if (/^[ \t]*$/.test(line)) break
    out.push(line)
  }
  return out
}

/** Exactly one line of the plan: the first `**Closes:**` after the first
 *  `**Goal:**` and before the first `### `. Never a regex over the body. */
function planClosesLine (planText) {
  const lines = planText.split('\n')
  let goal = false
  for (const line of lines) {
    if (/^### /.test(line)) return null
    if (goal && /^\*\*Closes:\*\*/.test(line)) return line
    if (/^\*\*Goal:\*\*/.test(line)) goal = true
  }
  return null
}

/** `Closes #<n>` per `#<digits>` match on the plan's `**Closes:**` line;
 *  no such line gives no lines at all. */
function planClosesLines (planText) {
  const line = planClosesLine(planText)
  if (line == null) return []
  const matches = line.match(/#[0-9]+/g) || []
  return matches.map((m) => `Closes ${m}`)
}

/** A row cell: a string prints raw, a number/boolean/null prints as its JSON
 *  text, and an absent field prints as nothing between the two spaces. */
function cellText (value) {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

/** The plan's probes, per task in plan order, off the run's one parse (or the
 *  parser the sandbox runs, with none): `{id, probes: [{cmd, proves}]}`. A
 *  stories-v1 task's probes are its checker calls. A plan the parser refuses
 *  gives `null`, and the receipt then shows exits without probe text. */
function planProbes (planPath, planJson) {
  let parsed
  try { parsed = parsedPlan(planPath, planJson) } catch { return null }
  return (parsed.tasks || []).map((t) => ({
    id: String(t.id),
    probes: parsed.grammar === 'stories-v1'
      ? (t.probes || []).map((p) => ({ cmd: 'story checker', proves: p.clause }))
      : (t.proofRuns || []).map((cmd, i) => ({ cmd, proves: ((t.proofRunClauses || [])[i] || []).join(', ') })),
  }))
}

/** The edge row the receipt reads: the one whose `snap` is the last `settled`
 *  row's, or the last `edge` row when nothing settled; `null` without edges. */
function receiptEdge (rows) {
  let settled = null
  const edges = []
  for (const row of rows) {
    if (!row) continue
    if (row.kind === 'settled') settled = row.snap
    else if (row.kind === 'edge') edges.push(row)
  }
  if (!edges.length) return null
  if (settled !== null) {
    const hit = edges.filter((e) => e.snap === settled).pop()
    if (hit) return hit
  }
  return edges[edges.length - 1]
}

const receiptCell = (text) => String(text).replace(/\|/g, '\\|')
const probeCell = (cmd) => '`' + receiptCell(cmd.length > 60 ? cmd.slice(0, 59) + '…' : cmd) + '`'

/** `### Receipt` — one row per probe the plan named, with the exit it got on the
 *  settled snapshot, then the run-wide checks' exit and the `**Evidence:**` link
 *  when one was given. No edge row gives no receipt, only the link. */
function receiptLines (planPath, planJson, rows, evidenceUrl) {
  const out = []
  const edge = receiptEdge(rows)
  if (edge) {
    const perTask = edge.perTask || {}
    const tasks = planProbes(planPath, planJson) ||
      Object.keys(perTask).map((id) => ({ id, probes: perTask[id].map(() => ({ cmd: '—', proves: '—' })) }))
    out.push('### Receipt', '', '| task | probe | proves | exit |', '|---|---|---|---|')
    for (const t of tasks) {
      const exits = perTask[t.id] || []
      t.probes.forEach((p, i) => {
        const exit = typeof exits[i] === 'number' ? String(exits[i]) : '—'
        out.push(`| ${t.id} | ${p.cmd === '—' ? '—' : probeCell(p.cmd)} | ${receiptCell(p.proves || '—')} | ${exit} |`)
      })
    }
    out.push('', `Run-wide checks: exit ${edge.check ?? '—'}`)
  }
  if (evidenceUrl) out.push(`**Evidence:** ${evidenceUrl}`)
  return out
}

/** `### Jev read each story step (record only)` — a two-column table, one row
 *  per clause naming the latest `jev:step` row for it (file order breaks a
 *  tie), sorted by clause; no `jev:step` row at all gives no lines. */
function jevStepLines (rows) {
  const last = new Map()
  for (const row of rows) {
    if (row && row.kind === 'jev:step' && typeof row.clause === 'string') last.set(row.clause, row)
  }
  if (!last.size) return []
  const out = ['### Jev read each story step (record only)', '', '| step | reading | confidence |', '|---|---|---|']
  for (const [clause, r] of [...last].sort(([a], [b]) => a.localeCompare(b))) {
    out.push(`| ${clause} | ${r.answer ?? 'no reading'} | ${typeof r.confidence === 'number' ? r.confidence.toFixed(2) : '—'} |`)
  }
  return out
}

/** A draft's reason: the last `terminal` row, when it reads `pr: "draft"`, as one bold line
 *  naming why, then the `stall:<kind>` rows the run wrote, so the operator reads why the run
 *  stopped on the PR itself. A ready run, or a log with no `terminal` row, adds nothing. */
function draftReasonLines (rows) {
  let term = null
  const stalls = []
  for (const row of rows) {
    if (!row) continue
    if (row.kind === 'terminal') term = row
    else if (typeof row.kind === 'string' && row.kind.startsWith('stall:')) stalls.push(row.kind)
  }
  if (!term || term.pr !== 'draft') return []
  const out = [`**Draft:** ${term.why || 'the run ended without settling green'}.`]
  if (stalls.length) out.push(`Stalls recorded: ${[...new Set(stalls)].map((k) => '`' + k + '`').join(', ')}.`)
  return out
}

/** How many lines a provenance `lines` value names: `a-b` is b-a+1, `a` is 1, anything else 0. */
function lineCount (lines) {
  const m = /^(\d+)(?:-(\d+))?$/.exec(String(lines ?? ''))
  if (!m) return 0
  return m[2] === undefined ? 1 : Math.max(0, Number(m[2]) - Number(m[1]) + 1)
}

/** The `### Provenance` section over the engine's `provenance.json` (#1404): the heading, an
 *  empty line and one counts line — changed lines, the tasks that changed them and the exceptions
 *  by kind. An absent, missing or unparseable file adds nothing. */
function provenanceLines (provenancePath) {
  if (!provenancePath) return []
  let prov
  try { prov = JSON.parse(readFileSync(provenancePath, 'utf8')) } catch { return [] }
  if (!prov || typeof prov !== 'object') return []
  const hunks = Array.isArray(prov.hunks) ? prov.hunks : []
  const changed = hunks.reduce((n, h) => n + lineCount(h && h.lines), 0)
  // A hunk of `1|2` holds lines two tasks wrote identically: each counts once.
  const tasks = new Set(hunks.filter((h) => h && h.task !== undefined).flatMap((h) => String(h.task).split('|'))).size
  const kinds = { contested: 0, lost: 0, ordered: 0, foreign: 0 }
  for (const e of Array.isArray(prov.exceptions) ? prov.exceptions : []) {
    if (e && Object.hasOwn(kinds, e.kind)) kinds[e.kind]++
  }
  return ['### Provenance', '',
    `${changed} changed lines from ${tasks} tasks; exceptions: ${kinds.contested} contested, ${kinds.lost} lost, ${kinds.ordered} ordered, ${kinds.foreign} foreign.`]
}

/** The `### Loose ends` section over the last `loose-ends` row (#1419): the heading, an empty
 *  line, a counts line, then one line per open or unchecked item in row order — a resolved item
 *  gets none. No row, or a row with no items, adds nothing. */
function looseEndsLines (events) {
  const row = events.filter((r) => r && r.kind === 'loose-ends').at(-1)
  const items = row && Array.isArray(row.items) ? row.items.filter((i) => i && typeof i === 'object') : []
  if (!items.length) return []
  const resolved = items.filter((i) => i.state === 'resolved').length
  const out = ['### Loose ends', '', `${items.length} reported by builders, ${resolved} resolved in the run.`]
  for (const i of items) {
    const who = i.task === undefined || i.task === null || i.task === '' ? `(${i.by})` : `(${i.by}, task ${i.task})`
    if (i.state === 'open') out.push(`- open: ${i.path} still contains "${i.stale}" \u2014 ${i.claim} ${who}`)
    else if (i.state === 'unchecked') out.push(`- not checked: ${i.path} \u2014 ${i.claim} ${who}`)
  }
  return out
}

/** `pr-body <plan.md> [--plan-json <parse>] --events <file> [--evidence <url>] [--provenance <file>]` — the paragraph, an
 *  empty line, the receipt, an empty line, the closes; every line, including
 *  the two empty ones, ends in a newline. The provenance section follows the receipt, the loose
 *  ends follow that, a draft's reason follows that, and when any `jev:step` row exists, its table follows that. */
export function renderPrBody (planPath, eventsPath, evidenceUrl, provenancePath, planJson) {
  const planText = readFileSync(planPath, 'utf8')
  const summary = planSummaryLines(planText)
  const events = eventsPath ? readEventRows(eventsPath) : []
  const rows = receiptLines(planPath, planJson, events, evidenceUrl)
  const closes = planClosesLines(planText)
  let out = ''
  for (const line of summary) out += line + '\n'
  out += '\n'
  for (const line of rows) out += line + '\n'
  out += '\n'
  const provenance = provenanceLines(provenancePath)
  for (const line of provenance) out += line + '\n'
  if (provenance.length) out += '\n'
  const looseEnds = looseEndsLines(events)
  for (const line of looseEnds) out += line + '\n'
  if (looseEnds.length) out += '\n'
  const draft = draftReasonLines(events)
  for (const line of draft) out += line + '\n'
  if (draft.length) out += '\n'
  const readings = jevStepLines(events)
  for (const line of readings) out += line + '\n'
  if (readings.length) out += '\n'
  for (const line of closes) out += line + '\n'
  return out
}

/** The tokens after a subcommand, split into plain tokens and the file named
 *  by a `--events <file>` pair wherever it falls among them. */
function extractEvents (args) {
  const rest = []
  let eventsPath
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--events') {
      eventsPath = args[i + 1]
      i++
      continue
    }
    rest.push(args[i])
  }
  return { rest, eventsPath }
}

/** One line on stderr and exit 2 — an unknown subcommand or a missing
 *  argument, never a stack trace. */
function usageError (message) {
  process.stderr.write(`record: ${message}\n`)
  return 2
}

/** `node factory/record.mjs <subcommand> ...` — every subcommand writes only
 *  to stdout and exits 0 on success. */
export function main (argv) {
  const args = argv.slice(2)
  const subcommand = args[0]
  switch (subcommand) {
    case 'status': {
      const { rest, eventsPath } = extractEvents(args.slice(1))
      const fields = {}
      for (const token of rest) {
        const [key, value] = splitToken(token)
        fields[key] = value
      }
      process.stdout.write(renderStatus(fields, eventsPath) + '\n')
      return 0
    }
    case 'pr-body': {
      const planPath = args[1]
      if (planPath === undefined) return usageError('pr-body: missing <plan.md>')
      const { rest, eventsPath } = extractEvents(args.slice(2))
      const at = rest.indexOf('--evidence')
      const pv = rest.indexOf('--provenance')
      const pj = rest.indexOf('--plan-json')
      process.stdout.write(renderPrBody(planPath, eventsPath, at >= 0 ? rest[at + 1] : undefined,
        pv >= 0 ? rest[pv + 1] : undefined, pj >= 0 ? rest[pj + 1] : undefined))
      return 0
    }
    default:
      return usageError(`unknown subcommand '${subcommand ?? ''}'`)
  }
}

if (import.meta.main) { process.exitCode = main(process.argv) }

export default {
  renderStatus,
  renderPrBody,
  projectTasks,
  main
}

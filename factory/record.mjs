/**
 * factory/record.mjs — the boot's one renderer (#1167, #1205, #1222).
 *
 * `factory/boot.sh` decides everything about a run: what state it is in,
 * what its phase reads, whether a pull request is open, what its policy
 * allows. This module decides nothing — every subcommand below takes what
 * the boot already knows and turns it into the bytes the boot writes: one
 * event row, the twelve-cell status page, the pull request body, or the
 * three numbers `publish.self_merge` carries. Nothing here writes a file or
 * reads an environment variable; every subcommand prints one thing to
 * stdout and its exit code says whether that printing happened.
 *
 * `row` gives every end-of-run row its `ts` — the boot had one writer for
 * this at BASE (`event_row`) and this module is now the string it prints.
 * `status` is the same projection `ev_project`/`write_status` did over
 * `events.jsonl`, moved so the shell no longer parses JSON by hand. `pr-body`
 * is `plan_summary`/`ev_project rows`/`plan_closes` joined the way `pr_body`
 * joined them. `policy` is the read `read_self_merge_policy` did through a
 * Python heredoc, moved to the language already in the loop.
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

/** The bare-value rule `is_bare_value` states at BASE: a value that is
 *  exactly `null`, `true` or `false`, or that matches `/^-?[0-9]+$/`, is that
 *  JSON literal or number; every other value is a JSON string. */
function bareOrString (value) {
  if (value === 'null') return null
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^-?[0-9]+$/.test(value)) return Number(value)
  return value
}

/** One `{"key":value,...}` object, keys and values rendered in the order
 *  given — never a plain JS object, whose own key order reorders an
 *  integer-looking string key ahead of insertion order. */
function renderObject (entries) {
  return '{' + entries.map(([k, v]) => JSON.stringify(k) + ':' + JSON.stringify(v)).join(',') + '}'
}

/** `row <kind> [key=value ...]` — `{ts, kind, ...pairs}`, `ts` first, `kind`
 *  second, then the pairs in argument order, each value bare or a string. */
export function renderRow (kind, tokens) {
  const entries = [['ts', new Date().toISOString()], ['kind', kind]]
  for (const token of tokens) {
    const [key, raw] = splitToken(token)
    entries.push([key, bareOrString(raw)])
  }
  return renderObject(entries)
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

/** `pr-body <plan.md> [--plan-json <parse>] --events <file> [--evidence <url>] [--provenance <file>]` — the paragraph, an
 *  empty line, the receipt, an empty line, the closes; every line, including
 *  the two empty ones, ends in a newline. The provenance section follows the receipt,
 *  a draft's reason follows that, and when any `jev:step` row exists, its table follows that. */
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
  const draft = draftReasonLines(events)
  for (const line of draft) out += line + '\n'
  if (draft.length) out += '\n'
  const readings = jevStepLines(events)
  for (const line of readings) out += line + '\n'
  if (readings.length) out += '\n'
  for (const line of closes) out += line + '\n'
  return out
}

/** `publish.<key>` off the policy file at `policyPath`, when it is an object
 *  carrying an `enabled` key; a missing file, unparseable JSON, or any other
 *  shape reads as `null`, so each caller fails closed to disabled. */
function readPublishCell (policyPath, key) {
  let doc
  try {
    doc = JSON.parse(readFileSync(policyPath, 'utf8'))
  } catch {
    return null
  }
  const cell = doc && typeof doc === 'object' ? doc.publish && doc.publish[key] : undefined
  if (!cell || typeof cell !== 'object' || Array.isArray(cell) || !Object.prototype.hasOwnProperty.call(cell, 'enabled')) {
    return null
  }
  return cell
}

/** `policy <policy.json>` — `<enabled> <max_refolds> <mergeable_wait_seconds>`
 *  off `publish.self_merge`; a missing file, unparseable JSON, or a
 *  `self_merge` that is not an object carrying an `enabled` key reads as
 *  disabled, never a default a broken read falls into. */
export function renderPolicy (policyPath) {
  // the one place the boot's self-merge bounds default
  const MAX_REFOLDS = 3, WAIT_SECONDS = 120
  const sm = readPublishCell(policyPath, 'self_merge')
  if (!sm) return `0 ${MAX_REFOLDS} ${WAIT_SECONDS}`
  const enabled = sm.enabled ? 1 : 0
  const maxRefolds = sm.max_refolds === undefined ? MAX_REFOLDS : Math.trunc(Number(sm.max_refolds))
  const waitSeconds = sm.mergeable_wait_seconds === undefined ? WAIT_SECONDS : Math.trunc(Number(sm.mergeable_wait_seconds))
  return `${enabled} ${maxRefolds} ${waitSeconds}`
}

/** `publish-policy <policy.json>` — `<enabled> <timeout_seconds>` off
 *  `publish.probe`; a missing file, unparseable JSON, or a `probe` that is
 *  not an object carrying an `enabled` key reads as disabled (`0 600`),
 *  never a default a broken read falls into — the same rule `policy` reads
 *  `publish.self_merge` by. */
export function renderPublishPolicy (policyPath) {
  const probe = readPublishCell(policyPath, 'probe')
  if (!probe) return '0 600'
  const enabled = probe.enabled ? 1 : 0
  const timeoutSeconds = probe.timeout_seconds === undefined ? 600 : Math.trunc(Number(probe.timeout_seconds))
  return `${enabled} ${timeoutSeconds}`
}

/** The three command strings off `plan_parse.py`'s own `publish` object —
 *  read from `jsonText`, its full stdout (`{..., "publish": {"deploy",
 *  "verify", "rollback"} | null}`) — one per line, an absent command (the
 *  plan named no `**Publish:**` line, or that particular line) an empty
 *  line; unparseable input reads as three empty lines, same as a null
 *  `publish`. */
export function renderPublishCmds (jsonText) {
  let doc
  try {
    doc = JSON.parse(jsonText)
  } catch {
    doc = null
  }
  const publish = doc && typeof doc === 'object' ? doc.publish : null
  const strOr = (v) => (publish && typeof publish === 'object' && typeof v === 'string' ? v : '')
  const deploy = publish && typeof publish === 'object' ? strOr(publish.deploy) : ''
  const verify = publish && typeof publish === 'object' ? strOr(publish.verify) : ''
  const rollback = publish && typeof publish === 'object' ? strOr(publish.rollback) : ''
  return `${deploy}\n${verify}\n${rollback}`
}

/** `publish-json url=… published=… deployCmd=… deployExit=… deployMs=…
 *  [verifyCmd=… verifyExit=… verifyMs=…] [rollbackCmd=… rollbackExit=…]` —
 *  the object the boot's publish probe used to build by hand:
 *  `{"url", "published", "deploy": {"cmd","exit","ms"},
 *  "verify": {"cmd","exit","ms"}|null, "rollback": {"cmd","exit"}|null}`.
 *  `verify` is an object only when `verifyExit` was given (the deploy
 *  produced a URL and a live check ran); `rollback` is an object only when
 *  `rollbackExit` was given (the check went red and a rollback command was
 *  named). */
export function renderPublishJson (tokens) {
  const fields = {}
  for (const token of tokens) {
    const [key, value] = splitToken(token)
    fields[key] = value
  }
  const url = fields.url === undefined || fields.url === '' || fields.url === 'null' ? null : fields.url
  const published = fields.published === 'true'
  const deploy = {
    cmd: fields.deployCmd ?? '',
    exit: fields.deployExit === undefined ? null : Math.trunc(Number(fields.deployExit)),
    ms: fields.deployMs === undefined ? null : Math.trunc(Number(fields.deployMs))
  }
  let verify = null
  if (fields.verifyExit !== undefined) {
    verify = {
      cmd: fields.verifyCmd ?? '',
      exit: Math.trunc(Number(fields.verifyExit)),
      ms: fields.verifyMs === undefined ? null : Math.trunc(Number(fields.verifyMs))
    }
  }
  let rollback = null
  if (fields.rollbackExit !== undefined) {
    rollback = {
      cmd: fields.rollbackCmd ?? '',
      exit: Math.trunc(Number(fields.rollbackExit))
    }
  }
  return JSON.stringify({ url, published, deploy, verify, rollback })
}

/** `pr-payload title=… head=… base=… body=… draft=…` — the five-key object
 *  the boot's `publish` used to build by hand: the four named strings always
 *  rendered as JSON strings (never the bare-value rule `row` applies), a
 *  missing key an empty string, and `draft` the boolean `true` only when the
 *  token is exactly `draft=true`. */
export function renderPrPayload (tokens) {
  const fields = {}
  for (const token of tokens) {
    const [key, value] = splitToken(token)
    fields[key] = value
  }
  return JSON.stringify({
    title: fields.title ?? '',
    head: fields.head ?? '',
    base: fields.base ?? '',
    body: fields.body ?? '',
    draft: fields.draft === 'true'
  })
}

/** `merge-payload title=… sha=…` — the object `maybe_self_merge` used to
 *  build by hand; a missing key an empty string. */
export function renderMergePayload (tokens) {
  const fields = {}
  for (const token of tokens) {
    const [key, value] = splitToken(token)
    fields[key] = value
  }
  return JSON.stringify({
    merge_method: 'squash',
    commit_title: fields.title ?? '',
    sha: fields.sha ?? ''
  })
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
    case 'row': {
      const kind = args[1]
      if (kind === undefined) return usageError('row: missing <kind>')
      process.stdout.write(renderRow(kind, args.slice(2)) + '\n')
      return 0
    }
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
    case 'policy': {
      const policyPath = args[1]
      if (policyPath === undefined) return usageError('policy: missing <policy.json>')
      process.stdout.write(renderPolicy(policyPath) + '\n')
      return 0
    }
    case 'publish-policy': {
      const policyPath = args[1]
      if (policyPath === undefined) return usageError('publish-policy: missing <policy.json>')
      process.stdout.write(renderPublishPolicy(policyPath) + '\n')
      return 0
    }
    case 'publish-cmds': {
      const jsonText = readFileSync(0, 'utf8')
      process.stdout.write(renderPublishCmds(jsonText) + '\n')
      return 0
    }
    case 'publish-json': {
      process.stdout.write(renderPublishJson(args.slice(1)) + '\n')
      return 0
    }
    case 'pr-payload': {
      process.stdout.write(renderPrPayload(args.slice(1)) + '\n')
      return 0
    }
    case 'merge-payload': {
      process.stdout.write(renderMergePayload(args.slice(1)) + '\n')
      return 0
    }
    default:
      return usageError(`unknown subcommand '${subcommand ?? ''}'`)
  }
}

if (import.meta.main) { process.exitCode = main(process.argv) }

export default {
  renderRow,
  renderStatus,
  renderPrBody,
  renderPolicy,
  renderPublishPolicy,
  renderPublishCmds,
  renderPublishJson,
  renderPrPayload,
  renderMergePayload,
  projectTasks,
  main
}

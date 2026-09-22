/**
 * factory/record.mjs — the boot's one renderer (#1167, #1205, #1222).
 *
 * `factory/boot.sh` decides everything about a run: what state it is in,
 * what its phase reads, whether a pull request is open, what its policy
 * allows. This module decides nothing — every subcommand below takes what
 * the boot already knows and turns it into the bytes the boot writes: one
 * event row, the thirteen-cell status page, the pull request body, or the
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
 *  parse is skipped, and a file that is missing or empty gives no rows. */
function readEventRows (eventsPath) {
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
      // A line that does not parse is skipped — the projection is a fact
      // over what did land, not a reason to fail over what didn't.
    }
  }
  return rows
}

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
    tasks[id] = {
      wave: null,
      state: state[id],
      role: null,
      lastProof: null,
      park: park[id],
      attention: null,
      blockedBy: null
    }
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

/** `status key=value ... --events <file>` — the thirteen-cell page, `tasks`
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
    ['disclosures', null],
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

/** `| <task> | <k> | <examExit> | <candidateSha> |` for every `landing` row
 *  of the events file, in file order; no file gives no rows. */
function landingRowLines (eventsPath) {
  if (!eventsPath) return []
  const rows = readEventRows(eventsPath)
  const out = []
  for (const row of rows) {
    if (row && row.kind === 'landing') {
      out.push(`| ${cellText(row.task)} | ${cellText(row.k)} | ${cellText(row.examExit)} | ${cellText(row.candidateSha)} |`)
    }
  }
  return out
}

/** `pr-body <plan.md> --events <file>` — the paragraph, an empty line, the
 *  rows, an empty line, the closes; every line, including the two empty
 *  ones, ends in a newline. */
export function renderPrBody (planPath, eventsPath) {
  const planText = readFileSync(planPath, 'utf8')
  const summary = planSummaryLines(planText)
  const rows = landingRowLines(eventsPath)
  const closes = planClosesLines(planText)
  let out = ''
  for (const line of summary) out += line + '\n'
  out += '\n'
  for (const line of rows) out += line + '\n'
  out += '\n'
  for (const line of closes) out += line + '\n'
  return out
}

/** `policy <policy.json>` — `<enabled> <max_refolds> <mergeable_wait_seconds>`
 *  off `publish.self_merge`; a missing file, unparseable JSON, or a
 *  `self_merge` that is not an object carrying an `enabled` key reads as
 *  disabled, never a default a broken read falls into. */
export function renderPolicy (policyPath) {
  let doc
  try {
    doc = JSON.parse(readFileSync(policyPath, 'utf8'))
  } catch {
    return '0 3 120'
  }
  const sm = doc && typeof doc === 'object' ? doc.publish && doc.publish.self_merge : undefined
  if (!sm || typeof sm !== 'object' || Array.isArray(sm) || !Object.prototype.hasOwnProperty.call(sm, 'enabled')) {
    return '0 3 120'
  }
  const enabled = sm.enabled ? 1 : 0
  const maxRefolds = sm.max_refolds === undefined ? 3 : Math.trunc(Number(sm.max_refolds))
  const waitSeconds = sm.mergeable_wait_seconds === undefined ? 120 : Math.trunc(Number(sm.mergeable_wait_seconds))
  return `${enabled} ${maxRefolds} ${waitSeconds}`
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
      const { eventsPath } = extractEvents(args.slice(2))
      process.stdout.write(renderPrBody(planPath, eventsPath))
      return 0
    }
    case 'policy': {
      const policyPath = args[1]
      if (policyPath === undefined) return usageError('policy: missing <policy.json>')
      process.stdout.write(renderPolicy(policyPath) + '\n')
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

export default { renderRow, renderStatus, renderPrBody, renderPolicy, renderPrPayload, renderMergePayload, projectTasks, main }

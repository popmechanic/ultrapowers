import { readFileSync } from 'node:fs'
import { readEventRows } from './flock/io.mjs'
import { parsedPlan } from './flock/plan.mjs'
import { renderView } from './view.mjs'

function splitToken (token) {
  const idx = token.indexOf('=')
  if (idx === -1) return [token, '']
  return [token.slice(0, idx), token.slice(idx + 1)]
}

function renderObject (entries) {
  return '{' + entries.map(([k, v]) => JSON.stringify(k) + ':' + JSON.stringify(v)).join(',') + '}'
}

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

function stringOrNull (value) {
  return value === undefined || value === '' ? null : value
}

function stringOrEmpty (value) {
  return value === undefined ? '' : value
}

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

function planClosesLines (planText) {
  const line = planClosesLine(planText)
  if (line == null) return []
  const matches = line.match(/#[0-9]+/g) || []
  return matches.map((m) => `Closes ${m}`)
}

function cellText (value) {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function planProbes (planPath, planJson) {
  let parsed
  try { parsed = parsedPlan(planPath, planJson) } catch { return null }
  return (parsed.tasks || []).map((t) => ({
    id: String(t.id),
    probes: (t.proofRuns || []).map((cmd, i) => ({ cmd, proves: ((t.proofRunClauses || [])[i] || []).join(', ') })),
  }))
}

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

function lineCount (lines) {
  const m = /^(\d+)(?:-(\d+))?$/.exec(String(lines ?? ''))
  if (!m) return 0
  return m[2] === undefined ? 1 : Math.max(0, Number(m[2]) - Number(m[1]) + 1)
}

function provenanceLines (provenancePath) {
  if (!provenancePath) return []
  let prov
  try { prov = JSON.parse(readFileSync(provenancePath, 'utf8')) } catch { return [] }
  if (!prov || typeof prov !== 'object') return []
  const hunks = Array.isArray(prov.hunks) ? prov.hunks : []
  const changed = hunks.reduce((n, h) => n + lineCount(h && h.lines), 0)
  const tasks = new Set(hunks.filter((h) => h && h.task !== undefined).flatMap((h) => String(h.task).split('|'))).size
  const kinds = { contested: 0, lost: 0, ordered: 0, foreign: 0 }
  for (const e of Array.isArray(prov.exceptions) ? prov.exceptions : []) {
    if (e && Object.hasOwn(kinds, e.kind)) kinds[e.kind]++
  }
  return ['### Provenance', '',
    `${changed} changed lines from ${tasks} tasks; exceptions: ${kinds.contested} contested, ${kinds.lost} lost, ${kinds.ordered} ordered, ${kinds.foreign} foreign.`]
}

const BODY_CAP = 60000
const VALUE_CAP = 500

function safeText (value) {
  let text = cellText(value).replace(/[^\S ]+/g, ' ')
  if (text.length > VALUE_CAP) text = text.slice(0, VALUE_CAP - 1) + '…'
  return text.replace(/</g, '&lt;').replace(/#(?=\d)/g, '\\#')
}

function looseEndsLines (events) {
  const row = events.filter((r) => r && r.kind === 'loose-ends').at(-1)
  const items = row && Array.isArray(row.items) ? row.items.filter((i) => i && typeof i === 'object') : []
  const fb = events.filter((r) => r && r.kind === 'loose:fallback').at(-1)
  if (!items.length && !fb) return []
  const resolved = items.filter((i) => i.state === 'resolved').length
  const out = ['### Loose ends', '', `${items.length} reported by builders, ${resolved} resolved in the run.`]
  for (const i of items) {
    const who = i.task === undefined || i.task === null || i.task === '' ? `(${safeText(i.by)})` : `(${safeText(i.by)}, task ${safeText(i.task)})`
    if (i.state === 'open') out.push(`- open: ${safeText(i.path)} still contains "${safeText(i.stale)}" \u2014 ${safeText(i.claim)} ${who}`)
    else if (i.state === 'unchecked') out.push(`- not checked: ${safeText(i.path)} \u2014 ${safeText(i.claim)} ${who}`)
  }
  if (fb) {
    const end = events.filter((r) => r && r.kind === 'terminal').at(-1)
    out.push('', !end
      ? 'The run ended before its outcome was recorded.'
      : end.pr === 'ready' && end.snap === fb.snap
        ? `The cleanup was dropped: ${fb.why}. This lands ${fb.snap}, the snapshot that was green before it.`
        : `The cleanup's fallback was itself drafted: ${end.why ? end.why : fb.why}.`)
  }
  return out
}

export function renderPrBody (planPath, eventsPath, evidenceUrl, provenancePath, planJson) {
  const planText = readFileSync(planPath, 'utf8')
  const summary = planSummaryLines(planText)
  const events = eventsPath ? readEventRows(eventsPath) : []
  const rows = receiptLines(planPath, planJson, events, evidenceUrl)
  const closes = planClosesLines(planText)
  const provenance = provenanceLines(provenancePath)
  let looseEnds = looseEndsLines(events)
  const draft = draftReasonLines(events)
  const assemble = () => {
    let out = ''
    for (const line of summary) out += line + '\n'
    out += '\n'
    for (const line of rows) out += line + '\n'
    out += '\n'
    for (const section of [provenance, looseEnds, draft]) {
      for (const line of section) out += line + '\n'
      if (section.length) out += '\n'
    }
    for (const line of closes) out += line + '\n'
    return out
  }
  const whole = assemble()
  if (whole.length <= BODY_CAP) return whole
  const fullLoose = looseEnds
  looseEnds = looseEnds.filter((l) => !isItem(l))
  const room = BODY_CAP - assemble().length
  looseEnds = cutItems(fullLoose, room, evidenceUrl)
  return assemble()
}

const isItem = (line) => line.startsWith('- ')

function cutItems (lines, budget, evidenceUrl) {
  const total = lines.filter(isItem).length
  const note = (n) => `- and ${n} more not shown${evidenceUrl ? `; the evidence holds them all: ${evidenceUrl}` : '.'}`
  let left = budget - (note(total).length + 1)
  const out = []
  let dropped = 0
  let noted = false
  for (const line of lines) {
    if (!isItem(line)) {
      if (dropped && !noted) { out.push(note(dropped)); noted = true }
      out.push(line)
    } else if (!dropped && line.length + 1 <= left) {
      left -= line.length + 1
      out.push(line)
    } else dropped++
  }
  if (dropped && !noted) out.push(note(dropped))
  return out
}

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

function jsonFileOrNull (filePath) {
  if (!filePath) return null
  try { return JSON.parse(readFileSync(filePath, 'utf8')) } catch { return null }
}

function usageError (message) {
  process.stderr.write(`record: ${message}\n`)
  return 2
}

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
    case 'view': {
      const { rest, eventsPath } = extractEvents(args.slice(1))
      const fields = {}
      const files = {}
      for (let i = 0; i < rest.length; i++) {
        if (['--status', '--plan-json', '--summary'].includes(rest[i])) { files[rest[i]] = rest[i + 1]; i++; continue }
        const [key, value] = splitToken(rest[i])
        fields[key] = value
      }
      const run = /^[0-9]+$/.test(fields.run ?? '') ? Number(fields.run) : (fields.run ?? null)
      process.stdout.write(JSON.stringify(renderView({
        run,
        target: fields.target ?? null,
        rows: eventsPath ? readEventRows(eventsPath) : [],
        status: jsonFileOrNull(files['--status']),
        plan: jsonFileOrNull(files['--plan-json']),
        summary: jsonFileOrNull(files['--summary'])
      })) + '\n')
      return 0
    }
    default:
      return usageError(`unknown subcommand '${subcommand ?? ''}'`)
  }
}

if (import.meta.main) { process.exitCode = main(process.argv) }

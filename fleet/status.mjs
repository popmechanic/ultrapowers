#!/usr/bin/env node
// One-shot run-position readout (2026-09-01 papercut: the drive log's flat
// `status=running spend=N` line hides waves and workers, so every "where is
// the run?" answer meant raw-SQL over the TinyBase store and hand-unwrapping
// MergeableStore JSON). Usage, typically over ssh to the orchestrator:
//
//   node fleet/status.mjs run-45 [--db /tmp/fleet-orch-live/fleet.db] [--last 12]
//   node fleet/status.mjs run-45 --store-json <file>   # test seam, no sqlite
//
// Read-only. Prints one line per event: HH:MM kind label/phase class.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// A MergeableStore serializes every node as [value, hlc, hash]; unwrap peels
// those stamps without disturbing plain arrays that are actual values.
const unwrap = (x) => {
  while (Array.isArray(x)) x = x[0]
  return x
}

const findEvents = (node) => {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    if (node.events) return node.events
    for (const v of Object.values(node)) {
      const r = findEvents(v)
      if (r) return r
    }
  } else if (Array.isArray(node)) {
    for (const v of node) {
      const r = findEvents(v)
      if (r) return r
    }
  }
  return null
}

export const runEvents = (storeJson, runId) => {
  let events = findEvents(storeJson)
  while (Array.isArray(events)) events = events[0]
  if (!events) return []
  const rows = []
  for (const [key, node] of Object.entries(events)) {
    if (!key.startsWith(runId + ':')) continue
    let cells = node
    while (Array.isArray(cells)) cells = cells[0]
    const row = {}
    for (const [ck, cv] of Object.entries(cells)) row[ck] = unwrap(cv)
    rows.push(row)
  }
  rows.sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')))
  return rows
}

export const renderLine = (row) => {
  const t = typeof row.ts === 'number'
    ? new Date(row.ts).toISOString().slice(11, 16) : '--:--'
  return [t, row.kind || '', row.label || row.phase || '', row.class || '']
    .join(' ').trimEnd()
}

const main = () => {
  const argv = process.argv.slice(2)
  const runId = argv.find((a) => !a.startsWith('--'))
  const opt = (name, dflt) => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : dflt
  }
  if (!runId) {
    console.error('usage: status.mjs <runId> [--db path] [--last N] [--store-json file]')
    process.exit(2)
  }
  const last = Number(opt('--last', '12'))
  const jsonFile = opt('--store-json', null)
  let raw
  if (jsonFile) {
    raw = readFileSync(jsonFile, 'utf8')
  } else {
    const db = opt('--db', '/tmp/fleet-orch-live/fleet.db')
    const proc = spawnSync('sqlite3', [db, 'SELECT store FROM tinybase LIMIT 1'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    if (proc.status !== 0) {
      console.error('status: cannot read store at ' + db + ': ' +
        (proc.stderr || 'sqlite3 exit ' + proc.status).trim())
      process.exit(2)
    }
    raw = proc.stdout
  }
  const rows = runEvents(JSON.parse(raw), runId)
  if (!rows.length) {
    console.log(runId + ': no events in the store')
    return
  }
  for (const row of rows.slice(-last)) console.log(renderLine(row))
  console.log(`(${rows.length} event(s) total for ${runId})`)
}

if (import.meta.url === 'file://' + process.argv[1]) main()

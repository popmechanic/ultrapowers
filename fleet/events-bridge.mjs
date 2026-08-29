// fleet/events-bridge.mjs — the run's event log, promoted to store rows (#421).
//
// The richest state a run produces — worker start/end with token meters,
// engine phases, driver stages, capture errors — is written to
// `<runDir>/events.jsonl` on the sandbox and, before this module, never left
// the box until teardown: observing a live run meant SSH-ing two hops to tail
// a file. The store substrate for live push already exists (the TinyBase
// MergeableStore synced through the orchestrator's ws-server); this module is
// the missing plumbing: each JSONL line becomes one row in an `events` table,
// and the store's own sync carries it to every subscriber (the orchestrator,
// and the laptop watch client — fleet/watch.mjs).
//
// STORE DISCIPLINE (fleet/store.mjs, the row/cell axis rule): events are
// EVIDENCE, so they are a grow-only SET — one row per event, rowId =
// `<runId>:<eventId>` (the event's own ULID: time-sortable, collision-free,
// writer-unique), written once and never updated. Nothing here is ever a
// register; a consumer wanting "the latest phase" folds over the rows at read
// time, exactly like `totalSpent`.
//
// The promoter POLLS THE LOCAL FILE — deliberately. The anti-pattern #421
// names is the *human/laptop* polling over SSH; a 1-second stat of a local
// file on the box that writes it is how the file becomes push for everyone
// downstream. fs.watch is not used: it is unreliable across the containers
// and filesystems sandboxes run on, and a 1 s bound on staleness is enough.
import fs from 'node:fs'

// Cells must be small scalars (the store syncs every byte to every peer, and
// a multi-KB engine:log line is evidence for the file, not the live view).
const CELL_MAX = 400
const truncate = (s) => {
  const str = String(s)
  return str.length > CELL_MAX ? str.slice(0, CELL_MAX) + '…' : str
}

/**
 * Flatten one event-log record into a row of scalar cells. Top-level scalars
 * are carried (strings truncated); the worker meter object is flattened to
 * meter* numbers; everything else (nested objects, arrays) is dropped — the
 * full record stays in events.jsonl, which remains the durable evidence.
 */
export function eventToRow(e, runId) {
  const row = { runId }
  for (const [k, v] of Object.entries(e)) {
    if (k === 'meter' && v && typeof v === 'object') {
      for (const mk of ['input', 'output', 'cacheRead', 'cacheCreation', 'costUsd']) {
        if (typeof v[mk] === 'number') row['meter' + mk[0].toUpperCase() + mk.slice(1)] = v[mk]
      }
      continue
    }
    if (typeof v === 'string') row[k] = truncate(v)
    else if (typeof v === 'number' || typeof v === 'boolean') row[k] = v
  }
  return row
}

/**
 * Start promoting appended events.jsonl lines into `store`'s `events` table.
 *
 * Tolerates the file not existing yet (the engine opens it after preflight),
 * partial trailing lines (kept in a remainder buffer until their newline
 * arrives), and unparsable lines (skipped — the file is the authority, the
 * store is the live view). Returns { stop, flush }: `flush()` drains whatever
 * is on disk right now (call it once after the engine exits, before the store
 * delivers), `stop()` ends the interval.
 */
export function startEventPromoter({ store, runId, file, intervalMs = 1000, setRow }) {
  const put = setRow || ((table, rowId, row) => store.setRow(table, rowId, row))
  let offset = 0
  let remainder = ''
  let seq = 0 // fallback rowId disambiguator for a record missing its ULID
  const drain = () => {
    let size
    try { size = fs.statSync(file).size } catch { return } // not written yet
    if (size < offset) { offset = 0; remainder = '' } // truncated/rewritten: reread
    if (size === offset) return
    let chunk
    try {
      const fd = fs.openSync(file, 'r')
      try {
        const buf = Buffer.alloc(size - offset)
        fs.readSync(fd, buf, 0, buf.length, offset)
        chunk = buf.toString('utf8')
      } finally { fs.closeSync(fd) }
    } catch { return }
    offset = size
    const text = remainder + chunk
    const lines = text.split('\n')
    remainder = lines.pop() // '' when the chunk ended on a newline
    for (const line of lines) {
      if (!line.trim()) continue
      let e
      try { e = JSON.parse(line) } catch { continue }
      seq += 1
      const id = (typeof e.id === 'string' && e.id) ? e.id : ('noid-' + String(seq).padStart(8, '0'))
      put('events', runId + ':' + id, eventToRow(e, runId))
    }
  }
  const timer = setInterval(drain, intervalMs)
  // unref: the promoter must never hold the shim process open past teardown.
  if (typeof timer.unref === 'function') timer.unref()
  return {
    flush: drain,
    stop: () => { clearInterval(timer); drain() },
  }
}

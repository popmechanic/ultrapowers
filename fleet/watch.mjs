#!/usr/bin/env node
// fleet/watch.mjs — the laptop as a live sync peer (#421, the observability MVP).
//
// Subscribes a read-only MergeableStore to the orchestrator's ws-server and
// renders the run live: run-row transitions (status / branch / receipts) and
// every `events` row the sandbox-side promoter (fleet/events-bridge.mjs)
// pushes — worker start/end with token meters, engine phases, driver stages.
// State PUSHES here; nothing polls anything.
//
//   node fleet/watch.mjs --url 'ws://127.0.0.1:8180/fleet?token=…' [--run run-27]
//   node fleet/watch.mjs --observer /tmp/fleet-orch-live/observer.json [--run run-27]
//
// From a laptop, tunnel first (the ws-server binds on the orchestrator host):
//   ssh -N -L 8180:127.0.0.1:8180 fleet-orchestrator.exe.xyz &
//   ssh fleet-orchestrator.exe.xyz 'cat /tmp/fleet-orch-live/observer.json' > /tmp/observer.json
//   node fleet/watch.mjs --observer /tmp/observer.json
//
// READ-ONLY by construction: this peer never writes a row, so the worst a
// stray watch client can do to a run is nothing.
import fs from 'node:fs'
import { WebSocket } from 'ws'
import { createMergeableStore } from 'tinybase'
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client'

// ── pure render helpers (unit-tested; the ws wiring below is thin) ──────────
export const eventLine = (rowId, row) => {
  const id = rowId.slice(rowId.indexOf(':') + 1)
  const t = typeof row.ts === 'number' ? new Date(row.ts).toISOString().slice(11, 19) : '--:--:--'
  const kind = row.kind || '?'
  if (kind === 'worker:start') return `${t} ▶ ${row.label} (${row.role}${row.model ? ', ' + row.model : ''})`
  if (kind === 'worker:end') {
    const meter = (typeof row.meterOutput === 'number') ? ` · ${row.meterOutput} out tok` : ''
    return `${t} ■ ${row.label} → ${row.outcome}/${row.class}${meter}`
  }
  if (kind === 'engine:phase') return `${t} ── phase: ${row.phase}`
  if (kind === 'driver:stage') return `${t} ·· ${row.stage}${row.detail ? ' — ' + row.detail : ''}`
  if (kind === 'driver:fail') return `${t} ✗ ${row.verdict} — ${row.detail || ''}`
  if (kind === 'engine:log') return `${t}    ${row.line || ''}`
  return `${t}    ${kind} ${id}`
}

// Sort key: the ULID after `<runId>:` is time-ordered by construction.
export const sortRowIds = (ids) => ids.slice().sort((a, b) => {
  const ka = a.slice(a.indexOf(':') + 1), kb = b.slice(b.indexOf(':') + 1)
  return ka < kb ? -1 : ka > kb ? 1 : 0
})

export function parseArgs(argv) {
  const opts = { url: null, run: null, observer: null }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--url') opts.url = argv[++i]
    else if (argv[i] === '--run') opts.run = argv[++i]
    else if (argv[i] === '--observer') opts.observer = argv[++i]
    else throw new Error('watch: unknown arg ' + argv[i])
  }
  if (!opts.url && opts.observer) {
    opts.url = JSON.parse(fs.readFileSync(opts.observer, 'utf8')).url
  }
  if (!opts.url) throw new Error('watch: --url or --observer required')
  return opts
}

// ── main ────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())
if (isMain) {
  const { url, run } = parseArgs(process.argv.slice(2))
  const store = createMergeableStore('watch-client')
  const socket = new WebSocket(url)
  const seen = new Set()
  const runFilter = (rowId, row) => !run || rowId.startsWith(run + ':') || row.runId === run

  const renderNew = () => {
    const table = store.getTable('events') || {}
    for (const rowId of sortRowIds(Object.keys(table))) {
      if (seen.has(rowId)) continue
      const row = table[rowId]
      if (!runFilter(rowId, row)) { seen.add(rowId); continue }
      seen.add(rowId)
      console.log(eventLine(rowId, row))
    }
  }
  const runsSeen = new Map()
  const renderRuns = () => {
    const runs = store.getTable('runs') || {}
    for (const [runId, row] of Object.entries(runs)) {
      if (run && runId !== run) continue
      const sig = JSON.stringify([row.status, row.branch, row.pullRequestUrl, row.reportedTokens])
      if (runsSeen.get(runId) === sig) continue
      runsSeen.set(runId, sig)
      console.log(`● ${runId}: status=${row.status || '?'}` +
        (row.branch && row.branch !== 'pending' ? ` branch=${row.branch}` : '') +
        (typeof row.reportedTokens === 'number' ? ` tokens=${row.reportedTokens}` : '') +
        (row.pullRequestUrl ? ` PR=${row.pullRequestUrl}` : ''))
    }
  }

  socket.on('open', async () => {
    const synchronizer = await createWsSynchronizer(store, socket)
    await synchronizer.startSync()
    console.log('watch: synced — live' + (run ? ` (run ${run})` : ''))
    store.addTablesListener(() => { renderRuns(); renderNew() })
    renderRuns(); renderNew()
  })
  socket.on('error', (e) => { console.error('watch: socket error — ' + e.message); process.exit(1) })
  socket.on('close', () => { console.error('watch: connection closed'); process.exit(0) })
}

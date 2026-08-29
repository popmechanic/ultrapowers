// fleet/tests/test_events_bridge.mjs — events.jsonl → store rows (#421).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eventToRow, startEventPromoter } from '../events-bridge.mjs'
import { eventLine, sortRowIds, parseArgs } from '../watch.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'events-bridge-'))

// ── eventToRow: scalars carried, meter flattened, nests dropped ─────────────
{
  const row = eventToRow({
    kind: 'worker:end', id: '01ABC', ts: 123, label: 'impl:T1', role: 'implementer',
    exitCode: 0, timedOut: false, outcome: 'ok', class: 'success', status: null,
    meter: { input: 10, output: 20, cacheRead: 30, cacheCreation: 40, costUsd: 0.5, models: ['x'] },
  }, 'run-9')
  assert.equal(row.runId, 'run-9')
  assert.equal(row.kind, 'worker:end')
  assert.equal(row.meterOutput, 20)
  assert.equal(row.meterCostUsd, 0.5)
  assert.ok(!('meter' in row), 'the meter object itself is flattened away')
  assert.ok(!('status' in row), 'null is not a scalar cell')
  assert.equal(row.timedOut, false, 'booleans are carried')
}
// Long strings truncate: cells sync to every peer; the file keeps the truth.
{
  const row = eventToRow({ kind: 'engine:log', id: 'x', line: 'y'.repeat(5000) }, 'r')
  assert.ok(row.line.length < 500, 'long cells are truncated')
}

// ── the promoter: appends, partial lines, missing file, final drain ─────────
{
  const file = path.join(tmp, 'events.jsonl')
  const rows = new Map()
  const promoter = startEventPromoter({
    runId: 'run-9', file, intervalMs: 3600_000, // manual flush only
    setRow: (table, rowId, row) => { assert.equal(table, 'events'); rows.set(rowId, row) },
  })
  promoter.flush() // file does not exist yet — no throw, no rows
  assert.equal(rows.size, 0)

  fs.writeFileSync(file, JSON.stringify({ kind: 'run:open', id: '01A', ts: 1 }) + '\n')
  promoter.flush()
  assert.equal(rows.size, 1)
  assert.ok(rows.has('run-9:01A'), 'rowId = <runId>:<eventId> (row axis, grow-only)')

  // A partial trailing line is held until its newline arrives.
  fs.appendFileSync(file, '{"kind":"engine:phase","id":"01B"')
  promoter.flush()
  assert.equal(rows.size, 1, 'partial line not promoted')
  fs.appendFileSync(file, ',"phase":"Setup"}\n{"kind":"engine:log","id":"01C","line":"x"}\n')
  promoter.flush()
  assert.equal(rows.size, 3)
  assert.equal(rows.get('run-9:01B').phase, 'Setup')

  // An unparsable line is skipped; later lines still land.
  fs.appendFileSync(file, 'not json\n' + JSON.stringify({ kind: 'driver:stage', id: '01D', stage: 'gate' }) + '\n')
  promoter.stop() // stop() drains once more
  assert.equal(rows.size, 4)
  assert.equal(rows.get('run-9:01D').stage, 'gate')

  // A record with no ULID still gets a unique (non-colliding) rowId.
  const rows2 = new Map()
  const p2 = startEventPromoter({ runId: 'r', file: path.join(tmp, 'e2.jsonl'), intervalMs: 3600_000,
    setRow: (t, id, r) => rows2.set(id, r) })
  fs.writeFileSync(path.join(tmp, 'e2.jsonl'), '{"kind":"a"}\n{"kind":"b"}\n')
  p2.stop()
  assert.equal(rows2.size, 2, 'id-less events do not clobber each other')
}

// ── watch render helpers ────────────────────────────────────────────────────
{
  assert.match(eventLine('r:01A', { kind: 'worker:start', ts: 0, label: 'impl:T1', role: 'implementer', model: 'opus' }),
    /impl:T1 \(implementer, opus\)/)
  assert.match(eventLine('r:01B', { kind: 'worker:end', ts: 0, label: 'impl:T1', outcome: 'ok', class: 'success', meterOutput: 42 }),
    /ok\/success · 42 out tok/)
  assert.match(eventLine('r:01C', { kind: 'driver:stage', ts: 0, stage: 'gate' }), /·· gate/)
  const sorted = sortRowIds(['r:01C', 'r:01A', 'r:01B'])
  assert.deepEqual(sorted, ['r:01A', 'r:01B', 'r:01C'], 'ULID order is chronological')
  const obs = path.join(tmp, 'observer.json')
  fs.writeFileSync(obs, JSON.stringify({ url: 'ws://x/fleet?token=t' }))
  assert.equal(parseArgs(['--observer', obs, '--run', 'run-9']).url, 'ws://x/fleet?token=t')
  assert.throws(() => parseArgs([]), /--url or --observer required/)
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')

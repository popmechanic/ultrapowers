#!/usr/bin/env node
// factory/flock/step_receipts.mjs's latestResults (#1532): a step's receipt is the edge's own checker
// result (`<clause>@edge.json`) when the edge wrote one, even when a builder's copy wrote a newer file
// for the same clause; a clause no edge result names falls back to the newest file by mtime.
// Prints `ALL TESTS PASSED` and exits 0, or names what differed and exits 1.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { latestResults, stepReceipts } from '../../factory/flock/step_receipts.mjs'

const fails = []
const assert = (ok, why) => { if (!ok) fails.push(why) }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'step-receipts-'))
const put = (name, r, secondsAgo) => {
  const p = path.join(dir, name)
  fs.writeFileSync(p, JSON.stringify(r))
  const t = new Date(Date.now() - secondsAgo * 1000)
  fs.utimesSync(p, t, t)
}
// S1.1: the edge's result is the older file; a builder's copy wrote after it.
put('S1.1@edge.json', { clause: 'S1.1', exit: 0, diff: [{ cell: 'from-edge' }] }, 60)
put('S1.1@b1.json', { clause: 'S1.1', exit: 1, diff: [{ cell: 'from-b1' }] }, 5)
// S1.2: no edge result; two builder copies, the newest wins.
put('S1.2@b1.json', { clause: 'S1.2', exit: 1, diff: [{ cell: 'older' }] }, 60)
put('S1.2@b2.json', { clause: 'S1.2', exit: 0, diff: [{ cell: 'newer' }] }, 5)

const got = latestResults(dir)
assert(got.get('S1.1')?.diff?.[0]?.cell === 'from-edge', `S1.1 should come from the edge: ${JSON.stringify(got.get('S1.1'))}`)
assert(got.get('S1.2')?.diff?.[0]?.cell === 'newer', `S1.2 should be the newest copy's: ${JSON.stringify(got.get('S1.2'))}`)
const rows = stepReceipts([...got.values()])
assert(rows.length === 2 && rows[0].clause === 'S1.1' && rows[0].exit === 0, `receipts: ${JSON.stringify(rows)}`)

fs.rmSync(dir, { recursive: true, force: true })
if (fails.length) { for (const f of fails) console.log(`FAIL ${f}`); process.exit(1) }
console.log('ALL TESTS PASSED')

#!/usr/bin/env node
// checks-digest.json (#1491, factory/flock/check_digest.mjs): after a run the engine writes one row per
// file of its checks/ folder, in file-name order. A claims-v1 run whose probe plants two results with
// the FLOCK_CHECK_OUT the engine hands every fact: a readable one per copy, and one that is not JSON.
// Prints `ALL TESTS PASSED` and exits 0, or names what differed and exits 1.
import fs from 'node:fs'
import path from 'node:path'
import { flockTarget, task, writePlan, flockRun } from './_flock_helpers.mjs'

const fails = []
const assert = (ok, why) => { if (!ok) fails.push(why) }

const t = flockTarget({ 'a.txt': 'x\n' })
const plant = `grep -q DONE a.txt && printf '%s' '{"clause":"S1.1","exit":0,"stage":"ui","diff":[]}' > "$FLOCK_CHECK_OUT/S1.1@$(basename "$PWD").json" && printf '{' > "$FLOCK_CHECK_OUT/bad@x.json"`
const plan = writePlan(t, {
  claim: 'a.txt reads DONE.', check: 'test -f a.txt',
  tasks: [task({ id: 1, title: 'Write DONE', files: ['Modify: `a.txt`'], claim: 'a.txt carries DONE.', stale: 'path-absent: `a.txt`', run: plant })],
})
const r = await flockRun(t, { plan, script: { 1: { 'a.txt': 'DONE\n' } } })
const file = path.join(t.RUN, 'checks-digest.json')
if (!fs.existsSync(file)) {
  fails.push(`no checks-digest.json (exit ${r.code}; ${r.out.slice(-600)})`)
} else {
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'))
  const names = fs.readdirSync(path.join(t.RUN, 'checks')).filter((f) => f.endsWith('.json'))
  assert(Array.isArray(rows) && rows.length === names.length, `${rows.length} rows for ${names.length} files: ${JSON.stringify(rows)}`)
  const order = rows.map((x) => x.file)
  assert(JSON.stringify(order) === JSON.stringify([...order].sort()), `rows are not in file-name order: ${order.join(', ')}`)
  const edge = rows.find((x) => x.file === 'S1.1@edge.json')
  assert(edge && edge.clause === 'S1.1' && edge.exit === 0 && edge.stage === 'ui' && edge.diff === true && edge.copy === 'edge' && !Number.isNaN(Date.parse(edge.mtime)),
    `S1.1@edge.json row: ${JSON.stringify(edge)}`)
  const bad = rows.find((x) => x.file === 'bad@x.json')
  assert(bad && bad.unreadable === true && bad.copy === 'x', `bad@x.json row: ${JSON.stringify(bad)}`)
}
t.done()
if (fails.length) { for (const f of fails) console.log(`FAIL ${f}`); process.exit(1) }
console.log('ALL TESTS PASSED')

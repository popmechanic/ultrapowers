#!/usr/bin/env node
// The receipt probe (not a bridged sim: the name does not match test_*.mjs).
// `node fleet/tests/receipt_probe.mjs` renders `factory/record.mjs pr-body` over the committed
// two-task plan `fleet/tests/fixtures/flock-tiny/plan.md` and three event rows (a green edge at
// s1, a settled row naming s1, then a red edge at s2), once with `--evidence` and once without,
// and prints one JSON line of what the two bodies hold: the receipt table's body rows as
// [task, proves, exit], the run-wide checks line, each body's `**Evidence:**` line, and how many
// lines in either still have the old headerless `| <task> | <40-hex sha> |` landing-row shape.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-probe-'))
const events = path.join(tmp, 'events.jsonl')
fs.writeFileSync(events, [
  { kind: 'edge', snap: 's1', perTask: { 1: [0], 2: [0] }, check: 0 },
  { kind: 'settled', snap: 's1' },
  { kind: 'edge', snap: 's2', perTask: { 1: [1], 2: [0] }, check: 3 },
].map((r) => JSON.stringify(r) + '\n').join(''))
const plan = path.join(REPO, 'fleet', 'tests', 'fixtures', 'flock-tiny', 'plan.md')
const body = (...extra) => {
  const r = spawnSync('node', [path.join(REPO, 'factory', 'record.mjs'), 'pr-body', plan, '--events', events, ...extra], { encoding: 'utf8' })
  if (r.status !== 0) { console.log(`pr-body exited ${r.status}: ${r.stderr}`); process.exit(1) }
  return r.stdout.split('\n')
}
const withLink = body('--evidence', 'https://example.invalid/record')
const without = body()
fs.rmSync(tmp, { recursive: true, force: true })

const cells = (line) => line.slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim())
const head = withLink.indexOf('| task | probe | proves | exit |')
const rows = []
if (head >= 0) {
  for (const line of withLink.slice(head + 2)) {
    if (!line.startsWith('|')) break
    const c = cells(line)
    rows.push([c[0], c[2], c[3]])
  }
}
const first = (lines, prefix) => lines.find((l) => l.startsWith(prefix)) ?? null
const landing = /^\| *[0-9]+ *\| *[0-9a-f]{40} *\|$/
console.log(JSON.stringify({
  rows,
  checks_line: first(withLink, 'Run-wide checks:'),
  evidence_with: first(withLink, '**Evidence:**'),
  evidence_without: first(without, '**Evidence:**'),
  landing_rows: [...withLink, ...without].filter((l) => landing.test(l)).length,
}))

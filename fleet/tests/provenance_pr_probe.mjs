#!/usr/bin/env node
// The provenance PR probe (not a bridged sim: the name does not match test_*.mjs).
// `node fleet/tests/provenance_pr_probe.mjs` writes a one-task plan, an empty events file and a
// `provenance.json` (hunks of 2 and 1 lines from tasks `1` and `2`, one `contested` and one `lost`
// exception, one unproven line) into a temp dir, renders `factory/record.mjs pr-body` with
// `--provenance`, and prints the first line after `### Provenance` and its blank line.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'provenance-pr-probe-'))
const plan = path.join(tmp, 'plan.md')
fs.writeFileSync(plan, [
  '# Provenance probe',
  '',
  'One task, so the body has a plan to read.',
  '',
  '### Task 1: The one task',
  '',
  '**Type:** implementation',
  '',
  '**Proof:**',
  '- Run: true',
  '',
].join('\n'))
const events = path.join(tmp, 'events.jsonl')
fs.writeFileSync(events, '')
const provenance = path.join(tmp, 'provenance.json')
fs.writeFileSync(provenance, JSON.stringify({
  hunks: [
    { path: 'a.js', lines: '3-4', task: '1', clauses: ['M1'] },
    { path: 'b.js', lines: '7', task: '2' },
  ],
  exceptions: [
    { kind: 'contested', path: 'a.js' },
    { kind: 'lost', path: 'b.js' },
  ],
  unproven: [{ path: 'b.js', lines: '7', task: '2' }],
}))
const r = spawnSync('node', [path.join(REPO, 'factory', 'record.mjs'), 'pr-body', plan, '--events', events, '--provenance', provenance], { encoding: 'utf8' })
fs.rmSync(tmp, { recursive: true, force: true })
if (r.status !== 0) { console.log(`pr-body exited ${r.status}: ${r.stderr}`); process.exit(1) }
const lines = r.stdout.split('\n')
const at = lines.indexOf('### Provenance')
if (at < 0) { console.log('no ### Provenance heading'); process.exit(1) }
if (lines[at + 1] !== '') { console.log(`no blank line after the heading: ${JSON.stringify(lines[at + 1])}`); process.exit(1) }
console.log(lines[at + 2])

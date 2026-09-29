#!/usr/bin/env node
// The scope sim (#1333, #1346): a Flock run never settles green on a change nobody planned or wrote.
// It builds a throwaway target in a temp dir whose base holds keep.txt, gone.txt and other.txt, and
// a one-task plan that deletes gone.txt and rewrites keep.txt. The scripted builder does exactly
// that, so the task's probe and the run-wide check pass; the script's `@unwritten` seam also puts
// text into other.txt with no builder edit, standing in for run-247's weave fault. Checks:
//   - the engine exits non-zero and summary.json's outcome is a draft;
//   - events.jsonl holds a scope:outside row, and every one names exactly other.txt;
//   - no driver:amendment row names gone.txt (a Delete: path is the task's own).
// Prints `ALL TESTS PASSED` and exits 0, or names what differed and exits 1.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { simEnv } from './_helpers.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flock-scope-'))
const T = path.join(tmp, 'target')
const RUN = path.join(tmp, 'run')
fs.mkdirSync(T)
const ENV = simEnv({ home: tmp, env: { TYPESAFE_BASE_URL: '' } })
const git = (...a) => {
  const r = spawnSync('git', ['-c', 'user.name=sim', '-c', 'user.email=sim@invalid', '-c', 'init.defaultBranch=main', ...a], { cwd: T, encoding: 'utf8', env: ENV })
  if (r.status !== 0) { console.log(`git ${a.join(' ')} failed: ${r.stderr}`); process.exit(1) }
  return r.stdout.trim()
}
const fail = (why) => { console.log(`SCOPE FAILED: ${why}`); process.exit(1) }

fs.writeFileSync(path.join(T, 'keep.txt'), 'kept\n')
fs.writeFileSync(path.join(T, 'gone.txt'), 'gone\n')
fs.writeFileSync(path.join(T, 'other.txt'), 'other\n')
git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'base')
const base = git('rev-parse', 'HEAD')

const plan = path.join(tmp, 'plan.md')
fs.writeFileSync(plan, `# Scope sim plan

**Grammar:** claims-v1
**Claim:** gone.txt is gone and keep.txt says KEPT. (elicited)
**Summary:** One. Two. Three.
**Goal:** sim
**Tech Stack:** bash

## Global Constraints

- Check: test -f keep.txt

### Task 1: Delete one file, change another

**Type:** implementation

**Files:**
- Delete: \`gone.txt\`
- Modify: \`keep.txt\`

**Claim:** gone.txt is gone and keep.txt says KEPT. (derived)
Machine: M1. gone.txt does not exist and keep.txt carries KEPT.

**Authorized-by:** sim

**Interfaces:**
- Produces: none

**Context:** none

**Proof:**
- Run: test ! -e gone.txt && grep -q KEPT keep.txt [M1]
- Legs: (a) gone.txt is absent and keep.txt carries KEPT [M1].

**Stale-if:**
- path-absent: \`keep.txt\`
`)
const script = path.join(tmp, 'script.json')
fs.writeFileSync(script, JSON.stringify({ 1: { 'gone.txt': null, 'keep.txt': 'KEPT\n' }, '@unwritten': { 'other.txt': 'CORRUPT\n' } }))

const r = spawnSync('node', [path.join(REPO, 'factory', 'flock', 'engine.mjs'), '--plan', plan, '--target', T, '--base', base,
  '--run-dir', RUN, '--builder', `scripted:${script}`, '--clock', '120', '--stall-minutes', '2'],
{ encoding: 'utf8', timeout: 180000, env: ENV })
const tail = ((r.stdout || '') + (r.stderr || '')).slice(-600)
if (r.status === 0) fail(`the engine exited 0: a run carrying other.txt settled green; its output ends: ${tail}`)
let summary
try { summary = JSON.parse(fs.readFileSync(path.join(RUN, 'summary.json'), 'utf8')) } catch (e) { fail(`no summary.json (${e.message}); the engine exited ${r.status}; its output ends: ${tail}`) }
if (summary.outcome?.pr !== 'draft') fail(`the outcome is ${JSON.stringify(summary.outcome)}, not a draft`)
const rows = fs.readFileSync(path.join(RUN, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
const outside = rows.filter((x) => x.kind === 'scope:outside')
if (!outside.length) fail('no scope:outside row was written')
for (const x of outside) if (JSON.stringify(x.paths) !== JSON.stringify(['other.txt'])) fail(`a scope:outside row names ${JSON.stringify(x.paths)}, not exactly other.txt`)
const amended = rows.filter((x) => x.kind === 'driver:amendment' && x.path === 'gone.txt')
if (amended.length) fail('gone.txt, a Delete: path of the task, was written as a driver:amendment row')
fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')

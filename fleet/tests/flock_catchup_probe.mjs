#!/usr/bin/env node
// The catch-up probe (not a bridged sim: the name does not match test_*.mjs).
// `node fleet/tests/flock_catchup_probe.mjs <clean|conflict|red>` builds a throwaway target in a
// temp dir — a base commit, the run's own commit on it, and a moved main beside it — runs
// `factory/flock/catchup.mjs` the way the boot does, and checks one case:
//   clean     main changed another line: exit 0, {refolded: true, head}, HEAD's one parent is the
//             moved main, and the file carries both sides' lines
//   conflict  main changed the run's own line: exit non-zero, {refolded: false, reason: "conflict"},
//             HEAD is still the run's commit and the tree is clean
//   red       the join is clean but the plan's probe is red on it: exit non-zero,
//             {refolded: false, reason: "red"}, HEAD is still the run's commit
// Prints `CATCHUP <case> OK` and exits 0, or names what differed and exits 1.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const CASE = process.argv[2]
if (!['clean', 'conflict', 'red'].includes(CASE)) { console.log('usage: flock_catchup_probe.mjs clean|conflict|red'); process.exit(2) }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'catchup-'))
const T = path.join(tmp, 'target')
fs.mkdirSync(T)
const git = (...a) => {
  const r = spawnSync('git', ['-c', 'user.name=probe', '-c', 'user.email=probe@invalid', '-c', 'init.defaultBranch=main', ...a], { cwd: T, encoding: 'utf8' })
  if (r.status !== 0) { console.log(`git ${a.join(' ')} failed: ${r.stderr}`); process.exit(1) }
  return r.stdout.trim()
}
const write = (lines) => fs.writeFileSync(path.join(T, 'a.txt'), lines.join('\n') + '\n')
const fail = (why) => { console.log(`CATCHUP ${CASE} FAILED: ${why}`); process.exit(1) }

const probe = CASE === 'red' ? 'grep -q RUN a.txt && ! grep -q RED a.txt' : 'grep -q RUN a.txt'
const plan = path.join(tmp, 'plan.md')
fs.writeFileSync(plan, `# Catch-up probe plan

**Grammar:** claims-v1
**Claim:** A line reads RUN after the catch-up. (elicited)
**Summary:** One. Two. Three.
**Goal:** probe
**Tech Stack:** bash

## Global Constraints

- Check: test -f a.txt

### Task 1: Mark the line

**Type:** implementation

**Files:**
- Modify: \`a.txt\`

**Claim:** The first line reads RUN. (derived)
Machine: M1. a.txt carries RUN.

**Authorized-by:** probe

**Interfaces:**
- Produces: none

**Context:** none

**Proof:**
- Run: ${probe} [M1]
- Legs: (a) a.txt carries RUN [M1].

**Stale-if:**
- path-absent: \`a.txt\`
`)

git('init', '-q')
write(['one', 'two', 'three', 'four', 'five'])
git('add', '-A'); git('commit', '-qm', 'base')
const base = git('rev-parse', 'HEAD')
git('checkout', '-qb', 'moved')
const mainLines = { clean: ['one', 'two', 'three', 'four', 'MAIN'], conflict: ['MAIN', 'two', 'three', 'four', 'five'], red: ['one', 'two', 'three', 'four', 'RED'] }[CASE]
write(mainLines)
git('commit', '-qam', 'main moved')
const onto = git('rev-parse', 'HEAD')
git('checkout', '-qb', 'run', base)
write(['RUN', 'two', 'three', 'four', 'five'])
git('commit', '-qam', 'the run')
const runSha = git('rev-parse', 'HEAD')

const r = spawnSync('node', [path.join(REPO, 'factory', 'flock', 'catchup.mjs'), '--plan', plan, '--target', T,
  '--base', base, '--onto', onto, '--run-dir', path.join(tmp, 'run')], { encoding: 'utf8', timeout: 120000 })
const last = (r.stdout || '').trim().split('\n').pop() || ''
let out
try { out = JSON.parse(last) } catch { fail(`last stdout line is not JSON: ${JSON.stringify(last)} (exit ${r.status}; stderr ${(r.stderr || '').slice(-400)})`) }
const head = git('rev-parse', 'HEAD')
const text = fs.readFileSync(path.join(T, 'a.txt'), 'utf8')

if (CASE === 'clean') {
  if (r.status !== 0) fail(`exit ${r.status}, ${last}`)
  if (out.refolded !== true) fail(`refolded is ${out.refolded}`)
  if (out.head !== head) fail(`head ${out.head} is not HEAD ${head}`)
  const parents = git('rev-list', '--parents', '-n', '1', 'HEAD').split(' ').slice(1)
  if (parents.length !== 1 || parents[0] !== onto) fail(`HEAD's parents are ${parents.join(',')}, not the moved main ${onto}`)
  if (!/^RUN$/m.test(text) || !/^MAIN$/m.test(text)) fail(`a.txt lacks one side: ${JSON.stringify(text)}`)
} else {
  if (r.status === 0) fail(`exit 0, ${last}`)
  if (out.refolded !== false) fail(`refolded is ${out.refolded}`)
  if (out.reason !== CASE) fail(`reason is ${out.reason}, not ${CASE}`)
  if (head !== runSha) fail(`HEAD moved to ${head}; the run's commit is ${runSha}`)
  if (git('status', '--porcelain')) fail('the tree is not clean')
}
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`CATCHUP ${CASE} OK`)

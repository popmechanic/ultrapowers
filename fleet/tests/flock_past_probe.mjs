#!/usr/bin/env node
// The past probe (not a bridged sim: the name does not match test_*.mjs).
// `node fleet/tests/flock_past_probe.mjs` builds a throwaway target in a temp dir with no remote
// and a one-task plan, then runs the Flock with the scripted builder twice as run-42: once with
// `--past-dir <tmp>/past/41` (a parked status.json and one terminal event row) and once without.
// It prints one JSON line:
//   with.exit       the engine's exit code with --past-dir
//   with.past_run   past.json's run, or null when there is none
//   with.items      past.json's items length, or 0
//   without.exit    the engine's exit code without --past-dir
//   without.past_json whether past.json exists
// Prints the object even when the engine exits non-zero and exits 0; exits 1 only when it could not run.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flock-past-'))
const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true })
const fail = (why) => { console.log(`PAST PROBE FAILED: ${why}`); cleanup(); process.exit(1) }
// each run gets its own target (identical base commit), so the first run's landing does not
// leave the second with nothing to land
const target = (name) => {
  const T = path.join(tmp, name)
  fs.mkdirSync(T)
  const git = (...a) => {
    const r = spawnSync('git', ['-c', 'user.name=probe', '-c', 'user.email=probe@invalid', '-c', 'init.defaultBranch=main', ...a], { cwd: T, encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' } })
    if (r.status !== 0) fail(`git ${a.join(' ')} failed: ${r.stderr}`)
    return r.stdout.trim()
  }
  fs.writeFileSync(path.join(T, 'a.txt'), 'a\n')
  git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'base')
  return { T, base: git('rev-parse', 'HEAD') }
}

const plan = path.join(tmp, 'plan.md')
fs.writeFileSync(plan, `# Past probe plan

**Grammar:** claims-v1
**Claim:** a.txt says A. (elicited)
**Summary:** One. Two. Three.
**Goal:** probe
**Tech Stack:** bash

## Global Constraints

- Check: test -f a.txt

### Task 1: Change a.txt

**Type:** implementation

**Files:**
- Modify: \`a.txt\`

**Claim:** a.txt says A. (derived)
Machine: M1. a.txt carries A.

**Authorized-by:** probe

**Interfaces:**
- Produces: none

**Context:** none

**Proof:**
- Run: grep -q A a.txt [M1]
- Legs: (a) a.txt carries A [M1].

**Stale-if:**
- path-absent: \`a.txt\`
`)
const script = path.join(tmp, 'script.json')
fs.writeFileSync(script, JSON.stringify({ 1: { 'a.txt': 'A\n' } }))

const past = path.join(tmp, 'past', '41')
fs.mkdirSync(past, { recursive: true })
fs.writeFileSync(path.join(past, 'status.json'), JSON.stringify({ state: 'parked', phase: 'probe' }) + '\n')
fs.writeFileSync(path.join(past, 'events.jsonl'), JSON.stringify({ kind: 'terminal', pr: 'draft', why: 'probe' }) + '\n')

const run = (name, extra) => {
  const runDir = path.join(tmp, name)
  const { T, base } = target(`target-${name}`)
  const r = spawnSync('node', [path.join(REPO, 'factory', 'flock', 'engine.mjs'), '--plan', plan, '--target', T, '--base', base,
    '--run-dir', runDir, '--builder', `scripted:${script}`, '--clock', '120', '--stall-minutes', '2', ...extra],
  { encoding: 'utf8', timeout: 180000, env: { ...process.env, TYPESAFE_BASE_URL: '', ULTRAPOWERS_FLEET_RUN: 'run-42' } })
  if (r.error && r.status === null && !r.signal) fail(`the engine could not start: ${r.error.message}`)
  let pj = null
  try { pj = JSON.parse(fs.readFileSync(path.join(runDir, 'past.json'), 'utf8')) } catch {}
  return { exit: r.status, pj, exists: fs.existsSync(path.join(runDir, 'past.json')) }
}

const w = run('run-with', ['--past-dir', past])
const wo = run('run-without', [])
console.log(JSON.stringify({
  with: { exit: w.exit, past_run: w.pj && w.pj.run != null ? w.pj.run : null, items: w.pj && Array.isArray(w.pj.items) ? w.pj.items.length : 0 },
  without: { exit: wo.exit, past_json: wo.exists },
}))
cleanup()

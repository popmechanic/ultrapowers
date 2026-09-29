#!/usr/bin/env node
// The record probe (not a bridged sim: the name does not match test_*.mjs).
// `node fleet/tests/flock_record_probe.mjs` builds a throwaway target in a temp dir whose base
// holds a.txt and b.txt, and a two-task plan whose tasks touch different files (task 1 changes
// a.txt and creates new.txt; task 2 deletes b.txt). It runs the Flock with the scripted builder
// and prints one JSON line naming what the run's record holds:
//   exit             the engine's exit code
//   files            sorted names of the files directly in the run dir
//   summary_keys     sorted keys of summary.json
//   digest_base_keys sorted keys of the weave-ops.digest.jsonl row whose op is base
//   snapshots        row count of snapshots.jsonl
//   reproduces       null when a snapshots.jsonl row lacks a patch string; else whether applying
//                    every patch in row order onto a fresh checkout of base equals the target's HEAD
// Prints the object even when the engine exits non-zero and exits 0; exits 1 only when it could not run.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flock-record-'))
const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true })
const fail = (why) => { console.log(`RECORD PROBE FAILED: ${why}`); cleanup(); process.exit(1) }
const T = path.join(tmp, 'target')
fs.mkdirSync(T)
const gitIn = (cwd, args, input) => spawnSync('git', ['-c', 'user.name=probe', '-c', 'user.email=probe@invalid', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', input })
const git = (...a) => {
  const r = gitIn(T, a)
  if (r.status !== 0) fail(`git ${a.join(' ')} failed: ${r.stderr}`)
  return r.stdout.trim()
}

fs.writeFileSync(path.join(T, 'a.txt'), 'a\n')
fs.writeFileSync(path.join(T, 'b.txt'), 'b\n')
git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'base')
const base = git('rev-parse', 'HEAD')

const plan = path.join(tmp, 'plan.md')
fs.writeFileSync(plan, `# Record probe plan

**Grammar:** claims-v1
**Claim:** a.txt says A, new.txt exists and b.txt is gone. (elicited)
**Summary:** One. Two. Three.
**Goal:** probe
**Tech Stack:** bash

## Global Constraints

- Check: test -f a.txt

### Task 1: Change a.txt and create new.txt

**Type:** implementation

**Files:**
- Modify: \`a.txt\`
- Create: \`new.txt\`

**Claim:** a.txt says A and new.txt exists. (derived)
Machine: M1. a.txt carries A and new.txt carries NEW.

**Authorized-by:** probe

**Interfaces:**
- Produces: none

**Context:** none

**Proof:**
- Run: grep -q A a.txt && grep -q NEW new.txt [M1]
- Legs: (a) a.txt carries A and new.txt carries NEW [M1].

**Stale-if:**
- path-absent: \`a.txt\`

### Task 2: Delete b.txt

**Type:** implementation

**Files:**
- Delete: \`b.txt\`

**Claim:** b.txt is gone. (derived)
Machine: M1. b.txt does not exist.

**Authorized-by:** probe

**Interfaces:**
- Produces: none

**Context:** none

**Proof:**
- Run: test ! -e b.txt [M1]
- Legs: (a) b.txt is absent [M1].

**Stale-if:**
- path-absent: \`a.txt\`
`)
const script = path.join(tmp, 'script.json')
fs.writeFileSync(script, JSON.stringify({ 1: { 'a.txt': 'A\n', 'new.txt': 'NEW\n' }, 2: { 'b.txt': null } }))

const runDir = path.join(tmp, 'run')
const r = spawnSync('node', [path.join(REPO, 'factory', 'flock', 'engine.mjs'), '--plan', plan, '--target', T, '--base', base,
  '--run-dir', runDir, '--builder', `scripted:${script}`, '--clock', '120', '--stall-minutes', '2'],
{ encoding: 'utf8', timeout: 180000, env: { ...process.env, TYPESAFE_BASE_URL: '' } })
if (r.error && r.status === null && !r.signal) fail(`the engine could not start: ${r.error.message}`)

const readJsonl = (p) => {
  try { return fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l) } catch { return null } }) } catch { return [] }
}
let files = []
try { files = fs.readdirSync(runDir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort() } catch {}
let summaryKeys = []
try { const s = JSON.parse(fs.readFileSync(path.join(runDir, 'summary.json'), 'utf8')); if (s && typeof s === 'object') summaryKeys = Object.keys(s).sort() } catch {}
const baseRow = readJsonl(path.join(runDir, 'weave-ops.digest.jsonl')).find((row) => row && row.op === 'base')
const digestBaseKeys = baseRow ? Object.keys(baseRow).sort() : []
const snaps = readJsonl(path.join(runDir, 'snapshots.jsonl'))

let reproduces = null
if (snaps.every((row) => row && typeof row.patch === 'string')) {
  const F = path.join(tmp, 'fresh')
  const c = gitIn(tmp, ['clone', '-q', T, F])
  reproduces = c.status === 0 && gitIn(F, ['checkout', '-q', base]).status === 0
  for (const row of snaps) {
    if (!reproduces) break
    if (!row.patch.trim()) continue
    reproduces = gitIn(F, ['apply', '--whitespace=nowarn', '-'], row.patch).status === 0
  }
  if (reproduces) {
    const head = git('rev-parse', 'HEAD')
    reproduces = gitIn(F, ['add', '-A']).status === 0 && gitIn(F, ['diff', '--quiet', '--cached', head]).status === 0
  }
}

console.log(JSON.stringify({ exit: r.status, files, summary_keys: summaryKeys, digest_base_keys: digestBaseKeys, snapshots: snaps.length, reproduces }))
cleanup()

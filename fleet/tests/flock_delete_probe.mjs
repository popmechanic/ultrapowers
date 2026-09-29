#!/usr/bin/env node
// The delete probe (not a bridged sim: the name does not match test_*.mjs).
// `node fleet/tests/flock_delete_probe.mjs` builds a throwaway target in a temp dir whose base
// holds keep.txt and gone.txt, and a one-task plan whose probe needs gone.txt deleted and
// keep.txt changed. It runs the Flock with the scripted builder, whose script deletes gone.txt
// (a path mapped to null) and rewrites keep.txt, and checks the run settles green (exit 0) with
// one commit on the target that deletes gone.txt and changes keep.txt.
// Prints `DELETE OK` and exits 0, or names what differed and exits 1.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flock-delete-'))
const T = path.join(tmp, 'target')
fs.mkdirSync(T)
const git = (...a) => {
  const r = spawnSync('git', ['-c', 'user.name=probe', '-c', 'user.email=probe@invalid', '-c', 'init.defaultBranch=main', ...a], { cwd: T, encoding: 'utf8' })
  if (r.status !== 0) { console.log(`git ${a.join(' ')} failed: ${r.stderr}`); process.exit(1) }
  return r.stdout.trim()
}
const fail = (why) => { console.log(`DELETE FAILED: ${why}`); process.exit(1) }

fs.writeFileSync(path.join(T, 'keep.txt'), 'kept\n')
fs.writeFileSync(path.join(T, 'gone.txt'), 'gone\n')
git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'base')
const base = git('rev-parse', 'HEAD')

const plan = path.join(tmp, 'plan.md')
fs.writeFileSync(plan, `# Delete probe plan

**Grammar:** claims-v1
**Claim:** gone.txt is gone and keep.txt says KEPT. (elicited)
**Summary:** One. Two. Three.
**Goal:** probe
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

**Authorized-by:** probe

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
fs.writeFileSync(script, JSON.stringify({ 1: { 'gone.txt': null, 'keep.txt': 'KEPT\n' } }))

const r = spawnSync('node', [path.join(REPO, 'factory', 'flock', 'engine.mjs'), '--plan', plan, '--target', T, '--base', base,
  '--run-dir', path.join(tmp, 'run'), '--builder', `scripted:${script}`, '--clock', '120', '--stall-minutes', '2'],
{ encoding: 'utf8', timeout: 180000, env: { ...process.env, TYPESAFE_BASE_URL: '' } })
if (r.status !== 0) fail(`the engine exited ${r.status}; its output ends: ${((r.stdout || '') + (r.stderr || '')).slice(-600)}`)
const head = git('rev-parse', 'HEAD')
if (head === base) fail('no commit landed on the target')
const changed = git('diff', '--name-status', base, head).split('\n').sort()
if (JSON.stringify(changed) !== JSON.stringify(['D\tgone.txt', 'M\tkeep.txt'])) fail(`the landed commit changes ${JSON.stringify(changed)}, not D gone.txt and M keep.txt`)
if (fs.existsSync(path.join(T, 'gone.txt'))) fail('gone.txt is still in the target tree')
fs.rmSync(tmp, { recursive: true, force: true })
console.log('DELETE OK')

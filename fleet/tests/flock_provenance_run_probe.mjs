#!/usr/bin/env node
// The provenance run probe (#1404): a scripted Flock run whose one task creates p.py (four lines,
// no trailing newline; line 3 only runs with an argument) and proves it with `python3 p.py` [M1]
// writes provenance.json in its run dir: one hunk, lines 1-4 by task 1 run by M1, and line 3
// the one line no probe ran. Built as flock_jev_trials_probe.mjs builds its run: a throwaway git
// target in a temp dir, `--builder scripted:<json>`, no Jev (TYPESAFE_BASE_URL empty).
// Prints `PROVENANCE RUN OK` and exits 0, or names what differed and exits 1.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { simEnv } from './_helpers.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flock-provenance-'))
const T = path.join(tmp, 'target')
const RUN = path.join(tmp, 'run')
fs.mkdirSync(T)
const fail = (why) => { console.log(`PROVENANCE RUN FAILED: ${why}`); process.exit(1) }
const ENV = simEnv({ home: tmp, env: { TYPESAFE_BASE_URL: '' } })

const git = (...a) => {
  const r = spawnSync('git', ['-c', 'user.name=sim', '-c', 'user.email=sim@invalid', '-c', 'init.defaultBranch=main', ...a], { cwd: T, encoding: 'utf8', env: ENV })
  if (r.status !== 0) fail(`git ${a.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
fs.writeFileSync(path.join(T, 'README.md'), 'sim\n')
git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'base')
const base = git('rev-parse', 'HEAD')

const plan = path.join(tmp, 'plan.md')
fs.writeFileSync(plan, `# Provenance sim plan

**Grammar:** claims-v1
**Claim:** p.py prints ok. (elicited)
**Summary:** One. Two. Three.
**Goal:** sim
**Tech Stack:** python

## Global Constraints

- Check: test -f p.py

### Task 1: Write p.py

**Type:** implementation

**Files:**
- Create: \`p.py\`

**Claim:** p.py prints ok. (derived)
Machine: M1. python3 p.py exits 0.

**Authorized-by:** sim

**Interfaces:**
- Produces: none

**Context:** none

**Proof:**
- Run: python3 p.py [M1]
- Legs: (a) p.py runs [M1].

**Stale-if:**
- path-exists: \`p.py\`
`)
const script = path.join(tmp, 'script.json')
fs.writeFileSync(script, JSON.stringify({ 1: { 'p.py': "import sys\nif len(sys.argv) > 1:\n    print('never')\nprint('ok')" } }))

const code = await new Promise((resolve) => {
  const p = spawn('node', [path.join(REPO, 'factory', 'flock', 'engine.mjs'), '--plan', plan, '--target', T, '--base', base,
    '--run-dir', RUN, '--builder', `scripted:${script}`, '--clock', '120', '--stall-minutes', '2'], { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  p.stdout.on('data', (c) => { out += c }); p.stderr.on('data', (c) => { out += c })
  const kill = setTimeout(() => p.kill('SIGKILL'), 180000)
  p.on('close', (c) => { clearTimeout(kill); if (process.env.PROBE_VERBOSE) console.log(out); resolve({ c, out }) })
})
const provPath = path.join(RUN, 'provenance.json')
if (!fs.existsSync(provPath)) fail(`no provenance.json (engine exit ${code.c}): ${code.out.slice(-1500)}`)
const prov = JSON.parse(fs.readFileSync(provPath, 'utf8'))
const wantHunks = [{ path: 'p.py', lines: '1-4', task: '1', clauses: ['M1'] }]
const wantUnproven = [{ path: 'p.py', lines: '3', task: '1' }]
if (JSON.stringify(prov.hunks) !== JSON.stringify(wantHunks)) fail(`hunks ${JSON.stringify(prov.hunks)}, expected ${JSON.stringify(wantHunks)}`)
if (JSON.stringify(prov.unproven) !== JSON.stringify(wantUnproven)) fail(`unproven ${JSON.stringify(prov.unproven)}, expected ${JSON.stringify(wantUnproven)}`)
console.log('PROVENANCE RUN OK')
process.exit(0)

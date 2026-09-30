// fleet/tests/_flock_helpers.mjs — a throwaway git target and a scripted Flock run, for the flock sims.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { simEnv } from './_helpers.mjs'

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// A temp dir holding `target/` with `files` committed as its base. `env` is laid over simEnv's; Jev is
// off (TYPESAFE_BASE_URL empty) unless `env` names it. `git` throws on a non-zero exit.
export function flockTarget (files, { env = {} } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flock-sim-'))
  const T = path.join(tmp, 'target')
  fs.mkdirSync(T)
  const over = { TYPESAFE_BASE_URL: '', ...env }
  const ENV = simEnv({ home: tmp, env: over })
  const git = (...a) => {
    const r = spawnSync('git', ['-c', 'user.name=sim', '-c', 'user.email=sim@invalid', '-c', 'init.defaultBranch=main', ...a], { cwd: T, encoding: 'utf8', env: ENV })
    if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`)
    return r.stdout.trim()
  }
  for (const [p, text] of Object.entries(files)) fs.writeFileSync(path.join(T, p), text)
  git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'base')
  return { tmp, T, RUN: path.join(tmp, 'run'), over, git, base: git('rev-parse', 'HEAD'), done: () => fs.rmSync(tmp, { recursive: true, force: true }) }
}

// One claims-v1 task. `files` are the Files lines (`Modify: \`a.txt\``), `run` the one probe (tagged M1).
export const task = ({ id, title, files, claim, run, stale, iface = '- Produces: none' }) => `### Task ${id}: ${title}

**Type:** implementation

**Files:**
${files.map((f) => `- ${f}`).join('\n')}

**Claim:** ${claim} (derived)
Machine: M1. ${claim}

**Authorized-by:** sim

**Interfaces:**
${iface}

**Context:** none

**Proof:**
- Run: ${run} [M1]
- Legs: (a) ${claim} [M1].

**Stale-if:**
- ${stale}
`

// A claims-v1 plan of `tasks` with one run-wide `check`, written into the target's temp dir.
export function writePlan (t, { claim, check, tasks }) {
  const plan = path.join(t.tmp, 'plan.md')
  fs.writeFileSync(plan, `# Sim plan

**Grammar:** claims-v1
**Claim:** ${claim} (elicited)
**Summary:** One. Two. Three.
**Goal:** sim
**Tech Stack:** bash

## Global Constraints

- Check: ${check}

${tasks.join('\n')}`)
  return plan
}

// The Flock on `t` with the scripted builder: {code, out, rows (events.jsonl), of(kind)}.
export async function flockRun (t, { plan, script }) {
  const scriptFile = path.join(t.tmp, 'script.json')
  fs.writeFileSync(scriptFile, JSON.stringify(script))
  const { code, out } = await new Promise((resolve) => {
    const p = spawn('node', [path.join(REPO, 'factory', 'flock', 'engine.mjs'), '--plan', plan, '--target', t.T, '--base', t.base,
      '--run-dir', t.RUN, '--builder', `scripted:${scriptFile}`, '--clock', '120', '--stall-minutes', '2'], { env: simEnv({ home: t.tmp, env: t.over }), stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    p.stdout.on('data', (c) => { out += c }); p.stderr.on('data', (c) => { out += c })
    const kill = setTimeout(() => p.kill('SIGKILL'), 180000)
    p.on('close', (c) => { clearTimeout(kill); resolve({ code: c, out }) })
  })
  const evPath = path.join(t.RUN, 'events.jsonl')
  const rows = fs.existsSync(evPath) ? fs.readFileSync(evPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : null
  return { code, out, rows, of: (k) => (rows || []).filter((r) => r.kind === k) }
}

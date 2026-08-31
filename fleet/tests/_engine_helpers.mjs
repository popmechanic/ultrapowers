// fleet/tests/_engine_helpers.mjs — shared rig for the run-engine sims.
// Underscore-prefixed so test_fleet_suite.py's test_*.mjs glob does not run it
// as a test of its own.
//
// The rig is deliberately REAL below the agent seam: real git repos, real
// cloneAtBase clones, real withPatchCapture diffs, the real fold kernel via
// the real execSeam. Only `agent` is stubbed — which is exactly the seam the
// driver owns (the sims prove the choreography; the judgments are canned).
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { execSeam } from '../run-main.mjs'
import { cloneAtBase, makeCwdFor, withPatchCapture, defaultTaskIdOf } from '../run-waves.mjs'
import { runEngine } from '../run-engine.mjs'

export const gitSync = (argv, cwd) =>
  execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

// A target repo whose suite is `bash check.sh`: green unless a BROKEN marker
// file exists — the smallest controllable suite for reconcile scenarios.
export function makeRepo(dir, files = {}) {
  fs.mkdirSync(dir, { recursive: true })
  gitSync(['init', '-q', '-b', 'main'], dir)
  gitSync(['config', 'user.email', 'sim@test'], dir)
  gitSync(['config', 'user.name', 'sim'], dir)
  fs.writeFileSync(path.join(dir, 'check.sh'), '#!/bin/bash\n[ ! -f BROKEN ]\n')
  fs.writeFileSync(path.join(dir, 'a.txt'), 'line1\nline2\nline3\n')
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content)
  }
  gitSync(['add', '-A'], dir)
  gitSync(['commit', '-q', '-m', 'base'], dir)
  return dir
}

// Provision the run tree the way run-main does: integration + task clones at
// BASE, a patches dir, all under runDir.
export function provision({ repo, runDir, taskIds }) {
  const clonesDir = path.join(runDir, 'clones')
  const patchesDir = path.join(runDir, 'patches')
  fs.mkdirSync(patchesDir, { recursive: true })
  const base = gitSync(['rev-parse', 'HEAD'], repo)
  cloneAtBase({ repo, dest: path.join(clonesDir, 'integration'), base })
  for (const id of taskIds) cloneAtBase({ repo, dest: path.join(clonesDir, 'task-' + id), base })
  return { base, clonesDir, patchesDir, integ: path.join(clonesDir, 'integration') }
}

// Build a runEngine invocation around a stub inner agent. The stub receives
// (prompt, opts, cwd) — cwd already resolved the way the real worker would —
// and returns the canned judgment reply; withPatchCapture then captures the
// real diff, exactly as in production.
export function rig({ repo, runDir, waves, edges = [], stub, testCmd = 'bash check.sh',
                      acceptance = { mode: 'suite', reason: 'sim' }, stamp = 'sim',
                      // Extra runEngine args merged last (the depth-1 leg's
                      // shallowLeg knob, and whatever the next one is).
                      extraArgs = {} }) {
  const taskIds = waves.flat().map((t) => t.id)
  const { base, clonesDir, patchesDir, integ } = provision({ repo, runDir, taskIds })
  const patchBase = { current: base }
  const cwdFor = makeCwdFor({ clonesDir })
  const inner = async (prompt, opts) => stub(prompt, opts, cwdFor(opts))
  const agent = withPatchCapture({
    agent: inner, clonesDir, base: () => patchBase.current, patchesDir,
    taskIdOf: defaultTaskIdOf,
  })
  const logs = []
  const run = () => runEngine({
    args: {
      waves, edges, testCmd, acceptance, stamp,
      integrationBranch: 'ultra/integration-' + stamp,
      dependencyEdges: edges.map(([a, b]) => a + ' -> ' + b),
      patchInput: patchesDir,
      ...extraArgs,
    },
    agent,
    parallel: (thunks) => Promise.all(thunks.map((t) => t())),
    exec: execSeam,
    paths: { repoDir: repo, runDir, clonesDir },
    log: (l) => logs.push(String(l)),
    patchBase,
  })
  return { run, base, clonesDir, patchesDir, integ, logs, patchBase }
}

// Common canned judgments.
export const passReview = () => ({ verdict: 'PASS', issues: [] })
export const cleanCritic = () => ({ findings: [], deferredVerification: [] })
// #474 — a critic that found something. `findings` are {severity, detail}
// objects; the shape lives here once so consumers cannot drift apart.
export const criticWithFindings = (findings) => ({ findings, deferredVerification: [] })
export const doneImpl = (cwd) => ({
  status: 'DONE', summary: 'sim work done', startHead: gitSync(['rev-parse', 'HEAD'], cwd),
})

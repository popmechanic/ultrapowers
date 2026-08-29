// fleet/tests/test_run_engine_gate.mjs — the report-contract pin: the FROZEN
// periphery is the oracle. A sim-produced report is fed to the real
// finalize_report.py and gate_check.py (no copied schema, no stubbed reader):
// if the engine's report drifts from the contract those scripts consume, this
// goes red — exactly the drift class that would otherwise park a live run at
// the gate.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeRepo, rig, gitSync, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-gate-'))
const SCRIPTS = fileURLToPath(new URL('../../skills/ultrapowers/scripts', import.meta.url))

const repo = makeRepo(path.join(tmp, 'repo'))
const runDir = path.join(tmp, 'run')
const waves = [[
  { id: 'T1', title: 'one', files: ['one.txt'], tier: 'standard', review: 'lean',
    writes: ['one.txt'], commutes: [], body: 'task T1' },
  { id: 'T2', title: 'two', files: ['two.txt'], tier: 'standard', review: 'lean',
    writes: ['two.txt'], commutes: [], body: 'task T2' },
]]
const stub = (prompt, opts, cwd) => {
  const kind = opts.label.split(':')[0]
  if (kind === 'impl') {
    fs.writeFileSync(path.join(cwd, opts.label.split(':')[1] === 'T1' ? 'one.txt' : 'two.txt'), 'x\n')
    return doneImpl(cwd)
  }
  if (kind === 'review') return passReview()
  if (opts.label === 'integration') return cleanCritic()
  throw new Error('unexpected: ' + opts.label)
}

const branch = 'ultra/integration-gt1'
const { run, integ } = rig({ repo, runDir, waves, stub, stamp: 'gt1' })
const report = await run()
assert.equal(report.coverage.complete, true)

// run-main's bridge leg, mirrored: the integration branch travels clone → repo
// before the frozen scripts read the repo checkout.
execFileSync('git', ['fetch', '--no-tags', integ, branch + ':' + branch], { cwd: repo })

const resultPath = path.join(runDir, 'workflow-result.json')
fs.writeFileSync(resultPath, JSON.stringify(report, null, 2))

// finalize_report.py — the first frozen reader of the report.
const fin = execFileSync('python3', [path.join(SCRIPTS, 'finalize_report.py'),
  '--report', resultPath, '--repo', repo, '--branch', branch],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
assert.ok(true, 'finalize_report accepted the engine report: ' + fin)

// gate_check.py — the frozen verdict.
const gateOut = execFileSync('python3', [path.join(SCRIPTS, 'gate_check.py'),
  '--run-id', 'gt1', '--branch', branch, '--report', resultPath, '--repo', repo],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const gate = JSON.parse(gateOut)
const failed = (gate.checks || []).filter((c) => !c.ok)
assert.equal(failed.length, 0, 'gate checks failed: ' + JSON.stringify(failed))
assert.equal(gate.verdict, 'PASS', 'gate verdict: ' + gateOut)

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')

#!/usr/bin/env node
// The gate Jev labels probe: `skills/ultrawrite/stories/gate_jev.ts --label` marks who the run
// proved right on one disagreement between the agent reader and Jev, and `--agreement` counts
// those marks on a second line. No Jev is needed. The case is argv[2]:
//   label          label task 3 round 2 (pass/fail) `--right agent --because "run-278 went red on it"`;
//   agree-refused  the same call on task 3 round 1, whose agent equals its jev;
//   census         `--agreement` over a.gate-verdicts.json (task 1: pass/pass, pass/fail right jev,
//                  fail/pass right agent) and b.gate-verdicts.json (task 1: fail/fail, fail/pass).
// Prints one JSON line: for label and agree-refused {record, exit, changed}; for census {exit, lines}.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CASE = process.argv[2]
if (!['label', 'agree-refused', 'census'].includes(CASE)) { console.log('usage: gate_jev_labels_probe.mjs label|agree-refused|census'); process.exit(2) }
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-jev-labels-'))
const HOME = path.join(tmp, 'home')
fs.mkdirSync(HOME)

const gate = (args) => {
  const p = spawnSync('bun', [path.join(REPO, 'skills/ultrawrite/stories/gate_jev.ts'), ...args], {
    cwd: REPO, encoding: 'utf8', env: { ...process.env, ULTRAPOWERS_HOME: HOME },
  })
  return { code: p.status, stdout: p.stdout ?? '', stderr: p.stderr ?? '' }
}

if (CASE === 'census') {
  const dir = path.join(tmp, 'records')
  fs.mkdirSync(dir)
  const task = (rounds) => ({ tasks: { 1: { hash: 'h', verdict: 'pass', reason: 'r', gate_rounds: rounds } } })
  fs.writeFileSync(path.join(dir, 'a.gate-verdicts.json'), JSON.stringify(task([
    { hash: 'h1', agent: 'pass', jev: 'pass' },
    { hash: 'h2', agent: 'pass', jev: 'fail', right: 'jev', because: 'the probe went red' },
    { hash: 'h3', agent: 'fail', jev: 'pass', right: 'agent', because: 'the amendment was declared' }])))
  fs.writeFileSync(path.join(dir, 'b.gate-verdicts.json'), JSON.stringify(task([
    { hash: 'h1', agent: 'fail', jev: 'fail' }, { hash: 'h2', agent: 'fail', jev: 'pass' }])))
  const run = gate(['--agreement', dir])
  console.log(JSON.stringify({ exit: run.code, lines: run.stdout.split('\n').filter(Boolean), stderr: run.stderr }))
} else {
  const file = path.join(tmp, 'plan.gate-verdicts.json')
  fs.writeFileSync(file, JSON.stringify({
    plan: 'plan.md',
    tasks: {
      1: { hash: 'x', verdict: 'pass', reason: 'r', gate_rounds: [{ hash: 'x1', agent: 'fail', jev: 'pass' }] },
      3: { hash: 'h', verdict: 'pass', reason: 'r', gate_rounds: [
        { hash: 'h1', agent: 'pass', jev: 'pass' }, { hash: 'h2', agent: 'pass', jev: 'fail' }] },
    },
  }, null, 2) + '\n')
  const before = fs.readFileSync(file)
  const round = CASE === 'label' ? '2' : '1'
  const run = gate(['--label', file, '--task', '3', '--round', round, '--right', 'agent', '--because', 'run-278 went red on it'])
  const after = fs.readFileSync(file)
  console.log(JSON.stringify({ record: JSON.parse(after), exit: run.code, changed: !before.equals(after), stderr: run.stderr }))
}

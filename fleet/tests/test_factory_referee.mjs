/**
 * fleet/tests/test_factory_referee.mjs — the sim for "one sim drives a refereed
 * task and a throwing landing through the engine" (plan
 * 2026-09-24-referee-path-sim; the engine logs on ultra/evidence/run-234 and
 * run-235, where `ReferenceError: trig is not defined` inside `land` killed
 * both runs at their first referee, 2026-09-24, and #1286 tasks 3 and 4).
 *
 * Nothing else in the tree drives `runEngine`'s pool loop: the other factory
 * sims drive `makeRefoldDispatch`, `foldRound`, the handlers and the pure
 * modules. This one runs the real engine — real git target, real
 * `plan_parse.py`, real kernel, real probes — with a fake worker and a fake
 * judge, so the referee path and the landing's catch-all are exercised on
 * the laptop before a launch pays for them.
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (a) [M1] task 1's reading rings the referee, the fake referee answers
 *       zero findings, and the record carries its `referee:trigger` row
 *       (`trigger: 'rung'`), its `referee` row (`trigger: 'rung'`,
 *       `findings: 0`) and its `landing` row;
 *   (b) [M2] task 2's landing throws (the `git` seam refuses `add -A` in
 *       any `impl-2-*` clone with `simulated index.lock`), `runEngine`
 *       resolves rather than rejects, task 2's `parked` row's reason begins
 *       `landing threw:` and names the injected error, and task 1's
 *       `landing` row is still there;
 *   (c) [M3] the sim prints ALL TESTS PASSED, and the hermetic sweep still
 *       passes with it in the tree — every spawn in this file's own text
 *       carries `env: GIT_ENV`, bound to `simEnv({})`.
 *
 * The `sh` seam strips a leading `timeout <s>` and runs the rest directly:
 * macOS has no `timeout`, and the sim measures what the probes and the
 * kernel do, not the clock.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { runEngine, defaultSh, defaultGit } from '../../factory/engine.mjs'
import { simEnv } from './_helpers.mjs'

const GIT_ENV = simEnv({})

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-referee-'))
const target = path.join(root, 'target')
const runDir = path.join(root, 'run')
fs.mkdirSync(target)

function git (args) {
  const r = spawnSync('git', args, { cwd: target, encoding: 'utf8', env: GIT_ENV })
  if (r.status !== 0) throw new Error(`fixture git ${args.join(' ')} exited ${r.status}\n${r.stdout}${r.stderr}`)
  return r.stdout
}

git(['init', '-q'])
git(['config', 'user.email', 'sim@localhost'])
git(['config', 'user.name', 'sim'])
fs.writeFileSync(path.join(target, 'a.txt'), 'a\n')
git(['add', '-A'])
git(['commit', '-q', '-m', 'base'])

const task = (id, file) => `### Task ${id}: create ${file}

**Type:** implementation

**Files:**
- Create: \`${file}\`

**Claim:** do: run the task; see: ${file} exists. (derived)
Machine: M1. \`${file}\` exists at the clone's root.

**Authorized-by:** the sim

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The worker writes one file.

**Proof:**
- Run: test -f ${file} [M1]
- Legs: (a) the file exists [M1].

**Stale-if:**
- path-absent: \`a.txt\`
`

const plan = path.join(root, 'plan.md')
fs.writeFileSync(plan, `# Two tasks

**Grammar:** claims-v1
**Claim:** do: run this plan; see: two files. (elicited)
**Goal:** the sim's plan.

## Global Constraints

- The sim's lens.

${task('1', 'one.txt')}
${task('2', 'two.txt')}`)

// ── the seams ──────────────────────────────────────────────────────────────

const sh = (cmd, argv = [], cwd, input, env) => (cmd === 'timeout'
  ? defaultSh(argv[1], argv.slice(2), cwd, input, env)
  : defaultSh(cmd, argv, cwd, input, env))

const gitSeam = (argv, cwd) => {
  if (argv[0] === 'add' && String(cwd).includes('impl-2-')) {
    throw new Error('simulated index.lock: ' + cwd)
  }
  return defaultGit(argv, cwd)
}

const dispatches = []
const worker = async (opts) => {
  const taskId = String(opts.task ?? opts.taskId)
  dispatches.push({ role: opts.role, task: taskId, cwd: opts.cwd })
  if (opts.role === 'implement') {
    const file = taskId === '1' ? 'one.txt' : 'two.txt'
    fs.writeFileSync(path.join(opts.cwd, file), 'x\n')
    return { result: null, denials: [] }
  }
  if (opts.role === 'referee') {
    return { result: { structured_output: { findings: [] } }, denials: [] }
  }
  return { result: null, denials: [] }
}

const judge = {
  readTask: async ({ id }) => ({ referee: id === '1' }),
}

// ── the run ────────────────────────────────────────────────────────────────

let answer = null
let rejection = null
try {
  answer = await runEngine({ plan, target, runDir }, { worker, judge, sh, git: gitSeam, tools: null })
} catch (err) {
  rejection = err
}

const rows = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l))
const of = (kind, task) => rows.filter((r) => r.kind === kind && (task === undefined || String(r.task) === task))

// ── (a) [M1] the referee path ─────────────────────────────────────────────
{
  assert.ok(dispatches.some((d) => d.role === 'referee' && d.task === '1'), '(a) [M1] a referee dispatch ran for task 1')
  const trig = of('referee:trigger', '1')
  assert.equal(trig.length, 1, '(a) [M1] exactly one referee:trigger row for task 1')
  assert.equal(trig[0].trigger, 'rung', "(a) [M1] task 1's referee:trigger row carries trigger 'rung'")
  const ref = of('referee', '1')
  assert.equal(ref.length, 1, '(a) [M1] exactly one referee row for task 1')
  assert.equal(ref[0].trigger, 'rung', "(a) [M1] task 1's referee row carries trigger 'rung'")
  assert.equal(ref[0].findings, 0, "(a) [M1] task 1's referee row carries findings 0")
  assert.equal(ref[0].died, undefined, "(a) [M1] task 1's referee did not die")
  assert.equal(of('landing', '1').length, 1, '(a) [M1] task 1 has a landing row')
  assert.equal(of('referee:trigger', '2').length + of('referee', '2').filter((r) => r.trigger === 'rung').length,
    of('referee:trigger', '2').length, '(a) [M1] task 2 rang no referee')
}

// ── (b) [M2] a landing that throws parks its own task, never the run ──────
{
  assert.equal(rejection, null, '(b) [M2] runEngine resolved; it did not reject: ' + String(rejection && rejection.stack))
  assert.ok(answer && typeof answer === 'object', '(b) [M2] runEngine answered an object')
  const parked = of('parked', '2')
  assert.equal(parked.length, 1, '(b) [M2] exactly one parked row for task 2')
  assert.ok(String(parked[0].reason).startsWith('landing threw:'), "(b) [M2] task 2's parked reason begins 'landing threw:'")
  assert.ok(String(parked[0].reason).includes('simulated index.lock'), "(b) [M2] task 2's parked reason names the injected error")
  assert.equal(of('landing', '2').length, 0, '(b) [M2] task 2 has no landing row')
  assert.equal(of('landing', '1').length, 1, "(b) [M2] task 1's landing row is still present")
}

fs.rmSync(root, { recursive: true, force: true })
console.log('ALL TESTS PASSED')

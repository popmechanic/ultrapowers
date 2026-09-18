#!/usr/bin/env node
/**
 * fleet/tests/test_factory_dispatch_candidate.mjs — exam for "A chained
 * implementer starts from its producer's measured candidate, not from its
 * adoption".
 *
 * Proves M1-M4 against `factory/dispatch.mjs`'s `waitsFor` (Modify) and the
 * engine's `runEngine` (Modify, `factory/engine.mjs`) exactly as the task
 * states them. Every assertion below is preceded by a comment naming the
 * clause it measures.
 *
 * The rig below the `worker`/`judge` seams is real: a real git repository
 * (`makeRepo`), the real plan compiler (`skills/ultrapowers/scripts/
 * plan_parse.py`, run by `factory/engine.mjs` itself, untouched by this
 * file), the real `factory/engine.mjs`, and the real fold kernel
 * (`skills/ultrapowers/kernel/fold_wave.py`) via a `sh` that shells out with
 * `simEnv()` — never `process.env`. Unlike its sibling exam
 * (`test_factory_dispatch.mjs`), this file needs no `python3` shim over the
 * plan compiler: `plan_parse.py` already emits a real `pairs` array with
 * `producer`/`consumer`/`symbol` for a plan whose one task's `Produces:`
 * names what another's `Consumes:` names (verified directly against the
 * checked-in compiler below), which is all M2/M3's fixtures need.
 *
 * `factory/dispatch.mjs` and its `waitsFor` export already exist (a sibling
 * task's own creation) — importing it does not throw. What is absent is this
 * task's own change to it (the `candidate` split under `on_candidate`) and
 * to `factory/engine.mjs` (the whole commit/fetch/clone-at-candidate
 * mechanism), so this exam is red today on failed assertions, not on a
 * missing module.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'

import { simEnv } from './_helpers.mjs'
import { makeRepo, gitSync } from './_engine_helpers.mjs'
import { runEngine } from '../../factory/engine.mjs'
import { waitsFor } from '../../factory/dispatch.mjs'

const failures = []
const check = (cond, label) => { if (!cond) failures.push(label) }

// ── small utilities ─────────────────────────────────────────────────────────

function deferred () {
  let resolve
  const promise = new Promise((res) => { resolve = res })
  return { promise, resolve }
}

/** A gate for the fake worker: a label held here blocks that dispatch's
 *  promise until `release(label)` is called. */
function makeGate () {
  const holds = new Map()
  return {
    hold (label) { const d = deferred(); holds.set(label, d); return d },
    release (label) { const d = holds.get(label); if (d) d.resolve() },
    waitIfHeld (label) { const d = holds.get(label); return d ? d.promise : null },
  }
}

/** Polls `pred` until it is true or `timeoutMs` elapses; never throws. */
async function waitUntil (pred, { timeoutMs = 4000, stepMs = 20 } = {}) {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) return false
    await new Promise((r) => setTimeout(r, stepMs))
  }
  return true
}

const GIT_ENV = simEnv()
const gitHead = (dir) => execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', env: GIT_ENV }).trim()
const gitShow = (dir, spec) => {
  try {
    return execFileSync('git', ['-C', dir, 'show', spec], { encoding: 'utf8', env: GIT_ENV })
  } catch {
    return null
  }
}
const gitRevParse = (dir, ref) => {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', ref], { encoding: 'utf8', env: GIT_ENV }).trim()
  } catch {
    return null
  }
}

// ── fakes ─────────────────────────────────────────────────────────────────

/** A fake worker: records every dispatch synchronously (before any await),
 *  honours a gate, and does the minimal real filesystem work each role needs
 *  so the rest of the (real) engine — measure, capture, fold — has something
 *  real to chew on. */
function makeFakeWorker ({ gate, timeline }) {
  const dispatches = []
  const worker = async (opts) => {
    const rec = { label: opts.label, taskId: opts.task, cwd: opts.cwd, role: opts.role, files: opts.files || [] }
    dispatches.push(rec)
    timeline.push({ i: timeline.length, what: 'dispatch', label: opts.label, taskId: opts.task, cwd: opts.cwd })
    const wait = gate.waitIfHeld(opts.label)
    if (wait) await wait
    if (opts.role === 'exam') {
      for (const f of opts.files || []) {
        fs.mkdirSync(path.dirname(path.join(opts.cwd, f)), { recursive: true })
        fs.writeFileSync(path.join(opts.cwd, f), '#!/bin/bash\nexit 0\n# exam-marker task=' + opts.task + '\n')
      }
      return { result: { total_cost_usd: 0, result: 'exam-note:' + opts.task }, denials: [] }
    }
    if (opts.role === 'implement') {
      const f = (opts.files || [])[0]
      if (f) {
        fs.mkdirSync(path.dirname(path.join(opts.cwd, f)), { recursive: true })
        fs.writeFileSync(path.join(opts.cwd, f), 'impl content for ' + opts.task + ' at ' + opts.label + '\n')
      }
      return { result: { total_cost_usd: 0.001, result: 'impl-note:' + opts.task }, denials: [] }
    }
    if (opts.role === 'referee') return { result: { structured_output: { findings: [] } } }
    if (opts.role === 'resolve') return { result: { structured_output: { status: 'BLOCKED', hunks: [], notes: '' } } }
    return { result: { result: '' } }
  }
  return { worker, dispatches }
}

/** A fake board: records `post`, and `setState` doubles as this run's
 *  adoption timeline entry (used to order dispatches against adoptions). */
function makeFakeBoard ({ timeline }) {
  const posts = []
  const states = []
  return {
    board: {
      async post (uid, kind, text) { posts.push({ uid, kind, text }) },
      async factsFor () { return '' },
      async setState (uid, state) {
        states.push({ uid, state })
        timeline.push({ i: timeline.length, what: 'state', uid, state })
      },
      async states () { return {} },
      async settled () { return null },
    },
    posts,
    states,
  }
}

/** A fake `deps.pairs`: `pairState`/`decideByCode`/`labelPair`. `decideByCode`
 *  always answers null here (every pair falls through to the judge's
 *  `readPair`, which is where this exam controls the 'chain' verdict), and
 *  `labelPair` answers a fixed, uninteresting label — neither is what M1-M4
 *  are about. */
function makeFakePairs () {
  return {
    pairs: {
      async pairState ({ pair }) { return { pair, key: pair.a + '>' + pair.b } },
      decideByCode () { return null },
      async labelPair () { return { calls: 0, fold: 'clean' } },
    },
  }
}

/** A fake `deps.judge`: `readPair` answers 'chain' for exactly the pairs this
 *  exam names (by `a>b` key); `readTask` answers `{ referee: true }` for
 *  exactly the task ids this exam names as wanting a referee (the device
 *  used to hold a producer's `land()` open, well after its candidate is
 *  measured, without ever letting it adopt). */
function makeFakeJudge ({ chainPairs = [], refereeTasks = [] } = {}) {
  const chainSet = new Set(chainPairs)
  const refereeSet = new Set(refereeTasks)
  return {
    judge: {
      async readPair ({ pair }) {
        const key = pair.a + '>' + pair.b
        return chainSet.has(key) ? { verdict: 'chain', score: 0.9 } : { verdict: 'look', score: 0 }
      },
      async readTask ({ id }) {
        return { referee: refereeSet.has(id) === true, k: 1 }
      },
    },
  }
}

/** `deps.sh`: forwards every call to a real `spawnSync` (so the fold kernel
 *  really runs, and the run really completes) while recording `{cmd, argv,
 *  cwd}` for every call — this is how legs (b)/(c) read the exact `--patch`
 *  argument the kernel's `fold` invocation for task 2 was given. */
function makeRecordingSh (shEnv) {
  const calls = []
  const sh = (cmd, argv = [], cwd, input) => {
    calls.push({ cmd, argv: [...argv], cwd })
    return spawnSync(cmd, argv, { cwd, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: shEnv })
  }
  return { sh, calls }
}

function writePolicy (dir, doc) {
  const p = path.join(dir, 'policy.json')
  fs.writeFileSync(p, JSON.stringify(doc))
  return p
}

function setupRun (planText) {
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-cand-exam-run-'))
  const target = path.join(runRoot, 'repo')
  makeRepo(target, {})
  const planPath = path.join(runRoot, 'plan.md')
  fs.writeFileSync(planPath, planText)
  const runDir = path.join(runRoot, 'rundir')
  const base = gitSync(['rev-parse', 'HEAD'], target)
  return { runRoot, target, planPath, runDir, base }
}

// ── plan fixtures ────────────────────────────────────────────────────────

/** Task A produces `thing`, task B consumes it — the real compiler reads
 *  this as one `pairs` entry with `producer: idA, consumer: idB, symbol:
 *  "thing"`, `why: ["interface"]`, and (since neither task otherwise touches
 *  the other's files) NO write-after-create edge — the only kind of edge
 *  `pairs.mode: "live"` still counts as a hard predecessor. So with pairs
 *  live, task B's only predecessor of any kind is the chain verdict this
 *  exam's fake judge hands back for this pair. */
const producerConsumerPlan = (idA, idB) => `**Exam command:** bash check.sh

### Task ${idA}: producer

**Type:** implementation

- Create: \`out-${idA}.txt\`

**Interfaces:**
- Produces: \`thing\`

**Proof:**
- Test: \`check.sh\`

### Task ${idB}: consumer

**Type:** implementation

- Create: \`out-${idB}.txt\`

**Interfaces:**
- Consumes: \`thing\`

**Proof:**
- Test: \`check.sh\`
`

/** Task 3 consumes both `x` (task 1) and `y` (task 2) — two producers, so M4
 *  says the switch is off for task 3 no matter the policy. */
const TWO_PRODUCER_PLAN = `**Exam command:** bash check.sh

### Task 1: producer-x

**Type:** implementation

- Create: \`out-1.txt\`

**Interfaces:**
- Produces: \`x\`

**Proof:**
- Test: \`check.sh\`

### Task 2: producer-y

**Type:** implementation

- Create: \`out-2.txt\`

**Interfaces:**
- Produces: \`y\`

**Proof:**
- Test: \`check.sh\`

### Task 3: consumer

**Type:** implementation

- Create: \`out-3.txt\`

**Interfaces:**
- Consumes: \`x\`
- Consumes: \`y\`

**Proof:**
- Test: \`check.sh\`
`

// ── leg (a): M1, waitsFor's own pure behaviour ──────────────────────────────

function legWaitsFor () {
  // M1: on_candidate true splits hardPreds (-> adoption) from chainPreds not
  // in hardPreds (-> candidate) — the Proof's own example.
  const on = waitsFor({ taskId: '3', hardPreds: ['1'], chainPreds: ['2', '1'], policy: { speculate: { on_candidate: true } } })
  check(
    JSON.stringify(on.adoption) === JSON.stringify(['1']) &&
    JSON.stringify(on.candidate) === JSON.stringify(['2']),
    'M1: with on_candidate true, waitsFor({hardPreds:["1"],chainPreds:["2","1"]}) must equal {adoption:["1"],candidate:["2"]} — got ' + JSON.stringify(on),
  )

  // M1: with on_candidate false, the same inputs answer what waitsFor
  // answered before this task: adoption is hardPreds then chainPreds,
  // deduplicated; candidate is [].
  const off = waitsFor({ taskId: '3', hardPreds: ['1'], chainPreds: ['2', '1'], policy: { speculate: { on_candidate: false } } })
  check(
    JSON.stringify(off.adoption) === JSON.stringify(['1', '2']) && Array.isArray(off.candidate) && off.candidate.length === 0,
    'M1: with on_candidate false, waitsFor({hardPreds:["1"],chainPreds:["2","1"]}) must equal {adoption:["1","2"],candidate:[]} — got ' + JSON.stringify(off),
  )

  // M1: with no `speculate.on_candidate` in the policy at all (a bare `{}`),
  // the answer is the same as with it false.
  const absent = waitsFor({ taskId: '3', hardPreds: ['1'], chainPreds: ['2', '1'], policy: {} })
  check(
    JSON.stringify(absent.adoption) === JSON.stringify(['1', '2']) && Array.isArray(absent.candidate) && absent.candidate.length === 0,
    'M1: with policy {} (on_candidate absent), waitsFor({hardPreds:["1"],chainPreds:["2","1"]}) must equal {adoption:["1","2"],candidate:[]} — got ' + JSON.stringify(absent),
  )

  // M1: the false/absent branch still dedups hardPreds' own internal
  // duplicates and a chainPred that repeats a hardPred, hard-first,
  // order-preserving — "what it answered before" in full, not just its shape.
  const dedup = waitsFor({ taskId: 'x', hardPreds: ['1', '1', '2'], chainPreds: ['2', '3'], policy: { speculate: { on_candidate: false } } })
  check(
    JSON.stringify(dedup.adoption) === JSON.stringify(['1', '2', '3']) && Array.isArray(dedup.candidate) && dedup.candidate.length === 0,
    'M1: with on_candidate false, waitsFor(hardPreds:["1","1","2"], chainPreds:["2","3"]) must equal {adoption:["1","2","3"],candidate:[]} — got ' + JSON.stringify(dedup),
  )

  // M1: on_candidate true with an empty chainPreds still answers the fixed
  // shape — no candidate to speak of.
  const noChain = waitsFor({ taskId: 'y', hardPreds: ['1'], chainPreds: [], policy: { speculate: { on_candidate: true } } })
  check(
    JSON.stringify(noChain.adoption) === JSON.stringify(['1']) && Array.isArray(noChain.candidate) && noChain.candidate.length === 0,
    'M1: with on_candidate true and no chainPreds, waitsFor must equal {adoption:["1"],candidate:[]} — got ' + JSON.stringify(noChain),
  )
}

// ── legs (b)+(c): M2/M3, the single-producer speculative start ─────────────

async function legCandidateStart () {
  const { target, planPath, runDir, base } = setupRun(producerConsumerPlan('1', '2'))
  const policyPath = writePolicy(runDir, {
    pairs: { mode: 'live' },
    speculate: { exam_at_zero: false, on_candidate: true },
  })

  const timeline = []
  const gate = makeGate()
  // M2: hold task 1's referee dispatch — reached only once its best
  // candidate has already been measured (it is the very last dispatch a
  // task with `wantsReferee` makes before folding) — so task 1 can never
  // adopt while this exam observes task 2.
  gate.hold('referee:1')

  const { worker, dispatches } = makeFakeWorker({ gate, timeline })
  const { board } = makeFakeBoard({ timeline })
  const { pairs } = makeFakePairs()
  const { judge } = makeFakeJudge({ chainPairs: ['1>2'], refereeTasks: ['1'] })
  const { sh, calls: shCalls } = makeRecordingSh(simEnv())
  const deps = { worker, judge, sh, board, pairs }

  const runPromise = runEngine({ plan: planPath, target, runDir, base, policy: policyPath }, deps)

  // M2: task 2's implementer must start once task 1's candidate is measured
  // — well before task 1 itself adopts (its referee is held). Poll rather
  // than sleep a fixed amount: the exact number of ticks between "candidate
  // measured" and "impl:2:0 dispatched" is the implementer's to choose.
  const sawImpl2 = await waitUntil(() => dispatches.some((d) => d.label === 'impl:2:0'))
  check(sawImpl2, 'M2: impl:2:0 (task 2\'s implementer) must be dispatched — never observed within the timeout')

  const adopted1Yet = timeline.some((e) => e.what === 'state' && e.uid === '1' && e.state === 'adopted')
  check(!adopted1Yet, 'M2: task 2\'s implementer must start before task 1 is adopted (it waits only for task 1\'s measured candidate, not its adoption) — task 1 was already adopted by the time impl:2:0 dispatched')
  check(dispatches.some((d) => d.label === 'referee:1'), 'sanity: task 1\'s referee dispatch must have been reached (proves its candidate really was already measured) before impl:2:0 dispatched')

  // M2: the target repository must resolve refs/factory/cand-1 to a commit
  // — the engine's own git commit of task 1's candidate tree, fetched in.
  const candSha = gitRevParse(target, 'refs/factory/cand-1')
  check(typeof candSha === 'string' && candSha.length > 0, 'M2: target must resolve refs/factory/cand-1 to a commit once task 1\'s candidate is measured — git rev-parse failed')

  // M2: that commit's tree holds the file task 1's fake worker wrote.
  const expectedOut1 = 'impl content for 1 at impl:1:0\n'
  if (candSha) {
    const shown = gitShow(target, candSha + ':out-1.txt')
    check(shown === expectedOut1, 'M2: refs/factory/cand-1\'s tree must hold out-1.txt with task 1\'s implementer\'s own content — expected ' + JSON.stringify(expectedOut1) + ', got ' + JSON.stringify(shown))
  }

  // M2/M3: task 2's implementer clone is made AT that commit.
  const impl2 = dispatches.find((d) => d.label === 'impl:2:0')
  check(Boolean(impl2), 'sanity: impl:2:0 must have a dispatch record')
  if (impl2 && candSha) {
    check(gitHead(impl2.cwd) === candSha, 'M2/M3: impl:2:0\'s clone HEAD must equal refs/factory/cand-1\'s commit (' + candSha + ') — got ' + gitHead(impl2.cwd))
    // M2: the file task 1 produced is present in task 2's implementer clone
    // (the clone was made at the candidate commit, not merely told about it).
    const out1InClone = fs.existsSync(path.join(impl2.cwd, 'out-1.txt')) ? fs.readFileSync(path.join(impl2.cwd, 'out-1.txt'), 'utf8') : null
    check(out1InClone === expectedOut1, 'M2: impl:2:0\'s clone must hold out-1.txt (task 1\'s candidate file) verbatim — got ' + JSON.stringify(out1InClone))
  }

  // M2: "the exam files copied in" — task 2's own exam ran (at the same
  // candidate commit, since speculate.exam_at_zero is off here) and its
  // check.sh is what impl:2:0's clone carries.
  const exam2 = dispatches.find((d) => d.label === 'exam:2')
  check(Boolean(exam2), 'sanity: exam:2 must have a dispatch record')
  if (exam2 && candSha) {
    check(gitHead(exam2.cwd) === candSha, 'M2: exam:2\'s own clone must also be made at refs/factory/cand-1\'s commit — got ' + gitHead(exam2.cwd))
  }
  if (exam2 && impl2) {
    const examCheck = fs.readFileSync(path.join(exam2.cwd, 'check.sh'), 'utf8')
    const implCheck = fs.readFileSync(path.join(impl2.cwd, 'check.sh'), 'utf8')
    check(implCheck === examCheck, 'M2: impl:2:0\'s check.sh must equal exam:2\'s check.sh verbatim — exam wrote ' + JSON.stringify(examCheck) + ', impl clone has ' + JSON.stringify(implCheck))
  }

  // Let task 1 finish (its held referee dispatch resolves, findings empty,
  // no blocking grade, so its own land() folds and adopts normally) so the
  // run can complete and this exam can read its final state.
  gate.release('referee:1')
  const result = await runPromise

  const eventsPath = path.join(runDir, 'events.jsonl')
  const events = fs.readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))

  // M3: the kernel's fold for task 2 was asked with that commit as the
  // patch's anchor.
  const foldCalls = shCalls.filter((c) => c.argv[1] === 'fold')
  const patchArgs = foldCalls.flatMap((c) => {
    const i = c.argv.indexOf('--patch')
    return i >= 0 && i + 1 < c.argv.length ? [c.argv[i + 1]] : []
  })
  const task2PatchArg = patchArgs.find((a) => a.startsWith('2='))
  check(Boolean(task2PatchArg), 'M3: the kernel must have been asked to fold a --patch argument starting "2=" for task 2 — saw ' + JSON.stringify(patchArgs))
  if (task2PatchArg && candSha) {
    check(task2PatchArg.endsWith('@' + candSha), 'M3: task 2\'s --patch argument must end "@" + refs/factory/cand-1\'s commit (' + candSha + ') — got ' + JSON.stringify(task2PatchArg))
  }

  // M3: task 2's captured patch does not contain task 1's file — it was
  // already part of the tree task 2's diff is cut against, not something
  // task 2 itself added.
  if (task2PatchArg) {
    const patchPath = task2PatchArg.slice('2='.length, task2PatchArg.lastIndexOf('@'))
    const patchText = fs.existsSync(patchPath) ? fs.readFileSync(patchPath, 'utf8') : ''
    check(!patchText.includes('out-1.txt'), 'M3: task 2\'s captured patch must not mention out-1.txt (task 1\'s file, already in the anchor tree) — patch was ' + JSON.stringify(patchText).slice(0, 300))
  }

  // M3: the engine appended {kind:'dispatch:on-candidate', task:'2', from:'1', anchor:<commit>}.
  const onCandRow = events.find((e) => e.kind === 'dispatch:on-candidate' && e.task === '2')
  check(Boolean(onCandRow), 'M3: an event {kind:"dispatch:on-candidate", task:"2", ...} must be appended — none found in ' + JSON.stringify(events.map((e) => e.kind)))
  if (onCandRow && candSha) {
    check(
      onCandRow.from === '1' && onCandRow.anchor === candSha,
      'M3: the dispatch:on-candidate row for task 2 must read exactly {kind:"dispatch:on-candidate",task:"2",from:"1",anchor:"' + candSha + '"} — got ' + JSON.stringify(onCandRow),
    )
  }

  check(result.done === true, 'sanity: the run must finish with both tasks adopted — got ' + JSON.stringify(result))
}

// ── leg (d): M4, two or more producers falls back to full adoption wait ────

async function legTwoProducersFallBack () {
  const { target, planPath, runDir, base } = setupRun(TWO_PRODUCER_PLAN)
  const policyPath = writePolicy(runDir, {
    pairs: { mode: 'live' },
    speculate: { exam_at_zero: false, on_candidate: true },
  })

  const timeline = []
  const gate = makeGate()
  const { worker } = makeFakeWorker({ gate, timeline })
  const { board } = makeFakeBoard({ timeline })
  const { pairs } = makeFakePairs()
  const { judge } = makeFakeJudge({ chainPairs: ['1>3', '2>3'] })
  const { sh } = makeRecordingSh(simEnv())
  const deps = { worker, judge, sh, board, pairs }

  const result = await runEngine({ plan: planPath, target, runDir, base, policy: policyPath }, deps)
  check(result.done === true, 'sanity: the two-producer run must finish with all three tasks adopted — got ' + JSON.stringify(result))

  const adopted1 = timeline.find((e) => e.what === 'state' && e.uid === '1' && e.state === 'adopted')
  const adopted2 = timeline.find((e) => e.what === 'state' && e.uid === '2' && e.state === 'adopted')
  const impl3 = timeline.find((e) => e.what === 'dispatch' && e.label === 'impl:3:0')
  check(Boolean(adopted1) && Boolean(adopted2) && Boolean(impl3), 'sanity: task 1, task 2 must adopt and impl:3:0 must dispatch')
  // M4: with two ids in candidate (task 1 and task 2, both producers task 3
  // consumes), task 3 waits for their adoption instead — as if the switch
  // were off for task 3 — so impl:3:0 must start only after BOTH landing
  // rows (a landing row precedes its own 'adopted' board state, appended
  // synchronously earlier in the same run of `runEngine`'s own code, so
  // "after the adopted state" is "after the landing row").
  if (adopted1 && adopted2 && impl3) {
    check(impl3.i > adopted1.i, 'M4: impl:3:0 must dispatch only after task 1 (one of its two candidate producers) is adopted — impl:3:0 at ' + impl3.i + ', task 1 adopted at ' + adopted1.i)
    check(impl3.i > adopted2.i, 'M4: impl:3:0 must dispatch only after task 2 (its other candidate producer) is adopted — impl:3:0 at ' + impl3.i + ', task 2 adopted at ' + adopted2.i)
  }

  const eventsPath = path.join(runDir, 'events.jsonl')
  const events = fs.readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const landingRows = events.filter((e) => e.kind === 'landing')
  check(landingRows.some((e) => e.task === '1') && landingRows.some((e) => e.task === '2'), 'sanity: both task 1 and task 2 must have a landing row')
  // M4: no dispatch:on-candidate row for task 3 — the speculative mechanism
  // never engaged for it.
  const onCandFor3 = events.find((e) => e.kind === 'dispatch:on-candidate' && e.task === '3')
  check(!onCandFor3, 'M4: no {kind:"dispatch:on-candidate", task:"3"} row may be appended when task 3 has two candidate producers — got ' + JSON.stringify(onCandFor3))
}

// ── leg (d), continued: the switch off, single producer ────────────────────

async function legSwitchOff () {
  const { target, planPath, runDir, base } = setupRun(producerConsumerPlan('1', '2'))
  const policyPath = writePolicy(runDir, {
    pairs: { mode: 'live' },
    speculate: { exam_at_zero: false, on_candidate: false },
  })

  const timeline = []
  const gate = makeGate()
  const { worker } = makeFakeWorker({ gate, timeline })
  const { board } = makeFakeBoard({ timeline })
  const { pairs } = makeFakePairs()
  const { judge } = makeFakeJudge({ chainPairs: ['1>2'] })
  const { sh } = makeRecordingSh(simEnv())
  const deps = { worker, judge, sh, board, pairs }

  const result = await runEngine({ plan: planPath, target, runDir, base, policy: policyPath }, deps)
  check(result.done === true, 'sanity: the switch-off run must finish with both tasks adopted — got ' + JSON.stringify(result))

  const adopted1 = timeline.find((e) => e.what === 'state' && e.uid === '1' && e.state === 'adopted')
  const impl2 = timeline.find((e) => e.what === 'dispatch' && e.label === 'impl:2:0')
  check(Boolean(adopted1) && Boolean(impl2), 'sanity: task 1 must adopt and impl:2:0 must dispatch in the switch-off run')
  // M4/M1: with `speculate.on_candidate` false, `waitsFor` answers what it
  // answered before this task — task 2 waits for task 1's full adoption,
  // exactly as if there were no candidate mechanism at all.
  if (adopted1 && impl2) {
    check(impl2.i > adopted1.i, 'M1/M4: with on_candidate false, impl:2:0 must dispatch only after task 1 is adopted (a landing row necessarily precedes it) — impl:2:0 at ' + impl2.i + ', task 1 adopted at ' + adopted1.i)
  }

  const eventsPath = path.join(runDir, 'events.jsonl')
  const events = fs.readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const onCandFor2 = events.find((e) => e.kind === 'dispatch:on-candidate' && e.task === '2')
  check(!onCandFor2, 'M1: no {kind:"dispatch:on-candidate", task:"2"} row may be appended when on_candidate is false — got ' + JSON.stringify(onCandFor2))
}

// ── run everything ───────────────────────────────────────────────────────

async function main () {
  legWaitsFor()
  await legCandidateStart()
  await legTwoProducersFallBack()
  await legSwitchOff()

  if (failures.length) {
    for (const f of failures) process.stderr.write('FAIL: ' + f + '\n')
    process.stderr.write(failures.length + ' failing assertion(s)\n')
    process.exitCode = 1
    return
  }
  console.log('ALL TESTS PASSED')
}

main().catch((e) => {
  process.stderr.write('test_factory_dispatch_candidate.mjs crashed: ' + (e && e.stack || e) + '\n')
  process.exitCode = 1
})

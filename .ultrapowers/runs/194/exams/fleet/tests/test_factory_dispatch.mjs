#!/usr/bin/env node
/**
 * fleet/tests/test_factory_dispatch.mjs — exam for "Every task starts at
 * once — the engine takes its ordering from the pair readings, and every
 * examiner goes at minute zero".
 *
 * Proves M1-M6 against `factory/dispatch.mjs` (Create) and the engine's
 * `runEngine` (Modify, `factory/engine.mjs`) exactly as the task states them.
 * Every assertion below is preceded by a comment naming the clause it
 * measures.
 *
 * The whole rig below the `worker` and `judge` seams is real: a real git
 * repository (`makeRepo`), real `factory/engine.mjs`, and the real fold
 * kernel (`skills/ultrapowers/kernel/fold_wave.py`) via a `sh` that shells
 * out with `simEnv()` — never `process.env` — exactly as
 * `fleet/tests/_readiness_helpers.mjs` already does for the same kernel.
 *
 * `plan_parse.py` does not yet emit a `pairs` field (verified by reading it
 * in full — this exam does not modify it, since it is not a Files entry of
 * the task under exam). To exercise M2/M4/M5/M6 the plan compiler's answer
 * needs a controllable `pairs` array, so this file installs a `python3` shim
 * ahead of the real interpreter on a COPY of `PATH`, for the duration of one
 * `runEngine()` call only: the shim loads the real `plan_parse.py` by path,
 * calls its real `parse_plan_text`, and appends a `pairs` array read from a
 * side JSON file. This is the one place this exam touches `process.env`
 * rather than `simEnv()` — it exists only to feed `factory/engine.mjs`'s own
 * hardcoded, uninjectable `spawnSync('python3', [COMPILER, plan])` call,
 * which has no `deps` seam of its own. Every process THIS FILE spawns
 * directly (the fake `sh` given to `runEngine` as `deps.sh`) is handed
 * `env: simEnv()`, never `process.env`. See the hand-in note for the full
 * rationale.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { simEnv } from './_helpers.mjs'
import { makeRepo, gitSync } from './_engine_helpers.mjs'
import { runEngine } from '../../factory/engine.mjs'
// M1's own module. Absent until the implementer writes it — the import below
// is expected to throw MODULE_NOT_FOUND today, which is this exam's whole
// point: red-for-absent-implementation, not red for a typo.
import { waitsFor } from '../../factory/dispatch.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')
const KERNEL = path.join(REPO_ROOT, 'skills', 'ultrapowers', 'kernel', 'fold_wave.py')
const REAL_PARSER = path.join(REPO_ROOT, 'skills', 'ultrapowers', 'scripts', 'plan_parse.py')

const failures = []
const check = (cond, label) => {
  if (!cond) failures.push(label)
}

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

// Captured once, before any PATH shimming this file ever does (see
// `withPairsCompiled` below) — this exam's own direct `git` calls always use
// `simEnv()`, never `process.env`, and capturing it up front means it is
// never accidentally derived while `process.env.PATH` is wearing the
// compiler shim.
const GIT_ENV = simEnv()
const gitHead = (dir) => execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', env: GIT_ENV }).trim()

// The real `python3` binary's absolute path, found by scanning `GIT_ENV`'s
// own (hermetic, simEnv()-derived) PATH — no process spawned to find it, so
// this needs no exception of its own to the "never process.env" rule.
const realPython3 = (() => {
  for (const dir of String(GIT_ENV.PATH || '').split(path.delimiter)) {
    const candidate = path.join(dir, 'python3')
    try { fs.accessSync(candidate, fs.constants.X_OK); return candidate } catch { /* keep looking */ }
  }
  throw new Error('no python3 found on the hermetic PATH simEnv() built')
})()

// ── the python3 shim: injects `pairs` into the real parser's answer ─────────

function installShim (pairsForRun) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-exam-shim-'))
  const binDir = path.join(dir, 'bin')
  fs.mkdirSync(binDir)
  const pairsJson = path.join(dir, 'pairs.json')
  fs.writeFileSync(pairsJson, JSON.stringify(pairsForRun))
  const shimSrc = [
    '#!' + realPython3,
    'import sys, os, json, importlib.util',
    'spec = importlib.util.spec_from_file_location("plan_parse", ' + JSON.stringify(REAL_PARSER) + ')',
    'mod = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(mod)',
    'result = mod.parse_plan_text(open(sys.argv[-1], "r", encoding="utf-8").read())',
    'p = os.environ.get("EXAM_PAIRS_JSON_PATH")',
    'result["pairs"] = json.load(open(p)) if p else []',
    'sys.stdout.write(json.dumps(result))',
    '',
  ].join('\n')
  const shimPath = path.join(binDir, 'python3')
  fs.writeFileSync(shimPath, shimSrc, { mode: 0o755 })
  return { binDir, pairsJson }
}

/** Runs `fn()` with a `python3` shim ahead of `process.env.PATH` that makes
 *  the compiler's answer carry `pairsForRun` as its `pairs` field. Restores
 *  `process.env.PATH`/`EXAM_PAIRS_JSON_PATH` afterwards no matter what. */
async function withPairsCompiled (pairsForRun, fn) {
  const { binDir, pairsJson } = installShim(pairsForRun)
  const prevPath = process.env.PATH
  const hadPairsVar = Object.prototype.hasOwnProperty.call(process.env, 'EXAM_PAIRS_JSON_PATH')
  const prevPairsVar = process.env.EXAM_PAIRS_JSON_PATH
  process.env.PATH = binDir + path.delimiter + String(prevPath || '')
  process.env.EXAM_PAIRS_JSON_PATH = pairsJson
  try {
    return await fn()
  } finally {
    process.env.PATH = prevPath
    if (hadPairsVar) process.env.EXAM_PAIRS_JSON_PATH = prevPairsVar
    else delete process.env.EXAM_PAIRS_JSON_PATH
  }
}

// ── fakes ─────────────────────────────────────────────────────────────────

/** A fake worker: records every dispatch synchronously (before any await),
 *  honours a gate, and does the minimal real filesystem work each role
 *  needs so the rest of the (real) engine — measure, capture, fold — has
 *  something real to chew on. */
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
function makeFakeBoard ({ timeline, target }) {
  const posts = []
  const states = []
  return {
    board: {
      async post (uid, kind, text) { posts.push({ uid, kind, text }) },
      async factsFor () { return '' },
      async setState (uid, state) {
        states.push({ uid, state })
        timeline.push({ i: timeline.length, what: 'state', uid, state, head: state === 'adopted' ? gitHead(target) : null })
      },
      async states () { return {} },
      async settled () { return null },
    },
    posts,
    states,
  }
}

/** A fake `deps.pairs`: `pairState`/`decideByCode`/`labelPair`, each
 *  recording its calls. `decideByCode` and `labelPair` are keyed by
 *  `pair.a + '>' + pair.b`. */
function makeFakePairs ({ codeVerdicts = {}, labels = {} } = {}) {
  const pairStateCalls = []
  const decideByCodeCalls = []
  const labelPairCalls = []
  return {
    pairs: {
      async pairState ({ pair, tasks, read }) {
        pairStateCalls.push({ pair, tasksIsArray: Array.isArray(tasks), readIsFn: typeof read === 'function' })
        return { pair, key: pair.a + '>' + pair.b }
      },
      decideByCode (state) {
        decideByCodeCalls.push(state)
        const key = state.pair.a + '>' + state.pair.b
        return Object.prototype.hasOwnProperty.call(codeVerdicts, key) ? codeVerdicts[key] : null
      },
      async labelPair ({ pair, tasks, read, folds }) {
        labelPairCalls.push({ pair, tasksIsArray: Array.isArray(tasks), readIsFn: typeof read === 'function', folds })
        const key = pair.a + '>' + pair.b
        return labels[key] || { calls: 0, fold: 'clean' }
      },
    },
    pairStateCalls,
    decideByCodeCalls,
    labelPairCalls,
  }
}

/** A fake `deps.judge`: only the two new pair readers plus whatever a
 *  caller adds. `readPair`/`readPairCandidate` are keyed the same way as
 *  the fake pairs object above. */
function makeFakeJudge ({ pairVerdicts = {}, candidateAnswers = {} } = {}) {
  const readPairCalls = []
  const readPairCandidateCalls = []
  const judge = {
    async readPair (state) {
      readPairCalls.push(state)
      const key = state.pair.a + '>' + state.pair.b
      return pairVerdicts[key] || { verdict: 'look', score: 0 }
    },
    async readPairCandidate (arg) {
      readPairCandidateCalls.push(arg)
      const key = (arg.pair && (arg.pair.a + '>' + arg.pair.b)) || Object.keys(candidateAnswers)[0]
      return candidateAnswers[key] || { changes: false, score: 0 }
    },
  }
  return { judge, readPairCalls, readPairCandidateCalls }
}

const fakeSh = (shEnv) => (cmd, argv = [], cwd, input) =>
  spawnSync(cmd, argv, { cwd, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: shEnv })

function writePolicy (dir, doc) {
  const p = path.join(dir, 'policy.json')
  fs.writeFileSync(p, JSON.stringify(doc))
  return p
}

// ── plan fixtures ────────────────────────────────────────────────────────

/** Tasks 1 (producer), 2 (consumer of 1's `thing`), 3 (bystander — its pair
 *  with 1 is a files-only one, injected independently of the real parser's
 *  own edge detection, exactly as `pairs` itself is injected). */
const MAIN_PLAN = `**Exam command:** bash check.sh

### Task 1: producer

**Type:** implementation

- Create: \`out1.txt\`

**Interfaces:**
- Produces: \`thing\`

**Proof:**
- Test: \`check.sh\`

### Task 2: consumer

**Type:** implementation

- Create: \`out2.txt\`

**Interfaces:**
- Consumes: \`thing\`

**Proof:**
- Test: \`check.sh\`

### Task 3: bystander

**Type:** implementation

- Create: \`out3.txt\`

**Proof:**
- Test: \`check.sh\`
`

const twoTaskPlan = (idA, idB) => `**Exam command:** bash check.sh

### Task ${idA}: ${idA}

**Type:** implementation

- Create: \`out-${idA}.txt\`

**Proof:**
- Test: \`check.sh\`

### Task ${idB}: ${idB}

**Type:** implementation

- Create: \`out-${idB}.txt\`

**Proof:**
- Test: \`check.sh\`
`

/** Task B hard-depends on task A through a real write-after-create edge —
 *  used only by the M6 speculate-off leg, independent of pairs. */
const DEPENDENT_PLAN = `**Exam command:** bash check.sh

### Task A: a

**Type:** implementation

- Create: \`shared3.txt\`

**Proof:**
- Test: \`check.sh\`

### Task B: b

**Type:** implementation

- Modify: \`shared3.txt\`

**Proof:**
- Test: \`check.sh\`
`

function setupRun (planText) {
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-exam-run-'))
  const target = path.join(runRoot, 'repo')
  makeRepo(target, { 'shared.txt': 'shared\n' })
  const planPath = path.join(runRoot, 'plan.md')
  fs.writeFileSync(planPath, planText)
  const runDir = path.join(runRoot, 'rundir')
  const base = gitSync(['rev-parse', 'HEAD'], target)
  return { runRoot, target, planPath, runDir, base }
}

// ── leg (a): M1 ──────────────────────────────────────────────────────────

/** Exact equality on the fixed `{adoption, candidate}` shape, independent of
 *  which order the implementer's object literal put the two keys in —
 *  `JSON.stringify` on the whole object would false-negative on a correct
 *  `{candidate: [], adoption: [...]}` answer, which is not what M1 pins. */
function sameAnswer (w, expectedAdoption) {
  if (!w || typeof w !== 'object') return false
  if (Object.keys(w).sort().join(',') !== 'adoption,candidate') return false
  if (JSON.stringify(w.adoption) !== JSON.stringify(expectedAdoption)) return false
  return Array.isArray(w.candidate) && w.candidate.length === 0
}

function legA () {
  // M1: adoption is hardPreds followed by chainPreds, deduplicated; candidate is [].
  const w1 = waitsFor({ taskId: '3', hardPreds: ['1'], chainPreds: ['2', '1'], policy: {} })
  check(
    sameAnswer(w1, ['1', '2']),
    'M1: waitsFor({hardPreds:["1"],chainPreds:["2","1"]}) must equal {adoption:["1","2"],candidate:[]} (dedup keeps first occurrence, hard preds first) — got ' + JSON.stringify(w1),
  )

  // M1: an empty pair of predecessor lists still answers the fixed shape.
  const w2 = waitsFor({ taskId: '1', hardPreds: [], chainPreds: [], policy: {} })
  check(
    sameAnswer(w2, []),
    'M1: waitsFor with no predecessors at all must equal {adoption:[],candidate:[]} — got ' + JSON.stringify(w2),
  )

  // M1: hardPreds' own internal duplicates, and a chainPred that repeats a
  // hardPred, are all collapsed by the one dedup pass — order-preserving,
  // hard predecessors first.
  const w3 = waitsFor({ taskId: 'x', hardPreds: ['1', '1', '2'], chainPreds: ['2', '3'], policy: { anything: true } })
  check(
    sameAnswer(w3, ['1', '2', '3']),
    'M1: waitsFor(hardPreds:["1","1","2"], chainPreds:["2","3"]) must equal {adoption:["1","2","3"],candidate:[]} — got ' + JSON.stringify(w3),
  )
}

// ── leg (b)+(c)+(d)+(e): the main run ───────────────────────────────────

async function legMainRun () {
  const { target, planPath, runDir, base } = setupRun(MAIN_PLAN)
  const policyPath = writePolicy(runDir, {
    pairs: { mode: 'live' },
    speculate: { exam_at_zero: true },
  })

  const pairAB = { a: '1', b: '2', why: 'interface', producer: '1', consumer: '2', symbol: 'thing' }
  const pairAC = { a: '1', b: '3', why: 'files' }

  const timeline = []
  const gate = makeGate()
  // M3: hold every exam dispatch so the "all exams before any implementer"
  // moment is observable before anything is released.
  const examHold1 = gate.hold('exam:1')
  const examHold2 = gate.hold('exam:2')
  const examHold3 = gate.hold('exam:3')

  const { worker, dispatches } = makeFakeWorker({ gate, timeline })
  const { board, posts } = makeFakeBoard({ timeline, target })
  const { pairs, pairStateCalls, decideByCodeCalls, labelPairCalls } = makeFakePairs({
    // M2: the files-only pair (1,3) is decided by code — verdict 'fold',
    // which M2 says is NOT an ordering (only 'chain' orders).
    codeVerdicts: { '1>3': 'fold' },
    labels: {
      '1>2': { calls: 3, fold: 'resolved' },
      '1>3': { calls: 1, fold: 'clean' },
    },
  })
  const { judge, readPairCalls, readPairCandidateCalls } = makeFakeJudge({
    // M2: the interface pair (1,2) falls through to Jev — verdict 'chain',
    // which IS an ordering, producer -> consumer.
    pairVerdicts: { '1>2': { verdict: 'chain', score: 0.87 } },
    candidateAnswers: { '1>2': { changes: true, score: 0.42 } },
  })

  const shEnv = simEnv()
  const deps = { worker, judge, sh: fakeSh(shEnv), board, pairs }

  // Release the exam holds once all three have been observed dispatched
  // (checked below), then let the run finish.
  const runPromise = withPairsCompiled([pairAB, pairAC], () =>
    runEngine({ plan: planPath, target, runDir, base, policy: policyPath }, deps))

  // Give the held exam dispatches a moment to register (they push to
  // `dispatches`/`timeline` synchronously before awaiting the gate).
  await new Promise((r) => setTimeout(r, 50))

  const examLabelsSoFar = dispatches.filter((d) => d.role === 'exam').map((d) => d.label).sort()
  const implLabelsSoFar = dispatches.filter((d) => d.role === 'implement')
  // M3: every task's exam worker is dispatched before any implementer.
  check(
    JSON.stringify(examLabelsSoFar) === JSON.stringify(['exam:1', 'exam:2', 'exam:3']),
    'M3: all three exam workers must be dispatched (exam:1, exam:2, exam:3) before any implementer starts — dispatched so far: ' + JSON.stringify(examLabelsSoFar),
  )
  check(
    implLabelsSoFar.length === 0,
    'M3: no implementer may be dispatched before every exam worker has started — saw ' + JSON.stringify(implLabelsSoFar.map((d) => d.label)),
  )
  // M3: exam:2's task (2) has a real predecessor (task 1, via the chain
  // verdict below) yet its exam still ran at zero, without waiting on it —
  // proven by it being in the "before any implementer" set above, and here
  // by its clone being at the run's base rather than waiting for anything.
  const exam2 = dispatches.find((d) => d.label === 'exam:2')
  check(Boolean(exam2), 'M3: exam:2 must have dispatched')
  if (exam2) {
    check(
      gitHead(exam2.cwd) === base,
      'M3: every exam worker runs in a clone of the run\'s base — exam:2\'s clone HEAD must equal the run\'s base ' + base + ', got ' + gitHead(exam2.cwd),
    )
  }
  const exam1 = dispatches.find((d) => d.label === 'exam:1')
  const exam3 = dispatches.find((d) => d.label === 'exam:3')
  for (const [name, rec] of [['exam:1', exam1], ['exam:3', exam3]]) {
    check(Boolean(rec), 'M3: ' + name + ' must have dispatched')
    if (rec) {
      check(
        gitHead(rec.cwd) === base,
        'M3: ' + name + '\'s clone HEAD must equal the run\'s base ' + base + ', got ' + gitHead(rec.cwd),
      )
    }
  }

  gate.release('exam:1')
  gate.release('exam:2')
  gate.release('exam:3')

  const result = await runPromise

  // ---- M2: pair event rows -------------------------------------------
  const eventsPath = path.join(runDir, 'events.jsonl')
  const events = fs.readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const pairRows = events.filter((e) => e.kind === 'pair')
  const rowAB = pairRows.find((e) => e.a === '1' && e.b === '2')
  const rowAC = pairRows.find((e) => e.a === '1' && e.b === '3')

  check(Boolean(rowAB), 'M2: a {kind:"pair", a:"1", b:"2"} row must be appended to events.jsonl for the producer/consumer pair')
  if (rowAB) {
    check(
      rowAB.why === 'interface' && rowAB.verdict === 'chain' && rowAB.by === 'jev' && rowAB.score === 0.87,
      'M2: pair (1,2) row must read exactly {kind:"pair",a:"1",b:"2",why:"interface",verdict:"chain",by:"jev",score:0.87} (decideByCode answered null for it, so readPair\'s verdict and by:"jev" apply) — got ' + JSON.stringify(rowAB),
    )
  }
  check(Boolean(rowAC), 'M2: a {kind:"pair", a:"1", b:"3"} row must be appended for the files-only pair')
  if (rowAC) {
    check(
      rowAC.why === 'files' && rowAC.verdict === 'fold' && rowAC.by === 'code' && rowAC.score === null,
      'M2: pair (1,3) row must read exactly {kind:"pair",a:"1",b:"3",why:"files",verdict:"fold",by:"code",score:null} (decideByCode answered "fold" for it, so no Jev score) — got ' + JSON.stringify(rowAC),
    )
  }

  // M2: pairState was consulted for both pairs, with `{pair, tasks, read}`.
  check(pairStateCalls.length === 2, 'M2: pairState must be called once per pair (2 pairs here) — called ' + pairStateCalls.length + ' time(s)')
  check(
    pairStateCalls.every((c) => c.tasksIsArray && c.readIsFn),
    'M2: every pairState call must carry an array `tasks` and a function `read`',
  )
  // M2: decideByCode was tried for both pairs (before falling back to readPair).
  check(decideByCodeCalls.length === 2, 'M2: decideByCode must be tried for every pair — called ' + decideByCodeCalls.length + ' time(s)')
  // M2: readPair was asked only for the pair decideByCode left undecided.
  check(readPairCalls.length === 1, 'M2: readPair must be asked only when decideByCode answered null — called ' + readPairCalls.length + ' time(s)')

  // ---- M2: only a chain verdict orders, and ordering is dropped on cycle
  // (the cycle half of M2 is proven by legCycle(); here we prove the
  // positive direction: pair (1,3)'s 'fold' verdict produced NO ordering,
  // by checking task 3's implementer was never held back by task 1.)
  const impl3 = dispatches.find((d) => d.label === 'impl:3:0')
  const impl1 = dispatches.find((d) => d.label === 'impl:1:0')
  check(Boolean(impl3) && Boolean(impl1), 'sanity: impl:1:0 and impl:3:0 must both have dispatched')
  if (impl3 && impl1) {
    const iImpl3 = timeline.find((e) => e.what === 'dispatch' && e.label === 'impl:3:0').i
    const iAdopted1 = timeline.find((e) => e.what === 'state' && e.uid === '1' && e.state === 'adopted')
    check(
      !iAdopted1 || iImpl3 < iAdopted1.i,
      'M2: a "fold" verdict on the files-only pair (1,3) must not order task 3 after task 1 — impl:3:0 dispatched at timeline index ' + iImpl3 + ', task 1 adopted at ' + (iAdopted1 && iAdopted1.i),
    )
  }

  // ---- M3: task 2's implementer waited for task 1's adoption ----------
  const adopted1Entry = timeline.find((e) => e.what === 'state' && e.uid === '1' && e.state === 'adopted')
  const impl2Entry = timeline.find((e) => e.what === 'dispatch' && e.label === 'impl:2:0')
  check(Boolean(adopted1Entry), 'sanity: task 1 must have adopted')
  check(Boolean(impl2Entry), 'sanity: impl:2:0 must have dispatched')
  if (adopted1Entry && impl2Entry) {
    // M3: a task's implementers start when every id in waitsFor(...).adoption
    // is adopted — here waitsFor({hardPreds:[],chainPreds:['1']}).adoption
    // is ['1'], so impl:2:0 must start strictly after task 1 adopts.
    check(
      impl2Entry.i > adopted1Entry.i,
      'M3: impl:2:0 must dispatch only after task 1 is adopted (chain ordering from the pair) — impl:2:0 at ' + impl2Entry.i + ', task 1 adopted at ' + adopted1Entry.i,
    )
    // M3: impl:2:0 runs in a clone of the head at that moment.
    const impl2 = dispatches.find((d) => d.label === 'impl:2:0')
    check(
      Boolean(impl2) && gitHead(impl2.cwd) === adopted1Entry.head,
      'M3: impl:2:0 must run in a clone of the head as of task 1\'s adoption (' + (adopted1Entry && adopted1Entry.head) + '), got ' + (impl2 && gitHead(impl2.cwd)),
    )
    // M3: the exam files are copied in — impl:2:0's check.sh must carry
    // exactly what exam:2 wrote, verbatim.
    if (impl2) {
      const examContent = fs.readFileSync(path.join(exam2.cwd, 'check.sh'), 'utf8')
      const implContent = fs.readFileSync(path.join(impl2.cwd, 'check.sh'), 'utf8')
      check(
        implContent === examContent,
        'M3: impl:2:0\'s check.sh must equal exam:2\'s check.sh verbatim (the exam files copied in) — exam wrote ' + JSON.stringify(examContent) + ', impl clone has ' + JSON.stringify(implContent),
      )
    }
  }

  // ---- M4: producer's candidate measured while consumer already dispatched
  const candidateRows = events.filter((e) => e.kind === 'pair:candidate')
  const candRow = candidateRows.find((e) => e.a === '1' && e.b === '2')
  check(Boolean(candRow), 'M4: a {kind:"pair:candidate", a:"1", b:"2"} row must be appended when task 1\'s best candidate is first measured (task 2 was already dispatched via its exam-at-zero exam)')
  if (candRow) {
    check(
      candRow.changes === true && candRow.score === 0.42,
      'M4: pair:candidate row must carry readPairCandidate\'s own changes/score — expected {changes:true,score:0.42}, got ' + JSON.stringify(candRow),
    )
  }
  check(readPairCandidateCalls.length === 1, 'M4: readPairCandidate must be asked exactly once for the (1,2) pair — called ' + readPairCandidateCalls.length + ' time(s)')
  if (readPairCandidateCalls.length) {
    const arg = readPairCandidateCalls[0]
    const patchFile = path.join(runDir, 'patch-1-0.diff')
    const expectedHunks = fs.existsSync(patchFile) ? fs.readFileSync(patchFile, 'utf8') : null
    // M4: hunks = hunksCarrying(<producer's patch>, [pair.symbol], 8000). The
    // synthetic patch here is well under 8000 chars, and hunksCarrying passes
    // a diff through unchanged when it already fits the cap (factory/hunks.mjs),
    // so the hunks argument must equal the raw patch file content exactly.
    check(
      typeof expectedHunks === 'string' && arg.hunks === expectedHunks,
      'M4: readPairCandidate\'s `hunks` argument must equal task 1\'s captured patch verbatim (hunksCarrying passes small diffs through unchanged) — expected ' + JSON.stringify(expectedHunks).slice(0, 200) + ', got ' + JSON.stringify(arg.hunks).slice(0, 200),
    )
    // M4: readPairCandidate is also handed the consumer's state (the second
    // logical argument the clause names). The Machine text does not pin an
    // exact key name for it, so this checks only that some second field
    // besides `hunks` was supplied.
    const extraKeys = Object.keys(arg).filter((k) => k !== 'hunks')
    check(
      extraKeys.length > 0,
      'M4: readPairCandidate must be given the consumer\'s state as well as `hunks` — call carried only ' + JSON.stringify(Object.keys(arg)),
    )
  }
  // M4: changes:true -> board.post(<consumer>, 'pair', <text naming the
  // producer and the symbol>).
  const pairPost = posts.find((p) => p.kind === 'pair' && p.uid === '2')
  check(Boolean(pairPost), 'M4: board.post must be called for the consumer ("2") with kind "pair" when changes is true')
  if (pairPost) {
    check(
      pairPost.text.includes('1') && pairPost.text.includes('thing'),
      'M4: the "pair" post to the consumer must name the producer ("1") and the symbol ("thing") — got ' + JSON.stringify(pairPost.text),
    )
  }

  // ---- M5: one pair:label row per pair, at the end of the run ---------
  const labelRows = events.filter((e) => e.kind === 'pair:label')
  check(labelRows.length === 2, 'M5: exactly one pair:label row per pair (2 pairs) must be appended when the run ends — got ' + labelRows.length)
  const labelAB = labelRows.find((e) => e.a === '1' && e.b === '2')
  const labelAC = labelRows.find((e) => e.a === '1' && e.b === '3')
  check(
    Boolean(labelAB) && labelAB.calls === 3 && labelAB.fold === 'resolved',
    'M5: pair (1,2)\'s label row must equal labelPair\'s own answer exactly — expected {kind:"pair:label",a:"1",b:"2",calls:3,fold:"resolved"}, got ' + JSON.stringify(labelAB),
  )
  check(
    Boolean(labelAC) && labelAC.calls === 1 && labelAC.fold === 'clean',
    'M5: pair (1,3)\'s label row must equal labelPair\'s own answer exactly — expected {kind:"pair:label",a:"1",b:"3",calls:1,fold:"clean"}, got ' + JSON.stringify(labelAC),
  )
  check(labelPairCalls.length === 2, 'M5: labelPair must be called once per pair — called ' + labelPairCalls.length + ' time(s)')

  check(result.done === true, 'sanity: the main run must finish with every task adopted — got ' + JSON.stringify(result))
}

// ── leg: M2's cycle guard ───────────────────────────────────────────────

async function legCycle () {
  const { target, planPath, runDir, base } = setupRun(twoTaskPlan('X', 'Y'))
  const policyPath = writePolicy(runDir, { pairs: { mode: 'live' }, speculate: { exam_at_zero: false } })

  // Two pairs whose chain verdicts point opposite ways: X -> Y is applied
  // first (array order), so Y -> X, asked second, would close a cycle.
  const pairXY = { a: 'X', b: 'Y', why: 'interface', producer: 'X', consumer: 'Y', symbol: 's' }
  const pairYX = { a: 'Y', b: 'X', why: 'interface', producer: 'Y', consumer: 'X', symbol: 's' }

  const timeline = []
  const gate = makeGate()
  const { worker } = makeFakeWorker({ gate, timeline })
  const { board } = makeFakeBoard({ timeline, target })
  const { pairs } = makeFakePairs({ labels: { 'X>Y': { calls: 0, fold: 'clean' }, 'Y>X': { calls: 0, fold: 'clean' } } })
  const { judge } = makeFakeJudge({
    pairVerdicts: {
      'X>Y': { verdict: 'chain', score: 1 },
      'Y>X': { verdict: 'chain', score: 1 },
    },
  })
  const shEnv = simEnv()
  const deps = { worker, judge, sh: fakeSh(shEnv), board, pairs }

  const result = await withPairsCompiled([pairXY, pairYX], () =>
    runEngine({ plan: planPath, target, runDir, base, policy: policyPath }, deps))

  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const cycleRows = events.filter((e) => e.kind === 'pair:cycle')
  // M2: an ordering that would close a cycle is dropped, with a
  // {kind:'pair:cycle', a, b} row for the dropped one — Y -> X, asked second.
  check(
    cycleRows.length === 1 && cycleRows[0].a === 'Y' && cycleRows[0].b === 'X',
    'M2: the second pair (Y,X), whose chain ordering would close a cycle with the first pair\'s (X,Y) ordering, must be dropped with exactly one {kind:"pair:cycle",a:"Y",b:"X"} row — got ' + JSON.stringify(cycleRows),
  )
  // M2 (continued, via M3/adoption): the surviving ordering (X -> Y) still
  // adopts both tasks — a dropped ordering parks nothing.
  check(
    result.done === true && result.adopted.includes('X') && result.adopted.includes('Y'),
    'M2: dropping the cycling ordering must not park either task — both X and Y must still adopt — got ' + JSON.stringify(result),
  )
}

// ── leg: M4's changes:false branch ──────────────────────────────────────

async function legCandidateNoChanges () {
  const { target, planPath, runDir, base } = setupRun(twoTaskPlan('P', 'Q'))
  const policyPath = writePolicy(runDir, { pairs: { mode: 'live' }, speculate: { exam_at_zero: true } })
  const pairPQ = { a: 'P', b: 'Q', why: 'interface', producer: 'P', consumer: 'Q', symbol: 'z' }

  const timeline = []
  const gate = makeGate()
  const { worker } = makeFakeWorker({ gate, timeline })
  const { board, posts } = makeFakeBoard({ timeline, target })
  const { pairs } = makeFakePairs({ labels: { 'P>Q': { calls: 0, fold: 'clean' } } })
  const { judge, readPairCandidateCalls } = makeFakeJudge({
    pairVerdicts: { 'P>Q': { verdict: 'chain', score: 1 } },
    candidateAnswers: { 'P>Q': { changes: false, score: 0 } },
  })
  const shEnv = simEnv()
  const deps = { worker, judge, sh: fakeSh(shEnv), board, pairs }

  await withPairsCompiled([pairPQ], () =>
    runEngine({ plan: planPath, target, runDir, base, policy: policyPath }, deps))

  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const candRow = events.find((e) => e.kind === 'pair:candidate' && e.a === 'P' && e.b === 'Q')
  // M4: the row is appended whether or not changes is true.
  check(Boolean(candRow) && candRow.changes === false, 'M4: a pair:candidate row must still be appended when changes is false — got ' + JSON.stringify(candRow))
  check(readPairCandidateCalls.length === 1, 'M4: readPairCandidate must still be asked once — called ' + readPairCandidateCalls.length + ' time(s)')
  // M4: only posts when changes is true — none here.
  const pairPosts = posts.filter((p) => p.kind === 'pair')
  check(pairPosts.length === 0, 'M4: board.post(..., "pair", ...) must NOT be called when changes is false — got ' + JSON.stringify(pairPosts))
}

// ── leg (f): M6, mode off ────────────────────────────────────────────────

async function legModeOff () {
  const { target, planPath, runDir, base } = setupRun(MAIN_PLAN)
  const policyPath = writePolicy(runDir, { pairs: { mode: 'off' }, speculate: { exam_at_zero: false } })

  const timeline = []
  const gate = makeGate()
  const { worker, dispatches } = makeFakeWorker({ gate, timeline })
  const { board } = makeFakeBoard({ timeline, target })
  const { pairs, pairStateCalls, decideByCodeCalls, labelPairCalls } = makeFakePairs()
  const { judge, readPairCalls, readPairCandidateCalls } = makeFakeJudge()
  const shEnv = simEnv()
  const deps = { worker, judge, sh: fakeSh(shEnv), board, pairs }

  // A pairs array is still injected by the plan compiler (as it would be
  // live), to prove mode:'off' is what suppresses the mechanism — not the
  // absence of any pairs to read.
  const pairAB = { a: '1', b: '2', why: 'interface', producer: '1', consumer: '2', symbol: 'thing' }
  const pairAC = { a: '1', b: '3', why: 'files' }
  const result = await withPairsCompiled([pairAB, pairAC], () =>
    runEngine({ plan: planPath, target, runDir, base, policy: policyPath }, deps))

  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  // M6: appends no row whose kind begins `pair`.
  const pairishRows = events.filter((e) => typeof e.kind === 'string' && e.kind.startsWith('pair'))
  check(pairishRows.length === 0, 'M6: with pairs.mode not "live", no event row whose kind begins "pair" may be appended — got ' + JSON.stringify(pairishRows))
  // M6: asks neither pair reader.
  check(
    pairStateCalls.length === 0 && decideByCodeCalls.length === 0 && labelPairCalls.length === 0,
    'M6: with pairs.mode not "live", pairState/decideByCode/labelPair must never be called — called ' + pairStateCalls.length + '/' + decideByCodeCalls.length + '/' + labelPairCalls.length + ' time(s) respectively',
  )
  check(
    readPairCalls.length === 0 && readPairCandidateCalls.length === 0,
    'M6: with pairs.mode not "live", readPair/readPairCandidate must never be called — called ' + readPairCalls.length + '/' + readPairCandidateCalls.length + ' time(s) respectively',
  )

  // M6: the engine honours every edge the parser printed — task 2's real
  // "interface" dag_edge from task 1 (Produces/Consumes "thing") must still
  // order it, exactly as it did before this task's change, even though M2
  // says that same edge is EXCLUDED from hard predecessors when mode is live.
  const adopted1 = timeline.find((e) => e.what === 'state' && e.uid === '1' && e.state === 'adopted')
  const impl2 = timeline.find((e) => e.what === 'dispatch' && e.label === 'impl:2:0')
  check(Boolean(adopted1) && Boolean(impl2), 'sanity: task 1 must adopt and impl:2:0 must dispatch in the mode:"off" run')
  if (adopted1 && impl2) {
    check(
      impl2.i > adopted1.i,
      'M6: with pairs.mode not "live", task 2 must still wait on task 1 through the parser\'s own "interface" edge — impl:2:0 dispatched at ' + impl2.i + ', task 1 adopted at ' + adopted1.i,
    )
  }
  check(result.done === true, 'sanity: the mode:"off" run must still finish with every task adopted — got ' + JSON.stringify(result))
  check(dispatches.length > 0, 'sanity: some dispatch must have happened in the mode:"off" run')
}

// ── leg (f): M6, speculate off ───────────────────────────────────────────

async function legSpeculateOff () {
  const { target, planPath, runDir, base } = setupRun(DEPENDENT_PLAN)
  const policyPath = writePolicy(runDir, { pairs: { mode: 'off' }, speculate: { exam_at_zero: false } })

  const timeline = []
  const gate = makeGate()
  const { worker } = makeFakeWorker({ gate, timeline })
  const { board } = makeFakeBoard({ timeline, target })
  const { pairs } = makeFakePairs()
  const { judge } = makeFakeJudge()
  const shEnv = simEnv()
  const deps = { worker, judge, sh: fakeSh(shEnv), board, pairs }

  const result = await withPairsCompiled([], () =>
    runEngine({ plan: planPath, target, runDir, base, policy: policyPath }, deps))

  // M6: with speculate.exam_at_zero false, a task's exam worker is
  // dispatched only when its implementers may start — task B hard-depends
  // on task A (write-after-create on shared3.txt), so exam:B must not
  // dispatch before task A adopts.
  const adoptedA = timeline.find((e) => e.what === 'state' && e.uid === 'A' && e.state === 'adopted')
  const examB = timeline.find((e) => e.what === 'dispatch' && e.label === 'exam:B')
  check(Boolean(adoptedA), 'sanity: task A must adopt in the speculate-off run')
  check(Boolean(examB), 'sanity: exam:B must dispatch in the speculate-off run')
  if (adoptedA && examB) {
    check(
      examB.i > adoptedA.i,
      'M6: with speculate.exam_at_zero false, exam:B must not dispatch until task A (its predecessor) has adopted — exam:B dispatched at ' + examB.i + ', task A adopted at ' + adoptedA.i,
    )
  }
  // M6 (contrast): task A itself has no predecessor, so its exam still runs
  // essentially immediately — its own implementers gate is empty adoption.
  const examA = timeline.find((e) => e.what === 'dispatch' && e.label === 'exam:A')
  check(Boolean(examA), 'sanity: exam:A must dispatch')
  if (examA && adoptedA) {
    check(
      examA.i < adoptedA.i,
      'M6: task A, having no predecessor, must have its exam dispatched before it itself adopts — exam:A at ' + examA.i + ', adopted at ' + adoptedA.i,
    )
  }
  check(result.done === true, 'sanity: the speculate-off run must finish with every task adopted — got ' + JSON.stringify(result))
}

// ── run everything ───────────────────────────────────────────────────────

async function main () {
  legA()
  await legMainRun()
  await legCycle()
  await legCandidateNoChanges()
  await legModeOff()
  await legSpeculateOff()

  if (failures.length) {
    for (const f of failures) process.stderr.write('FAIL: ' + f + '\n')
    process.stderr.write(failures.length + ' failing assertion(s)\n')
    process.exitCode = 1
    return
  }
  console.log('ALL TESTS PASSED')
}

main().catch((e) => {
  process.stderr.write('test_factory_dispatch.mjs crashed: ' + (e && e.stack || e) + '\n')
  process.exitCode = 1
})

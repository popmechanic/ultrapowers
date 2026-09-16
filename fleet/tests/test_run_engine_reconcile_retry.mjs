// fleet/tests/test_run_engine_reconcile_retry.mjs — the exam for "a reconcile
// that produced no reply is dispatched once more before the epoch is blocked".
//
// Claim: fold a wave whose candidate suite is red and whose reconcile worker
// dies without answering; the driver asks a FRESH reconcile worker the same
// question once more, records that it did, and only blocks the epoch when the
// second one has no reply either.
//
// The Machine clauses under test, restated:
//   M1 — in the wave-fold's reconcile round, a dispatch whose reply is `null`,
//        or whose call threw an error not beginning `RUN_FATAL`, is dispatched
//        a SECOND time with a byte-identical prompt and the same `label`,
//        `model` and `schema`, before the attempt is read as no reply.
//   M2 — the second dispatch's reply, when it is an object, IS the attempt's
//        reply: a `FIXED` there is committed and the suite re-run exactly as a
//        first-dispatch `FIXED` is at BASE.
//   M3 — a second no-reply ends the round as at BASE: the `judgmentCalls` entry
//        `wave <n>: reconcile attempt <a> produced no reply` and the epoch's
//        `TEST_FAILED` route, with no third dispatch.
//   M4 — each re-dispatch appends ONE `driver:reconcile-retry` event
//        `{ wave, attempt, class }` to `events.jsonl` — `class` the thrown
//        error's `workerVerdict.class` when it carries one, `null` for a `null`
//        reply — and one `judgmentCalls` entry `wave <n>: reconcile attempt <a>
//        produced no reply (<class>) — re-dispatched once`.
//   M5 — a first dispatch whose reply is an object, or whose throw begins
//        `RUN_FATAL`, is never re-dispatched.
//   M6 — `fleet/CONTRACT.md` names `driver:reconcile-retry` with its three keys.
//
// The Proof legs, and where each is answered:
//   (a) [M1, M2] throw-with-`workerVerdict` then `FIXED`: two dispatches, same
//                prompt/model/schema, `MERGED`                — scenario A
//   (b) [M4]     that run's one `driver:reconcile-retry` and its judgment line
//                                                            — scenario A
//   (c) [M1, M2, M4] `null` then `FIXED`: two dispatches, `MERGED`, `class`
//                is `null`                                   — scenario C
//   (d) [M3]     a throw on BOTH calls: two dispatches and no third, the BASE
//                literal as the final reconcile entry, `TEST_FAILED`
//                                                            — scenario D
//   (e) [M5]     a first-dispatch `BLOCKED`: one dispatch, no retry event
//                                                            — scenario E
//   (f) [M5]     a first-dispatch `RUN_FATAL`: one dispatch, the throw reaches
//                the sim                                     — scenario F
//   (g) [M6]     the contract names the event and its three keys — and the
//                Proof's `Run:` grep says the same thing     — scenario G
//
// ── how this sim provokes the reconcile round ───────────────────────────────
// Everything below the agent seam is real: real git repos, real clones at BASE,
// the real capture, the real fold kernel through the real exec seam. Only the
// judgments are canned, so every dispatch counted below is the driver's own.
//
// One task, whose implementer writes `A.txt`. The repository's suite is
// `[ ! -f A.txt ] || [ -f FIX ]`: green at BASE, RED on the folded candidate,
// and green again once a `FIX` file exists. It prints nothing when it fails, so
// the failing output names no path, the unattributed-red route is not taken,
// and the candidate goes down the reconcile route — exactly one reconcile round
// per run.
//
// WHY THE FIX IS A NEW FILE AND NOT A REMOVED MARKER. The reconcile worker runs
// in the integration clone, whose HEAD is `prevHead`. A stub that repaired the
// candidate by DELETING what the implementer wrote would leave an index equal
// to `HEAD`, and BASE's own guard ("reconcile reported FIXED but changed
// nothing — not committing") would break the round before any commit. Writing
// `FIX` is a change against both the candidate and `HEAD`, so a `FIXED` here
// takes the commit-and-re-run path M2 names.
//
// TWO READINGS THIS FILE SETTLES, because a later session would otherwise have
// to reconstruct them:
//
// 1. THE RE-DISPATCH IS INSIDE ATTEMPT 1. M3's final literal is `wave 1:
//    reconcile attempt 1 produced no reply` and M4's retry literal names
//    attempt 1 as well, so a retry does NOT advance the round's attempt
//    counter. Leg (d) therefore reads "no third dispatch" as: exactly two
//    dispatches, both labelled `reconcile:wave1:1`, and no `reconcile:wave1:2`
//    anywhere in the run.
//
// 2. "EXACTLY AS A FIRST-DISPATCH `FIXED` IS AT BASE" (M2) IS PINNED ON WHAT
//    BASE DOES WITH ONE. At BASE a first-dispatch `FIXED` that changed the tree
//    commits `wave 1 reconcile (attempt 1)` onto the candidate, re-runs the
//    suite and pushes `wave 1: candidate adopted after reconcile (…)`. Legs (a)
//    and (c) assert that same subject and that same judgment line for a reply
//    that arrived on the SECOND dispatch — which is what makes it the attempt's
//    reply rather than a second attempt's.
//
// WHY THIS IS RED AT BASE. At BASE a reconcile dispatch that throws or answers
// `null` is read as no reply at once: one dispatch, no `driver:reconcile-retry`
// event, no retry judgment line, and the epoch takes `TEST_FAILED`. Scenario A
// — leg (a), the falsifier — records one dispatch where the Claim asks for two,
// and says so in its first assertion.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeRepo, rig, passReview, doneImpl, gitSync } from './_engine_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FLEET_DIR = path.resolve(HERE, '..')
const CONTRACT_SRC = path.join(FLEET_DIR, 'CONTRACT.md')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-reconcile-retry-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// The suite: green at BASE, red once the implementer's file exists, green again
// once the reconciler's `FIX` exists. Silent on failure, so its output names no
// path and the fold takes the reconcile route rather than the unattributed one.
const CHECK_SH = '#!/bin/bash\n[ ! -f A.txt ] || [ -f FIX ]\n'

const TASK = {
  id: 'A', title: 'task A', files: ['A.txt'], writes: ['A.txt'], commutes: [],
  tier: 'standard', review: 'lean', testCmd: 'bash check.sh',
  proofTests: [], proofRuns: [], body: 'sim task A',
}

/** The record the run left. An absent file reads as no events, so an engine
 *  that writes none fails an assertion instead of throwing ENOENT. */
const readEvents = (runDir) => {
  const file = path.join(runDir, 'events.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}

const retriesOf = (events) => events.filter((e) => e && e.kind === 'driver:reconcile-retry')
/** The three keys M4 names, projected so a deep-equal grades those and only
 *  those (a `ts` the rig stamps on every event is not one of them). */
const threeKeysOf = (e) => ({ wave: e.wave, attempt: e.attempt, class: e.class })

/**
 * One run. `reconcile(n, cwd)` is the canned reconcile worker, `n` being which
 * call this is (1 for the first dispatch of the round, 2 for a re-dispatch);
 * `cwd` is the integration clone, where the red candidate lives.
 */
async function drive({ tag, reconcile }) {
  const repo = makeRepo(path.join(tmp, 'repo-' + tag), { 'check.sh': CHECK_SH })
  const runDir = path.join(tmp, 'run-' + tag)
  const labels = []
  const dispatches = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = String(opts.label).split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'A.txt'), 'from A\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (kind === 'reconcile') {
      dispatches.push({ label: opts.label, prompt, model: opts.model, schema: opts.schema })
      return reconcile(dispatches.length, cwd)
    }
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const built = rig({ repo, runDir, stub, stamp: 'rr' + tag, waves: [[TASK]] })
  let report = null
  let threw = null
  try {
    report = await built.run()
  } catch (e) {
    threw = e
  }
  return { tag, runDir, integ: built.integ, report, threw, labels, dispatches,
           events: readEvents(runDir),
           judgmentCalls: ((report || {}).judgmentCalls || []),
           mergeStatuses: ((report || {}).waveMerges || []).map((m) => m && m.status) }
}

/** A reconcile stub that repairs the candidate and reports FIXED. */
const fixAndReport = (cwd) => {
  fs.writeFileSync(path.join(cwd, 'FIX'), 'the reconciler\'s fix\n')
  return { status: 'FIXED', summary: 's' }
}

/** A dead worker: the non-fatal throw the real worker raises, carrying the
 *  `{ workerVerdict, label }` it attaches to every non-fatal throw. */
const deadWorker = (cls, label) => {
  const e = new Error('sim: the reconcile worker died without an envelope')
  e.workerVerdict = { class: cls }
  e.label = label
  throw e
}

/** The reconcile entries of `judgmentCalls`, in order. */
const reconcileEntries = (calls) => calls.filter((c) => /reconcile/.test(String(c)))

// ════════════════════════════════════════════════════════════════════════════
// scenario A — legs (a) and (b): a dead first worker, a FIXED second one
// ════════════════════════════════════════════════════════════════════════════
{
  const run = await drive({
    tag: 'a',
    reconcile: (n, cwd) => (n === 1
      ? deadWorker('no-envelope', 'reconcile:wave1:1')
      : fixAndReport(cwd)),
  })
  assert.equal(run.threw, null,
    '(a) sim precondition — the run completes: ' + String(run.threw && run.threw.message))
  assert.ok(run.labels.some((l) => l === 'impl:A'),
    '(a) sim precondition — the implementer was dispatched: ' + JSON.stringify(run.labels))

  // [M1] two dispatches, same label. THE FALSIFIER OF BASE: at BASE the same
  // stub records one.
  assert.deepEqual(run.dispatches.map((d) => d.label),
    ['reconcile:wave1:1', 'reconcile:wave1:1'],
    '(a) [M1] a reconcile dispatch that threw a non-`RUN_FATAL` error is dispatched a ' +
    'SECOND time under the same label before the attempt is read as no reply — the ' +
    'reconcile dispatches of this run were: ' + JSON.stringify(run.dispatches.map((d) => d.label)) +
    ' (all labels: ' + JSON.stringify(run.labels) + ')')

  const [first, second] = run.dispatches
  assert.ok(typeof first.prompt === 'string' && first.prompt.includes('TEST COMMAND:'),
    '(a) sim precondition — the reconcile prompt is the engine\'s own: ' +
    JSON.stringify(String(first.prompt).slice(0, 120)))
  // [M1] byte-identical prompt, same model, same schema.
  assert.equal(second.prompt, first.prompt,
    '(a) [M1] the second dispatch carries a BYTE-IDENTICAL prompt — the same question, asked ' +
    'of a fresh worker. First (' + String(first.prompt).length + ' bytes) vs second (' +
    String(second.prompt).length + ' bytes).')
  assert.deepEqual(second.model, first.model,
    '(a) [M1] and the same `model`: ' + JSON.stringify([first.model, second.model]))
  assert.deepEqual(second.schema, first.schema,
    '(a) [M1] and the same `schema`: ' + JSON.stringify([first.schema, second.schema]))

  // [M2] the second dispatch's FIXED is the attempt's reply: committed, suite
  // re-run, epoch adopted.
  assert.deepEqual(run.mergeStatuses, ['MERGED'],
    '(a) [M2] the `FIXED` that arrived on the second dispatch is the attempt\'s reply, so the ' +
    'epoch merges: ' + JSON.stringify((run.report || {}).waveMerges) + ' | judgmentCalls: ' +
    JSON.stringify(run.judgmentCalls))
  assert.equal(gitSync(['log', '-1', '--format=%s'], run.integ), 'wave 1 reconcile (attempt 1)',
    '(a) [M2] committed exactly as a first-dispatch `FIXED` is at BASE — the adopted head\'s ' +
    'subject is the round\'s own, attempt 1, because a re-dispatch does not advance the attempt')
  assert.ok(run.judgmentCalls.some((c) => /^wave 1: candidate adopted after reconcile \(/.test(String(c))),
    '(a) [M2] and the suite was re-run and the candidate adopted, as at BASE: ' +
    JSON.stringify(run.judgmentCalls))

  // [M4] exactly one retry event, on the three keys M4 names.
  const retries = retriesOf(run.events)
  assert.equal(retries.length, 1,
    '(b) [M4] the re-dispatch appends exactly ONE `driver:reconcile-retry` to `events.jsonl`: ' +
    JSON.stringify(run.events.map((e) => e.kind)))
  assert.deepEqual(threeKeysOf(retries[0]), { wave: 1, attempt: 1, class: 'no-envelope' },
    '(b) [M4] `{ wave, attempt, class }` — the epoch, the attempt being re-dispatched, and the ' +
    'thrown error\'s `workerVerdict.class`: ' + JSON.stringify(retries[0]))

  // [M4] the retry judgment entry, verbatim.
  assert.ok(run.judgmentCalls.includes(
    'wave 1: reconcile attempt 1 produced no reply (no-envelope) — re-dispatched once'),
    '(b) [M4] and the `judgmentCalls` entry naming the class and the re-dispatch, verbatim: ' +
    JSON.stringify(run.judgmentCalls))
}

// ════════════════════════════════════════════════════════════════════════════
// scenario C — leg (c): a `null` first reply, a FIXED second one
// ════════════════════════════════════════════════════════════════════════════
{
  const run = await drive({
    tag: 'c',
    reconcile: (n, cwd) => (n === 1 ? null : fixAndReport(cwd)),
  })
  assert.equal(run.threw, null,
    '(c) sim precondition — the run completes: ' + String(run.threw && run.threw.message))

  // [M1] a `null` reply buys the same second dispatch a throw does.
  assert.deepEqual(run.dispatches.map((d) => d.label),
    ['reconcile:wave1:1', 'reconcile:wave1:1'],
    '(c) [M1] a reconcile dispatch whose reply is `null` is dispatched a second time under the ' +
    'same label: ' + JSON.stringify(run.dispatches.map((d) => d.label)) +
    ' (all labels: ' + JSON.stringify(run.labels) + ')')
  assert.equal(run.dispatches[1].prompt, run.dispatches[0].prompt,
    '(c) [M1] with a byte-identical prompt')

  // [M2] and the second reply is the attempt's.
  assert.deepEqual(run.mergeStatuses, ['MERGED'],
    '(c) [M2] the second dispatch\'s `FIXED` is committed, the suite re-run and the epoch ' +
    'merged: ' + JSON.stringify((run.report || {}).waveMerges) + ' | judgmentCalls: ' +
    JSON.stringify(run.judgmentCalls))
  assert.equal(gitSync(['log', '-1', '--format=%s'], run.integ), 'wave 1 reconcile (attempt 1)',
    '(c) [M2] committed exactly as a first-dispatch `FIXED` is at BASE')

  // [M4] `class` is `null` for a `null` reply — the key is present and it is
  // `null`, not an absent key and not the string "null".
  const retries = retriesOf(run.events)
  assert.equal(retries.length, 1,
    '(c) [M4] exactly one `driver:reconcile-retry`: ' +
    JSON.stringify(run.events.map((e) => e.kind)))
  assert.ok(Object.prototype.hasOwnProperty.call(retries[0], 'class'),
    '(c) [M4] the event carries a `class` key even when the reply was `null`: ' +
    JSON.stringify(retries[0]))
  assert.deepEqual(threeKeysOf(retries[0]), { wave: 1, attempt: 1, class: null },
    '(c) [M4] and that `class` is `null` — there was no thrown error to read a ' +
    '`workerVerdict.class` off: ' + JSON.stringify(retries[0]))
  assert.ok(run.judgmentCalls.includes(
    'wave 1: reconcile attempt 1 produced no reply (null) — re-dispatched once'),
    '(c) [M4] and the retry judgment entry spells that same class: ' +
    JSON.stringify(run.judgmentCalls))
}

// ════════════════════════════════════════════════════════════════════════════
// scenario D — leg (d): dead on both calls, the round ends as at BASE
// ════════════════════════════════════════════════════════════════════════════
{
  const run = await drive({
    tag: 'd',
    reconcile: () => deadWorker('error', 'reconcile:wave1:1'),
  })
  assert.equal(run.threw, null,
    '(d) sim precondition — a dead reconcile worker is not a fatal run error: ' +
    String(run.threw && run.threw.message))

  // [M3] exactly two dispatches — one retry, and no third.
  assert.deepEqual(run.dispatches.map((d) => d.label),
    ['reconcile:wave1:1', 'reconcile:wave1:1'],
    '(d) [M3] a second no-reply ends the round: exactly TWO dispatches, and no third: ' +
    JSON.stringify(run.dispatches.map((d) => d.label)))
  assert.deepEqual(run.labels.filter((l) => String(l).startsWith('reconcile:')),
    ['reconcile:wave1:1', 'reconcile:wave1:1'],
    '(d) [M3] and no `reconcile:wave1:2` — the re-dispatch is inside attempt 1 and does not ' +
    'advance the round: ' + JSON.stringify(run.labels))

  // [M4] the retry was still recorded, once, with its class.
  const retries = retriesOf(run.events)
  assert.equal(retries.length, 1,
    '(d) [M4] the one re-dispatch appended one `driver:reconcile-retry`: ' +
    JSON.stringify(run.events.map((e) => e.kind)))
  assert.deepEqual(threeKeysOf(retries[0]), { wave: 1, attempt: 1, class: 'error' },
    '(d) [M4] carrying the thrown error\'s class: ' + JSON.stringify(retries[0]))

  // [M3] the BASE literal, byte for byte, as the round's LAST reconcile entry.
  const entries = reconcileEntries(run.judgmentCalls)
  assert.equal(entries[entries.length - 1], 'wave 1: reconcile attempt 1 produced no reply',
    '(d) [M3] the round ends on BASE\'s own `judgmentCalls` literal, byte for byte, as its ' +
    'final reconcile entry: ' + JSON.stringify(entries))
  assert.ok(entries.includes(
    'wave 1: reconcile attempt 1 produced no reply (error) — re-dispatched once'),
    '(d) [M4] with the retry entry ahead of it: ' + JSON.stringify(entries))

  // [M3] and the epoch takes the TEST_FAILED route.
  assert.deepEqual(run.mergeStatuses, ['TEST_FAILED'],
    '(d) [M3] and the epoch is blocked on the `TEST_FAILED` route, as at BASE: ' +
    JSON.stringify((run.report || {}).waveMerges))
}

// ════════════════════════════════════════════════════════════════════════════
// scenario E — leg (e): a first-dispatch `BLOCKED` is an object, never retried
// ════════════════════════════════════════════════════════════════════════════
{
  const run = await drive({
    tag: 'e',
    reconcile: () => ({ status: 'BLOCKED', summary: 'b' }),
  })
  assert.equal(run.threw, null,
    '(e) sim precondition — the run completes: ' + String(run.threw && run.threw.message))

  // [M5] an object reply is a reply, whatever its status.
  assert.deepEqual(run.dispatches.map((d) => d.label), ['reconcile:wave1:1'],
    '(e) [M5] a first dispatch whose reply is an OBJECT is never re-dispatched — a `BLOCKED` ' +
    'is read as at BASE: ' + JSON.stringify(run.dispatches.map((d) => d.label)) +
    ' (all labels: ' + JSON.stringify(run.labels) + ')')
  assert.deepEqual(retriesOf(run.events), [],
    '(e) [M5] and no `driver:reconcile-retry` is appended: ' +
    JSON.stringify(run.events.map((e) => e.kind)))
  assert.ok(run.judgmentCalls.includes('wave 1: reconcile attempt 1 reported BLOCKED: b'),
    '(e) [M5] the BLOCKED is recorded exactly as at BASE: ' + JSON.stringify(run.judgmentCalls))
}

// ════════════════════════════════════════════════════════════════════════════
// scenario F — leg (f): a `RUN_FATAL` throw is never retried and never caught
// ════════════════════════════════════════════════════════════════════════════
{
  const run = await drive({
    tag: 'f',
    reconcile: () => { throw new Error('RUN_FATAL: sim') },
  })

  // [M5] the throw reaches the sim.
  assert.ok(run.threw instanceof Error,
    '(f) [M5] a reconcile throw beginning `RUN_FATAL` is re-thrown and reaches the caller of ' +
    '`runEngine`: the run returned ' + JSON.stringify((run.report || {}).waveMerges) +
    ' instead of throwing')
  assert.equal(String(run.threw.message), 'RUN_FATAL: sim',
    '(f) [M5] and it is the sim\'s own error, unwrapped: ' + String(run.threw.message))

  // [M5] and it bought no second dispatch.
  assert.deepEqual(run.dispatches.map((d) => d.label), ['reconcile:wave1:1'],
    '(f) [M5] exactly one `reconcile:wave1:1` dispatch — a fatal throw is not a no-reply: ' +
    JSON.stringify(run.dispatches.map((d) => d.label)))
  assert.deepEqual(retriesOf(run.events), [],
    '(f) [M5] and no `driver:reconcile-retry` is appended: ' +
    JSON.stringify(run.events.map((e) => e.kind)))
}

// ════════════════════════════════════════════════════════════════════════════
// scenario G — leg (g) [M6]: the contract names the event and its three keys
//
// The Proof's `Run:` line is `grep -q "driver:reconcile-retry"
// fleet/CONTRACT.md`; the first assertion below is that grep, and the second is
// the rest of M6 — the three keys, beside the name.
// ════════════════════════════════════════════════════════════════════════════
{
  const contract = fs.readFileSync(CONTRACT_SRC, 'utf8')
  const at = contract.indexOf('driver:reconcile-retry')
  assert.ok(at !== -1,
    '(g) [M6] `fleet/CONTRACT.md` names `driver:reconcile-retry` — a field added to an event ' +
    'the engine appends is named in the contract in the same task that adds it')
  // The window is the name and what follows it: a contract that names the event
  // and then its keys reads `driver:reconcile-retry {wave, attempt, class}`.
  const window = contract.slice(at, at + 300)
  for (const key of ['wave', 'attempt', 'class']) {
    assert.ok(new RegExp('\\b' + key + '\\b').test(window),
      '(g) [M6] and names its key `' + key + '` beside it: ' + JSON.stringify(window.slice(0, 160)))
  }
}

// The sentinel: printed only if every assertion above held.
console.log('ALL TESTS PASSED')

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
// One task, whose implementer writes `alpha.txt`. The repository's suite is
// `[ ! -f alpha.txt ] || [ -f FIX ]`: green at BASE, RED on the folded candidate,
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
//
// ── a second exam lives in this file ────────────────────────────────────────
// Everything above is the #1041 reconcile-retry exam and stands as it was.
// After scenario G this file also carries the engine half of "a wave fold runs
// the wave's exams; publish runs everything" — `foldSuiteCommand` and the three
// fold sites that read it — under its own header, because that task's Proof
// names this file as one of its two `Test:` paths.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeRepo, rig, passReview, doneImpl, gitSync } from './_engine_helpers.mjs'
import { execSeam } from '../run-main.mjs'
// A NAMESPACE import, deliberately: a named import of an export the engine does
// not have yet is a link-time `SyntaxError` that runs nothing in this file and
// reads like a broken import rather than like an absent implementation. Read
// off the namespace, the same absence is an assertion that names the clause.
import * as engine from '../run-engine.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FLEET_DIR = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(FLEET_DIR, '..')
const CONTRACT_SRC = path.join(FLEET_DIR, 'CONTRACT.md')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-reconcile-retry-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// The suite: green at BASE, red once the implementer's file exists, green again
// once the reconciler's `FIX` exists. Silent on failure, so its output names no
// path and the fold takes the reconcile route rather than the unattributed one.
const CHECK_SH = '#!/bin/bash\n[ ! -f alpha.txt ] || [ -f FIX ]\n'

const TASK = {
  id: 'A', title: 'task A', files: ['alpha.txt'], writes: ['alpha.txt'], commutes: [],
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
      fs.writeFileSync(path.join(cwd, 'alpha.txt'), 'from A\n')
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

// ════════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════
// TASK 2 — "A wave fold runs the wave's exams; publish runs everything"
//
// Claim: launch a plan against a Bun or pytest target and watch a wave fold;
// the fold's suite is the target's runner over the sorted list of test files
// that wave touched or named as its exams, one log line names that command,
// the reconcile round re-runs the same command, publish still runs the whole
// suite, and a target the launcher cannot derive a scoped runner for folds
// exactly as it does today.
//
// The Machine clauses this half answers, restated:
//   M3 — `foldSuiteCommand({template, pattern, testCmd, paths, exists})`,
//        exported from `fleet/run-engine.mjs`, returns `template` with its one
//        `{paths}` token replaced by the space-joined, SORTED, DE-DUPLICATED
//        subset of `paths` that match the regular expression `pattern` and for
//        which `exists(path)` is true; when that subset is empty, or when
//        `template` is not a string carrying exactly one `{paths}`, or
//        `pattern` is not a string, it returns `testCmd`.
//   M4 — at a wave fold in a run whose args carry non-empty strings
//        `foldTestCmd` and `foldTestPattern`, the candidate suite command is
//        `foldSuiteCommand` over the union of every epoch task's
//        `touchSetOf(task, patch)` and `proofTests` entries, `exists` being a
//        file test in the integration clone after the candidate's read-tree;
//        that command is what the driver runs as the candidate suite, what the
//        reconcile round's `TEST COMMAND:` line carries, and what the reconcile
//        round re-runs after a `FIXED`; and when that command is not `testCmd`,
//        before the suite runs, the driver logs one line
//        `wave <n> fold suite: <command>` — when it is `testCmd` (an empty
//        subset), no `fold suite:` line is logged.
//   M5 — a run whose args carry no `foldTestCmd` runs `testCmd` at every one of
//        those three sites and logs no `fold suite:` line — byte-for-byte BASE.
//   M6 — `fleet/CONTRACT.md` names `foldTestCmd` and `foldTestPattern` in the
//        paragraph that names `foldAgeMs`: the `{paths}` token, the union rule
//        of M4, the `fold suite:` log line, that publish and the gate keep
//        `testCmd`, and that a typecheck a target wants at every fold is
//        written as a Global Constraints `- Check:`.
//   M7 — `fleet/publish-fold.mjs` and `skills/ultrapowers/scripts/ultra_gate.py`
//        are byte-identical to BASE.
//
// The Proof legs, and where each is answered:
//   (g) [M3] the sort, the de-dup, the pattern filter and `exists` — table G
//   (h) [M3] the four fall-throughs to `testCmd`                   — table H
//   (i) [M4] one task, one scoped candidate suite, one log line    — fold I
//   (j) [M4] two tasks in one epoch: the union, the pattern, `exists`
//                                                                  — fold J
//   (k) [M4] the reconcile prompt's `TEST COMMAND:` and the re-run — fold K
//   (l) [M3, M4] an empty subset falls back and logs nothing       — fold L
//   (m) [M5] neither key: `testCmd` at all three sites, no log line — fold M
//   (n) [M6] the contract paragraph — the three `Run:` greps        — table N
//   (o) [M7] the two files are byte-identical to BASE and name neither key
//                                                                  — table O
//
// ── how these legs are read ─────────────────────────────────────────────────
//
// 1. `ENDS WITH`, NEVER EQUALITY. Every suite string goes through the exec
//    seam as `bash -lc <prefix + command>`, the prefix being `shOf`'s
//    toolchain `PATH` assignment written INTO the string. So a recorded suite
//    is asserted with `endsWith`. It still separates the two commands under
//    test: `bash check.sh` is not a suffix of `bash check.sh alpha.txt`.
//
// 2. "THAT STRING IS THE CANDIDATE SUITE OF WAVE 1" (leg i) is read off the
//    cwd, not the text: the fold runs its suite in the integration clone, and
//    the run's other `bash -lc` — the baseline suite — runs in `clones/baseline`.
//    `foldShell` below is every recorded command whose cwd was the integration
//    clone, in order, which for a green one-epoch run is exactly the candidate
//    suite and for a reconciled one is the candidate suite then the re-run.
//
// 3. `bash check.sh` IGNORES ITS ARGUMENTS. The repo's suite is the rig's own
//    (`[ ! -f BROKEN ]`, green) or this file's `CHECK_SH` (red once `alpha.txt`
//    exists, green once `FIX` does). Neither reads `$@`, so appending paths
//    changes no verdict and only the command STRING is under test.
//
// 4. THE EXAMINER IN FOLD J. A task that declares a Proof `Test:` path gets an
//    examiner dispatched at it. Leg (j) needs the DECLARATION (`ghost.txt` is
//    in the union and falls out on `exists`), not an exam, so the stub answers
//    `BLOCKED`: the task proceeds unexamined, no exam command runs, and the
//    shell record stays the fold's.
//
// WHY THIS IS RED AT BASE. At BASE the engine exports no `foldSuiteCommand`
// and reads no `foldTestCmd`: the fold runs `testCmd` at all three sites and
// logs no `fold suite:` line. Table G's first assertion — the falsifier —
// reports the missing export and names M3.
// ════════════════════════════════════════════════════════════════════════════

// ── table G — leg (g) [M3]: the subset, sorted, de-duplicated, filtered ─────
const foldSuiteCommand = engine.foldSuiteCommand
assert.equal(typeof foldSuiteCommand, 'function',
  '(g) [M3] `fleet/run-engine.mjs` exports `foldSuiteCommand({template, pattern, testCmd, ' +
  'paths, exists})` — the symbol this task Produces and the one the fold\'s three sites read. ' +
  'The module exports: ' + JSON.stringify(Object.keys(engine).filter((k) => /fold/i.test(k))))

{
  // The Proof's own call, verbatim: `beta.txt` before `alpha.txt` in the input, a
  // `notes.md` the pattern rejects, and `alpha.txt` twice.
  assert.equal(
    foldSuiteCommand({ template: 'bash check.sh {paths}', pattern: '\\.txt$',
                       testCmd: 'bash check.sh',
                       paths: ['beta.txt', 'alpha.txt', 'notes.md', 'alpha.txt'],
                       exists: () => true }),
    'bash check.sh alpha.txt beta.txt',
    '(g) [M3] the one `{paths}` token becomes the space-joined, SORTED, DE-DUPLICATED subset ' +
    'of `paths` matching `pattern` — `alpha.txt` ahead of `beta.txt` whatever the input order, `alpha.txt` ' +
    'once though it was given twice, and no `notes.md`')

  // The same call with `exists` false for `beta.txt`: a declared file no patch
  // wrote, or a Proof spelling the run moved, is not in the tree the fold
  // just read out and so is not in the argv.
  assert.equal(
    foldSuiteCommand({ template: 'bash check.sh {paths}', pattern: '\\.txt$',
                       testCmd: 'bash check.sh',
                       paths: ['beta.txt', 'alpha.txt', 'notes.md', 'alpha.txt'],
                       exists: (p) => p !== 'beta.txt' }),
    'bash check.sh alpha.txt',
    '(g) [M3] and a path `exists` answers false for is dropped: `beta.txt` is not in the tree, so ' +
    'it is not in the command')
}

// ── table H — leg (h) [M3]: the four fall-throughs to `testCmd` ─────────────
{
  const cases = [
    ['an EMPTY subset — no path matches the pattern',
     { template: 'bash check.sh {paths}', pattern: '\\.txt$', testCmd: 'bash check.sh',
       paths: ['notes.md'], exists: () => true }],
    ['a `template` carrying NO `{paths}` token',
     { template: 'bash check.sh', pattern: '\\.txt$', testCmd: 'bash check.sh',
       paths: ['alpha.txt'], exists: () => true }],
    ['a `template` carrying TWO `{paths}` tokens — exactly one, or none of it',
     { template: 'x {paths} {paths}', pattern: '\\.txt$', testCmd: 'bash check.sh',
       paths: ['alpha.txt'], exists: () => true }],
    ['a `pattern` that is not a string',
     { template: 'bash check.sh {paths}', pattern: null, testCmd: 'bash check.sh',
       paths: ['alpha.txt'], exists: () => true }],
  ]
  for (const [why, input] of cases) {
    assert.equal(foldSuiteCommand(input), 'bash check.sh',
      '(h) [M3] returns `testCmd` for ' + why + ': ' + JSON.stringify(input))
  }
}

// ── the fold rig for legs (i)–(m) ──────────────────────────────────────────

/** The two extra args a scoped fold is armed by, as the task spells them. */
const FOLD_ARGS = { foldTestCmd: 'bash check.sh {paths}', foldTestPattern: '\\.txt$' }

/** A plan task in the shape the engine reads. `files` is what the implementer
 *  writes AND what `touchSetOf` declares — the two are the same list here, so
 *  a path in the union is a path in the tree unless the leg says otherwise. */
const taskOf = (id, extra = {}) => ({
  id, title: 'task ' + id, files: [], writes: [], commutes: [],
  tier: 'standard', review: 'lean', testCmd: 'bash check.sh',
  proofTests: [], proofRuns: [], body: 'sim task ' + id, ...extra,
})

/**
 * One run of one wave, with the exec seam WRAPPED so the sim reads back every
 * `bash -lc` the driver ran and the cwd it ran it in. Everything below the
 * agent seam stays real, the wrapper included: it records and delegates.
 */
async function driveFold({ tag, tasks, extraArgs = {}, checkSh = null, reconcile = null }) {
  const repo = makeRepo(path.join(tmp, 'repo-' + tag), checkSh ? { 'check.sh': checkSh } : {})
  const runDir = path.join(tmp, 'run-' + tag)
  const shell = []
  const labels = []
  const prompts = []
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const exec = (cmd, argv, opts = {}) => {
    if (cmd === 'bash' && Array.isArray(argv) && argv[0] === '-lc') {
      shell.push({ command: String(argv[1]), cwd: opts.cwd })
    }
    return execSeam(cmd, argv, opts)
  }
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const [kind, id] = String(opts.label).split(':')
    if (kind === 'impl') {
      for (const f of ((byId.get(id) || {}).files || [])) {
        fs.writeFileSync(path.join(cwd, f), 'from ' + id + '\n')
      }
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (kind === 'exam') return { status: 'BLOCKED', summary: 'sim: this sim writes no exam' }
    if (kind === 'reconcile') {
      prompts.push(prompt)
      return reconcile ? reconcile(prompts.length, cwd) : null
    }
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const built = rig({ repo, runDir, stub, stamp: 'fs' + tag, waves: [tasks], exec, extraArgs })
  let report = null
  let threw = null
  try {
    report = await built.run()
  } catch (e) {
    threw = e
  }
  return {
    tag, repo, runDir, integ: built.integ, report, threw, labels, prompts, shell,
    logs: built.logs,
    // Every recorded command whose cwd was the integration clone: the fold's
    // own suite runs, in order. The baseline suite runs in `clones/baseline`.
    foldShell: shell.filter((c) => c.cwd === built.integ).map((c) => c.command),
    foldSuiteLines: built.logs.filter((l) => String(l).includes('fold suite:')),
    judgmentCalls: ((report || {}).judgmentCalls || []),
    mergeStatuses: ((report || {}).waveMerges || []).map((m) => m && m.status),
  }
}

/** The `TEST COMMAND:` lines of a reconcile prompt. The reconcile role names
 *  `TEST COMMAND` once in prose ("Run the TEST COMMAND yourself"), without the
 *  colon, so the line test picks out the engine's own line and only it. */
const testCommandLines = (prompt) => String(prompt).split('\n')
  .filter((l) => l.startsWith('TEST COMMAND:'))

// ── fold I — leg (i) [M4]: one task, the scoped suite, the one log line ─────
{
  const run = await driveFold({
    tag: 'i',
    tasks: [taskOf('A', { files: ['alpha.txt'], writes: ['alpha.txt'] })],
    extraArgs: FOLD_ARGS,
  })
  assert.equal(run.threw, null,
    '(i) sim precondition — the run completes: ' + String(run.threw && run.threw.message))
  assert.deepEqual(run.mergeStatuses, ['MERGED'],
    '(i) sim precondition — one epoch, green candidate: ' +
    JSON.stringify((run.report || {}).waveMerges) + ' | ' + JSON.stringify(run.judgmentCalls))

  const scoped = run.shell.filter((c) => c.command.endsWith('bash check.sh alpha.txt'))
  assert.equal(scoped.length, 1,
    '(i) [M4] EXACTLY ONE recorded `bash -lc` string ends with the scoped command ' +
    '`bash check.sh alpha.txt` — the `{paths}` token filled from the epoch\'s union. Recorded: ' +
    JSON.stringify(run.shell.map((c) => c.command.split('\n').pop())))
  assert.equal(scoped[0].cwd, run.integ,
    '(i) [M4] and it ran in the integration clone — it is the CANDIDATE SUITE of wave 1, not ' +
    'the baseline\'s run on BASE: ' + scoped[0].cwd + ' vs ' + run.integ)
  assert.equal(run.foldShell.length, 1,
    '(i) [M4] the green fold runs exactly one suite in the integration clone: ' +
    JSON.stringify(run.foldShell.map((c) => c.split('\n').pop())))
  assert.ok(run.foldShell[0].endsWith('bash check.sh alpha.txt'),
    '(i) [M4] and that one IS the scoped command (the `shOf` PATH prefix rides inside the ' +
    'string, so this is a suffix test): ' + JSON.stringify(run.foldShell[0]))

  assert.deepEqual(run.foldSuiteLines, ['wave 1 fold suite: bash check.sh alpha.txt'],
    '(i) [M4] and `logs` carries exactly one line, equal to `wave 1 fold suite: bash check.sh ' +
    'alpha.txt` — logged before the suite runs, because the command is not `testCmd`. All logs: ' +
    JSON.stringify(run.logs))
}

// ── fold J — leg (j) [M4]: two tasks, the union, the pattern, `exists` ──────
{
  const run = await driveFold({
    tag: 'j',
    tasks: [
      taskOf('T1', { files: ['alpha.txt'], writes: ['alpha.txt'] }),
      // `notes.md` is written and fails the pattern; `ghost.txt` is named as a
      // Proof `Test:` and never written, so it is in the union and fails
      // `exists` in the integration clone after the read-tree.
      taskOf('T2', { files: ['beta.txt', 'notes.md'], writes: ['beta.txt', 'notes.md'],
                     proofTests: ['ghost.txt'] }),
    ],
    extraArgs: FOLD_ARGS,
  })
  assert.equal(run.threw, null,
    '(j) sim precondition — the run completes: ' + String(run.threw && run.threw.message))
  assert.deepEqual(run.mergeStatuses, ['MERGED'],
    '(j) sim precondition — both tasks land in ONE fold epoch, green: ' +
    JSON.stringify((run.report || {}).waveMerges) + ' | ' + JSON.stringify(run.judgmentCalls))

  assert.equal(run.foldShell.length, 1,
    '(j) sim precondition — one candidate suite in the integration clone: ' +
    JSON.stringify(run.foldShell.map((c) => c.split('\n').pop())))
  const suite = run.foldShell[0]
  assert.ok(suite.endsWith('bash check.sh alpha.txt beta.txt'),
    '(j) [M4] the candidate suite is `foldSuiteCommand` over the UNION of both tasks\' touch ' +
    'sets and `proofTests` — `alpha.txt` from T1 and `beta.txt` from T2, sorted: ' +
    JSON.stringify(suite.split('\n').pop()))
  assert.ok(!suite.includes('notes.md'),
    '(j) [M4] `notes.md` was written by T2 and is in the union, and the pattern rejects it: ' +
    JSON.stringify(suite.split('\n').pop()))
  assert.ok(!suite.includes('ghost.txt'),
    '(j) [M4] `ghost.txt` is T2\'s `proofTests` entry, so it is in the union — and no patch ' +
    'wrote it, so `exists` in the integration clone drops it: ' +
    JSON.stringify(suite.split('\n').pop()))
  assert.deepEqual(run.foldSuiteLines, ['wave 1 fold suite: bash check.sh alpha.txt beta.txt'],
    '(j) [M4] and the one log line names that same command: ' + JSON.stringify(run.logs))
}

// ── fold K — leg (k) [M4]: the reconcile prompt and the re-run ──────────────
{
  const run = await driveFold({
    tag: 'k',
    checkSh: CHECK_SH,
    tasks: [taskOf('A', { files: ['alpha.txt'], writes: ['alpha.txt'] })],
    extraArgs: FOLD_ARGS,
    reconcile: (n, cwd) => fixAndReport(cwd),
  })
  assert.equal(run.threw, null,
    '(k) sim precondition — the run completes: ' + String(run.threw && run.threw.message))
  assert.equal(run.prompts.length, 1,
    '(k) sim precondition — the red candidate bought exactly one reconcile dispatch: ' +
    JSON.stringify(run.labels))
  assert.deepEqual(run.mergeStatuses, ['MERGED'],
    '(k) sim precondition — the `FIXED` was committed and the epoch adopted: ' +
    JSON.stringify((run.report || {}).waveMerges) + ' | ' + JSON.stringify(run.judgmentCalls))

  assert.deepEqual(testCommandLines(run.prompts[0]), ['TEST COMMAND: bash check.sh alpha.txt'],
    '(k) [M4] the reconcile prompt carries ONE `TEST COMMAND:` line and it is the scoped ' +
    'command — the reconcile worker is told the suite it is being asked to fix, not the ' +
    'run-wide one. Lines found: ' + JSON.stringify(testCommandLines(run.prompts[0])))

  assert.equal(run.foldShell.length, 2,
    '(k) [M4] the fold ran two suites in the integration clone: the candidate\'s, then the ' +
    're-run after the `FIXED`: ' + JSON.stringify(run.foldShell.map((c) => c.split('\n').pop())))
  assert.ok(run.foldShell[0].endsWith('bash check.sh alpha.txt'),
    '(k) [M4] the candidate suite is the scoped command: ' +
    JSON.stringify(run.foldShell[0].split('\n').pop()))
  assert.ok(run.foldShell[1].endsWith('bash check.sh alpha.txt'),
    '(k) [M4] and the re-run after the stub\'s `FIXED` is a SECOND recorded string ending in ' +
    'the same scoped command — one `foldCmd`, computed once, serving all three sites: ' +
    JSON.stringify(run.foldShell[1].split('\n').pop()))
}

// ── fold L — leg (l) [M3, M4]: an empty subset falls back, silently ─────────
{
  const run = await driveFold({
    tag: 'l',
    tasks: [taskOf('A', { files: ['alpha.txt'], writes: ['alpha.txt'] })],
    extraArgs: { foldTestCmd: 'bash check.sh {paths}', foldTestPattern: '\\.nomatch$' },
  })
  assert.equal(run.threw, null,
    '(l) sim precondition — the run completes: ' + String(run.threw && run.threw.message))
  assert.deepEqual(run.mergeStatuses, ['MERGED'],
    '(l) sim precondition — one green epoch: ' + JSON.stringify((run.report || {}).waveMerges))

  assert.equal(run.foldShell.length, 1,
    '(l) sim precondition — one candidate suite: ' +
    JSON.stringify(run.foldShell.map((c) => c.split('\n').pop())))
  assert.ok(run.foldShell[0].endsWith('bash check.sh'),
    '(l) [M3, M4] no path matches `\\.nomatch$`, so the subset is empty and `foldSuiteCommand` ' +
    'returns `testCmd`: the candidate suite string ends with `bash check.sh`, not with a path: ' +
    JSON.stringify(run.foldShell[0].split('\n').pop()))
  assert.deepEqual(run.foldSuiteLines, [],
    '(l) [M4] and because the command IS `testCmd`, no line of `logs` contains `fold suite:`: ' +
    JSON.stringify(run.logs))
}

// ── fold M — leg (m) [M5]: neither key, byte-for-byte BASE ─────────────────
{
  const run = await driveFold({
    tag: 'm',
    checkSh: CHECK_SH,
    tasks: [taskOf('A', { files: ['alpha.txt'], writes: ['alpha.txt'] })],
    reconcile: (n, cwd) => fixAndReport(cwd),
  })
  assert.equal(run.threw, null,
    '(m) sim precondition — the run completes: ' + String(run.threw && run.threw.message))
  assert.deepEqual(run.mergeStatuses, ['MERGED'],
    '(m) sim precondition — the reconcile round ran and the epoch was adopted: ' +
    JSON.stringify((run.report || {}).waveMerges) + ' | ' + JSON.stringify(run.judgmentCalls))

  assert.equal(run.foldShell.length, 2,
    '(m) sim precondition — the candidate suite and the post-`FIXED` re-run: ' +
    JSON.stringify(run.foldShell.map((c) => c.split('\n').pop())))
  assert.ok(run.foldShell[0].endsWith('bash check.sh'),
    '(m) [M5] a run whose args carry no `foldTestCmd` runs `testCmd` as its candidate suite: ' +
    JSON.stringify(run.foldShell[0].split('\n').pop()))
  assert.deepEqual(testCommandLines(run.prompts[0]), ['TEST COMMAND: bash check.sh'],
    '(m) [M5] and the reconcile prompt\'s `TEST COMMAND:` line is the run-wide command: ' +
    JSON.stringify(testCommandLines(run.prompts[0])))
  assert.ok(run.foldShell[1].endsWith('bash check.sh'),
    '(m) [M5] and the re-run after the `FIXED` is `testCmd` too — all three sites: ' +
    JSON.stringify(run.foldShell[1].split('\n').pop()))
  assert.deepEqual(run.foldSuiteLines, [],
    '(m) [M5] and no `fold suite:` line is written: ' + JSON.stringify(run.logs))
}

// ── table N — leg (n) [M6]: the contract paragraph ─────────────────────────
//
// The Proof's three contract `Run:` lines, in order:
//   grep -q 'foldTestCmd' fleet/CONTRACT.md
//   sed -n '/foldAgeMs. is/,/driver:regenerated/p' fleet/CONTRACT.md \
//     | tr '\n' ' ' | grep -q 'foldTestCmd.*{paths}.*foldTestPattern.*fold suite:.*publish.*testCmd.*Check:'
//   grep -q 'foldTestPattern' fleet/CONTRACT.md
// Each is one assertion below, `sed`'s range semantics included: the window
// opens on the FIRST line matching `/foldAgeMs. is/` and closes on the first
// line AFTER it matching `/driver:regenerated/`.
{
  const contract = fs.readFileSync(CONTRACT_SRC, 'utf8')
  assert.ok(contract.includes('foldTestCmd'),
    '(n) [M6] `fleet/CONTRACT.md` names `foldTestCmd` — an args key the engine reads is named ' +
    'in the contract in the same task that adds it')
  assert.ok(contract.includes('foldTestPattern'),
    '(n) [M6] and names `foldTestPattern`')

  const lines = contract.split('\n')
  const start = lines.findIndex((l) => /foldAgeMs. is/.test(l))
  assert.ok(start !== -1,
    '(n) [M6] sim precondition — the contract still carries the `foldAgeMs` paragraph the two ' +
    'keys are named in')
  let end = start + 1
  while (end < lines.length && !/driver:regenerated/.test(lines[end])) end++
  const window = lines.slice(start, Math.min(end + 1, lines.length)).join(' ')
  const ORDER = /foldTestCmd.*\{paths\}.*foldTestPattern.*fold suite:.*publish.*testCmd.*Check:/
  assert.ok(ORDER.test(window),
    '(n) [M6] and that paragraph says, in this order, `foldTestCmd`, the `{paths}` token, ' +
    '`foldTestPattern`, the `fold suite:` log line, that publish keeps `testCmd`, and the ' +
    'Global Constraints `- Check:` a target writes for a typecheck it wants at every fold — ' +
    'because the engine runs `foldTestCmd` and nothing else there. The window read was: ' +
    JSON.stringify(window))
}

// ── table O — leg (o) [M7]: publish and the gate are BASE's own ────────────
//
// The Proof's two `Run:` lines are
//   git diff --quiet $ULTRA_BASE -- fleet/publish-fold.mjs skills/…/ultra_gate.py
//   ! grep -q foldTestCmd fleet/publish-fold.mjs skills/…/ultra_gate.py
// The second is verbatim below. The first is byte-identity, pinned two ways:
// the sha256 of each file's bytes AT BASE — which needs no environment and is
// the same assertion — and, when the BASE commit is present in the tree this
// sim runs in, the `git diff --quiet` itself.
{
  const BASE_SHA = process.env.ULTRA_BASE || '08bb21f56b3911dad32e4c983b435e510aee2f89'
  const PINNED = [
    ['fleet/publish-fold.mjs',
     'a11f50e1e014b943ffe18a963c9af3ce0791c4f9bda00623a237bf79354bfde5'],
    ['skills/ultrapowers/scripts/ultra_gate.py',
     'ffe114128f61b05731addcf2206cbc9d073b6b3dfcd0c816edcf04b4051aed84'],
  ]
  for (const [rel, sha] of PINNED) {
    const bytes = fs.readFileSync(path.join(REPO_ROOT, rel))
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), sha,
      '(o) [M7] `' + rel + '` is BYTE-IDENTICAL to BASE — publish runs the whole suite and the ' +
      'gate reads the recorded suite result exactly as they did, and neither is this task\'s to ' +
      'touch. Its sha256 is now ' + crypto.createHash('sha256').update(bytes).digest('hex'))
    const text = bytes.toString('utf8')
    for (const key of ['foldTestCmd', 'foldTestPattern', 'foldSuiteCommand']) {
      assert.ok(!text.includes(key),
        '(o) [M7] and `' + rel + '` names no `' + key + '` — the scoped runner is the wave ' +
        'fold\'s and nothing else\'s')
    }
  }
  // The content M7 is about, stated positively: publish's step 7 still runs
  // `args.testCmd` through its own exec seam.
  const publish = fs.readFileSync(path.join(REPO_ROOT, 'fleet/publish-fold.mjs'), 'utf8')
  assert.ok(publish.includes("const suite = await exec('bash', ['-lc', testCmd], { cwd: integ })"),
    '(o) [M7] publish\'s fold still runs its `testCmd` — `args.testCmd`, the whole suite')

  // The `Run:` line itself, when the BASE commit is reachable from here.
  let baseReachable = true
  try {
    gitSync(['cat-file', '-e', BASE_SHA + '^{commit}'], REPO_ROOT)
  } catch {
    baseReachable = false
  }
  if (baseReachable) {
    let clean = true
    try {
      gitSync(['diff', '--quiet', BASE_SHA, '--',
               'fleet/publish-fold.mjs', 'skills/ultrapowers/scripts/ultra_gate.py'], REPO_ROOT)
    } catch {
      clean = false
    }
    assert.ok(clean,
      '(o) [M7] `git diff --quiet ' + BASE_SHA + ' -- fleet/publish-fold.mjs ' +
      'skills/ultrapowers/scripts/ultra_gate.py` exits 0 — the two files are byte-identical to BASE')
  }
}

// The sentinel: printed only if every assertion above held.
console.log('ALL TESTS PASSED')

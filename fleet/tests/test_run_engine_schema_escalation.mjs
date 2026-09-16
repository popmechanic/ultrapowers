// fleet/tests/test_run_engine_schema_escalation.mjs — the exam for "the retry
// tier is decided by the worker's verdict CLASS, not by the wording of its
// message" (#410 §1).
//
// The Claim: rename or reword what a worker says when it fails; see: a schema
// trip still gets the stronger model and any other failure still gets the
// same-tier retry, because the driver reads the class the worker attached, not
// the sentence it wrote.
//
// The Machine clauses under test, restated:
//   M1 — when a task's worker call throws an error whose `workerVerdict.class`
//        is `max-turns` or `no-structured-output`, the task is retried once at
//        `escalateTier(task.tier)` and its `judgmentCalls` entry carries
//        `(schema trip → escalate)`.
//   M2 — when the thrown error carries any other `workerVerdict.class`
//        (`no-envelope`, `error`, `budget`, `api-error`, `sigterm`), or no
//        `workerVerdict` at all, the task is retried once at its OWN tier and
//        the entry carries `(same tier)` — whatever the message says, a message
//        containing `schema` or `StructuredOutput` included.
//   M3 — `fleet/run-engine.mjs` exports no `isSchemaTrip`, and neither
//        `fleet/run-engine.mjs` nor `fleet/run-worker.mjs` contains the token
//        `isSchemaTrip` anywhere, comments included.
//
// The Proof legs, and where each is answered:
//   (a) [M1] `class: 'max-turns'` on `Error('WORKER_MAX_TURNS: x')`: two
//            `impl:T1` dispatches, the second's `opts.model` equals
//            `TIER.mostCapable`, the task ends `done`, and `judgmentCalls`
//            holds an entry containing `(schema trip → escalate)`.
//   (b) [M1] the same with `class: 'no-structured-output'`: the second's
//            `opts.model` equals `TIER.mostCapable`.
//   (c) [M2] `Error('StructuredOutput did not conform to schema')` carrying
//            `class: 'error'`: the second's `opts.model` equals `TIER.standard`
//            and the entry contains `(same tier)`.
//   (d) [M2] `Error('schema')` with NO `workerVerdict` property: the second's
//            `opts.model` equals `TIER.standard` and the entry contains
//            `(same tier)`.
//   (e) [M2] each of `no-envelope`, `budget`, `api-error`, `sigterm` as
//            `workerVerdict.class` with the message `'WORKER_X: schema'`: the
//            retry's `opts.model` equals `TIER.standard`.
//   (f) [M3] `import * as engine from '../run-engine.mjs'` has no
//            `isSchemaTrip` export — and, beside its `Run:` line, the token
//            appears zero times in either source file.
//
// ── how this sim reads the tier the driver chose ────────────────────────────
// Through the stub, which is the channel the task's Context names. The engine
// passes `model: baseModel` on an `impl:<id>` dispatch, where `baseModel` is
// `resolvedModel(tierName)` and `tierName` is the retry's `tierOverride` on the
// second pass. So the SECOND `impl:T1` dispatch's `opts.model` reads
// `TIER.mostCapable` under an escalation and `TIER.standard` under a same-tier
// retry. The rig's stub receives `(prompt, opts, cwd)`; a throw from the stub
// is what the engine catches, and the error object reaches that catch intact —
// `withPatchCapture` awaits the inner agent with no try/catch around the call,
// and `runTaskInner` rethrows `implSettled.reason` itself — so a
// `workerVerdict` hung on the Error as an own property survives the seam, which
// is exactly how `run-worker.mjs` attaches it.
//
// Everything below the agent seam is real: real git repos, real clones at BASE,
// the real capture, the real exec seam. Only `agent` is canned.
//
// ── what the marker legs grade, and what they deliberately do not ───────────
// M1 and M2 say the entry CARRIES a marker. The two markers are the verbatim
// parentheticals `(schema trip → escalate)` and `(same tier)`, and those are
// checked as written. The sentence around them — "task T1: agent error at
// standard — retrying once at …" — is the task's Context describing what BASE
// says today, not a clause, so it is not pinned here: pinning a sentence is the
// very defect #410 is about. Each marker leg also asserts the OTHER marker is
// absent from that run's `judgmentCalls`, so a record that pushes both is not a
// pass. `TIER` and `escalateTier` are read off the engine rather than spelled
// `'opus'`/`'sonnet'`, because that is how the Proof legs name them.
//
// Leg (f) uses a NAMESPACE import on purpose. A named import of an export that
// does not exist is a link error, which would make this whole file red at BASE
// for the wrong reason; a namespace import simply has no such key.
//
// Every assertion below names its Proof leg and the clause it comes from.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as engine from '../run-engine.mjs'
import { makeRepo, rig, passReview, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-schema-escalation-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// The two markers of M1 and M2, spelled once, verbatim.
const ESCALATE_MARK = '(schema trip → escalate)'
const SAME_TIER_MARK = '(same tier)'

let seq = 0
const freshNames = (tag) => {
  seq += 1
  const stamp = 'se' + seq + tag
  return { stamp, repo: makeRepo(path.join(tmp, 'repo-' + stamp)), runDir: path.join(tmp, 'run-' + stamp) }
}

// The one task every scenario runs. `tier: 'standard'`, so `escalateTier` of it
// is `mostCapable` and the two answers are distinguishable; no Proof `Test:`
// path, so no examiner is dispatched and `impl:T1` is the only worktree call.
const plainTask = () => ({
  id: 'T1', title: 't', files: ['T1.txt'], tier: 'standard', review: 'lean',
  writes: ['T1.txt'], commutes: [], proofTests: [], proofRuns: [],
  body: 'sim task T1',
})

/**
 * A one-task run whose FIRST `impl:T1` dispatch throws what `makeError()`
 * returns and whose second returns a done reply. Records the options object of
 * every `impl:` dispatch, in order, so the caller can read the model the driver
 * chose for the retry.
 */
async function retryRun({ tag, makeError }) {
  const { stamp, repo, runDir } = freshNames(tag)
  const labels = []
  const implOpts = []
  const stub = (prompt, o, cwd) => {
    labels.push(o.label)
    const kind = String(o.label).split(':')[0]
    if (kind === 'impl') {
      implOpts.push(o)
      if (implOpts.length === 1) throw makeError()
      fs.writeFileSync(path.join(cwd, 'T1.txt'), 'v1\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    throw new Error('unexpected dispatch: ' + o.label)
  }
  const { run } = rig({
    repo, runDir, waves: [[plainTask()]], stub, stamp,
    extraArgs: { infraBackoffMs: 0 },
  })
  const report = await run()
  return { report, labels, implOpts, runDir, shown: report.judgmentCalls.join(' | ') }
}

/** The error a worker throws: a real Error with the verdict hung off it. */
const workerError = (message, verdict) => {
  const e = new Error(message)
  if (verdict !== undefined) e.workerVerdict = verdict
  return e
}

/** The two `impl:T1` dispatches, asserted for the named leg. */
const twoImplDispatches = (r, leg) => {
  assert.equal(r.labels.filter((l) => l === 'impl:T1').length, 2,
    leg + ': the task must be dispatched as impl:T1 exactly twice — once, then the one retry; got ' +
    JSON.stringify(r.labels))
  assert.equal(r.implOpts.length, 2,
    leg + ': exactly two impl dispatches must have been recorded, got ' + r.implOpts.length)
  assert.equal(r.implOpts[0].model, engine.TIER.standard,
    leg + ": the FIRST dispatch runs at the task's own tier, so opts.model must be TIER.standard (" +
    engine.TIER.standard + '), got ' + String(r.implOpts[0].model))
}

// ══ (a) a `max-turns` schema trip escalates [M1] ════════════════════════════
{
  const r = await retryRun({
    tag: 'a', makeError: () => workerError('WORKER_MAX_TURNS: x', { class: 'max-turns' }),
  })
  twoImplDispatches(r, '(a)/M1')
  assert.equal(r.implOpts[1].model, engine.TIER.mostCapable,
    '(a)/M1: workerVerdict.class `max-turns` is a schema trip, so the one retry runs at ' +
    'escalateTier(standard) = ' + engine.escalateTier('standard') + ' and the second impl:T1 ' +
    "dispatch's opts.model must be TIER.mostCapable (" + engine.TIER.mostCapable + '), got ' +
    String(r.implOpts[1].model))
  const row = r.report.tasks.find((t) => t && t.task === 'T1')
  assert.ok(row, '(a)/M1: the run must record a row for task T1; got ' +
    JSON.stringify(r.report.tasks.map((t) => t && t.task)))
  assert.equal(row.status, 'done',
    '(a)/M1: the retry returned a done reply, so the task ends `done`; got ' + String(row.status) +
    ' (' + String(row.notes) + ')')
  assert.ok(r.report.judgmentCalls.some((j) => String(j).includes(ESCALATE_MARK)),
    '(a)/M1: judgmentCalls must hold an entry carrying ' + ESCALATE_MARK + '; got ' + r.shown)
  assert.ok(!r.report.judgmentCalls.some((j) => String(j).includes(SAME_TIER_MARK)),
    '(a)/M1: the same run must not also record ' + SAME_TIER_MARK + '; got ' + r.shown)
  console.log('ok - (a)/M1: class `max-turns` — the retry runs at TIER.mostCapable, the task ends done, ' +
    'the entry carries ' + ESCALATE_MARK)
}

// ══ (b) a `no-structured-output` schema trip escalates [M1] ═════════════════
{
  const r = await retryRun({
    tag: 'b',
    makeError: () => workerError('WORKER_NO_STRUCTURED_OUTPUT: x', { class: 'no-structured-output' }),
  })
  twoImplDispatches(r, '(b)/M1')
  assert.equal(r.implOpts[1].model, engine.TIER.mostCapable,
    '(b)/M1: workerVerdict.class `no-structured-output` is the second schema trip, so the retry ' +
    "runs at escalateTier(standard) and the second impl:T1 dispatch's opts.model must be " +
    'TIER.mostCapable (' + engine.TIER.mostCapable + '), got ' + String(r.implOpts[1].model))
  assert.ok(r.report.judgmentCalls.some((j) => String(j).includes(ESCALATE_MARK)),
    '(b)/M1: judgmentCalls must hold an entry carrying ' + ESCALATE_MARK + '; got ' + r.shown)
  assert.ok(!r.report.judgmentCalls.some((j) => String(j).includes(SAME_TIER_MARK)),
    '(b)/M1: the same run must not also record ' + SAME_TIER_MARK + '; got ' + r.shown)
  console.log('ok - (b)/M1: class `no-structured-output` — the retry runs at TIER.mostCapable')
}

// ══ (c) a schema-WORDED message with class `error` stays in tier [M2] ═══════
// At BASE this message escalates: the regex `/schema|structuredoutput|…/i`
// matches it. The class says otherwise, and the class is what decides.
{
  const r = await retryRun({
    tag: 'c',
    makeError: () => workerError('StructuredOutput did not conform to schema', { class: 'error' }),
  })
  twoImplDispatches(r, '(c)/M2')
  assert.equal(r.implOpts[1].model, engine.TIER.standard,
    '(c)/M2: workerVerdict.class `error` is not a schema trip however the message is worded, so the ' +
    "retry runs at the task's own tier and the second impl:T1 dispatch's opts.model must be " +
    'TIER.standard (' + engine.TIER.standard + '), got ' + String(r.implOpts[1].model) +
    ' — a message-reading driver escalates here')
  assert.ok(r.report.judgmentCalls.some((j) => String(j).includes(SAME_TIER_MARK)),
    '(c)/M2: judgmentCalls must hold an entry carrying ' + SAME_TIER_MARK + '; got ' + r.shown)
  assert.ok(!r.report.judgmentCalls.some((j) => String(j).includes(ESCALATE_MARK)),
    '(c)/M2: the run must not record ' + ESCALATE_MARK + ' for a class that is not a schema trip; got ' +
    r.shown)
  console.log('ok - (c)/M2: class `error` under a `StructuredOutput did not conform to schema` message — ' +
    'the retry runs at TIER.standard and the entry carries ' + SAME_TIER_MARK)
}

// ══ (d) no `workerVerdict` at all stays in tier [M2] ════════════════════════
{
  const r = await retryRun({ tag: 'd', makeError: () => workerError('schema', undefined) })
  twoImplDispatches(r, '(d)/M2')
  assert.equal(r.implOpts[1].model, engine.TIER.standard,
    '(d)/M2: an error carrying no workerVerdict property is not a schema trip however the message is ' +
    "worded, so the retry runs at the task's own tier and the second impl:T1 dispatch's opts.model " +
    'must be TIER.standard (' + engine.TIER.standard + '), got ' + String(r.implOpts[1].model))
  assert.ok(r.report.judgmentCalls.some((j) => String(j).includes(SAME_TIER_MARK)),
    '(d)/M2: judgmentCalls must hold an entry carrying ' + SAME_TIER_MARK + '; got ' + r.shown)
  assert.ok(!r.report.judgmentCalls.some((j) => String(j).includes(ESCALATE_MARK)),
    '(d)/M2: the run must not record ' + ESCALATE_MARK + ' for an error with no workerVerdict; got ' +
    r.shown)
  console.log('ok - (d)/M2: no workerVerdict under the message `schema` — the retry runs at TIER.standard ' +
    'and the entry carries ' + SAME_TIER_MARK)
}

// ══ (e) the four remaining classes, each under a `schema` message [M2] ══════
for (const cls of ['no-envelope', 'budget', 'api-error', 'sigterm']) {
  const r = await retryRun({
    tag: 'e-' + cls, makeError: () => workerError('WORKER_X: schema', { class: cls }),
  })
  twoImplDispatches(r, '(e)/M2 [' + cls + ']')
  assert.equal(r.implOpts[1].model, engine.TIER.standard,
    '(e)/M2: workerVerdict.class `' + cls + '` is not a schema trip, so the retry runs at the task\'s ' +
    "own tier and the second impl:T1 dispatch's opts.model must be TIER.standard (" +
    engine.TIER.standard + '), got ' + String(r.implOpts[1].model) +
    ' — the message `WORKER_X: schema` is what a message-reading driver escalates on')
  assert.ok(r.report.judgmentCalls.some((j) => String(j).includes(SAME_TIER_MARK)),
    '(e)/M2 [' + cls + ']: judgmentCalls must hold an entry carrying ' + SAME_TIER_MARK + '; got ' + r.shown)
  assert.ok(!r.report.judgmentCalls.some((j) => String(j).includes(ESCALATE_MARK)),
    '(e)/M2 [' + cls + ']: the run must not record ' + ESCALATE_MARK + '; got ' + r.shown)
  console.log('ok - (e)/M2: class `' + cls + '` under a `schema` message — the retry runs at TIER.standard')
}

// ══ (f) the lever is gone [M3] ══════════════════════════════════════════════
assert.ok(!Object.prototype.hasOwnProperty.call(engine, 'isSchemaTrip'),
  '(f)/M3: fleet/run-engine.mjs must export no `isSchemaTrip`; the namespace import still has the key. ' +
  'Exports seen: ' + Object.keys(engine).join(', '))
assert.equal(engine.isSchemaTrip, undefined,
  '(f)/M3: `isSchemaTrip` must not be reachable on the run-engine namespace; got ' +
  typeof engine.isSchemaTrip)

// M3's second half, graded here beside the task's `Run:` line: the token
// appears nowhere in either source file, comments included. Resolved against
// this file's own URL — never a literal absolute path — so the hermetic probe's
// rules stay satisfied and the sim spawns nothing.
for (const rel of ['../run-engine.mjs', '../run-worker.mjs']) {
  const file = fileURLToPath(new URL(rel, import.meta.url))
  const text = fs.readFileSync(file, 'utf8')
  const hits = text.split('\n')
    .map((line, i) => (line.includes('isSchemaTrip') ? (i + 1) + ': ' + line.trim() : null))
    .filter(Boolean)
  assert.equal(hits.length, 0,
    '(f)/M3: fleet/' + rel.replace('../', '') + ' must contain the token `isSchemaTrip` zero times, ' +
    'comments included; found ' + hits.length + ' — ' + hits.join(' | '))
}
console.log('ok - (f)/M3: no `isSchemaTrip` export, and the token appears zero times in run-engine.mjs ' +
  'and run-worker.mjs')

console.log('ALL TESTS PASSED')

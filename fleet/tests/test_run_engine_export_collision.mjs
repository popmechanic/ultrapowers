// fleet/tests/test_run_engine_export_collision.mjs — the export collision
// (#1057): a worker that adds a public name a SIBLING task was contracted to
// provide is told so on the driver's own pre-review pass, before any reviewer
// reads the patch, and gets the one repair round every other red of that pass
// buys.
//
// This file is the Proof's `Test:`, written whole at the guarded path it names.
// Every relative import is written for THIS directory: `../` is the
// repository's `fleet/`, `./` is `fleet/tests/`. Nothing under
// `fleet/tests/exams/` is imported — #1053: a pointer at the guarded path is
// stripped at publish and leaves main red, so the sim stands here entire.
//
// Everything below the agent seam is the real thing — real git repos, real
// clones at BASE, the real `withPatchCapture` diff, the real fold kernel and
// the real `sh` — and only the judgments are canned, so the collision the
// assertions read is the driver's own reading of a patch the driver captured.
//
// The Machine clauses under test, restated so a reader can map each assertion
// back to the contract:
//
//   M1 — `producedSymbolOf(entry)`, EXPORTED from `fleet/run-engine.mjs`,
//        reduces a `Produces:` entry string to its symbol token exactly as the
//        compiler's `_interface_token` does (`compile_plan.py`): the first
//        backtick span's leading identifier — up to the first `(`, `->`, `=`,
//        whitespace or closing backtick — after skipping a leading `class`,
//        `def`, `function`, `const`, `let`, `var`, `async` or `export`; for a
//        bare entry with no backticks, the identifier it starts with when that
//        identifier stands alone or is followed by `(`, `->` or `=`; `''` for
//        `none`, `nothing`, `n/a`, `na` (case-insensitive, with or without a
//        trailing parenthetical) and for an entry whose lead is a prose word
//        followed by more words.
//   M2 — `addedExportsOf(patchFile)`, EXPORTED from `fleet/run-engine.mjs`,
//        reads a unified diff FILE and returns `[{ path, name }]`, one row per
//        ADDED line (begins `+`, not `+++`) that declares a top-level export:
//        in a `.mjs`/`.js`/`.ts`/`.tsx`/`.cjs`/`.mts` file, `export` then
//        optionally `default`, then optionally `async`, then one of `const`,
//        `let`, `var`, `function`, `function*`, `class`, then the name, with
//        any leading whitespace; in a `.py` file, a `def`/`class` at column
//        zero followed by the name. Removed lines, context lines and an
//        unreadable file yield no rows; `path` is the `b/` path of the
//        enclosing `diff --git` header.
//   M3 — on the pre-review pass, after the handshake read and before the pass
//        returns, every `addedExportsOf(impl.patch)` row whose `name` equals
//        `producedSymbolOf` of a `Produces:` entry of at least one OTHER task
//        of the plan and equals `producedSymbolOf` of NONE of this task's own
//        entries pushes one red `{ line, stdout: '' }` — `line` exactly the
//        sentence `COLLISION` spells below, naming the first such sibling in
//        plan order — and appends one `driver:finding` event
//        `{task, round: 0, severity: 'blocking', actor: 'implementer', detail,
//        paths: [<path>], evidence: {read, against}}`. One red and one row per
//        distinct `(name, path)` pair.
//   M4 — that red is handled as every other red of the pass: it buys the
//        `fix:<id>:0` round whose prompt carries the line, the pass re-runs on
//        the new capture, and a fix that leaves the export in place ends the
//        task `failed` with `reviewVerdict: 'proof-red'` and `notes` carrying
//        the line, while a fix that renames or removes it leaves the pass green
//        and the task goes to its review round.
//   M5 — an export equal to one of THIS task's own tokens, an export equal to
//        no sibling's token, a sibling-token export on a REMOVED line only, and
//        a run whose plan carries no `Produces:` entry at all each add no red
//        and no `driver:finding` at `round` `0`, and the pass's
//        `driver:proof-run`, `driver:exam-run` and `driver:check-run` rows are
//        exactly those of BASE.
//   M6 — `fleet/CONTRACT.md`'s pre-review paragraph — the one that begins `The
//        driver's own executions are three more kinds` — carries `exports`,
//        `Produces`, `fix:<id>:0` and `driver:finding` in that order.
//
// Legs: (a) M1, (b) M2, (c) M3+M4, (d) M4, (e) M5, (f) M5, (g) M6, (h) M3.
//
// Legs (f), (g) and (h) are the Proof's second, third and fourth `Run:`
// commands, which the driver executes itself. (g) and (h) are cheap to read
// here and are read here too. (f) names the whole `Run:`-proofs sim, which this
// file may NOT spawn — `test_sims_are_hermetic.mjs` M4 forbids one `test_*.mjs`
// running another — so what stands for it in this file is M5's own sentence
// about the three row kinds, asserted directly on a run that has a `Run:`
// command and a `Check:` to record.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as engine from '../run-engine.mjs'
import { rig, makeRepo, gitSync, passReview, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-export-collision-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// ── the two helpers, by namespace ───────────────────────────────────────────
// A NAMED import of a symbol BASE does not export is a link-time error that
// takes the whole file down with it, and legs (g) and (h) — which do not touch
// either helper — would never report. The namespace import plus these two
// assertions is the same red for the same reason, leg by leg.
const producedSymbolOf = engine.producedSymbolOf
const addedExportsOf = engine.addedExportsOf
assert.equal(typeof producedSymbolOf, 'function',
  '[M1] `fleet/run-engine.mjs` exports `producedSymbolOf(entry)`. Got: ' +
  typeof producedSymbolOf)
assert.equal(typeof addedExportsOf, 'function',
  '[M2] `fleet/run-engine.mjs` exports `addedExportsOf(patchFile)`. Got: ' +
  typeof addedExportsOf)

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] the token rule, over the compiler's own eight examples plus its two
//     placeholder cases — ten calls, ten equalities
// ══════════════════════════════════════════════════════════════════════════
//
// These are the entries the compiler's comment at `compile_plan.py` spells
// beside `_interface_token`, and the expected answers are that function's, read
// off it rather than invented: the engine's copy and the compiler's must agree
// on which entries name a symbol, or the driver reads a contract the plan does
// not have. The backticked entries and the bare ones are both here, because the
// two arms of the rule are what a wrong copy gets wrong.
{
  const CASES = [
    ['`receiptPaths(list: string[]) -> string[]`', 'receiptPaths',
     'a backticked signature: the first backtick span, cut at the `(`'],
    ['`User` dataclass (id, name)', 'User',
     'a backticked symbol with a prose tail: the tail is allowed and ignored'],
    ['`validate(p)`', 'validate', 'a backticked call: cut at the `(`'],
    ['`class FailedLookup(RuntimeError)`', 'FailedLookup',
     'a leading declaration keyword is skipped — `class` is not the symbol'],
    ['validate_payload(payload) -> list[str]', 'validate_payload',
     'a bare identifier followed by a `(` signature'],
    ['User', 'User', 'a bare identifier standing alone'],
    ['none', '', 'the `none` placeholder is no contract at all'],
    ['nothing (test-data-only change)', '',
     'a placeholder with a trailing parenthetical is still a placeholder'],
    ['the baked reviewer prompt', '',
     'a prose lead followed by more words is documentation, not a symbol'],
    ['every task object carries it', '', 'likewise prose'],
  ]
  for (const [entry, want, why] of CASES) {
    assert.equal(producedSymbolOf(entry), want,
      '(a) [M1] `producedSymbolOf(' + JSON.stringify(entry) + ')` is ' +
      JSON.stringify(want) + ' — ' + why + '. Got: ' +
      JSON.stringify(producedSymbolOf(entry)))
  }
}

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] the added-export reader, over one hand-written unified diff
// ══════════════════════════════════════════════════════════════════════════
//
// One fixture carrying every case the clause distinguishes: three added
// top-level exports (a `const`, an indented `export async function`, an
// `export default class`), a REMOVED export, a CONTEXT export, an added line
// that is no export at all, and a second `diff --git` whose `b/` path is a
// `.py` — where the rule is the column-zero `def`/`class` and an INDENTED `def`
// is not a top-level one. The `+++ b/…` header line begins with `+` and is not
// an added line; a reader that forgets that clause sees a row for it.
{
  const DIFF = [
    'diff --git a/lib/x.mjs b/lib/x.mjs',
    'index 1111111111111111111111111111111111111111..2222222222222222222222222222222222222222 100644',
    '--- a/lib/x.mjs',
    '+++ b/lib/x.mjs',
    '@@ -1,2 +1,5 @@',
    '+export const receiptPaths = 1',
    '+  export async function foldReceiptOf() {}',
    '+export default class Renderer {}',
    '-export const gone = 1',
    ' export const ctx = 1',
    '+const local = 1',
    'diff --git a/tool.py b/tool.py',
    'index 3333333333333333333333333333333333333333..4444444444444444444444444444444444444444 100644',
    '--- a/tool.py',
    '+++ b/tool.py',
    '@@ -1,1 +1,3 @@',
    '+def receipt_rows():',
    '+    def inner():',
    ' pass',
    '',
  ].join('\n')
  const at = path.join(tmp, 'added-exports.patch')
  fs.writeFileSync(at, DIFF)

  assert.deepEqual(addedExportsOf(at), [
    { path: 'lib/x.mjs', name: 'receiptPaths' },
    { path: 'lib/x.mjs', name: 'foldReceiptOf' },
    { path: 'lib/x.mjs', name: 'Renderer' },
    { path: 'tool.py', name: 'receipt_rows' },
  ], '(b) [M2] `addedExportsOf` returns one `{path, name}` row per ADDED ' +
     'top-level export, in file order, `path` the `b/` half of the enclosing ' +
     '`diff --git` header: the removed `export const gone`, the context ' +
     '`export const ctx`, the added non-export `const local` and the INDENTED ' +
     '`def inner` are none of them, and the `+++ b/lib/x.mjs` header is not an ' +
     'added line. Got: ' + JSON.stringify(addedExportsOf(at)))

  const missing = path.join(tmp, 'no-such-file.patch')
  assert.deepEqual(addedExportsOf(missing), [],
    '(b) [M2] an unreadable patch file yields no rows — `[]`, never a throw. ' +
    'Got: ' + JSON.stringify(addedExportsOf(missing)))
}

// ══════════════════════════════════════════════════════════════════════════
// the rig the engine legs share
// ══════════════════════════════════════════════════════════════════════════
//
// A two-task wave, A and B, no edge between them, width 2 — the shape
// `test_run_engine_re_edge.mjs`'s `driveHub` uses. A task object's
// `interfaces` key is read as-is by the engine, so the plan's contract is the
// literal below. No `Run:`, no `Check:`, no `Test:` unless a scenario asks for
// one: with none, the pre-review pass at BASE is empty and green, so the only
// red any of these runs can carry is the collision itself.
const BODY = '**Claim:** the task writes its own file\n' +
  'Machine: M1. The tree holds the task\'s file.\n\n' +
  '**Proof:**\n- Legs: (a) the file is there [M1]'
const taskOf = (id, over = {}) => ({
  id,
  title: 'task ' + id,
  files: [id.toLowerCase() + '.mjs'],
  tier: 'standard',
  review: 'lean',
  writes: [id.toLowerCase() + '.mjs'],
  commutes: [],
  interfaces: { consumes: ['none'], produces: ['none'] },
  testCmd: 'bash check.sh',
  proofTests: [],
  proofRuns: [],
  body: BODY,
  ...over,
})
// A's contract throughout: the symbol the collision is about.
const PRODUCES_RECEIPT_PATHS = {
  consumes: ['none'],
  produces: ['`receiptPaths(list: string[]) -> string[]`'],
}

// The sentence M3 spells, exactly — the fourth red line shape of the pass,
// beside `RUN_FAIL`, `EXAM_FAIL` and `CHECK_FAIL`, and the one that begins
// `the patch exports` so a reader can grep it apart from the other three.
const COLLISION = (name, at, sibling) =>
  'the patch exports ' + name + ' at ' + at + ', a symbol task ' + sibling +
  ' is contracted to Produce and this task is not — rename it or drop the export'
const DETAIL = COLLISION('receiptPaths', 'b.mjs', 'A')

/**
 * Stand one run up. `write(cwd, id, kind)` is what the implementer (and the fix
 * round) leaves in the task's own clone; every judgment is canned, and any
 * dispatch this sim did not expect throws rather than being quietly answered.
 */
const drive = async ({ tag, waves, repoFiles = {}, write, extra = {} }) => {
  const repo = makeRepo(path.join(tmp, 'repo-' + tag), repoFiles)
  const runDir = path.join(tmp, 'run-' + tag)
  const calls = []
  const prompts = {}
  const heads = {}
  const stub = (prompt, opts, cwd) => {
    const label = String(opts.label)
    calls.push(label)
    prompts[label] = prompt
    const kind = label.split(':')[0]
    const id = label.split(':')[1]
    if (kind === 'impl' || kind === 'fix') {
      write(cwd, id, kind)
      // The sha `withPatchCapture` records for this reply: it runs `rev-parse
      // HEAD` in this same clone after the worker returns, and no sim here
      // commits, so reading it now reads the same value.
      heads[label] = gitSync(['rev-parse', 'HEAD'], cwd)
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    throw new Error('unexpected dispatch: ' + label)
  }
  const { run } = rig({
    repo, runDir, waves, stub, stamp: 'xc-' + tag,
    extraArgs: { width: 2, foldAgeMs: 0, ...extra },
  })
  const report = await run()
  const file = path.join(runDir, 'events.jsonl')
  const evs = (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '')
    .split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
  return { report, calls, prompts, heads, evs, runDir }
}
/** The report row of one task — the rows come back in completion order. */
const rowOf = (report, id) => report.tasks.find((t) => t.task === id)
/** Every finding the driver raised on a pre-review pass. */
const findingsAtRoundZero = (evs) =>
  evs.filter((e) => e.kind === 'driver:finding' && e.round === 0)

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] [M4] the collision, the receipt, the repair round, the review
// ══════════════════════════════════════════════════════════════════════════
//
// A is contracted to Produce `receiptPaths`; B is contracted to Produce
// nothing, and B's implementer exports `receiptPaths` anyway. B's fix round
// renames it. At BASE this run dispatches `impl:A`, `impl:B`, `review:A:1`,
// `review:B:1` and appends no `driver:finding` at all — which is where these
// assertions fail there, and they fail saying the collision was not raised.
{
  const A = taskOf('A', { interfaces: PRODUCES_RECEIPT_PATHS })
  const B = taskOf('B')
  const { report, calls, prompts, heads, evs } = await drive({
    tag: 'collide', waves: [[A, B]],
    write: (cwd, id, kind) => {
      if (id === 'A') { fs.writeFileSync(path.join(cwd, 'a.mjs'), 'export const aOwn = 1\n'); return }
      fs.writeFileSync(path.join(cwd, 'b.mjs'),
        kind === 'fix' ? 'export const bPaths = 1\n' : 'export const receiptPaths = 1\n')
    },
  })

  // [M3] one row, and one only: one red and one `driver:finding` per distinct
  // `(name, path)` pair, and the green second pass adds none.
  const found = findingsAtRoundZero(evs)
  assert.equal(found.length, 1,
    '(c) [M3] the run appends exactly ONE `driver:finding` at `round` 0 — one ' +
    'per distinct (name, path) pair, and the pass after the fix adds no ' +
    'second. Got: ' + JSON.stringify(found))
  const f = found[0]
  assert.equal(f.task, 'B', '(c) [M3] the finding is held against B, the task whose patch ' +
    'carries the export. Got: ' + JSON.stringify(f.task))
  assert.equal(f.round, 0, '(c) [M3] the finding is at `round` 0 — the driver\'s own ' +
    'pre-review pass, before any reviewer. Got: ' + JSON.stringify(f.round))
  assert.equal(f.severity, 'blocking',
    '(c) [M3] `severity` is `blocking`. Got: ' + JSON.stringify(f.severity))
  assert.equal(f.actor, 'implementer',
    '(c) [M3] `actor` is `implementer` — the party that added the export is the party that ' +
    'can rename it. Got: ' + JSON.stringify(f.actor))
  assert.equal(f.detail, DETAIL,
    '(c) [M3] `detail` is exactly the sentence M3 spells, naming the symbol, the `b/` path ' +
    'the diff header carried and the first sibling in plan order contracted to Produce it. ' +
    'Got: ' + JSON.stringify(f.detail))
  assert.deepEqual(f.paths, ['b.mjs'],
    '(c) [M3] `paths` is the one path the export was added at. Got: ' + JSON.stringify(f.paths));
  // The receipt's two strings: what was read, and what it was read against —
  // the captured patch at the head the driver itself derived for that reply.
  {
    const head = heads['impl:B']
    assert.ok(head, '(c) sim precondition: the stub recorded `impl:B`\'s clone head')
    assert.deepEqual(f.evidence, {
      read: DETAIL,
      against: 'the captured patch at ' + head,
    }, '(c) [M3] `evidence.read` is the finding\'s own line and `evidence.against` names the ' +
       'captured patch at B\'s first captured `headSha` (' + head + '). Got: ' +
       JSON.stringify(f.evidence))
  }

  // [M4] the red buys the `fix:B:0` round, and the round is told the line.
  assert.ok(calls.includes('fix:B:0'),
    '(c) [M4] the collision red buys B the `fix:B:0` round every other red of the pass buys. ' +
    'The dispatches were: ' + JSON.stringify(calls))
  assert.ok(String(prompts['fix:B:0'] || '').includes(DETAIL),
    '(c) [M4] the `fix:B:0` prompt carries the collision line in its blocking-issues block. ' +
    'Got: ' + JSON.stringify(String(prompts['fix:B:0'] || '').slice(-600)))

  // [M4] the fix renamed the export, so the second pass is green and B reaches
  // its reviewer — after the fix, never before it.
  assert.ok(calls.includes('review:B:1'),
    '(c) [M4] a fix that renames the export leaves the pass green and B goes to its review ' +
    'round. The dispatches were: ' + JSON.stringify(calls))
  assert.ok(calls.indexOf('fix:B:0') > calls.indexOf('impl:B') &&
            calls.indexOf('review:B:1') > calls.indexOf('fix:B:0'),
    '(c) [M4] the order is `impl:B`, then `fix:B:0`, then `review:B:1` — the repair round ' +
    'stands between the implementer and the first referee. Got: ' + JSON.stringify(calls))
  assert.equal(rowOf(report, 'B').status, 'done',
    '(c) [M4] B ends `done`. Got: ' + JSON.stringify(rowOf(report, 'B')))
  assert.equal(rowOf(report, 'A').status, 'done',
    '(c) [M3] A — the task that was contracted to Produce the symbol — is untouched by the ' +
    'scan and ends `done`. Got: ' + JSON.stringify(rowOf(report, 'A')))
  assert.ok(!calls.some((l) => l.startsWith('fix:A:')),
    '(c) [M3] A buys no repair round: its own export is no sibling\'s contracted symbol. ' +
    'The dispatches were: ' + JSON.stringify(calls))
}

// ══════════════════════════════════════════════════════════════════════════
// (d) [M4] the fix that leaves the export in place
// ══════════════════════════════════════════════════════════════════════════
//
// The same run, with a fix round that rewrites nothing that matters: the second
// pass finds the same collision, and a task still red after its one repair
// round never reaches a referee at all.
{
  const A = taskOf('A', { interfaces: PRODUCES_RECEIPT_PATHS })
  const B = taskOf('B')
  const { report, calls, evs } = await drive({
    tag: 'stubborn', waves: [[A, B]],
    write: (cwd, id, kind) => {
      if (id === 'A') { fs.writeFileSync(path.join(cwd, 'a.mjs'), 'export const aOwn = 1\n'); return }
      fs.writeFileSync(path.join(cwd, 'b.mjs'),
        kind === 'fix' ? 'export const receiptPaths = 1\n// the fix round moved nothing\n'
                       : 'export const receiptPaths = 1\n')
    },
  })

  assert.ok(!calls.some((l) => l.startsWith('review:B:')),
    '(d) [M4] a task still red after its pre-review repair round reaches NO reviewer. The ' +
    'dispatches were: ' + JSON.stringify(calls))
  const row = rowOf(report, 'B')
  assert.equal(row.status, 'failed',
    '(d) [M4] B ends `failed`. Got: ' + JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'proof-red',
    '(d) [M4] B\'s `reviewVerdict` is `proof-red` — the collision red is a red of the pass ' +
    'like any other. Got: ' + JSON.stringify(row.reviewVerdict))
  assert.ok(String(row.notes || '').includes('the patch exports receiptPaths at b.mjs'),
    '(d) [M4] B\'s `notes` carry the collision line. Got: ' + JSON.stringify(row.notes))

  const found = findingsAtRoundZero(evs)
  assert.equal(found.length, 2,
    '(d) [M4] the pass ran twice and found the collision twice, so the record carries one ' +
    '`driver:finding` per pass. Got: ' + JSON.stringify(found))
  assert.deepEqual(found.map((e) => e.detail), [DETAIL, DETAIL],
    '(d) [M4] both rows carry the same collision line. Got: ' +
    JSON.stringify(found.map((e) => e.detail)))
  assert.deepEqual(found.map((e) => [e.task, e.round]), [['B', 0], ['B', 0]],
    '(d) [M4] both rows are B\'s, both at `round` 0. Got: ' +
    JSON.stringify(found.map((e) => [e.task, e.round])))
}

// ══════════════════════════════════════════════════════════════════════════
// (e) [M5] the four runs that add no red — and (f) [M5] the pass's own rows
// ══════════════════════════════════════════════════════════════════════════
//
// (e.1) the export is one of the task's OWN contracted symbols.
{
  const A = taskOf('A', { interfaces: PRODUCES_RECEIPT_PATHS })
  const B = taskOf('B', {
    interfaces: { consumes: ['none'], produces: ['`receiptPaths(list) -> string[]`'] },
  })
  const { report, calls, evs } = await drive({
    tag: 'own', waves: [[A, B]],
    write: (cwd, id) => fs.writeFileSync(path.join(cwd, id.toLowerCase() + '.mjs'),
      id === 'B' ? 'export const receiptPaths = 1\n' : 'export const aOwn = 1\n'),
  })
  assert.deepEqual(findingsAtRoundZero(evs), [],
    '(e.1) [M5] an export equal to one of THIS task\'s own `Produces:` tokens is no ' +
    'collision — B is contracted to provide `receiptPaths` too. Got: ' +
    JSON.stringify(findingsAtRoundZero(evs)))
  assert.ok(!calls.some((l) => l.startsWith('fix:')),
    '(e.1) [M5] no repair round. The dispatches were: ' + JSON.stringify(calls))
  assert.deepEqual(calls.filter((l) => l.startsWith('review:')).sort(),
    ['review:A:1', 'review:B:1'],
    '(e.1) [M5] one review dispatch per task. Got: ' + JSON.stringify(calls))
  assert.deepEqual(report.tasks.map((t) => t.status), ['done', 'done'],
    '(e.1) [M5] both tasks end `done`. Got: ' + JSON.stringify(report.tasks.map(
      (t) => [t.task, t.status])))
}

// (e.2) the export equals no sibling's token — and this is the run that carries
// a `Run:` command and a Global Constraints `Check:`, so (f)'s sentence about
// the pass's three row kinds has rows to be read off.
{
  const RUN_CMD = "sh -c 'echo pre-review-pass'"
  const CHECK_CMD = "sh -c 'exit 0'"
  const A = taskOf('A', { interfaces: PRODUCES_RECEIPT_PATHS, proofRuns: [RUN_CMD] })
  const B = taskOf('B', { proofRuns: [RUN_CMD] })
  const { report, calls, evs } = await drive({
    tag: 'unrelated', waves: [[A, B]],
    write: (cwd, id) => fs.writeFileSync(path.join(cwd, id.toLowerCase() + '.mjs'),
      id === 'B' ? 'export const unrelatedName = 1\n' : 'export const aOwn = 1\n'),
    extra: { constraintChecks: [{ cmd: CHECK_CMD, minor: false }] },
  })
  assert.deepEqual(findingsAtRoundZero(evs), [],
    '(e.2) [M5] an export equal to NO sibling\'s token adds no finding. Got: ' +
    JSON.stringify(findingsAtRoundZero(evs)))
  assert.ok(!calls.some((l) => l.startsWith('fix:')),
    '(e.2) [M5] no repair round. The dispatches were: ' + JSON.stringify(calls))
  assert.deepEqual(calls.filter((l) => l.startsWith('review:')).sort(),
    ['review:A:1', 'review:B:1'],
    '(e.2) [M5] one review dispatch per task. Got: ' + JSON.stringify(calls))
  assert.deepEqual(report.tasks.map((t) => t.status), ['done', 'done'],
    '(e.2) [M5] both tasks end `done`. Got: ' + JSON.stringify(report.tasks.map(
      (t) => [t.task, t.status])))

  // (f) [M5] the pass's own executions, per task, in order: exactly what BASE
  // records — one `driver:proof-run` and one `driver:check-run` at `iter: 0`,
  // both exit 0, and no `driver:exam-run` at all (these tasks have no `Test:`).
  // The scan the plan adds runs BESIDE those three kinds and adds none of its
  // own. (The Proof's second `Run:` — the whole `Run:`-proofs sim — is the
  // cross-file half of this leg; `test_sims_are_hermetic.mjs` M4 forbids this
  // file spawning it, so what stands here is M5's sentence itself.)
  for (const id of ['A', 'B']) {
    const rows = evs
      .filter((e) => /^driver:(proof|check|exam)-run$/.test(e.kind) && e.task === id)
      .map((e) => [e.kind, e.cmd, e.exit, e.iter])
    assert.deepEqual(rows, [
      ['driver:proof-run', RUN_CMD, 0, 0],
      ['driver:check-run', CHECK_CMD, 0, 0],
    ], '(f) [M5] task ' + id + '\'s pre-review pass records exactly the rows BASE records: ' +
       'the `Run:` command then the `Check:` command, both at `iter` 0 and both exit 0, and ' +
       'no `driver:exam-run`. Got: ' + JSON.stringify(rows))
  }
}

// (e.3) the sibling's symbol is on a REMOVED line only: the repo carried
// `export const receiptPaths = 1` at BASE and B's patch deletes it.
{
  const A = taskOf('A', { interfaces: PRODUCES_RECEIPT_PATHS })
  const B = taskOf('B')
  const { report, calls, evs, runDir } = await drive({
    tag: 'removed', waves: [[A, B]],
    repoFiles: { 'b.mjs': 'export const receiptPaths = 1\nconst keep = 2\n' },
    write: (cwd, id) => {
      if (id === 'B') { fs.writeFileSync(path.join(cwd, 'b.mjs'), 'const keep = 2\n'); return }
      fs.writeFileSync(path.join(cwd, 'a.mjs'), 'export const aOwn = 1\n')
    },
  })
  // The patch really is the removal — a sim whose implementer wrote nothing
  // would pass the assertions below for the wrong reason.
  const captured = fs.readFileSync(path.join(runDir, 'patches', 'task-B.patch'), 'utf8')
  assert.ok(captured.includes('-export const receiptPaths = 1'),
    '(e.3) sim precondition: B\'s captured patch REMOVES the export. Got: ' + captured)
  assert.ok(!/^\+export const receiptPaths/m.test(captured),
    '(e.3) sim precondition: B\'s captured patch adds no such export. Got: ' + captured)
  assert.deepEqual(findingsAtRoundZero(evs), [],
    '(e.3) [M5] a sibling-token export on a REMOVED line only is no collision — the scan ' +
    'reads ADDED lines. Got: ' + JSON.stringify(findingsAtRoundZero(evs)))
  assert.ok(!calls.some((l) => l.startsWith('fix:')),
    '(e.3) [M5] no repair round. The dispatches were: ' + JSON.stringify(calls))
  assert.deepEqual(calls.filter((l) => l.startsWith('review:')).sort(),
    ['review:A:1', 'review:B:1'],
    '(e.3) [M5] one review dispatch per task. Got: ' + JSON.stringify(calls))
  assert.deepEqual(report.tasks.map((t) => t.status), ['done', 'done'],
    '(e.3) [M5] both tasks end `done`. Got: ' + JSON.stringify(report.tasks.map(
      (t) => [t.task, t.status])))
}

// (e.4) a plan with no `Produces:` entry at all: one task, contracted to
// provide nothing, exporting the symbol anyway. There is no sibling and no
// contract, so there is nothing for the scan to read.
{
  const S = taskOf('S', { files: ['s.mjs'], writes: ['s.mjs'] })
  const { report, calls, evs } = await drive({
    tag: 'solo', waves: [[S]],
    write: (cwd) => fs.writeFileSync(path.join(cwd, 's.mjs'), 'export const receiptPaths = 1\n'),
  })
  assert.deepEqual(findingsAtRoundZero(evs), [],
    '(e.4) [M5] a run whose plan carries no `Produces:` entry at all adds no finding. Got: ' +
    JSON.stringify(findingsAtRoundZero(evs)))
  assert.ok(!calls.some((l) => l.startsWith('fix:')),
    '(e.4) [M5] no repair round. The dispatches were: ' + JSON.stringify(calls))
  assert.deepEqual(calls.filter((l) => l.startsWith('review:')), ['review:S:1'],
    '(e.4) [M5] one review dispatch for the one task. Got: ' + JSON.stringify(calls))
  assert.equal(rowOf(report, 'S').status, 'done',
    '(e.4) [M5] the task ends `done`. Got: ' + JSON.stringify(rowOf(report, 'S')))
}

// ══════════════════════════════════════════════════════════════════════════
// (g) [M6] the contract's pre-review paragraph — the third `Run:`, read here
// ══════════════════════════════════════════════════════════════════════════
//
// The same range the Proof's `sed` takes: from the line carrying `three more
// kinds` to the line carrying `One more kind records`, newlines folded to
// spaces, then the four words in that order. At BASE the range carries none of
// them.
{
  const contract = fs.readFileSync(new URL('../CONTRACT.md', import.meta.url), 'utf8')
  const lines = contract.split('\n')
  const from = lines.findIndex((l) => l.includes('three more kinds'))
  assert.ok(from !== -1,
    '(g) [M6] sim precondition: `fleet/CONTRACT.md` carries the line `three more kinds`, ' +
    'which opens the pre-review paragraph the clause extends')
  const to = lines.findIndex((l, i) => i >= from && l.includes('One more kind records'))
  assert.ok(to !== -1,
    '(g) [M6] sim precondition: the paragraph is closed by the line `One more kind records` ' +
    '— the collision sentence belongs INSIDE that range, appended after the `flaky: true` ' +
    'sentence and before it')
  const range = lines.slice(from, to + 1).join(' ')
  assert.match(range, /exports.*Produces.*fix:<id>:0.*driver:finding/,
    '(g) [M6] the pre-review paragraph carries `exports`, `Produces`, `fix:<id>:0` and ' +
    '`driver:finding` in that order, saying that an added export naming a sibling\'s ' +
    '`Produces:` symbol is a red of the pass routed to `fix:<id>:0` and recorded as a ' +
    '`driver:finding` at `round` 0. The range reads: ' + JSON.stringify(range))
}

// ══════════════════════════════════════════════════════════════════════════
// (h) [M3] the guard — the fourth `Run:`, read here too
// ══════════════════════════════════════════════════════════════════════════
//
// #1053: an exam reached by an `import` line naming a path under
// `fleet/tests/exams/` is stripped at publish and leaves main red. This file
// stands whole at its guarded path, and reads its own text to say so.
{
  const self = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n')
  const pointers = self.filter((l) => /^import .*exams\//.test(l))
  assert.deepEqual(pointers, [],
    '(h) [M3] the guarded sim carries no `import` line naming a path under `exams/` — it ' +
    'imports the engine and the sim helpers by their `fleet/tests/`-relative paths and ' +
    'nothing else. Found: ' + JSON.stringify(pointers))
}

// The sentinel the Proof's first `Run:` greps for: printed only if every
// assertion above held.
console.log('ALL TESTS PASSED')

/**
 * fleet/tests/test_retire.mjs — the one-time sweep: every plan-and-evidence
 * branch pair on the target becomes the two tags, verified against the remote,
 * and only then are the branches deleted; and (#724 Task 1) an integration
 * branch whose deciding pull request is closed and not merged is deleted too.
 *
 * Every group below names the Machine clause and the Proof leg it encodes, so a
 * reader can map an assertion back to the contract it came from.
 *
 *   (a) M1 — `retire({ argv, exec })` refuses without `--target` and with a
 *       `--target` `isSafeTarget` rejects: a `Refusal`, `exitCode` 2, and
 *       `exec.calls` empty — no `gh` call and no `git` call. `--dry-run` is a
 *       valueless flag. Run as a process with no `--target`: exit 2, `--target`
 *       on stderr, and neither shim started.
 *   (b) M2, M7 — exactly one `git ls-remote <url> refs/heads/ultra/*
 *       refs/tags/ultra/*`; a pair is a candidate, candidates ascend, a lone
 *       half is skipped and never touched.
 *   (c) M3 — per candidate: POST plan tag, POST evidence tag, `ls-remote
 *       --tags`, DELETE plan branch, DELETE evidence branch, in that order; an
 *       already-existing reference is not a failure.
 *   (d) M4 — a listing that omits a tag, or shows it at another sha, keeps that
 *       run, issues no DELETE for it, continues with the next N, and sets
 *       `process.exitCode` to 1.
 *   (e)(f) M5 — the closed-PR read per candidate, and the body rewrite that
 *       changes those two substrings and nothing else.
 *   (g) M6 — `--dry-run`: the listing and one pulls read per candidate, and
 *       nothing else, through the seam; every candidate's line says `would`.
 *   (h) M7 — the lines are read from `process.stdout` as they are decided, never
 *       from the resolved value.
 *   (i) M1, M6, M7 — spawned as a process against `git` and `gh` shims first on
 *       `PATH`: the entry hands `retire` the real exec and prints on the
 *       process's stdout.
 *
 * Then, under `#724 Task 1` and over a listing those legs build themselves (the
 * task listing — runs 7, 9, 32, 40, 41 and 42, and no run of the fixture above):
 *
 *   (a) M1 — the one `state=all` fate read, the deciding row is the highest
 *       `number`, the one integration DELETE, and the `deleted` line.
 *   (b)(c)(d) M2 — `open`, `merged` and no-rows all stay, each with one fate
 *       read and no DELETE, even when an older row is closed and unmerged.
 *   (e) M3 — `--dry-run`: the fate read is still issued, no command carries
 *       `-X`, and the deletable case says `would delete`.
 *   (f) M4 — the pair sweep is BASE's, the closed-PR read comes before the fate
 *       read, the integration DELETE is last, and the line is BASE's pair line,
 *       `; `, then the integration segment; BASE's own listing draws no fate
 *       read at all.
 *   (g) M5 — no integration outcome touches `retired`, `kept`, `skipped` or the
 *       exit code, and the re-scoped sweep: over EVERY seam an integration
 *       DELETE appears only for a run whose fate read answered a
 *       highest-numbered row that is closed and unmerged.
 *   (h) M6 — the two documents carry `closed and not merged`, name the retire
 *       sweep as what deletes such a branch, and no longer carry BASE's
 *       two-fate sentences. (The Proof's three `Run:` commands grade the same
 *       documents from the outside; this reads them off disk.)
 *
 * Every call is driven through the `exec` seam with `makeExec({ passthrough: [] })`,
 * so no rule runs `git` or `gh` for real; the process legs run against shims the
 * exam writes into a temporary directory. Nothing here opens a socket and
 * nothing outside the temporary directories is written.
 *
 * The graded lines are always the ones captured off `process.stdout.write` for
 * the duration of the call. This exam never reads `result.lines` — M7 makes it
 * optional, so a leg that fell back to it could not fail.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import {
  Refusal,
  evidenceBranchFor,
  evidenceTagFor,
  integrationBranchFor,
  planBranchFor,
  planTagFor
} from '../lobby.mjs'
import { retire } from '../retire.mjs'
import { answer, cleanup, makeExec, tempDir } from './_lobby_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FLEET_DIR = path.resolve(HERE, '..')
const RETIRE_SRC = path.join(FLEET_DIR, 'retire.mjs')

// ── Shared literals ─────────────────────────────────────────────────────────

const OWNER = 'o'
const REPO = 'r'
const TARGET = `${OWNER}/${REPO}`
const URL = `https://github.com/${OWNER}/${REPO}.git`

/** A 40-hex object name from a hex seed, so every ref has its own sha. */
const sha = (seed) => seed + '0'.repeat(40 - seed.length)
const abbrev = (full) => full.slice(0, 7)

/**
 * M2: the branch heads a listing carries. Runs 3, 5 and 12 are the fixture the
 * BASE legs were written for, and `HEADS_LISTING` below is built from those
 * three alone — run 5 is a lone half. Runs 7 and 9 belong to the `#724 Task 1`
 * listing further down, which is built separately so that no BASE leg's fixture
 * changes.
 */
const HEAD = {
  3: { plan: sha('a3'), evidence: sha('e3') },
  5: { evidence: sha('e5') },
  7: { plan: sha('a7'), evidence: sha('e7') },
  9: { plan: sha('a9') },
  12: { plan: sha('a12'), evidence: sha('e12') }
}

/** M4: a sha that is not the branch head — a tag pointing here is not the record. */
const OTHER_SHA = sha('dead')

/** M2: the one listing, deliberately not in ascending order — the tool sorts. */
const HEADS_LISTING = [
  `${HEAD[12].plan}\trefs/heads/${planBranchFor(12)}`,
  `${HEAD[12].evidence}\trefs/heads/${evidenceBranchFor(12)}`,
  `${HEAD[5].evidence}\trefs/heads/${evidenceBranchFor(5)}`,
  `${HEAD[3].plan}\trefs/heads/${planBranchFor(3)}`,
  `${HEAD[3].evidence}\trefs/heads/${evidenceBranchFor(3)}`
].map((line) => `${line}\n`).join('')

/** M2: the two patterns the one listing asks for. */
const HEADS_GLOB = 'refs/heads/ultra/*'
const TAGS_GLOB = 'refs/tags/ultra/*'
const LIST_LINE = `git ls-remote ${URL} ${HEADS_GLOB} ${TAGS_GLOB}`

/** M3: the three commands a candidate's sweep is made of. */
const postLine = (run, kind) => {
  const tag = kind === 'plan' ? planTagFor(run) : evidenceTagFor(run)
  return `gh api -X POST repos/${TARGET}/git/refs -f ref=refs/tags/${tag} -f sha=${HEAD[run][kind]}`
}
const verifyLine = (run) =>
  `git ls-remote --tags ${URL} refs/tags/${planTagFor(run)} refs/tags/${evidenceTagFor(run)}`
const deleteLine = (run, kind) => {
  const branch = kind === 'plan' ? planBranchFor(run) : evidenceBranchFor(run)
  return `gh api -X DELETE repos/${TARGET}/git/refs/heads/${branch}`
}
/** M5: the closed-PR read, by the head ref GitHub keeps after the delete. */
const pullsLine = (run) =>
  `gh api repos/${TARGET}/pulls?state=closed&head=${OWNER}:ultra/integration-run-${run}`

/** M3: the whole ordered sweep of one candidate, tags then verify then deletes. */
const sweepLines = (run) => [
  postLine(run, 'plan'),
  postLine(run, 'evidence'),
  verifyLine(run),
  deleteLine(run, 'plan'),
  deleteLine(run, 'evidence')
]

// ── M5: the two pull-request bodies ─────────────────────────────────────────

/** A run-3 PR body linking both transient branches, plus one bare mention that
 *  is NOT a `/blob/…/` or `/tree/…/` path — M5 rewrites those two substrings and
 *  changes nothing else, so the bare mention must survive verbatim. */
const BODY_3 = [
  '## run 3 — integration',
  '',
  `plan: https://github.com/${TARGET}/blob/${planBranchFor(3)}/.ultrapowers/plan.md`,
  `evidence: https://github.com/${TARGET}/tree/${evidenceBranchFor(3)}/.ultrapowers/runs/3/`,
  '',
  `the branch ${evidenceBranchFor(3)} is transient; the tags are the record.`,
  ''
].join('\n')

/** The same body with exactly the two link substrings rewritten. */
const BODY_3_PATCHED = BODY_3
  .split(`/blob/${planBranchFor(3)}/`).join(`/blob/${planTagFor(3)}/`)
  .split(`/tree/${evidenceBranchFor(3)}/`).join(`/tree/${evidenceTagFor(3)}/`)

/** A run-12 PR body carrying neither branch path: M5 does not patch it. */
const BODY_12 = 'measurement run 12 — held open on purpose, no links to the transient branches.'

const PR_3 = 41
const PR_12 = 55
const PULLS = { 3: [{ number: PR_3, body: BODY_3 }], 12: [{ number: PR_12, body: BODY_12 }] }

// Fixture self-checks: the bodies are what the legs describe, or the legs below
// would be graded against something else.
assert.ok(BODY_3.includes(`/blob/${planBranchFor(3)}/.ultrapowers/plan.md`), 'fixture: BODY_3 links the plan branch')
assert.ok(BODY_3.includes(`/tree/${evidenceBranchFor(3)}/.ultrapowers/runs/3/`), 'fixture: BODY_3 links the evidence branch')
assert.ok(BODY_3_PATCHED.includes(`/blob/${planTagFor(3)}/.ultrapowers/plan.md`), 'fixture: the expected body links the plan tag')
assert.ok(BODY_3_PATCHED.includes(`/tree/${evidenceTagFor(3)}/.ultrapowers/runs/3/`), 'fixture: the expected body links the evidence tag')
assert.ok(!BODY_3_PATCHED.includes(`/blob/${planBranchFor(3)}/`), 'fixture: the expected body carries no branch blob path')
assert.ok(!BODY_3_PATCHED.includes(`/tree/${evidenceBranchFor(3)}/`), 'fixture: the expected body carries no branch tree path')
assert.ok(BODY_3_PATCHED.includes(`the branch ${evidenceBranchFor(3)} is transient`), 'fixture: the bare mention is not a link and is left alone')
assert.ok(!BODY_12.includes(`/blob/${planBranchFor(12)}/`) && !BODY_12.includes(`/tree/${evidenceBranchFor(12)}/`), 'fixture: BODY_12 carries neither path')

// ── The stdout capture (M7) ─────────────────────────────────────────────────

/** The chunks of the call being captured right now, so a seam rule can ask what
 *  had already been printed when it was reached. */
let sink = null
const stdoutSoFar = () => (sink === null ? '' : sink.join(''))

/**
 * Run `body` with `process.stdout.write` captured, and answer what it printed
 * together with what it resolved. The lines every leg grades come from here —
 * `result.lines` is never consulted, so a tool that only returned its lines
 * fails rather than passes. `process.exitCode` is reset around the call, and
 * the value it held afterwards is reported as `exitCode` (M4).
 */
async function captured (body) {
  const chunks = []
  const real = process.stdout.write.bind(process.stdout)
  const previousSink = sink
  sink = chunks
  process.stdout.write = (chunk, encoding, cb) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
    const done = typeof encoding === 'function' ? encoding : cb
    if (typeof done === 'function') done()
    return true
  }
  process.exitCode = 0
  let result
  try {
    result = await body()
  } finally {
    process.stdout.write = real
    sink = previousSink
  }
  const exitCode = process.exitCode
  process.exitCode = 0

  const text = chunks.join('')
  assert.notEqual(text.trim(), '',
    'M7 the lines are written to process.stdout as the run is decided — nothing was captured')
  const lines = text.split('\n').map((l) => l.trimEnd()).filter((l) => l !== '')
  return { result, exitCode, text, lines, runLines: lines.filter((l) => /^run [0-9]+:/.test(l)) }
}

/** The one line for run N, and the proof there is exactly one (M7). */
const runLine = (out, run) => {
  const found = out.runLines.filter((l) => l.startsWith(`run ${run}:`))
  assert.equal(found.length, 1,
    `M7 exactly one line per run number, each beginning \`run N:\`; for run ${run} got ${JSON.stringify(out.runLines)}`)
  return found[0]
}

// ── The seam ────────────────────────────────────────────────────────────────

/** M3: the tag listing the verify read answers, per run and per variant. */
const tagListing = (run, { omitEvidence = false, movedEvidence = false } = {}) => {
  const lines = [`${HEAD[run].plan}\trefs/tags/${planTagFor(run)}`]
  if (!omitEvidence) {
    lines.push(`${movedEvidence ? OTHER_SHA : HEAD[run].evidence}\trefs/tags/${evidenceTagFor(run)}`)
  }
  return lines.map((l) => `${l}\n`).join('')
}

/** The run a tag-verify read names, off the refs it asks for. */
const runOfTagRead = (argv) => {
  for (const arg of argv) {
    const match = /^refs\/tags\/ultra\/(?:plan|evidence)\/run-([1-9][0-9]*)$/.exec(String(arg))
    if (match) return Number(match[1])
  }
  return null
}

/** The run a `…/pulls?…head=<owner>:ultra/integration-run-<N>` read names. */
const runOfPullsRead = (argv) => {
  const match = /ultra\/integration-run-([1-9][0-9]*)/.exec(String(argv[1] ?? ''))
  return match ? Number(match[1]) : null
}

/**
 * #724 Task 1 [M1]: the row that decides, worked out HERE and never by the tool
 * — the row with the highest `number` among the ones the fate read answered.
 */
const decidingRow = (rows) => {
  let best = null
  for (const row of rows ?? []) if (best === null || row.number > best.number) best = row
  return best
}

/** #724 Task 1 [M1]: that row is closed and not merged — the one deletable case. */
const isDeletable = (rows) => {
  const row = decidingRow(rows)
  return row !== null && row.state === 'closed' && row.merged_at === null
}

/**
 * The recording seam of leg (b): the one heads-and-tags listing, the per-run tag
 * verify, the refs POST, the closed-PR read, the PATCH and the DELETE. Nothing
 * runs for real (`passthrough: []`), so no `git` and no `gh` is started here.
 *
 * `listing` is the heads-and-tags answer, so the `#724 Task 1` legs can bring
 * their own without touching `HEADS_LISTING`; `fates` is the `state=all` read's
 * answer per run, and a seam given none answers no rows — the two `/pulls?`
 * rules are told apart by `state=all` against `state=closed`, since a run with a
 * pair AND an integration branch receives both reads.
 */
function makeSeam ({
  tagVariant = {},
  postAnswer = null,
  pulls = PULLS,
  listing = HEADS_LISTING,
  fates = null
} = {}) {
  const snapshots = {}
  const rules = [
    {
      when: (c, argv) => c === 'git' && argv[0] === 'ls-remote' && argv.includes(HEADS_GLOB),
      answer: answer(listing)
    },
    {
      when: (c, argv) => c === 'git' && argv[0] === 'ls-remote' && argv.includes('--tags'),
      answer: (c, argv) => {
        const run = runOfTagRead(argv)
        return answer(run === null ? '' : tagListing(run, run === 3 ? tagVariant : {}))
      }
    },
    {
      when: (c, argv) => c === 'gh' && argv.includes('POST'),
      answer: (c, argv) => {
        // (h)/M7: what had been printed when the run-12 sweep started.
        if (argv.includes(`ref=refs/tags/${planTagFor(12)}`)) snapshots.beforeRun12Post = stdoutSoFar()
        return postAnswer === null ? answer({ ref: 'created' }) : postAnswer(c, argv)
      }
    },
    {
      // #724 Task 1 [M1]: the fate read — `state=all`, answered with the run's rows.
      when: (c, argv) =>
        c === 'gh' && argv[0] === 'api' &&
        /\/pulls\?/.test(String(argv[1] ?? '')) && String(argv[1]).includes('state=all'),
      answer: (c, argv) => {
        const run = runOfPullsRead(argv)
        return answer((fates ?? {})[run] ?? [])
      }
    },
    {
      when: (c, argv) => c === 'gh' && argv[0] === 'api' && /\/pulls\?/.test(String(argv[1] ?? '')),
      answer: (c, argv) => {
        const run = runOfPullsRead(argv)
        return answer(run === null ? [] : (pulls[run] ?? []))
      }
    },
    { when: (c, argv) => c === 'gh' && argv.includes('PATCH'), answer: answer({ number: 0 }) },
    { when: (c, argv) => c === 'gh' && argv.includes('DELETE'), answer: answer('') }
  ]
  const exec = makeExec({ rules, passthrough: [] })
  exec.snapshots = snapshots
  exec.listing = listing
  exec.fates = fates ?? {}
  // #724 Task 1 [M1, M5]: the runs whose deciding row is closed and unmerged —
  // the only runs an integration DELETE may name in this seam.
  exec.deletable = Object.keys(exec.fates)
    .map(Number)
    .filter((run) => isDeletable(exec.fates[run]))
    .sort((a, b) => a - b)
  return exec
}

/** M3: a POST that answers "the reference already exists" — not a failure. */
const EXISTS = answer('', { code: 1, stderr: 'gh: Reference already exists (HTTP 422)' })

const lines = (exec) => exec.calls.map((c) => c.line)
const linesOf = (exec, predicate) => lines(exec).filter(predicate)
/** Every call naming run N — `ultra/plan-run-N`, `ultra/plan/run-N`, either. */
const namesRun = (line, run) => new RegExp(`run[-/]${run}(?![0-9])`).test(line)

/** Every seam this exam builds, checked once at the end (M7). */
const SEAMS = []
const seam = (options) => {
  const exec = makeSeam(options)
  SEAMS.push(exec)
  return exec
}

// ── (a) M1: the two refusals, before any command ────────────────────────────

for (const [what, argv] of [
  ['no --target', []],
  ['a --target isSafeTarget rejects', ['--target', 'bad name']]
]) {
  const exec = seam()
  const error = await retire({ argv, exec }).then(() => null, (e) => e)
  assert.ok(error instanceof Refusal,
    `(a)/M1 ${what}: retire refuses with a Refusal; got ${error === null ? 'no rejection' : `${error.name}: ${error.message}`}`)
  assert.equal(error.exitCode, 2, `(a)/M1 ${what}: the refusal's exitCode is 2`)
  assert.deepEqual(exec.calls, [],
    `(a)/M1 ${what}: the refusal makes no gh call and no git call; got ${JSON.stringify(lines(exec))}`)
}

// ── (b) M2, M7: one listing, ascending candidates, the lone half skipped ────

const healthy = seam()
const base = await captured(() => retire({ argv: ['--target', TARGET], exec: healthy }))

assert.equal(healthy.calls[0]?.line, LIST_LINE,
  `(b)/M2 the first call is exactly the one heads-and-tags listing; got ${JSON.stringify(healthy.calls[0]?.line)}`)
assert.deepEqual(linesOf(healthy, (l) => l.includes(HEADS_GLOB)), [LIST_LINE],
  '(b)/M2 the heads are listed exactly once — a tool that lists them again per run fails')

assert.deepEqual(base.runLines.map((l) => l.slice(0, l.indexOf(':') + 1)), ['run 3:', 'run 5:', 'run 12:'],
  `(b)/M2, M7 one line per run number in ascending N, the highest last; got ${JSON.stringify(base.runLines)}`)
assert.ok(runLine(base, 5).includes('skip'),
  `(b)/M2 the lone half of a pair is skipped; got ${JSON.stringify(runLine(base, 5))}`)
assert.deepEqual(linesOf(healthy, (l) => l.startsWith('gh ') && namesRun(l, 5)), [],
  '(b)/M2 a lone branch is neither tagged nor deleted: no gh call names run 5')

// ── (c) M3: the ordered sweep of a candidate ────────────────────────────────

const sweepOf = (exec, run) =>
  linesOf(exec, (l) => namesRun(l, run) && !l.includes('/pulls'))

assert.deepEqual(sweepOf(healthy, 3), sweepLines(3),
  '(c)/M3 run 3: the two tag POSTs, then the ls-remote --tags verify, then the two branch DELETEs, in that order')
assert.deepEqual(sweepOf(healthy, 12), sweepLines(12),
  '(c)/M3 run 12: the same ordered sweep')
assert.ok(runLine(base, 3).includes('retired') && runLine(base, 12).includes('retired'),
  `(c)/M3 a swept run's line says it was retired; got ${JSON.stringify([runLine(base, 3), runLine(base, 12)])}`)
assert.ok(
  runLine(base, 12).includes(planTagFor(12)) &&
  runLine(base, 12).includes(evidenceTagFor(12)) &&
  runLine(base, 12).includes(abbrev(HEAD[12].plan)) &&
  runLine(base, 12).includes(abbrev(HEAD[12].evidence)),
  `(c)/M3 the retired line names both tags at their heads; got ${JSON.stringify(runLine(base, 12))}`)
assert.deepEqual(base.result.retired, [3, 12], '(c)/M3 both candidates are retired')
assert.deepEqual(base.result.kept, [], '(c)/M3 nothing is kept when both tags verify')
assert.equal(Array.isArray(base.result.skipped) && base.result.skipped.length, 1,
  `(c)/M2 the lone half is the one skipped entry; got ${JSON.stringify(base.result.skipped)}`)
assert.ok(/(^|\D)5(\D|$)/.test(base.result.skipped.join(' ')),
  `(c)/M2 the skipped entry names run 5; got ${JSON.stringify(base.result.skipped)}`)

// M3: an already-existing reference is an answer, not a failure.
{
  const exec = seam({ postAnswer: () => EXISTS })
  const out = await captured(() => retire({ argv: ['--target', TARGET], exec }))
  assert.deepEqual(sweepOf(exec, 3), sweepLines(3),
    '(c)/M3 a POST answering exit 1 with `Reference already exists` still reaches the DELETEs')
  assert.ok(runLine(out, 3).includes('retired'),
    `(c)/M3 and the run is retired; got ${JSON.stringify(runLine(out, 3))}`)
}

// ── (d) M4: a tag that does not verify keeps its run and does not stop the sweep

for (const [what, tagVariant] of [
  ['a listing that omits the evidence tag', { omitEvidence: true }],
  ['a listing showing the evidence tag at another sha', { movedEvidence: true }]
]) {
  const exec = seam({ tagVariant })
  const out = await captured(() => retire({ argv: ['--target', TARGET], exec }))

  assert.deepEqual(linesOf(exec, (l) => l.includes('DELETE') && namesRun(l, 3)), [],
    `(d)/M4 ${what}: no DELETE is issued for run 3`)
  assert.ok(runLine(out, 3).includes('kept'),
    `(d)/M4 ${what}: run 3's line says it was kept; got ${JSON.stringify(runLine(out, 3))}`)
  assert.deepEqual(sweepOf(exec, 12), sweepLines(12),
    `(d)/M4 ${what}: the sweep continues — run 12's POSTs, listing and both DELETEs are still issued`)
  assert.ok(runLine(out, 12).includes('retired'),
    `(d)/M4 ${what}: run 12 is retired after the kept run`)
  assert.ok(out.lines.indexOf(runLine(out, 3)) < out.lines.indexOf(runLine(out, 12)),
    `(d)/M4 ${what}: the kept line comes before the later run's line`)
  assert.deepEqual(out.result.kept, [3], `(d)/M4 ${what}: the resolved kept is [3]`)
  assert.deepEqual(out.result.retired, [12], `(d)/M4 ${what}: the resolved retired is [12]`)
  assert.equal(out.exitCode, 1, `(d)/M4 ${what}: process.exitCode is 1 when any run was kept`)
}

assert.notEqual(base.exitCode, 1,
  '(d)/M4 where nothing is kept, process.exitCode is not set to 1')

// The BASE pin "no command names refs/heads/ultra/integration-run-N at all" is
// re-scoped by #724 Task 1 and now lives at the end of this file, where it can
// see every seam — including the ones the task listing builds.

// ── (e) M5: the closed-PR read, and the body rewrite ────────────────────────

assert.deepEqual(linesOf(healthy, (l) => l.includes('/pulls?')), [pullsLine(3), pullsLine(12)],
  '(e)/M5 one closed-PR read per candidate, by the integration head ref')

const patches = healthy.calls.filter((c) => c.cmd === 'gh' && c.argv.includes('PATCH'))
assert.equal(patches.length, 1,
  `(e)(f)/M5 exactly one PR is patched — the one whose body links the branches; got ${JSON.stringify(patches.map((c) => c.line))}`)
assert.deepEqual(patches[0].argv,
  ['api', '-X', 'PATCH', `repos/${TARGET}/pulls/${PR_3}`, '-f', `body=${BODY_3_PATCHED}`],
  '(e)/M5 the PATCH rewrites `/blob/ultra/plan-run-3/` and `/tree/ultra/evidence-run-3/` to the tag paths and changes nothing else')

// ── (f) M5: a PR body carrying neither path is not patched ──────────────────

assert.deepEqual(linesOf(healthy, (l) => l.includes(`pulls/${PR_12}`)), [],
  '(f)/M5 a PR whose body carries neither branch path is not patched')

// ── (g) M6: --dry-run says what it would do and does nothing ────────────────

for (const argv of [['--target', TARGET, '--dry-run'], ['--dry-run', '--target', TARGET]]) {
  const exec = seam()
  const out = await captured(() => retire({ argv, exec }))
  const spelling = JSON.stringify(argv)

  assert.deepEqual(lines(exec), [LIST_LINE, pullsLine(3), pullsLine(12)],
    `(g)/M6 ${spelling}: the calls through the seam are exactly the one listing and one pulls read per candidate`)
  assert.deepEqual(linesOf(exec, (l) => l.includes(' -X ')), [],
    `(g)/M6 ${spelling}: no gh api call carries -X`)
  assert.deepEqual(linesOf(exec, (l) => l.startsWith('git ') && l !== LIST_LINE), [],
    `(g)/M6 ${spelling}: no git call but the listing is made — no push, no second ls-remote`)
  assert.deepEqual(linesOf(exec, (l) => l.includes('--delete')), [],
    `(g)/M6 ${spelling}: nothing is deleted through any command`)
  assert.ok(runLine(out, 3).includes('would') && runLine(out, 12).includes('would'),
    `(g)/M6 ${spelling}: every candidate's line says what it would do; got ${JSON.stringify(out.runLines)}`)
  assert.ok(runLine(out, 5).includes('skip'),
    `(g)/M2 ${spelling}: the lone half is still skipped under --dry-run`)
  assert.notEqual(out.exitCode, 1,
    `(g)/M6 ${spelling}: a dry run keeps nothing, so it does not set process.exitCode to 1`)
}
// M1: `--dry-run` is valueless — had it swallowed the next element, the
// `['--dry-run', '--target', …]` spelling above would have refused.

// ── (h) M7: the lines reach stdout as each run is decided ───────────────────

assert.ok(String(healthy.snapshots.beforeRun12Post ?? '').includes('run 3:'),
  `(h)/M7 run 3's line is on stdout before the run-12 POST is issued — a tool that buffers every line until it returns fails; captured so far: ${JSON.stringify(healthy.snapshots.beforeRun12Post ?? null)}`)

// ═══════════════════════════════════════════════════════════════════════════
// #724 Task 1 — the sweep deletes the closed-unmerged integration branch
//
// The rule both tools carry, verbatim: the pull request with the highest
// `number` among the rows of
// `gh api repos/<t>/pulls?state=all&head=<owner>:ultra/integration-run-<N>`
// decides; `state` "open" keeps the branch; `state` "closed" with `merged_at`
// null retires it; `merged_at` a string keeps it; no rows keeps it; the rows'
// order is not the rule.
//
// Everything below runs over the TASK LISTING these legs build themselves —
// runs 7, 9, 32, 40, 41 and 42, and no run of the fixture above, so every BASE
// leg keeps grading the listing it was written for.
// ═══════════════════════════════════════════════════════════════════════════

/** #724 Task 1: the integration head's sha, per run. */
const integrationSha = (run) => sha(`c${run}`)

/** #724 Task 1 [M4]: the task listing, again deliberately out of order.
 *   run 7  — a plan-and-evidence pair AND an integration branch
 *   run 9  — a lone `ultra/plan-run-9` AND an integration branch
 *   runs 32, 40, 41, 42 — an integration branch and nothing else */
const TASK_LISTING = [
  `${integrationSha(40)}\trefs/heads/${integrationBranchFor(40)}`,
  `${HEAD[9].plan}\trefs/heads/${planBranchFor(9)}`,
  `${integrationSha(9)}\trefs/heads/${integrationBranchFor(9)}`,
  `${integrationSha(42)}\trefs/heads/${integrationBranchFor(42)}`,
  `${HEAD[7].plan}\trefs/heads/${planBranchFor(7)}`,
  `${integrationSha(32)}\trefs/heads/${integrationBranchFor(32)}`,
  `${HEAD[7].evidence}\trefs/heads/${evidenceBranchFor(7)}`,
  `${integrationSha(7)}\trefs/heads/${integrationBranchFor(7)}`,
  `${integrationSha(41)}\trefs/heads/${integrationBranchFor(41)}`
].map((line) => `${line}\n`).join('')

/** #724 Task 1 [M4]: run 7's PR body links neither transient branch, so BASE's
 *  rewrite has nothing to patch and its pair line reads `0 PR(s) patched`. */
const BODY_7 = 'run 7 — the work landed; this body links no branch path at all.'
assert.ok(!BODY_7.includes(`/blob/${planBranchFor(7)}/`) && !BODY_7.includes(`/tree/${evidenceBranchFor(7)}/`),
  'fixture: BODY_7 carries neither branch path, so run 7 patches 0 PRs')

/** #724 Task 1 [M1, M2]: what each run's fate read answers. The list endpoint's
 *  rows carry `merged_at` and no `merged` boolean — `merged` is the single-PR
 *  endpoint's field, and this tool does not read that endpoint. */
const TASK_FATES = {
  // (f)/M4: one closed, unmerged row — run 7's integration branch is deleted.
  7: [{ number: 300, state: 'closed', merged_at: null, body: BODY_7 }],
  // (f)/M4: open — run 9's integration branch stays beside its lone pair half.
  9: [{ number: 310, state: 'open', merged_at: null }],
  // (a)/M1: two runs on one head name — the older merged, the newer closed and
  // unmerged. The highest number decides, whichever order the rows arrive in.
  32: [
    { number: 463, state: 'closed', merged_at: '2026-08-31T03:03:48Z' },
    { number: 720, state: 'closed', merged_at: null }
  ],
  // (b)/M2: the deciding row is open — an older closed-unmerged row is not the rule.
  40: [
    { number: 800, state: 'open', merged_at: null },
    { number: 790, state: 'closed', merged_at: null }
  ],
  // (c)/M2: the deciding row's `merged_at` is a string — delete-on-merge's, not the sweep's.
  41: [
    { number: 810, state: 'closed', merged_at: '2026-09-07T01:29:38Z' },
    { number: 805, state: 'closed', merged_at: null }
  ],
  // (d)/M2: no rows at all.
  42: []
}

/** #724 Task 1 [M1]: the same rows, arriving in the other order. */
const REVERSED_FATES = Object.fromEntries(
  Object.entries(TASK_FATES).map(([run, rows]) => [run, [...rows].reverse()])
)

// Fixture self-check: the two orders are the same rows, and the deciding row is
// the same in both — the exam's own rule, not the tool's.
for (const run of [7, 9, 32, 40, 41, 42]) {
  assert.equal(decidingRow(TASK_FATES[run])?.number ?? null, decidingRow(REVERSED_FATES[run])?.number ?? null,
    `fixture: run ${run}'s deciding row does not depend on the order the rows arrive in`)
}
assert.equal(decidingRow(TASK_FATES[32]).number, 720, 'fixture: run 32 is decided by PR #720, not #463')

/** #724 Task 1 [M4]: run 7 is the only run of the task listing with a pair, so
 *  it is the only one whose BASE `state=closed` read has anything to answer. */
const TASK_PULLS = { 7: [{ number: 300, body: BODY_7 }] }

/** #724 Task 1 [M1]: the one fate read of a run — `state=all`, by the head ref. */
const fateLine = (run) =>
  `gh api repos/${TARGET}/pulls?state=all&head=${OWNER}:${integrationBranchFor(run)}`

/** #724 Task 1 [M1]: the one DELETE a retired integration branch earns. */
const integrationDeleteLine = (run) =>
  `gh api -X DELETE repos/${TARGET}/git/refs/heads/${integrationBranchFor(run)}`

// #724 Task 1 [M1, M2, M3]: the five line segments, verbatim.
const deletedSegment = (run, k) => `${integrationBranchFor(run)} deleted — PR #${k} closed, not merged`
const wouldDeleteSegment = (run, k) => `would delete ${integrationBranchFor(run)} — PR #${k} closed, not merged`
const openSegment = (run, k) => `${integrationBranchFor(run)} stays — PR #${k} open`
const mergedSegment = (run, k) => `${integrationBranchFor(run)} stays — PR #${k} merged`
const noPullRequestSegment = (run) => `${integrationBranchFor(run)} stays — no pull request`

/** #724 Task 1 [M4]: BASE's pair line for a retired run, unchanged. */
const retiredPairLine = (run, patched = 0) =>
  `retired ${planTagFor(run)}@${abbrev(HEAD[run].plan)} ` +
  `${evidenceTagFor(run)}@${abbrev(HEAD[run].evidence)}, 2 branches deleted, ` +
  `${patched} PR(s) patched`

/** #724 Task 1 [M3, M4]: BASE's pair line for a dry run, unchanged. */
const wouldRetirePairLine = (run, patched = 0) =>
  `would retire ${planTagFor(run)}@${abbrev(HEAD[run].plan)} ` +
  `${evidenceTagFor(run)}@${abbrev(HEAD[run].evidence)}, delete 2 branches, ` +
  `patch ${patched} PR(s)`

/** #724 Task 1 [M5]: the runs an integration DELETE named, in this seam. */
const INTEGRATION_DELETE_RE = /refs\/heads\/ultra\/integration-run-([1-9][0-9]*)/
const integrationDeletesOf = (exec) =>
  linesOf(exec, (l) => l.includes('DELETE') && INTEGRATION_DELETE_RE.test(l))
    .map((l) => Number(INTEGRATION_DELETE_RE.exec(l)[1]))
    .sort((a, b) => a - b)

const taskSeam = (fates) => seam({ listing: TASK_LISTING, fates, pulls: TASK_PULLS })

const sweeps = []
for (const [order, fates] of [['rows oldest first', TASK_FATES], ['rows newest first', REVERSED_FATES]]) {
  const exec = taskSeam(fates)
  const out = await captured(() => retire({ argv: ['--target', TARGET], exec }))
  sweeps.push({ order, exec, out })
}

for (const { order, exec, out } of sweeps) {
  // M2, M4: every run of the task listing prints exactly one line, ascending N.
  assert.deepEqual(out.runLines.map((l) => l.slice(0, l.indexOf(':') + 1)),
    ['run 7:', 'run 9:', 'run 32:', 'run 40:', 'run 41:', 'run 42:'],
    `#724 Task 1 (a)-(f)/M4 ${order}: one line per run of the task listing, ascending N; got ${JSON.stringify(out.runLines)}`)

  // ── (a)/M1: the deciding row is the highest number, and it earns the DELETE ─

  assert.equal(runLine(out, 32), `run 32: ${deletedSegment(32, 720)}`,
    `#724 Task 1 (a)/M1 ${order}: a run whose listing holds only the integration branch, whose highest-numbered row is closed with merged_at null, prints exactly that segment — a tool that takes the first row, or names #463, fails one of the two orders`)
  assert.deepEqual(linesOf(exec, (l) => namesRun(l, 32)), [fateLine(32), integrationDeleteLine(32)],
    `#724 Task 1 (a)/M1 ${order}: run 32 draws exactly one fate read and exactly one DELETE of its integration ref, and no other command`)

  // ── (b)(c)(d)/M2: the three that stay, each read once, none deleted ────────

  for (const [leg, run, segment, k] of [
    ['(b)', 40, openSegment(40, 800), 800],
    ['(c)', 41, mergedSegment(41, 810), 810],
    ['(d)', 42, noPullRequestSegment(42), null]
  ]) {
    assert.equal(runLine(out, run), `run ${run}: ${segment}`,
      `#724 Task 1 ${leg}/M2 ${order}: run ${run}'s line is exactly that segment${k === null ? '' : ` — PR #${k} is the deciding row`}`)
    assert.deepEqual(linesOf(exec, (l) => namesRun(l, run)), [fateLine(run)],
      `#724 Task 1 ${leg}/M2 ${order}: run ${run} draws its fate read exactly once and nothing else — no DELETE names it, even when an older row is closed and unmerged`)
  }

  // ── (f)/M4: the pair sweep is BASE's, and the integration DELETE is last ───

  assert.deepEqual(linesOf(exec, (l) => namesRun(l, 7)), [
    ...sweepLines(7),
    pullsLine(7),
    fateLine(7),
    integrationDeleteLine(7)
  ], `#724 Task 1 (f)/M4 ${order}: run 7 issues the pair's five commands in BASE's order, then its state=closed read, then the fate read, with the integration DELETE last`)
  assert.equal(runLine(out, 7), `run 7: ${retiredPairLine(7)}; ${deletedSegment(7, 300)}`,
    `#724 Task 1 (f)/M4 ${order}: run 7's line is BASE's pair line, then \`; \`, then the integration segment`)

  assert.equal(runLine(out, 9), `run 9: skip — lone ${planBranchFor(9)}; ${openSegment(9, 310)}`,
    `#724 Task 1 (f)/M4 ${order}: a lone pair half beside an integration branch — the \`lone\` names the pair half only, then \`; \`, then the integration segment`)
  assert.deepEqual(linesOf(exec, (l) => namesRun(l, 9)), [fateLine(9)],
    `#724 Task 1 (f)/M4 ${order}: no call naming run 9 carries DELETE or POST — its fate read is the only one`)

  // ── (g)/M5: no integration outcome reaches an array or the exit code ───────

  assert.deepEqual(out.result.kept, [],
    `#724 Task 1 (g)/M5 ${order}: a \`stays\` is not a \`kept\` — kept keeps its pair meaning and is empty here`)
  assert.deepEqual(out.result.retired, [7],
    `#724 Task 1 (g)/M5 ${order}: \`retired\` is the pair-tag record — only run 7 had a pair to retire`)
  assert.deepEqual(out.result.skipped, [planBranchFor(9)],
    `#724 Task 1 (g)/M5 ${order}: \`skipped\` names pair halves only — an integration-branch-only run is not a skip; got ${JSON.stringify(out.result.skipped)}`)
  assert.notEqual(out.exitCode, 1,
    `#724 Task 1 (g)/M5 ${order}: no integration-branch outcome sets process.exitCode to 1`)
  assert.deepEqual(Object.keys(out.result).sort(),
    ['dryRun', 'kept', 'lines', 'retired', 'skipped', 'target'],
    `#724 Task 1 (g)/M5 ${order}: the line and the seam are the whole record of the integration branch — the resolved value gains no key; got ${JSON.stringify(Object.keys(out.result).sort())}`)

  assert.deepEqual(integrationDeletesOf(exec), [7, 32],
    `#724 Task 1 (g)/M5 ${order}: over the task listing a DELETE names refs/heads/ultra/integration-run-<N> for runs 7 and 32 and for no other run`)
}

// ── (e)/M3: --dry-run over the task listing ─────────────────────────────────

{
  const exec = taskSeam(TASK_FATES)
  const out = await captured(() => retire({ argv: ['--target', TARGET, '--dry-run'], exec }))

  assert.deepEqual(lines(exec), [
    LIST_LINE,
    pullsLine(7),
    fateLine(7),
    fateLine(9),
    fateLine(32),
    fateLine(40),
    fateLine(41),
    fateLine(42)
  ], '#724 Task 1 (e)/M3 --dry-run: the calls through the seam are exactly the one heads-and-tags listing, run 7\'s state=closed read, and one state=all read for each of runs 7, 9, 32, 40, 41 and 42')
  assert.deepEqual(linesOf(exec, (l) => l.includes(' -X ')), [],
    '#724 Task 1 (e)/M3 --dry-run: no command carries -X')
  assert.deepEqual(integrationDeletesOf(exec), [],
    '#724 Task 1 (e)/M3 --dry-run: nothing is deleted, the deletable run included')

  assert.equal(runLine(out, 32), `run 32: ${wouldDeleteSegment(32, 720)}`,
    '#724 Task 1 (e)/M3 --dry-run: the deletable case says what it would delete, and names the deciding PR')
  assert.ok(runLine(out, 7).endsWith(`; ${wouldDeleteSegment(7, 300)}`),
    `#724 Task 1 (e)/M3 --dry-run: run 7's line ends with \`; ${wouldDeleteSegment(7, 300)}\`; got ${JSON.stringify(runLine(out, 7))}`)
  assert.equal(runLine(out, 7), `run 7: ${wouldRetirePairLine(7)}; ${wouldDeleteSegment(7, 300)}`,
    '#724 Task 1 (e)/M3, M4 --dry-run: and the whole line is BASE\'s dry pair line, then `; `, then the integration segment')

  assert.equal(runLine(out, 40), `run 40: ${openSegment(40, 800)}`,
    '#724 Task 1 (e)/M3 --dry-run: the `stays` segments read exactly as they do without the flag (open)')
  assert.equal(runLine(out, 41), `run 41: ${mergedSegment(41, 810)}`,
    '#724 Task 1 (e)/M3 --dry-run: the `stays` segments read exactly as they do without the flag (merged)')
  assert.equal(runLine(out, 42), `run 42: ${noPullRequestSegment(42)}`,
    '#724 Task 1 (e)/M3 --dry-run: the `stays` segments read exactly as they do without the flag (no rows)')
  assert.equal(runLine(out, 9), `run 9: skip — lone ${planBranchFor(9)}; ${openSegment(9, 310)}`,
    '#724 Task 1 (e)/M3 --dry-run: the lone pair half is still skipped, and its integration branch still decided')

  assert.notEqual(out.exitCode, 1,
    '#724 Task 1 (e)/M3 --dry-run: process.exitCode is not 1')
}

// ── (h)/M6: the two documents ───────────────────────────────────────────────
//
// The Proof's three `Run:` commands grade these same documents from the
// outside; this reads them off disk so the suite carries M6 too.

{
  const PHRASE = 'closed and not merged'
  const readDoc = (name) => fs.readFileSync(path.join(FLEET_DIR, name), 'utf8')
  const squash = (text) => text.replace(/\s+/g, ' ')
  /** Does this text name the retire sweep as a mechanism? */
  const namesSweep = (text) => /retire\.mjs/.test(text) || /retire sweep/i.test(text)
  /** The `## ` sections of a document, by heading. */
  const sectionsOf = (text) => {
    const out = new Map()
    let title = ''
    let body = []
    for (const line of text.split('\n')) {
      const match = /^## +(.+?) *$/.exec(line)
      if (match) {
        out.set(title, body.join('\n'))
        title = match[1]
        body = []
      } else body.push(line)
    }
    out.set(title, body.join('\n'))
    return out
  }

  const contract = readDoc('CONTRACT.md')
  const runbook = readDoc('RUNBOOK.md')
  const carrying = (text) => text.split('\n').filter((l) => l.includes(PHRASE))

  const contractLines = carrying(contract)
  assert.ok(contractLines.length >= 1,
    `#724 Task 1 (h)/M6: fleet/CONTRACT.md's integration-branch bullet carries the phrase \`${PHRASE}\` — no line of it does`)
  for (const line of contractLines) {
    assert.ok(namesSweep(line),
      `#724 Task 1 (h)/M6: every fleet/CONTRACT.md line carrying \`${PHRASE}\` says such a branch is the retire sweep's to delete (it names \`retire.mjs\` or "retire sweep"); got ${JSON.stringify(line)}`)
  }

  const runbookLines = carrying(runbook)
  assert.ok(runbookLines.length >= 2,
    `#724 Task 1 (h)/M6: both of fleet/RUNBOOK.md's branch-lifecycle sentences carry the phrase \`${PHRASE}\` — found ${runbookLines.length} line(s) that do`)
  for (const line of runbookLines) {
    assert.ok(namesSweep(line),
      `#724 Task 1 (h)/M6: every fleet/RUNBOOK.md line carrying \`${PHRASE}\` says such a branch is the retire sweep's to delete (it names \`retire.mjs\` or "retire sweep"); got ${JSON.stringify(line)}`)
  }

  const runbookSections = sectionsOf(runbook)
  for (const heading of ['The shape', 'Rollback']) {
    const section = runbookSections.get(heading)
    assert.ok(typeof section === 'string',
      `#724 Task 1 (h)/M6: fleet/RUNBOOK.md still has a \`## ${heading}\` section, which is where one of the two branch-lifecycle sentences lives`)
    assert.ok(section.includes(PHRASE),
      `#724 Task 1 (h)/M6: fleet/RUNBOOK.md's \`## ${heading}\` section carries \`${PHRASE}\` — a rewrite that touches one sentence and leaves the other fails here`)
  }

  // M6: and no line of either document still gives the integration branch only
  // the two fates of BASE — the merge and the open PR.
  const CONTRACT_TWO_FATES =
    "It goes with the merge (delete-on-merge); a `hold=1` run's stays while its PR is open."
  const RUNBOOK_TWO_FATES =
    '`ultra/integration-run-<N>` goes with the merge, and stays only while a `--hold` PR is open.'
  assert.equal(squash(contract).includes(squash(CONTRACT_TWO_FATES)), false,
    `#724 Task 1 (h)/M6: fleet/CONTRACT.md no longer carries BASE's two-fate sentence ${JSON.stringify(CONTRACT_TWO_FATES)}`)
  assert.equal(squash(runbook).includes(squash(RUNBOOK_TWO_FATES)), false,
    `#724 Task 1 (h)/M6: fleet/RUNBOOK.md no longer carries BASE's two-fate sentence ${JSON.stringify(RUNBOOK_TWO_FATES)}`)
}

// ── Over every seam this exam built ─────────────────────────────────────────

for (const [i, exec] of SEAMS.entries()) {
  // (c)/M3, re-scoped by #724 Task 1 [M5]: a DELETE naming
  // `refs/heads/ultra/integration-run-<N>` appears only for a run whose fate
  // read answered a highest-numbered row that is closed and unmerged. Over the
  // BASE fixture's seams — which draw no fate read at all — it still finds none.
  for (const run of integrationDeletesOf(exec)) {
    assert.ok(exec.deletable.includes(run),
      `(c)/M3, #724 Task 1 (g)/M5 seam ${i}: a DELETE names refs/heads/ultra/integration-run-${run}, but this seam's fate read for run ${run} did not answer a highest-numbered row that is closed and unmerged (the deletable runs here are ${JSON.stringify(exec.deletable)})`)
  }

  if (exec.listing === HEADS_LISTING) {
    // (f)/M4: BASE's own listing carries no integration head, so it draws no
    // fate read and names no integration ref in any command.
    assert.deepEqual(linesOf(exec, (l) => l.includes('refs/heads/ultra/integration-run')), [],
      `(c)/M3 seam ${i}: over BASE's listing no command names refs/heads/ultra/integration-run-N at all`)
    assert.deepEqual(linesOf(exec, (l) => l.includes('state=all')), [],
      `#724 Task 1 (f)/M4 seam ${i}: a run with no integration branch draws no fate read — BASE's listing issues no state=all read`)
  }

  // M7: `git` and `gh` are reached only through the seam — nothing else is run.
  assert.deepEqual([...new Set(exec.calls.map((c) => c.cmd))].filter((c) => c !== 'git' && c !== 'gh'), [],
    `(h)/M7 seam ${i}: only git and gh are reached through the exec seam`)
}

// ── (i) M1, M6, M7: the script as a process, against PATH shims ─────────────

const cliRoot = tempDir('retire-cli-')

/** A PATH directory whose `git` and `gh` log their arguments and answer. */
function shimDir (name, { git, gh }) {
  const dir = fs.mkdtempSync(path.join(cliRoot, `${name}-`))
  for (const [bin, body] of Object.entries({ git, gh })) {
    const p = path.join(dir, bin)
    fs.writeFileSync(p, body, { mode: 0o755 })
    fs.chmodSync(p, 0o755)
  }
  return dir
}

const logLines = (file) =>
  (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '').split('\n').filter((l) => l !== '')

const runProcess = (args, dir) => spawnSync(process.execPath, [RETIRE_SRC, ...args], {
  encoding: 'utf8',
  env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}` },
  timeout: 60000
})

/** A shim pair that logs and answers: git prints the two-line pair listing for
 *  run 3, gh prints an empty PR array. */
const loggingShims = (name) => {
  const dir = shimDir(name, { git: '', gh: '' })
  const gitLog = path.join(dir, 'git.log')
  const ghLog = path.join(dir, 'gh.log')
  const listing =
    `${HEAD[3].plan}\\trefs/heads/${planBranchFor(3)}\\n${HEAD[3].evidence}\\trefs/heads/${evidenceBranchFor(3)}\\n`
  fs.writeFileSync(path.join(dir, 'git'),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${gitLog}"\nprintf '${listing}'\nexit 0\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(dir, 'gh'),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${ghLog}"\nprintf '[]\\n'\nexit 0\n`, { mode: 0o755 })
  fs.chmodSync(path.join(dir, 'git'), 0o755)
  fs.chmodSync(path.join(dir, 'gh'), 0o755)
  return { dir, gitLog, ghLog }
}

{
  const { dir, gitLog, ghLog } = loggingShims('dry')
  const res = runProcess(['--target', TARGET, '--dry-run'], dir)
  assert.equal(res.status, 0,
    `(i)/M6 a dry run exits 0; stdout: ${res.stdout} stderr: ${res.stderr}`)
  assert.ok(res.stdout.split('\n').some((l) => l.startsWith('run 3: would')),
    `(i)/M7 the lines are printed on the process's stdout; got ${JSON.stringify(res.stdout)}`)

  const gitLogged = logLines(gitLog)
  const ghLogged = logLines(ghLog)
  assert.equal(gitLogged.length, 1,
    `(i)/M6 the real exec reaches git on PATH exactly once; got ${JSON.stringify(gitLogged)}`)
  assert.ok(gitLogged[0].includes('ls-remote'), `(i)/M6 and that call is the listing; got ${gitLogged[0]}`)
  assert.equal(ghLogged.length, 1,
    `(i)/M6 the real exec reaches gh on PATH exactly once; got ${JSON.stringify(ghLogged)}`)
  assert.ok(ghLogged[0].includes(`api repos/${TARGET}/pulls`),
    `(i)/M6 and that call is the closed-PR read; got ${ghLogged[0]}`)
  for (const line of [...gitLogged, ...ghLogged]) {
    assert.ok(!line.includes('-X') && !line.includes('--delete'),
      `(i)/M6 a dry run creates and deletes nothing through any command; got ${line}`)
  }
}

{
  const { dir, ghLog } = loggingShims('live')
  const res = runProcess(['--target', TARGET], dir)
  const ghLogged = logLines(ghLog)
  assert.equal(ghLogged[0], `api -X POST repos/${TARGET}/git/refs -f ref=refs/tags/${planTagFor(3)} -f sha=${HEAD[3].plan}`,
    `(i)/M1, M7 the script's entry calls retire with the real exec: the first gh call is the plan tag POST; stdout: ${res.stdout} stderr: ${res.stderr} log: ${JSON.stringify(ghLogged)}`)
}

// M1 as a process: no `--target` exits 2, names it on stderr, starts nothing.
{
  const dir = shimDir('refuse', {
    git: '', gh: ''
  })
  const marker = path.join(dir, 'called')
  for (const bin of ['git', 'gh']) {
    fs.writeFileSync(path.join(dir, bin), `#!/bin/sh\ntouch "${marker}"\nexit 1\n`, { mode: 0o755 })
    fs.chmodSync(path.join(dir, bin), 0o755)
  }
  const res = runProcess([], dir)
  assert.equal(res.status, 2,
    `(a)/M1 run as a process with no --target, the script exits 2; stdout: ${res.stdout} stderr: ${res.stderr}`)
  assert.ok(res.stderr.includes('--target'),
    `(a)/M1 and names --target on stderr; got ${JSON.stringify(res.stderr)}`)
  assert.equal(fs.existsSync(marker), false,
    '(a)/M1 and starts no gh and no git')
}

cleanup(cliRoot)

console.log('ALL TESTS PASSED')

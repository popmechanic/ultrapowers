/**
 * fleet/tests/test_retire.mjs — the one-time sweep: every plan-and-evidence
 * branch pair on the target becomes the two tags, verified against the remote,
 * and only then are the branches deleted.
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
 *       already-existing reference is not a failure; no integration branch is
 *       ever named by a DELETE.
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
 * Below those, in its own region, `#706 — the status read gates the sweep`: the
 * pair's `.ultrapowers/runs/<N>/status.json` is read off the evidence branch
 * before anything is tagged, a run whose state is not terminal or whose
 * integration branch has an open pull request is skipped with its own line and
 * its own `live` row, and everything above still holds for the runs that are
 * swept. That region names its own Machine clauses.
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

import { Refusal, evidenceBranchFor, evidenceTagFor, planBranchFor, planTagFor } from '../lobby.mjs'
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

/** M2: the branch heads the one listing carries. Run 5 is a lone half. */
const HEAD = {
  3: { plan: sha('a3'), evidence: sha('e3') },
  5: { evidence: sha('e5') },
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

// ── #706 — the status read gates the sweep: the two new reads ───────────────

/** M1: the one status read of a pair, off the run's evidence BRANCH. */
const contentsLine = (run) =>
  `gh api repos/${TARGET}/contents/.ultrapowers/runs/${run}/status.json?ref=${evidenceBranchFor(run)}`

/** M4: the open-PR read of a terminal pair, by the same `head=` filter. */
const openPullsLine = (run) =>
  `gh api repos/${TARGET}/pulls?state=open&head=${OWNER}:ultra/integration-run-${run}`

/** M1: the contents envelope a status read is answered with — base64 under
 *  `content`, exactly as GitHub's contents API answers it. */
const envelope = (page) => answer({
  content: Buffer.from(JSON.stringify(page)).toString('base64'),
  sha: sha('b1a')
})

/** M2: the three live states the boot writes, and one word it never writes —
 *  `blocked` is here because the test is membership in `REAPABLE_STATES`, so a
 *  denylist of the live three would sweep it. */
const LIVE_PAGE_STATES = ['booting', 'running', 'publishing', 'blocked']

/** M1: the pages the seam serves by default — both pairs terminal. */
const TERMINAL_PAGES = { 3: { state: 'done' }, 12: { state: 'done' } }

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

/**
 * The recording seam of leg (b): the one heads-and-tags listing, the per-run tag
 * verify, the refs POST, the closed-PR read, the PATCH and the DELETE. Nothing
 * runs for real (`passthrough: []`), so no `git` and no `gh` is started here.
 */
function makeSeam ({
  tagVariant = {},
  postAnswer = null,
  pulls = PULLS,
  // #706: the status page each run's evidence branch carries, the raw answers
  // that override it (a `gh` that failed, a body that is not an envelope), and
  // the open pull requests the `state=open` read finds.
  pages = TERMINAL_PAGES,
  contents = {},
  openPulls = {}
} = {}) {
  const snapshots = {}
  const rules = [
    {
      when: (c, argv) => c === 'git' && argv[0] === 'ls-remote' && argv.includes(HEADS_GLOB),
      answer: answer(HEADS_LISTING)
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
      // #706/M1: the status read. An unanswered run is a `gh` exit 1 with
      // `HTTP 404` — the shape a missing file really has.
      when: (c, argv) => c === 'gh' && argv[0] === 'api' && /\/contents\//.test(String(argv[1] ?? '')),
      answer: (c, argv) => {
        const match = /\/runs\/([1-9][0-9]*)\/status\.json/.exec(String(argv[1]))
        const run = match === null ? null : Number(match[1])
        if (run !== null && Object.hasOwn(contents, run)) return contents[run]
        const page = run === null ? undefined : pages[run]
        return page === undefined || page === null
          ? answer('', { code: 1, stderr: 'gh: Not Found (HTTP 404)' })
          : envelope(page)
      }
    },
    {
      // #706/M4: `state=open` and `state=closed` are two different reads and
      // are answered from two different tables.
      when: (c, argv) => c === 'gh' && argv[0] === 'api' && /\/pulls\?/.test(String(argv[1] ?? '')),
      answer: (c, argv) => {
        const spec = String(argv[1])
        const match = /ultra\/integration-run-([1-9][0-9]*)/.exec(spec)
        const table = /state=open/.test(spec) ? openPulls : pulls
        return answer(match ? (table[Number(match[1])] ?? []) : [])
      }
    },
    { when: (c, argv) => c === 'gh' && argv.includes('PATCH'), answer: answer({ number: 0 }) },
    { when: (c, argv) => c === 'gh' && argv.includes('DELETE'), answer: answer('') }
  ]
  const exec = makeExec({ rules, passthrough: [] })
  exec.snapshots = snapshots
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

// #706: the status read names the run too (`?ref=ultra/evidence-run-N`), and it
// gates the sweep rather than being part of it — so it is filtered out here
// beside the pulls reads, and the ordered sweep below is what it always was.
const sweepOf = (exec, run) =>
  linesOf(exec, (l) => namesRun(l, run) && !l.includes('/pulls') && !l.includes('/contents/'))

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

// M3: no command ever names an integration branch as something to delete.
for (const [i, exec] of SEAMS.entries()) {
  assert.deepEqual(
    linesOf(exec, (l) => l.includes('ultra/integration-run') && l.includes('DELETE')), [],
    `(c)/M3 seam ${i}: no command names an integration branch together with DELETE`)
  assert.deepEqual(linesOf(exec, (l) => l.includes('refs/heads/ultra/integration-run')), [],
    `(c)/M3 seam ${i}: no command names refs/heads/ultra/integration-run-N at all`)
}

// ── (e) M5: the closed-PR read, and the body rewrite ────────────────────────

// #706 adds a second read of the same list (`state=open`, M4), so this pin is
// the CLOSED read only — its meaning is unchanged: one per swept candidate.
assert.deepEqual(linesOf(healthy, (l) => l.includes('/pulls?state=closed')), [pullsLine(3), pullsLine(12)],
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

  // #706/M5: the sequence is the listing, then per pair in ascending N the
  // status read, the open-PR read of a terminal page, and the closed-PR read
  // only where no PR is open.
  assert.deepEqual(lines(exec), [
    LIST_LINE,
    contentsLine(3), openPullsLine(3), pullsLine(3),
    contentsLine(12), openPullsLine(12), pullsLine(12)
  ],
  `(g)/M6, #706/M5 ${spelling}: the calls through the seam are exactly the one listing, then per candidate the status read, the open-PR read and the closed-PR read`)
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

// M7: `git` and `gh` are reached only through the seam — nothing else is run.
for (const [i, exec] of SEAMS.entries()) {
  assert.deepEqual([...new Set(exec.calls.map((c) => c.cmd))].filter((c) => c !== 'git' && c !== 'gh'), [],
    `(h)/M7 seam ${i}: only git and gh are reached through the exec seam`)
}

// ════════════════════════════════════════════════════════════════════════════
// #706 — the status read gates the sweep
//
// Every leg below names its Machine clause. The read is a GATE: it decides
// whether the sweep of clause M3 runs at all, and replaces no part of it.
//
//   (a) M1 — exactly one status read per pair, before that run's first POST,
//       and none at all for a lone half.
//   (b) M1 — the terminal states come from `REAPABLE_STATES` in janitor.mjs,
//       and are not retyped in retire.mjs.
//   (c) M2 — a live page skips the run with its own line, its own `live` row,
//       no other command, and no effect on the runs after it.
//   (d) M2 — a read that answers nothing readable is `no status page`.
//   (e)(f)(g) M3 — `done`, `parked` and `failed` are swept exactly as before.
//   (h)(i) M4 — a terminal pair with an open integration PR is skipped too;
//       an empty answer lets the sweep proceed.
//   (j) M5 — `--dry-run` prints the byte-identical skip lines and reads the
//       three lists in order, creating and deleting nothing.
//   (k) M6 — the same, as a process against PATH shims (below, beside the
//       other process legs).
//   (l) M7 — the contract's `**The two tags**` bullet and the runbook's
//       `## Rollback` section each say it, in the line's own words.
// ════════════════════════════════════════════════════════════════════════════

// ── (a) M1: one read per pair, before the tagging, none for a lone half ─────

for (const run of [3, 12]) {
  const reads = linesOf(healthy, (l) => namesRun(l, run) && l.includes('/contents/'))
  assert.deepEqual(reads, [contentsLine(run)],
    `(a)/M1 run ${run}: exactly one status read, off the run's evidence branch; got ${JSON.stringify(reads)}`)

  const all = lines(healthy)
  const readAt = all.indexOf(contentsLine(run))
  const firstPost = all.findIndex((l) => l.includes('-X POST') && namesRun(l, run))
  assert.ok(firstPost !== -1,
    `(a)/M1 run ${run}: the healthy pair is still tagged, so there is a POST to be after; got ${JSON.stringify(all)}`)
  assert.ok(readAt !== -1 && readAt < firstPost,
    `(a)/M1 run ${run}: the status read precedes the first command naming the run's tags or branches — a tool that reads the page after tagging fails; reads at ${readAt}, first POST at ${firstPost}`)
}

assert.deepEqual(linesOf(healthy, (l) => l.includes('/contents/') && namesRun(l, 5)), [],
  '(a)/M1 a lone half is not a pair: no status page is read for run 5')
assert.deepEqual(linesOf(healthy, (l) => l.includes('/contents/')), [contentsLine(3), contentsLine(12)],
  '(a)/M1 the whole sweep reads exactly one status page per pair, ascending')

// ── (b) M1: the terminal states are imported, never retyped ────────────────

const retireSource = fs.readFileSync(RETIRE_SRC, 'utf8')
assert.match(retireSource, /import\s*\{[^}]*\bREAPABLE_STATES\b[^}]*\}\s*from\s*'\.\/janitor\.mjs'/,
  "(b)/M1 fleet/retire.mjs imports REAPABLE_STATES from './janitor.mjs' — the one place the terminal states are spelled")
assert.doesNotMatch(retireSource, /['"]done['"]\s*,\s*['"]parked['"]\s*,\s*['"]failed['"]/,
  '(b)/M1 and retypes no `done, parked, failed` list of its own')

// ── (c) M2: a live page skips the run and the sweep goes on ────────────────

/** The exact line a live page prints, and the `live` row it resolves. */
const liveLine = (run, why) => `run ${run}: live (${why}) — skipped`

/** The skip lines captured here, quoted verbatim by leg (j). */
const captured706 = {}
/** The run-3-is-`running` seam, re-read by leg (i). */
let running3Seam = null

for (const state of LIVE_PAGE_STATES) {
  const exec = seam({ pages: { 3: { state }, 12: { state: 'done' } } })
  if (state === 'running') running3Seam = exec
  const out = await captured(() => retire({ argv: ['--target', TARGET], exec }))

  assert.equal(runLine(out, 3), liveLine(3, state),
    `(c)/M2 a page whose state is \`${state}\` prints exactly one line for the run, verbatim`)
  assert.deepEqual(linesOf(exec, (l) => namesRun(l, 3)), [contentsLine(3)],
    `(c)/M2 \`${state}\`: the only command naming run 3 is its status read — no POST, no --tags, no DELETE, no PATCH, no /pulls`)
  assert.deepEqual(out.result.live, [{ run: 3, why: state }],
    `(c)/M2 \`${state}\`: the resolved value carries the run under \`live\` as { run, why }; got ${JSON.stringify(out.result.live ?? null)}`)
  assert.deepEqual(out.result.retired, [12],
    `(c)/M2 \`${state}\`: the sweep goes on to the next N — run 12 is still retired`)
  assert.deepEqual(out.result.kept, [],
    `(c)/M2 \`${state}\`: a live run is not \`kept\` — nothing failed to verify`)
  assert.equal(Array.isArray(out.result.skipped) && out.result.skipped.length, 1,
    `(c)/M2 \`${state}\`: \`skipped\` stays the lone halves' branch names; got ${JSON.stringify(out.result.skipped)}`)
  assert.ok(/(^|\D)5(\D|$)/.test(String(out.result.skipped.join(' '))),
    `(c)/M2 \`${state}\`: and names only run 5; got ${JSON.stringify(out.result.skipped)}`)
  assert.deepEqual(sweepOf(exec, 12), sweepLines(12),
    `(c)/M2, M3 \`${state}\`: run 12's ordered sweep is unchanged by the skip before it`)
  assert.ok(runLine(out, 12).includes('retired'),
    `(c)/M2 \`${state}\`: run 12's line says retired; got ${JSON.stringify(runLine(out, 12))}`)
  assert.ok(out.lines.indexOf(runLine(out, 3)) < out.lines.indexOf(runLine(out, 12)),
    `(c)/M2 \`${state}\`: the skip line comes before the later run's line`)
  assert.notEqual(out.exitCode, 1,
    `(c)/M2 \`${state}\`: a skipped live run does not set process.exitCode to 1`)

  captured706[`live3_${state}`] = runLine(out, 3)
}
// `blocked` is in the loop above on purpose: it is not one of the three live
// states the boot writes, so only membership in REAPABLE_STATES — never a
// denylist of `booting|running|publishing` — leaves it unswept.

// The mirror: the live pair is the LAST candidate, after a terminal one.
{
  const exec = seam({ pages: { 3: { state: 'done' }, 12: { state: 'running' } } })
  const out = await captured(() => retire({ argv: ['--target', TARGET], exec }))
  assert.equal(runLine(out, 12), liveLine(12, 'running'),
    '(c)/M2 the mirror: run 12 live behind a terminal run 3 prints the same line, verbatim')
  assert.deepEqual(out.result.retired, [3], '(c)/M2 the mirror: run 3 is still retired')
  assert.deepEqual(out.result.live, [{ run: 12, why: 'running' }],
    `(c)/M2 the mirror: \`live\` carries run 12; got ${JSON.stringify(out.result.live ?? null)}`)
  captured706.live12_running = runLine(out, 12)
}

// ── (d) M2: a read that answers nothing readable is `no status page` ───────

for (const [what, contentsAnswer] of [
  ['gh answers non-zero', answer('', { code: 1, stderr: 'gh: Not Found (HTTP 404)' })],
  ['the body is a bare array, not the contents envelope', answer([])],
  ['the envelope decodes to a page with no `state` string', envelope({ run: '3' })]
]) {
  const exec = seam({ contents: { 3: contentsAnswer } })
  const out = await captured(() => retire({ argv: ['--target', TARGET], exec }))

  assert.equal(runLine(out, 3), liveLine(3, 'no status page'),
    `(d)/M2 ${what}: run 3 is skipped with the \`no status page\` line, verbatim`)
  assert.deepEqual(linesOf(exec, (l) => namesRun(l, 3) && /-X (POST|DELETE)/.test(l)), [],
    `(d)/M2 ${what}: a pair with no readable page is skipped, never swept — no POST and no DELETE names run 3`)
  assert.deepEqual(out.result.live, [{ run: 3, why: 'no status page' }],
    `(d)/M2 ${what}: \`live\` carries the run with why \`no status page\`; got ${JSON.stringify(out.result.live ?? null)}`)
  assert.deepEqual(out.result.retired, [12],
    `(d)/M2 ${what}: the sweep goes on — run 12 is retired`)
}

// ── (e)(f)(g) M3: every terminal state is swept exactly as before ──────────

assert.deepEqual(sweepOf(healthy, 3), sweepLines(3),
  '(e)/M3 a `done` page: the read gates the sweep and replaces none of it — the two POSTs, the verify and the two DELETEs, in that order')
assert.ok(runLine(base, 3).includes('retired'),
  `(e)/M3 and the run's line says retired; got ${JSON.stringify(runLine(base, 3))}`)
assert.deepEqual(base.result.live, [],
  `(e)/M3 a sweep with no live run resolves an empty \`live\`; got ${JSON.stringify(base.result.live ?? null)}`)

for (const [leg, state] of [['(f)', 'parked'], ['(g)', 'failed']]) {
  const exec = seam({ pages: { 3: { state }, 12: { state: 'done' } } })
  const out = await captured(() => retire({ argv: ['--target', TARGET], exec }))
  assert.deepEqual(sweepOf(exec, 3), sweepLines(3),
    `${leg}/M3 a \`${state}\` page is swept exactly as before the read existed — a \`${state}\` run that is skipped fails this`)
  assert.ok(runLine(out, 3).includes('retired'),
    `${leg}/M3 \`${state}\`: the run's line says retired; got ${JSON.stringify(runLine(out, 3))}`)
  assert.deepEqual(out.result.live, [],
    `${leg}/M3 \`${state}\`: nothing is carried under \`live\`; got ${JSON.stringify(out.result.live ?? null)}`)
}

// ── (h) M4: a terminal pair with an open integration PR is skipped ─────────

{
  const exec = seam({ openPulls: { 3: [{ number: PR_3, body: '' }], 12: [] } })
  const out = await captured(() => retire({ argv: ['--target', TARGET], exec }))

  assert.deepEqual(linesOf(exec, (l) => namesRun(l, 3)), [contentsLine(3), openPullsLine(3)],
    '(h)/M4 an open PR: the calls naming run 3 are the status read then the open-PR read, in that order, and nothing else — no POST, no DELETE, no PATCH, no state=closed read')
  assert.equal(runLine(out, 3), liveLine(3, `PR #${PR_3} open`),
    "(h)/M4 the run's one line names the first row's number, verbatim")
  assert.deepEqual(out.result.live, [{ run: 3, why: `PR #${PR_3} open` }],
    `(h)/M4 \`live\` carries the run with the same why; got ${JSON.stringify(out.result.live ?? null)}`)
  assert.deepEqual(sweepOf(exec, 12), sweepLines(12),
    '(h)/M4 an empty answer lets run 12 proceed to the ordered sweep')
  assert.ok(runLine(out, 12).includes('retired'),
    `(h)/M4 and run 12's line says retired; got ${JSON.stringify(runLine(out, 12))}`)

  const all = lines(exec)
  const readAt = all.indexOf(contentsLine(12))
  const openAt = all.indexOf(openPullsLine(12))
  const postAt = all.findIndex((l) => l.includes('-X POST') && namesRun(l, 12))
  assert.ok(readAt !== -1 && openAt !== -1 && postAt !== -1 && readAt < openAt && openAt < postAt,
    `(h)/M4 run 12 is asked once, after its status read and before its first POST; read ${readAt}, open-PR ${openAt}, POST ${postAt}`)

  captured706.pr3 = runLine(out, 3)
}

// ── (i) M4: the control, and no open-PR read behind an M2 skip ─────────────

assert.deepEqual(linesOf(healthy, (l) => l.includes('/pulls?state=open')), [openPullsLine(3), openPullsLine(12)],
  '(i)/M4 the control: each terminal pair is asked once for an open PR')
assert.deepEqual(base.result.retired, [3, 12],
  '(i)/M4 the control: with every open-PR read answering [], both runs are retired')
assert.ok(running3Seam !== null, '(i)/M4 the run-3-is-`running` seam of (c) was built')
assert.deepEqual(linesOf(running3Seam, (l) => l.includes('state=open') && namesRun(l, 3)), [],
  '(i)/M4 a pair skipped under M2 is asked no open-PR read')

// ── (j) M5: --dry-run says the same and does nothing ───────────────────────

for (const argv of [['--target', TARGET, '--dry-run'], ['--dry-run', '--target', TARGET]]) {
  const spelling = JSON.stringify(argv)

  {
    const exec = seam({ pages: { 3: { state: 'running' }, 12: { state: 'done' } } })
    const out = await captured(() => retire({ argv, exec }))

    assert.deepEqual(lines(exec), [LIST_LINE, contentsLine(3), contentsLine(12), openPullsLine(12), pullsLine(12)],
      `(j)/M5 ${spelling}: the listing, then per pair ascending the status read, the open-PR read of the terminal pair only, and its closed-PR read`)
    assert.equal(runLine(out, 3), captured706.live3_running,
      `(j)/M5 ${spelling}: a live run's dry-run line is byte-identical to the line it prints without the flag`)
    assert.ok(runLine(out, 12).includes('would'),
      `(j)/M5 ${spelling}: only a terminal pair with no open PR prints a \`would\` line; got ${JSON.stringify(runLine(out, 12))}`)
    assert.deepEqual(linesOf(exec, (l) => l.includes(' -X ')), [],
      `(j)/M5 ${spelling}: no gh call carries -X`)
    assert.deepEqual(linesOf(exec, (l) => l.startsWith('git ') && l !== LIST_LINE), [],
      `(j)/M5 ${spelling}: no git call but the one listing is made`)
    assert.notEqual(out.exitCode, 1,
      `(j)/M5 ${spelling}: a dry run over a live pair does not set process.exitCode to 1`)
  }

  {
    const exec = seam({
      pages: { 3: { state: 'done' }, 12: { state: 'running' } },
      openPulls: { 3: [{ number: PR_3 }] }
    })
    const out = await captured(() => retire({ argv, exec }))

    assert.deepEqual(lines(exec), [LIST_LINE, contentsLine(3), openPullsLine(3), contentsLine(12)],
      `(j)/M5 ${spelling}: an open PR ends run 3's reads, and the live run 12 is never asked for a PR — a dry run that stops after a skip fails this`)
    assert.equal(runLine(out, 3), captured706.pr3,
      `(j)/M5 ${spelling}: the open-PR skip line is byte-identical under --dry-run`)
    assert.equal(runLine(out, 12), captured706.live12_running,
      `(j)/M5 ${spelling}: and so is the live skip line`)
    assert.deepEqual(out.runLines.filter((l) => l.includes('would')), [],
      `(j)/M5 ${spelling}: a dry run prints no \`would\` line for a skipped run; got ${JSON.stringify(out.runLines)}`)
  }
}

// ── (l) M7: the two documents say it, in the line's own words ──────────────

const SKIP_WORDS = '— skipped'
const CONTRACT_MD = path.join(FLEET_DIR, 'CONTRACT.md')
const RUNBOOK_MD = path.join(FLEET_DIR, 'RUNBOOK.md')

const contractText = fs.readFileSync(CONTRACT_MD, 'utf8')
const runbookText = fs.readFileSync(RUNBOOK_MD, 'utf8')

const twoTagsBullet = /^- \*\*The two tags[\s\S]*?(?=^- \*\*)/m.exec(contractText)
assert.ok(twoTagsBullet,
  '(l)/M7 fleet/CONTRACT.md still carries a `- **The two tags` bullet under §Literals')
assert.ok(twoTagsBullet[0].includes(SKIP_WORDS),
  `(l)/M7 the \`**The two tags**\` bullet says the sweep skips a run, carrying the line's literal \`${SKIP_WORDS}\`; the bullet reads ${JSON.stringify(twoTagsBullet[0])}`)

const rollback = /^## Rollback[\s\S]*$/m.exec(runbookText)
assert.ok(rollback, '(l)/M7 fleet/RUNBOOK.md still carries a `## Rollback` section')
assert.ok(rollback[0].includes(SKIP_WORDS),
  `(l)/M7 the \`## Rollback\` section says the same, carrying \`${SKIP_WORDS}\` — a skip declared in one document only fails this; the section reads ${JSON.stringify(rollback[0])}`)

for (const [name, text] of [['fleet/CONTRACT.md', contractText], ['fleet/RUNBOOK.md', runbookText]]) {
  assert.equal(text.includes('?ref=ultra/evidence-run-'), false,
    `(l)/M7 ${name} shows no \`?ref=\` at the evidence branch — the record is read by tag, and the sentence names the branch in prose`)
}

// #706: every seam this exam has built, including the new ones, is checked
// again — the two new reads name no `refs/heads/ultra/integration-run-<N>`.
for (const [i, exec] of SEAMS.entries()) {
  assert.deepEqual(linesOf(exec, (l) => l.includes('refs/heads/ultra/integration-run')), [],
    `(h)/M4 seam ${i}: the open-PR read filters on the head ref's NAME — no command names refs/heads/ultra/integration-run-N`)
  assert.deepEqual([...new Set(exec.calls.map((c) => c.cmd))].filter((c) => c !== 'git' && c !== 'gh'), [],
    `(a)/M1 seam ${i}: only git and gh are reached through the exec seam`)
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
 *  run 3, gh answers the `contents/` status read with a contents envelope
 *  carrying `state` (#706/M6 — the read gates the sweep here too) and prints an
 *  empty PR array for everything else. */
const loggingShims = (name, { state = 'done' } = {}) => {
  const dir = shimDir(name, { git: '', gh: '' })
  const gitLog = path.join(dir, 'git.log')
  const ghLog = path.join(dir, 'gh.log')
  const listing =
    `${HEAD[3].plan}\\trefs/heads/${planBranchFor(3)}\\n${HEAD[3].evidence}\\trefs/heads/${evidenceBranchFor(3)}\\n`
  const page = Buffer.from(JSON.stringify({ run: 3, state })).toString('base64')
  fs.writeFileSync(path.join(dir, 'git'),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${gitLog}"\nprintf '${listing}'\nexit 0\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(dir, 'gh'),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${ghLog}"\n` +
    'case "$*" in\n' +
    `  *contents/*) printf '{"content":"${page}","sha":"deadbee"}\\n' ;;\n` +
    "  *) printf '[]\\n' ;;\n" +
    'esac\nexit 0\n', { mode: 0o755 })
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
  // #706/M5: three reads now — the status page, the open-PR list, the closed one.
  assert.equal(ghLogged.length, 3,
    `(i)/M6, #706/M5 the real exec reaches gh on PATH three times — the status read, the open-PR read, the closed-PR read; got ${JSON.stringify(ghLogged)}`)
  assert.ok(ghLogged[0].includes(`api repos/${TARGET}/contents/.ultrapowers/runs/3/status.json`),
    `(i)/M6, #706/M1 and the first is the status read; got ${ghLogged[0]}`)
  assert.ok(ghLogged[2].includes(`api repos/${TARGET}/pulls`) && ghLogged[2].includes('state=closed'),
    `(i)/M6 and the last is the closed-PR read; got ${ghLogged[2]}`)
  for (const line of [...gitLogged, ...ghLogged]) {
    assert.ok(!line.includes('-X') && !line.includes('--delete'),
      `(i)/M6 a dry run creates and deletes nothing through any command; got ${line}`)
  }
}

{
  const { dir, ghLog } = loggingShims('live')
  const res = runProcess(['--target', TARGET], dir)
  const ghLogged = logLines(ghLog)
  // #706: the reads come first, so the pin is the first MUTATING call.
  const firstMutating = ghLogged.find((l) => l.includes('-X'))
  assert.equal(firstMutating, `api -X POST repos/${TARGET}/git/refs -f ref=refs/tags/${planTagFor(3)} -f sha=${HEAD[3].plan}`,
    `(i)/M1, M7 the script's entry calls retire with the real exec: the first -X call is the plan tag POST; stdout: ${res.stdout} stderr: ${res.stderr} log: ${JSON.stringify(ghLogged)}`)
}

// ── (k) #706/M6: a live page skips the run when run as a process ───────────

{
  const { dir, ghLog } = loggingShims('live-page', { state: 'running' })
  const res = runProcess(['--target', TARGET], dir)
  assert.equal(res.status, 0,
    `(k)/M6 a sweep whose only pair is live exits 0; stdout: ${res.stdout} stderr: ${res.stderr}`)
  assert.ok(res.stdout.split('\n').map((l) => l.trimEnd()).includes('run 3: live (running) — skipped'),
    `(k)/M6 and prints the skip line, verbatim, on its own stdout; got ${JSON.stringify(res.stdout)}`)
  for (const line of logLines(ghLog)) {
    assert.ok(!line.includes('-X') && !line.includes('--delete'),
      `(k)/M6 a live run is neither tagged nor deleted through any command; got ${line}`)
  }
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

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
 * sweep reads each pair's `.ultrapowers/runs/<N>/status.json` off the evidence
 * branch before it touches the run, and skips a run whose state is not terminal
 * or whose integration branch has an open pull request.
 *
 *   (a) M1 — exactly one contents read per pair, before that pair's first POST,
 *       and none for a lone half.
 *   (b) M1 — the terminal states are `REAPABLE_STATES` imported from
 *       `./janitor.mjs`, never a list retyped in `fleet/retire.mjs`.
 *   (c) M2 — a live page (`booting`, `running`, `publishing`, and `blocked`,
 *       the word the boot never writes) prints one `live (<state>) — skipped`
 *       line, touches nothing else, lands under `live`, and does not stop the
 *       sweep or set exit 1.
 *   (d) M2 — a read that answers non-zero, a non-envelope body, or a page with
 *       no string `state` is skipped the same way, `why` `no status page`.
 *   (e)(f)(g) M3 — `done`, `parked` and `failed` are swept exactly as before the
 *       read existed: the read gates the sweep and replaces none of it.
 *   (h)(i) M4 — the open-PR read per terminal pair, after its status read and
 *       before its first POST; a non-empty answer skips the run as
 *       `live (PR #<number> open)`, an empty one lets it through.
 *   (j) M5 — `--dry-run`, in either flag order: the same skip lines byte for
 *       byte, `would` only for a terminal pair with no open PR, and exactly the
 *       listing, the status reads, the open-PR reads and the closed-PR reads.
 *   (k) M6 — the same skip as a process against `PATH` shims.
 *   (l) M7 — the two documents each declare the skip, carrying `— skipped`, and
 *       the docs-pin suite is green over both.
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

/** #706/M1: the one status read, off the pair's evidence BRANCH (the record is
 *  read by tag elsewhere; a pair still carrying branches has no tag yet). */
const contentsLine = (run) =>
  `gh api repos/${TARGET}/contents/.ultrapowers/runs/${run}/status.json?ref=${evidenceBranchFor(run)}`
/** #706/M4: the open-PR read, the same head filter with `state=open`. */
const openPullsLine = (run) =>
  `gh api repos/${TARGET}/pulls?state=open&head=${OWNER}:ultra/integration-run-${run}`

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

/** #706/M1: the contents envelope a status read answers — base64 under
 *  `content`, exactly as GitHub's contents API answers it. */
const envelope = (page) => answer({
  content: Buffer.from(JSON.stringify(page), 'utf8').toString('base64'),
  sha: sha('b10b')
})

/** #706/M1: the pages the seam serves by default — both pairs terminal. */
const DONE_PAGES = { 3: { state: 'done', run: 3 }, 12: { state: 'done', run: 12 } }

/** The run a `gh api` call names in its path, off `runs/<N>/` or `run-<N>`. */
const runOfApiCall = (argv) => {
  const joined = argv.map(String).join(' ')
  const match = /\/runs\/([1-9][0-9]*)\/|ultra\/integration-run-([1-9][0-9]*)/.exec(joined)
  return match ? Number(match[1] ?? match[2]) : null
}

/**
 * The recording seam of leg (b): the one heads-and-tags listing, the per-run tag
 * verify, the refs POST, the status read, the open- and closed-PR reads, the
 * PATCH and the DELETE. Nothing runs for real (`passthrough: []`), so no `git`
 * and no `gh` is started here.
 *
 * `pages` is the status page each run's contents read answers with (a run with
 * no entry gets a 404, the answer GitHub gives for a file that is not there);
 * `contentsAnswers` overrides a run's answer wholesale, for the three shapes
 * that carry no page at all; `openPulls` is what the `state=open` read answers,
 * empty for every run unless a leg says otherwise.
 */
function makeSeam ({
  tagVariant = {},
  postAnswer = null,
  pulls = PULLS,
  pages = DONE_PAGES,
  contentsAnswers = {},
  openPulls = {}
} = {}) {
  const snapshots = {}
  const rules = [
    {
      // #706/M1: `repos/<t>/contents/.ultrapowers/runs/<N>/status.json?ref=…`
      when: (c, argv) => c === 'gh' && /\/contents\//.test(argv.map(String).join(' ')),
      answer: (c, argv) => {
        const run = runOfApiCall(argv)
        if (run !== null && Object.prototype.hasOwnProperty.call(contentsAnswers, run)) {
          return contentsAnswers[run]
        }
        const page = run === null ? undefined : pages[run]
        return page === undefined
          ? answer('', { code: 1, stderr: 'gh: Not Found (HTTP 404)' })
          : envelope(page)
      }
    },
    {
      // #706/M4: the open-PR read, told from the closed one by `state=`.
      when: (c, argv) => c === 'gh' && /\/pulls\?[^ ]*state=open/.test(argv.map(String).join(' ')),
      answer: (c, argv) => {
        const run = runOfApiCall(argv)
        return answer(run === null ? [] : (openPulls[run] ?? []))
      }
    },
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
      when: (c, argv) => c === 'gh' && argv[0] === 'api' && /\/pulls\?/.test(String(argv[1] ?? '')),
      answer: (c, argv) => {
        const match = /ultra\/integration-run-([1-9][0-9]*)/.exec(String(argv[1]))
        return answer(match ? (pulls[Number(match[1])] ?? []) : [])
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

// The sweep proper: the reads that decide whether to sweep at all — the pulls
// reads and (#706/M1) the status read — are not part of it and are filtered out,
// so this stays the ordered sweep it pinned before the status read existed.
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

  assert.deepEqual(
    lines(exec),
    [
      LIST_LINE,
      contentsLine(3), openPullsLine(3), pullsLine(3),
      contentsLine(12), openPullsLine(12), pullsLine(12)
    ],
    `(g)/M6, #706/M5 ${spelling}: the calls through the seam are exactly the one listing, then per pair in ascending N its status read, its open-PR read and its closed-PR read`)
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
// Every pair's `.ultrapowers/runs/<N>/status.json` is read off the evidence
// branch before anything names that run's tags or branches; a page that is not
// terminal, a page that cannot be read, and a run with an open integration PR
// are each one printed line and nothing else.
// ════════════════════════════════════════════════════════════════════════════

/** The one line a skipped run prints, exact — the same with and without
 *  `--dry-run` (#706/M2, M4, M5). */
const liveSkip = (run, why) => `run ${run}: live (${why}) — skipped`

/** The skip lines captured once and compared byte for byte under `--dry-run`. */
const captured706 = {}

// ── #706 (a) M1: one status read per pair, before that pair's first POST ────

for (const run of [3, 12]) {
  const reads = linesOf(healthy, (l) => namesRun(l, run) && l.includes('/contents/'))
  assert.deepEqual(reads, [contentsLine(run)],
    `#706 (a)/M1 run ${run}: exactly one contents read for the pair, the status page off its evidence branch; got ${JSON.stringify(reads)}`)

  const all = lines(healthy)
  const readAt = all.indexOf(contentsLine(run))
  const postAt = all.findIndex((l) => l.includes('POST') && namesRun(l, run))
  assert.ok(readAt !== -1 && postAt !== -1 && readAt < postAt,
    `#706 (a)/M1 run ${run}: the status read comes before the first command naming the run's tags or branches — a tool that reads the page after tagging fails; read at ${readAt}, first POST at ${postAt}`)
}
assert.deepEqual(linesOf(healthy, (l) => namesRun(l, 5) && l.includes('/contents/')), [],
  '#706 (a)/M1 a lone half is not a pair: no status page is read for run 5')

// ── #706 (b) M1: the terminal states are imported, never retyped ────────────

const RETIRE_SOURCE = fs.readFileSync(RETIRE_SRC, 'utf8')

assert.match(RETIRE_SOURCE, /import\s*\{[^}]*\bREAPABLE_STATES\b[^}]*\}\s*from\s*'\.\/janitor\.mjs'/,
  "#706 (b)/M1 fleet/retire.mjs imports REAPABLE_STATES from './janitor.mjs' — the one place the terminal states are spelled")
assert.doesNotMatch(RETIRE_SOURCE, /['"]done['"]\s*,\s*['"]parked['"]\s*,\s*['"]failed['"]/,
  '#706 (b)/M1 and retypes no `done, parked, failed` list of its own')

// ── #706 (c) M2: a live page is one line, and the sweep goes on ─────────────

/** The seam of the `running`-as-run-3 case, reused by (i) and (j). */
let running3Seam = null

for (const state of ['booting', 'running', 'publishing', 'blocked']) {
  const exec = seam({ pages: { 3: { run: 3, state }, 12: { run: 12, state: 'done' } } })
  const out = await captured(() => retire({ argv: ['--target', TARGET], exec }))
  if (state === 'running') {
    running3Seam = exec
    captured706.running3 = runLine(out, 3)
  }

  assert.equal(runLine(out, 3), liveSkip(3, state),
    `#706 (c)/M2 a page whose state is \`${state}\` prints exactly \`${liveSkip(3, state)}\` — the test is membership in REAPABLE_STATES, so a denylist of the three live states would sweep \`blocked\`; got ${JSON.stringify(runLine(out, 3))}`)
  assert.deepEqual(linesOf(exec, (l) => namesRun(l, 3)), [contentsLine(3)],
    `#706 (c)/M2 \`${state}\`: the status read is the only command naming run 3 — no POST, no --tags, no DELETE, no PATCH, no /pulls; got ${JSON.stringify(linesOf(exec, (l) => namesRun(l, 3)))}`)
  assert.deepEqual(out.result.live, [{ run: 3, why: state }],
    `#706 (c)/M2 \`${state}\`: the resolved value carries the run under \`live\` as { run, why }`)
  assert.deepEqual(out.result.retired, [12],
    `#706 (c)/M2 \`${state}\`: the sweep goes on to the next N — run 12 is still retired`)
  assert.deepEqual(out.result.kept, [],
    `#706 (c)/M2 \`${state}\`: a live run is not a kept run`)
  assert.equal(Array.isArray(out.result.skipped) && out.result.skipped.length, 1,
    `#706 (c)/M2 \`${state}\`: \`skipped\` stays the lone halves' branch names; got ${JSON.stringify(out.result.skipped)}`)
  assert.ok(/(^|\D)5(\D|$)/.test(out.result.skipped.join(' ')),
    `#706 (c)/M2 \`${state}\`: and names only run 5; got ${JSON.stringify(out.result.skipped)}`)
  assert.deepEqual(sweepOf(exec, 12), sweepLines(12),
    `#706 (c)/M2 \`${state}\`: the following pair is swept in full — two POSTs, the verify, two DELETEs`)
  assert.ok(runLine(out, 12).includes('retired'),
    `#706 (c)/M2 \`${state}\`: and its line says retired; got ${JSON.stringify(runLine(out, 12))}`)
  assert.ok(out.lines.indexOf(runLine(out, 3)) < out.lines.indexOf(runLine(out, 12)),
    `#706 (c)/M2 \`${state}\`: the skip line is printed before the next run's line`)
  assert.notEqual(out.exitCode, 1,
    `#706 (c)/M2 \`${state}\`: a live run is not a kept run, so process.exitCode is not set to 1`)
}

// The mirror: the live pair is the LAST candidate, the terminal one first.
{
  const exec = seam({ pages: { 3: { run: 3, state: 'done' }, 12: { run: 12, state: 'running' } } })
  const out = await captured(() => retire({ argv: ['--target', TARGET], exec }))
  captured706.running12 = runLine(out, 12)

  assert.equal(runLine(out, 12), liveSkip(12, 'running'),
    `#706 (c)/M2 the mirror: run 12's line is exactly \`${liveSkip(12, 'running')}\`; got ${JSON.stringify(runLine(out, 12))}`)
  assert.deepEqual(out.result.retired, [3],
    '#706 (c)/M2 the mirror: the terminal pair before it is retired')
  assert.deepEqual(out.result.live, [{ run: 12, why: 'running' }],
    '#706 (c)/M2 the mirror: `live` carries run 12')
}

// ── #706 (d) M2: a page that cannot be read is skipped the same way ─────────

for (const [what, contents] of [
  ['a read answering non-zero', answer('', { code: 1, stderr: 'gh: Not Found (HTTP 404)' })],
  ['a body that is not the contents envelope', answer([])],
  ['an envelope whose page has no `state`', envelope({ run: '3' })]
]) {
  const exec = seam({ contentsAnswers: { 3: contents } })
  const out = await captured(() => retire({ argv: ['--target', TARGET], exec }))

  assert.equal(runLine(out, 3), liveSkip(3, 'no status page'),
    `#706 (d)/M2 ${what}: run 3's line is exactly \`${liveSkip(3, 'no status page')}\`; got ${JSON.stringify(runLine(out, 3))}`)
  assert.deepEqual(
    linesOf(exec, (l) => namesRun(l, 3) && (l.includes('POST') || l.includes('DELETE'))), [],
    `#706 (d)/M2 ${what}: an unreadable page is never swept — no POST and no DELETE names run 3`)
  assert.deepEqual(out.result.live, [{ run: 3, why: 'no status page' }],
    `#706 (d)/M2 ${what}: \`live\` carries the run with why \`no status page\``)
  assert.deepEqual(out.result.retired, [12],
    `#706 (d)/M2 ${what}: the sweep goes on — run 12 is retired`)
}

// ── #706 (e)(f)(g) M3: a terminal page is swept exactly as before ───────────

assert.deepEqual(sweepOf(healthy, 3), sweepLines(3),
  '#706 (e)/M3 a `done` page is swept as before the read existed: the two POSTs, the verify, the two DELETEs, in that order')
assert.ok(runLine(base, 3).includes('retired'),
  `#706 (e)/M3 and the run's line says retired; got ${JSON.stringify(runLine(base, 3))}`)
assert.deepEqual(base.result.live, [],
  '#706 (e)/M3 nothing is live when both pages are terminal')

for (const [leg, state] of [['(f)', 'parked'], ['(g)', 'failed']]) {
  const exec = seam({ pages: { 3: { run: 3, state }, 12: { run: 12, state: 'done' } } })
  const out = await captured(() => retire({ argv: ['--target', TARGET], exec }))

  assert.deepEqual(sweepOf(exec, 3), sweepLines(3),
    `#706 ${leg}/M3 a \`${state}\` run is swept — the read gates the sweep and replaces none of it`)
  assert.ok(runLine(out, 3).includes('retired'),
    `#706 ${leg}/M3 and its line says retired, not skipped; got ${JSON.stringify(runLine(out, 3))}`)
  assert.deepEqual(out.result.live, [],
    `#706 ${leg}/M3 a \`${state}\` run is terminal, so nothing is live`)
}

// ── #706 (h)(i) M4: the open-PR read, after the status read, before the POST ─

{
  const exec = seam({ openPulls: { 3: [{ number: PR_3, body: '' }], 12: [] } })
  const out = await captured(() => retire({ argv: ['--target', TARGET], exec }))

  assert.deepEqual(linesOf(exec, (l) => namesRun(l, 3)), [contentsLine(3), openPullsLine(3)],
    `#706 (h)/M4 a terminal pair is asked once for its open PRs, after its status read and before anything else — and an open PR stops it there: no POST, no DELETE, no PATCH, no closed-PR read; got ${JSON.stringify(linesOf(exec, (l) => namesRun(l, 3)))}`)
  assert.equal(runLine(out, 3), liveSkip(3, `PR #${PR_3} open`),
    `#706 (h)/M4 the line names the first row's number; got ${JSON.stringify(runLine(out, 3))}`)
  captured706.pr3 = runLine(out, 3)
  assert.deepEqual(out.result.live, [{ run: 3, why: `PR #${PR_3} open` }],
    '#706 (h)/M4 `live` carries the run with the same why the line printed')
  assert.deepEqual(sweepOf(exec, 12), sweepLines(12),
    '#706 (h)/M4 the pair with no open PR proceeds to the whole sweep')
  assert.ok(runLine(out, 12).includes('retired'),
    `#706 (h)/M4 and its line says retired; got ${JSON.stringify(runLine(out, 12))}`)

  const all = lines(exec)
  const readAt = all.indexOf(contentsLine(12))
  const openAt = all.indexOf(openPullsLine(12))
  const postAt = all.findIndex((l) => l.includes('POST') && namesRun(l, 12))
  assert.ok(readAt !== -1 && openAt > readAt && postAt > openAt,
    `#706 (h)/M4 run 12's open-PR read sits after its status read and before its first POST; status ${readAt}, open ${openAt}, POST ${postAt}`)
}

assert.deepEqual(linesOf(healthy, (l) => l.includes('/pulls?state=open')),
  [openPullsLine(3), openPullsLine(12)],
  '#706 (i)/M4 the control: each terminal pair is asked for its open PRs exactly once')
assert.deepEqual(base.result.retired, [3, 12],
  '#706 (i)/M4 the control: an empty open-PR answer lets both runs through to the sweep')
assert.deepEqual(linesOf(running3Seam, (l) => l.includes('state=open') && namesRun(l, 3)), [],
  '#706 (i)/M4 a pair skipped for a live page is asked no open-PR read')

// ── #706 (j) M5: --dry-run says the same thing and asks the same reads ──────

for (const argv of [['--target', TARGET, '--dry-run'], ['--dry-run', '--target', TARGET]]) {
  const spelling = JSON.stringify(argv)

  {
    const exec = seam({ pages: { 3: { run: 3, state: 'running' }, 12: { run: 12, state: 'done' } } })
    const out = await captured(() => retire({ argv, exec }))

    assert.deepEqual(lines(exec),
      [LIST_LINE, contentsLine(3), contentsLine(12), openPullsLine(12), pullsLine(12)],
      `#706 (j)/M5 ${spelling}: the listing, then per pair the status read, the open-PR read for the terminal page only, and the closed-PR read behind an empty open answer; got ${JSON.stringify(lines(exec))}`)
    assert.equal(runLine(out, 3), captured706.running3,
      `#706 (j)/M5 ${spelling}: a live run prints the byte-identical line it prints without the flag; got ${JSON.stringify(runLine(out, 3))}`)
    assert.ok(runLine(out, 12).includes('would'),
      `#706 (j)/M5 ${spelling}: only a terminal pair with no open PR says what it would do; got ${JSON.stringify(runLine(out, 12))}`)
    assert.deepEqual(linesOf(exec, (l) => l.includes(' -X ')), [],
      `#706 (j)/M5 ${spelling}: no gh call carries -X`)
    assert.deepEqual(linesOf(exec, (l) => l.startsWith('git ') && l !== LIST_LINE), [],
      `#706 (j)/M5 ${spelling}: no git call but the one listing`)
    assert.notEqual(out.exitCode, 1,
      `#706 (j)/M5 ${spelling}: a dry run keeps nothing, so it does not set process.exitCode to 1`)
  }

  {
    const exec = seam({
      pages: { 3: { run: 3, state: 'done' }, 12: { run: 12, state: 'running' } },
      openPulls: { 3: [{ number: PR_3 }] }
    })
    const out = await captured(() => retire({ argv, exec }))

    assert.deepEqual(lines(exec),
      [LIST_LINE, contentsLine(3), openPullsLine(3), contentsLine(12)],
      `#706 (j)/M5 ${spelling}: an open PR ends the run's reads there, and a live page is never asked for its PRs; got ${JSON.stringify(lines(exec))}`)
    assert.equal(runLine(out, 3), captured706.pr3,
      `#706 (j)/M5 ${spelling}: the open-PR skip line is byte-identical to the one printed without the flag; got ${JSON.stringify(runLine(out, 3))}`)
    assert.equal(runLine(out, 12), captured706.running12,
      `#706 (j)/M5 ${spelling}: and so is the live-page skip line; got ${JSON.stringify(runLine(out, 12))}`)
    assert.deepEqual(out.runLines.filter((l) => l.includes('would')), [],
      `#706 (j)/M5 ${spelling}: a dry run says \`would\` for no skipped run; got ${JSON.stringify(out.runLines)}`)
  }
}

// ── #706 (l) M7: the two documents each declare the skip ────────────────────

const REPO_ROOT = path.resolve(FLEET_DIR, '..')
const CONTRACT_MD = path.join(FLEET_DIR, 'CONTRACT.md')
const RUNBOOK_MD = path.join(FLEET_DIR, 'RUNBOOK.md')

/** The contract's `**The two tags**` bullet, from its own `- **` line to the
 *  next one — the region the first `Run:` command spans. */
const twoTagsBullet = (text) => {
  const match = /^- \*\*The two tags[\s\S]*?(?=^- \*\*Comment\*\*)/m.exec(text)
  assert.ok(match,
    '#706 (l)/M7 fleet/CONTRACT.md still carries a `- **The two tags**` bullet ending at the `- **Comment**` bullet')
  return match[0].split('\n').join(' ')
}
/** The runbook's `## Rollback` section, to the end of the file. */
const rollbackSection = (text) => {
  const at = text.indexOf('\n## Rollback')
  assert.notEqual(at, -1, '#706 (l)/M7 fleet/RUNBOOK.md still carries a `## Rollback` section')
  return text.slice(at).split('\n').join(' ')
}

const contractText = fs.readFileSync(CONTRACT_MD, 'utf8')
const runbookText = fs.readFileSync(RUNBOOK_MD, 'utf8')

assert.ok(twoTagsBullet(contractText).includes('— skipped'),
  "#706 (l)/M7 the contract's `**The two tags**` bullet says the sweep reads a pair's status page first and skips a live run or one with an open PR, carrying the line's literal `— skipped`")
assert.ok(rollbackSection(runbookText).includes('— skipped'),
  "#706 (l)/M7 the runbook's `## Rollback` section says the same, carrying the line's literal `— skipped` — a skip declared in one document only fails this")

for (const [name, text] of [['fleet/CONTRACT.md', contractText], ['fleet/RUNBOOK.md', runbookText]]) {
  const branchRefs = [...text.matchAll(/\?ref=([^\s'"`)]*)/g)]
    .map((m) => m[1])
    .filter((ref) => ref.startsWith('ultra/evidence-run-'))
  assert.deepEqual(branchRefs, [],
    `#706 (l)/M7 ${name} shows no \`?ref=ultra/evidence-run-<N>\` read — the record is read by tag, and the sweep's read names the branch in prose; got ${JSON.stringify(branchRefs)}`)
}

{
  const res = spawnSync('python3',
    ['-m', 'pytest', 'tests/test_docs_agree_with_code.py', '-q', '-p', 'no:cacheprovider'],
    { cwd: REPO_ROOT, encoding: 'utf8', timeout: 120000 })
  assert.equal(res.status, 0,
    `#706 (l)/M7 the docs-pin suite is green over both edited documents; stdout: ${res.stdout} stderr: ${res.stderr}`)
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
 *  run 3, and gh answers a `contents/` call with run 3's status envelope
 *  (#706/M1) and every other call with an empty PR array. */
const loggingShims = (name, { state = 'done' } = {}) => {
  const dir = shimDir(name, { git: '', gh: '' })
  const gitLog = path.join(dir, 'git.log')
  const ghLog = path.join(dir, 'gh.log')
  const listing =
    `${HEAD[3].plan}\\trefs/heads/${planBranchFor(3)}\\n${HEAD[3].evidence}\\trefs/heads/${evidenceBranchFor(3)}\\n`
  // The contents envelope, as one JSON document with no single quote in it, so
  // the shim can hold it in a single-quoted shell string.
  const page = JSON.stringify({
    content: Buffer.from(JSON.stringify({ run: 3, state }), 'utf8').toString('base64'),
    sha: sha('b10b')
  })
  fs.writeFileSync(path.join(dir, 'git'),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${gitLog}"\nprintf '${listing}'\nexit 0\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(dir, 'gh'),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${ghLog}"\n` +
    `case "$*" in\n  *contents/*) printf '%s\\n' '${page}' ;;\n  *) printf '[]\\n' ;;\nesac\nexit 0\n`,
    { mode: 0o755 })
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
  assert.equal(ghLogged.length, 3,
    `(i)/M6, #706/M5 the real exec reaches gh on PATH three times — the status read, the open-PR read, the closed-PR read; got ${JSON.stringify(ghLogged)}`)
  assert.ok(ghLogged[0].includes(`api repos/${TARGET}/contents/.ultrapowers/runs/3/status.json`),
    `(i)/M6, #706/M1 and the first is the status read; got ${ghLogged[0]}`)
  assert.ok(ghLogged[1].includes(`api repos/${TARGET}/pulls?state=open`),
    `(i)/M6, #706/M4 then the open-PR read; got ${ghLogged[1]}`)
  assert.ok(ghLogged[2].includes(`api repos/${TARGET}/pulls?state=closed`),
    `(i)/M6 then the closed-PR read; got ${ghLogged[2]}`)
  for (const line of [...gitLogged, ...ghLogged]) {
    assert.ok(!line.includes('-X') && !line.includes('--delete'),
      `(i)/M6 a dry run creates and deletes nothing through any command; got ${line}`)
  }
}

{
  const { dir, ghLog } = loggingShims('live')
  const res = runProcess(['--target', TARGET], dir)
  const ghLogged = logLines(ghLog)
  const firstWrite = ghLogged.find((l) => l.includes('-X'))
  assert.equal(firstWrite, `api -X POST repos/${TARGET}/git/refs -f ref=refs/tags/${planTagFor(3)} -f sha=${HEAD[3].plan}`,
    `(i)/M1, M7 the script's entry calls retire with the real exec: the first gh call that writes anything is the plan tag POST; stdout: ${res.stdout} stderr: ${res.stderr} log: ${JSON.stringify(ghLogged)}`)
  assert.ok(ghLogged[0]?.includes(`api repos/${TARGET}/contents/.ultrapowers/runs/3/status.json`),
    `(i)/M1, #706/M1 and the read that gates it comes first; log: ${JSON.stringify(ghLogged)}`)
}

// ── #706 (k) M6: the skip as a process, against PATH shims ──────────────────

{
  const { dir, ghLog } = loggingShims('live-page', { state: 'running' })
  const res = runProcess(['--target', TARGET], dir)

  assert.equal(res.status, 0,
    `#706 (k)/M6 a sweep that skips a live run exits 0; stdout: ${res.stdout} stderr: ${res.stderr}`)
  assert.ok(res.stdout.split('\n').map((l) => l.trimEnd()).includes(liveSkip(3, 'running')),
    `#706 (k)/M6 and prints exactly \`${liveSkip(3, 'running')}\` on its own stdout; got ${JSON.stringify(res.stdout)}`)
  for (const line of logLines(ghLog)) {
    assert.ok(!line.includes('-X') && !line.includes('--delete'),
      `#706 (k)/M6 a live run is tagged by nothing and deleted by nothing; got ${line}`)
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

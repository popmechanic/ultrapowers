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
 * Below those again, in its own region, `#724 Task 1 — the sweep deletes the
 * closed-unmerged integration branch`: a run whose one heads-and-tags listing
 * carries `refs/heads/ultra/integration-run-<N>` draws one fate read,
 * `gh api repos/<t>/pulls?state=all&head=<owner>:ultra/integration-run-<N>`, and
 * the row with the highest `number` decides — `closed` with `merged_at` `null`
 * deletes the branch, `open`, a `merged_at` string and no rows at all keep it.
 * Every leg there runs over a listing the legs build themselves — runs 7, 9, 32,
 * 40, 41 and 42, no run of BASE's fixture — so every leg above keeps grading
 * `HEADS_LISTING`:
 *
 *   (a) M1 — run 32, the two rows in both orders: one fate read, one integration
 *       DELETE, and the line names #720 in either seam.
 *   (b)(c)(d) M2 — runs 40, 41 and 42: `stays — PR #<k> open`, `stays — PR #<k>
 *       merged`, `stays — no pull request`; one fate read each and no DELETE,
 *       even where an older row is closed and unmerged.
 *   (e) M3 — `--dry-run`: the fate read of every such run, no `-X`, and
 *       `would delete …` where the branch would go.
 *   (f) M4 — the pair sweep is unchanged: run 7's five pair commands in BASE's
 *       order, its closed-PR read before its fate read, the integration DELETE
 *       last, and the pair line followed by `; ` and the integration segment; run
 *       9's lone half beside its integration segment; and no fate read at all
 *       over BASE's own listing.
 *   (g) M5 — `kept` is `[]`, `retired` is the pair's, no exit 1; and, over EVERY
 *       seam this exam builds, an integration DELETE only where the fate read
 *       answered a highest-numbered row that is closed and unmerged.
 *   (h) M6 — the Proof's two greps over `fleet/CONTRACT.md` and
 *       `fleet/RUNBOOK.md`, and the regions M6 names carrying `closed and not
 *       merged`.
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
import { simEnv } from './_helpers.mjs'
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

/** M2: the branch heads the one listing carries. Run 5 is a lone half.
 *
 *  #724 Task 1 adds the heads of the runs its own listing carries — 7, 9, 32,
 *  40, 41 and 42. None of them is in `HEADS_LISTING`, which enumerates runs 3, 5
 *  and 12 by hand, so every leg above keeps grading the fixture it was written
 *  for. */
const HEAD = {
  3: { plan: sha('a3'), evidence: sha('e3') },
  5: { evidence: sha('e5') },
  12: { plan: sha('a12'), evidence: sha('e12') },
  // #724 Task 1: a pair plus an integration branch, a lone half plus one, and
  // four runs whose listing holds the integration branch and nothing else.
  7: { plan: sha('a7'), evidence: sha('e7'), integration: sha('c7') },
  9: { plan: sha('a9'), integration: sha('c9') },
  32: { integration: sha('c32') },
  40: { integration: sha('c40') },
  41: { integration: sha('c41') },
  42: { integration: sha('c42') }
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

/** #724 Task 1/M1: the fate read — the same head filter with `state=all`, the
 *  one read that decides the integration branch. */
const fateLine = (run) =>
  `gh api repos/${TARGET}/pulls?state=all&head=${OWNER}:${integrationBranchFor(run)}`
/** #724 Task 1/M1: the one command that deletes an integration branch. */
const integrationDeleteLine = (run) =>
  `gh api -X DELETE repos/${TARGET}/git/refs/heads/${integrationBranchFor(run)}`

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
 *
 * #752 Task 1 adds `openPullAnswers`, the same override one level up from
 * `openPulls`: a run's whole `state=open` answer, checked before `openPulls`, so
 * a leg can make that one read exit non-zero or answer a shape that is not an
 * array at all.
 *
 * #724 Task 1 adds two options and one rule. `listing` is the heads-and-tags
 * listing the one `ls-remote` answers — every leg above leaves it at
 * `HEADS_LISTING`, and the task's legs pass their own — and `fatePulls` is what
 * each run's `state=all` fate read answers with, `[]` for a run with no entry.
 * The fate rule sits above the `state=closed` one and is told from it by
 * `state=all`, since one run receives both reads. What each fate read answered
 * is kept on `exec.fateAnswers`, so the sweep at the end of this file can hold
 * every integration DELETE against the row that decided it.
 */
function makeSeam ({
  tagVariant = {},
  postAnswer = null,
  pulls = PULLS,
  pages = DONE_PAGES,
  contentsAnswers = {},
  openPulls = {},
  openPullAnswers = {},
  listing = HEADS_LISTING,
  fatePulls = {}
} = {}) {
  const snapshots = {}
  const fateAnswers = {}
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
        // #752 Task 1: the whole-answer override, checked before `openPulls`.
        if (run !== null && Object.prototype.hasOwnProperty.call(openPullAnswers, run)) {
          return openPullAnswers[run]
        }
        return answer(run === null ? [] : (openPulls[run] ?? []))
      }
    },
    {
      // #724 Task 1/M1: the fate read, told from the other two `/pulls?` reads
      // by `state=all` — the run with a pair and an integration branch gets both.
      when: (c, argv) => c === 'gh' && /\/pulls\?[^ ]*state=all/.test(argv.map(String).join(' ')),
      answer: (c, argv) => {
        const run = runOfApiCall(argv)
        const rows = run === null ? [] : (fatePulls[run] ?? [])
        if (run !== null) fateAnswers[run] = rows
        return answer(rows)
      }
    },
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
  // #724 Task 1: `{ <run>: <rows> }` for every fate read this seam answered, and
  // the listing it was built with — the end-of-file sweep reads both.
  exec.fateAnswers = fateAnswers
  exec.listing = listing
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

// (c)/M3, re-scoped by #724 Task 1: this sweep over every seam asserted here
// that no command names an integration branch together with DELETE, and that no
// command names `refs/heads/ultra/integration-run-<N>` at all. It is now *a
// DELETE naming `refs/heads/ultra/integration-run-<N>` appears only for a run
// whose fate read answered a highest-numbered row that is closed and unmerged*,
// and it runs at the END of this file — over every seam the exam builds, BASE's
// fixture included, where it still finds none. See `#724 Task 1 (g)/M5`.

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
/** One home for every child this file spawns (#890): `retire.mjs` reads its
 *  shims and the greps read the checkout, none of them a home — so one
 *  `fleet-sim-*` dir, shared, rather than one per spawn. `runProcess` still
 *  puts each case's own shim dir first on PATH. */
const ENV = simEnv()
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
  // The shim dir first on PATH, and nothing of the box behind it.
  env: simEnv({ bin: dir, home: ENV.HOME }),
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

// ════════════════════════════════════════════════════════════════════════════
// #752 Task 1 — the open-PR read takes the status read's posture
//
// A non-2xx exit or a non-array payload on
// `gh api repos/<t>/pulls?state=open&head=<owner>:ultra/integration-run-<N>` is
// not "no open PR". It is a read the sweep could not make sense of, and the run
// is skipped exactly as an unreadable status page is skipped — the allowlist
// posture #706 gave the status read. The one line is
// `run <N>: unreadable (pulls) — skipped`; the segment is the literal the Claim
// names and NOT `live (unreadable (pulls))`. The run lands under `live` as
// `{ run, why: 'unreadable (pulls)' }`, is neither `kept` nor `skipped`, sets no
// exit code, and `--dry-run` prints the same line byte for byte.
//
// Every leg here runs over BASE's own listing — runs 3, 5 and 12 — so it grades
// the fixture the legs above were written for, and no leg builds an integration
// head: the end-of-file sweeps over `SEAMS` still find what they found.
// ════════════════════════════════════════════════════════════════════════════

/** M1: the `why` the resolved value carries, and the segment the line prints —
 *  the two are the same words, but the line is NOT `live (<why>)`. */
const WHY_PULLS = 'unreadable (pulls)'
/** M1: the one line an unreadable open-PR read prints, exact. */
const pullsSkip = (run) => `run ${run}: ${WHY_PULLS} — skipped`

/** M1 (ii): the body GitHub answers a rate-limited list read with — an object,
 *  not an array. No single quote in it, so a shell shim can hold it (M5). */
const RATE_LIMIT_OBJECT = {
  message: 'API rate limit exceeded',
  documentation_url: 'https://docs.github.com/rest'
}
/** M1 (iii): a stream that stops mid-row — not JSON at all. */
const TRUNCATED_PULLS = '[{"number": 41'

/** The three answers of M1, in the order the Machine clause names them. */
const UNREADABLE_PULLS = [
  ['(a)', 'row (i): exit 1, empty stdout, `gh: API rate limit exceeded (HTTP 403)` on stderr',
    answer('', { code: 1, stderr: 'gh: API rate limit exceeded (HTTP 403)' })],
  ['(b)', 'row (ii): exit 0 with the rate-limit OBJECT as stdout',
    answer(RATE_LIMIT_OBJECT)],
  ['(c)', `row (iii): exit 0 with the truncated stream \`${TRUNCATED_PULLS}\`, which is not JSON`,
    answer(TRUNCATED_PULLS)]
]

// Fixture self-checks: the three answers really are the three shapes M1 names,
// or the legs below would be graded against something else.
assert.equal(UNREADABLE_PULLS[0][2].code, 1,
  '#752 Task 1 fixture: row (i) answers non-zero')
assert.equal(UNREADABLE_PULLS[0][2].stdout, '',
  '#752 Task 1 fixture: row (i) answers empty stdout')
assert.ok(!Array.isArray(JSON.parse(UNREADABLE_PULLS[1][2].stdout)),
  '#752 Task 1 fixture: row (ii) is a JSON object, not an array')
assert.equal(UNREADABLE_PULLS[2][2].stdout, TRUNCATED_PULLS,
  '#752 Task 1 fixture: row (iii) is passed through as the raw string it is')
assert.throws(() => JSON.parse(TRUNCATED_PULLS), SyntaxError,
  '#752 Task 1 fixture: row (iii) is not parsable JSON')

/** Run 3's line, captured under the object answer and compared byte for byte
 *  under `--dry-run` (M3). */
const captured752 = {}

// ── #752 Task 1 (a)(b)(c)/M1: the three answers, one assertion set ───────────

for (const [leg, what, pullAnswer] of UNREADABLE_PULLS) {
  const exec = seam({ openPullAnswers: { 3: pullAnswer } })
  const out = await captured(() => retire({ argv: ['--target', TARGET], exec }))
  if (leg === '(b)') captured752.object3 = runLine(out, 3)

  assert.equal(runLine(out, 3), pullsSkip(3),
    `#752 Task 1 ${leg}/M1 ${what}: run 3's one line is exactly \`${pullsSkip(3)}\` — not \`live (${WHY_PULLS})\`, and never a retired line; got ${JSON.stringify(runLine(out, 3))}`)
  assert.deepEqual(linesOf(exec, (l) => namesRun(l, 3)), [contentsLine(3), openPullsLine(3)],
    `#752 Task 1 ${leg}/M1 ${what}: the calls naming run 3 are exactly its status read then its open-PR read, in that order — no POST, no ls-remote --tags, no DELETE, no PATCH and no state=closed read; got ${JSON.stringify(linesOf(exec, (l) => namesRun(l, 3)))}`)
  assert.deepEqual(out.result.live, [{ run: 3, why: WHY_PULLS }],
    `#752 Task 1 ${leg}/M1 ${what}: the resolved value carries the run under \`live\` as { run, why } with why \`${WHY_PULLS}\`; got ${JSON.stringify(out.result.live)}`)
  assert.deepEqual(out.result.retired, [12],
    `#752 Task 1 ${leg}/M1 ${what}: the sweep goes on to the next N — a tool that returns after the skip fails here; got ${JSON.stringify(out.result.retired)}`)
  assert.deepEqual(out.result.kept, [],
    `#752 Task 1 ${leg}/M1 ${what}: an unreadable read is not a kept run — \`kept\` keeps its tag-verify meaning; got ${JSON.stringify(out.result.kept)}`)
  assert.equal(Array.isArray(out.result.skipped) && out.result.skipped.length, 1,
    `#752 Task 1 ${leg}/M1 ${what}: \`skipped\` still names only the lone half; got ${JSON.stringify(out.result.skipped)}`)
  assert.ok(/(^|\D)5(\D|$)/.test(out.result.skipped.join(' ')),
    `#752 Task 1 ${leg}/M1 ${what}: and that lone half is run 5; got ${JSON.stringify(out.result.skipped)}`)
  assert.deepEqual(sweepOf(exec, 12), sweepLines(12),
    `#752 Task 1 ${leg}/M1 ${what}: the healthy pair behind it is swept in full — two POSTs, the verify, two DELETEs, in BASE's order`)
  assert.ok(runLine(out, 12).includes('retired'),
    `#752 Task 1 ${leg}/M1 ${what}: and run 12's line says retired; got ${JSON.stringify(runLine(out, 12))}`)
  assert.ok(out.lines.indexOf(runLine(out, 12)) > out.lines.indexOf(runLine(out, 3)),
    `#752 Task 1 ${leg}/M1 ${what}: run 12's line is printed after run 3's; got ${JSON.stringify(out.lines)}`)
  assert.notEqual(out.exitCode, 1,
    `#752 Task 1 ${leg}/M1 ${what}: a skipped run is not a kept run, so process.exitCode is not set to 1`)
}

// ── #752 Task 1 (d)/M2: the mirror, the unreadable read on the LAST pair ─────

{
  const exec = seam({ openPullAnswers: { 12: answer(RATE_LIMIT_OBJECT) } })
  const out = await captured(() => retire({ argv: ['--target', TARGET], exec }))

  assert.deepEqual(out.result.retired, [3],
    `#752 Task 1 (d)/M2 the mirror: the healthy pair before it is retired; got ${JSON.stringify(out.result.retired)}`)
  assert.equal(runLine(out, 12), pullsSkip(12),
    `#752 Task 1 (d)/M2 the mirror: run 12's one line is exactly \`${pullsSkip(12)}\`; got ${JSON.stringify(runLine(out, 12))}`)
  assert.deepEqual(out.result.live, [{ run: 12, why: WHY_PULLS }],
    `#752 Task 1 (d)/M2 the mirror: \`live\` carries run 12 with why \`${WHY_PULLS}\`; got ${JSON.stringify(out.result.live)}`)
}

// ── #752 Task 1 (e)/M3: --dry-run says the same thing and reads the same ─────

for (const argv of [['--target', TARGET, '--dry-run'], ['--dry-run', '--target', TARGET]]) {
  const spelling = JSON.stringify(argv)
  const exec = seam({ openPullAnswers: { 3: answer(RATE_LIMIT_OBJECT) } })
  const out = await captured(() => retire({ argv, exec }))

  assert.deepEqual(lines(exec), [
    LIST_LINE,
    contentsLine(3), openPullsLine(3),
    contentsLine(12), openPullsLine(12), pullsLine(12)
  ],
  `#752 Task 1 (e)/M3 ${spelling}: the calls through the seam are exactly the one heads-and-tags listing, then run 3's status read and open-PR read, then run 12's status read, open-PR read and state=closed read — six lines, nothing else; got ${JSON.stringify(lines(exec))}`)
  assert.equal(runLine(out, 3), captured752.object3,
    `#752 Task 1 (e)/M3 ${spelling}: the skip line is byte-identical to the one printed without the flag — a dry run that says \`would\` for run 3, or prints a different skip line, fails here; got ${JSON.stringify(runLine(out, 3))}`)
  assert.ok(runLine(out, 12).includes('would'),
    `#752 Task 1 (e)/M3 ${spelling}: the healthy pair behind it still says what it would do — a tool that stops after the skip fails here; got ${JSON.stringify(runLine(out, 12))}`)
  assert.deepEqual(linesOf(exec, (l) => l.includes(' -X ')), [],
    `#752 Task 1 (e)/M3 ${spelling}: no gh call carries -X`)
  assert.deepEqual(linesOf(exec, (l) => l.startsWith('git ') && l !== LIST_LINE), [],
    `#752 Task 1 (e)/M3 ${spelling}: no git call but the one listing is made`)
  assert.notEqual(out.exitCode, 1,
    `#752 Task 1 (e)/M3 ${spelling}: a dry run keeps nothing, so it does not set process.exitCode to 1`)
}

// ── #752 Task 1 (f)/M4: an empty array is still the answer it was ────────────

{
  const exec = seam({ openPulls: { 3: [] } })
  const out = await captured(() => retire({ argv: ['--target', TARGET], exec }))

  assert.deepEqual(sweepOf(exec, 3), sweepLines(3),
    '#752 Task 1 (f)/M4 an empty JSON array is a readable answer meaning "no open PR": run 3 goes through to the whole sweep — the two POSTs, the verify, the two DELETEs, in BASE\'s order. A tool that reads an empty array as unreadable fails here')
  assert.ok(runLine(out, 3).includes('retired'),
    `#752 Task 1 (f)/M4 and run 3's line says retired; got ${JSON.stringify(runLine(out, 3))}`)
  assert.deepEqual(out.result.live, [],
    `#752 Task 1 (f)/M4 and nothing is live; got ${JSON.stringify(out.result.live)}`)
}

// ── #752 Task 1 (g)/M4: a non-empty array still names the open PR ────────────

{
  const exec = seam({ openPulls: { 3: [{ number: PR_3, body: '' }] } })
  const out = await captured(() => retire({ argv: ['--target', TARGET], exec }))

  assert.equal(runLine(out, 3), liveSkip(3, `PR #${PR_3} open`),
    `#752 Task 1 (g)/M4 an array with a row is still an open pull request: run 3's line is exactly \`${liveSkip(3, `PR #${PR_3} open`)}\`, not the pulls-unreadable line; got ${JSON.stringify(runLine(out, 3))}`)
  assert.deepEqual(
    linesOf(exec, (l) => namesRun(l, 3) && (l.includes('POST') || l.includes('DELETE'))), [],
    '#752 Task 1 (g)/M4 and no line naming run 3 carries POST or DELETE')
}

// ── #752 Task 1 (h)/M4: the status read's own line is not renamed ────────────

{
  const exec = seam({
    contentsAnswers: { 3: answer('', { code: 1, stderr: 'gh: Not Found (HTTP 404)' }) }
  })
  const out = await captured(() => retire({ argv: ['--target', TARGET], exec }))

  assert.equal(runLine(out, 3), liveSkip(3, 'no status page'),
    `#752 Task 1 (h)/M4 a status read that answers non-zero still prints exactly \`${liveSkip(3, 'no status page')}\` — a tool that renames the status read's line to the pulls one fails here; got ${JSON.stringify(runLine(out, 3))}`)
  assert.deepEqual(linesOf(exec, (l) => l.includes('state=open') && namesRun(l, 3)), [],
    '#752 Task 1 (h)/M4 and a run skipped for its status page is asked no open-PR read at all')
}

// ── #752 Task 1 (i)/M5: the same skip as a process, against PATH shims ───────

{
  const dir = shimDir('pulls-unreadable', { git: '', gh: '' })
  const ghLog = path.join(dir, 'gh.log')
  const listing =
    `${HEAD[3].plan}\\trefs/heads/${planBranchFor(3)}\\n${HEAD[3].evidence}\\trefs/heads/${evidenceBranchFor(3)}\\n`
  // Both documents are JSON with no single quote in them, so each fits in a
  // single-quoted shell string.
  const page = JSON.stringify({
    content: Buffer.from(JSON.stringify({ run: 3, state: 'done' }), 'utf8').toString('base64'),
    sha: sha('b10b')
  })
  const rateLimit = JSON.stringify(RATE_LIMIT_OBJECT)
  assert.ok(!page.includes("'") && !rateLimit.includes("'"),
    '#752 Task 1 (i)/M5 fixture: neither shim document carries a single quote')

  fs.writeFileSync(path.join(dir, 'git'),
    `#!/bin/sh\nprintf '${listing}'\nexit 0\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(dir, 'gh'),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${ghLog}"\n` +
    'case "$*" in\n' +
    `  *contents/*) printf '%s\\n' '${page}' ;;\n` +
    `  *state=open*) printf '%s\\n' '${rateLimit}' ;;\n` +
    "  *) printf '[]\\n' ;;\nesac\nexit 0\n", { mode: 0o755 })
  fs.chmodSync(path.join(dir, 'git'), 0o755)
  fs.chmodSync(path.join(dir, 'gh'), 0o755)

  const res = runProcess(['--target', TARGET], dir)
  const ghLogged = logLines(ghLog)

  assert.equal(res.status, 0,
    `#752 Task 1 (i)/M5 a sweep whose open-PR read cannot be read exits 0; stdout: ${res.stdout} stderr: ${res.stderr}`)
  assert.ok(res.stdout.split('\n').map((l) => l.trimEnd()).includes(pullsSkip(3)),
    `#752 Task 1 (i)/M5 and prints exactly \`${pullsSkip(3)}\` on its own stdout — the CLI layer, not only the seam; got ${JSON.stringify(res.stdout)}`)
  for (const line of ghLogged) {
    assert.ok(!line.includes('-X') && !line.includes('--delete'),
      `#752 Task 1 (i)/M5 a run skipped this way is tagged by nothing and deleted by nothing; got ${line} (log: ${JSON.stringify(ghLogged)})`)
  }
}

// ── #752 Task 1 (j)/M6: the header comment names the line ────────────────────

for (const [command, why] of [
  [`sed -n '1,/^import /p' fleet/retire.mjs | grep -q 'unreadable (pulls)'`,
    'the prose before the first `import` of fleet/retire.mjs names the line `unreadable (pulls)` beside the sentence that names `live (<why>)` — a header that names the new line nowhere fails here'],
  [`sed -n '1,/^import /p' fleet/retire.mjs | tr '\\n' ' ' | grep -q 'open-PR read per terminal candidate'`,
    "and its `--dry-run` paragraph still says the open-PR read is made per terminal candidate — that is a stays, not a change: a rewrite that says the read is per pair again fails here"]
]) {
  const res = spawnSync('sh', ['-c', command], { cwd: REPO_ROOT, encoding: 'utf8', env: ENV, timeout: 60000 })
  assert.equal(res.status, 0,
    `#752 Task 1 (j)/M6 \`${command}\` exits 0: ${why}; status ${res.status}, stderr: ${res.stderr}`)
}

cleanup(cliRoot)

// ════════════════════════════════════════════════════════════════════════════
// #724 Task 1 — the sweep deletes the closed-unmerged integration branch
//
// The rule, verbatim from the task: the pull request with the highest `number`
// among the rows of `gh api repos/<t>/pulls?state=all&head=<owner>:ultra/integration-run-<N>`
// decides; `state` `"open"` keeps the branch; `state` `"closed"` with
// `merged_at` `null` retires it; `merged_at` a string keeps it
// (delete-on-merge's); no rows keeps it; the rows' order is not the rule.
//
// The rows carry `merged_at` and no `merged` boolean — `merged` is the single-PR
// endpoint's field, and this tool does not read that endpoint.
//
// Every leg below runs over the TASK LISTING these legs build themselves: runs
// 7, 9, 32, 40, 41 and 42, and no run of BASE's fixture. `HEADS_LISTING` is
// untouched, so every leg above still grades the listing it was written for.
// ════════════════════════════════════════════════════════════════════════════

/** The three branch names of a run, by kind. */
const branchOf = (run, kind) =>
  kind === 'plan' ? planBranchFor(run)
    : kind === 'evidence' ? evidenceBranchFor(run)
      : integrationBranchFor(run)

/**
 * The task listing, deliberately not in ascending order — the tool sorts:
 *
 *   run 7   the pair AND the integration branch     (M4, the pair sweep)
 *   run 9   a lone plan half AND the integration branch (M4)
 *   run 32  the integration branch alone            (M1, the deletable case)
 *   run 40  the integration branch alone            (M2, open)
 *   run 41  the integration branch alone            (M2, merged)
 *   run 42  the integration branch alone            (M2, no rows)
 */
const TASK_LISTING = [
  [42, 'integration'],
  [7, 'plan'],
  [7, 'integration'],
  [32, 'integration'],
  [9, 'plan'],
  [7, 'evidence'],
  [41, 'integration'],
  [9, 'integration'],
  [40, 'integration']
].map(([run, kind]) => `${HEAD[run][kind]}\trefs/heads/${branchOf(run, kind)}\n`).join('')

/** #706/M1 still gates the pair: run 7's page is terminal, and no other run of
 *  the task listing is a pair, so no other status page is asked for. */
const TASK_PAGES = { 7: { run: 7, state: 'done' } }

/** M4: run 7's `state=closed` read — one row, a body linking neither transient
 *  branch, so BASE's rewrite patches nothing and the pair line says `0 PR(s)`. */
const BODY_7 = 'run 7 — closed; this body links neither transient branch, so nothing is rewritten.'
const TASK_PULLS = { 7: [{ number: 300, body: BODY_7 }] }

// Fixture self-check: the run-7 body is what the leg describes.
assert.ok(!BODY_7.includes(`/blob/${planBranchFor(7)}/`) && !BODY_7.includes(`/tree/${evidenceBranchFor(7)}/`),
  '#724 Task 1 fixture: run 7\'s closed PR body carries neither branch path, so the pair sweep patches nothing')

/** M1: the two rows one head name carries — run numbers restarted at 1 on
 *  2026-09-04, so the old run-32 PR and the run the issue is about share it. */
const ROW_463 = { number: 463, state: 'closed', merged_at: '2026-08-31T03:03:48Z' }
const ROW_720 = { number: 720, state: 'closed', merged_at: null }

/** What each run's fate read answers. `run32Rows` is the leg-(a) row order. */
const taskFates = (run32Rows) => ({
  7: [{ number: 300, state: 'closed', merged_at: null }],
  9: [{ number: 310, state: 'open', merged_at: null }],
  32: run32Rows,
  40: [
    { number: 800, state: 'open', merged_at: null },
    { number: 790, state: 'closed', merged_at: null }
  ],
  41: [
    { number: 810, state: 'closed', merged_at: '2026-09-07T01:29:38Z' },
    { number: 805, state: 'closed', merged_at: null }
  ],
  42: []
})

const taskSeam = (fatePulls) =>
  seam({ listing: TASK_LISTING, pages: TASK_PAGES, pulls: TASK_PULLS, fatePulls })

/** M1, M2, M3: the five line segments, verbatim, `<k>` the deciding row's number. */
const deletedSegment = (run, k) => `${integrationBranchFor(run)} deleted — PR #${k} closed, not merged`
const wouldDeleteSegment = (run, k) => `would delete ${integrationBranchFor(run)} — PR #${k} closed, not merged`
const staysOpenSegment = (run, k) => `${integrationBranchFor(run)} stays — PR #${k} open`
const staysMergedSegment = (run, k) => `${integrationBranchFor(run)} stays — PR #${k} merged`
const staysNoneSegment = (run) => `${integrationBranchFor(run)} stays — no pull request`

// The two runs of the task listing, differing only in the order run 32's two
// rows arrive in (M1: "whichever order the rows arrive in").
const olderFirst = taskSeam(taskFates([ROW_463, ROW_720]))
const taskOut = await captured(() => retire({ argv: ['--target', TARGET], exec: olderFirst }))
const newerFirst = taskSeam(taskFates([ROW_720, ROW_463]))
const taskMirror = await captured(() => retire({ argv: ['--target', TARGET], exec: newerFirst }))

assert.deepEqual(
  taskOut.runLines.map((l) => l.slice(0, l.indexOf(':') + 1)),
  ['run 7:', 'run 9:', 'run 32:', 'run 40:', 'run 41:', 'run 42:'],
  `#724 Task 1 (a)-(d)/M4 one line per run of the task listing, ascending N; got ${JSON.stringify(taskOut.runLines)}`)

// ── #724 Task 1 (a)/M1: the deletable case, in both row orders ──────────────

for (const [order, exec, out] of [
  ['the older row first', olderFirst, taskOut],
  ['the newer row first', newerFirst, taskMirror]
]) {
  assert.equal(runLine(out, 32), `run 32: ${deletedSegment(32, 720)}`,
    `#724 Task 1 (a)/M1 ${order}: the highest \`number\` decides — #720 is closed with \`merged_at\` null, so run 32's line is exactly \`run 32: ${deletedSegment(32, 720)}\`; a tool that takes the first row, or names #463, fails one of the two seams. Got ${JSON.stringify(runLine(out, 32))}`)
  assert.deepEqual(linesOf(exec, (l) => l === fateLine(32)), [fateLine(32)],
    `#724 Task 1 (a)/M1 ${order}: exactly one call is \`${fateLine(32)}\`; got ${JSON.stringify(linesOf(exec, (l) => namesRun(l, 32)))}`)
  assert.deepEqual(linesOf(exec, (l) => l === integrationDeleteLine(32)), [integrationDeleteLine(32)],
    `#724 Task 1 (a)/M1 ${order}: exactly one call is \`${integrationDeleteLine(32)}\`; got ${JSON.stringify(linesOf(exec, (l) => namesRun(l, 32)))}`)
}

// ── #724 Task 1 (b)(c)(d)/M2: the three `stays`, and no DELETE for any ──────

for (const [leg, run, segment, why] of [
  ['(b)', 40, staysOpenSegment(40, 800), 'the highest-numbered row is `open`, and the older #790 is closed and unmerged — a tool that deletes on any closed-unmerged row fails here'],
  ['(c)', 41, staysMergedSegment(41, 810), '`merged_at` is a string on the highest-numbered row, so the branch is delete-on-merge\'s; the older #805 is closed and unmerged'],
  ['(d)', 42, staysNoneSegment(42), 'the read answers no rows']
]) {
  assert.equal(runLine(taskOut, run), `run ${run}: ${segment}`,
    `#724 Task 1 ${leg}/M2 run ${run}: ${why} — the line is exactly \`run ${run}: ${segment}\`; got ${JSON.stringify(runLine(taskOut, run))}`)
  assert.deepEqual(linesOf(olderFirst, (l) => l === fateLine(run)), [fateLine(run)],
    `#724 Task 1 ${leg}/M2 run ${run}: the fate read is issued exactly once; got ${JSON.stringify(linesOf(olderFirst, (l) => namesRun(l, run)))}`)
  assert.deepEqual(linesOf(olderFirst, (l) => namesRun(l, run) && l.includes('DELETE')), [],
    `#724 Task 1 ${leg}/M2 run ${run}: no call naming the run carries DELETE`)
}

// ── #724 Task 1 (f)/M4: the pair sweep is unchanged, the fate read is second ─

/** M4: BASE's five pair commands in BASE's order, behind #706's two gate reads,
 *  then the closed-PR read, then the fate read, with the integration DELETE last. */
const RUN_7_CALLS = [
  contentsLine(7),
  openPullsLine(7),
  postLine(7, 'plan'),
  postLine(7, 'evidence'),
  verifyLine(7),
  deleteLine(7, 'plan'),
  deleteLine(7, 'evidence'),
  pullsLine(7),
  fateLine(7),
  integrationDeleteLine(7)
]
assert.deepEqual(linesOf(olderFirst, (l) => namesRun(l, 7)), RUN_7_CALLS,
  `#724 Task 1 (f)/M4 run 7: the status read and the open-PR read that gate the pair (#706), then the two tag POSTs, the ls-remote --tags verify, the plan and evidence DELETEs — BASE's five, in BASE's order — then the \`state=closed\` read, then the \`state=all\` fate read, then the integration DELETE last; got ${JSON.stringify(linesOf(olderFirst, (l) => namesRun(l, 7)))}`)

const RUN_7_LINE =
  `run 7: retired ${planTagFor(7)}@${abbrev(HEAD[7].plan)} ${evidenceTagFor(7)}@${abbrev(HEAD[7].evidence)}, ` +
  `2 branches deleted, 0 PR(s) patched; ${deletedSegment(7, 300)}`
assert.equal(runLine(taskOut, 7), RUN_7_LINE,
  `#724 Task 1 (f)/M4 run 7's line is BASE's pair line followed by \`; \` and the integration segment; got ${JSON.stringify(runLine(taskOut, 7))}`)

const RUN_9_LINE = `run 9: skip — lone ${planBranchFor(9)}; ${staysOpenSegment(9, 310)}`
assert.equal(runLine(taskOut, 9), RUN_9_LINE,
  `#724 Task 1 (f)/M4 run 9: a lone pair half beside an integration branch prints \`${RUN_9_LINE}\` — \`lone\` names pair halves only; got ${JSON.stringify(runLine(taskOut, 9))}`)
assert.deepEqual(linesOf(olderFirst, (l) => namesRun(l, 9) && (l.includes('DELETE') || l.includes('POST'))), [],
  '#724 Task 1 (f)/M4 run 9: no call naming the run carries DELETE or POST — an open PR keeps the branch and a lone half is not swept')
assert.deepEqual(linesOf(olderFirst, (l) => l === fateLine(9)), [fateLine(9)],
  `#724 Task 1 (f)/M4 run 9: its integration branch still draws exactly one fate read; got ${JSON.stringify(linesOf(olderFirst, (l) => namesRun(l, 9)))}`)
assert.deepEqual(taskOut.result.skipped, [planBranchFor(9)],
  `#724 Task 1 (f)/M4 \`skipped\` names the lone pair half and not the integration branch; got ${JSON.stringify(taskOut.result.skipped)}`)

// M4: a run with no integration branch draws no fate read and prints BASE's
// line — over BASE's own listing (runs 3, 5 and 12) nothing is read `state=all`.
for (const [i, exec] of SEAMS.entries()) {
  if (exec.listing !== HEADS_LISTING) continue
  assert.deepEqual(linesOf(exec, (l) => l.includes('state=all')), [],
    `#724 Task 1 (f)/M4 seam ${i}: BASE's listing carries no integration head, so no fate read is issued for it; got ${JSON.stringify(linesOf(exec, (l) => l.includes('state=all')))}`)
}

// ── #724 Task 1 (e)/M3: --dry-run reads the same and writes nothing ─────────

{
  const exec = taskSeam(taskFates([ROW_463, ROW_720]))
  const out = await captured(() => retire({ argv: ['--target', TARGET, '--dry-run'], exec }))

  assert.deepEqual(lines(exec), [
    LIST_LINE,
    contentsLine(7), openPullsLine(7), pullsLine(7), fateLine(7),
    fateLine(9),
    fateLine(32),
    fateLine(40),
    fateLine(41),
    fateLine(42)
  ],
  `#724 Task 1 (e)/M3 the calls through the seam are the one heads-and-tags listing, run 7's #706 gate reads and its \`state=closed\` read, and one \`state=all\` read for each of runs 7, 9, 32, 40, 41 and 42, in ascending N; got ${JSON.stringify(lines(exec))}`)
  assert.deepEqual(linesOf(exec, (l) => l.includes(' -X ')), [],
    '#724 Task 1 (e)/M3 no command carries -X under --dry-run — the deletable branch is still there afterwards')

  assert.equal(runLine(out, 32), `run 32: ${wouldDeleteSegment(32, 720)}`,
    `#724 Task 1 (e)/M3 the deletable case's line is exactly \`run 32: ${wouldDeleteSegment(32, 720)}\`; got ${JSON.stringify(runLine(out, 32))}`)
  assert.ok(runLine(out, 7).endsWith(`; ${wouldDeleteSegment(7, 300)}`),
    `#724 Task 1 (e)/M3 run 7's line ends \`; ${wouldDeleteSegment(7, 300)}\`; got ${JSON.stringify(runLine(out, 7))}`)
  assert.equal(runLine(out, 7),
    `run 7: would retire ${planTagFor(7)}@${abbrev(HEAD[7].plan)} ${evidenceTagFor(7)}@${abbrev(HEAD[7].evidence)}, ` +
    `delete 2 branches, patch 0 PR(s); ${wouldDeleteSegment(7, 300)}`,
    `#724 Task 1 (e)/M3 and the rest of it is BASE's dry-run pair line, unchanged; got ${JSON.stringify(runLine(out, 7))}`)
  for (const run of [40, 41, 42]) {
    assert.equal(runLine(out, run), runLine(taskOut, run),
      `#724 Task 1 (e)/M3 run ${run}: the three \`stays\` segments read the same under --dry-run as without it; got ${JSON.stringify(runLine(out, run))}`)
  }
  assert.notEqual(out.exitCode, 1,
    '#724 Task 1 (e)/M3 a dry run over the task listing does not set process.exitCode to 1')
}

// ── #724 Task 1 (g)/M5: no integration outcome is a `kept`, and the sweep ────

for (const [order, out] of [['the older row first', taskOut], ['the newer row first', taskMirror]]) {
  assert.deepEqual(out.result.kept, [],
    `#724 Task 1 (g)/M5 ${order}: a \`stays\` is the correct state, not a \`kept\` — \`kept\` keeps its pair meaning; got ${JSON.stringify(out.result.kept)}`)
  assert.deepEqual(out.result.retired, [7],
    `#724 Task 1 (g)/M5 ${order}: \`retired\` is the pair-tag record — run 7 and no integration-only run; got ${JSON.stringify(out.result.retired)}`)
  assert.notEqual(out.exitCode, 1,
    `#724 Task 1 (g)/M5 ${order}: no integration-branch outcome sets process.exitCode to 1`)
}

// (c)/M3 re-scoped, over EVERY seam this exam builds, BASE's fixture included:
// a DELETE naming `refs/heads/ultra/integration-run-<N>` appears only for a run
// whose fate read answered a highest-numbered row that is closed and unmerged.
const integrationDeleted = []
for (const [i, exec] of SEAMS.entries()) {
  for (const line of linesOf(exec, (l) => l.includes('refs/heads/ultra/integration-run'))) {
    const run = Number(/refs\/heads\/ultra\/integration-run-([1-9][0-9]*)/.exec(line)[1])
    assert.ok(line.includes('DELETE'),
      `#724 Task 1 (g)/M5 seam ${i}: the only command that may name refs/heads/ultra/integration-run-<N> is the DELETE of a retired branch; got ${JSON.stringify(line)}`)
    const rows = exec.fateAnswers[run]
    assert.ok(Array.isArray(rows) && rows.length > 0,
      `#724 Task 1 (g)/M5 seam ${i}: run ${run}'s integration branch was deleted without a fate read to decide it; got ${JSON.stringify(rows ?? null)}`)
    const deciding = rows.reduce((a, b) => (b.number > a.number ? b : a))
    assert.ok(deciding.state === 'closed' && deciding.merged_at === null,
      `#724 Task 1 (g)/M5 seam ${i}: run ${run}'s branch was deleted, so its fate read's highest-numbered row must be \`closed\` with \`merged_at\` null; the deciding row was ${JSON.stringify(deciding)}`)
    integrationDeleted.push(run)
  }
}
assert.deepEqual([...new Set(integrationDeleted)].sort((a, b) => a - b), [7, 32],
  `#724 Task 1 (g)/M5 over every seam, the integration branch is deleted for runs 7 and 32 only — BASE's fixture carries no integration head, and runs 9, 40, 41 and 42 all stay; got ${JSON.stringify(integrationDeleted)}`)

// The header comment of `fleet/retire.mjs` no longer claims what the tool no
// longer does: at BASE it said no command here ever names the integration ref.
assert.ok(!/no command here ever names/.test(RETIRE_SOURCE.split('\n').join(' ')),
  '#724 Task 1/M1 the header comment of fleet/retire.mjs no longer says that no command here ever names `refs/heads/ultra/integration-run-<N>` — the DELETE of a closed-and-unmerged branch is one, so the comment carries the rule instead')

// ── #724 Task 1 (h)/M6: the two documents ───────────────────────────────────

const CONTRACT_REL = 'fleet/CONTRACT.md'
const RUNBOOK_REL = 'fleet/RUNBOOK.md'
const DOC_TEXT = { [CONTRACT_REL]: contractText, [RUNBOOK_REL]: runbookText }

/** One of the Proof's two greps, as `{ file, line, text }` rows. */
const grepDocs = (pattern) => {
  const res = spawnSync('grep', ['-n', pattern, CONTRACT_REL, RUNBOOK_REL],
    { cwd: REPO_ROOT, encoding: 'utf8', env: ENV, timeout: 60000 })
  assert.ok(res.status === 0 || res.status === 1,
    `#724 Task 1 (h)/M6 \`grep -n '${pattern}' ${CONTRACT_REL} ${RUNBOOK_REL}\` ran; status ${res.status}, stderr: ${res.stderr}`)
  return String(res.stdout).split('\n').filter((l) => l !== '').map((row) => {
    const match = /^([^:]+):([0-9]+):([\s\S]*)$/.exec(row)
    assert.ok(match, `#724 Task 1 (h)/M6 a \`grep -n\` row reads \`<file>:<line>:<text>\`; got ${JSON.stringify(row)}`)
    return { file: match[1], line: Number(match[2]), text: match[3] }
  })
}

/** The blank-line-delimited block of `text` holding the 1-based `lineNo`. */
const paragraphAt = (text, lineNo) => {
  const all = text.split('\n')
  let start = lineNo - 1
  let end = lineNo - 1
  while (start > 0 && all[start - 1].trim() !== '') start -= 1
  while (end < all.length - 1 && all[end + 1].trim() !== '') end += 1
  return all.slice(start, end + 1).join(' ')
}

/** M6: the contract's integration-branch bullet, `- `ultra/integration-run-<N>`
 *  — the work …`, up to the next top-level `- **` bullet. */
const integrationBullet = (text) => {
  const all = text.split('\n')
  const at = all.findIndex((l) => l.includes('`ultra/integration-run-<N>` — the work'))
  assert.notEqual(at, -1,
    '#724 Task 1 (h)/M6 fleet/CONTRACT.md still carries its `ultra/integration-run-<N>` — the work …` bullet, which is the bullet M6 names')
  let end = at + 1
  while (end < all.length && !/^- \*\*/.test(all[end])) end += 1
  return all.slice(at, end).join(' ')
}

/** M6: the runbook's "three branches" paragraph. */
const threeBranchesParagraph = (text) => {
  const at = text.split('\n').findIndex((l) => l.includes('The three branches are where a run works'))
  assert.notEqual(at, -1,
    '#724 Task 1 (h)/M6 fleet/RUNBOOK.md still carries its "three branches" paragraph, which is one of the two sentences M6 names')
  return paragraphAt(text, at + 1)
}

// The second `Run:` — at least one line of the contract and at least two of the
// runbook carry the phrase and name the retire sweep as what deletes the branch.
const PHRASE = 'closed and not merged'
const namesSweep = (text) => /retire\.mjs|retire sweep/.test(text)
const phraseHits = grepDocs(PHRASE)
const contractPhraseLines = phraseHits.filter((h) => h.file === CONTRACT_REL && namesSweep(h.text))
const runbookPhraseLines = phraseHits.filter((h) => h.file === RUNBOOK_REL && namesSweep(h.text))

assert.ok(contractPhraseLines.length >= 1,
  `#724 Task 1 (h)/M6 \`grep -n '${PHRASE}' ${CONTRACT_REL} ${RUNBOOK_REL}\` prints at least one line of ${CONTRACT_REL} naming the retire sweep (\`retire.mjs\` or "retire sweep") as what deletes the branch. grep prints lines, so keep \`retire sweep\` on the same wrapped line as the phrase; got ${JSON.stringify(phraseHits.filter((h) => h.file === CONTRACT_REL))}`)
assert.ok(runbookPhraseLines.length >= 2,
  `#724 Task 1 (h)/M6 and at least two lines of ${RUNBOOK_REL} that do the same — one per branch-lifecycle sentence, so a rewrite that touches the "three branches" paragraph and leaves the rollback section fails here. Same wrapping note; got ${JSON.stringify(phraseHits.filter((h) => h.file === RUNBOOK_REL))}`)

// M6 names the three regions, so each of them carries the phrase.
assert.ok(integrationBullet(contractText).includes(PHRASE),
  `#724 Task 1 (h)/M6 the contract's integration-branch bullet carries \`${PHRASE}\` and gives the branch its third fate — the retire sweep's to delete; got ${JSON.stringify(integrationBullet(contractText))}`)
assert.ok(threeBranchesParagraph(runbookText).includes(PHRASE),
  `#724 Task 1 (h)/M6 the runbook's "three branches" paragraph carries \`${PHRASE}\`; got ${JSON.stringify(threeBranchesParagraph(runbookText))}`)
assert.ok(rollbackSection(runbookText).includes(PHRASE),
  `#724 Task 1 (h)/M6 the runbook's rollback-section sweep sentence carries \`${PHRASE}\` — leaving either runbook sentence at BASE fails one of the two`)

// The first `Run:` — no line of either document still gives the integration
// branch only the merge and the open-PR fates of BASE.
for (const hit of grepDocs('integration-run')) {
  if (!/goes with the merge|delete-on-merge/.test(hit.text)) continue
  assert.ok(paragraphAt(DOC_TEXT[hit.file], hit.line).includes(PHRASE),
    `#724 Task 1 (h)/M6 ${hit.file}:${hit.line} still gives ultra/integration-run-<N> only the two fates of BASE — the merge and the open PR — with no \`${PHRASE}\` anywhere in its paragraph; got ${JSON.stringify(hit.text)}`)
}

console.log('ALL TESTS PASSED')

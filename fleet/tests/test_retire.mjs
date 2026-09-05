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
function makeSeam ({ tagVariant = {}, postAnswer = null, pulls = PULLS } = {}) {
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

// M3: no command ever names an integration branch as something to delete.
for (const [i, exec] of SEAMS.entries()) {
  assert.deepEqual(
    linesOf(exec, (l) => l.includes('ultra/integration-run') && l.includes('DELETE')), [],
    `(c)/M3 seam ${i}: no command names an integration branch together with DELETE`)
  assert.deepEqual(linesOf(exec, (l) => l.includes('refs/heads/ultra/integration-run')), [],
    `(c)/M3 seam ${i}: no command names refs/heads/ultra/integration-run-N at all`)
}

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

// M7: `git` and `gh` are reached only through the seam — nothing else is run.
for (const [i, exec] of SEAMS.entries()) {
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

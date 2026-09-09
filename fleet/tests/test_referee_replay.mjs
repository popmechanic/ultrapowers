// fleet/tests/test_referee_replay.mjs — the replay sim for `fleet/referee.mjs`.
//
// The referee is driver arithmetic (#729, map #727 rule 1): it reads the
// driver-captured patch, the compiled task object and the clone at HEAD, and
// answers with the one `referee.json` object a reviewer model is then never
// asked about. This sim is that claim's proof. It replays the module over the
// fixtures under `fleet/tests/fixtures/referee/` — built from the recorded
// reviewer notes of the 2026-09-08 harvest, one directory per species — and
// walks the Proof's legs (a)..(n) against Machine clauses M1..M8.
//
// Nothing under the referee is faked. Each fixture's HEAD is a real git repo:
// `base/` copied to a temporary directory, committed, `patch.diff` applied with
// `git apply --index`, committed again. `runDir` is a real directory and the
// written record is really read back. The one injected seam is `opts.linker`,
// which the module takes as a parameter precisely so this sim never imports the
// sibling linker.
//
// Amendment 10: every git command below is this sim's own.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { referee } from '../referee.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(HERE, 'fixtures', 'referee')
const MODULE = path.join(HERE, '..', 'referee.mjs')

// U+2212 MINUS SIGN — the same byte sequence the module spells `+2 / −0` with.
const MINUS = '−'

const CHECKS = ['footprint', 'interface', 'exam-files', 'test-count', 'dependencies', 'secrets']
const SETTLED = [...CHECKS, 'integrated-suite']
// The five checks M1 gives the one-line-or-none rule; `footprint` counts its
// settled lines per overlapping path instead and is pinned in legs (d) and (n).
const SINGLE = ['interface', 'exam-files', 'test-count', 'dependencies', 'secrets']
const KIND = { '.mjs': 'mjs', '.js': 'mjs', '.py': 'py', '.ts': 'ts', '.tsx': 'ts' }
// The six prefixes M8 globs. `linker-*` under the same directory belongs to the
// linker sim and must not be replayed here.
const REPLAYED = /^(footprint|exam|testcount|deps|secrets|clean)-\d+$/
const EXPECTED_FIXTURES = [
  'clean-1', 'clean-2', 'deps-1', 'exam-1', 'exam-2', 'exam-3', 'exam-4',
  'footprint-1', 'footprint-2', 'footprint-3', 'footprint-4', 'footprint-5',
  'footprint-6', 'footprint-7', 'secrets-1', 'secrets-2', 'testcount-1', 'testcount-2',
]
// A detail rendered into the review prompt may never carry these block names:
// engine sims assert they are absent from a prompt that carries no such block.
const EVIDENCE_BLOCKS = ['EXAM EVIDENCE', 'RUN EVIDENCE', 'CHECK EVIDENCE']

// ─── scratch space ──────────────────────────────────────────────────────────
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'referee-replay-'))
let counter = 0
const scratch = (tag) => {
  counter += 1
  const dir = path.join(SCRATCH, `${tag}-${counter}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// ─── the rig ────────────────────────────────────────────────────────────────
const git = (argv, cwd) =>
  execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

// `git apply --check` first, so a fixture whose patch has drifted from its
// `base/` fails as a refusal here rather than as a puzzling assertion later.
function applyPatch(dir, patchPath) {
  try {
    git(['apply', '--check', patchPath], dir)
  } catch (err) {
    throw new Error(`patch does not apply: ${patchPath}\n${err.stderr || err.message}`)
  }
  git(['apply', '--index', patchPath], dir)
}

function buildHead(fixtureDir) {
  const dir = scratch('head')
  fs.cpSync(path.join(fixtureDir, 'base'), dir, { recursive: true })
  git(['init', '-q', '-b', 'main'], dir)
  git(['config', 'user.email', 'sim@example.invalid'], dir)
  git(['config', 'user.name', 'referee replay'], dir)
  git(['add', '-A'], dir)
  git(['commit', '-q', '-m', 'BASE'], dir)
  const base = git(['rev-parse', 'HEAD'], dir)
  applyPatch(dir, path.join(fixtureDir, 'patch.diff'))
  git(['commit', '-q', '-m', 'HEAD'], dir)
  return { dir, base, head: git(['rev-parse', 'HEAD'], dir) }
}

const STUB_DETAIL = 'stub'
// The shared literal from the task's Context: the replay stubs the linker with
// `async () => ({status: 'unlinked', symbol: '', detail: 'stub'})`.
function stubLinker(answer = { status: 'unlinked', symbol: '', detail: STUB_DETAIL }) {
  const calls = []
  const fn = async (arg) => {
    calls.push(arg)
    return answer
  }
  fn.calls = calls
  return fn
}

const specOf = (name) =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, name, 'task.json'), 'utf8'))
const expectedOf = (name) =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, name, 'expected.json'), 'utf8'))

// One replay call. `over` substitutes opts in memory; the fixture on disk is
// never edited.
async function replay(name, over = {}) {
  const fixtureDir = path.join(FIXTURES, name)
  const spec = specOf(name)
  const head = over.head ?? buildHead(fixtureDir)
  const linker = over.linker ?? stubLinker()
  const task = over.task ?? spec.task
  const opts = {
    task,
    patchPath: over.patchPath ?? path.join(fixtureDir, 'patch.diff'),
    baseSha: head.base,
    headSha: head.head,
    cloneDir: head.dir,
    siblingFiles: over.siblingFiles ?? spec.siblingFiles ?? [],
    exam: 'exam' in over ? over.exam : spec.exam,
    examEvidence: 'examEvidence' in over ? over.examEvidence : spec.examEvidence,
    n: over.n ?? 0,
    linker,
  }
  // M1's "with `runDir` absent": the key is off the object entirely.
  const runDir = over.withoutRunDir ? undefined : (over.runDir ?? scratch('run'))
  if (runDir !== undefined) opts.runDir = runDir
  return { result: await referee(opts), spec, task, head, linker, runDir }
}

const findingsFor = (result, check) => result.findings.filter((f) => f.check === check)
const settledFor = (result, check) => result.settled.filter((s) => s.check === check)

function theFinding(result, check, leg) {
  const raised = findingsFor(result, check)
  assert.equal(raised.length, 1,
    `${leg}: expected exactly one \`${check}\` finding, saw ${JSON.stringify(raised)}`)
  return raised[0]
}

function theSettledLine(result, check, leg) {
  const lines = settledFor(result, check)
  assert.equal(lines.length, 1,
    `${leg}: expected exactly one settled \`${check}\` line, saw ${JSON.stringify(lines)}`)
  return String(lines[0].detail)
}

const contains = (haystack, needle, leg, what) =>
  assert.ok(String(haystack).includes(needle),
    `${leg}: ${what} (${needle}); saw ${JSON.stringify(haystack)}`)

const RESULT_KEYS = ['findings', 'linker', 'ms', 'n', 'settled', 'task']
const sortedKeys = (o) => Object.keys(o).slice().sort()

// ═══ (a) [M1] the answer's shape ════════════════════════════════════════════
{
  const leg = '(a) [M1] clean-1'
  const { result, task } = await replay('clean-1')
  assert.deepEqual(sortedKeys(result), RESULT_KEYS,
    `${leg}: the result has exactly task, n, findings, settled, linker, ms`)
  assert.equal(result.task, task.id, `${leg}: \`task\` is opts.task.id`)
  assert.equal(result.n, 0, `${leg}: \`n\` is the fix-round count handed in`)
  assert.deepEqual(result.findings, [],
    `${leg}: a patch entirely inside FILES raises nothing, saw ${JSON.stringify(result.findings)}`)
  assert.deepEqual(result.settled.map((s) => s.check).slice().sort(), SETTLED.slice().sort(),
    `${leg}: one settled line per check plus the integrated-suite line and no other, saw ` +
    JSON.stringify(result.settled.map((s) => s.check)))
  assert.deepEqual(result.linker, { 'src/z.ts': 'ts', 'tests/z.test.ts': 'ts' },
    `${leg}: \`linker\` maps the task.files paths by extension, in order`)
  assert.ok(Number.isInteger(result.ms) && result.ms >= 0,
    `${leg}: \`ms\` is a non-negative integer, saw ${JSON.stringify(result.ms)}`)
}

// ═══ (b) [M1] the written record, and the runDir-absent call ════════════════
{
  const leg = '(b) [M1] clean-1'
  const { result, runDir, task } = await replay('clean-1')
  const record = path.join(runDir, 'referee', `task-${task.id}-0.json`)
  assert.ok(fs.existsSync(record),
    `${leg}: the record is written to <runDir>/referee/task-<id>-<n>.json, creating the directory; missing ${record}`)
  const text = fs.readFileSync(record, 'utf8')
  assert.equal(text, `${JSON.stringify(result, null, 2)}\n`,
    `${leg}: the record is byte-equal to JSON.stringify(result, null, 2) + a newline`)
  assert.deepEqual(JSON.parse(text), result, `${leg}: the record parses back to the returned object`)

  // A second call with no `runDir` at all: a fresh directory stays empty, and
  // nothing lands in the clone either.
  const untouched = scratch('untouched')
  const second = await replay('clean-1', { withoutRunDir: true })
  assert.deepEqual(fs.readdirSync(untouched), [],
    `${leg}: with runDir absent the referee writes nothing`)
  assert.ok(!fs.existsSync(path.join(second.head.dir, 'referee')),
    `${leg}: with runDir absent nothing is written into the clone either`)
  assert.deepEqual(sortedKeys(second.result), RESULT_KEYS,
    `${leg}: the runDir-absent call still resolves to the same-shaped object`)
}

// ═══ (c) [M2] the outside-FILES minor — the species the reviewers raised ════
// Each recorded row is a self-authored file dropped beside the reserved exam
// path: the patch touches something neither FILES nor the Proof named.
const OUTSIDE_PATH = {
  'footprint-1': 'tests/snake.impl.test.ts',
  'footprint-2': 'fleet/tests/test_run_engine_exam_fix_edit.mjs',
  'footprint-3': 'tests/test_compile_plan_engine_self_change_impl.py',
  'footprint-4': 'fleet/tests/test_sandbox_boot_selfmerge.mjs',
  'footprint-5': 'tests/kebab.local.test.ts',
}
for (const [name, outside] of Object.entries(OUTSIDE_PATH)) {
  const leg = `(c) [M2] ${name}`
  const { result } = await replay(name)
  const f = theFinding(result, 'footprint', leg)
  assert.equal(f.severity, 'minor',
    `${leg}: a path in neither own nor sibling is a minor finding, saw ${f.severity}`)
  assert.equal(f.actor, 'implementer', `${leg}: actor implementer, saw ${f.actor}`)
  contains(f.detail, outside, leg, 'the detail names the path outside FILES')
}
{
  const { result } = await replay('clean-1')
  assert.deepEqual(findingsFor(result, 'footprint'), [],
    '(c) [M2] clean-1: every touched path is in own, so no footprint finding')
}

// ═══ (d) [M2] the sibling blocking, and the fold overlap that settles ═══════
{
  const leg = '(d) [M2] footprint-6'
  const { result } = await replay('footprint-6')
  const f = theFinding(result, 'footprint', leg)
  assert.equal(f.severity, 'blocking',
    `${leg}: a path in a sibling's FILES and not in own is blocking, saw ${f.severity}`)
  assert.equal(f.actor, 'implementer', `${leg}: actor implementer, saw ${f.actor}`)
  contains(f.detail, 'skills/ultrapowers/references/first-run.md', leg,
    'the finding names the sibling-owned path')
  // The authorized overlap: a path in BOTH own and sibling is the shipped
  // `overlap=fold` case — settled and named, never a finding.
  assert.ok(settledFor(result, 'footprint')
    .some((s) => String(s.detail).includes('skills/ultrapowers/SKILL.md')),
    `${leg}: the settled footprint line names the path present in both, saw ` +
    JSON.stringify(settledFor(result, 'footprint')))
}
{
  const leg = '(d) [M2] clean-2'
  const { result } = await replay('clean-2')
  assert.deepEqual(findingsFor(result, 'footprint'), [],
    `${leg}: the fold overlap raises no footprint finding`)
  assert.ok(settledFor(result, 'footprint').some((s) => String(s.detail).includes('docs/a.md')),
    `${leg}: its settled footprint line names docs/a.md, saw ` +
    JSON.stringify(settledFor(result, 'footprint')))
}

// ═══ (e) [M2] the deleted BASE file — the deletion rule wins, and wins once ══
{
  const leg = '(e) [M2] footprint-7'
  const { result } = await replay('footprint-7')
  const f = theFinding(result, 'footprint', leg)
  assert.equal(f.severity, 'blocking',
    `${leg}: a deleted BASE file absent from FILES is blocking, saw ${f.severity}`)
  assert.equal(f.actor, 'implementer', `${leg}: actor implementer, saw ${f.actor}`)
  contains(f.detail, 'fleet/retire.mjs', leg, 'the detail names the deleted file')
  // Exactly one: the outside-FILES minor is not also raised for the same path.
  assert.equal(findingsFor(result, 'footprint').length, 1,
    `${leg}: the deletion rule wins outright, so the outside-FILES minor is not also raised`)
}

// ═══ (f) [M3] the absent exam file, and who owns it ═════════════════════════
{
  const leg = '(f) [M3] exam-1'
  const { result } = await replay('exam-1')
  const f = theFinding(result, 'exam-files', leg)
  assert.equal(f.severity, 'blocking', `${leg}: an absent Test: path is blocking, saw ${f.severity}`)
  assert.equal(f.actor, 'implementer',
    `${leg}: the absent path is in task.files, so the implementer owns it, saw ${f.actor}`)
}
{
  const leg = '(f) [M3] exam-2'
  const { result } = await replay('exam-2')
  const f = theFinding(result, 'exam-files', leg)
  assert.equal(f.severity, 'blocking', `${leg}: an absent Test: path is blocking, saw ${f.severity}`)
  assert.equal(f.actor, 'plan',
    `${leg}: a Test: path outside own FILES and created by no sibling is a plan defect, saw ${f.actor}`)
}
{
  // The same path listed twice must still be one finding: never two for one path.
  const leg = '(f) [M3] exam-1 with the absent path listed twice'
  const spec = specOf('exam-1')
  const doubled = { ...spec.task, proofTests: [...spec.task.proofTests, ...spec.task.proofTests] }
  const { result } = await replay('exam-1', { task: doubled })
  const f = theFinding(result, 'exam-files', leg)
  assert.equal(f.severity, 'blocking', `${leg}: still exactly one blocking finding`)
}
{
  const leg = "(f) [M3] exam-1 at exam 'green-at-base'"
  const { result } = await replay('exam-1', { exam: 'green-at-base' })
  const f = theFinding(result, 'exam-files', leg)
  assert.equal(f.severity, 'blocking',
    `${leg}: green-at-base is an exam that ran, so the absent path is still one blocking finding`)
}

// ═══ (g) [M3] unexamined, already-red, and the naming of the settled line ═══
{
  const leg = '(g) [M3] exam-3'
  const { result } = await replay('exam-3')
  assert.deepEqual(findingsFor(result, 'exam-files'), [],
    `${leg}: an examiner that was blocked is a driver decision, never the implementer's finding`)
  contains(theSettledLine(result, 'exam-files', leg), 'unexamined', leg,
    'the settled exam-files line says the task proceeds unexamined')
}
{
  const leg = '(g) [M3] exam-4'
  const { result } = await replay('exam-4')
  assert.deepEqual(findingsFor(result, 'exam-files'), [],
    `${leg}: a non-zero examEvidence.exit is the same fact told twice, so no finding`)
  contains(theSettledLine(result, 'exam-files', leg), 'already red as the exam', leg,
    'the settled exam-files line says the exam is already red')
}
{
  const leg = '(g) [M3] clean-1'
  const { result } = await replay('clean-1')
  contains(theSettledLine(result, 'exam-files', leg), 'tests/z.test.ts', leg,
    'every Test: path present at HEAD, so the settled line names them')
}

// ═══ (h) [M4] the linker's `missing` verdict ════════════════════════════════
const MISSING = {
  status: 'missing',
  symbol: 'countVowels',
  detail: 'no export named countVowels in src/x.mjs (found: countVowel)',
}
{
  const leg = '(h) [M4] clean-1 with a missing verdict'
  const { result } = await replay('clean-1', { linker: stubLinker(MISSING) })
  const f = theFinding(result, 'interface', leg)
  assert.equal(f.severity, 'blocking', `${leg}: \`missing\` is blocking, saw ${f.severity}`)
  assert.equal(f.actor, 'implementer', `${leg}: actor implementer, saw ${f.actor}`)
  contains(f.detail, MISSING.symbol, leg, "the detail carries the linker's symbol")
  contains(f.detail, MISSING.detail, leg, "the detail carries the linker's detail")
  contains(f.detail, 'countVowel', leg, "the detail carries the linker's near-miss")
  assert.deepEqual(settledFor(result, 'interface'), [],
    `${leg}: a check that raised a finding settles no line`)
}

// ═══ (i) [M4] the linker's `declared` verdict ═══════════════════════════════
{
  const leg = '(i) [M4] clean-1 with a declared verdict'
  const DECLARED = { status: 'declared', symbol: 'z', detail: 'z is declared but not exported in src/z.ts' }
  const { result } = await replay('clean-1', { linker: stubLinker(DECLARED) })
  const f = theFinding(result, 'interface', leg)
  assert.equal(f.severity, 'minor', `${leg}: \`declared\` is minor, saw ${f.severity}`)
  contains(f.detail, DECLARED.symbol, leg, "the detail carries the linker's symbol")
  contains(f.detail, DECLARED.detail, leg, "the detail carries the linker's detail")
  assert.deepEqual(
    result.findings.filter((x) => x.check === 'interface' && x.severity === 'blocking'), [],
    `${leg}: \`declared\` raises no blocking interface finding`)
}

// ═══ (j) [M4] resolved and unlinked settle; one call per bullet ═════════════
for (const answer of [
  { status: 'resolved', symbol: 'z', detail: 'Produces: `z(a)` resolves to src/z.ts export z/1' },
  { status: 'unlinked', symbol: '', detail: STUB_DETAIL },
]) {
  const leg = `(j) [M4] clean-1 with a ${answer.status} verdict`
  const linker = stubLinker(answer)
  const { result, task, head, spec } = await replay('clean-1', { linker })
  assert.deepEqual(findingsFor(result, 'interface'), [], `${leg}: raises no interface finding`)
  contains(theSettledLine(result, 'interface', leg), answer.detail, leg,
    "the settled interface line carries the linker's detail")
  assert.equal(linker.calls.length, task.interfaces.produces.length,
    `${leg}: opts.linker is called once per Produces: bullet, saw ${linker.calls.length}`)
  assert.equal(linker.calls.length, 1, `${leg}: clean-1 declares exactly one Produces: bullet`)
  assert.equal(linker.calls[0].bullet, spec.task.interfaces.produces[0],
    `${leg}: the bullet goes over verbatim, backticks and all`)
  assert.deepEqual(linker.calls[0].files, task.files, `${leg}: \`files\` is task.files`)
  assert.equal(linker.calls[0].cloneDir, head.dir, `${leg}: \`cloneDir\` is the clone at HEAD`)
  assert.deepEqual(sortedKeys(linker.calls[0]), ['bullet', 'cloneDir', 'files'],
    `${leg}: the linker is called with exactly {bullet, files, cloneDir}, saw ` +
    JSON.stringify(sortedKeys(linker.calls[0])))
}
{
  const leg = '(j) [M4] footprint-2'
  const linker = stubLinker()
  const { result } = await replay('footprint-2', { linker })
  assert.deepEqual(findingsFor(result, 'interface'), [],
    `${leg}: a task with no Produces: entry raises no interface finding`)
  assert.equal(linker.calls.length, 0, `${leg}: with no bullet the linker is never called`)
  assert.equal(theSettledLine(result, 'interface', leg), 'no Produces: to link',
    `${leg}: its settled interface line is exactly \`no Produces: to link\``)
}

// ═══ (k) [M5] the test-count delta ══════════════════════════════════════════
{
  const leg = '(k) [M5] testcount-1'
  const { result } = await replay('testcount-1')
  const f = theFinding(result, 'test-count', leg)
  assert.equal(f.severity, 'minor', `${leg}: a negative delta is minor, saw ${f.severity}`)
  assert.equal(f.actor, 'implementer', `${leg}: actor implementer, saw ${f.actor}`)
  contains(f.detail, 'test_two', leg, 'the finding names the removed test')
}
{
  const leg = '(k) [M5] testcount-2'
  const { result } = await replay('testcount-2')
  assert.deepEqual(findingsFor(result, 'test-count'), [],
    `${leg}: a drop the task's body declares beside the test name is settled, not a finding`)
  contains(theSettledLine(result, 'test-count', leg), `${MINUS}1`, leg,
    `the settled line carries the delta ${MINUS}1, spelled with U+2212`)
}
{
  const leg = '(k) [M5] footprint-3'
  const { result } = await replay('footprint-3')
  contains(theSettledLine(result, 'test-count', leg), `+2 / ${MINUS}0`, leg,
    'two added `def test_` lines settle as a positive delta')
}
{
  const leg = '(k) [M5] footprint-2'
  const { result } = await replay('footprint-2')
  contains(theSettledLine(result, 'test-count', leg), `+0 / ${MINUS}0`, leg,
    'a fleet sim of top-level asserts matches nothing and contributes 0')
}

// ═══ (l) [M6] the dependency manifest ═══════════════════════════════════════
{
  const leg = '(l) [M6] deps-1'
  const { result } = await replay('deps-1')
  const f = theFinding(result, 'dependencies', leg)
  assert.equal(f.severity, 'minor', `${leg}: a manifest hunk is minor, saw ${f.severity}`)
  assert.equal(f.actor, 'implementer', `${leg}: actor implementer, saw ${f.actor}`)
  contains(f.detail, 'package.json', leg, 'the detail names the manifest')
  contains(f.detail, 'left-pad', leg, 'the detail names the added key')
}
// Every other fixture leaves the manifests alone and settles the same line.
for (const name of EXPECTED_FIXTURES.filter((n) => n !== 'deps-1')) {
  const leg = `(l) [M6] ${name}`
  const { result } = await replay(name)
  assert.equal(theSettledLine(result, 'dependencies', leg), 'no manifest changed',
    `${leg}: a patch with no manifest hunk settles \`no manifest changed\``)
}

// ═══ (m) [M7] the secret-shaped literal ═════════════════════════════════════
const GHP = `ghp_${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'}${'0123456789'}`
{
  const leg = '(m) [M7] secrets-1'
  const patchText = fs.readFileSync(path.join(FIXTURES, 'secrets-1', 'patch.diff'), 'utf8')
  assert.ok(patchText.includes(GHP),
    `${leg}: the fixture's patch adds the 40-character ghp_ literal`)
  const { result } = await replay('secrets-1')
  const f = theFinding(result, 'secrets', leg)
  assert.equal(f.severity, 'blocking', `${leg}: a match outside the excluded prefixes is blocking`)
  assert.equal(f.actor, 'implementer', `${leg}: actor implementer, saw ${f.actor}`)
  contains(f.detail, 'src/config.ts', leg, 'the detail names the file')
  contains(f.detail, 'ghp_', leg, 'the detail names the pattern')
  assert.ok(!String(f.detail).includes(GHP),
    `${leg}: the detail reports by pattern name and never echoes the literal, saw ` +
    JSON.stringify(f.detail))
}
{
  const leg = '(m) [M7] secrets-2'
  const { result } = await replay('secrets-2')
  assert.deepEqual(findingsFor(result, 'secrets'), [],
    `${leg}: the same literal under \`tests/\` is test data, not a leak`)
  contains(theSettledLine(result, 'secrets', leg), 'no secret-shaped literal added', leg,
    'the settled secrets line stands')
}
{
  // secrets-1's patch, rewritten in memory: its one added line becomes three,
  // one per remaining pattern. The fixture on disk is not touched.
  const leg = '(m) [M7] secrets-1 rewritten to three patterns'
  const AKIA = `AKIA${'ABCDEFGHIJKLMNOP'}`
  const SK = `sk-${'abcdefghijklmnopqrstuvwx'}`
  const PEM = '-----BEGIN RSA PRIVATE KEY-----'
  const replacements = [
    `  a: '${AKIA}',`,
    `  b: '${SK}',`,
    `  c: '${PEM}',`,
  ]
  const source = fs.readFileSync(path.join(FIXTURES, 'secrets-1', 'patch.diff'), 'utf8')
  const lines = source.split('\n')
  const hunk = lines.findIndex((l) => l.startsWith('@@'))
  const target = lines.findIndex(
    (l, i) => i > hunk && l.startsWith('+') && !l.startsWith('+++') && l.includes(GHP))
  assert.ok(hunk >= 0 && target > hunk,
    `${leg}: the fixture adds the literal on one line inside one hunk`)
  const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(lines[hunk])
  assert.ok(header, `${leg}: the fixture carries a unified-diff hunk header, saw ${lines[hunk]}`)
  const newCount = Number(header[4] === undefined ? 1 : header[4])
  const rewritten = lines.slice()
  rewritten.splice(target, 1, ...replacements.map((r) => `+${r}`))
  rewritten[hunk] = `@@ -${header[1]},${header[2] === undefined ? '1' : header[2]} ` +
    `+${header[3]},${newCount + replacements.length - 1} @@${header[5]}`
  const patchPath = path.join(scratch('patch'), 'three-patterns.diff')
  fs.writeFileSync(patchPath, rewritten.join('\n'))

  const { result } = await replay('secrets-1', { patchPath })
  const raised = findingsFor(result, 'secrets')
  assert.equal(raised.length, 3,
    `${leg}: three added secret-shaped lines raise exactly three findings, saw ${JSON.stringify(raised)}`)
  for (const f of raised) {
    assert.equal(f.severity, 'blocking', `${leg}: each secrets finding is blocking`)
    assert.equal(f.actor, 'implementer', `${leg}: each secrets finding has actor implementer`)
  }
  const details = raised.map((f) => String(f.detail))
  for (const [token, pattern] of [
    ['AKIA[0-9A-Z]{16}', 'AKIA'],
    ['sk-[A-Za-z0-9]{20,}', 'sk-'],
    ['-----BEGIN [A-Z ]*PRIVATE KEY-----', 'PEM private key'],
  ]) {
    assert.equal(details.filter((d) => d.includes(token)).length, 1,
      `${leg}: exactly one finding names the ${pattern} pattern, saw ${JSON.stringify(details)}`)
  }
  for (const literal of [AKIA, SK]) {
    assert.ok(!details.some((d) => d.includes(literal)),
      `${leg}: no detail echoes a matched literal, saw ${JSON.stringify(details)}`)
  }
}

// ═══ (n) [M8] the replay over every fixture ═════════════════════════════════
const fixtures = fs.readdirSync(FIXTURES, { withFileTypes: true })
  .filter((d) => d.isDirectory() && REPLAYED.test(d.name))
  .map((d) => d.name)
  .sort()
assert.deepEqual(fixtures, EXPECTED_FIXTURES,
  '(n) [M8] the replay globs exactly the eighteen fixtures of the six prefixes — the linker-* ' +
  `fixtures belong to the linker sim; saw ${JSON.stringify(fixtures)}`)

for (const name of fixtures) {
  const leg = `(n) [M8] ${name}`
  const { result, task } = await replay(name)
  const expected = expectedOf(name)

  for (const want of expected.findings ?? []) {
    assert.ok(result.findings.some((f) =>
      f.check === want.check && f.severity === want.severity &&
      (want.actor === undefined || f.actor === want.actor)),
      `${leg}: expected.json names the finding ${JSON.stringify(want)}, which the referee did not ` +
      `raise; saw ${JSON.stringify(result.findings)}`)
  }
  for (const want of expected.settled ?? []) {
    assert.ok(result.settled.some(
      (s) => s.check === want.check && String(s.detail).includes(want.contains)),
      `${leg}: expected.json names the settled line ${JSON.stringify(want)}, which the referee did ` +
      `not settle; saw ${JSON.stringify(result.settled)}`)
  }
  if (name.startsWith('clean-')) {
    assert.deepEqual(result.findings, [],
      `${leg}: a clean fixture raises no finding at all, saw ${JSON.stringify(result.findings)}`)
  }

  // The vocabularies REVIEWER_SCHEMA requires, on every fixture.
  for (const f of result.findings) {
    assert.deepEqual(sortedKeys(f), ['actor', 'check', 'detail', 'severity'],
      `${leg}: a finding is exactly {check, severity, actor, detail}, saw ${JSON.stringify(f)}`)
    assert.ok(CHECKS.includes(f.check), `${leg}: \`check\` is one of the six, saw ${f.check}`)
    assert.ok(['blocking', 'minor'].includes(f.severity),
      `${leg}: \`severity\` is blocking or minor, saw ${f.severity}`)
    assert.ok(['implementer', 'plan'].includes(f.actor),
      `${leg}: \`actor\` is implementer or plan, saw ${f.actor}`)
    assert.equal(typeof f.detail, 'string', `${leg}: \`detail\` is a string`)
  }
  for (const s of result.settled) {
    assert.deepEqual(sortedKeys(s), ['check', 'detail'],
      `${leg}: a settled line is exactly {check, detail}, saw ${JSON.stringify(s)}`)
    assert.ok(SETTLED.includes(s.check),
      `${leg}: a settled \`check\` is one of the six plus integrated-suite, saw ${s.check}`)
  }
  // These block names are asserted absent from a prompt that carries no such
  // block, and these lines are rendered into the review prompt.
  for (const line of [...result.findings, ...result.settled]) {
    for (const block of EVIDENCE_BLOCKS) {
      assert.ok(!String(line.detail).includes(block),
        `${leg}: no detail may carry the block name \`${block}\`, saw ${JSON.stringify(line.detail)}`)
    }
  }

  assert.equal(settledFor(result, 'integrated-suite').length, 1,
    `${leg}: one integrated-suite settled line on every call`)
  for (const check of SINGLE) {
    assert.equal(settledFor(result, check).length, findingsFor(result, check).length ? 0 : 1,
      `${leg}: \`${check}\` settles exactly one line when it raised no finding and none when it did`)
  }
  if (findingsFor(result, 'footprint').length === 0) {
    assert.ok(settledFor(result, 'footprint').length >= 1,
      `${leg}: a footprint that raised no finding still settles a line`)
  }

  assert.deepEqual(Object.entries(result.linker),
    task.files.filter((p) => KIND[path.extname(p)]).map((p) => [p, KIND[path.extname(p)]]),
    `${leg}: \`linker\` holds the .mjs/.js, .py and .ts/.tsx paths of task.files in order and nothing else`)

  const order = result.findings.map((f) => CHECKS.indexOf(f.check))
  assert.deepEqual(order, order.slice().sort((a, b) => a - b),
    `${leg}: findings run footprint, interface, exam-files, test-count, dependencies, secrets; saw ` +
    JSON.stringify(result.findings.map((f) => f.check)))
}

// The rig refuses a patch `git apply --check` rejects, so a drifted fixture is
// a refusal rather than a silently-empty replay.
{
  const head = buildHead(path.join(FIXTURES, 'clean-2'))
  const bad = path.join(scratch('patch'), 'does-not-apply.diff')
  fs.writeFileSync(bad,
    'diff --git a/absent.txt b/absent.txt\n--- a/absent.txt\n+++ b/absent.txt\n@@ -1 +1 @@\n-old\n+new\n')
  assert.throws(() => applyPatch(head.dir, bad), /does not apply/,
    '(n) [M8] the replay refuses a patch git apply --check rejects')
}

// The module is driver code: `node:` imports only, no subprocess, no model, no
// git. Comment lines are skipped so this file's own prose does not count.
{
  const leg = '(n) [M8] fleet/referee.mjs'
  const src = fs.readFileSync(MODULE, 'utf8')
  const specifiers = []
  for (const raw of src.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue
    for (const m of line.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) specifiers.push(m[1])
    for (const m of line.matchAll(/^import\s*['"]([^'"]+)['"]/g)) specifiers.push(m[1])
    for (const m of line.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specifiers.push(m[1])
    for (const m of line.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specifiers.push(m[1])
  }
  assert.ok(specifiers.length > 0, `${leg}: the import scan found something to scan`)
  for (const spec of specifiers) {
    assert.ok(spec.startsWith('node:'),
      `${leg}: imports only node: modules — never a sibling, never the engine; saw ${spec}`)
  }
  // No subprocess, no socket: the referee spawns nothing and calls nothing out.
  for (const forbidden of ['child_process', 'execFile', 'execSync', 'spawn', 'fetch(']) {
    assert.ok(!src.includes(forbidden), `${leg}: never mentions ${forbidden}`)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Task 2 (#818) — "A patch the referee cannot read is a loud failure"
//
// A `patchPath` that is given and cannot be read is a loud failure, never a
// clean record. These legs are #818's Proof (a)..(g) against its M1..M4:
//
//   M1  `readPatch(patchPath)`, given a non-empty string whose
//       `fs.readFileSync` throws, throws an `Error` whose message is
//       `referee: cannot read the captured patch <patchPath>: <err.message>`,
//       and `referee({…, patchPath})` rejects with that error.
//   M2  `referee()` called with `patchPath` `undefined`, `null` or `''`
//       rejects with an `Error` whose message contains `no captured patch`
//       and the task id.
//   M3  When `referee()` rejects for either reason, nothing is written:
//       `<runDir>/referee/` does not exist afterwards.
//   M4  A readable `patchPath` behaves as before.
//
// The module guard above (leg (n)) still stands over the rethrow: it adds no
// import, no subprocess and no socket.
// ═══════════════════════════════════════════════════════════════════════════

// The two shared literals the Claim spells out.
const CANNOT_READ = 'referee: cannot read the captured patch '
const NO_PATCH = 'no captured patch'

// The opts `replay` builds for `clean-1`, reused verbatim by the rows that must
// hand `patchPath` over as `undefined`, `null` or `''`: `replay`'s own
// `over.patchPath ?? <fixture>` would substitute the fixture's patch for the
// first two, so those rows call `referee()` directly. `head`, `task` and the
// stub linker are the ones an earlier `replay` already built.
const seed = await replay('clean-1')
const cleanOpts = (patchPath, runDir) => {
  const opts = {
    task: seed.task,
    baseSha: seed.head.base,
    headSha: seed.head.head,
    cloneDir: seed.head.dir,
    siblingFiles: seed.spec.siblingFiles ?? [],
    exam: seed.spec.exam,
    examEvidence: seed.spec.examEvidence,
    n: 0,
    linker: stubLinker(),
    runDir,
  }
  // Assigned last and unconditionally, so `undefined` is handed over as the
  // value of a key that is present — the shape the engine's caller produces.
  opts.patchPath = patchPath
  return opts
}

// ═══ (a) [M1, M3] a patchPath that does not exist ═══════════════════════════
{
  const leg = '(a) [M1, M3] clean-1 with a patchPath that does not exist'
  const runDir = scratch('run')
  const patchPath = path.join(scratch('patch'), 'absent.diff')
  assert.ok(!fs.existsSync(patchPath), `${leg}: the rig never wrote that path`)
  await assert.rejects(
    () => replay('clean-1', { patchPath, runDir }),
    (err) => {
      assert.ok(err instanceof Error,
        `${leg}: the rejection is an Error, saw ${JSON.stringify(String(err))}`)
      assert.ok(String(err.message).startsWith(CANNOT_READ),
        `${leg}: the message starts \`${CANNOT_READ}\`; saw ${JSON.stringify(err.message)}`)
      contains(err.message, patchPath, leg, 'the message names the unreadable path')
      contains(err.message, 'ENOENT', leg, "the underlying error's message travels with it")
      return true
    },
    `${leg}: an unreadable patch rejects rather than replaying an empty one`)
  assert.ok(!fs.existsSync(path.join(runDir, 'referee')),
    `${leg}: [M3] nothing is written — <runDir>/referee does not exist afterwards`)
}

// ═══ (b) [M1, M3] a patchPath that is a directory ═══════════════════════════
{
  const leg = '(b) [M1, M3] clean-1 with a patchPath that is a directory'
  const runDir = scratch('run')
  const dirPath = scratch('dir')
  assert.ok(fs.statSync(dirPath).isDirectory(), `${leg}: the rig made a real directory`)
  await assert.rejects(
    () => replay('clean-1', { patchPath: dirPath, runDir }),
    (err) => {
      assert.ok(err instanceof Error,
        `${leg}: the rejection is an Error, saw ${JSON.stringify(String(err))}`)
      assert.ok(String(err.message).startsWith(CANNOT_READ),
        `${leg}: the message starts \`${CANNOT_READ}\`; saw ${JSON.stringify(err.message)}`)
      contains(err.message, dirPath, leg, "the message names the directory it could not read")
      return true
    },
    `${leg}: a directory is a read that throws, so it rejects too`)
  assert.ok(!fs.existsSync(path.join(runDir, 'referee')),
    `${leg}: [M3] nothing is written — <runDir>/referee does not exist afterwards`)
}

// ═══ (c)(d)(e) [M2] and (f) [M3] the patchPath that was never given ═════════
for (const [letter, label, value] of [
  ['c', 'undefined', undefined],
  ['d', 'null', null],
  ['e', "''", ''],
]) {
  const leg = `(${letter}) [M2] clean-1 called directly with patchPath ${label}`
  const runDir = scratch('run')
  await assert.rejects(
    () => referee(cleanOpts(value, runDir)),
    (err) => {
      assert.ok(err instanceof Error,
        `${leg}: the rejection is an Error, saw ${JSON.stringify(String(err))}`)
      contains(err.message, NO_PATCH, leg,
        `the message says \`${NO_PATCH}\``)
      contains(err.message, seed.task.id, leg,
        'the message names the task the call was for')
      return true
    },
    `${leg}: an absent patchPath is an error, never a clean record`)
  assert.ok(!fs.existsSync(path.join(runDir, 'referee')),
    `(f) [M3] clean-1 with patchPath ${label}: the scratch runDir holds no ` +
    'referee directory afterwards')
}

// ═══ (g) [M4] a readable patch behaves as before ════════════════════════════
{
  const leg = '(g) [M4] clean-1 with the fixture patch'
  const runDir = scratch('run')
  const { result, task } = await replay('clean-1', { runDir })
  assert.deepEqual(result.findings, [],
    `${leg}: the clean-1 replay still yields no finding, saw ${JSON.stringify(result.findings)}`)
  const record = path.join(runDir, 'referee', `task-${task.id}-0.json`)
  assert.ok(fs.existsSync(record),
    `${leg}: and still writes <runDir>/referee/task-<id>-0.json; missing ${record}`)

  const zero = path.join(scratch('patch'), 'zero-byte.diff')
  fs.writeFileSync(zero, '')
  assert.equal(fs.statSync(zero).size, 0, `${leg}: the rig wrote a zero-byte file`)
  const { result: onZero } = await replay('clean-1', { patchPath: zero })
  assert.deepEqual(onZero.findings, [],
    `${leg}: an existing zero-byte patch is readable, so it resolves with no finding, saw ` +
    JSON.stringify(onZero.findings))
}

fs.rmSync(SCRATCH, { recursive: true, force: true })
console.log('ALL TESTS PASSED')

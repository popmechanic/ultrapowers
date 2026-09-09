// fleet/tests/exams/run_69/test_referee_replay.mjs — the exam for "The referee
// grades a captured patch" (task 1).
//
// The referee is driver arithmetic: it reads the captured patch file, the task
// object and the clone at HEAD, and answers with one `referee.json` object.
// This sim replays it over the recorded-reviewer fixtures under
// `fleet/tests/fixtures/referee/` and asserts, leg by leg, the Machine clauses
// M1..M8 of the task.
//
// Everything below the referee is real: real git repos built from each
// fixture's `base/` plus its `patch.diff`, a real temporary `runDir`, a real
// read of the written JSON. Only the linker is stubbed — the referee takes it
// through `opts.linker`, so this sim never imports the sibling linker module.
//
// Amendment 10: every git command here is the sim's own.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { referee } from '../../../referee.mjs'

const FIXTURES = fileURLToPath(new URL('../../fixtures/referee/', import.meta.url))
const REFEREE_SRC = fileURLToPath(new URL('../../../referee.mjs', import.meta.url))

// The minus in a test-count line is U+2212, the same byte sequence in the
// module and in the sim.
const MINUS = '−'

const CHECKS = ['footprint', 'interface', 'exam-files', 'test-count', 'dependencies', 'secrets']
const SETTLED_CHECKS = [...CHECKS, 'integrated-suite']
const SEVERITIES = ['blocking', 'minor']
const ACTORS = ['implementer', 'plan']
// The five checks M1 gives the "exactly one settled line when it raised no
// finding, none when it did" rule. `footprint` has its own rule and is asserted
// where the legs pin it.
const ONE_LINE_CHECKS = ['interface', 'exam-files', 'test-count', 'dependencies', 'secrets']
const EXT = { '.mjs': 'mjs', '.js': 'mjs', '.py': 'py', '.ts': 'ts', '.tsx': 'ts' }
const FIXTURE_RE = /^(footprint|exam|testcount|deps|secrets|clean)-\d+$/
// The eighteen replay fixtures the task's FILES slot creates.
const REQUIRED = [
  'footprint-1', 'footprint-2', 'footprint-3', 'footprint-4', 'footprint-5', 'footprint-6',
  'footprint-7', 'exam-1', 'exam-2', 'exam-3', 'exam-4', 'testcount-1', 'testcount-2',
  'deps-1', 'secrets-1', 'secrets-2', 'clean-1', 'clean-2',
]

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'referee-replay-'))
let seq = 0
const tmpDir = (tag) => {
  seq += 1
  const d = path.join(TMP, tag + '-' + seq)
  fs.mkdirSync(d, { recursive: true })
  return d
}

// ── the rig: build HEAD from `base/` + `patch.diff` with git ────────────────
const git = (argv, cwd) =>
  execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

// Copies `base/` to a temporary directory, commits it as BASE, applies
// `patch.diff` with `git apply --index` and commits that as HEAD. Refuses — by
// throwing — a patch `git apply --check` rejects.
function buildHead(fixtureDir) {
  const dir = tmpDir('head')
  fs.cpSync(path.join(fixtureDir, 'base'), dir, { recursive: true })
  git(['init', '-q', '-b', 'main'], dir)
  git(['config', 'user.email', 'sim@test'], dir)
  git(['config', 'user.name', 'sim'], dir)
  git(['add', '-A'], dir)
  git(['commit', '-q', '-m', 'base'], dir)
  const base = git(['rev-parse', 'HEAD'], dir)
  applyPatch(dir, path.join(fixtureDir, 'patch.diff'))
  git(['commit', '-q', '-m', 'head'], dir)
  const head = git(['rev-parse', 'HEAD'], dir)
  return { dir, base, head }
}

function applyPatch(dir, patchPath) {
  try {
    git(['apply', '--check', patchPath], dir)
  } catch (err) {
    throw new Error('patch does not apply: ' + patchPath + '\n' + (err.stderr || err.message))
  }
  git(['apply', '--index', patchPath], dir)
}

const STUB_DETAIL = 'stub'
// The replay's stub linker, the shared literal from the task's Context.
const makeStub = (answer = { status: 'unlinked', symbol: '', detail: STUB_DETAIL }) => {
  const calls = []
  const fn = async (arg) => {
    calls.push(arg)
    return typeof answer === 'function' ? answer(arg) : answer
  }
  fn.calls = calls
  return fn
}

const readSpec = (name) =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, name, 'task.json'), 'utf8'))

// Calls `referee()` on one fixture. `over` replaces individual opts in memory
// without touching the fixture on disk.
async function run(name, over = {}) {
  const fx = path.join(FIXTURES, name)
  const spec = readSpec(name)
  const head = 'head' in over ? over.head : buildHead(fx)
  const linker = over.linker ?? makeStub()
  const opts = {
    task: over.task ?? spec.task,
    patchPath: over.patchPath ?? path.join(fx, 'patch.diff'),
    baseSha: head.base,
    headSha: head.head,
    cloneDir: head.dir,
    siblingFiles: over.siblingFiles ?? spec.siblingFiles ?? [],
    exam: 'exam' in over ? over.exam : spec.exam,
    examEvidence: 'examEvidence' in over ? over.examEvidence : spec.examEvidence,
    n: over.n ?? 0,
    linker,
  }
  let runDir
  if (over.noRunDir) {
    // M1's "with `runDir` absent": the key is not on the object at all.
  } else {
    runDir = over.runDir ?? tmpDir('run')
    opts.runDir = runDir
  }
  const result = await referee(opts)
  return { result, spec, head, linker, runDir, fx, task: opts.task }
}

const findingsOf = (r, check) => r.findings.filter((f) => f.check === check)
const settledOf = (r, check) => r.settled.filter((s) => s.check === check)
const oneSettled = (r, check, leg) => {
  const lines = settledOf(r, check)
  assert.equal(lines.length, 1, leg + ' expects exactly one settled `' + check + '` line, saw ' +
    JSON.stringify(lines))
  return String(lines[0].detail)
}
const onlyFinding = (r, check, leg) => {
  const found = findingsOf(r, check)
  assert.equal(found.length, 1, leg + ' expects exactly one `' + check + '` finding, saw ' +
    JSON.stringify(found))
  return found[0]
}

// ── (a) [M1] the result shape, on clean-1 ──────────────────────────────────
const clean1Spec = readSpec('clean-1')
{
  const { result, task } = await run('clean-1')
  assert.deepEqual(Object.keys(result).slice().sort(),
    ['findings', 'linker', 'ms', 'n', 'settled', 'task'],
    '(a) [M1] the result has exactly the keys task, n, findings, settled, linker, ms')
  assert.equal(result.task, task.id, '(a) [M1] `task` is `opts.task.id`')
  assert.equal(result.n, 0, '(a) [M1] `n` is the fix-round number handed in')
  assert.deepEqual(result.findings, [], '(a) [M1] clean-1 is entirely inside FILES: no finding')
  assert.deepEqual(result.settled.map((s) => s.check).slice().sort(), SETTLED_CHECKS.slice().sort(),
    '(a) [M1] clean-1 settles one line for each of the six checks plus one integrated-suite line and no other')
  assert.deepEqual(result.linker, { 'src/z.ts': 'ts', 'tests/z.test.ts': 'ts' },
    '(a) [M1] `linker` maps each task.files path by extension, in task.files order, and nothing else')
  assert.ok(Number.isInteger(result.ms) && result.ms >= 0,
    '(a) [M1] `ms` is a non-negative integer, saw ' + JSON.stringify(result.ms))
}

// ── (b) [M1] the written record, and the runDir-absent call ────────────────
{
  const { result, runDir, task } = await run('clean-1')
  const written = path.join(runDir, 'referee', 'task-' + task.id + '-0.json')
  assert.ok(fs.existsSync(written),
    '(b) [M1] the referee writes <runDir>/referee/task-<id>-<n>.json, creating the directory; missing: ' + written)
  const text = fs.readFileSync(written, 'utf8')
  assert.equal(text, JSON.stringify(result, null, 2) + '\n',
    '(b) [M1] the written file is byte-equal to JSON.stringify(result, null, 2) + a newline')
  assert.deepEqual(JSON.parse(text), result, '(b) [M1] the written file parses back to the returned object')

  const fresh = tmpDir('fresh')
  const second = await run('clean-1', { noRunDir: true })
  assert.deepEqual(fs.readdirSync(fresh), [],
    '(b) [M1] with runDir absent the referee writes nothing')
  assert.ok(!fs.existsSync(path.join(second.head.dir, 'referee')),
    '(b) [M1] with runDir absent the referee writes no referee/ directory into the clone either')
  assert.deepEqual(Object.keys(second.result).slice().sort(),
    ['findings', 'linker', 'ms', 'n', 'settled', 'task'],
    '(b) [M1] the runDir-absent call still resolves to an object with the same keys')
}

// ── (c) [M2] the outside-FILES minor, the species the reviewers raised ─────
// The path each fixture's patch touches that its task.files ∪ proofTests does
// not hold, from the fixture table of the task.
const OUTSIDE = {
  'footprint-1': 'tests/snake.impl.test.ts',
  'footprint-2': 'fleet/tests/test_run_engine_exam_fix_edit.mjs',
  'footprint-3': 'tests/test_compile_plan_engine_self_change_impl.py',
  'footprint-4': 'fleet/tests/test_sandbox_boot_selfmerge.mjs',
  'footprint-5': 'tests/kebab.local.test.ts',
}
for (const [name, outside] of Object.entries(OUTSIDE)) {
  const { result } = await run(name)
  const leg = '(c) [M2] ' + name
  const f = onlyFinding(result, 'footprint', leg)
  assert.equal(f.severity, 'minor', leg + ': a touched path in neither own nor sibling is minor')
  assert.equal(f.actor, 'implementer', leg + ': actor implementer')
  assert.ok(String(f.detail).includes(outside),
    leg + ': the detail names the path outside FILES (' + outside + '), saw ' + JSON.stringify(f.detail))
}
{
  const { result } = await run('clean-1')
  assert.deepEqual(findingsOf(result, 'footprint'), [],
    '(c) [M2] clean-1: a patch whose every touched path is in own raises no footprint finding')
}

// ── (d) [M2] the sibling blocking, and the fold overlap that is settled ────
{
  const { result } = await run('footprint-6')
  const f = onlyFinding(result, 'footprint', '(d) [M2] footprint-6')
  assert.equal(f.severity, 'blocking',
    '(d) [M2] footprint-6: a touched path in sibling and not in own is blocking')
  assert.equal(f.actor, 'implementer', '(d) [M2] footprint-6: actor implementer')
  assert.ok(String(f.detail).includes('skills/ultrapowers/references/first-run.md'),
    '(d) [M2] footprint-6: the finding names skills/ultrapowers/references/first-run.md, saw ' +
    JSON.stringify(f.detail))
  assert.ok(settledOf(result, 'footprint').some((s) =>
    String(s.detail).includes('skills/ultrapowers/SKILL.md')),
    '(d) [M2] footprint-6: the path in both own and sibling is settled, and the settled footprint line names it; saw ' +
    JSON.stringify(settledOf(result, 'footprint')))
}
{
  const { result } = await run('clean-2')
  assert.deepEqual(findingsOf(result, 'footprint'), [],
    '(d) [M2] clean-2: the shipped overlap=fold case raises no footprint finding')
  assert.ok(settledOf(result, 'footprint').some((s) => String(s.detail).includes('docs/a.md')),
    '(d) [M2] clean-2: its settled footprint line names docs/a.md, saw ' +
    JSON.stringify(settledOf(result, 'footprint')))
}

// ── (e) [M2] the deleted BASE file — the deletion rule wins, once ──────────
{
  const { result } = await run('footprint-7')
  const f = onlyFinding(result, 'footprint', '(e) [M2] footprint-7')
  assert.equal(f.severity, 'blocking',
    '(e) [M2] footprint-7: a deleted BASE file outside FILES is blocking')
  assert.equal(f.actor, 'implementer', '(e) [M2] footprint-7: actor implementer')
  assert.ok(String(f.detail).includes('fleet/retire.mjs'),
    '(e) [M2] footprint-7: the detail names the deleted file, saw ' + JSON.stringify(f.detail))
}

// ── (f) [M3] the absent exam file, and who owns it ─────────────────────────
{
  const { result } = await run('exam-1')
  const f = onlyFinding(result, 'exam-files', '(f) [M3] exam-1')
  assert.equal(f.severity, 'blocking', '(f) [M3] exam-1: an absent Test: path is blocking')
  assert.equal(f.actor, 'implementer',
    '(f) [M3] exam-1: the absent path is in task.files, so the actor is implementer')
}
{
  const { result } = await run('exam-2')
  const f = onlyFinding(result, 'exam-files', '(f) [M3] exam-2')
  assert.equal(f.severity, 'blocking', '(f) [M3] exam-2: an absent Test: path is blocking')
  assert.equal(f.actor, 'plan',
    '(f) [M3] exam-2: a Test: path outside the task own FILES is a plan defect')
}
{
  const spec = readSpec('exam-1')
  const twice = {
    ...spec.task,
    proofTests: [...spec.task.proofTests, ...spec.task.proofTests],
  }
  const { result } = await run('exam-1', { task: twice })
  const f = onlyFinding(result, 'exam-files', '(f) [M3] exam-1 with the absent path listed twice')
  assert.equal(f.severity, 'blocking',
    '(f) [M3] one finding per absent path, never two for one path')
}
{
  const { result } = await run('exam-1', { exam: 'green-at-base' })
  onlyFinding(result, 'exam-files', '(f) [M3] exam-1 at exam green-at-base')
}

// ── (g) [M3] unexamined, already-red, and the settled naming ───────────────
{
  const { result } = await run('exam-3')
  assert.deepEqual(findingsOf(result, 'exam-files'), [],
    '(g) [M3] exam-3: when exam is blocked no exam-files finding is raised')
  assert.ok(oneSettled(result, 'exam-files', '(g) [M3] exam-3').includes('unexamined'),
    '(g) [M3] exam-3: the settled exam-files line contains `unexamined`')
}
{
  const { result } = await run('exam-4')
  assert.deepEqual(findingsOf(result, 'exam-files'), [],
    '(g) [M3] exam-4: a non-zero examEvidence.exit raises no finding for the absent path')
  assert.ok(oneSettled(result, 'exam-files', '(g) [M3] exam-4').includes('already red as the exam'),
    '(g) [M3] exam-4: the settled exam-files line contains `already red as the exam`')
}
{
  const { result } = await run('clean-1')
  assert.ok(oneSettled(result, 'exam-files', '(g) [M3] clean-1').includes('tests/z.test.ts'),
    '(g) [M3] clean-1: every Test: path present, so the settled line names them')
}

// ── (h) [M4] the linker missing verdict ────────────────────────────────────
const MISSING = {
  status: 'missing',
  symbol: 'countVowels',
  detail: 'no export named countVowels in src/x.mjs (found: countVowel)',
}
{
  const { result } = await run('clean-1', { linker: makeStub(MISSING) })
  const f = onlyFinding(result, 'interface', '(h) [M4] clean-1 with a missing verdict')
  assert.equal(f.severity, 'blocking', '(h) [M4] `missing` maps to an interface blocking finding')
  assert.equal(f.actor, 'implementer', '(h) [M4] actor implementer')
  assert.ok(String(f.detail).includes('countVowels'),
    '(h) [M4] the detail contains the linker symbol, saw ' + JSON.stringify(f.detail))
  assert.ok(String(f.detail).includes(MISSING.detail),
    '(h) [M4] the detail contains the linker detail, saw ' + JSON.stringify(f.detail))
  assert.ok(String(f.detail).includes('countVowel'),
    '(h) [M4] the detail carries the linker near-miss, saw ' + JSON.stringify(f.detail))
}

// ── (i) [M4] the linker declared verdict ───────────────────────────────────
const DECLARED = { status: 'declared', symbol: 'z', detail: 'z declared but not exported in src/z.ts' }
{
  const { result } = await run('clean-1', { linker: makeStub(DECLARED) })
  const f = onlyFinding(result, 'interface', '(i) [M4] clean-1 with a declared verdict')
  assert.equal(f.severity, 'minor', '(i) [M4] `declared` maps to an interface minor finding')
  assert.ok(String(f.detail).includes(DECLARED.symbol) && String(f.detail).includes(DECLARED.detail),
    '(i) [M4] the declared detail contains the symbol and the linker detail, saw ' +
    JSON.stringify(f.detail))
  assert.deepEqual(result.findings.filter((x) => x.check === 'interface' && x.severity === 'blocking'), [],
    '(i) [M4] `declared` raises no blocking interface finding')
}

// ── (j) [M4] resolved and unlinked settle; the call is once per bullet ─────
for (const answer of [
  { status: 'resolved', symbol: 'z', detail: 'Produces: `z(a)` resolves to src/z.ts export z/1' },
  { status: 'unlinked', symbol: '', detail: STUB_DETAIL },
]) {
  const leg = '(j) [M4] clean-1 with a ' + answer.status + ' verdict'
  const linker = makeStub(answer)
  const { result, head, task } = await run('clean-1', { linker })
  assert.deepEqual(findingsOf(result, 'interface'), [], leg + ': raises no interface finding')
  assert.ok(oneSettled(result, 'interface', leg).includes(answer.detail),
    leg + ': the settled interface line carries the linker detail')
  assert.equal(linker.calls.length, task.interfaces.produces.length,
    leg + ': opts.linker is called once per produces entry, saw ' + linker.calls.length)
  assert.equal(linker.calls.length, 1, leg + ': clean-1 has exactly one Produces: bullet')
  assert.equal(linker.calls[0].bullet, clean1Spec.task.interfaces.produces[0],
    leg + ': the bullet is passed verbatim')
  assert.deepEqual(linker.calls[0].files, task.files, leg + ': `files` is task.files')
  assert.equal(linker.calls[0].cloneDir, head.dir, leg + ': `cloneDir` is the clone at HEAD')
}
{
  const linker = makeStub()
  const { result } = await run('footprint-2', { linker })
  assert.deepEqual(findingsOf(result, 'interface'), [],
    '(j) [M4] footprint-2 has no Produces: entry, so no interface finding')
  assert.equal(linker.calls.length, 0, '(j) [M4] footprint-2: the linker is not called at all')
  assert.equal(oneSettled(result, 'interface', '(j) [M4] footprint-2'), 'no Produces: to link',
    '(j) [M4] a task with no produces entry gets the settled line `no Produces: to link`')
}

// ── (k) [M5] the test-count delta ──────────────────────────────────────────
{
  const { result } = await run('testcount-1')
  const f = onlyFinding(result, 'test-count', '(k) [M5] testcount-1')
  assert.equal(f.severity, 'minor', '(k) [M5] testcount-1: a negative delta is a minor finding')
  assert.equal(f.actor, 'implementer', '(k) [M5] testcount-1: actor implementer')
  assert.ok(String(f.detail).includes('test_two'),
    '(k) [M5] testcount-1: the finding names the removed test, saw ' + JSON.stringify(f.detail))
}
{
  const { result } = await run('testcount-2')
  assert.deepEqual(findingsOf(result, 'test-count'), [],
    '(k) [M5] testcount-2: the same drop, declared by a deletion word beside the test name, is settled')
  assert.ok(oneSettled(result, 'test-count', '(k) [M5] testcount-2').includes(MINUS + '1'),
    '(k) [M5] testcount-2: the settled line carries the delta ' + MINUS + '1 (U+2212)')
}
{
  const { result } = await run('footprint-3')
  assert.ok(oneSettled(result, 'test-count', '(k) [M5] footprint-3').includes('+2 / ' + MINUS + '0'),
    '(k) [M5] footprint-3: two added `def test_` lines settle as +2 / ' + MINUS + '0')
}
{
  const { result } = await run('footprint-2')
  assert.ok(oneSettled(result, 'test-count', '(k) [M5] footprint-2').includes('+0 / ' + MINUS + '0'),
    '(k) [M5] footprint-2: a fleet sim of top-level asserts counts 0, settling as +0 / ' + MINUS + '0')
}

// ── (l) [M6] the dependency manifest ───────────────────────────────────────
{
  const { result } = await run('deps-1')
  const f = onlyFinding(result, 'dependencies', '(l) [M6] deps-1')
  assert.equal(f.severity, 'minor', '(l) [M6] deps-1: a manifest hunk is a minor finding')
  assert.equal(f.actor, 'implementer', '(l) [M6] deps-1: actor implementer')
  assert.ok(String(f.detail).includes('package.json'),
    '(l) [M6] deps-1: the detail names the file, saw ' + JSON.stringify(f.detail))
  assert.ok(String(f.detail).includes('left-pad'),
    '(l) [M6] deps-1: the detail names the added key, saw ' + JSON.stringify(f.detail))
}

// ── (m) [M7] the secret-shaped literal ─────────────────────────────────────
const GHP = 'ghp_' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' + '0123456789'
{
  const patchText = fs.readFileSync(path.join(FIXTURES, 'secrets-1', 'patch.diff'), 'utf8')
  assert.ok(patchText.includes(GHP),
    '(m) [M7] secrets-1/patch.diff adds the recorded 40-character ghp_ literal')
  const { result } = await run('secrets-1')
  const f = onlyFinding(result, 'secrets', '(m) [M7] secrets-1')
  assert.equal(f.severity, 'blocking', '(m) [M7] secrets-1: a match outside the excluded prefixes is blocking')
  assert.equal(f.actor, 'implementer', '(m) [M7] secrets-1: actor implementer')
  assert.ok(String(f.detail).includes('src/config.ts'),
    '(m) [M7] secrets-1: the detail names the file, saw ' + JSON.stringify(f.detail))
  assert.ok(String(f.detail).includes('ghp_'),
    '(m) [M7] secrets-1: the detail names the pattern, saw ' + JSON.stringify(f.detail))
  assert.ok(!String(f.detail).includes(GHP),
    '(m) [M7] secrets-1: the detail never echoes the matched literal, saw ' + JSON.stringify(f.detail))
}
{
  const { result } = await run('secrets-2')
  assert.deepEqual(findingsOf(result, 'secrets'), [],
    '(m) [M7] secrets-2: the same literal under `tests/` raises nothing')
  oneSettled(result, 'secrets', '(m) [M7] secrets-2')
}
{
  // The same patch, rewritten in memory: its one added line becomes three,
  // one per remaining pattern.
  const AKIA = 'AKIA' + 'ABCDEFGHIJKLMNOP'
  const SK = 'sk-' + 'abcdefghijklmnopqrstuvwx'
  const PEM = '-----BEGIN RSA PRIVATE KEY-----'
  const patchText = fs.readFileSync(path.join(FIXTURES, 'secrets-1', 'patch.diff'), 'utf8')
  const rewritten = rewriteAddedLine(patchText, GHP, [
    'const a = "' + AKIA + '"',
    'const b = "' + SK + '"',
    'const c = "' + PEM + '"',
  ])
  const patchPath = path.join(tmpDir('patch'), 'three.diff')
  fs.writeFileSync(patchPath, rewritten)
  const { result } = await run('secrets-1', { patchPath })
  const found = findingsOf(result, 'secrets')
  assert.equal(found.length, 3,
    '(m) [M7] three added secret-shaped lines raise exactly three secrets findings, saw ' +
    JSON.stringify(found))
  for (const f of found) {
    assert.equal(f.severity, 'blocking', '(m) [M7] each secrets finding is blocking')
    assert.equal(f.actor, 'implementer', '(m) [M7] each secrets finding has actor implementer')
  }
  const details = found.map((f) => String(f.detail))
  for (const [token, label] of [['AKIA', 'AKIA[0-9A-Z]{16}'], ['sk-', 'sk-[A-Za-z0-9]{20,}'],
    ['PRIVATE KEY', '-----BEGIN [A-Z ]*PRIVATE KEY-----']]) {
    assert.equal(details.filter((d) => d.includes(token)).length, 1,
      '(m) [M7] exactly one finding names the pattern ' + label + ', saw ' + JSON.stringify(details))
  }
  for (const literal of [AKIA, SK]) {
    assert.ok(!details.some((d) => d.includes(literal)),
      '(m) [M7] a secrets detail never echoes the matched literal, saw ' + JSON.stringify(details))
  }
}

function rewriteAddedLine(patchText, literal, replacements) {
  const lines = patchText.split('\n')
  let hunk = -1
  let target = -1
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (l.startsWith('@@')) { hunk = i; continue }
    if (l.startsWith('+') && !l.startsWith('+++') && l.includes(literal)) { target = i; break }
  }
  assert.ok(hunk >= 0 && target > hunk,
    '(m) [M7] secrets-1/patch.diff adds the literal on one line inside a hunk')
  const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(lines[hunk])
  assert.ok(m, '(m) [M7] secrets-1/patch.diff carries a unified-diff hunk header, saw ' + lines[hunk])
  const oldCount = m[2] === undefined ? '1' : m[2]
  const newCount = Number(m[4] === undefined ? 1 : m[4])
  const out = lines.slice()
  out.splice(target, 1, ...replacements.map((r) => '+' + r))
  out[hunk] = '@@ -' + m[1] + ',' + oldCount + ' +' + m[3] + ',' +
    (newCount + replacements.length - 1) + ' @@' + m[5]
  return out.join('\n')
}

// ── (n) [M8] the replay over every fixture, and the module's imports ───────
const dirs = fs.readdirSync(FIXTURES, { withFileTypes: true })
  .filter((d) => d.isDirectory() && FIXTURE_RE.test(d.name))
  .map((d) => d.name)
  .sort()
for (const name of REQUIRED) {
  assert.ok(dirs.includes(name),
    '(n) [M8] the replay fixture ' + name + ' is missing from fleet/tests/fixtures/referee/')
}
assert.equal(dirs.length, 18,
  '(n) [M8] the replay globs exactly the eighteen fixtures of the six prefixes (the linker-* fixtures belong to the linker sim), saw ' +
  JSON.stringify(dirs))

const EVIDENCE_BLOCKS = ['EXAM EVIDENCE', 'RUN EVIDENCE', 'CHECK EVIDENCE']
for (const name of dirs) {
  const leg = '(n) [M8] ' + name
  const { result, task } = await run(name)
  const expected = JSON.parse(fs.readFileSync(path.join(FIXTURES, name, 'expected.json'), 'utf8'))

  for (const e of expected.findings ?? []) {
    assert.ok(result.findings.some((f) =>
      f.check === e.check && f.severity === e.severity &&
      (e.actor === undefined || f.actor === e.actor)),
      leg + ': expected.json names a finding ' + JSON.stringify(e) + ' the referee did not raise; saw ' +
      JSON.stringify(result.findings))
  }
  for (const s of expected.settled ?? []) {
    assert.ok(result.settled.some((l) => l.check === s.check && String(l.detail).includes(s.contains)),
      leg + ': expected.json names a settled line ' + JSON.stringify(s) +
      ' the referee did not settle; saw ' + JSON.stringify(result.settled))
  }
  if (name.startsWith('clean-')) {
    assert.deepEqual(result.findings, [], leg + ': every clean-* fixture raises no finding at all')
  }

  // The vocabularies and the settled bookkeeping of M1, on every fixture.
  for (const f of result.findings) {
    assert.ok(CHECKS.includes(f.check), leg + ': `check` is one of ' + CHECKS.join(', ') + ', saw ' + f.check)
    assert.ok(SEVERITIES.includes(f.severity), leg + ': `severity` is blocking or minor, saw ' + f.severity)
    assert.ok(ACTORS.includes(f.actor), leg + ': `actor` is implementer or plan, saw ' + f.actor)
    assert.equal(typeof f.detail, 'string', leg + ': `detail` is a string')
    assert.deepEqual(Object.keys(f).slice().sort(), ['actor', 'check', 'detail', 'severity'],
      leg + ': a finding is exactly {check, severity, actor, detail}, saw ' + JSON.stringify(f))
  }
  for (const s of result.settled) {
    assert.ok(SETTLED_CHECKS.includes(s.check),
      leg + ': a settled `check` is one of ' + SETTLED_CHECKS.join(', ') + ', saw ' + s.check)
    assert.deepEqual(Object.keys(s).slice().sort(), ['check', 'detail'],
      leg + ': a settled line is exactly {check, detail}, saw ' + JSON.stringify(s))
  }
  for (const line of [...result.findings, ...result.settled]) {
    for (const block of EVIDENCE_BLOCKS) {
      assert.ok(!String(line.detail).includes(block),
        leg + ': no detail may carry the block name `' + block + '`, saw ' + JSON.stringify(line.detail))
    }
  }
  assert.equal(settledOf(result, 'integrated-suite').length, 1,
    leg + ': one integrated-suite settled line on every call')
  for (const check of ONE_LINE_CHECKS) {
    const raised = findingsOf(result, check).length
    assert.equal(settledOf(result, check).length, raised ? 0 : 1,
      leg + ': `' + check + '` settles exactly one line when it raised no finding and none when it did')
  }
  if (findingsOf(result, 'footprint').length === 0) {
    assert.ok(settledOf(result, 'footprint').length >= 1,
      leg + ': a footprint that raised no finding settles a line')
  }

  // M1's `linker` object: the task.files paths of a known extension, in order.
  assert.deepEqual(Object.entries(result.linker),
    task.files.filter((p) => EXT[path.extname(p)]).map((p) => [p, EXT[path.extname(p)]]),
    leg + ': `linker` holds the .mjs/.js -> mjs, .py -> py, .ts/.tsx -> ts paths of task.files in order and nothing else')

  // M1's ordering of findings: footprint, interface, exam-files, test-count,
  // dependencies, secrets.
  const order = result.findings.map((f) => CHECKS.indexOf(f.check))
  assert.deepEqual(order, order.slice().sort((a, b) => a - b),
    leg + ': findings are ordered footprint, interface, exam-files, test-count, dependencies, secrets; saw ' +
    JSON.stringify(result.findings.map((f) => f.check)))
}

// The replay refuses a patch `git apply --check` rejects.
{
  const head = buildHead(path.join(FIXTURES, 'clean-2'))
  const bad = path.join(tmpDir('patch'), 'bad.diff')
  fs.writeFileSync(bad,
    'diff --git a/nope.txt b/nope.txt\n--- a/nope.txt\n+++ b/nope.txt\n@@ -1 +1 @@\n-old\n+new\n')
  assert.throws(() => applyPatch(head.dir, bad), /does not apply/,
    '(n) [M8] the replay refuses a patch git apply --check rejects')
}

// The module is driver code: only `node:` imports, no subprocess.
{
  const src = fs.readFileSync(REFEREE_SRC, 'utf8')
  const specs = []
  for (const raw of src.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue
    for (const m of line.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) specs.push(m[1])
    for (const m of line.matchAll(/^import\s*['"]([^'"]+)['"]/g)) specs.push(m[1])
    for (const m of line.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1])
    for (const m of line.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1])
  }
  for (const spec of specs) {
    assert.ok(spec.startsWith('node:'),
      '(n) [M8] fleet/referee.mjs imports only node: modules — never a sibling, never the engine; saw ' + spec)
  }
  assert.ok(!src.includes('child_process'),
    '(n) [M8] fleet/referee.mjs never mentions child_process')
  assert.ok(!src.includes('execFile'),
    '(n) [M8] fleet/referee.mjs never mentions execFile')
}

fs.rmSync(TMP, { recursive: true, force: true })
console.log('ALL TESTS PASSED')

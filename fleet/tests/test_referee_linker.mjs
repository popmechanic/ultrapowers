// fleet/tests/test_referee_linker.mjs — the sim for the interface linker
// (#729, spec §3.3): `linkProduces({bullet, files, cloneDir, exec, timeoutMs})
// -> Promise<{status, symbol, detail}>` from `fleet/referee-linker.mjs`.
//
// Every case runs against a real checkout the sim builds itself: a temporary
// directory holding a fixture's `base/` tree (or a tree the sim writes
// inline), `git init -q -b main` and one commit — and, when a fixture's
// `patch.diff` is non-empty, `git apply` after that commit. `patch.diff` is
// empty for every linker fixture: HEAD is `base/`. Every git command here is
// the sim's own (Amendment 10), and the temporary directories are removed on
// exit.
//
// The `node` and `python3` subprocesses of M2 and M3 are the real ones,
// because what is graded is the answer the linker gives. A stub `exec` appears
// only where a leg is about the subprocess itself: the argv it issues, or the
// claim that no subprocess ran at all.
//
// Legs, from the task's Proof:
//   (a) M1 — the lead token, the four statuses, the unlinked-without-reading
//       rule, the no-candidate case and the cross-candidate order.
//   (b) M2 — `.mjs`/`.js` by `import()`: `<symbol>/<length>`, the arity floor,
//       `declared, not exported`, the miss detail, a throwing import, the
//       argv, the timeout, and `unlinked` over `missing`.
//   (c) M3 — `.py` by `ast.parse`, never an import.
//   (d) M4 — `.ts`/`.tsx` by export-declaration scan, with no subprocess.
//   (e) M5 — every `fleet/tests/fixtures/referee/linker-*` fixture answers as
//       its `expected.json` says, and the twelve directories are exactly the
//       twelve the task names.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { simEnv } from './_helpers.mjs'

import { defaultExec, linkProduces } from '../referee-linker.mjs'
// Task 1 (#842) reads `PLACEHOLDER_TOKENS` off the module namespace rather than
// as a named import, so that a module which does not export it yet fails the
// one leg that names it instead of failing to link at all.
import * as refereeLinker from '../referee-linker.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(HERE, 'fixtures', 'referee')

let passed = 0
const ok = (label) => {
  passed += 1
  console.log(`ok - ${label}`)
}

// A fixture never needs the timeout to fire; every call but the timeout leg
// passes a bound far above what a fixture needs, so a linker that hangs fails
// this sim in seconds rather than sitting for thirty minutes.
const CALL_TIMEOUT_MS = 20000
const link = (args) => linkProduces({ timeoutMs: CALL_TIMEOUT_MS, ...args })
const detailOf = (r) => String((r && r.detail) || '')
const STATUSES = ['resolved', 'declared', 'missing', 'unlinked']

const shape = (r, where) => {
  assert.ok(r && typeof r === 'object', `${where}: linkProduces resolves to an object`)
  assert.ok(STATUSES.includes(r.status), `${where}: status is one of ${STATUSES.join(', ')} — got ${JSON.stringify(r.status)}`)
  assert.equal(typeof r.symbol, 'string', `${where}: symbol is a string`)
  assert.equal(typeof r.detail, 'string', `${where}: detail is a string`)
  return r
}

// `node` and `python3` may be issued as the bare word or as an absolute path;
// what M2 and M3 pin is which program runs, not how it is spelled.
const isProgram = (spelled, program) =>
  spelled === program || path.basename(String(spelled)) === program

// ── the sim's own git ─────────────────────────────────────────────────────
const ENV = {
  ...simEnv(),
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
  GIT_CONFIG_NOSYSTEM: '1',
}
const git = (argv, cwd) => {
  try {
    return execFileSync('git', argv, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    throw new Error(`git ${argv.join(' ')} in ${cwd} failed: ${String(e.stderr || e.message)}`)
  }
}

const TMP = []
const mkTmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'referee-linker-'))
  TMP.push(dir)
  return dir
}
const cleanup = () => {
  for (const dir of TMP.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
}
process.on('exit', cleanup)

const commitCheckout = (dir) => {
  git(['init', '-q', '-b', 'main'], dir)
  git(['add', '-A'], dir)
  git(['-c', 'user.email=fleet@example.invalid', '-c', 'user.name=fleet', 'commit', '-q', '-m', 'base'], dir)
  return dir
}

// A checkout the sim writes inline: `{clone-relative path: contents}`.
const checkoutOf = (files) => {
  const dir = mkTmp()
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, body)
  }
  return commitCheckout(dir)
}

// A checkout built from a fixture's `base/`, plus its task and expectation.
const fixture = (name) => {
  const home = path.join(FIXTURES, name)
  for (const entry of ['task.json', 'base', 'patch.diff', 'expected.json']) {
    assert.ok(fs.existsSync(path.join(home, entry)),
      `fixture ${name} is missing ${entry} — the layout is task.json, base/, patch.diff, expected.json [M5]`)
  }
  const raw = JSON.parse(fs.readFileSync(path.join(home, 'task.json'), 'utf8'))
  const task = raw.task || raw
  const expected = JSON.parse(fs.readFileSync(path.join(home, 'expected.json'), 'utf8'))

  const dir = mkTmp()
  fs.cpSync(path.join(home, 'base'), dir, { recursive: true })
  commitCheckout(dir)
  const patch = fs.readFileSync(path.join(home, 'patch.diff'), 'utf8')
  if (patch.trim()) git(['apply', path.join(home, 'patch.diff')], dir)

  const produces = (task.interfaces && task.interfaces.produces) || []
  assert.ok(Array.isArray(task.files) && task.files.length > 0,
    `fixture ${name}: task.files is the candidate list the linker is called with [M5]`)
  assert.ok(Array.isArray(produces) && produces.length > 0,
    `fixture ${name}: task.interfaces.produces holds the bullets this fixture answers [M5]`)
  return { name, dir, task, produces, expected }
}

// ── leg (a): M1, the lead token and the four statuses ─────────────────────
{
  const mjs1 = fixture('linker-mjs-1')
  const first = await link({ bullet: mjs1.produces[0], files: mjs1.task.files, cloneDir: mjs1.dir })
  shape(first, 'leg (a) linker-mjs-1[0]')
  assert.equal(first.symbol, 'foo',
    `[M1] the lead token of linker-mjs-1's first bullet is foo, the wrapping backtick removed — got ${JSON.stringify(first.symbol)}`)
  assert.equal(first.status, 'resolved',
    `[M1] … and it answers resolved — got ${first.status} (${detailOf(first)})`)
  ok('leg (a) [M1] the first bullet of linker-mjs-1 is foo, resolved')

  // A stub that throws is the proof that no subprocess ran.
  const boom = () => { throw new Error('[M1] no subprocess may run for an unlinkable symbol') }

  const unlinked1 = fixture('linker-unlinked-1')
  const dotted = await link({ bullet: unlinked1.produces[0], files: unlinked1.task.files, cloneDir: unlinked1.dir, exec: boom })
  shape(dotted, 'leg (a) report.reviewEconomy')
  assert.equal(dotted.symbol, 'report.reviewEconomy',
    `[M1] the lead token carries its dots — got ${JSON.stringify(dotted.symbol)}`)
  assert.equal(dotted.status, 'unlinked',
    `[M1] a symbol that does not match ^[A-Za-z_]\\w*$ is unlinked without any file being read — got ${dotted.status} (${detailOf(dotted)})`)
  ok('leg (a) [M1] the dotted bullet report.reviewEconomy is unlinked, no subprocess')

  const unlinked2 = fixture('linker-unlinked-2')
  const shell = await link({ bullet: unlinked2.produces[0], files: unlinked2.task.files, cloneDir: unlinked2.dir })
  shape(shell, 'leg (a) record_tags()')
  assert.equal(shell.symbol, 'record_tags',
    `[M1] the lead token of record_tags() is record_tags — got ${JSON.stringify(shell.symbol)}`)
  assert.equal(shell.status, 'unlinked',
    `[M1] a shell-function symbol whose only candidate file is .sh is unlinked — got ${shell.status} (${detailOf(shell)})`)
  assert.ok(detailOf(shell).includes('fleet/sandbox-boot.sh'),
    `[M1] … with a detail naming the reason, the file among them — got ${JSON.stringify(detailOf(shell))}`)
  ok('leg (a) [M1] record_tags() over a .sh is unlinked with the reason')

  const assigned = await link({ bullet: '`X = 1`', files: mjs1.task.files, cloneDir: mjs1.dir, exec: boom })
  shape(assigned, 'leg (a) X = 1')
  assert.equal(assigned.symbol, 'X', '[M1] the lead token of `X = 1` is X')
  assert.equal(assigned.status, 'unlinked',
    `[M1] a symbol followed, after optional spaces, by = is unlinked without any file being read — got ${assigned.status} (${detailOf(assigned)})`)

  const slashed = await link({ bullet: '`path/to/thing`', files: mjs1.task.files, cloneDir: mjs1.dir, exec: boom })
  shape(slashed, 'leg (a) path/to/thing')
  assert.equal(slashed.symbol, 'path', '[M1] the lead token of `path/to/thing` is path')
  assert.equal(slashed.status, 'unlinked',
    `[M1] a symbol followed by / is unlinked without any file being read — got ${slashed.status} (${detailOf(slashed)})`)

  const colon = await link({ bullet: '`kind: run.started`', files: mjs1.task.files, cloneDir: mjs1.dir, exec: boom })
  shape(colon, 'leg (a) kind: run.started')
  assert.equal(colon.status, 'unlinked',
    `[M1] a symbol followed by : is unlinked without any file being read — got ${colon.status} (${detailOf(colon)})`)
  ok('leg (a) [M1] a bullet whose symbol is followed by =, / or : is unlinked, no subprocess')

  const noExt = await link({ bullet: '`foo(a)`', files: ['README.md', 'fleet/sandbox-boot.sh'], cloneDir: mjs1.dir })
  shape(noExt, 'leg (a) no linkable extension')
  assert.equal(noExt.status, 'unlinked',
    `[M1] a files list with no linkable extension leaves no candidate, which is unlinked — got ${noExt.status} (${detailOf(noExt)})`)
  assert.ok(detailOf(noExt).length > 0, '[M1] … with a detail naming the reason')
  ok('leg (a) [M1] a files list with no linkable extension is unlinked with the reason')

  const mixed = checkoutOf({
    'src/foo.mjs': 'export function foo (a, b) { return a + b }\n',
    'pkg/mod.py': 'def bar():\n    return 1\n',
  })
  const best = await link({ bullet: '`foo(a, b) -> Widget`', files: ['pkg/mod.py', 'src/foo.mjs'], cloneDir: mixed })
  shape(best, 'leg (a) resolved beside missing')
  assert.equal(best.status, 'resolved',
    `[M1] across candidates resolved wins: a .mjs that resolves beside a .py where the name is missing answers resolved — got ${best.status} (${detailOf(best)})`)
  ok('leg (a) [M1] resolved wins over missing across candidates')
}

// ── leg (b): M2, the `.mjs`/`.js` linker ──────────────────────────────────
{
  const mjs1 = fixture('linker-mjs-1')

  const exact = await link({ bullet: '`foo(a, b)`', files: mjs1.task.files, cloneDir: mjs1.dir })
  shape(exact, 'leg (b) foo(a, b)')
  assert.equal(exact.status, 'resolved',
    `[M2] has true is resolved — got ${exact.status} (${detailOf(exact)})`)
  assert.ok(detailOf(exact).includes('src/foo.mjs') && detailOf(exact).includes('foo/2'),
    `[M2] … with a detail naming the file and <symbol>/<length> — got ${JSON.stringify(detailOf(exact))}`)
  ok('leg (b) [M2] linker-mjs-1 resolves foo(a, b) with foo/2 in the detail')

  const low = await link({ bullet: '`foo(a)`', files: mjs1.task.files, cloneDir: mjs1.dir })
  shape(low, 'leg (b) foo(a)')
  assert.equal(low.status, 'declared',
    `[M2] a bullet arity below length is declared — got ${low.status} (${detailOf(low)})`)
  assert.ok(detailOf(low).includes('arity'),
    `[M2] … with a detail naming both counts — got ${JSON.stringify(detailOf(low))}`)
  assert.ok(detailOf(low).includes('foo/2') && /\b1\b/.test(detailOf(low)),
    `[M2] … the export's 2 and the bullet's 1 — got ${JSON.stringify(detailOf(low))}`)
  ok('leg (b) [M2] a bullet arity below length is declared with both counts')

  const high = await link({ bullet: '`foo(a, b, c)`', files: mjs1.task.files, cloneDir: mjs1.dir })
  shape(high, 'leg (b) foo(a, b, c)')
  assert.equal(high.status, 'resolved',
    `[M2] a bullet arity above length is still resolved — rest and default parameters make length a floor — got ${high.status} (${detailOf(high)})`)
  ok('leg (b) [M2] a bullet arity above length is still resolved')

  const mjs2 = fixture('linker-mjs-2')
  const declared = await link({ bullet: mjs2.produces[0], files: mjs2.task.files, cloneDir: mjs2.dir })
  shape(declared, 'leg (b) linker-mjs-2')
  assert.equal(declared.status, 'declared',
    `[M2] has false with the name in the candidate's text is declared — got ${declared.status} (${detailOf(declared)})`)
  assert.ok(detailOf(declared).includes('declared, not exported'),
    `[M2] … with the detail "declared, not exported" — got ${JSON.stringify(detailOf(declared))}`)
  ok('leg (b) [M2] linker-mjs-2 is declared, not exported')

  const mjs3 = fixture('linker-mjs-3')
  const miss = await link({ bullet: mjs3.produces[0], files: mjs3.task.files, cloneDir: mjs3.dir })
  shape(miss, 'leg (b) linker-mjs-3')
  assert.equal(miss.status, 'missing',
    `[M2] a renamed export is missing — got ${miss.status} (${detailOf(miss)})`)
  assert.equal(detailOf(miss), 'no export named countVowels in src/foo.mjs (found: countVowel)',
    `[M2] … with the miss wording the referee's blocking finding carries verbatim — got ${JSON.stringify(detailOf(miss))}`)
  ok('leg (b) [M2] a renamed export is missing with both names in the detail')

  const mjs4 = fixture('linker-mjs-4')
  const threw = await link({ bullet: mjs4.produces[0], files: mjs4.task.files, cloneDir: mjs4.dir })
  shape(threw, 'leg (b) linker-mjs-4')
  assert.equal(threw.status, 'unlinked',
    `[M2] a subprocess that exits non-zero is unlinked, never a finding status — got ${threw.status} (${detailOf(threw)})`)
  assert.ok(detailOf(threw).includes('boom'),
    `[M2] … with the detail carrying the first line of its stderr — got ${JSON.stringify(detailOf(threw))}`)
  ok('leg (b) [M2] an import that throws is unlinked with the throw in the detail')

  // The argv the linker issues for a `.mjs` candidate.
  const calls = []
  const recorder = (cmd, argv, opts) => {
    calls.push({ cmd, argv: Array.isArray(argv) ? argv.slice() : argv, opts: opts || {} })
    return Promise.resolve({ code: 0, stdout: `${JSON.stringify({ has: true, length: 2, names: ['foo'] })}\n`, stderr: '' })
  }
  await link({ bullet: '`foo(a, b)`', files: mjs1.task.files, cloneDir: mjs1.dir, exec: recorder })
  assert.equal(calls.length, 1, `[M2] one subprocess per candidate — got ${calls.length}`)
  const argv = [calls[0].cmd, ...(calls[0].argv || [])].map(String)
  assert.ok(isProgram(argv[0], 'node'), `[M2] the argv begins node — got ${JSON.stringify(argv[0])}`)
  assert.equal(argv[1], '--input-type=module', `[M2] … then --input-type=module — got ${JSON.stringify(argv[1])}`)
  assert.equal(argv[2], '-e', `[M2] … then -e — got ${JSON.stringify(argv[2])}`)
  assert.ok(argv.join(' ').includes('file://') && argv.join(' ').includes('foo.mjs'),
    "[M2] the script dynamically imports the candidate's file URL")
  for (const forbidden of ['bash', 'sh', '-lc', 'git']) {
    assert.ok(!argv.includes(forbidden),
      `[M2] the module runs only that script — never bash -lc, never git — found ${JSON.stringify(forbidden)}`)
  }
  assert.equal(calls[0].opts.cwd, mjs1.dir,
    `[M2] the subprocess cwd is cloneDir — got ${JSON.stringify(calls[0].opts.cwd)}`)
  ok('leg (b) [M2] the argv is node --input-type=module -e <script>, cwd cloneDir')

  // The timeout: a module scope that neither exits nor prints.
  const HANG = [
    '// Neither exits nor prints: the interval keeps the loop alive and the',
    '// awaited promise never settles.',
    'setInterval(() => {}, 1000)',
    'export function foo (a) { return a }',
    'await new Promise(() => {})',
    '',
  ].join('\n')
  const hung = checkoutOf({ 'src/hang.mjs': HANG, 'src/quiet.mjs': 'export const other = 1\n' })

  const started = Date.now()
  const timedOut = await linkProduces({ bullet: '`foo(a)`', files: ['src/hang.mjs'], cloneDir: hung, timeoutMs: 500 })
  const elapsed = Date.now() - started
  shape(timedOut, 'leg (b) timeout')
  assert.equal(timedOut.status, 'unlinked',
    `[M2] a subprocess killed at the timeout is unlinked — got ${timedOut.status} (${detailOf(timedOut)})`)
  assert.ok(/timeout/i.test(detailOf(timedOut)),
    `[M2] … with timeout in the detail — got ${JSON.stringify(detailOf(timedOut))}`)
  assert.ok(elapsed < 5000, `[M2] … and the answer comes back within five seconds — took ${elapsed}ms`)
  ok('leg (b) [M2] a module that neither exits nor prints is unlinked at the timeout')

  const beside = await linkProduces({ bullet: '`foo(a)`', files: ['src/quiet.mjs', 'src/hang.mjs'], cloneDir: hung, timeoutMs: 500 })
  shape(beside, 'leg (b) unlinked over missing')
  assert.equal(beside.status, 'unlinked',
    `[M2] unlinked wins over missing: a candidate that hung beside one where the name is absent answers unlinked — got ${beside.status} (${detailOf(beside)})`)
  ok('leg (b) [M2] a hung candidate beside a clean miss answers unlinked, not missing')
}

// ── leg (c): M3, the `.py` linker ─────────────────────────────────────────
{
  const py1 = fixture('linker-py-1')
  const resolved = await link({ bullet: py1.produces[0], files: py1.task.files, cloneDir: py1.dir })
  shape(resolved, 'leg (c) linker-py-1')
  assert.equal(resolved.status, 'resolved',
    `[M3] a top-level def equal to the symbol is resolved — got ${resolved.status} (${detailOf(resolved)})`)
  assert.ok(detailOf(resolved).includes('foo/2'),
    `[M3] … with the count of positional parameters without defaults — got ${JSON.stringify(detailOf(resolved))}`)
  ok('leg (c) [M3] linker-py-1 resolves a top-level def')

  const shallow = await link({ bullet: '`foo(a)`', files: py1.task.files, cloneDir: py1.dir })
  assert.equal(shallow.status, 'declared',
    `[M3] the arity floor rule of M2 applies to that count — got ${shallow.status} (${detailOf(shallow)})`)
  ok('leg (c) [M3] the arity floor rule applies to a Python def')

  const py2 = fixture('linker-py-2')
  const declared = await link({ bullet: py2.produces[0], files: py2.task.files, cloneDir: py2.dir })
  shape(declared, 'leg (c) linker-py-2')
  assert.equal(declared.status, 'declared',
    `[M3] the name in the text without a top-level definition is declared — got ${declared.status} (${detailOf(declared)})`)
  ok('leg (c) [M3] a nested def is declared, not resolved')

  const py3 = fixture('linker-py-3')
  const miss = await link({ bullet: py3.produces[0], files: py3.task.files, cloneDir: py3.dir })
  shape(miss, 'leg (c) linker-py-3')
  assert.equal(miss.status, 'missing', `[M3] otherwise missing — got ${miss.status} (${detailOf(miss)})`)
  for (const needle of ['foo', 'pkg/mod.py', '(found: bar)']) {
    assert.ok(detailOf(miss).includes(needle),
      `[M3] the miss detail names the symbol, the file and what that file does define — ${JSON.stringify(needle)} is not in ${JSON.stringify(detailOf(miss))}`)
  }
  ok('leg (c) [M3] linker-py-3 is missing, naming foo and pkg/mod.py')

  const calls = []
  const recorder = (cmd, argv, opts) => {
    calls.push({ cmd, argv: Array.isArray(argv) ? argv.slice() : argv, opts: opts || {} })
    return Promise.resolve({ code: 0, stdout: `${JSON.stringify({ names: ['foo'], arity: { foo: 2 } })}\n`, stderr: '' })
  }
  await link({ bullet: py1.produces[0], files: py1.task.files, cloneDir: py1.dir, exec: recorder })
  assert.equal(calls.length, 1, `[M3] one subprocess per candidate — got ${calls.length}`)
  const argv = [calls[0].cmd, ...(calls[0].argv || [])].map(String)
  assert.ok(isProgram(argv[0], 'python3'), `[M3] the argv begins python3 — got ${JSON.stringify(argv[0])}`)
  assert.equal(argv[1], '-c', `[M3] … then -c — got ${JSON.stringify(argv[1])}`)
  assert.ok(!argv.includes('-m'), '[M3] no argv element is -m — the file is never imported')
  for (const element of argv) {
    assert.ok(!element.includes('import pkg'),
      `[M3] no argv element names "import pkg" — the file is ast.parsed, never imported — found ${JSON.stringify(element)}`)
  }
  assert.ok(argv.join(' ').includes('ast'), '[M3] the script ast.parses the file')
  assert.equal(calls[0].opts.cwd, py1.dir,
    `[M3] the subprocess cwd is cloneDir — got ${JSON.stringify(calls[0].opts.cwd)}`)
  ok('leg (c) [M3] the argv is python3 -c <ast script>, never -m and never an import')
}

// ── leg (d): M4, the `.ts`/`.tsx` scan ────────────────────────────────────
{
  // The fixtures never create `node_modules/typescript`, so `tsc` never runs:
  // a throwing `exec` is the proof that no subprocess was spawned at all.
  const boom = () => { throw new Error('[M4] no subprocess may run for a .ts candidate without node_modules/typescript') }

  const ts1 = fixture('linker-ts-1')
  const resolved = await link({ bullet: ts1.produces[0], files: ts1.task.files, cloneDir: ts1.dir, exec: boom })
  shape(resolved, 'leg (d) linker-ts-1')
  assert.equal(resolved.status, 'resolved',
    `[M4] export function foo(…) is resolved — got ${resolved.status} (${detailOf(resolved)})`)
  ok('leg (d) [M4] linker-ts-1 resolves an exported function, no subprocess')

  const low = await link({ bullet: '`foo(a)`', files: ts1.task.files, cloneDir: ts1.dir, exec: boom })
  shape(low, 'leg (d) linker-ts-1 foo(a)')
  assert.equal(low.status, 'declared',
    `[M4] arity counts the entries without ? or =, floor rule — a bullet arity of 1 below 2 is declared — got ${low.status} (${detailOf(low)})`)
  assert.ok(detailOf(low).includes('arity'), `[M4] … with arity in the detail — got ${JSON.stringify(detailOf(low))}`)
  ok('leg (d) [M4] the arity floor rule applies to a .ts parameter list')

  const ts2 = fixture('linker-ts-2')
  const declared = await link({ bullet: ts2.produces[0], files: ts2.task.files, cloneDir: ts2.dir, exec: boom })
  shape(declared, 'leg (d) linker-ts-2')
  assert.equal(declared.status, 'declared',
    `[M4] the name present without an export declaration is declared — got ${declared.status} (${detailOf(declared)})`)
  ok('leg (d) [M4] linker-ts-2 is declared, not exported')

  const ts3 = fixture('linker-ts-3')
  const miss = await link({ bullet: ts3.produces[0], files: ts3.task.files, cloneDir: ts3.dir, exec: boom })
  shape(miss, 'leg (d) linker-ts-3')
  assert.equal(miss.status, 'missing', `[M4] otherwise missing — got ${miss.status} (${detailOf(miss)})`)
  for (const needle of ['foo', 'src/foo.ts', '(found: bar)']) {
    assert.ok(detailOf(miss).includes(needle),
      `[M4] the miss detail names the symbol, the file and what it does export — ${JSON.stringify(needle)} is not in ${JSON.stringify(detailOf(miss))}`)
  }
  ok('leg (d) [M4] linker-ts-3 is missing, naming foo and src/foo.ts')

  const listed = checkoutOf({ 'src/named.ts': 'function foo() {}\nexport { foo }\n' })
  const viaList = await link({ bullet: '`foo()`', files: ['src/named.ts'], cloneDir: listed, exec: boom })
  shape(viaList, 'leg (d) export { foo }')
  assert.equal(viaList.status, 'resolved',
    `[M4] a name inside an export { … } list is resolved — got ${viaList.status} (${detailOf(viaList)})`)

  const dflt = checkoutOf({ 'src/dflt.ts': 'export default function foo() {}\n' })
  const viaDefault = await link({ bullet: '`foo()`', files: ['src/dflt.ts'], cloneDir: dflt, exec: boom })
  shape(viaDefault, 'leg (d) export default function foo')
  assert.equal(viaDefault.status, 'resolved',
    `[M4] export default function <symbol>( is resolved — got ${viaDefault.status} (${detailOf(viaDefault)})`)
  ok('leg (d) [M4] export { foo } and export default function foo both resolve')
}

// ── leg (e): M5, every fixture answers as its expected.json says ──────────
// The status column of the task's own fixture table, one entry per produces
// bullet in order.
const TABLE = {
  'linker-mjs-1': ['resolved', 'declared'],
  'linker-mjs-2': ['declared'],
  'linker-mjs-3': ['missing'],
  'linker-mjs-4': ['unlinked'],
  'linker-py-1': ['resolved'],
  'linker-py-2': ['declared'],
  'linker-py-3': ['missing'],
  'linker-ts-1': ['resolved'],
  'linker-ts-2': ['declared'],
  'linker-ts-3': ['missing'],
  'linker-unlinked-1': ['unlinked'],
  'linker-unlinked-2': ['unlinked'],
}

{
  assert.ok(fs.existsSync(FIXTURES), '[M5] the fixture root fleet/tests/fixtures/referee exists')
  const dirs = fs.readdirSync(FIXTURES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('linker-'))
    .map((d) => d.name)
    .sort()
  assert.deepEqual(dirs, Object.keys(TABLE).slice().sort(),
    `[M5] the twelve linker-* directories are exactly the twelve the task names — got ${JSON.stringify(dirs)}`)
  ok(`leg (e) [M5] the fixture directories are exactly the twelve the task names (${dirs.length})`)

  for (const name of dirs) {
    const fx = fixture(name)
    const results = (fx.expected && fx.expected.results) || []
    assert.ok(Array.isArray(results), `[M5] ${name}/expected.json is {"results": [...]}`)
    assert.equal(results.length, fx.produces.length,
      `[M5] ${name} has one expected result per produces bullet, in order — ${results.length} results for ${fx.produces.length} bullets`)
    assert.deepEqual(results.map((r) => r.status), TABLE[name],
      `[M5] ${name} expects the statuses the task's fixture table gives it — got ${JSON.stringify(results.map((r) => r.status))}`)

    for (let i = 0; i < fx.produces.length; i++) {
      const want = results[i]
      const got = await link({ bullet: fx.produces[i], files: fx.task.files, cloneDir: fx.dir })
      const where = `[M5] ${name} bullet ${JSON.stringify(fx.produces[i])}`
      shape(got, where)
      assert.equal(got.symbol, want.symbol,
        `${where} answers symbol ${JSON.stringify(want.symbol)} — got ${JSON.stringify(got.symbol)}`)
      assert.equal(got.status, want.status,
        `${where} answers status ${JSON.stringify(want.status)} — got ${got.status} (${detailOf(got)})`)
      const needles = want.contains == null ? [] : (Array.isArray(want.contains) ? want.contains : [want.contains])
      for (const needle of needles) {
        assert.ok(detailOf(got).includes(needle),
          `${where} answers a detail containing ${JSON.stringify(needle)} — got ${JSON.stringify(detailOf(got))}`)
      }
    }
    ok(`leg (e) [M5] ${name} answers as its expected.json says`)
  }
}

// ── Task 3: a files entry cannot leave the clone, and the timeout detail ──
// ── names its bound (#819) ────────────────────────────────────────────────
// M1. In `linkProduces`, a `files` entry whose `abs = path.resolve(cloneDir,
//     rel)` neither equals `path.resolve(cloneDir)` nor begins with
//     `path.resolve(cloneDir) + path.sep` is pushed to `skipped` as
//     `<rel>: outside the clone` before the filesystem is consulted for it and
//     never becomes a candidate, so `exec` is not called for it — for a
//     relative entry that climbs out and for an absolute entry alike, whether
//     or not the file exists.
// M2. When every entry is skipped the answer is `unlinked` with a detail
//     carrying each skipped entry's `<rel>: outside the clone`; when an
//     in-clone candidate remains beside an escaping entry, the answer is that
//     candidate's own and `exec` is called exactly once, for the in-clone file.
// M3. In `linkMjs` and `linkPy`, a subprocess result with no JSON line whose
//     `stderr` is empty after trimming answers `unlinked` with the detail
//     `<rel>: <node|python3> produced no JSON within <timeoutMs>ms`, whatever
//     `code` is; `killed` or `signal` keeps `<rel>: timeout after <ms>ms`, and
//     a non-empty `stderr` keeps its first line, as before.
{
  // A stub that throws is this group's proof that no subprocess ran for an
  // entry that resolves outside the clone.
  const boom = () => {
    throw new Error('[M1] no subprocess may run for a files entry that resolves outside the clone')
  }
  const resolves = async (thunk, where) => {
    try {
      return await thunk()
    } catch (e) {
      assert.fail(`${where}: linkProduces resolves rather than throwing — it rejected with ${String((e && e.message) || e)} [M1]`)
      return null
    }
  }

  const ESCAPE_BODY = 'export function foo (a) { return a }\n'
  const STRAY = []
  const removeStray = () => {
    for (const file of STRAY.splice(0)) {
      try { fs.rmSync(file, { force: true }) } catch { /* already gone */ }
    }
  }
  process.on('exit', removeStray)
  // `escape.mjs` lives in the PARENT of the clone directory, so that at BASE
  // the entry resolves to a file that exists, becomes a candidate and fires
  // the throwing stub. The rule under test is the path, not the file.
  const escapeBeside = (cloneDir) => {
    const abs = path.resolve(path.join(cloneDir, '..', 'escape.mjs'))
    fs.writeFileSync(abs, ESCAPE_BODY)
    STRAY.push(abs)
    return abs
  }

  // (a) a relative entry that climbs out of the clone.
  {
    const clone = checkoutOf({ 'src/foo.mjs': ESCAPE_BODY })
    escapeBeside(clone)
    const r = await resolves(
      () => link({ bullet: '`foo(a)`', files: ['../escape.mjs'], cloneDir: clone, exec: boom }),
      'leg (a) ../escape.mjs')
    shape(r, 'leg (a) ../escape.mjs')
    assert.equal(r.status, 'unlinked',
      `[M1, M2] an entry that climbs out of the clone leaves no candidate, which is unlinked — got ${r.status} (${detailOf(r)})`)
    assert.ok(detailOf(r).includes('../escape.mjs: outside the clone'),
      `[M1, M2] … with the detail carrying "../escape.mjs: outside the clone" — got ${JSON.stringify(detailOf(r))}`)
    ok('task 3 (a) [M1, M2] ../escape.mjs is skipped as outside the clone, no subprocess')
  }

  // (b) the same file named by its absolute path.
  {
    const clone = checkoutOf({ 'src/foo.mjs': ESCAPE_BODY })
    const abs = escapeBeside(clone)
    const r = await resolves(
      () => link({ bullet: '`foo(a)`', files: [abs], cloneDir: clone, exec: boom }),
      'leg (b) absolute escape.mjs')
    shape(r, 'leg (b) absolute escape.mjs')
    assert.equal(r.status, 'unlinked',
      `[M1, M2] an absolute entry outside the clone is skipped alike — got ${r.status} (${detailOf(r)})`)
    assert.ok(detailOf(r).includes('outside the clone'),
      `[M1, M2] … with "outside the clone" in the detail — got ${JSON.stringify(detailOf(r))}`)
    assert.ok(detailOf(r).includes(abs),
      `[M1, M2] … and the absolute path it was given — got ${JSON.stringify(detailOf(r))}`)
    assert.ok(detailOf(r).includes(`${abs}: outside the clone`),
      `[M1] the skip is pushed as "<rel>: outside the clone" — got ${JSON.stringify(detailOf(r))}`)
    ok('task 3 (b) [M1, M2] an absolute entry outside the clone is skipped by name')
  }

  // (c) two escaping entries: every one of them is named in the detail.
  {
    const clone = checkoutOf({ 'src/foo.mjs': ESCAPE_BODY })
    escapeBeside(clone)
    const r = await resolves(
      () => link({ bullet: '`foo(a)`', files: ['../escape.mjs', '/etc/passwd'], cloneDir: clone, exec: boom }),
      'leg (c) ../escape.mjs + /etc/passwd')
    shape(r, 'leg (c) ../escape.mjs + /etc/passwd')
    assert.equal(r.status, 'unlinked',
      `[M1, M2] when every entry is skipped the answer is unlinked — got ${r.status} (${detailOf(r)})`)
    assert.ok(detailOf(r).includes('../escape.mjs: outside the clone'),
      `[M2] … with each skipped entry's reason: "../escape.mjs: outside the clone" — got ${JSON.stringify(detailOf(r))}`)
    assert.ok(detailOf(r).includes('/etc/passwd: '),
      `[M2] … and "/etc/passwd: " with its own reason — got ${JSON.stringify(detailOf(r))}`)
    ok('task 3 (c) [M1, M2] every skipped entry is named in the unlinked detail')
  }

  // (d) an in-clone candidate beside an escaping entry: one subprocess, for
  //     the in-clone file.
  {
    const clone = checkoutOf({ 'src/foo.mjs': ESCAPE_BODY })
    escapeBeside(clone)
    const calls = []
    const recorder = (cmd, argv, opts) => {
      calls.push({ cmd, argv: Array.isArray(argv) ? argv.slice() : argv, opts: opts || {} })
      return Promise.resolve({
        code: 0,
        stdout: `${JSON.stringify({ has: true, length: 1, names: ['foo'] })}\n`,
        stderr: '',
      })
    }
    const r = await resolves(
      () => link({ bullet: '`foo(a)`', files: ['../escape.mjs', 'src/foo.mjs'], cloneDir: clone, exec: recorder }),
      'leg (d) escape beside src/foo.mjs')
    shape(r, 'leg (d) escape beside src/foo.mjs')
    assert.equal(r.status, 'resolved',
      `[M2] the answer is the in-clone candidate's own — got ${r.status} (${detailOf(r)})`)
    assert.equal(calls.length, 1,
      `[M1, M2] exec is called exactly once, for the in-clone file — got ${calls.length} call(s): ${JSON.stringify(calls.map((c) => c.cmd))}`)
    const argvText = [calls[0].cmd, ...(calls[0].argv || [])].map(String).join(' ')
    assert.ok(argvText.includes('src/foo.mjs'),
      `[M2] … and that call is for src/foo.mjs — got ${JSON.stringify(argvText.slice(0, 400))}`)
    assert.ok(!argvText.includes('escape.mjs'),
      `[M1] … never for the escaping entry — escape.mjs appears in ${JSON.stringify(argvText.slice(0, 400))}`)
    ok('task 3 (d) [M1, M2] one subprocess, for the in-clone candidate only')
  }

  // (e) the rule is the path, not the filesystem: an escaping entry that does
  //     not exist is still "outside the clone", never "not in the clone".
  {
    const clone = checkoutOf({ 'src/foo.mjs': ESCAPE_BODY })
    const r = await resolves(
      () => link({ bullet: '`foo(a)`', files: ['../nope.mjs'], cloneDir: clone, exec: boom }),
      'leg (e) ../nope.mjs')
    shape(r, 'leg (e) ../nope.mjs')
    assert.equal(r.status, 'unlinked',
      `[M1] an escaping entry that does not exist is unlinked — got ${r.status} (${detailOf(r)})`)
    assert.ok(detailOf(r).includes('../nope.mjs: outside the clone'),
      `[M1] … skipped as "../nope.mjs: outside the clone", the escape test running before the filesystem is consulted — got ${JSON.stringify(detailOf(r))}`)
    assert.ok(!detailOf(r).includes('not in the clone'),
      `[M1] … and never "not in the clone", which would mean the filesystem was consulted first — got ${JSON.stringify(detailOf(r))}`)
    ok('task 3 (e) [M1] the escape test runs before the filesystem is consulted')
  }

  // The Claim's boundary: `abs` must equal the root or begin with the root
  // plus `path.sep`, so a sibling directory whose name merely starts with the
  // clone's is outside it.
  {
    const clone = checkoutOf({ 'src/foo.mjs': ESCAPE_BODY })
    const sibling = `../${path.basename(clone)}-next/src/foo.mjs`
    const r = await resolves(
      () => link({ bullet: '`foo(a)`', files: [sibling], cloneDir: clone, exec: boom }),
      'leg (e) sibling prefix')
    shape(r, 'leg (e) sibling prefix')
    assert.equal(r.status, 'unlinked',
      `[M1] a sibling directory sharing the clone's name prefix is outside the clone — got ${r.status} (${detailOf(r)})`)
    assert.ok(detailOf(r).includes(`${sibling}: outside the clone`),
      `[M1] … the root match is root or root + path.sep, not a bare string prefix — got ${JSON.stringify(detailOf(r))}`)
    ok('task 3 [M1] a sibling sharing the clone name prefix is outside the clone')
  }

  // ── M3: the empty-stderr fallback names the bound ───────────────────────
  const seam = checkoutOf({
    'src/foo.mjs': 'export function foo (a) { return a }\n',
    'pkg/mod.py': 'def foo(a):\n    return a\n',
  })
  const seamExec = (res) => () => Promise.resolve(res)
  const SEAM_MS = 500

  // (f) `.mjs`, nothing on stdout and nothing on stderr.
  {
    const r = await linkProduces({
      bullet: '`foo(a)`',
      files: ['src/foo.mjs'],
      cloneDir: seam,
      exec: seamExec({ code: null, stdout: '', stderr: '' }),
      timeoutMs: SEAM_MS,
    })
    shape(r, 'leg (f) mjs seam, no JSON, empty stderr')
    assert.equal(r.status, 'unlinked',
      `[M3] a subprocess that printed no JSON is unlinked — got ${r.status} (${detailOf(r)})`)
    assert.ok(detailOf(r).includes(`node produced no JSON within ${SEAM_MS}ms`),
      `[M3] … with "node produced no JSON within ${SEAM_MS}ms" in the detail — got ${JSON.stringify(detailOf(r))}`)
    assert.equal(detailOf(r), `src/foo.mjs: node produced no JSON within ${SEAM_MS}ms`,
      `[M3] the detail is "<rel>: node produced no JSON within <timeoutMs>ms" — got ${JSON.stringify(detailOf(r))}`)
    ok('task 3 (f) [M3] an .mjs seam that reports nothing names node and the bound')
  }

  // (g) the same, for `.py`.
  {
    const r = await linkProduces({
      bullet: '`foo(a)`',
      files: ['pkg/mod.py'],
      cloneDir: seam,
      exec: seamExec({ code: null, stdout: '', stderr: '' }),
      timeoutMs: SEAM_MS,
    })
    shape(r, 'leg (g) py seam, no JSON, empty stderr')
    assert.equal(r.status, 'unlinked',
      `[M3] a python3 subprocess that printed no JSON is unlinked — got ${r.status} (${detailOf(r)})`)
    assert.ok(detailOf(r).includes(`python3 produced no JSON within ${SEAM_MS}ms`),
      `[M3] … with "python3 produced no JSON within ${SEAM_MS}ms" in the detail — got ${JSON.stringify(detailOf(r))}`)
    assert.equal(detailOf(r), `pkg/mod.py: python3 produced no JSON within ${SEAM_MS}ms`,
      `[M3] the detail is "<rel>: python3 produced no JSON within <timeoutMs>ms" — got ${JSON.stringify(detailOf(r))}`)
    ok('task 3 (g) [M3] a .py seam that reports nothing names python3 and the bound')
  }

  // (h) whitespace-only stderr is empty, and the code is irrelevant.
  {
    const r = await linkProduces({
      bullet: '`foo(a)`',
      files: ['src/foo.mjs'],
      cloneDir: seam,
      exec: seamExec({ code: 1, stdout: '', stderr: '  \n' }),
      timeoutMs: SEAM_MS,
    })
    shape(r, 'leg (h) whitespace-only stderr')
    assert.equal(r.status, 'unlinked',
      `[M3] a whitespace-only stderr is still unlinked — got ${r.status} (${detailOf(r)})`)
    assert.ok(detailOf(r).includes(`within ${SEAM_MS}ms`),
      `[M3] stderr that is empty after trimming takes the no-JSON detail, whatever code is — got ${JSON.stringify(detailOf(r))}`)
    assert.equal(detailOf(r), `src/foo.mjs: node produced no JSON within ${SEAM_MS}ms`,
      `[M3] … the whole detail, code 1 and all — got ${JSON.stringify(detailOf(r))}`)
    ok('task 3 (h) [M3] whitespace-only stderr is empty, whatever the exit code')
  }

  // (i) a killed result, and a signalled one, keep the timeout wording.
  {
    const killed = await linkProduces({
      bullet: '`foo(a)`',
      files: ['src/foo.mjs'],
      cloneDir: seam,
      exec: seamExec({ code: 0, stdout: '', stderr: '', killed: true }),
      timeoutMs: SEAM_MS,
    })
    shape(killed, 'leg (i) killed')
    assert.equal(killed.status, 'unlinked',
      `[M3] a killed subprocess is unlinked — got ${killed.status} (${detailOf(killed)})`)
    assert.ok(detailOf(killed).includes(`timeout after ${SEAM_MS}ms`),
      `[M3] … keeping "timeout after ${SEAM_MS}ms" — got ${JSON.stringify(detailOf(killed))}`)
    assert.ok(!detailOf(killed).includes('within'),
      `[M3] … and never the no-JSON wording — got ${JSON.stringify(detailOf(killed))}`)
    assert.equal(detailOf(killed), `src/foo.mjs: timeout after ${SEAM_MS}ms`,
      `[M3] the killed detail is "<rel>: timeout after <timeoutMs>ms" — got ${JSON.stringify(detailOf(killed))}`)

    const signalled = await linkProduces({
      bullet: '`foo(a)`',
      files: ['src/foo.mjs'],
      cloneDir: seam,
      exec: seamExec({ code: null, stdout: '', stderr: '', signal: 'SIGKILL' }),
      timeoutMs: SEAM_MS,
    })
    shape(signalled, 'leg (i) signalled')
    assert.equal(signalled.status, 'unlinked',
      `[M3] a signalled subprocess is unlinked — got ${signalled.status} (${detailOf(signalled)})`)
    assert.ok(detailOf(signalled).includes(`timeout after ${SEAM_MS}ms`),
      `[M3] … keeping "timeout after ${SEAM_MS}ms" — got ${JSON.stringify(detailOf(signalled))}`)
    assert.ok(!detailOf(signalled).includes('within'),
      `[M3] … and never the no-JSON wording — got ${JSON.stringify(detailOf(signalled))}`)
    assert.equal(detailOf(signalled), `src/foo.mjs: timeout after ${SEAM_MS}ms`,
      `[M3] the signalled detail is "<rel>: timeout after <timeoutMs>ms" — got ${JSON.stringify(detailOf(signalled))}`)
    ok('task 3 (i) [M3] killed and signalled results keep the timeout wording')
  }

  // (j) a non-empty stderr still keeps its first line, as before.
  {
    const r = await linkProduces({
      bullet: '`foo(a)`',
      files: ['src/foo.mjs'],
      cloneDir: seam,
      exec: seamExec({ code: 1, stdout: '', stderr: 'boom line\nsecond' }),
      timeoutMs: SEAM_MS,
    })
    shape(r, 'leg (j) non-empty stderr')
    assert.equal(r.status, 'unlinked',
      `[M3] a subprocess with stderr is unlinked — got ${r.status} (${detailOf(r)})`)
    assert.ok(detailOf(r).includes('boom line'),
      `[M3] … keeping the first line of its stderr — got ${JSON.stringify(detailOf(r))}`)
    assert.ok(!detailOf(r).includes('within'),
      `[M3] … not the no-JSON wording — got ${JSON.stringify(detailOf(r))}`)
    assert.ok(!detailOf(r).includes('second'),
      `[M3] … and only the first line — got ${JSON.stringify(detailOf(r))}`)
    assert.equal(detailOf(r), 'src/foo.mjs: boom line',
      `[M3] the detail is "<rel>: <first line of stderr>" — got ${JSON.stringify(detailOf(r))}`)
    ok('task 3 (j) [M3] a non-empty stderr keeps its first line, as before')
  }

  // (k) the real thing: a module that neither exits nor prints still answers
  //     at the timeout, under the module's own `defaultExec`.
  {
    const HANG = [
      '// Neither exits nor prints: the interval keeps the loop alive and the',
      '// awaited promise never settles.',
      'setInterval(() => {}, 1000)',
      'export function foo (a) { return a }',
      'await new Promise(() => {})',
      '',
    ].join('\n')
    const hung = checkoutOf({ 'src/hang.mjs': HANG })
    const started = Date.now()
    const r = await linkProduces({
      bullet: '`foo(a)`',
      files: ['src/hang.mjs'],
      cloneDir: hung,
      exec: defaultExec,
      timeoutMs: SEAM_MS,
    })
    const elapsed = Date.now() - started
    shape(r, 'leg (k) real hang')
    assert.equal(r.status, 'unlinked',
      `[M3] the real hang case still answers unlinked — got ${r.status} (${detailOf(r)})`)
    assert.ok(detailOf(r).includes('timeout'),
      `[M3] … with timeout in the detail — got ${JSON.stringify(detailOf(r))}`)
    assert.ok(elapsed < 5000,
      `[M3] … within five seconds — took ${elapsed}ms`)
    ok('task 3 (k) [M3] the real hang case still answers unlinked at the timeout')
  }

  removeStray()
}

// ── Task 1: a placeholder Produces is unlinked before any file is read, and ──
// ── the four spellings are the compiler's (#842) ──────────────────────────────
// M1. A bullet is a placeholder when, after the optional bullet marker and one
//     optional wrapping backtick, its text opens with `none`, `nothing`, `n/a`
//     or `na` compared case-insensitively and that word is followed by
//     end-of-text, whitespace, a closing backtick or any character other than a
//     letter, digit or underscore. Each of the four bare bullets answers
//     `unlinked` with `placeholder` in the detail, `exec` called 0 times.
// M2. The same, for `None`, `NOTHING`, `N/A` — the comparison is
//     case-insensitive.
// M3. The same, for a placeholder carrying trailing prose.
// M4. `nonesuch(a)`, `None_`, `nothingness()`, `name(x)` merely start with a
//     token: they fall through to the existing path and answer `missing` after
//     exactly one subprocess each.
// M5. `PLACEHOLDER_TOKENS` is exported, is a `Set`, sorts to
//     `['n/a', 'na', 'none', 'nothing']`, and equals the compiler's own line.
// M7. `test_placeholder_token_set` in `tests/test_compile_plan.py` names all
//     four words as quoted strings inside its own body, and passes.
{
  const ROOT = path.resolve(HERE, '..', '..')
  const FOO = 'export function foo (a) { return a }\n'
  const FILES = ['src/foo.mjs']

  // "A counting stub" is an `exec` that increments a counter and throws, so a
  // call is both counted and fatal — the same proof the sim's `boom` gives,
  // with a count beside it. The M4 legs use a counting stub that delegates to
  // `defaultExec` instead, since those legs need the real answer.
  const counting = (delegate) => {
    const state = { calls: 0 }
    state.exec = (cmd, argv, opts) => {
      state.calls += 1
      if (!delegate) {
        throw new Error('[M1, M2, M3] no subprocess may run for a placeholder bullet — ' +
          'the placeholder answer is given before any file is read')
      }
      return defaultExec(cmd, argv, opts)
    }
    return state
  }

  const resolves = async (thunk, where) => {
    try {
      return await thunk()
    } catch (e) {
      assert.fail(`${where}: linkProduces resolves rather than throwing — it rejected with ` +
        `${String((e && e.message) || e)} [M1, M2, M3]`)
      return null
    }
  }

  // One placeholder leg: the bullet answers `unlinked`, its detail says
  // `placeholder`, and nothing was spawned.
  const placeholderLeg = async (label, bullet, clause) => {
    const clone = checkoutOf({ 'src/foo.mjs': FOO })
    const stub = counting(false)
    const r = await resolves(
      () => link({ bullet, files: FILES, cloneDir: clone, exec: stub.exec }),
      `task 1 ${label} ${JSON.stringify(bullet)}`)
    shape(r, `task 1 ${label} ${JSON.stringify(bullet)}`)
    assert.equal(r.status, 'unlinked',
      `[${clause}] the bullet ${JSON.stringify(bullet)} is a placeholder, which is unlinked — ` +
      `got ${r.status} (${detailOf(r)})`)
    assert.ok(/placeholder/.test(detailOf(r)),
      `[${clause}] … with "placeholder" in the detail, the sentence the referee block carries — ` +
      `got ${JSON.stringify(detailOf(r))}`)
    assert.equal(stub.calls, 0,
      `[${clause}] … answered before any file is read: exec called ${stub.calls} time(s) for ` +
      `${JSON.stringify(bullet)}`)
    ok(`task 1 ${label} [${clause}] ${JSON.stringify(bullet)} is unlinked as a placeholder, no subprocess`)
  }

  // (a)–(d) M1: the four bare bullets.
  await placeholderLeg('(a)', 'none', 'M1')
  await placeholderLeg('(b)', 'nothing', 'M1')
  await placeholderLeg('(c)', 'n/a', 'M1')
  await placeholderLeg('(d)', 'na', 'M1')

  // (e)–(g) M2: upper- and mixed-case, compared case-insensitively.
  await placeholderLeg('(e)', 'None', 'M2')
  await placeholderLeg('(f)', 'NOTHING', 'M2')
  await placeholderLeg('(g)', 'N/A', 'M2')

  // (h)–(k) M3: the placeholder word followed by prose — each the text after
  // `- Produces:`, which is what `interfaces.produces` carries.
  await placeholderLeg('(h)', 'none — standalone', 'M3')
  await placeholderLeg('(i)', '`nothing` (test-data-only change)', 'M3')
  await placeholderLeg('(j)', 'n/a — nothing exported', 'M3')
  await placeholderLeg('(k)', 'na (prose only)', 'M3')

  // (l)–(o) M4: a real identifier that merely starts with a token is not a
  // placeholder — it falls through to the existing path and, over a
  // `src/foo.mjs` exporting only `foo`, answers `missing` after exactly one
  // `node` spawn.
  const missingLeg = async (label, bullet) => {
    const clone = checkoutOf({ 'src/foo.mjs': FOO })
    const stub = counting(true)
    const r = await resolves(
      () => link({ bullet, files: FILES, cloneDir: clone, exec: stub.exec }),
      `task 1 ${label} ${JSON.stringify(bullet)}`)
    shape(r, `task 1 ${label} ${JSON.stringify(bullet)}`)
    assert.equal(r.status, 'missing',
      `[M4] ${JSON.stringify(bullet)} is a real identifier that merely starts with a token, ` +
      `so it answers missing over a src/foo.mjs exporting only foo — got ${r.status} (${detailOf(r)})`)
    assert.ok(detailOf(r).includes('no export named'),
      `[M4] … with the miss wording — got ${JSON.stringify(detailOf(r))}`)
    assert.equal(stub.calls, 1,
      `[M4] … after exactly one subprocess — got ${stub.calls} call(s)`)
    ok(`task 1 ${label} [M4] ${JSON.stringify(bullet)} is missing after exactly one spawn`)
  }

  await missingLeg('(l)', '`nonesuch(a)`')
  await missingLeg('(m)', '`None_`')
  await missingLeg('(n)', '`nothingness()`')
  await missingLeg('(o)', '`name(x)`')

  // (p) M5: the token set is the module's own export, and it is the compiler's
  // set spelled in JavaScript — one place in each, pinned here by the four
  // words.
  {
    const SORTED = ['n/a', 'na', 'none', 'nothing']
    const tokens = refereeLinker.PLACEHOLDER_TOKENS
    assert.ok(tokens instanceof Set,
      '[M5] fleet/referee-linker.mjs exports PLACEHOLDER_TOKENS, a Set — got ' +
      JSON.stringify(tokens === undefined ? 'undefined (no such export)' : String(tokens)))
    assert.deepEqual([...tokens].sort(), SORTED,
      `[M5] whose sorted members are exactly ${JSON.stringify(SORTED)} — got ${JSON.stringify([...tokens].sort())}`)

    const COMPILER = path.resolve(HERE, '..', '..', 'skills', 'ultrapowers', 'scripts', 'compile_plan.py')
    assert.ok(fs.existsSync(COMPILER), `[M5] the compiler source is at ${COMPILER}`)
    const src = fs.readFileSync(COMPILER, 'utf8')
    const matches = [...src.matchAll(/PLACEHOLDER_TOKENS = frozenset\(\{([^}]*)\}\)/g)]
    assert.equal(matches.length, 1,
      `[M5] the compiler spells its set in exactly one place — got ${matches.length} match(es)`)
    const compilerTokens = matches[0][1]
      .split(',')
      .map((w) => w.trim().replace(/^['"]|['"]$/g, '').trim().toLowerCase())
      .filter(Boolean)
      .sort()
    assert.deepEqual(compilerTokens, SORTED,
      `[M5] the compiler's own words are the same four — got ${JSON.stringify(compilerTokens)}`)
    assert.deepEqual([...tokens].sort(), compilerTokens,
      `[M5] and the linker's set equals the compiler's, word for word — ` +
      `${JSON.stringify([...tokens].sort())} vs ${JSON.stringify(compilerTokens)}`)
    ok('task 1 (p) [M5] PLACEHOLDER_TOKENS is a Set of the compiler\'s own four words')
  }

  // (q) M5: the two one-line `Run:` probes of the Proof, run here as the Proof
  //     runs them — each exits 0.
  {
    const probe = (cmd, argv) => {
      try {
        execFileSync(cmd, argv, { cwd: ROOT, encoding: 'utf8', env: ENV, stdio: ['ignore', 'pipe', 'pipe'] })
        return { code: 0, out: '' }
      } catch (e) {
        return { code: typeof e.status === 'number' ? e.status : 1, out: String(e.stderr || e.stdout || e.message) }
      }
    }
    const exported = probe('node', ['--input-type=module', '-e',
      "import { PLACEHOLDER_TOKENS } from './fleet/referee-linker.mjs'; " +
      "const a = [...PLACEHOLDER_TOKENS].sort().join(','); " +
      "if (a !== 'n/a,na,none,nothing') { console.error(a); process.exit(1) }"])
    assert.equal(exported.code, 0,
      `[M5] the Run: probe importing PLACEHOLDER_TOKENS and joining its sorted members to ` +
      `"n/a,na,none,nothing" exits 0 — got ${exported.code}: ${exported.out.slice(0, 400)}`)

    const frozen = fs.readFileSync(
      path.resolve(ROOT, 'skills', 'ultrapowers', 'scripts', 'compile_plan.py'), 'utf8')
    const line = 'PLACEHOLDER_TOKENS = frozenset({"nothing", "none", "n/a", "na"})'
    const lines = frozen.split('\n').filter((l) => l.includes(line)).length
    assert.equal(lines, 1,
      `[M5] the compiler source carries the frozen ${JSON.stringify(line)} line exactly once — got ${lines}`)
    ok('task 1 (q) [M5] both Run: probes of the token set are green')
  }

  // (t) M7: `test_placeholder_token_set` names all four words as quoted strings
  //     inside its own body — at BASE `na` is the absent one. Whether it passes
  //     is read from the suite that collects it, not from a pytest this sim
  //     starts.
  {
    const PY = path.resolve(ROOT, 'tests', 'test_compile_plan.py')
    assert.ok(fs.existsSync(PY), `[M7] the compiler suite is at ${PY}`)
    const lines = fs.readFileSync(PY, 'utf8').split('\n')
    const start = lines.findIndex((l) => /^def test_placeholder_token_set/.test(l))
    assert.ok(start !== -1, '[M7] tests/test_compile_plan.py defines test_placeholder_token_set')
    let end = start + 1
    while (end < lines.length && !/^def /.test(lines[end])) end += 1
    const body = lines.slice(start, end).join('\n')
    assert.ok(body.includes('"na"'),
      `[M7] its body names "na" as a quoted string — got ${JSON.stringify(body)}`)
    const words = [...new Set((body.match(/"(?:nothing|none|N\/A|na)"/g) || []))].sort()
    assert.deepEqual(words, ['"N/A"', '"na"', '"none"', '"nothing"'],
      `[M7] the distinct quoted words among nothing, none, N/A, na inside that body are all four — ` +
      `got ${JSON.stringify(words)}`)
    assert.equal(words.length, 4,
      `[M7] … which is a count of 4, where at BASE it is 3 — got ${words.length}`)

    // That the test PASSES is pytest's own reading: `tests/test_compile_plan.py`
    // is collected by the same suite this sim is joined into, so a sim that
    // shelled out to `python3 -m pytest` here ran it a second time inside a
    // worker already running it. What this leg reads is the source — the four
    // words inside that test's own body — and the run above is the suite's.
    ok('task 1 (t) [M7] test_placeholder_token_set names all four words, and the suite runs it')
  }
}

cleanup()
console.log(`\nALL TESTS PASSED (${passed})`)

// fleet/tests/test_referee_linker.mjs — the exam for task 2, "The interface
// linker resolves a Produces symbol per language":
// `linkProduces({bullet, files, cloneDir, exec, timeoutMs}) ->
// Promise<{status, symbol, detail}>` from `fleet/referee-linker.mjs`.
//
// The fixtures are REAL. Every case below runs against a checkout the sim
// builds itself: a temporary directory holding the fixture's `base/` tree (or
// a tree the sim writes inline), `git init -q -b main` and one commit, so
// `cloneDir` is a real checkout — and, when a fixture's `patch.diff` is
// non-empty, `git apply` after that commit. Every git command here is the
// sim's own (Amendment 10). Nothing under `linkProduces` is stubbed except
// where a leg names the stub: the `node` and `python3` subprocesses of M2 and
// M3 are the real ones, because the contract is about the answer the linker
// gives, not about how a particular implementation spells it.
//
// Legs, from the task's Proof:
//   (a) M1 — the lead token, the four statuses, the unlinked-without-reading
//       rule for a symbol that is not a bare identifier or is followed by
//       `:`/`/`/`=`/`.`, no-candidate-files, and the cross-candidate order.
//   (b) M2 — the `.mjs`/`.js` linker: resolved with `<symbol>/<length>`, the
//       arity floor, `declared, not exported`, the miss detail, the throwing
//       import, the argv it issues, the timeout, and unlinked over missing.
//   (c) M3 — the `.py` linker: `ast`, never an import.
//   (d) M4 — the `.ts`/`.tsx` export-declaration scan, with no subprocess.
//   (e) M5 — every `fleet/tests/fixtures/referee/linker-*` fixture answers as
//       its `expected.json` says, and the twelve directories are exactly the
//       twelve the task names.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

import { linkProduces } from '../../../referee-linker.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.resolve(HERE, '../../fixtures/referee')

// A fixture never needs the timeout to fire; every call that is not the
// timeout leg passes a bound well above what a fixture needs, so a wrong
// implementation fails this sim rather than hanging it for thirty minutes.
const CALL_TIMEOUT_MS = 20000

// ── the sim's own git ─────────────────────────────────────────────────────
const ENV = {
  ...process.env,
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
  GIT_CONFIG_NOSYSTEM: '1',
}
const git = (argv, cwd) => {
  try {
    return execFileSync('git', argv, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    throw new Error('git ' + argv.join(' ') + ' in ' + cwd + ' failed: ' + String(e.stderr || e.message))
  }
}

const TMP = []
const mkTmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'referee-linker-'))
  TMP.push(dir)
  return dir
}
const cleanup = () => { for (const d of TMP.splice(0)) fs.rmSync(d, { recursive: true, force: true }) }
process.on('exit', cleanup)

const writeTree = (dir, files) => {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, body)
  }
}

const commitCheckout = (dir) => {
  git(['init', '-q', '-b', 'main'], dir)
  git(['add', '-A'], dir)
  git(['-c', 'user.email=fleet@example.invalid', '-c', 'user.name=fleet', 'commit', '-q', '-m', 'base'], dir)
  return dir
}

// A checkout the sim writes inline: `{relative path: contents}`.
const makeCheckout = (files) => {
  const dir = mkTmp()
  writeTree(dir, files)
  return commitCheckout(dir)
}

// A checkout built from a fixture's `base/`, plus the fixture's task and
// expectation. `patch.diff` is empty for every linker fixture (HEAD is
// `base/`); a non-empty one is applied with `git apply` after the commit.
const fixture = (name) => {
  const fxDir = path.join(FIXTURES, name)
  for (const f of ['task.json', 'patch.diff', 'expected.json', 'base']) {
    assert.ok(fs.existsSync(path.join(fxDir, f)),
      'fixture ' + name + ' is missing ' + f + ' — the layout is `task.json`, `base/`, ' +
      '`patch.diff`, `expected.json` [M5]')
  }
  const rawTask = JSON.parse(fs.readFileSync(path.join(fxDir, 'task.json'), 'utf8'))
  const task = rawTask.task || rawTask
  const expected = JSON.parse(fs.readFileSync(path.join(fxDir, 'expected.json'), 'utf8'))

  const dir = mkTmp()
  fs.cpSync(path.join(fxDir, 'base'), dir, { recursive: true })
  commitCheckout(dir)
  const patch = fs.readFileSync(path.join(fxDir, 'patch.diff'), 'utf8')
  if (patch.trim()) git(['apply', path.join(fxDir, 'patch.diff')], dir)

  assert.ok(Array.isArray(task.files) && task.files.length > 0,
    'fixture ' + name + ': `task.files` is the candidate list the linker is called with [M5]')
  const produces = (task.interfaces && task.interfaces.produces) || []
  assert.ok(Array.isArray(produces) && produces.length > 0,
    'fixture ' + name + ': `task.interfaces.produces` holds the bullets this fixture answers [M5]')
  return { name, dir, task, produces, expected }
}

const link = (args) => linkProduces({ timeoutMs: CALL_TIMEOUT_MS, ...args })
const detailOf = (r) => String((r && r.detail) || '')
const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v])
// `node` may reasonably be issued as the literal word or as this process's
// own executable; either way M2's point is that the program is node, with
// those flags, and never a shell.
const isProgram = (spelled, program) => spelled === program || path.basename(String(spelled)) === program

const shape = (r, where) => {
  assert.ok(r && typeof r === 'object', where + ': `linkProduces` resolves to an object [M1]')
  assert.ok(['resolved', 'declared', 'missing', 'unlinked'].includes(r.status),
    where + ': `status` is one of resolved, declared, missing, unlinked — got ' + JSON.stringify(r.status) + ' [M1]')
  assert.strictEqual(typeof r.symbol, 'string', where + ': `symbol` is a string [M1]')
  assert.strictEqual(typeof r.detail, 'string', where + ': `detail` is a string [M1]')
  return r
}

// ── leg (a): M1, the lead token and the four statuses ─────────────────────
async function legA () {
  const mjs1 = fixture('linker-mjs-1')
  const first = await link({ bullet: mjs1.produces[0], files: mjs1.task.files, cloneDir: mjs1.dir })
  shape(first, 'leg (a) linker-mjs-1[0]')
  assert.strictEqual(first.symbol, 'foo',
    'leg (a) [M1]: the bullet of `linker-mjs-1`\'s first entry has lead token `foo`, the wrapping ' +
    'backtick removed — got ' + JSON.stringify(first.symbol))
  assert.strictEqual(first.status, 'resolved',
    'leg (a) [M1]: … and answers `resolved` — got ' + first.status + ' (' + detailOf(first) + ')')

  // A stub that throws proves no subprocess ran: a symbol that is not a bare
  // identifier, or that is followed by `:`, `/`, `=` or `.`, is `unlinked`
  // without any file being read.
  const boom = () => { throw new Error('leg (a) [M1]: no subprocess may run for an unlinkable symbol') }

  const unlinked1 = fixture('linker-unlinked-1')
  const dotted = await link({ bullet: unlinked1.produces[0], files: unlinked1.task.files, cloneDir: unlinked1.dir, exec: boom })
  shape(dotted, 'leg (a) linker-unlinked-1')
  assert.strictEqual(dotted.symbol, 'report.reviewEconomy',
    'leg (a) [M1]: the lead token of `report.reviewEconomy` is the whole dotted token — got ' +
    JSON.stringify(dotted.symbol))
  assert.strictEqual(dotted.status, 'unlinked',
    'leg (a) [M1]: a dotted symbol does not match `^[A-Za-z_]\\w*$`, so it is `unlinked` and no ' +
    'file is read — got ' + dotted.status + ' (' + detailOf(dotted) + ')')

  const unlinked2 = fixture('linker-unlinked-2')
  const shell = await link({ bullet: unlinked2.produces[0], files: unlinked2.task.files, cloneDir: unlinked2.dir })
  shape(shell, 'leg (a) linker-unlinked-2')
  assert.strictEqual(shell.symbol, 'record_tags',
    'leg (a) [M1]: the lead token of `record_tags()` is `record_tags` — got ' + JSON.stringify(shell.symbol))
  assert.strictEqual(shell.status, 'unlinked',
    'leg (a) [M1]: a shell-function symbol whose only candidate file is `.sh` has no candidate ' +
    'file, so it is `unlinked` — got ' + shell.status + ' (' + detailOf(shell) + ')')
  assert.ok(detailOf(shell).length > 0,
    'leg (a) [M1]: no candidate file is `unlinked` with a detail naming the reason')

  const assigned = await link({ bullet: '`X = 1`', files: mjs1.task.files, cloneDir: mjs1.dir, exec: boom })
  shape(assigned, 'leg (a) `X = 1`')
  assert.strictEqual(assigned.symbol, 'X', 'leg (a) [M1]: the lead token of `X = 1` is `X`')
  assert.strictEqual(assigned.status, 'unlinked',
    'leg (a) [M1]: a symbol followed, after optional spaces, by `=` is `unlinked` without any file ' +
    'being read — got ' + assigned.status + ' (' + detailOf(assigned) + ')')

  const slashed = await link({ bullet: '`path/to/thing`', files: mjs1.task.files, cloneDir: mjs1.dir, exec: boom })
  shape(slashed, 'leg (a) `path/to/thing`')
  assert.strictEqual(slashed.symbol, 'path', 'leg (a) [M1]: the lead token of `path/to/thing` is `path`')
  assert.strictEqual(slashed.status, 'unlinked',
    'leg (a) [M1]: a symbol followed by `/` is `unlinked` without any file being read — got ' +
    slashed.status + ' (' + detailOf(slashed) + ')')

  const noExt = await link({ bullet: '`foo(a)`', files: ['README.md', 'fleet/sandbox-boot.sh', 'docs/x.txt'], cloneDir: mjs1.dir })
  shape(noExt, 'leg (a) no linkable extension')
  assert.strictEqual(noExt.status, 'unlinked',
    'leg (a) [M1]: a `files` list with no `.mjs`/`.js`/`.py`/`.ts`/`.tsx` entry leaves no candidate ' +
    'file, which is `unlinked` — got ' + noExt.status + ' (' + detailOf(noExt) + ')')
  assert.ok(detailOf(noExt).length > 0,
    'leg (a) [M1]: … with a detail naming the reason')

  // Across candidates the answer is the best grade any candidate earned:
  // resolved over declared over unlinked over missing.
  const mixed = makeCheckout({
    'src/foo.mjs': 'export function foo (a, b) { return a + b }\n',
    'pkg/mod.py': 'def bar():\n    return 1\n',
  })
  const best = await link({ bullet: '`foo(a, b) -> Widget`', files: ['pkg/mod.py', 'src/foo.mjs'], cloneDir: mixed })
  shape(best, 'leg (a) resolved beside missing')
  assert.strictEqual(best.status, 'resolved',
    'leg (a) [M1]: with a `.mjs` that resolves and a `.py` where the name is missing, the answer ' +
    'is `resolved` — got ' + best.status + ' (' + detailOf(best) + ')')
  console.log('leg (a) [M1] ok')
}

// ── leg (b): M2, the `.mjs`/`.js` linker ──────────────────────────────────
async function legB () {
  const mjs1 = fixture('linker-mjs-1')
  const r2 = await link({ bullet: '`foo(a, b)`', files: mjs1.task.files, cloneDir: mjs1.dir })
  shape(r2, 'leg (b) linker-mjs-1 foo(a, b)')
  assert.strictEqual(r2.status, 'resolved',
    'leg (b) [M2]: `linker-mjs-1` answers `resolved` for `foo(a, b)` — got ' + r2.status + ' (' + detailOf(r2) + ')')
  assert.ok(detailOf(r2).includes('foo/2'),
    'leg (b) [M2]: … with a detail naming `<symbol>/<length>`, `foo/2` — got ' + JSON.stringify(detailOf(r2)))
  assert.ok(detailOf(r2).includes('src/foo.mjs'),
    'leg (b) [M2]: … and naming the file — got ' + JSON.stringify(detailOf(r2)))

  const rLow = await link({ bullet: '`foo(a)`', files: mjs1.task.files, cloneDir: mjs1.dir })
  shape(rLow, 'leg (b) linker-mjs-1 foo(a)')
  assert.strictEqual(rLow.status, 'declared',
    'leg (b) [M2]: a bullet arity below `length` is `declared` — got ' + rLow.status + ' (' + detailOf(rLow) + ')')
  assert.ok(detailOf(rLow).includes('arity'),
    'leg (b) [M2]: … with a detail naming both counts, the word `arity` in it — got ' + JSON.stringify(detailOf(rLow)))
  assert.ok(detailOf(rLow).includes('1') && detailOf(rLow).includes('2'),
    'leg (b) [M2]: … both counts, the bullet\'s 1 and the export\'s 2 — got ' + JSON.stringify(detailOf(rLow)))

  const rHigh = await link({ bullet: '`foo(a, b, c)`', files: mjs1.task.files, cloneDir: mjs1.dir })
  shape(rHigh, 'leg (b) linker-mjs-1 foo(a, b, c)')
  assert.strictEqual(rHigh.status, 'resolved',
    'leg (b) [M2]: a bullet arity above `length` is still `resolved` — rest and default parameters ' +
    'make `length` a floor — got ' + rHigh.status + ' (' + detailOf(rHigh) + ')')

  const mjs2 = fixture('linker-mjs-2')
  const notExported = await link({ bullet: mjs2.produces[0], files: mjs2.task.files, cloneDir: mjs2.dir })
  shape(notExported, 'leg (b) linker-mjs-2')
  assert.strictEqual(notExported.status, 'declared',
    'leg (b) [M2]: `has` false with the name present in the candidate\'s text is `declared` — got ' +
    notExported.status + ' (' + detailOf(notExported) + ')')
  assert.ok(detailOf(notExported).includes('declared, not exported'),
    'leg (b) [M2]: … with the detail `declared, not exported` — got ' + JSON.stringify(detailOf(notExported)))

  const mjs3 = fixture('linker-mjs-3')
  const miss = await link({ bullet: mjs3.produces[0], files: mjs3.task.files, cloneDir: mjs3.dir })
  shape(miss, 'leg (b) linker-mjs-3')
  assert.strictEqual(miss.status, 'missing',
    'leg (b) [M2]: a renamed export is `missing` — got ' + miss.status + ' (' + detailOf(miss) + ')')
  for (const needle of ['countVowels', 'src/foo.mjs', '(found: countVowel)']) {
    assert.ok(detailOf(miss).includes(needle),
      'leg (b) [M2]: the miss detail names the symbol, the file it was looked for in, and the ' +
      'names that file does export — ' + JSON.stringify(needle) + ' is not in ' + JSON.stringify(detailOf(miss)))
  }
  assert.strictEqual(detailOf(miss), 'no export named countVowels in src/foo.mjs (found: countVowel)',
    'leg (b) [M2]/[M5]: the miss detail is the wording the referee\'s blocking finding carries ' +
    'verbatim — got ' + JSON.stringify(detailOf(miss)))

  const mjs4 = fixture('linker-mjs-4')
  const threw = await link({ bullet: mjs4.produces[0], files: mjs4.task.files, cloneDir: mjs4.dir })
  shape(threw, 'leg (b) linker-mjs-4')
  assert.strictEqual(threw.status, 'unlinked',
    'leg (b) [M2]: a subprocess that exits non-zero is `unlinked`, never a finding status — got ' +
    threw.status + ' (' + detailOf(threw) + ')')
  assert.ok(detailOf(threw).includes('boom'),
    'leg (b) [M2]: … with the detail carrying the first line of its stderr, `boom at import` — got ' +
    JSON.stringify(detailOf(threw)))

  // The argv the linker issues for a `.mjs` candidate.
  const calls = []
  const recorder = (cmd, argv, opts) => {
    calls.push({ cmd, argv: Array.isArray(argv) ? argv.slice() : argv, opts: opts || {} })
    return Promise.resolve({ code: 0, stdout: JSON.stringify({ has: true, length: 2, names: ['foo'] }) + '\n', stderr: '' })
  }
  await link({ bullet: '`foo(a, b)`', files: mjs1.task.files, cloneDir: mjs1.dir, exec: recorder })
  assert.strictEqual(calls.length, 1,
    'leg (b) [M2]: one subprocess per candidate — got ' + calls.length)
  const line = [calls[0].cmd, ...(calls[0].argv || [])].map(String)
  assert.ok(isProgram(line[0], 'node'),
    'leg (b) [M2]: the argv begins `node` — got ' + JSON.stringify(line[0]))
  assert.strictEqual(line[1], '--input-type=module',
    'leg (b) [M2]: … then `--input-type=module` — got ' + JSON.stringify(line[1]))
  assert.strictEqual(line[2], '-e',
    'leg (b) [M2]: … then `-e` — got ' + JSON.stringify(line[2]))
  const joined = line.join('\x00')
  assert.ok(joined.includes('file://') && joined.includes('foo.mjs'),
    'leg (b) [M2]: the script dynamically imports the candidate\'s file URL — no `file://` URL ' +
    'naming `foo.mjs` in the argv')
  for (const forbidden of ['bash', '-lc', 'git', 'sh']) {
    assert.ok(!line.includes(forbidden),
      'leg (b) [M2]: the module runs only that script — never `bash -lc`, never git — found ' +
      JSON.stringify(forbidden) + ' in the argv')
  }
  assert.strictEqual(calls[0].opts.cwd, mjs1.dir,
    'leg (b) [M2]: the subprocess cwd is `cloneDir` — got ' + JSON.stringify(calls[0].opts.cwd))

  // The timeout: a module scope that neither exits nor prints.
  const HANG = [
    '// neither exits nor prints: the interval keeps the loop alive and the',
    '// awaited promise never settles.',
    'setInterval(() => {}, 1000)',
    'export function foo (a) { return a }',
    'await new Promise(() => {})',
    '',
  ].join('\n')
  const hung = makeCheckout({ 'src/hang.mjs': HANG, 'src/quiet.mjs': 'export const other = 1\n' })

  const started = Date.now()
  const timedOut = await linkProduces({ bullet: '`foo(a)`', files: ['src/hang.mjs'], cloneDir: hung, timeoutMs: 500 })
  const elapsed = Date.now() - started
  shape(timedOut, 'leg (b) timeout')
  assert.strictEqual(timedOut.status, 'unlinked',
    'leg (b) [M2]: a subprocess killed at the timeout is `unlinked` — got ' + timedOut.status +
    ' (' + detailOf(timedOut) + ')')
  assert.ok(/timeout/i.test(detailOf(timedOut)),
    'leg (b) [M2]: … with `timeout` in the detail — got ' + JSON.stringify(detailOf(timedOut)))
  assert.ok(elapsed < 5000,
    'leg (b) [M2]: … killed after `timeoutMs`, so the answer comes back within five seconds — took ' +
    elapsed + 'ms')

  const hungBeside = await linkProduces({ bullet: '`foo(a)`', files: ['src/quiet.mjs', 'src/hang.mjs'], cloneDir: hung, timeoutMs: 500 })
  shape(hungBeside, 'leg (b) unlinked over missing')
  assert.strictEqual(hungBeside.status, 'unlinked',
    'leg (b) [M2]/[M1]: `unlinked` wins over `missing` — a candidate that hung beside one where ' +
    'the name is absent answers `unlinked`, not `missing` — got ' + hungBeside.status +
    ' (' + detailOf(hungBeside) + ')')
  console.log('leg (b) [M2] ok')
}

// ── leg (c): M3, the `.py` linker ─────────────────────────────────────────
async function legC () {
  const py1 = fixture('linker-py-1')
  const top = await link({ bullet: py1.produces[0], files: py1.task.files, cloneDir: py1.dir })
  shape(top, 'leg (c) linker-py-1')
  assert.strictEqual(top.status, 'resolved',
    'leg (c) [M3]: a top-level `def` equal to the symbol is `resolved` — got ' + top.status +
    ' (' + detailOf(top) + ')')

  const py2 = fixture('linker-py-2')
  const nested = await link({ bullet: py2.produces[0], files: py2.task.files, cloneDir: py2.dir })
  shape(nested, 'leg (c) linker-py-2')
  assert.strictEqual(nested.status, 'declared',
    'leg (c) [M3]: the name present in the text without a top-level definition is `declared` — got ' +
    nested.status + ' (' + detailOf(nested) + ')')

  const py3 = fixture('linker-py-3')
  const miss = await link({ bullet: py3.produces[0], files: py3.task.files, cloneDir: py3.dir })
  shape(miss, 'leg (c) linker-py-3')
  assert.strictEqual(miss.status, 'missing',
    'leg (c) [M3]: otherwise `missing` — got ' + miss.status + ' (' + detailOf(miss) + ')')
  for (const needle of ['foo', 'pkg/mod.py', 'bar']) {
    assert.ok(detailOf(miss).includes(needle),
      'leg (c) [M3]/[M5]: the miss detail names the symbol, the file it was looked for in, and the ' +
      'names that file does define — ' + JSON.stringify(needle) + ' is not in ' + JSON.stringify(detailOf(miss)))
  }

  const calls = []
  const recorder = (cmd, argv, opts) => {
    calls.push({ cmd, argv: Array.isArray(argv) ? argv.slice() : argv, opts: opts || {} })
    return Promise.resolve({ code: 0, stdout: JSON.stringify({ names: ['foo'], arity: { foo: 2 } }) + '\n', stderr: '' })
  }
  await link({ bullet: py1.produces[0], files: py1.task.files, cloneDir: py1.dir, exec: recorder })
  assert.strictEqual(calls.length, 1,
    'leg (c) [M3]: one subprocess per candidate — got ' + calls.length)
  const line = [calls[0].cmd, ...(calls[0].argv || [])].map(String)
  assert.ok(isProgram(line[0], 'python3'),
    'leg (c) [M3]: the argv begins `python3` — got ' + JSON.stringify(line[0]))
  assert.strictEqual(line[1], '-c',
    'leg (c) [M3]: … then `-c` — got ' + JSON.stringify(line[1]))
  assert.ok(!line.includes('-m'),
    'leg (c) [M3]: no argv element is `-m` — the file is never imported')
  for (const el of line) {
    assert.ok(!el.includes('import pkg'),
      'leg (c) [M3]: no argv element names `import pkg` — the file is never imported, it is ' +
      '`ast.parse`d — found ' + JSON.stringify(el))
  }
  const joined = line.join('\x00')
  assert.ok(joined.includes('ast'),
    'leg (c) [M3]: the script `ast.parse`s the file — no `ast` in the argv')
  assert.ok(joined.includes('mod.py'),
    'leg (c) [M3]: … the candidate file — no `mod.py` in the argv')
  assert.strictEqual(calls[0].opts.cwd, py1.dir,
    'leg (c) [M3]: the subprocess cwd is `cloneDir` — got ' + JSON.stringify(calls[0].opts.cwd))
  console.log('leg (c) [M3] ok')
}

// ── leg (d): M4, the `.ts`/`.tsx` scan ────────────────────────────────────
async function legD () {
  // The fixtures never create `node_modules/typescript`, so `tsc` is never
  // invoked: a throwing `exec` proves no subprocess ran for any `.ts` case.
  const boom = () => { throw new Error('leg (d) [M4]: no subprocess may run for a `.ts` candidate without node_modules/typescript') }

  const ts1 = fixture('linker-ts-1')
  const resolved = await link({ bullet: ts1.produces[0], files: ts1.task.files, cloneDir: ts1.dir, exec: boom })
  shape(resolved, 'leg (d) linker-ts-1')
  assert.strictEqual(resolved.status, 'resolved',
    'leg (d) [M4]: `export function foo(...)` is `resolved` — got ' + resolved.status + ' (' + detailOf(resolved) + ')')

  const arity = await link({ bullet: '`foo(a)`', files: ts1.task.files, cloneDir: ts1.dir, exec: boom })
  shape(arity, 'leg (d) linker-ts-1 foo(a)')
  assert.strictEqual(arity.status, 'declared',
    'leg (d) [M4]: arity from the parameter list, counting entries without `?` or `=`, with the ' +
    'floor rule — a bullet arity of 1 below 2 is `declared` — got ' + arity.status + ' (' + detailOf(arity) + ')')
  assert.ok(detailOf(arity).includes('arity'),
    'leg (d) [M4]: … with `arity` in the detail — got ' + JSON.stringify(detailOf(arity)))

  const ts2 = fixture('linker-ts-2')
  const declared = await link({ bullet: ts2.produces[0], files: ts2.task.files, cloneDir: ts2.dir, exec: boom })
  shape(declared, 'leg (d) linker-ts-2')
  assert.strictEqual(declared.status, 'declared',
    'leg (d) [M4]: the name present without an export declaration is `declared` — got ' +
    declared.status + ' (' + detailOf(declared) + ')')

  const ts3 = fixture('linker-ts-3')
  const missing = await link({ bullet: ts3.produces[0], files: ts3.task.files, cloneDir: ts3.dir, exec: boom })
  shape(missing, 'leg (d) linker-ts-3')
  assert.strictEqual(missing.status, 'missing',
    'leg (d) [M4]: otherwise `missing` — got ' + missing.status + ' (' + detailOf(missing) + ')')
  for (const needle of ['foo', 'src/foo.ts', 'bar']) {
    assert.ok(detailOf(missing).includes(needle),
      'leg (d) [M4]/[M5]: the miss detail names the symbol, the file it was looked for in, and the ' +
      'names that file does export — ' + JSON.stringify(needle) + ' is not in ' + JSON.stringify(detailOf(missing)))
  }

  const listed = makeCheckout({ 'src/named.ts': 'function foo() {}\nexport { foo }\n' })
  const viaList = await link({ bullet: '`foo()`', files: ['src/named.ts'], cloneDir: listed, exec: boom })
  shape(viaList, 'leg (d) export { foo }')
  assert.strictEqual(viaList.status, 'resolved',
    'leg (d) [M4]: `<symbol>` as a name inside an `export { … }` list is `resolved` — got ' +
    viaList.status + ' (' + detailOf(viaList) + ')')

  const dflt = makeCheckout({ 'src/dflt.ts': 'export default function foo() {}\n' })
  const viaDefault = await link({ bullet: '`foo()`', files: ['src/dflt.ts'], cloneDir: dflt, exec: boom })
  shape(viaDefault, 'leg (d) export default function foo')
  assert.strictEqual(viaDefault.status, 'resolved',
    'leg (d) [M4]: `export default function <symbol>(` is `resolved` — got ' + viaDefault.status +
    ' (' + detailOf(viaDefault) + ')')
  console.log('leg (d) [M4] ok')
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

async function legE () {
  assert.ok(fs.existsSync(FIXTURES),
    'leg (e) [M5]: the fixture root `fleet/tests/fixtures/referee` does not exist')
  const dirs = fs.readdirSync(FIXTURES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('linker-'))
    .map((d) => d.name)
    .sort()
  assert.deepStrictEqual(dirs, Object.keys(TABLE).slice().sort(),
    'leg (e) [M5]: the twelve `linker-*` directories are exactly the twelve the task names — got ' +
    JSON.stringify(dirs))

  for (const name of dirs) {
    const fx = fixture(name)
    const results = (fx.expected && fx.expected.results) || []
    assert.ok(Array.isArray(results),
      'leg (e) [M5]: ' + name + '/expected.json is `{"results": [...]}`')
    assert.strictEqual(results.length, fx.produces.length,
      'leg (e) [M5]: ' + name + ' has one expected result per produces bullet, in order — ' +
      results.length + ' results for ' + fx.produces.length + ' bullets')
    assert.deepStrictEqual(results.map((r) => r.status), TABLE[name],
      'leg (e) [M5]: ' + name + ' expects the statuses the task\'s fixture table gives it — got ' +
      JSON.stringify(results.map((r) => r.status)))

    for (let i = 0; i < fx.produces.length; i++) {
      const want = results[i]
      const got = await link({ bullet: fx.produces[i], files: fx.task.files, cloneDir: fx.dir })
      const where = 'leg (e) [M5]: ' + name + ' bullet ' + JSON.stringify(fx.produces[i])
      shape(got, where)
      assert.strictEqual(got.symbol, want.symbol,
        where + ' answers `symbol` ' + JSON.stringify(want.symbol) + ' — got ' + JSON.stringify(got.symbol))
      assert.strictEqual(got.status, want.status,
        where + ' answers `status` ' + JSON.stringify(want.status) + ' — got ' + got.status +
        ' (' + detailOf(got) + ')')
      for (const needle of asList(want.contains)) {
        assert.ok(detailOf(got).includes(needle),
          where + ' answers a detail containing ' + JSON.stringify(needle) + ' — got ' +
          JSON.stringify(detailOf(got)))
      }
    }
  }
  console.log('leg (e) [M5] ok — ' + dirs.length + ' fixtures')
}

await legA()
await legB()
await legC()
await legD()
await legE()

cleanup()
console.log('ALL TESTS PASSED')

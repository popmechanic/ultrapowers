/**
 * fleet/tests/test_resolver_brief.mjs — the exam for Task 2: *the publish-fold
 * brief names its contending block and main's patch by path, one conflicted
 * path per brief*.
 *
 * This file is the Proof's `Test: fleet/tests/test_resolver_brief.mjs`, written
 * where the Proof names it. Every relative path below is written for THIS
 * directory: `../` is the repository's `fleet/`, `./` is `fleet/tests/`.
 *
 * The Claim under test: a publish-fold resolver is briefed on the one path it
 * is resolving and told where to read the rest, so its brief stays short
 * however many siblings landed first and however many paths conflicted.
 *
 * The Machine clauses, restated:
 *
 *   M1 — `resolveConflicts` accepts `contendingBlock` as a function of the
 *        conflict entry as well as a string: with a function and two open
 *        conflicts, the brief the injected `agent` receives for conflict `2` is
 *        `roles.resolver` + its own `HUNKS FILE:` line + the function's return
 *        for conflict `2`, and it does not contain the function's return for
 *        conflict `1`.
 *   M2 — With `contendingBlock` a string (the wave loop's shape at BASE), the
 *        brief the `agent` receives is `roles.resolver` + the `HUNKS FILE:`
 *        line + that string, unchanged.
 *   M3 — `writeResolverBriefs({ briefsDir, attemptKey, open, blockFor,
 *        mainPatch })`, exported from `fleet/publish-fold.mjs`, writes for each
 *        open conflict `i` the file `<briefsDir>/contending-<i>-<attemptKey>.txt`
 *        holding exactly `blockFor(conflict.path)`, copies `mainPatch` to
 *        `<briefsDir>/main.patch` byte for byte, and returns a function whose
 *        string for conflict `i` names both absolute paths on lines beginning
 *        `CONTENDING TASKS FILE:` and `MAIN PATCH FILE:`, carries no line
 *        beginning `- run `, and is shorter than 1,024 bytes when the block is
 *        200,000 bytes long.
 *   M4 — `fleet/roles/resolver.md` tells the resolver what a `CONTENDING TASKS
 *        FILE:` line and a `MAIN PATCH FILE:` line name, and
 *        `fleet/CONTRACT.md`'s `publish-fold/` receipts list names
 *        `contending-<i>-<attempt>.txt`.
 *
 * The Proof legs, and where each is answered below — every assertion names its
 * leg and the clause it comes from, so a reader can map this file back to the
 * contract:
 *
 *   (a) [M1] `contendingBlock: (c) => '\nBLOCK-' + c.path` over the two open
 *            conflicts: the SECOND recorded prompt equals `'ROLE\n'` + its own
 *            `HUNKS FILE:` line + `'\nBLOCK-b.txt'` exactly, and does not
 *            include `BLOCK-a.txt`. An engine that still concatenates every
 *            path's block, or that ignores the function and pastes its source,
 *            fails here.
 *   (b) [M2] `contendingBlock: '\nSTRING'` over the same rig: the FIRST
 *            recorded prompt equals `'ROLE\n'` + its own `HUNKS FILE:` line +
 *            `'\nSTRING'`. The string shape is BASE's and stays BASE's.
 *   (c) [M3] `writeResolverBriefs` with a `blockFor` returning a 200,000-byte
 *            string for `a.txt` and `'short'` for `b.txt`: the two
 *            `contending-<i>-1.txt` files byte for byte, `main.patch` byte for
 *            byte, and the returned function's string for conflict 1 — its two
 *            path lines, no `- run ` line, under 1,024 bytes. A fold that still
 *            inlines the block fails the length and the `- run ` assertions.
 *   (d) [M4] `fleet/roles/resolver.md` carries both `CONTENDING TASKS FILE`
 *            and `MAIN PATCH FILE` (also the Proof's second `Run:`).
 *   (e) [M4] `fleet/CONTRACT.md` carries `contending-<i>-<attempt>.txt` (also
 *            the Proof's third `Run:`), and the role file's word count is
 *            REPORTED and gates nothing (the Proof's last `Run:`).
 *
 * Nothing here spawns a process or reaches a network: `resolveConflicts` is
 * driven directly with its `agent` and `runCli` seams injected as fakes, and
 * `writeResolverBriefs` with a `blockFor` of this file's own. Every path this
 * sim writes is under one `mkdtemp` directory in `os.tmpdir()`, removed on
 * exit. Importing `fleet/publish-fold.mjs` runs nothing: its `main()` is
 * guarded by an `import.meta.url === process.argv[1]` check.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveConflicts } from '../run-engine.mjs'
// Read through the namespace rather than by name on purpose: at BASE
// `writeResolverBriefs` is absent, and a named import of an absent export is an
// ESM link error that would kill this file before any leg could report. The
// namespace form lets leg (c) fail as "the export is not there yet".
import * as publishFold from '../publish-fold.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FLEET = path.join(HERE, '..')
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'resolver-brief-')))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// ── the literals the legs are written against, spelled once ─────────────────
const ROLE = 'ROLE\n'
const ATTEMPT_KEY = '1'
const CONTENDING_LINE = 'CONTENDING TASKS FILE: '
const MAIN_PATCH_LINE = 'MAIN PATCH FILE: '
const RUN_LINE = '- run '
const BRIEF_CEILING = 1024
const BIG = 200000

// The `HUNKS FILE:` line the engine builds at BASE, spelled here as the legs
// spell it: `'\nHUNKS FILE: ' + hunksFile + ' (conflicted path: ' + path + ')'`.
const hunksLine = (c) => '\nHUNKS FILE: ' + c.hunksFile + ' (conflicted path: ' + c.path + ')'

// The kernel's own `open` rows — `{ i, path, hunksFile, epoch }` — with the
// hunks paths under this sim's temp root. `resolveConflicts` never opens them.
const openRows = (root) => [
  { i: 1, path: 'a.txt', hunksFile: path.join(root, 'h1'), epoch: 1 },
  { i: 2, path: 'b.txt', hunksFile: path.join(root, 'h2'), epoch: 1 },
]

// The fake resolver: records every prompt it was handed, answers RESOLVED.
const makeAgent = () => {
  const prompts = []
  const fn = async (prompt) => {
    prompts.push(String(prompt))
    return { status: 'RESOLVED', hunks: [{ id: 'h1', content: 'x' }], notes: '' }
  }
  fn.prompts = prompts
  return fn
}

// The fake kernel CLI, in the shapes `resolveConflicts` reads: the first
// `resolve` leaves conflict 2 waiting, the second completes the stop.
const makeRunCli = () => {
  const calls = []
  return async (argv) => {
    calls.push(Array.isArray(argv) ? argv.slice() : [])
    const resolves = calls.filter((a) => a[0] === 'resolve').length
    if (resolves <= 1) return { code: 0, parsed: { applied: true, waiting: [2] } }
    return { code: 0, parsed: { applied: true, complete: true, selfChecks: 'ok' } }
  }
}

// One drained two-conflict stop. Returns the prompts the resolver was handed,
// in dispatch order, and the engine's own verdict.
const drive = async (contendingBlock, label) => {
  const root = fs.mkdtempSync(path.join(tmp, label + '-'))
  const waveDir = fs.mkdtempSync(path.join(root, 'wave-'))
  const open = openRows(root)
  const agent = makeAgent()
  const out = await resolveConflicts({
    agent,
    runCli: makeRunCli(),
    roles: { resolver: ROLE },
    common: [],
    taskArgs: [],
    commutesArgs: [],
    open,
    contendingBlock,
    waveDir,
    labelPrefix: 'fold',
  })
  return { open, prompts: agent.prompts, out }
}

// ── (a) [M1] a function of the conflict entry, one path's block per brief ────
{
  const { open, prompts, out } = await drive((c) => '\nBLOCK-' + c.path, 'leg-a')

  assert.equal(out.ok, true,
    '(a) [M1] sim precondition — the two-conflict stop drains: the first `resolve` leaves ' +
    'conflict 2 waiting, the second completes. resolveConflicts parked instead: ' + out.reason)
  assert.equal(prompts.length, 2,
    '(a) [M1] sim precondition — one brief per open conflict, so exactly two prompts were ' +
    'recorded, in the kernel\'s own `open` order. Got ' + prompts.length + '.')

  const expected = ROLE + hunksLine(open[1]) + '\nBLOCK-b.txt'
  assert.equal(prompts[1], expected,
    '(a) [M1] with `contendingBlock` a FUNCTION, the brief for conflict 2 is exactly ' +
    '`roles.resolver` + its own `HUNKS FILE:` line + the function\'s return for conflict 2. ' +
    'An engine that still concatenates every path\'s block, or that appends the function ' +
    'itself as a value, fails here.')
  assert.equal(prompts[1].includes('BLOCK-a.txt'), false,
    '(a) [M1] and conflict 2\'s brief does not carry conflict 1\'s block — the whole point of ' +
    'the clause is that a brief stays short however many paths conflicted: ' +
    JSON.stringify(prompts[1].slice(0, 400)))

  assert.equal(prompts[0], ROLE + hunksLine(open[0]) + '\nBLOCK-a.txt',
    '(a) [M1] and, symmetrically, conflict 1\'s brief carries its OWN block and only its own')
  assert.equal(prompts[0].includes('BLOCK-b.txt'), false,
    '(a) [M1] and not conflict 2\'s: ' + JSON.stringify(prompts[0].slice(0, 400)))
}

// ── (b) [M2] a string, unchanged — the wave loop's shape at BASE ─────────────
{
  const { open, prompts, out } = await drive('\nSTRING', 'leg-b')

  assert.equal(out.ok, true,
    '(b) [M2] sim precondition — the same two-conflict stop drains under a string block: ' +
    out.reason)
  assert.equal(prompts.length, 2,
    '(b) [M2] sim precondition — two prompts recorded, one per open conflict. Got ' +
    prompts.length + '.')

  assert.equal(prompts[0], ROLE + hunksLine(open[0]) + '\nSTRING',
    '(b) [M2] with `contendingBlock` a STRING, the brief is `roles.resolver` + the ' +
    '`HUNKS FILE:` line + that string, unchanged — the wave loop keeps passing its string ' +
    'and keeps getting BASE\'s brief')
}

// ── (c) [M3] the briefs directory, and the short string that names it ────────
{
  assert.equal(typeof publishFold.writeResolverBriefs, 'function',
    '(c) [M3] `fleet/publish-fold.mjs` exports `writeResolverBriefs({ briefsDir, attemptKey, ' +
    'open, blockFor, mainPatch })`')

  const root = fs.mkdtempSync(path.join(tmp, 'leg-c-'))
  const briefsDir = path.join(root, 'publish-fold', 'briefs')
  const open = openRows(root)

  // One block per conflicted path: the 200,000-byte one M3 names, and a short
  // one, so a brief that inlined either would be caught by its own bytes.
  const LONG = 'x'.repeat(BIG)
  const SHORT = 'short'
  assert.equal(Buffer.byteLength(LONG), BIG,
    '(c) [M3] sim precondition — the long block really is ' + BIG + ' bytes')
  const byPath = { 'a.txt': LONG, 'b.txt': SHORT }
  const blockFor = (p) => byPath[p]

  // The patch main gained since the run's base, written under this sim's own
  // temp root — `writeResolverBriefs` copies it into `briefsDir`.
  const mainPatch = path.join(root, 'main-source.patch')
  const patchBytes = Buffer.from(
    'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-one\n+two\n')
  fs.writeFileSync(mainPatch, patchBytes)

  const block = await publishFold.writeResolverBriefs(
    { briefsDir, attemptKey: ATTEMPT_KEY, open, blockFor, mainPatch })

  assert.equal(typeof block, 'function',
    '(c) [M3] `writeResolverBriefs` resolves to a FUNCTION of the conflict entry — the value ' +
    '`resolveConflicts` is handed as `contendingBlock`')

  // The per-path files, byte for byte.
  const contending = (i) => path.join(briefsDir, 'contending-' + i + '-' + ATTEMPT_KEY + '.txt')
  assert.equal(fs.existsSync(contending(1)), true,
    '(c) [M3] conflict 1\'s block is written at ' + contending(1))
  assert.equal(fs.existsSync(contending(2)), true,
    '(c) [M3] conflict 2\'s block is written at ' + contending(2))
  assert.equal(Buffer.compare(fs.readFileSync(contending(1)), Buffer.from(LONG)), 0,
    '(c) [M3] `contending-1-1.txt` holds EXACTLY `blockFor(\'a.txt\')` — the ' + BIG +
    '-byte block, byte for byte, nothing prepended and nothing trimmed (it is ' +
    fs.statSync(contending(1)).size + ' bytes)')
  assert.equal(Buffer.compare(fs.readFileSync(contending(2)), Buffer.from(SHORT)), 0,
    '(c) [M3] and `contending-2-1.txt` holds exactly `blockFor(\'b.txt\')`: ' +
    JSON.stringify(fs.readFileSync(contending(2), 'utf8').slice(0, 200)))

  // The patch, copied byte for byte.
  const copiedPatch = path.join(briefsDir, 'main.patch')
  assert.equal(fs.existsSync(copiedPatch), true,
    '(c) [M3] `mainPatch` is copied to ' + copiedPatch + ' — under the run directory the ' +
    'resolver is given as `--add-dir`, so the path the brief names is a path it can open')
  assert.equal(Buffer.compare(fs.readFileSync(copiedPatch), patchBytes), 0,
    '(c) [M3] and byte for byte')

  // The string the brief actually carries, for conflict 1.
  const s1 = block(open[0])
  assert.equal(typeof s1, 'string',
    '(c) [M3] the returned function answers a string for a conflict entry')
  const lines1 = s1.split('\n')

  const wantContending = CONTENDING_LINE + contending(1)
  assert.ok(lines1.some((l) => l.startsWith(wantContending)),
    '(c) [M3] conflict 1\'s string has a line beginning `' + wantContending + '` — the ' +
    'ABSOLUTE path of its own contending file. Lines: ' +
    JSON.stringify(lines1.map((l) => l.slice(0, 160))))

  const wantMain = MAIN_PATCH_LINE + copiedPatch
  assert.ok(lines1.some((l) => l.startsWith(wantMain)),
    '(c) [M3] and a line beginning `' + wantMain + '` — the absolute path of the COPY, the ' +
    'one under `briefsDir`. Lines: ' + JSON.stringify(lines1.map((l) => l.slice(0, 160))))

  assert.deepEqual(lines1.filter((l) => l.startsWith(RUN_LINE)), [],
    '(c) [M3] and no line beginning `' + RUN_LINE + '`: the brief names files, it does not ' +
    'hand the read-only resolver a command to run')

  assert.ok(Buffer.byteLength(s1) < BRIEF_CEILING,
    '(c) [M3] and the whole string is under ' + BRIEF_CEILING + ' bytes even though conflict ' +
    '1\'s block is ' + BIG + ' — a fold that still inlines the block fails here. It is ' +
    Buffer.byteLength(s1) + ' bytes: ' + JSON.stringify(s1.slice(0, 400)))

  // The same two lines for the other conflict, naming ITS file — M3 is written
  // "for each open conflict `i`", not for the first one alone.
  const s2 = block(open[1])
  const wantContending2 = CONTENDING_LINE + contending(2)
  assert.ok(String(s2).split('\n').some((l) => l.startsWith(wantContending2)),
    '(c) [M3] conflict 2\'s string names ITS own contending file, `' + wantContending2 +
    '` — one conflicted path per brief: ' + JSON.stringify(String(s2).slice(0, 400)))
  assert.ok(String(s2).split('\n').some((l) => l.startsWith(wantMain)),
    '(c) [M3] and the same main patch: ' + JSON.stringify(String(s2).slice(0, 400)))
  assert.equal(String(s2).includes(contending(1)), false,
    '(c) [M3] and not conflict 1\'s file: ' + JSON.stringify(String(s2).slice(0, 400)))
}

// ── (d) [M4] the role file says what the two lines name ──────────────────────
{
  const rolePath = path.join(FLEET, 'roles', 'resolver.md')
  const role = fs.readFileSync(rolePath, 'utf8')

  assert.ok(role.includes('CONTENDING TASKS FILE'),
    '(d) [M4] `fleet/roles/resolver.md` tells the resolver what a `CONTENDING TASKS FILE:` ' +
    'line names — the file holding the contending task bodies for this path, read before ' +
    'resolving. A role file naming neither line, or only the other one, fails here.')
  assert.ok(role.includes('MAIN PATCH FILE'),
    '(d) [M4] and what a `MAIN PATCH FILE:` line names — the patch main gained since the ' +
    'run\'s base, to open when a hunk\'s frontier side needs explaining')

  // The file's one stylistic pin (a Global Constraint of this plan): it carries
  // no shouted imperatives at BASE and keeps carrying none.
  for (const shout of ['MUST', 'NEVER', 'ALWAYS', 'DO NOT']) {
    assert.equal(role.includes(shout), false,
      '(d) [M4] and the file keeps its register — no shouted `' + shout + '`')
  }
}

// ── (e) [M4] the contract's receipts list, and the word count it does not gate ─
{
  const contract = fs.readFileSync(path.join(FLEET, 'CONTRACT.md'), 'utf8')
  assert.ok(contract.includes('contending-<i>-<attempt>.txt'),
    '(e) [M4] `fleet/CONTRACT.md`\'s `publish-fold/` receipts list names ' +
    '`contending-<i>-<attempt>.txt` — the contract is the authority for every literal this ' +
    'exam pins, and at BASE the list names `resolver-brief-<i>-<attempt>.txt` but not this')

  // Reported, exactly as the Proof's last `Run:` reports it. This gates nothing.
  const role = fs.readFileSync(path.join(FLEET, 'roles', 'resolver.md'), 'utf8')
  const words = role.split(/\s+/).filter(Boolean).length
  console.log('(e) [M4] fleet/roles/resolver.md: ' + words + ' words (reported; gates nothing)')
}

// ════════════════════════════════════════════════════════════════════════════
// TASK 2 — "A fold conflict leaves a receipt" — legs (c), (d) [M2] and (e) [M3]
//
// Everything above this line belongs to the task that wrote this file. What
// follows is a second task's exam, sharing this sim because this is the file
// that already imports `fleet/publish-fold.mjs` — and it imports it as a
// NAMESPACE, which is what lets the two exports below be absent at BASE
// without an ESM link error killing the legs above.
//
// Task 2's own legs are lettered by ITS Proof, so every assertion message below
// opens `T2 (x)/Mn` to keep the two letterings apart.
//
// The Machine clauses these legs come from, restated:
//
//   M2 — `foldReceiptOf({ open, disposition, reason, base, tip })`, exported
//        from `fleet/publish-fold.mjs`, returns `null` whenever `open` is
//        empty, WHATEVER the disposition — a fold that conflicted on no path
//        names no file, and a receipt names files — and otherwise
//        `{ paths, evidence }`: `paths` the distinct `path` values of the
//        `open` rows in lexical order; `evidence.read` the disposition followed
//        by `: <reason>` when a reason is given and the BARE disposition when
//        none is; `evidence.against` `base <base> tip <tip>` — each string cut
//        to the 500-character bound (the plan's shared RECEIPT SHAPE: a longer
//        one is 499 characters plus `…`).
//   M3 — `publishFoldEvent(row, open)`, exported from the same file, returns
//        the `driver:publish-fold` event object the fold appends — `kind`,
//        `run`, `attempt`, `base`, `tip`, `candidate`, `reason` when present,
//        `pathsJoined`, `pathsConflicted` (the LENGTH of `open`),
//        `resolversDispatched`, `resolverRetries`, `suite`, `disposition`,
//        `checks` and `checkRetries`, each taken from `row` as at BASE — with
//        `foldReceiptOf`'s object spread in when it is not `null`, and no
//        `paths`/`evidence` key when it is.
//
// Both are PURE functions, which is why they are pinned here without driving a
// fold: no sim at BASE drives `publishFold` end to end. WIRING the two
// `eventLog.onEvent({ kind: 'driver:publish-fold', … })` literals to
// `publishFoldEvent` is Task 7's, and is deliberately NOT graded here.
// ════════════════════════════════════════════════════════════════════════════

// The two shas the publish fold's row carries, 40 hex each, as the row carries
// them. Spelled once so `base <base> tip <tip>` is one literal below.
const T2_BASE = '1111111111111111111111111111111111111111'
const T2_TIP = '2222222222222222222222222222222222222222'
// The plan's shared RECEIPT SHAPE bound: each of `read` and `against` is at
// most this many characters, a longer one cut to BOUND-1 plus the ellipsis.
const T2_BOUND = 500
const T2_ELLIPSIS = '…'

{
  assert.equal(typeof publishFold.foldReceiptOf, 'function',
    'T2 (c)/M2: `foldReceiptOf` is exported from `fleet/publish-fold.mjs`. At BASE there is no ' +
    'such export and this is the assertion that says so. Exported names: ' +
    JSON.stringify(Object.keys(publishFold)))
  assert.equal(typeof publishFold.publishFoldEvent, 'function',
    'T2 (e)/M3: and `publishFoldEvent` beside it — the `driver:publish-fold` event object the ' +
    'fold appends, built in one place so both append sites can be wired to it. Exported ' +
    'names: ' + JSON.stringify(Object.keys(publishFold)))
}
const foldReceiptOf = publishFold.foldReceiptOf
const publishFoldEvent = publishFold.publishFoldEvent

// ── T2 leg (c) [M2] — an empty `open` is no receipt, and `folded` still is one ─
{
  assert.equal(foldReceiptOf({ open: [], disposition: 'folded', reason: '', base: 'b', tip: 't' }),
    null,
    'T2 (c)/M2: `foldReceiptOf` returns `null` whenever `open` is empty — a fold that ' +
    'conflicted on no path names no file, and a receipt names files. Got: ' +
    JSON.stringify(foldReceiptOf({ open: [], disposition: 'folded', reason: '', base: 'b', tip: 't' })))

  const redArgs = { open: [], disposition: 'suite red',
                    reason: 'the candidate\'s suite exited 1', base: 'b', tip: 't' }
  assert.equal(foldReceiptOf(redArgs), null,
    'T2 (c)/M2: and `null` WHATEVER the disposition — an empty `open` under `suite red` with a ' +
    'reason given is still no receipt, because the rule is about the files, not about how the ' +
    'fold ended. Got: ' + JSON.stringify(foldReceiptOf(redArgs)))

  // run-157's shape: a publish fold that ended `folded` after its conflicts
  // were resolved. A resolved conflict is still a conflict a later attempt's
  // resolver on the same path should see, so the fold still leaves a receipt.
  const folded = foldReceiptOf({
    open: [{ i: 1, path: 'a.txt' }],
    disposition: 'folded', reason: '', base: T2_BASE, tip: T2_TIP,
  })
  assert.ok(folded && typeof folded === 'object',
    'T2 (c)/M2: one open row on `a.txt` with `disposition: \'folded\'` IS a receipt — a ' +
    'resolved publish-fold conflict is still a conflict, and the record names it. Got: ' +
    JSON.stringify(folded))
  assert.equal(folded.evidence.read, 'folded',
    'T2 (c)/M2: with `reason: \'\'` the `read` is the BARE disposition, exactly `folded` — no ' +
    'trailing `: `, nothing appended: ' + JSON.stringify(folded))
  assert.deepEqual(folded.paths, ['a.txt'],
    'T2 (c)/M2: and its `paths` is `[\'a.txt\']`: ' + JSON.stringify(folded))
  assert.equal(folded.evidence.against, 'base ' + T2_BASE + ' tip ' + T2_TIP,
    'T2 (c)/M2: and `evidence.against` is `base <base> tip <tip>` — what the fold was folding ' +
    'onto: ' + JSON.stringify(folded))
}

// ── T2 leg (d) [M2] — sorted and de-duplicated, the reasoned `read`, the bound ─
{
  const REASON = 'resolver reported BLOCKED on a.txt'
  const parked = foldReceiptOf({
    open: [{ i: 1, path: 'z.txt' }, { i: 2, path: 'a.txt' }, { i: 3, path: 'a.txt' }],
    disposition: 'conflict parked', reason: REASON, base: T2_BASE, tip: T2_TIP,
  })
  assert.ok(parked && typeof parked === 'object',
    'T2 (d)/M2: three open rows are a receipt: ' + JSON.stringify(parked))
  assert.deepEqual(parked.paths, ['a.txt', 'z.txt'],
    'T2 (d)/M2: `paths` is the DISTINCT `path` values of the `open` rows in LEXICAL order — ' +
    'exactly `[\'a.txt\', \'z.txt\']`. A result that keeps the duplicate `a.txt`, or that keeps ' +
    'the input order `z.txt` first, fails this leg: ' + JSON.stringify(parked))
  assert.equal(parked.evidence.read, 'conflict parked: ' + REASON,
    'T2 (d)/M2: `evidence.read` is the disposition followed by `: <reason>` when a reason is ' +
    'given: ' + JSON.stringify(parked))
  assert.equal(parked.evidence.against, 'base ' + T2_BASE + ' tip ' + T2_TIP,
    'T2 (d)/M2: and `evidence.against` is `base <base> tip <tip>`: ' + JSON.stringify(parked))

  // The bound. 900 characters of reason, so `read` is over 500 before the cut.
  const LONG = 'x'.repeat(900)
  const cut = foldReceiptOf({
    open: [{ i: 1, path: 'a.txt' }],
    disposition: 'conflict parked', reason: LONG, base: T2_BASE, tip: T2_TIP,
  })
  assert.ok(cut && cut.evidence && typeof cut.evidence.read === 'string',
    'T2 (d)/M2: the long-reason call is still a receipt: ' + JSON.stringify(cut && cut.paths))
  assert.equal(cut.evidence.read.length, T2_BOUND,
    'T2 (d)/M2: with a 900-character `reason` the returned `read` is cut to the ' + T2_BOUND +
    '-character bound — exactly ' + T2_BOUND + ' characters, so a `FACTS:` block of 20 rows ' +
    'stays under 24 KB. It is ' + cut.evidence.read.length + ' characters.')
  assert.ok(cut.evidence.read.endsWith(T2_ELLIPSIS),
    'T2 (d)/M2: and it ends in `' + T2_ELLIPSIS + '` — the shared RECEIPT SHAPE cuts a longer ' +
    'string to ' + (T2_BOUND - 1) + ' characters plus the ellipsis, so a reader can see it was ' +
    'cut. It ends: ' + JSON.stringify(cut.evidence.read.slice(-8)))
  assert.equal(cut.evidence.read, ('conflict parked: ' + LONG).slice(0, T2_BOUND - 1) + T2_ELLIPSIS,
    'T2 (d)/M2: and the ' + (T2_BOUND - 1) + ' characters it keeps are the first ' +
    (T2_BOUND - 1) + ' of the uncut `read` — the cut takes the tail, it does not rewrite the ' +
    'head: ' + JSON.stringify(cut.evidence.read.slice(0, 40)))
}

// ── T2 leg (e) [M3] — the event object, key for key ──────────────────────────
{
  const row = {
    run: '7', attempt: '1', base: T2_BASE, tip: T2_TIP, candidate: '',
    reason: 'resolver reported BLOCKED on a.txt',
    pathsJoined: 1, resolversDispatched: 1, resolverRetries: 0,
    suite: 'none', disposition: 'conflict parked', checks: [], checkRetries: 0,
  }
  const open = [{ i: 1, path: 'a.txt' }]
  const ev = publishFoldEvent(row, open)

  assert.ok(ev && typeof ev === 'object',
    'T2 (e)/M3: `publishFoldEvent(row, open)` returns the event object: ' + JSON.stringify(ev))
  assert.deepEqual(Object.keys(ev).sort(),
    ['attempt', 'base', 'candidate', 'checkRetries', 'checks', 'disposition', 'evidence',
     'kind', 'paths', 'pathsConflicted', 'pathsJoined', 'reason', 'resolverRetries',
     'resolversDispatched', 'run', 'suite', 'tip'],
    'T2 (e)/M3: the event carries exactly the BASE literal\'s keys — `kind`, `run`, `attempt`, ' +
    '`base`, `tip`, `candidate`, `reason` (present here), `pathsJoined`, `pathsConflicted`, ' +
    '`resolversDispatched`, `resolverRetries`, `suite`, `disposition`, `checks`, ' +
    '`checkRetries` — with `foldReceiptOf`\'s `paths` and `evidence` spread in. No more, no ' +
    'fewer. Got: ' + JSON.stringify(Object.keys(ev).sort()))

  assert.equal(ev.kind, 'driver:publish-fold',
    'T2 (e)/M3: its `kind` is `driver:publish-fold`: ' + JSON.stringify(ev))
  assert.equal(ev.pathsConflicted, 1,
    'T2 (e)/M3: `pathsConflicted` is the LENGTH of `open`, not a key of the row: ' +
    JSON.stringify(ev))
  assert.deepEqual(ev.paths, ['a.txt'],
    'T2 (e)/M3: `paths` is `foldReceiptOf`\'s, `[\'a.txt\']`: ' + JSON.stringify(ev))
  assert.equal(ev.evidence.read, 'conflict parked: resolver reported BLOCKED on a.txt',
    'T2 (e)/M3: and `evidence.read` the disposition with its reason: ' + JSON.stringify(ev))
  assert.equal(ev.evidence.against, 'base ' + T2_BASE + ' tip ' + T2_TIP,
    'T2 (e)/M3: and `evidence.against` `base <base> tip <tip>`: ' + JSON.stringify(ev))

  // Every other value is the row's own, taken as at BASE.
  for (const k of ['run', 'attempt', 'base', 'tip', 'candidate', 'reason', 'pathsJoined',
                   'resolversDispatched', 'resolverRetries', 'suite', 'disposition',
                   'checkRetries']) {
    assert.equal(ev[k], row[k],
      'T2 (e)/M3: `' + k + '` is taken from `row`, as the BASE literal takes it — expected ' +
      JSON.stringify(row[k]) + ', got ' + JSON.stringify(ev[k]))
  }
  assert.deepEqual(ev.checks, row.checks,
    'T2 (e)/M3: and `checks` likewise: ' + JSON.stringify(ev.checks))

  // The same row folded clean: no reason, no open conflicts. `pathsConflicted`
  // is `0` and the three absent keys are ABSENT, not `undefined`-valued — the
  // receipt is spread in only when `foldReceiptOf` returned an object.
  const cleanRow = { ...row, disposition: 'folded' }
  delete cleanRow.reason
  const clean = publishFoldEvent(cleanRow, [])
  assert.deepEqual(Object.keys(clean).sort(),
    ['attempt', 'base', 'candidate', 'checkRetries', 'checks', 'disposition', 'kind',
     'pathsConflicted', 'pathsJoined', 'resolverRetries', 'resolversDispatched', 'run',
     'suite', 'tip'],
    'T2 (e)/M3: the same row with `disposition: \'folded\'`, no `reason` and `open` `[]` ' +
    'returns an object with NO `paths` key, NO `evidence` key and NO `reason` key — ' +
    '`foldReceiptOf` returned `null`, so nothing was spread in, and `reason` is carried only ' +
    'when present. Got: ' + JSON.stringify(Object.keys(clean).sort()))
  assert.equal(clean.pathsConflicted, 0,
    'T2 (e)/M3: and `pathsConflicted` is `0` — the length of the empty `open`: ' +
    JSON.stringify(clean))
  assert.equal(clean.disposition, 'folded',
    'T2 (e)/M3: and the disposition is the row\'s: ' + JSON.stringify(clean))
}

console.log('ALL TESTS PASSED')

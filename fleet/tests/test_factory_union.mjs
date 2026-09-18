// fleet/tests/test_factory_union.mjs — the exam for "Two edits that only add
// beside each other are kept, with no resolver".
//
// This file is the Proof's `Test: fleet/tests/test_factory_union.mjs`. It
// proves two things that live in two different files:
//
//   - `factory/union.mjs`'s own `unionReply(hunksText)` [M1], driven directly
//     with literal kernel-hunks text built by the `hunksText(...)` helper
//     below (mirroring `skills/ultrapowers/kernel/hunks.py`'s `derive()`
//     grammar, described verbatim in the task's Context).
//   - `factory/engine.mjs`'s `runEngine` wired to that union at a fold
//     conflict [M2, M3, M4], driven with a real (but tiny) git target repo, a
//     plan with one task, a fake `worker`, a fake `sh` standing in for the
//     kernel, and a `deps.readUnion` or `deps.ask` per scenario.
//
// Every process this file spawns itself (`git`) is handed `env: simEnv()`,
// never `process.env` — `factory/engine.mjs`'s own internal `python3` calls
// (the plan compiler, and the kernel it believes it is talking to before
// `sh` is substituted) are the module under test's business, not this file's.
//
// Legs, each naming the Machine clause it proves — see the hand-in note for
// the full mapping and what each leg assumes about the code under test.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { simEnv } from './_helpers.mjs'
import { runEngine, POLICY_PATH } from '../../factory/engine.mjs'
import { unionReply } from '../../factory/union.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')

const ENV = simEnv()
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-union-'))

const git = (argv, cwd) => {
  const r = spawnSync('git', argv, { cwd, encoding: 'utf8', env: ENV, maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) {
    throw new Error('git ' + argv.join(' ') + ' failed: ' + String(r.stderr || r.error || ''))
  }
  return String(r.stdout || '')
}

// ── the kernel's own hunks-file grammar, built the way `hunks.py`'s
// `derive()` builds it (Context, verbatim): one `HUNK <id> lines a-b` header,
// a read-only context block, `--- conflict`, the segment markers and their
// content lines exactly as written, another read-only context block, then a
// blank line — repeated per block, back to back. ──────────────────────────
function hunksText (blocks) {
  const out = []
  for (const { id, segments, before = ['ctx-before'], after = ['ctx-after'] } of blocks) {
    out.push('HUNK ' + id + ' lines 1-1')
    out.push('--- context (read-only)')
    for (const l of before) out.push('  ' + l)
    out.push('--- conflict')
    segments.forEach((seg, i) => {
      out.push((i === 0 ? '<<<<<<< begin ' : '======= begin ') + seg.kind + ' ' + seg.side)
      out.push(...seg.lines)
    })
    out.push('>>>>>>> end conflict')
    out.push('--- context (read-only)')
    for (const l of after) out.push('  ' + l)
    out.push('')
  }
  return out.join('\n')
}

// The one fixture every engine-driving leg re-uses: one block, two `added`
// segments — exactly the shape leg (a) proves `unionReply` reads correctly,
// so nothing downstream trusts a reading this file has not itself checked.
const GOOD_BLOCK = { id: 'h1', segments: [
  { kind: 'added', side: 'frontier', lines: ['import a'] },
  { kind: 'added', side: '3', lines: ['import b'] },
] }
const GOOD_HUNKS = hunksText([GOOD_BLOCK])
const GOOD_UNION_HUNKS = [{ id: 'h1', content: 'import a\nimport b' }]

// A block whose second segment is `deleted` — disqualifies the whole file.
const BAD_HUNKS = hunksText([{ id: 'h1', segments: [
  { kind: 'added', side: 'frontier', lines: ['import a'] },
  { kind: 'deleted', side: '3', lines: ['old line'] },
] }])

// ─────────────────────────────────────────────────────────────────────────
// (a) [M1] `unionReply` driven directly, no engine involved.
// ─────────────────────────────────────────────────────────────────────────

assert.deepStrictEqual(
  unionReply(GOOD_HUNKS),
  { hunks: GOOD_UNION_HUNKS },
  '(a) [M1]: one block, an `added frontier` segment holding `import a` and an `added 3` segment ' +
  'holding `import b` -> `unionReply` deep-equals `{ hunks: [{ id: \'h1\', content: \'import ' +
  'a\\nimport b\' }] }`, one entry per block and every added segment\'s lines, in order, ' +
  'newline-joined. Got: ' + JSON.stringify(unionReply(GOOD_HUNKS)))

const TWO_BLOCK_HUNKS = hunksText([
  GOOD_BLOCK,
  { id: 'h2', segments: [
    { kind: 'added', side: 'frontier', lines: ['import c'] },
    { kind: 'added', side: '5', lines: ['import d'] },
  ] },
])
assert.deepStrictEqual(
  unionReply(TWO_BLOCK_HUNKS),
  { hunks: [{ id: 'h1', content: 'import a\nimport b' }, { id: 'h2', content: 'import c\nimport d' }] },
  '(a) [M1]: two `HUNK` blocks -> `unionReply` answers two entries, in the blocks\' own order. ' +
  'Got: ' + JSON.stringify(unionReply(TWO_BLOCK_HUNKS)))

assert.equal(
  unionReply(BAD_HUNKS), null,
  '(a) [M1]: a `deleted 3` segment in the (only) block -> `unionReply` answers `null` — one ' +
  'disqualifying segment anywhere disqualifies the whole file. Got: ' + JSON.stringify(unionReply(BAD_HUNKS)))

const TWO_BLOCK_ONE_BAD = hunksText([
  GOOD_BLOCK,
  { id: 'h2', segments: [
    { kind: 'added', side: 'frontier', lines: ['import c'] },
    { kind: 'deleted', side: '3', lines: ['old line'] },
  ] },
])
assert.equal(
  unionReply(TWO_BLOCK_ONE_BAD), null,
  '(a) [M1]: a `deleted` segment in ANY block (here the second of two, the first otherwise ' +
  'clean) still answers `null` for the whole file, not just that block. Got: ' +
  JSON.stringify(unionReply(TWO_BLOCK_ONE_BAD)))

assert.equal(
  unionReply(''), null,
  '(a) [M1]: the empty string (no `HUNK` block at all) -> `unionReply` answers `null`. Got: ' +
  JSON.stringify(unionReply('')))

// ─────────────────────────────────────────────────────────────────────────
// The rig for (b)-(d): a real, tiny git target repo and a one-task plan;
// `sh` stands in for the kernel and the task's own (never-really-run) test
// command; `worker` stands in for the model. `runEngine`'s own internal
// python3 calls (the plan compiler) are real, exactly as the task's Context
// describes; nothing here fakes those.
// ─────────────────────────────────────────────────────────────────────────

const TARGET = path.join(TMP, 'target')
fs.mkdirSync(TARGET, { recursive: true })
git(['init', '-q', '-b', 'main'], TARGET)
git(['config', 'user.email', 'sim@test'], TARGET)
git(['config', 'user.name', 'sim'], TARGET)
fs.writeFileSync(path.join(TARGET, 'README.md'), 'base\n')
git(['add', '-A'], TARGET)
git(['commit', '-q', '-m', 'base'], TARGET)
const BASE_SHA = git(['rev-parse', 'HEAD'], TARGET).trim()

const PLAN_PATH = path.join(TMP, 'plan.md')
fs.writeFileSync(PLAN_PATH, `# Sim Plan

### Task 1: union sim task

**Type:** implementation

**Files:**
- Create: \`stuff.txt\`
- Test: \`fleet/tests/test_dummy_stub.mjs\`

**Claim:** a sim fixture task; nothing here is read for its Machine clauses.

**Interfaces:**
- Consumes: none
- Produces: none

**Proof:**
- Test: \`fleet/tests/test_dummy_stub.mjs\`
`)

const CONFLICT_PATH = 'lib/thing.txt'

/**
 * One `runEngine` drive. `hunksTextValue` is written to a real file and
 * handed back as the one open conflict's `hunksFile`, exactly as the kernel's
 * `fold` would leave it; `sh` never really runs python3 or git for the
 * kernel or the task's test command — both verbs it is asked for are
 * answered in-process. `policyMode` overrides `resolve.union.mode` on a
 * private copy of the real `factory/policy.json` (so the live
 * `independent_additions`/`shared_anchor_max`/`ordering_matters_max`
 * thresholds — 0.9 / 0.2 / 0.2 — travel unchanged into every scenario); the
 * copy also turns `select` and `redispatch` off, which are a different
 * task's business and would otherwise add dispatches this file is not
 * counting.
 */
function makeRig ({ name, hunksTextValue, policyMode, readUnion, ask }) {
  const runDir = path.join(TMP, name)
  fs.mkdirSync(runDir, { recursive: true })
  const hunksFile = path.join(runDir, 'hunks.txt')
  fs.writeFileSync(hunksFile, hunksTextValue)

  const policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'))
  policy.resolve = { ...policy.resolve, union: { ...policy.resolve.union, mode: policyMode } }
  policy.select = { ...(policy.select || {}), enabled: false }
  policy.landing = { ...(policy.landing || {}), redispatch: { ...((policy.landing || {}).redispatch || {}), enabled: false } }
  const policyPath = path.join(runDir, 'policy.json')
  fs.writeFileSync(policyPath, JSON.stringify(policy))

  const dispatches = []
  const worker = async (opts) => {
    dispatches.push(opts.label)
    // The one implementer this task ever needs: a real file, so `capture`
    // (git add -A; git diff --cached) leaves a non-empty patch to fold.
    if (opts.role === 'implement') fs.writeFileSync(path.join(opts.cwd, 'stuff.txt'), 'created\n')
    return { result: { total_cost_usd: 0 }, denials: [] }
  }

  const shCalls = []
  const sh = (cmd, argv = [], cwd) => {
    shCalls.push({ cmd, argv: [...argv] })
    if (cmd === 'node') return { status: 0, stdout: 'ok\n' } // the task's own (fake) test command
    if (String(argv[0] || '').includes('fold_wave.py')) {
      const verb = argv[1]
      if (verb === 'fold') {
        return { status: 0, stdout: JSON.stringify({ complete: false, open: [{ i: 1, path: CONFLICT_PATH, hunksFile }] }) }
      }
      if (verb === 'materialize') {
        return { status: 0, stdout: JSON.stringify({ candidateSha: BASE_SHA }) }
      }
      if (verb === 'resolve') {
        return { status: 0, stdout: JSON.stringify({ complete: true }) }
      }
    }
    return { status: 0, stdout: '' }
  }

  const deps = { worker, sh, git, judge: {}, log: () => {} }
  if (readUnion !== undefined) deps.readUnion = readUnion
  if (ask !== undefined) deps.ask = ask

  const args = { plan: PLAN_PATH, target: TARGET, runDir, base: BASE_SHA, policy: policyPath }
  return {
    runDir,
    dispatches,
    shCalls,
    run: () => runEngine(args, deps),
    events: () => fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l)),
  }
}

const resolveShCall = (shCalls) => shCalls.find((c) => c.cmd === 'python3' && c.argv[1] === 'resolve')
const argvAfter = (argv, flag) => argv[argv.indexOf(flag) + 1]

// ─────────────────────────────────────────────────────────────────────────
// (b) [M2] mode `live`, `deps.readUnion` answers `union: true`.
// ─────────────────────────────────────────────────────────────────────────

{
  const rig = makeRig({
    name: 'b', hunksTextValue: GOOD_HUNKS, policyMode: 'live',
    readUnion: async () => ({ union: true }),
  })
  const result = await rig.run()

  assert.ok(!rig.dispatches.some((l) => l.startsWith('resolve:')),
    '(b) [M2]: no dispatch label begins `resolve:` — the resolver is never dispatched for a ' +
    'united conflict. Dispatch labels: ' + JSON.stringify(rig.dispatches))

  const replyDir = path.join(rig.runDir, 'reply-1-1')
  assert.equal(
    fs.readFileSync(path.join(replyDir, 'h1.txt'), 'utf8'), 'import a\nimport b\n',
    '(b) [M2]: the reply directory holds `h1.txt` reading the union\'s content with the ' +
    'trailing newline the existing reply-writing code adds.')
  assert.ok(fs.existsSync(path.join(replyDir, 'notes.txt')),
    '(b) [M2]: and a `notes.txt` saying the blocks were united.')

  const call = resolveShCall(rig.shCalls)
  assert.ok(call, '(b) [M2]: the kernel\'s `resolve` verb was called, exactly as it is for a ' +
    'resolver\'s reply. Kernel calls seen: ' + JSON.stringify(rig.shCalls.map((c) => c.argv[1])))
  assert.equal(argvAfter(call.argv, '--conflict'), '1',
    '(b) [M2]: ...with `--conflict 1`. argv: ' + JSON.stringify(call.argv))
  assert.equal(argvAfter(call.argv, '--reply-dir'), replyDir,
    '(b) [M2]: ...and `--reply-dir` naming that same reply directory. argv: ' + JSON.stringify(call.argv))

  assert.ok(result.adopted.includes('1'),
    '(b) [M2]: a fold with mode `live`, a hunks file `unionReply` reads (not `null`), and a ' +
    '`readUnion` answering `union: true` -> the task is adopted. Adopted: ' + JSON.stringify(result.adopted))

  const events = rig.events()
  assert.deepStrictEqual(
    events.find((e) => e.kind === 'union'),
    { kind: 'union', task: '1', path: CONFLICT_PATH, hunks: 1 },
    '(b) [M2]: `events.jsonl` carries `{ kind: \'union\', task, path, hunks: <count> }` for the ' +
    'united conflict. Events: ' + JSON.stringify(events))
}

// ─────────────────────────────────────────────────────────────────────────
// (c) [M3] no `deps.readUnion`: the engine builds one from `deps.ask`.
// ─────────────────────────────────────────────────────────────────────────

{
  const askCalls = []
  const answersFor = { independent_additions: 0.95, shared_anchor: 0.1, ordering_matters: 0.1 }
  const ask = async ({ state, questions }) => {
    askCalls.push({ state, questions })
    const answers = {}
    for (const key of Object.keys(questions)) answers[key] = answersFor[key]
    return answers
  }
  const rig = makeRig({ name: 'c-unite', hunksTextValue: GOOD_HUNKS, policyMode: 'live', ask })
  const result = await rig.run()

  assert.ok(result.adopted.includes('1'),
    '(c) [M3]: with no `deps.readUnion` and `deps.ask` answering `independent_additions` 0.95 ' +
    '(>= policy\'s 0.9), `shared_anchor` 0.1 and `ordering_matters` 0.1 (both <= policy\'s 0.2) ' +
    '-> the drive unites, exactly as (b): the task is adopted. Adopted: ' + JSON.stringify(result.adopted))
  assert.ok(fs.existsSync(path.join(rig.runDir, 'reply-1-1', 'h1.txt')),
    '(c) [M3]: ...and it wrote the reply file the union path writes.')
  assert.ok(!rig.dispatches.some((l) => l.startsWith('resolve:')),
    '(c) [M3]: ...dispatching no resolver.')
  assert.ok(rig.events().some((e) => e.kind === 'union'),
    '(c) [M3]: ...and appending the `union` row.')

  assert.equal(askCalls.length, 1,
    '(c) [M3]: `ask` was called exactly once to build `readUnion`\'s one reading. Calls: ' + askCalls.length)
  assert.deepStrictEqual(
    Object.keys(askCalls[0].questions).sort(),
    ['independent_additions', 'ordering_matters', 'shared_anchor'],
    '(c) [M3]: the questions put to `ask` are keyed exactly the resolve set\'s ' +
    '`independent_additions`, `shared_anchor` and `ordering_matters` — no more, no fewer. Keys: ' +
    JSON.stringify(Object.keys(askCalls[0].questions)))
  assert.deepStrictEqual(
    askCalls[0].state, { hunks: GOOD_UNION_HUNKS },
    '(c) [M3]: ...with state `{ hunks }`, `hunks` being `unionReply`\'s own `hunks` array for ' +
    'this conflict\'s file — the same array leg (a) already proved `unionReply` produces for this ' +
    'exact fixture. Got: ' + JSON.stringify(askCalls[0].state))
}

{
  const ask = async ({ questions }) => {
    const answersFor = { independent_additions: 0.95, shared_anchor: 0.5, ordering_matters: 0.1 }
    const answers = {}
    for (const key of Object.keys(questions)) answers[key] = answersFor[key]
    return answers
  }
  const rig = makeRig({ name: 'c-resolver', hunksTextValue: GOOD_HUNKS, policyMode: 'live', ask })
  await rig.run()

  const resolveDispatches = rig.dispatches.filter((l) => l.startsWith('resolve:'))
  assert.equal(resolveDispatches.length, 1,
    '(c) [M3]: the same fixture, but `shared_anchor` answered 0.5 (above the policy\'s 0.2 ' +
    'ceiling) -> `readUnion` answers `union: false` and a resolver is dispatched instead. ' +
    'Dispatch labels: ' + JSON.stringify(rig.dispatches))
  assert.ok(!rig.events().some((e) => e.kind === 'union'),
    '(c) [M3]: ...and no `union` row is appended.')
}

// ─────────────────────────────────────────────────────────────────────────
// (d) [M4] three ways the union is skipped and the resolver runs as today.
// ─────────────────────────────────────────────────────────────────────────

async function assertResolverPath (name, opts, why) {
  const rig = makeRig({ name, ...opts })
  await rig.run()
  const resolveDispatches = rig.dispatches.filter((l) => l.startsWith('resolve:'))
  assert.equal(resolveDispatches.length, 1,
    '(d) [M4]: ' + why + ' -> exactly one dispatch label begins `resolve:`. Dispatch labels: ' +
    JSON.stringify(rig.dispatches))
  assert.ok(!rig.events().some((e) => e.kind === 'union'),
    '(d) [M4]: ' + why + ' -> no `union` row is appended. Events: ' + JSON.stringify(rig.events()))
}

await assertResolverPath('d-false', {
  hunksTextValue: GOOD_HUNKS, policyMode: 'live', readUnion: async () => ({ union: false }),
}, '`readUnion` answers `union: false`')

await assertResolverPath('d-null', {
  hunksTextValue: BAD_HUNKS, policyMode: 'live', readUnion: async () => ({ union: true }),
}, 'the hunks file carries a `deleted` segment, so `unionReply` answers `null` (even though ' +
   '`readUnion` itself would say yes)')

await assertResolverPath('d-record-only', {
  hunksTextValue: GOOD_HUNKS, policyMode: 'record-only', readUnion: async () => ({ union: true }),
}, 'the policy copy\'s mode is `record-only`, not `live` (even though `unionReply` and ' +
   '`readUnion` both would unite)')

console.log('ALL TESTS PASSED')

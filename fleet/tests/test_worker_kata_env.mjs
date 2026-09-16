/**
 * fleet/tests/test_worker_kata_env.mjs — the exam for Task 2: *every worker
 * session is a kata actor with its issue in hand*.
 *
 * This file is the Proof's `Test: fleet/tests/test_worker_kata_env.mjs`,
 * written where the Proof names it. Every relative import is written for THIS
 * directory: `../` is the repository's `fleet/`, `./` is `fleet/tests/`.
 *
 * The legs, and what each asserts — every assertion below names its leg and
 * the Machine clause it comes from, so a reader can map this file back to the
 * contract:
 *
 *   (a) [M1] With a kata record naming project `p` and tasks `3` (short_id
 *       `ab12`) and `4` (`cd34`), `envFor({label: 'impl:3'})` returns EXACTLY
 *       the four variables — `KATA_SERVER=https://kata.int.exe.xyz`,
 *       `KATA_AUTH_TOKEN=edge-injects-the-bearer`,
 *       `KATA_AUTHOR=impl:3@run-114` and `KATA_REF=p#ab12`;
 *       `envFor({label: 'review:3:1:2'})` carries the same `KATA_REF` under its
 *       own author; a label naming no task the record knows (`integration`,
 *       `reconcile:wave1:1`) carries the three and no `KATA_REF`; the spawned
 *       child's env (through `childEnvFor`) carries them, the per-worker value
 *       winning over a run-wide one; and with no kata record `envFor` returns
 *       `{}` and the child env has none of the four.
 *   (b) [M2] `writeConfineSettings({…, kataOn: true})` writes a file whose
 *       `hooks.PreToolUse` deep-equals BASE's and whose
 *       `hooks.SessionStart[0].hooks[0].command` is `kata attention-hook start`
 *       and `hooks.SessionEnd[0].hooks[0].command` is `kata attention-hook
 *       end`; with `kataOn: false` and `hookPath` `/x/confine-hook.mjs` the
 *       file's git blob hash is the frozen pre-edit literal
 *       `19d85fde0477d667538d9a6ac213560fe0736e3a`. The same file, written by
 *       `run-main` itself, carries the two hooks under `--kata` and neither
 *       without it; and either way it is handed to the three write roles and
 *       to no other.
 *   (c) [M3] The engine sim's kata stub counts exactly one `getIssue` per task
 *       through dispatch, its answer carrying `short_id`, and the row the
 *       engine keeps afterwards has `shortId` equal to it.
 *   (d) [M4] `fleet/CONTRACT.md`'s kata record (engine) bullet names the four
 *       variables and the two hooks, in the order the Proof's `Run:` greps for.
 *
 * Nothing here reaches a hub or spawns a `claude`: the hub client is a fake
 * with the client's method names, and every dispatch's `spawnFn` is injected.
 * Below the agent seam the engine rig is real, as in the sibling engine sims —
 * real git repositories, real clones, the real capture, the real fold kernel
 * through the real `execSeam`. The rig is a COPY of `_engine_helpers.rig`'s
 * body with one addition (`kata` passed through to `runEngine`), because that
 * helper is not in this task's Files.
 *
 * The only bearer any of this holds is the literal placeholder the edge
 * replaces: no real token string is written anywhere here.
 */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import {
  composeAgent, provisionRunTree, runMain, writeConfineSettings,
} from '../run-main.mjs'
import { cloneAtBase, makeCwdFor, withPatchCapture, defaultTaskIdOf, makeEventLog }
  from '../run-waves.mjs'
import { runEngine } from '../run-engine.mjs'
import { execSeam } from '../run-main.mjs'
import { ENV, makeRepo, provision, passReview, cleanCritic, doneImpl }
  from './_engine_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'worker-kata-env-')))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))
const mkdir = (p) => { fs.mkdirSync(p, { recursive: true }); return p }

// ══ M1's four literals, spelled once ═══════════════════════════════════════
const KATA_SERVER = 'https://kata.int.exe.xyz'
// The placeholder, and nothing else: the edge replaces the `Authorization`
// header with the real bearer, so this string is what a worker holds and it is
// worth nothing outside the fleet.
const KATA_AUTH_TOKEN = 'edge-injects-the-bearer'
const KATA_KEYS = ['KATA_SERVER', 'KATA_AUTH_TOKEN', 'KATA_AUTHOR', 'KATA_REF']

// The run this exam's workers belong to, and the two issues the record names.
const RUN_ID = 'run-114'
const PROJECT = 'p'
const SHORT_3 = 'ab12'
const SHORT_4 = 'cd34'

/**
 * The record `fleet/launch.mjs` writes, for tasks `3` and `4` — shaped as the
 * launcher writes it (#963): every task row is `{uid, short_id, revision}` in
 * that order, carrying the `short_id` its `createIssue` answered, and the run's
 * row stays `{uid, revision}`. Nothing below plants a short id onto a row: what
 * `envFor` reads is what a launcher's record already holds. The seam is
 * exercised against real launcher bytes in `test_worker_kata_ref.mjs`.
 */
const RECORD = () => ({
  url: KATA_SERVER,
  project: { id: 7, uid: 'PROJ0', name: PROJECT },
  run: { uid: 'RUN0', revision: 1 },
  tasks: {
    3: { uid: 'U-3', short_id: SHORT_3, revision: 1 },
    4: { uid: 'U-4', short_id: SHORT_4, revision: 1 },
  },
})

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] the env of every worker process
// ══════════════════════════════════════════════════════════════════════════

// The `runMain` flow, driven exactly as `test_run_main_effort.mjs` and
// `test_run_engine_kata.mjs` drive it: a fake `exec` playing the python
// scripts, a fake `runEngineFn` that records what it was handed, and a fake
// `makeAgent` that keeps the seams run-main built — `envFor` among them.
const RUNMAIN_WAVES = () => [[
  { id: '3', title: 't3', files: ['a.txt'], tier: null, review: 'lean',
    writes: ['a.txt'], commutes: [] },
  { id: '4', title: 't4', files: ['b.txt'], tier: null, review: 'lean',
    writes: ['b.txt'], commutes: [] },
]]

/** The hub client run-main is handed: it posts, and it never reads. */
const makeRunMainKata = () => {
  const comments = []
  return {
    comments,
    client: {
      async getIssue () {
        throw new Error('run-main sim: the engine is stubbed; no read expected here')
      },
      async comment (projectId, uid, body) {
        comments.push({ projectId, uid, body })
        return { uid, revision: comments.length + 1 }
      },
    },
  }
}

async function runMainFlow ({ name, kataPath }) {
  const target = mkdir(path.join(tmp, 'rm-' + name))
  const git = (argv, cwd) => execFileSync('git', argv,
    { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git(['init', '-q', '-b', 'fleet-base'], target)
  git(['config', 'user.email', 't@example.com'], target)
  git(['config', 'user.name', 't'], target)
  fs.writeFileSync(path.join(target, 'a.txt'), 'base\n')
  fs.writeFileSync(path.join(target, 'b.txt'), 'base\n')
  git(['add', '-A'], target)
  git(['commit', '-q', '-m', 'base'], target)

  const runId = RUN_ID
  const planPath = path.join(target, 'plan.md')
  fs.writeFileSync(planPath, '# plan\n')
  const runDir = path.join(target, '.claude/ultrapowers', name)
  const argsFile = path.join(runDir, 'args.json')
  const waves = RUNMAIN_WAVES()
  const exec = async (cmd, argv, opts = {}) => {
    if (cmd === 'git') {
      try {
        return { code: 0, stdout: execFileSync('git', argv,
          { cwd: opts.cwd, env: ENV, encoding: 'utf8' }), stderr: '' }
      } catch (e) {
        return { code: 1, stdout: '', stderr: String((e && (e.stderr || e.message)) || e) }
      }
    }
    if (cmd === 'claude' && argv[0] === 'auth') {
      return { code: 0, stdout: JSON.stringify({ authMethod: 'oauth', subscriptionType: 'max' }),
               stderr: '' }
    }
    const script = path.basename(argv[0])
    if (script === 'ultra_run.py' && argv.includes('--validate-knobs')) {
      return { code: 0, stdout: '{"ok": true}', stderr: '' }
    }
    if (script === 'ultra_run.py') {
      mkdir(runDir)
      fs.writeFileSync(argsFile, JSON.stringify({
        waves, wavesPath: path.join(runDir, 'launch.json'),
        edges: [], acceptance: { mode: 'suite' }, waveLabels: ['w1'],
        globalConstraints: '', planPath: argv[1],
        pluginRoot: target, runDir, testCmd: 'true',
      }, null, 2))
      const receipt = { ok: true, baseBranch: 'fleet-base', argsFile, testCmd: 'true' }
      fs.writeFileSync(path.join(runDir, 'receipt.json'), JSON.stringify(receipt))
      return { code: 0, stdout: JSON.stringify(receipt), stderr: '' }
    }
    if (script === 'finalize_report.py') return { code: 0, stdout: '', stderr: '' }
    if (script === 'ultra_gate.py' && argv.includes('--approve')) {
      return { code: 0, stdout: JSON.stringify({ mode: 'suite', stamp: runId }), stderr: '' }
    }
    if (script === 'ultra_gate.py') {
      fs.writeFileSync(path.join(runDir, 'gate-receipt.json'), JSON.stringify({
        verdict: 'PASS', gateCheck: { verdict: 'PASS', checks: [], acks: [] }, gateCheckExit: 0,
      }))
      return { code: 0, stdout: '', stderr: '' }
    }
    throw new Error('exec stub: unexpected ' + cmd + ' ' + argv.join(' '))
  }
  let received = null
  let seams = null
  const hubFake = makeRunMainKata()
  const out = await runMain(
    { planPath, runId, repoDir: target, tier: 'mostCapable', overlap: null, testCmd: null,
      bootstrapCmd: null, cli: 'claude', ...(kataPath === undefined ? {} : { kata: kataPath }) },
    {
      exec,
      log: () => {},
      kataClientFor: () => hubFake.client,
      runEngineFn: async (deps) => {
        received = deps
        return { integrationBranch: 'ultra/integration-' + runId, waveMerges: [], tasks: [] }
      },
      makeAgent: (opts) => {
        seams = opts
        return { agent: async () => null, patchInput: opts.patchesDir }
      },
    },
  )
  return { out, received, seams: () => seams, runDir, target }
}

// ── the flow WITH a record ─────────────────────────────────────────────────
const recordFile = path.join(tmp, 'kata-record.json')
fs.writeFileSync(recordFile, JSON.stringify(RECORD(), null, 2))
const withKata = await runMainFlow({ name: 'with-kata', kataPath: recordFile })
assert.equal(withKata.out.code, 0,
  '(a) [M1] the run-main flow with --kata is green — ' +
  withKata.out.verdict + ': ' + withKata.out.detail)
const seamsK = withKata.seams()
assert.ok(seamsK, '(a) [M1] run-main built a worker (makeAgent was called)')
assert.equal(typeof seamsK.envFor, 'function',
  '(a) [M1] run-main hands `makeAgent` an `envFor(opts)` seam beside `filesFor` — ' +
  'the per-worker kata environment; got ' + JSON.stringify(typeof seamsK.envFor))
const envForK = seamsK.envFor

// `envFor` reads the task's kata row at CALL time (as `filesFor` reads the
// sheet), and the row it reads is the LAUNCHER's: the record run-main parsed
// already carries each task's `short_id` (#963), so nothing here writes one
// onto it. The engine is stubbed, and that is exactly the point — no dispatch
// has happened, and the reference is there anyway.
const recordSeen = withKata.received && withKata.received.args && withKata.received.args.kataRecord
assert.ok(recordSeen && recordSeen.tasks && recordSeen.tasks['3'] && recordSeen.tasks['4'],
  '(a) [M1] the engine was handed the parsed record, with a row per task; got ' +
  JSON.stringify(recordSeen))
assert.equal(recordSeen.tasks['3'].short_id, SHORT_3,
  '(a) [M1] the parsed record\'s own row for task 3 carries short_id ' + SHORT_3 +
  ' — the launcher\'s, not one this exam planted; got ' + JSON.stringify(recordSeen.tasks['3']))
assert.equal(recordSeen.tasks['4'].short_id, SHORT_4,
  '(a) [M1] and task 4\'s row carries ' + SHORT_4 + '; got ' +
  JSON.stringify(recordSeen.tasks['4']))

/** What M1 says a worker of `label` carries, for a task the record knows. */
const fourFor = (label, shortId) => ({
  KATA_SERVER,
  KATA_AUTH_TOKEN,
  KATA_AUTHOR: label + '@' + RUN_ID,
  KATA_REF: PROJECT + '#' + shortId,
})
/** …and for a label naming no task the record knows: the three, no `KATA_REF`. */
const threeFor = (label) => ({
  KATA_SERVER,
  KATA_AUTH_TOKEN,
  KATA_AUTHOR: label + '@' + RUN_ID,
})

assert.deepEqual(envForK({ label: 'impl:3' }), fourFor('impl:3', SHORT_3),
  '(a) [M1] envFor({label: "impl:3"}) is exactly the four variables — the server, the ' +
  'placeholder bearer, impl:3@' + RUN_ID + ' and ' + PROJECT + '#' + SHORT_3)
assert.deepEqual(envForK({ label: 'review:3:1:2' }), fourFor('review:3:1:2', SHORT_3),
  '(a) [M1] a reviewer of task 3 speaks as itself (review:3:1:2@' + RUN_ID + ') and holds ' +
  'the SAME issue reference ' + PROJECT + '#' + SHORT_3)
assert.deepEqual(envForK({ label: 'exam:4' }), fourFor('exam:4', SHORT_4),
  '(a) [M1] and task 4\'s examiner holds task 4\'s issue, ' + PROJECT + '#' + SHORT_4)
assert.deepEqual(envForK({ label: 'fix:3:0' }), fourFor('fix:3:0', SHORT_3),
  '(a) [M1] a fix round is task 3\'s too — fix:3:0@' + RUN_ID + ', ' + PROJECT + '#' + SHORT_3)
assert.deepEqual(envForK({ label: 'integration' }), threeFor('integration'),
  '(a) [M1] the critic\'s label names no task the record knows: three variables, no KATA_REF')
assert.deepEqual(envForK({ label: 'reconcile:wave1:1' }), threeFor('reconcile:wave1:1'),
  '(a) [M1] and neither does reconcile:wave1:1 — three variables, no KATA_REF')

// ── the flow WITHOUT a record ──────────────────────────────────────────────
const noKata = await runMainFlow({ name: 'no-kata' })
assert.equal(noKata.out.code, 0,
  '(a) [M1] the run-main flow without --kata is green — ' +
  noKata.out.verdict + ': ' + noKata.out.detail)
const seamsN = noKata.seams()
assert.ok(seamsN, '(a) [M1] run-main built a worker without --kata too')
assert.equal(typeof seamsN.envFor, 'function',
  '(a) [M1] the `envFor(opts)` seam is handed over with or without a record; got ' +
  JSON.stringify(typeof seamsN.envFor))
for (const label of ['impl:3', 'review:3:1:2', 'integration']) {
  assert.deepEqual(seamsN.envFor({ label }), {},
    '(a) [M1] without a kata record envFor({label: "' + label + '"}) is {} — ' +
    'none of the four is set')
}

// ── the spawned child ──────────────────────────────────────────────────────
// The real chain: composeAgent → createRunWorker → childEnvFor → spawn. Only
// the process is faked, and the env it was handed is read off the spawn.
const ENVELOPE = JSON.stringify({
  type: 'result', subtype: 'success', is_error: false, session_id: 's',
  structured_output: { ok: true }, usage: {}, total_cost_usd: 0,
}) + '\n'
const PROMPT = 'TEST COMMAND: bash check.sh\n\ndo the thing\n'

/** One repository at BASE, for the clones the dispatches run in. */
const childRepo = makeRepo(path.join(tmp, 'child-repo'))
const childBase = execFileSync('git', ['rev-parse', 'HEAD'],
  { cwd: childRepo, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

/**
 * Dispatch `labels` through a composed agent and answer the env each spawn was
 * handed, by label. `extra` is folded into `composeAgent`'s arguments — the
 * `envFor` under test, when there is one.
 */
async function childEnvsFor ({ name, baseEnv, extra, labels }) {
  const runDir = path.join(tmp, 'child-' + name)
  const tree = provisionRunTree({ repoDir: childRepo, runDir, base: childBase, taskIds: ['3'] })
  // The examiner runs in a clone of its own (#653): the engine cuts `exam-<id>`
  // at dispatch and `provisionRunTree` does not, so this rig cuts it here.
  cloneAtBase({ repo: childRepo, dest: path.join(tree.clonesDir, 'exam-3'), base: childBase })
  const eventLog = makeEventLog({
    file: path.join(runDir, 'events.jsonl'), runId: name, base: childBase,
  })
  const seen = []
  const spawnFn = (cli, argv, opts) => {
    seen.push({ cli, argv, env: (opts && opts.env) || {} })
    const child = new EventEmitter()
    child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {}
    child.stderr = new EventEmitter(); child.stderr.setEncoding = () => {}
    // The worker writes the prompt to stdin and ends it; this stub only has to
    // accept that. What the prompt transport itself proves is in
    // `test_worker_prompt_stdin.mjs` — this file owns the env surface.
    child.stdin = new EventEmitter(); child.stdin.end = () => {}
    child.kill = () => {}
    setImmediate(() => { child.stdout.emit('data', ENVELOPE); child.emit('close', 0, null) })
    return child
  }
  const { agent } = composeAgent({
    runId: RUN_ID, base: childBase, runDir,
    clonesDir: tree.clonesDir, patchesDir: tree.patchesDir, workersDir: tree.workersDir,
    promptFileFor: () => undefined, settingsFor: () => undefined,
    env: baseEnv, cli: 'claude', eventLog, spawnFn,
    ...extra,
  })
  const out = new Map()
  for (const { label, isolation } of labels) {
    const before = seen.length
    await agent(PROMPT, { label, model: 'opus', ...(isolation ? { isolation } : {}) })
    assert.equal(seen.length, before + 1, label + ' dispatched exactly one `claude`')
    out.set(label, seen[seen.length - 1].env)
  }
  return out
}

const DISPATCHES = [
  { label: 'impl:3', isolation: 'worktree' },
  { label: 'review:3:1:2' },
  { label: 'integration' },
]

{
  // A run-wide `KATA_AUTHOR` in the inherited env, to prove the per-worker
  // object is merged LAST: the worker speaks as itself, not as the run.
  const baseEnv = {
    ...ENV, CLAUDE_CONFIG_DIR: path.join(tmp, 'child-kata', 'claude'),
    FLEET_RUN_DIR: path.join(tmp, 'child-kata'), DISABLE_AUTOUPDATER: '1',
    KATA_AUTHOR: 'run-wide-value-that-must-lose',
  }
  const envs = await childEnvsFor({
    name: 'kata', baseEnv, extra: { envFor: envForK }, labels: DISPATCHES,
  })
  for (const { label } of DISPATCHES) {
    const childEnv = envs.get(label)
    const want = (label === 'integration') ? threeFor(label) : fourFor(label, SHORT_3)
    for (const key of KATA_KEYS) {
      if (Object.prototype.hasOwnProperty.call(want, key)) {
        assert.equal(childEnv[key], want[key],
          '(a) [M1] the child spawned for ' + label + ' carries ' + key + '=' + want[key] +
          '; got ' + JSON.stringify(childEnv[key]))
      } else {
        assert.ok(!(key in childEnv),
          '(a) [M1] ' + label + ' names no task the record knows, so its child carries no ' +
          key + '; got ' + JSON.stringify(childEnv[key]))
      }
    }
    // Merged last, and merged INTO the run's environment: the per-worker author
    // wins, and what the worker already needed is still there.
    assert.equal(childEnv.KATA_AUTHOR, label + '@' + RUN_ID,
      '(a) [M1] the per-worker KATA_AUTHOR wins over the run-wide one for ' + label)
    assert.equal(childEnv.CLAUDE_CONFIG_DIR, baseEnv.CLAUDE_CONFIG_DIR,
      '(a) [M1] the run\'s own environment is not displaced: ' + label +
      ' keeps CLAUDE_CONFIG_DIR')
    assert.equal(childEnv.FLEET_TEST_CMD, 'bash check.sh',
      '(a) [M1] and childEnvFor still reads the prompt\'s TEST COMMAND line for ' + label)
  }
}

{
  // No record: a clean environment in, none of the four out.
  const baseEnv = {
    ...ENV, CLAUDE_CONFIG_DIR: path.join(tmp, 'child-none', 'claude'),
    FLEET_RUN_DIR: path.join(tmp, 'child-none'), DISABLE_AUTOUPDATER: '1',
  }
  const envs = await childEnvsFor({
    name: 'none', baseEnv, extra: { envFor: seamsN.envFor }, labels: DISPATCHES,
  })
  for (const { label } of DISPATCHES) {
    const childEnv = envs.get(label)
    for (const key of KATA_KEYS) {
      assert.ok(!(key in childEnv),
        '(a) [M1] without a kata record the child spawned for ' + label + ' carries no ' +
        key + '; got ' + JSON.stringify(childEnv[key]))
    }
    assert.equal(childEnv.FLEET_TEST_CMD, 'bash check.sh',
      '(a) [M1] and the BASE behaviour of childEnvFor is unchanged for ' + label)
  }
}

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] the settings file: the confine hook, and the two attention hooks
// ══════════════════════════════════════════════════════════════════════════

// BASE's `hooks.PreToolUse`, for `hookPath` `/x/confine-hook.mjs` — the entry
// this task may not touch, spelled out so a changed matcher or a changed
// command is a named failure rather than a hash nobody can read.
const BASE_PRE_TOOL_USE = [{
  matcher: 'Edit|Write|MultiEdit|NotebookEdit|Bash',
  hooks: [{ type: 'command', command: 'node /x/confine-hook.mjs' }],
}]
// The frozen pre-edit literal the Proof names: `git hash-object` of BASE's
// file for that hookPath, computed 2026-09-13. A blob's hash is the sha1 of
// `blob <bytes>\0` followed by the content, which is what git computes.
const FROZEN_NO_KATA_BLOB = '19d85fde0477d667538d9a6ac213560fe0736e3a'
const blobSha = (buf) => crypto.createHash('sha1')
  .update('blob ' + buf.length + '\0', 'utf8').update(buf).digest('hex')

const WRITE_ROLES = ['implementer', 'writeSide', 'examiner']
const OTHER_ROLES = ['reviewer', 'critic', 'resolver', 'merge']

/** Write the settings under `kataOn` and answer the path, the parse and the map. */
const settingsUnder = (name, kataOn) => {
  const runDir = mkdir(path.join(tmp, 'settings-' + name))
  const roleFor = writeConfineSettings({ runDir, hookPath: '/x/confine-hook.mjs', kataOn })
  const file = path.join(runDir, 'confine-settings.json')
  assert.ok(fs.existsSync(file),
    '(b) [M2] writeConfineSettings({kataOn: ' + kataOn + '}) writes confine-settings.json')
  const bytes = fs.readFileSync(file)
  return { file, bytes, json: JSON.parse(bytes.toString('utf8')), roleFor }
}

{
  const on = settingsUnder('kata-on', true)
  assert.deepEqual(on.json.hooks.PreToolUse, BASE_PRE_TOOL_USE,
    '(b) [M2] with kataOn the PreToolUse entry is byte-for-byte BASE\'s — the implementer\'s ' +
    'boundary is untouched; got ' + JSON.stringify(on.json.hooks.PreToolUse))
  assert.equal(on.json.hooks.SessionStart[0].hooks[0].command, 'kata attention-hook start',
    '(b) [M2] and a SessionStart hook runs `kata attention-hook start`; got ' +
    JSON.stringify(on.json.hooks.SessionStart))
  assert.equal(on.json.hooks.SessionStart[0].hooks[0].type, 'command',
    '(b) [M2] as a `command` hook, the schema the PreToolUse entry already uses')
  assert.equal(on.json.hooks.SessionEnd[0].hooks[0].command, 'kata attention-hook end',
    '(b) [M2] and a SessionEnd hook runs `kata attention-hook end`; got ' +
    JSON.stringify(on.json.hooks.SessionEnd))
  assert.equal(on.json.hooks.SessionEnd[0].hooks[0].type, 'command',
    '(b) [M2] as a `command` hook too')

  const off = settingsUnder('kata-off', false)
  assert.equal(blobSha(off.bytes), FROZEN_NO_KATA_BLOB,
    '(b) [M2] with kataOn false and hookPath /x/confine-hook.mjs the file is byte-identical to ' +
    'BASE\'s (git blob ' + FROZEN_NO_KATA_BLOB + '); got ' + blobSha(off.bytes) + ' for:\n' +
    off.bytes.toString('utf8'))
  assert.deepEqual(off.json.hooks.PreToolUse, BASE_PRE_TOOL_USE,
    '(b) [M2] and that file is the confine hook alone')
  assert.ok(!('SessionStart' in off.json.hooks) && !('SessionEnd' in off.json.hooks),
    '(b) [M2] with no kata record there is no attention hook; got ' +
    JSON.stringify(Object.keys(off.json.hooks)))

  // The file is still the three write roles', and no one else's.
  for (const settings of [on, off]) {
    for (const role of WRITE_ROLES) {
      assert.equal(settings.roleFor(role), settings.file,
        '(b) [M2] the settings file is handed to the ' + role)
    }
    for (const role of OTHER_ROLES) {
      assert.equal(settings.roleFor(role), undefined,
        '(b) [M2] and to no other role (' + role + ' gets none)')
    }
  }
}

{
  // End to end: the file run-main itself wrote for each of the two flows.
  const settingsOf = (runDir) => {
    const file = path.join(runDir, 'confine-settings.json')
    assert.ok(fs.existsSync(file), '(b) [M2] run-main wrote ' + file)
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  }
  const withRecord = settingsOf(withKata.runDir)
  assert.equal(withRecord.hooks.SessionStart[0].hooks[0].command, 'kata attention-hook start',
    '(b) [M2] the settings file run-main writes under --kata carries the SessionStart hook; got ' +
    JSON.stringify(withRecord.hooks.SessionStart))
  assert.equal(withRecord.hooks.SessionEnd[0].hooks[0].command, 'kata attention-hook end',
    '(b) [M2] and the SessionEnd hook; got ' + JSON.stringify(withRecord.hooks.SessionEnd))
  assert.equal(withRecord.hooks.PreToolUse[0].matcher, BASE_PRE_TOOL_USE[0].matcher,
    '(b) [M2] beside the PreToolUse entry, whose matcher is BASE\'s')

  const without = settingsOf(noKata.runDir)
  assert.ok(!('SessionStart' in without.hooks) && !('SessionEnd' in without.hooks),
    '(b) [M2] without --kata run-main\'s settings file is the confine hook alone; got ' +
    JSON.stringify(Object.keys(without.hooks)))
}

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] one getIssue per task, and the short_id it answered
// ══════════════════════════════════════════════════════════════════════════

// The fake hub: the client's method names over an in-memory store. `getIssue`
// answers the issue's `short_id` — the projection `kata-client.mjs` keeps —
// and every call is counted, so a second read for the short id is visible.
function makeFakeKata ({ record, issues }) {
  const calls = []
  const store = new Map()
  for (const [uid, iss] of Object.entries(issues)) {
    store.set(uid, { uid, revision: iss.revision, short_id: iss.short_id,
                     metadata: iss.metadata || {}, owner: null, status: 'open' })
  }
  const need = (uid) => {
    const iss = store.get(uid)
    if (!iss) throw new Error('fake kata: no issue ' + JSON.stringify(uid))
    return iss
  }
  const kata = {
    async getIssue (uid) {
      const iss = need(uid)
      const answer = { uid, revision: iss.revision, short_id: iss.short_id,
                       metadata: iss.metadata, status: iss.status, owner: iss.owner,
                       project_id: record.project.id }
      calls.push({ method: 'getIssue', uid, answer })
      return answer
    },
    async claim (projectId, uid) {
      const iss = need(uid)
      iss.owner = 'engine'; iss.revision += 1
      calls.push({ method: 'claim', projectId, uid })
      return { uid, revision: iss.revision, short_id: iss.short_id }
    },
    async patchMetadata (projectId, uid, patch, revision) {
      const iss = need(uid)
      iss.metadata = { ...iss.metadata, ...patch }; iss.revision += 1
      calls.push({ method: 'patchMetadata', projectId, uid, patch, revision })
      return { uid, revision: iss.revision, short_id: iss.short_id }
    },
    async comment (projectId, uid, body) {
      const iss = need(uid)
      iss.revision += 1
      calls.push({ method: 'comment', projectId, uid, body })
      return { uid, revision: iss.revision }
    },
    async close (projectId, uid, opts) {
      const iss = need(uid)
      iss.status = 'closed'; iss.revision += 1
      calls.push({ method: 'close', projectId, uid, opts })
      return { uid, revision: iss.revision }
    },
  }
  return { kata, calls, of: (m) => calls.filter((c) => c.method === m) }
}

// `_engine_helpers.rig`'s body, copied (that module is not in this task's
// Files) with one addition: `kata` passed through to `runEngine`.
function kataRig ({ repo, runDir, waves, stub, stamp = 'sim', kata, extraArgs = {} }) {
  const taskIds = waves.flat().map((t) => t.id)
  const { base, clonesDir, patchesDir, integ } = provision({ repo, runDir, taskIds })
  const patchBase = { current: base }
  const cwdFor = makeCwdFor({ clonesDir })
  const inner = async (prompt, opts) => stub(prompt, opts, cwdFor(opts))
  const agent = withPatchCapture({
    agent: inner, clonesDir, base: () => patchBase.current, patchesDir,
    taskIdOf: defaultTaskIdOf,
  })
  const logs = []
  const run = () => runEngine({
    args: {
      waves, edges: [], testCmd: 'bash check.sh',
      acceptance: { mode: 'suite', reason: 'sim' }, stamp,
      integrationBranch: 'ultra/integration-' + stamp,
      dependencyEdges: [], patchInput: patchesDir,
      ...extraArgs,
    },
    agent,
    parallel: (thunks) => Promise.all(thunks.map((t) => t())),
    exec: execSeam,
    paths: { repoDir: repo, runDir, clonesDir },
    log: (l) => logs.push(String(l)),
    phase: () => {},
    patchBase,
    kata,
  })
  return { run, base, clonesDir, patchesDir, integ, logs }
}

{
  const repo = makeRepo(path.join(tmp, 'engine-repo'))
  const runDir = path.join(tmp, 'engine-run')
  const waves = [[
    { id: 'T1', title: 'create t1', files: ['t1.txt'], tier: 'standard', review: 'lean',
      writes: ['t1.txt'], commutes: [], body: 'sim task T1' },
    { id: 'T2', title: 'create t2', files: ['t2.txt'], tier: 'standard', review: 'lean',
      writes: ['t2.txt'], commutes: [], body: 'sim task T2' },
  ]]
  const record = {
    url: KATA_SERVER,
    project: { id: 7, uid: 'PROJ0', name: PROJECT },
    run: { uid: 'RUN0', revision: 1 },
    tasks: { T1: { uid: 'U-T1', revision: 1 }, T2: { uid: 'U-T2', revision: 1 } },
  }
  const SHORT = { 'U-T1': SHORT_3, 'U-T2': SHORT_4 }
  const fake = makeFakeKata({
    record,
    issues: {
      RUN0: { revision: 1, short_id: 'run9', metadata: {} },
      'U-T1': { revision: 1, short_id: SHORT['U-T1'], metadata: {} },
      'U-T2': { revision: 1, short_id: SHORT['U-T2'], metadata: {} },
    },
  })
  // The reads taken before the first worker — setup's. A read the engine takes
  // later in the run answers another clause (the state handshake takes one per
  // task inside the wave); what M3 counts is the read the short id comes from.
  let setupReads = null
  const stub = async (prompt, opts, cwd) => {
    if (setupReads === null) setupReads = fake.of('getIssue').slice()
    const kind = String(opts.label).split(':')[0]
    if (kind === 'impl') {
      const id = String(opts.label).split(':')[1]
      fs.writeFileSync(path.join(cwd, id.toLowerCase() + '.txt'), 'from ' + id + '\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = kataRig({
    repo, runDir, waves, stub, kata: fake.kata, extraArgs: { kataRecord: record },
  })
  const report = await run()
  // A run that never dispatched would pass the counting legs vacuously. A row
  // per EPOCH and not per plan wave (#974 Task 1: an epoch is one fold, and two
  // independent tasks free their slots at two instants), so what says both
  // tasks went through dispatch is that every epoch adopted and the two of them
  // are named across the epochs — not that there was exactly one.
  assert.ok(report.waveMerges.length >= 1,
    '(c) [M3] the sim folded what it did — ' + JSON.stringify(report.waveMerges))
  for (const m of report.waveMerges) {
    assert.equal(m.status, 'MERGED',
      '(c) [M3] and adopted every epoch of it — ' + JSON.stringify(m))
  }
  assert.deepEqual(report.waveMerges.flatMap((m) => m.branches).slice().sort(), ['T1', 'T2'],
    '(c) [M3] so both tasks went through dispatch — ' + JSON.stringify(report.waveMerges))

  const reads = setupReads || []
  assert.equal(reads.length, 2,
    '(c) [M3] exactly one getIssue per task before the first worker — no second hub read ' +
    'for the short id; got ' + reads.length + ': ' + JSON.stringify(reads.map((c) => c.uid)))
  for (const uid of ['U-T1', 'U-T2']) {
    const forUid = reads.filter((c) => c.uid === uid)
    assert.equal(forUid.length, 1,
      '(c) [M3] issue ' + uid + ' was read exactly once; got ' + forUid.length)
    assert.equal(forUid[0].answer.short_id, SHORT[uid],
      '(c) [M3] fixture: that one answer carried short_id ' + SHORT[uid])
  }
  assert.equal(record.tasks.T1.shortId, SHORT['U-T1'],
    '(c) [M3] the row the engine keeps for T1 has shortId ' + SHORT['U-T1'] +
    ' — the short_id of the same getIssue answer that checked the revision; got ' +
    JSON.stringify(record.tasks.T1.shortId))
  assert.equal(record.tasks.T2.shortId, SHORT['U-T2'],
    '(c) [M3] and T2\'s row has shortId ' + SHORT['U-T2'] + '; got ' +
    JSON.stringify(record.tasks.T2.shortId))
}

// ══════════════════════════════════════════════════════════════════════════
// (d) [M4] the contract bullet
// ══════════════════════════════════════════════════════════════════════════
{
  // The Proof's `Run:` reads the bullet with
  //   sed -n '/^- \*\*Kata record (engine)/,/^- \*\*/p' | tr '\n' ' ' | grep -q …
  // — the start line, its body, and the first line of the bullet that follows.
  // This is that range, read the same way.
  const contract = fs.readFileSync(path.join(HERE, '..', 'CONTRACT.md'), 'utf8').split('\n')
  const start = contract.findIndex((l) => l.startsWith('- **Kata record (engine)'))
  assert.ok(start !== -1,
    '(d) [M4] fleet/CONTRACT.md carries a `- **Kata record (engine):**` bullet')
  let end = contract.length - 1
  for (let i = start + 1; i < contract.length; i += 1) {
    if (contract[i].startsWith('- **')) { end = i; break }
  }
  const bullet = contract.slice(start, end + 1).join(' ')
  const ORDER = /KATA_SERVER[\s\S]*KATA_AUTH_TOKEN[\s\S]*KATA_AUTHOR[\s\S]*KATA_REF[\s\S]*attention-hook start[\s\S]*attention-hook end/
  assert.match(bullet, ORDER,
    '(d) [M4] the kata record (engine) bullet names the four variables and the two hooks, in ' +
    'the order the Proof\'s Run greps for (KATA_SERVER, KATA_AUTH_TOKEN, KATA_AUTHOR, ' +
    'KATA_REF, attention-hook start, attention-hook end). The bullet reads:\n' + bullet)
  assert.ok(bullet.includes(KATA_SERVER),
    '(d) [M4] and it names the server the workers are pointed at, ' + KATA_SERVER)
  assert.ok(bullet.includes(KATA_AUTH_TOKEN),
    '(d) [M4] and the placeholder bearer the edge replaces, ' + KATA_AUTH_TOKEN)
}

console.log('ALL TESTS PASSED')

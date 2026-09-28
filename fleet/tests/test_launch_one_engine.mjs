/**
 * fleet/tests/test_launch_one_engine.mjs — the exam for "The launcher offers no
 * knob that only the old engine read" (the launcher's `--tier` and
 * `--implementer-effort`, cut with the old engine).
 *
 * A hermetic sim in the shape of
 * `test_launch_duplicate.mjs`: a stubbed lobby (`makeExec`), a real temporary
 * target repository with a bare origin (`makeTargetRepo`), and `simEnv()` for
 * every child process a launch spawns. It imports only `./_helpers.mjs` and
 * `./_lobby_helpers.mjs` — never another `test_*.mjs`.
 *
 * The Machine clauses under test, restated:
 *   M1 — `--tier standard` and `--implementer-effort low` are each refused: a
 *        non-zero exit, a one-line stderr message naming the flag, and nothing
 *        executed — no lobby verb, no push.
 *   M2 — `usage()` names neither `--tier` nor `--implementer-effort`, and
 *        `fleet/launch.mjs` exports neither `TIER_VALUES` nor `EFFORT_VALUES`.
 *   M3 — the assignment comment a launch composes carries `run=`, `plan=`,
 *        `target=`, `base=`, `engine=` and, under `--hold`, `hold=1` — and no
 *        `tier=` and no `effort=` key.
 *   M4 — `factory/boot.sh`'s assignment parser no longer accepts `tier` or
 *        `effort`. This is read against the diff (the Proof's `Run:` lines),
 *        not exercised here: this file imports and calls only
 *        `fleet/launch.mjs`, never spawns bash, and a node exam proves its own
 *        claim through imports and calls.
 *
 * Legs, each naming the Machine clause it comes from:
 *   (a) [M1] a launch line carrying `--tier standard` is refused: non-zero
 *       exit, a one-line stderr message naming `--tier`, nothing executed; the
 *       same for `--implementer-effort low` naming `--implementer-effort`.
 *   (b) [M2] `usage()` contains neither substring, and the module namespace
 *       has no `TIER_VALUES` and no `EFFORT_VALUES` key.
 *   (c) [M3] on a good launch (no `--tier`, no `--implementer-effort`), the
 *       comment the stub lobby's `new` verb received carries `run=`, `plan=`,
 *       `target=`, `base=`, `engine=` and neither `tier=` nor `effort=`; with
 *       `--hold` added, that same comment also carries `hold=1`.
 *
 * Imports are a namespace import (`launchModule`) alongside named imports, so
 * (b) can read `Object.keys(launchModule)` directly rather than testing a
 * named import's mere absence at link time — which would turn a present-but-
 * wrong export into a SyntaxError instead of a normal assertion failure.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as launchModule from '../launch.mjs'
import { USAGE, usage, launch } from '../launch.mjs'
import { EXE_HOST, Refusal, defaultExec } from '../lobby.mjs'
import {
  answer, cleanup, cmdRule, makeExec, makeTargetRepo, sshRule, tempDir, thrown, vmsPayload
} from './_lobby_helpers.mjs'

const TARGET = 'acme/widgets'
const GH = 'gh-acme-widgets'
const ORIGIN_URL = `https://github.com/${TARGET}.git`
const ENGINE = 'c'.repeat(40)
const NOW = new Date('2026-09-21T12:00:00.000Z')
const CAPPED = { cpu: '6', memory: '8GB' }
const BILLING_OK = { max_cpus: 16, max_memory_gb: 64, tier: 'XLarge', plan: 'Individual' }
const SEED = { 'README.md': '# target\n', 'src/app.js': 'export const x = 1\n' }
const PLAN = '# a plan\n\nOne plan, and a trailing newline.\n'

// ── The compiled plan the stubbed compiler answers ──────────────────────────

const task = (id) => ({
  id: String(id),
  title: `task ${id}`,
  factsheet: {
    files: [`f${id}.txt`], deletes: [], guards: [], proofTests: [], landing: {},
    driverOwned: [], siblingOwned: [], produces: [], consumes: []
  }
})
const ONE_TASK = { launch_waves: [[task(1)]], dag_edges: [] }

// ── The seam's rules — copied from test_launch_duplicate.mjs's rig rather
//    than imported: a sim may not name a sibling sim. ────────────────────────

const NEW_OK = (cmd, argv) =>
  answer({ vm_name: /--name (\S+)/.exec(String(argv[1] ?? ''))?.[1] ?? '', status: 'running' })
const ENGINE_RULE = {
  when: (cmd, argv) =>
    cmd === 'git' && argv.includes('ls-remote') && argv.some((a) => /ultrapowers/.test(String(a))),
  answer: answer(`${ENGINE}\tHEAD\n`)
}
const COMPILER_FETCH = {
  when: (cmd, argv) => cmd === 'gh' && argv[0] === 'api' &&
    argv.some((a) => /contents\/skills\/ultrapowers\/scripts\/plan_(check|parse)\.py/.test(String(a))),
  answer: answer('# plan_check.py or plan_parse.py, as the seam hands it back\n')
}
const pointAtOrigin = (repo, argv) => {
  const pointed = argv.map((a) => (a === 'origin' || /github\.com/.test(String(a)) ? repo.origin : a))
  const fetchAt = argv.indexOf('fetch')
  if (fetchAt < 0) return pointed
  const remoteAt = argv.indexOf('origin', fetchAt)
  const branch = String(argv[remoteAt + 1] ?? '')
  if (remoteAt < 0 || branch === '' || branch.startsWith('-') || branch.includes(':')) return pointed
  pointed[remoteAt + 1] = `+refs/heads/${branch}:refs/remotes/origin/${branch}`
  return pointed
}
const localRemote = (repo) => ({
  when: (cmd, argv) => cmd === 'git' &&
    (argv.includes('push') || argv.includes('ls-remote') || argv.includes('fetch')) &&
    !argv.includes('--get-url') &&
    !argv.some((a) => /ultrapowers/.test(String(a))),
  answer: (cmd, argv, options) => defaultExec('git', pointAtOrigin(repo, argv), options ?? {})
})
const OFFLINE = answer('', { code: 128, stderr: 'exam: this exam opens no network socket\n' })
const NO_REMOTE_OPS = {
  when: (cmd, argv) => cmd === 'git' && argv.some((a) => a === 'clone' || a === 'pull' || a === 'fetch'),
  answer: OFFLINE
}
const NO_NETWORK_GIT = {
  when: (cmd, argv) => cmd === 'git' && argv.some((a) => /:\/\/|github\.com/.test(String(a))),
  answer: OFFLINE
}
const compilerRule = (compiled) => ({
  when: (cmd) => cmd === 'python3',
  answer: (cmd, argv) =>
    argv.some((a) => String(a).endsWith('plan_check.py')) ? answer('PLAN OK\n') : answer(JSON.stringify(compiled))
})
const HELP_OK = (cmd, argv) => {
  const verb = String(argv[1] ?? '').slice('help '.length)
  return answer(`Command: ${verb}\n\nOptions:\n`)
}
const NO_RECORD = answer('')
const recordRule = (res) => cmdRule('gh', 'api', res)

const readRules = ({ repo }) => [
  ENGINE_RULE,
  COMPILER_FETCH,
  localRemote(repo),
  compilerRule(ONE_TASK),
  sshRule('help ', HELP_OK),
  sshRule('integrations list --json', answer([{ name: GH, attachments: [] }, { name: 'claude-max', attachments: [] }])),
  sshRule('billing plan --json', answer(BILLING_OK)),
  sshRule("ls '", vmsPayload([])),
  sshRule('new ', NEW_OK),
  recordRule(NO_RECORD),
  NO_REMOTE_OPS,
  NO_NETWORK_GIT
]

// ── The workspace: one fresh target, one plan on disk ───────────────────────

function workspace () {
  const root = tempDir('fleet-launch-one-engine-')
  const repo = makeTargetRepo({ root, files: { ...SEED } })
  repo.git(['remote', 'set-url', 'origin', ORIGIN_URL])
  const planDir = path.join(root, 'plans-src')
  fs.mkdirSync(planDir)
  const planPath = path.join(planDir, 'a-plan.md')
  fs.writeFileSync(planPath, PLAN)
  return { root, repo, planPath, cleanup: () => cleanup(root) }
}

const argvFor = (ws, extra = []) => [
  ws.planPath, '--target', TARGET, '--base', ws.repo.base, '--repo', ws.repo.dir,
  '--engine', ENGINE, ...extra
]
const launchIn = (ws, { exec, extra = [] }) => launch({
  argv: argvFor(ws, extra),
  exec,
  config: CAPPED,
  now: () => NOW,
  sleep: async () => {},
  refreshCredential: () => ({ ok: true }),
  kata: null
})
const drive = async (extra) => {
  const ws = workspace()
  const exec = makeExec({ rules: readRules({ repo: ws.repo }) })
  let result = null
  let error = null
  try {
    result = await launchIn(ws, { exec, extra })
  } catch (e) {
    error = e
  }
  return { ws, exec, result, error }
}

/** The remote half of the `new` verb the stub lobby recorded, or undefined. */
const newRemote = (exec) => exec.calls
  .find((c) => c.cmd === 'ssh' && c.argv[0] === EXE_HOST && String(c.argv[1] ?? '').startsWith('new '))
  ?.argv[1]
/** The `--comment '<...>'` value off a `new` remote string. */
const commentOf = (remote) => /--comment '([^']*)'/.exec(String(remote ?? ''))?.[1]

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] --tier and --implementer-effort are each refused, before anything runs
// ══════════════════════════════════════════════════════════════════════════
{
  const tierAttempt = await drive(['--tier', 'standard'])
  assert.ok(tierAttempt.error, '(a) [M1] `--tier standard` makes launch() reject')
  assert.ok(tierAttempt.error instanceof Refusal,
    `(a) [M1] the rejection is a Refusal — nothing on exe.dev was mutated — got ` +
    `${tierAttempt.error?.name}: ${tierAttempt.error?.message}`)
  assert.notEqual(tierAttempt.error.exitCode, 0,
    `(a) [M1] --tier standard exits non-zero, got ${tierAttempt.error.exitCode}`)
  assert.ok(!String(tierAttempt.error.message).includes('\n'),
    `(a) [M1] the refusal is a ONE-LINE message on stderr. Got: ` +
    JSON.stringify(tierAttempt.error.message))
  assert.ok(String(tierAttempt.error.message).includes('--tier'),
    `(a) [M1] the message names the flag \`--tier\`. Got: ` +
    JSON.stringify(tierAttempt.error.message))
  assert.equal(tierAttempt.exec.calls.length, 0,
    '(a) [M1] --tier standard executes nothing at all — no lobby verb, no push. ' +
    `Got ${tierAttempt.exec.calls.length} call(s): ` + JSON.stringify(tierAttempt.exec.calls.map((c) => c.line)))
  tierAttempt.ws.cleanup()

  const effortAttempt = await drive(['--implementer-effort', 'low'])
  assert.ok(effortAttempt.error, '(a) [M1] `--implementer-effort low` makes launch() reject')
  assert.ok(effortAttempt.error instanceof Refusal,
    `(a) [M1] the rejection is a Refusal — got ${effortAttempt.error?.name}: ${effortAttempt.error?.message}`)
  assert.notEqual(effortAttempt.error.exitCode, 0,
    `(a) [M1] --implementer-effort low exits non-zero, got ${effortAttempt.error.exitCode}`)
  assert.ok(!String(effortAttempt.error.message).includes('\n'),
    `(a) [M1] the refusal is a ONE-LINE message on stderr. Got: ` +
    JSON.stringify(effortAttempt.error.message))
  assert.ok(String(effortAttempt.error.message).includes('--implementer-effort'),
    `(a) [M1] the message names the flag \`--implementer-effort\`. Got: ` +
    JSON.stringify(effortAttempt.error.message))
  assert.equal(effortAttempt.exec.calls.length, 0,
    '(a) [M1] --implementer-effort low executes nothing at all — no lobby verb, no push. ' +
    `Got ${effortAttempt.exec.calls.length} call(s): ` + JSON.stringify(effortAttempt.exec.calls.map((c) => c.line)))
  effortAttempt.ws.cleanup()
}

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] usage() and the module namespace name neither knob
// ══════════════════════════════════════════════════════════════════════════
{
  assert.ok(!usage().includes('--tier'),
    `(b) [M2] \`usage()\` does not mention \`--tier\`. Got: ${JSON.stringify(usage())}`)
  assert.ok(!usage().includes('--implementer-effort'),
    `(b) [M2] \`usage()\` does not mention \`--implementer-effort\`. Got: ${JSON.stringify(usage())}`)
  assert.ok(!USAGE.includes('--tier'),
    `(b) [M2] the \`USAGE\` string itself does not mention \`--tier\`. Got: ${JSON.stringify(USAGE)}`)
  assert.ok(!USAGE.includes('--implementer-effort'),
    `(b) [M2] the \`USAGE\` string itself does not mention \`--implementer-effort\`. Got: ${JSON.stringify(USAGE)}`)

  const keys = Object.keys(launchModule)
  assert.ok(!keys.includes('TIER_VALUES'),
    `(b) [M2] \`fleet/launch.mjs\`'s module namespace has no \`TIER_VALUES\` key. Got keys: ${JSON.stringify(keys)}`)
  assert.ok(!keys.includes('EFFORT_VALUES'),
    `(b) [M2] \`fleet/launch.mjs\`'s module namespace has no \`EFFORT_VALUES\` key. Got keys: ${JSON.stringify(keys)}`)
}

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] the assignment comment: no tier=, no effort=, hold=1 under --hold
// ══════════════════════════════════════════════════════════════════════════
{
  const plain = await drive([])
  assert.equal(plain.error, null,
    `(c) [M3] a launch with neither flag resolves: ${plain.error?.message ?? ''}`)
  const plainRemote = newRemote(plain.exec)
  assert.ok(plainRemote,
    '(c) [M3] the stub lobby recorded a `new` verb on the good launch. Calls: ' +
    JSON.stringify(plain.exec.calls.map((c) => c.line)))
  const plainComment = commentOf(plainRemote)
  assert.ok(plainComment,
    `(c) [M3] the \`new\` verb's remote string carries a --comment '...'. Got: ${JSON.stringify(plainRemote)}`)
  for (const key of ['run=', 'plan=', 'target=', 'base=', 'engine=']) {
    assert.ok(plainComment.includes(key),
      `(c) [M3] the assignment comment carries \`${key}\`. Got: ${JSON.stringify(plainComment)}`)
  }
  assert.ok(!plainComment.includes('tier='),
    `(c) [M3] the assignment comment carries no \`tier=\` key. Got: ${JSON.stringify(plainComment)}`)
  assert.ok(!plainComment.includes('effort='),
    `(c) [M3] the assignment comment carries no \`effort=\` key. Got: ${JSON.stringify(plainComment)}`)
  assert.ok(!plainComment.includes('hold='),
    `(c) [M3] without --hold the comment carries no \`hold=\` key either. Got: ${JSON.stringify(plainComment)}`)
  assert.equal(plain.result?.comment, plainComment,
    '(c) [M3] the comment the `new` verb received is the same one the launch result carries')
  plain.ws.cleanup()

  const held = await drive(['--hold'])
  assert.equal(held.error, null,
    `(c) [M3] a launch with --hold resolves: ${held.error?.message ?? ''}`)
  const heldRemote = newRemote(held.exec)
  assert.ok(heldRemote, '(c) [M3] the stub lobby recorded a `new` verb on the --hold launch')
  const heldComment = commentOf(heldRemote)
  assert.ok(heldComment,
    `(c) [M3] the \`new\` verb's remote string carries a --comment '...' under --hold. Got: ${JSON.stringify(heldRemote)}`)
  for (const key of ['run=', 'plan=', 'target=', 'base=', 'engine=']) {
    assert.ok(heldComment.includes(key),
      `(c) [M3] under --hold the comment still carries \`${key}\`. Got: ${JSON.stringify(heldComment)}`)
  }
  assert.ok(heldComment.includes('hold=1'),
    `(c) [M3] under --hold the comment carries \`hold=1\`. Got: ${JSON.stringify(heldComment)}`)
  assert.ok(!heldComment.includes('tier='),
    `(c) [M3] under --hold the comment still carries no \`tier=\` key. Got: ${JSON.stringify(heldComment)}`)
  assert.ok(!heldComment.includes('effort='),
    `(c) [M3] under --hold the comment still carries no \`effort=\` key. Got: ${JSON.stringify(heldComment)}`)
  held.ws.cleanup()
}

console.log('ALL TESTS PASSED')

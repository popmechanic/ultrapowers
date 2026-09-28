/**
 * fleet/tests/test_launch_duplicate.mjs — the exam for "The launcher refuses a
 * plan that is live on the target, names the run, and takes `--again`" (#1036).
 *
 * On 2026-09-15 the same plan was launched twice within a minute on
 * popmechanic/tinyapp-fixture (runs 10 and 11). The second launch re-answered
 * the first run's task issues on the hub and bumped their revision, and run-10
 * died at Setup with `kata-revision-mismatch`. The two launches carried
 * DIFFERENT `plan=` commits (the subject names the run) and ONE plan blob, so
 * "the same plan" is the plan text's git blob sha, never the comment's sha.
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (a) [M1] one running row on the target whose `ultra/plan-run-7` holds this
 *       plan's bytes, and no record (empty `gh api`) — a Refusal (exit 2)
 *       naming run-7, the VM and `--again`, with nothing mutated and no push;
 *       the same with a `running` record;
 *   (b) [M2] the same fleet with `--again` — the launch resolves as run-8, one
 *       push, one `new`, `again` on the result and on the rendered line;
 *   (c) [M3] the same row whose record says `done` five minutes ago — no
 *       refusal, `again` empty (the VM is inside the janitor's hour and stays);
 *   (d) [M4] a row on another target with this plan, and a row on this target
 *       with a different plan — neither refuses;
 *   (e) [M5] `--again=1` is refused before any exec call; USAGE names the flag;
 *   (f) [M6] `janitor()` answers `runs` — one entry per assignment row, with
 *       `live`/`state` from the record and null when there is none;
 *   (g) [M7] is the plan's `Run:` greps over CONTRACT.md and RUNBOOK.md.
 *
 * The rig is `test_launch_size.mjs`'s, copied rather than imported (a sim may
 * not name a sibling sim): a local bare origin stands in for GitHub, every
 * lobby verb and `gh api` is answered by the seam, and the compiler is stubbed
 * — both its fetch at `engine=` (`COMPILER_FETCH`) and its every `python3` run
 * (`compilerRule`).
 *
 * Kept at zero catches over 29 runs (#1264, 2026-09-24): the run-number check
 * runs on the laptop before any sandbox exists, and no fleet probe can launch
 * twice, so this sim is the only alarm for the race that killed run-10
 * (2026-09-15).
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { USAGE, launch, renderLaunch } from '../launch.mjs'
import { janitor } from '../janitor.mjs'
import { EXE_HOST, Refusal, defaultExec } from '../lobby.mjs'
import {
  answer, cleanup, cmdRule, makeExec, makeTargetRepo, sshRule, tempDir, thrown, vmRow, vmsPayload
} from './_lobby_helpers.mjs'

const TARGET = 'popmechanic/smoke'
const GH = 'gh-popmechanic-smoke'
const ORIGIN_URL = `https://github.com/${TARGET}.git`
const ENGINE = 'b'.repeat(40)
const NOW = new Date('2026-09-16T03:20:00.000Z')
const CAPPED = { cpu: '6', memory: '8GB' }
const BILLING_OK = { max_cpus: 16, max_memory_gb: 64, tier: 'XLarge', plan: 'Individual' }
const SEED = { 'README.md': '# target\n', 'src/app.js': 'export const x = 1\n' }
const PLAN = '# a plan\n\nOne plan, and a trailing newline.\n'
const OTHER_PLAN = '# a plan\n\nOne plan, and a trailing newline.\nAnd one more line.\n'
const LIVE_VM = 'fleet-r7-2609160900-ab12'
const OLD_VM = 'fleet-r6-2609160800-cd34'
const FOREIGN_VM = 'fleet-r3-2609160700-ef56'

const FLEET_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VERBS = JSON.parse(fs.readFileSync(path.join(FLEET_DIR, 'exe-verbs.json'), 'utf8'))

// ── The compiled plan, as the stub answers it ───────────────────────────────

const task = (id) => ({
  id: String(id),
  title: `task ${id}`,
  factsheet: {
    files: [`f${id}.txt`], deletes: [], guards: [], proofTests: [], landing: {},
    driverOwned: [], siblingOwned: [], produces: [], consumes: []
  }
})
const ONE_TASK = { launch_waves: [[task(1)]], dag_edges: [] }

// ── The seam's rules ────────────────────────────────────────────────────────

const NEW_OK = (cmd, argv) =>
  answer({ vm_name: /--name (\S+)/.exec(String(argv[1] ?? ''))?.[1] ?? '', status: 'running' })
const ENGINE_RULE = {
  when: (cmd, argv) =>
    cmd === 'git' && argv.includes('ls-remote') && argv.some((a) => /ultrapowers/.test(String(a))),
  answer: answer(`${ENGINE}\tHEAD\n`)
}
/**
 * The compiler the launcher fetches at `engine=`. At the fake engine sha the
 * real `git show` in this checkout fails, so the `gh api` contents call is what
 * answers — and it must answer BEFORE `recordRule`, whose empty page would
 * otherwise read as a compiler that could not be fetched and refuse the launch.
 * The body is never run: `compilerRule` answers every `python3`.
 */
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
const helpText = (verb, flags) => [
  `Command: ${verb}`, '', 'Options:', ...flags.map((flag) => `  ${flag}  what ${flag} does`), ''
].join('\n')
const HELP_OK = (cmd, argv) => {
  const verb = String(argv[1] ?? '').slice('help '.length)
  const flags = VERBS.verbs[verb]
  return flags
    ? answer(helpText(verb, flags))
    : answer(`No help available for unrecognized command: ${verb}\n`)
}
const compilerRule = (compiled) => ({
  when: (cmd) => cmd === 'python3',
  answer: (cmd, argv) =>
    argv.some((a) => String(a).endsWith('plan_check.py')) ? answer('PLAN OK\n') : answer(JSON.stringify(compiled))
})

/** A status page as the contents API hands it back. */
const page = (state, updatedAt) => answer({
  content: Buffer.from(JSON.stringify({ state, updatedAt })).toString('base64'),
  sha: 'x'
})
/** `gh api …` answering one page for every ref — or nothing at all. */
const recordRule = (res) => cmdRule('gh', 'api', res)
const NO_RECORD = answer('')
const RUNNING = page('running', NOW.toISOString())
const DONE_5_MIN_AGO = page('done', new Date(NOW.getTime() - 5 * 60 * 1000).toISOString())

const readRules = ({ repo, rows, record }) => [
  ENGINE_RULE,
  COMPILER_FETCH,
  localRemote(repo),
  compilerRule(ONE_TASK),
  sshRule('help ', HELP_OK),
  sshRule('integrations list --json', answer([{ name: GH, attachments: [] }, { name: 'claude-max', attachments: [] }])),
  sshRule('billing plan --json', answer(BILLING_OK)),
  sshRule("ls '", vmsPayload(rows)),
  sshRule('new ', NEW_OK),
  recordRule(record),
  NO_REMOTE_OPS,
  NO_NETWORK_GIT
]

// ── The workspace: a target whose origin already carries plan branches ──────

/** Commit `text` as `.ultrapowers/plan.md` on `ultra/plan-run-<n>` and push it; the sha. */
function planBranch (repo, n, text) {
  const branch = `ultra/plan-run-${n}`
  repo.git(['checkout', '-q', '-b', branch, 'main'])
  fs.mkdirSync(path.join(repo.dir, '.ultrapowers'), { recursive: true })
  fs.writeFileSync(path.join(repo.dir, '.ultrapowers', 'plan.md'), text)
  repo.git(['add', '-A'])
  repo.git(['commit', '-q', '-m', `ultrapowers plan run-${n}`])
  repo.git(['push', '-q', 'origin', branch])
  const sha = repo.git(['rev-parse', 'HEAD'])
  repo.git(['checkout', '-q', 'main'])
  return sha
}

function workspace () {
  const root = tempDir('fleet-launch-duplicate-')
  const repo = makeTargetRepo({ root, files: { ...SEED } })
  const run6 = planBranch(repo, 6, OTHER_PLAN)
  const run7 = planBranch(repo, 7, PLAN)
  repo.git(['remote', 'set-url', 'origin', ORIGIN_URL])
  const planDir = path.join(root, 'plans-src')
  fs.mkdirSync(planDir)
  const planPath = path.join(planDir, 'a-plan.md')
  fs.writeFileSync(planPath, PLAN)
  return { root, repo, planPath, run6, run7, cleanup: () => cleanup(root) }
}
const comment = (n, plan, target, base) => `run=${n} plan=${plan} target=${target} base=${base} engine=${ENGINE}`
const liveRow = (ws) => vmRow(LIVE_VM, { comment: comment(7, ws.run7, TARGET, ws.repo.base) })
const oldRow = (ws) => vmRow(OLD_VM, { comment: comment(6, ws.run6, TARGET, ws.repo.base) })
const foreignRow = (ws) => vmRow(FOREIGN_VM, { comment: comment(3, ws.run7, 'other/repo', ws.repo.base) })

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
const drive = async ({ rows, record, extra = [] }) => {
  const ws = workspace()
  const exec = makeExec({ rules: readRules({ repo: ws.repo, rows: rows(ws), record }) })
  let result = null
  let error = null
  try {
    result = await launchIn(ws, { exec, extra })
  } catch (e) {
    error = e
  }
  return { ws, exec, result, error }
}

// ── Reading the calls ───────────────────────────────────────────────────────

const pushCalls = (exec) => exec.calls.filter((c) => c.cmd === 'git' && c.argv.includes('push'))
const newVerbs = (exec) => exec.mutating().filter((line) => line.startsWith('new '))

const assertRefused = (d, leg) => {
  assert.ok(d.error, `${leg} launch() rejected`)
  assert.equal(d.error.name, 'Refusal', `${leg} the rejection is a Refusal, got ${d.error.name}: ${d.error.message}`)
  assert.ok(d.error instanceof Refusal, `${leg} and an instance of Refusal`)
  assert.equal(d.error.exitCode, 2, `${leg} exit 2`)
  for (const needle of ['run-7', LIVE_VM, '--again']) {
    assert.ok(d.error.message.includes(needle), `${leg} the message names ${needle}: ${d.error.message}`)
  }
  assert.deepEqual(d.exec.mutating(), [], `${leg} nothing was mutated`)
  assert.deepEqual(pushCalls(d.exec), [], `${leg} and nothing was pushed`)
}
const assertLaunched = (d, leg) => {
  assert.equal(d.error, null, `${leg} launch() resolved: ${d.error?.message ?? ''}`)
  const pushes = pushCalls(d.exec)
  assert.ok(pushes.length >= 1, `${leg} a push was issued`)
  assert.ok(
    pushes.some((c) => c.argv.some((a) => String(a).endsWith('ultra/plan-run-8'))),
    `${leg} and it pushed ultra/plan-run-8 (runs 6 and 7 are taken)`
  )
  assert.equal(newVerbs(d.exec).length, 1, `${leg} exactly one \`new\` verb`)
}

// ── a. [M1] a live duplicate is refused before anything is pushed ───────────
{
  const unrecorded = await drive({ rows: (ws) => [liveRow(ws)], record: NO_RECORD })
  assertRefused(unrecorded, '(a) [M1] no record yet —')
  unrecorded.ws.cleanup()

  const running = await drive({ rows: (ws) => [liveRow(ws)], record: RUNNING })
  assertRefused(running, '(a) [M1] a running record —')
  running.ws.cleanup()
}

// ── b. [M2] --again is the one way past it ──────────────────────────────────
{
  const again = await drive({ rows: (ws) => [liveRow(ws)], record: NO_RECORD, extra: ['--again'] })
  assertLaunched(again, '(b) [M2]')
  assert.deepEqual(again.result.again, [{ run: 7, vm: LIVE_VM }], '(b) [M2] the result records the run it launched again beside')
  assert.ok(
    renderLaunch(again.result).split('\n').includes(`again run-7 ${LIVE_VM}`),
    '(b) [M2] and the launch line says so'
  )
  again.ws.cleanup()
}

// ── c. [M3] a run whose record says it ended never refuses ──────────────────
{
  const ended = await drive({ rows: (ws) => [liveRow(ws)], record: DONE_5_MIN_AGO })
  assertLaunched(ended, '(c) [M3]')
  assert.deepEqual(ended.result.again, [], '(c) [M3] done five minutes ago, VM still up: not a duplicate')
  ended.ws.cleanup()
}

// ── d. [M4] another target, or another plan, is not a duplicate ─────────────
{
  const others = await drive({ rows: (ws) => [foreignRow(ws), oldRow(ws)], record: NO_RECORD })
  assertLaunched(others, '(d) [M4]')
  assert.deepEqual(others.result.again, [], '(d) [M4] same plan on other/repo, other plan on this target: neither refuses')
  others.ws.cleanup()
}

// ── e. [M5] the flag takes no value, and is offered ─────────────────────────
{
  const ws = workspace()
  const exec = makeExec({ rules: readRules({ repo: ws.repo, rows: [liveRow(ws)], record: NO_RECORD }) })
  const error = await thrown(() => launchIn(ws, { exec, extra: ['--again=1'] }))
  assert.ok(error instanceof Refusal, `(e) [M5] --again=1 is a Refusal, got ${error?.name}: ${error?.message}`)
  assert.equal(exec.calls.length, 0, '(e) [M5] and nothing was executed')
  assert.ok(USAGE.includes('[--again]'), '(e) [M5] USAGE offers [--again]')
  ws.cleanup()
}

// ── f. [M6] the janitor answers `runs` ──────────────────────────────────────
{
  const ws = workspace()
  const rows = [
    liveRow(ws),
    vmRow('ultraviz', { comment: 'ultraviz — persistent viewer, do not reap' }),
    vmRow('fleet-r9-2609160900-0000', { comment: 'run=9 base=abc' })
  ]
  const janitorIn = async (record) => {
    const exec = makeExec({ rules: [sshRule("ls '", vmsPayload(rows)), recordRule(record), NO_REMOTE_OPS, NO_NETWORK_GIT] })
    return janitor({ argv: [], exec, config: CAPPED, now: () => NOW, kata: null })
  }
  const recorded = await janitorIn(RUNNING)
  assert.deepEqual(
    recorded.runs,
    [{ vm: LIVE_VM, run: 7, target: TARGET, plan: ws.run7, live: true, state: 'running' }],
    '(f) [M6] one entry: the assignment row, read live; the kept row and the target-less row are not in it'
  )
  const unrecorded = await janitorIn(NO_RECORD)
  assert.equal(unrecorded.runs.length, 1, '(f) [M6] the unrecorded row is still listed')
  assert.equal(unrecorded.runs[0].live, null, '(f) [M6] with live null')
  assert.equal(unrecorded.runs[0].state, null, '(f) [M6] and state null')
  ws.cleanup()
}

console.log('ALL TESTS PASSED')

/**
 * fleet/tests/test_launch_credential.mjs — the exam for "The launcher puts a
 * held sign-in on the launch line and turns a declined one into a one-line
 * refusal before anything is pushed" (#1113), plus "The launcher reads the
 * windows after the refresh, prints them, and refuses at the wall" (#1114).
 *
 * A sibling task changes `fleet/claude-token.mjs` so it stops rotating the
 * Claude credential while a `fleet-r*` VM is listed (a refresh grant would
 * revoke the access token every live run is using). It now exits 0 and prints
 * a hold line on stderr when it declines to rotate for that reason, and exits
 * 1 with a refusal line when the cached token is under ninety minutes from
 * expiring. This exam does not touch that file or spawn it — M1 and M2 drive
 * `defaultRefreshCredential` with a spy standing in for `spawnSync`, reading
 * the two lines back out of canned output exactly as that tool would print
 * them.
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (a) [M1] a spy answering exit 0 with a hold line: `ok` true, `held`
 *       exactly the line (no newline), one spy call, argv's last three
 *       entries `refresh`, `--account`, `acct`.
 *   (b) [M2] a spy answering exit 1 with a refusal line: `ok` false, `refused`
 *       exactly the line; a spy answering exit 1 with unrelated stderr: `ok`
 *       false, `refused` undefined.
 *   (c) [M3] `launch` given a `refreshCredential` that answers `refused`
 *       rejects with a `Refusal` (exit 2) whose message carries the line and
 *       "nothing was pushed", with no push and no `new` verb issued.
 *   (d) [M4] `launch` given a `refreshCredential` that answers `held` resolves
 *       with `result.token` exactly the held line, carried by `renderLaunch`
 *       as its own whole line; `{ ok: true }` alone renders no `token:` line.
 *
 * (c) and (d) drive `launch({ argv, exec, config, now, sleep, refreshCredential,
 * kata: null })` in-process over the same launcher rig `test_launch_duplicate.mjs`
 * uses, copied rather than imported (a sim may not run a sibling sim): a local
 * bare origin stands in for GitHub, and every lobby verb, `gh api` and `python3`
 * call is answered by a rule.
 *
 * ── #1114 (this task) ───────────────────────────────────────────────────────
 *
 * Legs (e)-(i) sit under this comment, added for "The launcher reads the
 * windows after the refresh, prints them, and refuses at the wall":
 *
 *   (e) [M1] `defaultReadUsage(account, spawn)` over a spawn spy: exit 0 with
 *       a one-row JSON array answers that row, one spy call, `process.execPath`
 *       as the spawned command and argv's last five entries `usage`, `--json`,
 *       `--account`, `<account>`, `--no-rotate`; exit 1, an empty array and
 *       unparseable stdout each answer `{ unread: true, reason: <string> }`.
 *   (f) [M2] `launch` with `readUsage` answering `sevenDay.utilization: 96`
 *       rejects with a `Refusal` carrying the account, `seven-day`, `96`, the
 *       reset string and the ending sentence, with no push and no `new` verb
 *       issued; `fiveHour.utilization: 95` (the wall itself) carries
 *       `five-hour` the same way. `USAGE_REFUSE_PCT` is asserted to be 95.
 *   (g) [M3] `readUsage` answering a row under both thresholds resolves with
 *       `result.usage` byte-exact as the Machine spells it, and `renderLaunch`
 *       carries that line immediately after the `account=` line; an
 *       `{ unread: true, reason }` row resolves `usage: <account> unread —
 *       <reason>` in the same place.
 *   (h) [M4] a `refreshCredential` answering `refused` leaves a spy
 *       `readUsage` at zero calls; one answering `{ ok: true }` leaves it at
 *       one call, ordered before the rig's first `git push`.
 *   (i) [M5] `fleet/CONTRACT.md` names the `--no-rotate` usage read and the
 *       `usage: <account> 7d` launch line (the two `grep` legs of the Proof,
 *       run here as substring checks over the file the exam already reads).
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defaultReadUsage, defaultRefreshCredential, launch, renderLaunch, USAGE_REFUSE_PCT } from '../launch.mjs'
import { Refusal, defaultExec } from '../lobby.mjs'
import {
  answer, cleanup, cmdRule, makeExec, makeTargetRepo, sshRule, tempDir, thrown, vmsPayload
} from './_lobby_helpers.mjs'

// ── a/b. [M1, M2] defaultRefreshCredential over a spawn spy ─────────────────

const HELD_LINE = 'token: fresh until 2026-09-21T14:00:00.000Z; 1 run(s) live — not rotated'
const REFUSED_LINE =
  'token: expires 2026-09-21T13:00:00.000Z; 1 run(s) live (fleet-r7-2609211100-ab12) — not rotated; ' +
  'under 90 minutes is too short to launch on, so wait for the runs to end or remove their VMs'

function spy (result) {
  const calls = []
  const fn = (...args) => {
    calls.push(args)
    return result
  }
  fn.calls = calls
  return fn
}

// (a) [M1] the hold line, on exit 0
{
  const sp = spy({ status: 0, stdout: '', stderr: `${HELD_LINE}\n` })
  const cred = defaultRefreshCredential('acct', sp)
  assert.equal(cred.ok, true, '(a) [M1] ok is true')
  assert.equal(cred.held, HELD_LINE, '(a) [M1] held is exactly the hold line, trimmed of its newline')
  assert.equal(sp.calls.length, 1, '(a) [M1] the spy was called once')
  const argv = sp.calls[0][1]
  assert.deepEqual(
    argv.slice(-3), ['refresh', '--account', 'acct'],
    `(a) [M1] the argv's last three entries are refresh, --account, acct — got ${JSON.stringify(argv)}`
  )
}

// (b) [M2] the refusal line, on exit 1 — and a plain failure carries none
{
  const sp = spy({ status: 1, stdout: '', stderr: `${REFUSED_LINE}\n` })
  const cred = defaultRefreshCredential('acct', sp)
  assert.equal(cred.ok, false, '(b) [M2] ok is false on the refusal line')
  assert.equal(cred.refused, REFUSED_LINE, '(b) [M2] refused is exactly the refusal line, trimmed of its newline')

  const spOther = spy({ status: 1, stderr: 'token endpoint answered 500\n' })
  const credOther = defaultRefreshCredential('acct', spOther)
  assert.equal(credOther.ok, false, '(b) [M2] ok is false on an unrelated failure')
  assert.equal(credOther.refused, undefined, '(b) [M2] refused is undefined when no refusal line is present')
}

// ── c/d. [M3, M4] launch() driven with a stand-in refreshCredential ─────────

const TARGET = 'popmechanic/smoke'
const GH = 'gh-popmechanic-smoke'
const ORIGIN_URL = `https://github.com/${TARGET}.git`
const ENGINE = 'b'.repeat(40)
const NOW = new Date('2026-09-16T03:20:00.000Z')
const CAPPED = { cpu: '6', memory: '8GB' }
const BILLING_OK = { max_cpus: 16, max_memory_gb: 64, tier: 'XLarge', plan: 'Individual' }
const SEED = { 'README.md': '# target\n', 'src/app.js': 'export const x = 1\n' }
const PLAN = '# a plan\n\nOne plan, and a trailing newline.\n'

const task = (id) => ({
  id: String(id),
  title: `task ${id}`,
  factsheet: {
    files: [`f${id}.txt`], deletes: [], guards: [], proofTests: [], landing: {},
    driverOwned: [], siblingOwned: [], produces: [], consumes: []
  }
})
const ONE_TASK = { launch_waves: [[task(1)]], dag_edges: [] }

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
const helpText = (verb, flags) => [
  `Command: ${verb}`, '', 'Options:', ...flags.map((flag) => `  ${flag}  what ${flag} does`), ''
].join('\n')
const FLEET_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VERBS = JSON.parse(fs.readFileSync(path.join(FLEET_DIR, 'exe-verbs.json'), 'utf8'))
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
const NO_RECORD = answer('')
const recordRule = (res) => cmdRule('gh', 'api', res)
const NEW_OK = (cmd, argv) =>
  answer({ vm_name: /--name (\S+)/.exec(String(argv[1] ?? ''))?.[1] ?? '', status: 'running' })

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

function workspace () {
  const root = tempDir('fleet-launch-credential-')
  const repo = makeTargetRepo({ root, files: { ...SEED } })
  repo.git(['remote', 'set-url', 'origin', ORIGIN_URL])
  const planDir = path.join(root, 'plans-src')
  fs.mkdirSync(planDir)
  const planPath = path.join(planDir, 'a-plan.md')
  fs.writeFileSync(planPath, PLAN)
  return { root, repo, planPath, cleanup: () => cleanup(root) }
}

const argvFor = (ws) => [ws.planPath, '--target', TARGET, '--base', ws.repo.base, '--repo', ws.repo.dir, '--engine', ENGINE]
const launchIn = (ws, { exec, refreshCredential, readUsage }) => launch({
  argv: argvFor(ws),
  exec,
  config: CAPPED,
  now: () => NOW,
  sleep: async () => {},
  refreshCredential,
  ...(readUsage === undefined ? {} : { readUsage }),
  kata: null
})

const pushCalls = (exec) => exec.calls.filter((c) => c.cmd === 'git' && c.argv.includes('push'))
const newVerbs = (exec) => exec.mutating().filter((line) => line.startsWith('new '))

// (c) [M3] a declined credential refuses in one line, before anything is pushed
{
  const ws = workspace()
  const exec = makeExec({ rules: readRules({ repo: ws.repo }) })
  const refuseLine = REFUSED_LINE
  const refreshCredential = () => ({ ok: false, out: refuseLine, refused: refuseLine })
  const error = await thrown(() => launchIn(ws, { exec, refreshCredential }))
  assert.ok(error, '(c) [M3] launch() rejected')
  assert.equal(error.name, 'Refusal', `(c) [M3] the rejection is a Refusal, got ${error?.name}: ${error?.message}`)
  assert.ok(error instanceof Refusal, '(c) [M3] and an instance of Refusal')
  assert.equal(error.exitCode, 2, '(c) [M3] exit 2')
  assert.ok(error.message.includes(refuseLine), `(c) [M3] the message carries the refusal line: ${error.message}`)
  assert.ok(error.message.includes('nothing was pushed'), `(c) [M3] and says nothing was pushed: ${error.message}`)
  assert.deepEqual(pushCalls(exec), [], '(c) [M3] no git push was executed')
  assert.deepEqual(newVerbs(exec), [], '(c) [M3] and no `new ` lobby verb was issued')
  ws.cleanup()
}

// (d) [M4] a held credential is carried on the result and the launch line
{
  const ws = workspace()
  const exec = makeExec({ rules: readRules({ repo: ws.repo }) })
  const refreshCredential = () => ({ ok: true, held: HELD_LINE })
  const result = await launchIn(ws, { exec, refreshCredential })
  assert.equal(result.token, HELD_LINE, '(d) [M4] result.token is exactly the held line')
  const lines = renderLaunch(result).split('\n')
  assert.equal(
    lines.filter((l) => l === HELD_LINE).length, 1,
    `(d) [M4] renderLaunch carries the held line exactly once — got:\n${renderLaunch(result)}`
  )
  ws.cleanup()
}
{
  const ws = workspace()
  const exec = makeExec({ rules: readRules({ repo: ws.repo }) })
  const refreshCredential = () => ({ ok: true })
  const result = await launchIn(ws, { exec, refreshCredential })
  const lines = renderLaunch(result).split('\n')
  assert.ok(
    !lines.some((l) => l.startsWith('token:')),
    `(d) [M4] with no held credential, renderLaunch has no line starting token: — got:\n${renderLaunch(result)}`
  )
  ws.cleanup()
}

// ── #1114 — the launcher reads the windows after the refresh, prints them, ─
//            and refuses at the wall ───────────────────────────────────────

// (e) [M1] defaultReadUsage(account, spawn) over a spawn spy
{
  const ROW = {
    name: 'acct',
    sevenDay: { utilization: 58, resetsAt: '2026-09-20T00:00:00.000Z' },
    fiveHour: { utilization: 0, resetsAt: '2026-09-16T08:20:00.000Z' }
  }
  const sp = spy({ status: 0, stdout: JSON.stringify([ROW]), stderr: '' })
  const row = defaultReadUsage('acct', sp)
  assert.deepEqual(row, ROW, '(e) [M1] the row is the first (only) element of the JSON array on stdout')
  assert.equal(sp.calls.length, 1, '(e) [M1] the spy was called once')
  assert.equal(sp.calls[0][0], process.execPath, '(e) [M1] spawned with process.execPath')
  const argv = sp.calls[0][1]
  assert.deepEqual(
    argv.slice(-5), ['usage', '--json', '--account', 'acct', '--no-rotate'],
    `(e) [M1] the argv's last five entries are usage, --json, --account, acct, --no-rotate — got ${JSON.stringify(argv)}`
  )

  const spFailed = spy({ status: 1, stdout: '', stderr: 'token endpoint answered 500\n' })
  const rowFailed = defaultReadUsage('acct', spFailed)
  assert.equal(rowFailed.unread, true, '(e) [M1] a non-zero status answers unread: true')
  assert.equal(typeof rowFailed.reason, 'string', '(e) [M1] a non-zero status answers a string reason')

  const spEmpty = spy({ status: 0, stdout: '[]', stderr: '' })
  const rowEmpty = defaultReadUsage('acct', spEmpty)
  assert.equal(rowEmpty.unread, true, '(e) [M1] a JSON array with zero elements answers unread: true')
  assert.equal(typeof rowEmpty.reason, 'string', '(e) [M1] and a string reason')

  const spBad = spy({ status: 0, stdout: 'not json at all', stderr: '' })
  const rowBad = defaultReadUsage('acct', spBad)
  assert.equal(rowBad.unread, true, '(e) [M1] stdout that is not JSON answers unread: true')
  assert.equal(typeof rowBad.reason, 'string', '(e) [M1] and a string reason')
}

// USAGE_REFUSE_PCT is exported and exactly 95, as M2 spells it
assert.equal(USAGE_REFUSE_PCT, 95, '[M2] USAGE_REFUSE_PCT is exactly 95')

const rowAt = (sevenPct, fivePct) => ({
  sevenDay: { utilization: sevenPct, resetsAt: '2026-09-20T00:00:00.000Z' },
  fiveHour: { utilization: fivePct, resetsAt: '2026-09-16T08:20:00.000Z' }
})

// (f) [M2] a wall reading refuses before anything is pushed
{
  const ws = workspace()
  const exec = makeExec({ rules: readRules({ repo: ws.repo }) })
  const readUsage = () => rowAt(96, 0)
  const refreshCredential = () => ({ ok: true })
  const error = await thrown(() => launchIn(ws, { exec, refreshCredential, readUsage }))
  assert.ok(error, '(f) [M2] launch() rejected on a seven-day reading at the wall')
  assert.ok(error instanceof Refusal, '(f) [M2] and it is a Refusal')
  assert.ok(error.message.includes('ultrapowers'), `(f) [M2] the message carries the account: ${error.message}`)
  assert.ok(error.message.includes('seven-day'), `(f) [M2] the message carries seven-day: ${error.message}`)
  assert.ok(error.message.includes('96'), `(f) [M2] the message carries the utilization: ${error.message}`)
  assert.ok(
    error.message.includes('2026-09-20T00:00:00.000Z'),
    `(f) [M2] the message carries sevenDay.resetsAt: ${error.message}`
  )
  assert.ok(
    error.message.endsWith('— no VM was created and nothing was pushed'),
    `(f) [M2] the message ends with the no-VM sentence: ${error.message}`
  )
  assert.deepEqual(pushCalls(exec), [], '(f) [M2] no git push was executed')
  assert.deepEqual(newVerbs(exec), [], '(f) [M2] and no `new` lobby verb was issued')
  ws.cleanup()
}
{
  const ws = workspace()
  const exec = makeExec({ rules: readRules({ repo: ws.repo }) })
  const readUsage = () => rowAt(0, 95)
  const refreshCredential = () => ({ ok: true })
  const error = await thrown(() => launchIn(ws, { exec, refreshCredential, readUsage }))
  assert.ok(error, '(f) [M2] launch() rejected on a five-hour reading at the wall (95 exactly)')
  assert.ok(error instanceof Refusal, '(f) [M2] and it is a Refusal')
  assert.ok(error.message.includes('ultrapowers'), `(f) [M2] the message carries the account: ${error.message}`)
  assert.ok(error.message.includes('five-hour'), `(f) [M2] the message carries five-hour: ${error.message}`)
  assert.ok(error.message.includes('95'), `(f) [M2] the message carries the utilization: ${error.message}`)
  assert.ok(
    error.message.includes('2026-09-16T08:20:00.000Z'),
    `(f) [M2] the message carries fiveHour.resetsAt: ${error.message}`
  )
  assert.ok(
    error.message.endsWith('— no VM was created and nothing was pushed'),
    `(f) [M2] the message ends with the no-VM sentence: ${error.message}`
  )
  assert.deepEqual(pushCalls(exec), [], '(f) [M2] no git push was executed')
  assert.deepEqual(newVerbs(exec), [], '(f) [M2] and no `new` lobby verb was issued')
  ws.cleanup()
}

// (g) [M3] a row under both thresholds carries usage on the result and the launch line
{
  const ws = workspace()
  const exec = makeExec({ rules: readRules({ repo: ws.repo }) })
  const readUsage = () => rowAt(58, 0)
  const refreshCredential = () => ({ ok: true })
  const result = await launchIn(ws, { exec, refreshCredential, readUsage })
  assert.equal(
    result.usage,
    'usage: ultrapowers 7d 58% resets 2026-09-20T00:00:00.000Z; 5h 0% resets 2026-09-16T08:20:00.000Z',
    `(g) [M3] result.usage is byte-exact — got ${JSON.stringify(result.usage)}`
  )
  const lines = renderLaunch(result).split('\n')
  const accountIdx = lines.indexOf('account=ultrapowers')
  assert.ok(accountIdx >= 0, `(g) [M3] renderLaunch carries an account= line — got:\n${renderLaunch(result)}`)
  assert.equal(
    lines[accountIdx + 1], result.usage,
    `(g) [M3] the usage line sits directly after account= — got:\n${renderLaunch(result)}`
  )
  ws.cleanup()
}
{
  const ws = workspace()
  const exec = makeExec({ rules: readRules({ repo: ws.repo }) })
  const readUsage = () => ({ unread: true, reason: 'x' })
  const refreshCredential = () => ({ ok: true })
  const result = await launchIn(ws, { exec, refreshCredential, readUsage })
  assert.equal(
    result.usage, 'usage: ultrapowers unread — x',
    `(g) [M3] an unread row resolves result.usage byte-exact — got ${JSON.stringify(result.usage)}`
  )
  const lines = renderLaunch(result).split('\n')
  const accountIdx = lines.indexOf('account=ultrapowers')
  assert.ok(accountIdx >= 0, `(g) [M3] renderLaunch carries an account= line — got:\n${renderLaunch(result)}`)
  assert.equal(
    lines[accountIdx + 1], result.usage,
    `(g) [M3] the unread usage line sits directly after account= — got:\n${renderLaunch(result)}`
  )
  ws.cleanup()
}

// (h) [M4] readUsage's call count is gated on refreshCredential, and ordered before push
function orderedSpy (result, order, tag) {
  const calls = []
  const fn = (...args) => {
    calls.push(args)
    order.push(tag)
    return result
  }
  fn.calls = calls
  return fn
}
const pushOrderRule = (repo, order) => ({
  when: (cmd, argv) => cmd === 'git' && argv.includes('push') && !argv.some((a) => /ultrapowers/.test(String(a))),
  answer: (cmd, argv, options) => {
    order.push('push')
    return defaultExec('git', pointAtOrigin(repo, argv), options ?? {})
  }
})
{
  const ws = workspace()
  const order = []
  const exec = makeExec({ rules: [pushOrderRule(ws.repo, order), ...readRules({ repo: ws.repo })] })
  const readUsage = orderedSpy(rowAt(0, 0), order, 'readUsage')
  const refreshCredential = () => ({ ok: false, refused: REFUSED_LINE })
  await thrown(() => launchIn(ws, { exec, refreshCredential, readUsage }))
  assert.equal(
    readUsage.calls.length, 0,
    '(h) [M4] a refused refreshCredential leaves readUsage at zero calls'
  )
  ws.cleanup()
}
{
  const ws = workspace()
  const order = []
  const exec = makeExec({ rules: [pushOrderRule(ws.repo, order), ...readRules({ repo: ws.repo })] })
  const readUsage = orderedSpy(rowAt(0, 0), order, 'readUsage')
  const refreshCredential = () => ({ ok: true })
  await launchIn(ws, { exec, refreshCredential, readUsage })
  assert.equal(
    readUsage.calls.length, 1,
    '(h) [M4] an ok refreshCredential leaves readUsage at exactly one call'
  )
  const readUsageIdx = order.indexOf('readUsage')
  const pushIdx = order.indexOf('push')
  assert.ok(readUsageIdx >= 0, '(h) [M4] readUsage was recorded in the call order')
  assert.ok(pushIdx >= 0, '(h) [M4] a git push was recorded in the call order')
  assert.ok(
    readUsageIdx < pushIdx,
    `(h) [M4] readUsage ran before the first git push — order was ${JSON.stringify(order)}`
  )
  ws.cleanup()
}

// (i) [M5] fleet/CONTRACT.md names the usage read and the launch line — the
// two `grep` legs of the Proof, run here as substring checks over the file.
{
  const contract = fs.readFileSync(path.join(FLEET_DIR, 'CONTRACT.md'), 'utf8')
  assert.ok(
    contract.includes('no-rotate'),
    '(i) [M5] CONTRACT.md names the --no-rotate usage read (grep -q \'no-rotate\')'
  )
  assert.ok(
    contract.includes('usage: <account> 7d'),
    '(i) [M5] CONTRACT.md\'s launch-line list names the usage: line (grep -qF \'usage: <account> 7d\')'
  )
}

console.log('ALL TESTS PASSED')

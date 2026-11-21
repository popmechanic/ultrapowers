import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defaultReadUsage, defaultRefreshCredential, launch, renderLaunch, USAGE_REFUSE_PCT } from '../launch.mjs'
import { Refusal, defaultExec } from '../lobby.mjs'
import {
  launchRules, launchWorkspace, makeExec, pointAtOrigin, pushCalls, thrown
} from './_lobby_helpers.mjs'

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

{
  const sp = spy({ status: 1, stdout: '', stderr: `${REFUSED_LINE}\n` })
  const cred = defaultRefreshCredential('acct', sp)
  assert.equal(cred.ok, false, '(b) [M2] ok is false on the refusal line')
  assert.equal(cred.refused, REFUSED_LINE, '(b) [M2] refused is exactly the refusal line, trimmed of its newline')

  const spOther = spy({ status: 1, stderr: 'token endpoint answered 500\n' })
  const credOther = defaultRefreshCredential('acct', spOther)
  assert.equal(credOther.ok, false, '(b) [M2] ok is false on an unrelated failure')
  assert.equal(credOther.refused, undefined, '(b) [M2] refused is undefined when no refusal line is present')

  const spNone = spy({ status: 1, stderr: 'no refresh token in the keychain — run `node fleet/claude-token.mjs login` first\n' })
  const credNone = defaultRefreshCredential('acct', spNone)
  assert.equal(credNone.ok, false, '(b) a missing keychain record is not ok')
  assert.ok(typeof credNone.refused === 'string' && credNone.refused.includes('account acct'),
    `(b) a missing keychain record refuses naming the account — got ${JSON.stringify(credNone.refused)}`)
}

const TARGET = 'popmechanic/smoke'
const GH = 'gh-popmechanic-smoke'
const ORIGIN_URL = `https://github.com/${TARGET}.git`
const ENGINE = 'b'.repeat(40)
const NOW = new Date('2026-09-16T03:20:00.000Z')
const EVIDENCE = 'ops/evidence'
const CAPPED = { cpu: '6', memory: '8GB', evidence: EVIDENCE }
const FLEET_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const readRules = ({ repo }) =>
  launchRules({ engine: ENGINE, repo, evidence: repo.evidence, gh: GH })

function workspace () {
  const ws = launchWorkspace({ prefix: 'fleet-launch-credential-', originUrl: ORIGIN_URL, evidence: EVIDENCE })
  ws.repo.evidence = ws.evidence
  return ws
}

const argvFor = (ws) => [ws.planPath, '--target', TARGET, '--base', ws.repo.base, '--repo', ws.repo.dir, '--engine', ENGINE]
const launchIn = (ws, { exec, refreshCredential, readUsage }) => launch({
  argv: argvFor(ws),
  exec,
  config: CAPPED,
  now: () => NOW,
  sleep: async () => {},
  refreshCredential,
  ...(readUsage === undefined ? {} : { readUsage })
})

const newVerbs = (exec) => exec.mutating().filter((line) => line.startsWith('new '))

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

assert.equal(USAGE_REFUSE_PCT, 95, '[M2] USAGE_REFUSE_PCT is exactly 95')

const rowAt = (sevenPct, fivePct) => ({
  sevenDay: { utilization: sevenPct, resetsAt: '2026-09-20T00:00:00.000Z' },
  fiveHour: { utilization: fivePct, resetsAt: '2026-09-16T08:20:00.000Z' }
})

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
    return defaultExec('git', pointAtOrigin(repo, argv, repo.evidence), options ?? {})
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

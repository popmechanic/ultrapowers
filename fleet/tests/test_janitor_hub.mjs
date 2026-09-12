/**
 * fleet/tests/test_janitor_hub.mjs — the janitor asks the hub, and reads the
 * target only when the hub cannot answer (#938 item 1).
 *
 * The rig is `test_janitor.mjs`'s — a recording exec seam, `ls` and `rm`
 * canned as lobby verbs, `gh api` canned per path, a unit answer per VM — plus
 * a stub hub: a rule for `ssh <KATA_URL host> <remote>` that reads the method
 * and the path out of the remote `curl` line and answers what kata answers,
 * `<json>\n<status>`. The hub is configured the way the laptop configures it,
 * a `kata-hub.env` the janitor is pointed at, whose `KATA_TOKEN` is a canary:
 * it must never leave the file. Nothing here opens a socket.
 *
 * What is pinned, clause by clause:
 *
 *   (a) [M1] the hub answers: over the fleet below the hub reads are one
 *       `GET /api/v1/projects?limit=1000`, then one
 *       `GET /api/v1/projects/<id>/issues?limit=1000` per row the hub has a
 *       project for, in row order; each is one `ssh` whose destination is the
 *       env's host and whose remote sources the bearer on the hub
 *       (`$KATA_AUTH_TOKEN`), and no argv element and no stdin carries the
 *       canary; the run issue is the one whose `metadata.run` is N, not the
 *       listing's first row; a closed issue older than `--age` is reaped with
 *       `closed_reason` as its state and `closed_at` as its age, a younger one
 *       is not; an open issue is probed at its unit and aged from `updated_at`,
 *       stale from `kata:<project>` at six hours; a run the hub has no project
 *       for is read from the evidence; no `gh api …/contents/…` read names a
 *       run the hub answered; the kept row and the commentless row draw no
 *       hub read; `--dry-run` reads the same and removes nothing
 *   (b) [M2] the hub is dark: the same fleet with ssh to the hub exiting 255
 *       draws exactly one hub ssh, every row is read from the evidence (tag
 *       first), and the reap decision — the `rm` verbs, the reaped VMs, the
 *       kept, stale and unknown VMs — is identical to (a)'s; `result.hub.dark`
 *       names the failure and the report opens with the `hub … unreachable`
 *       line
 *   (c) [M3] a death under the hub: an open issue whose unit is dead draws
 *       the journal read, the two `-X PUT`s on the evidence branch (the page
 *       fetched at the branch, never the tag) and one
 *       `POST /api/v1/projects/<id>/issues/<uid>/actions/close` — `wontfix`,
 *       a message of forty characters or more naming the unit, actor
 *       `janitor`, `Idempotency-Key janitor:run-<N>:death`; a branch with no
 *       page gets the close alone; `--dry-run` reads the unit and writes
 *       nowhere; the closed issue is reaped an hour on by the ordinary rule
 *   (d) [M4] no env file: `hub.dark` names the path, the report opens with
 *       the line, no hub ssh is issued and the rows are read from the
 *       evidence; `kata: null` answers `hub` null and prints no line
 *   (e) the sentinel
 */

import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'

import { evidenceBranchFor, evidenceTagFor, kataProjectFor } from '../lobby.mjs'
import { janitor, renderJanitor } from '../janitor.mjs'
import {
  answer, cleanup, cmdRule, makeExec, sshRule, tempDir, vmRow, vmRule, vmsPayload
} from './_lobby_helpers.mjs'

const NOW = new Date('2026-09-12T12:00:00.000Z')
const NOW_ISO = NOW.toISOString()
const minutesAgo = (m) => new Date(NOW.getTime() - m * 60000).toISOString()
const hoursAgo = (h) => minutesAgo(h * 60)
const laterBy = (h) => new Date(NOW.getTime() + h * 60 * 60 * 1000)

const TARGET = 'acme/widgets'
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const CONFIG = { cpu: '8', memory: '16GB' }

const vm = (n) => `fleet-r${n}-2609121000-a1b2`
const dest = (n) => `exedev@${vm(n)}.ssh.exe.xyz`
const comment = (run) => `run=${run} plan=${SHA} target=${TARGET} base=${SHA} engine=${SHA}`
const row = (n) => vmRow(vm(n), { comment: comment(n) })

// ── The hub, as the laptop configures it ────────────────────────────────────

const HUB_HOST = 'hub.test'
const HUB_ORIGIN = 'http://localhost:8000'
/** The token that must never leave the env file. */
const CANARY = 'canary-token-never-on-an-argv-0123456789abcdef'
const HOME = tempDir('fleet-janitor-hub-')
const ENV_PATH = path.join(HOME, 'kata-hub.env')
fs.writeFileSync(ENV_PATH, `KATA_URL=https://${HUB_HOST}\nKATA_TOKEN=${CANARY}\n`)
const ABSENT_ENV = path.join(HOME, 'absent.env')

/** The remote's prefix: the bearer sourced on the hub, the token never here. */
const REMOTE_PREFIX = 'set -a; . /etc/kata/kata.env; exec curl -sS -X '
const BEARER = '-H "Authorization: Bearer $KATA_AUTH_TOKEN"'

const project = (n) => ({ id: n, uid: `P${n}`, name: kataProjectFor(TARGET, n), metadata: {}, revision: 1 })
const RUN_UID = (n) => `U${n}`
const closedIssue = (n, reason, at) => ({
  id: 100 + n, uid: RUN_UID(n), project_id: n, title: `run-${n}: a plan`, status: 'closed',
  closed_reason: reason, metadata: { run: n, target: TARGET, base: SHA, closes: [] },
  revision: 2, created_at: hoursAgo(9), updated_at: at, closed_at: at
})
const openIssue = (n, at) => ({
  id: 100 + n, uid: RUN_UID(n), project_id: n, title: `run-${n}: a plan`, status: 'open',
  metadata: { run: n, target: TARGET, base: SHA, closes: [] },
  revision: 1, created_at: hoursAgo(9), updated_at: at
})
/** A task issue, closed long ago, listed FIRST: a janitor that takes the
 *  listing's first row instead of the one whose metadata.run is N reaps on it. */
const decoyTask = (n) => ({
  id: 200 + n, uid: `T${n}`, project_id: n, title: 'task 1: one', status: 'closed',
  closed_reason: 'done', metadata: { task: '1', wave: 1 }, revision: 2,
  created_at: hoursAgo(9), updated_at: hoursAgo(8), closed_at: hoursAgo(8)
})

const hubAnswer = (json, status = 200) => answer(`${JSON.stringify(json)}\n${status}`)

/**
 * The stub hub: one rule over `ssh … hub.test <remote>`, answering by the
 * method and path it reads out of the remote curl line. Every call is
 * recorded with its parsed body (the stdin the transport handed the seam).
 */
function hubStub ({ projects = [], issues = {}, close = null } = {}) {
  const calls = []
  const rule = {
    when: (cmd, argv) => cmd === 'ssh' && argv.includes(HUB_HOST),
    answer: (cmd, argv, options) => {
      const remote = String(argv[argv.length - 1])
      const method = /-X (\S+)/.exec(remote)?.[1] ?? null
      const url = remote.split(' ').pop()
      const p = url.startsWith(HUB_ORIGIN) ? url.slice(HUB_ORIGIN.length) : url
      const input = String(options?.input ?? '')
      const body = input === '' ? null : JSON.parse(input)
      calls.push({ method, path: p, body, remote, argv, options })
      if (method === 'GET' && p === '/api/v1/projects?limit=1000') return hubAnswer({ projects })
      const listing = /^\/api\/v1\/projects\/(\d+)\/issues\?limit=1000$/.exec(p)
      if (method === 'GET' && listing) {
        return Object.hasOwn(issues, listing[1])
          ? hubAnswer({ issues: issues[listing[1]] })
          : hubAnswer({ status: 404, error: { code: 'not_found' } }, 404)
      }
      const closing = /^\/api\/v1\/projects\/(\d+)\/issues\/([^/]+)\/actions\/close$/.exec(p)
      if (method === 'POST' && closing && close !== null) return hubAnswer(close(closing[1], closing[2], body))
      return hubAnswer({ status: 404, error: { code: 'not_found' } }, 404)
    }
  }
  return { rule, calls }
}

/** The dark hub: ssh to it fails as a dark VM fails. */
const DARK_RULE = {
  when: (cmd, argv) => cmd === 'ssh' && argv.includes(HUB_HOST),
  answer: answer('', { code: 255, stderr: `ssh: connect to host ${HUB_HOST} port 22: Connection timed out` })
}

// ── The evidence and the VMs, as `test_janitor.mjs` cans them ───────────────

const statusPath = (n) => `repos/${TARGET}/contents/.ultrapowers/runs/${n}/status.json`
const journalPath = (n) => `repos/${TARGET}/contents/.ultrapowers/runs/${n}/janitor-journal.txt`
const tagPagePath = (n) => `${statusPath(n)}?ref=${evidenceTagFor(n)}`
const branchPagePath = (n) => `${statusPath(n)}?ref=${evidenceBranchFor(n)}`
const NOT_FOUND = answer('', { code: 1, stderr: 'gh: Not Found (HTTP 404)' })
const PUT_OK = answer({ content: { sha: 'f'.repeat(40) }, commit: { sha: 'e'.repeat(40) } })
const envelope = (page, sha) => answer({
  content: Buffer.from(JSON.stringify(page), 'utf8').toString('base64'), encoding: 'base64', sha
})
const ghRule = (pages) => cmdRule('gh', 'api', (cmd, argv) => {
  if (argv.includes('-X')) return PUT_OK
  const p = argv.find((a) => typeof a === 'string' && a.startsWith('repos/'))
  return p !== undefined && Object.hasOwn(pages, p) ? envelope(pages[p].page, pages[p].sha) : NOT_FOUND
})
const lsRules = (fleet) => [
  sshRule('ls ', (cmd, argv) => {
    const pattern = /^ls '([^']+)'/.exec(argv[1])[1]
    const re = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`)
    return vmsPayload(fleet.filter((r) => re.test(r.vm_name)))
  }),
  sshRule('rm ', answer(''))
]

const UNIT_READ = 'XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user show fleet-run@'
const JOURNAL_READ = 'journalctl _SYSTEMD_USER_UNIT=fleet-run@'
const unitText = (unit) => `${Object.entries(unit).map(([k, v]) => `${k}=${v}`).join('\n')}\n`
const ALIVE = { ActiveState: 'active', SubState: 'running', Result: 'success', ExecMainStatus: '0' }
const DEAD = { ActiveState: 'failed', SubState: 'failed', Result: 'exit-code', ExecMainStatus: '1' }
const afterOptions = (argv) => {
  const rest = []
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '-o') {
      i += 1
      continue
    }
    rest.push(argv[i])
  }
  return { dest: rest[0], command: rest.slice(1).join(' ') }
}
/** Fleet VMs answer per destination; the hub's own rule sits before this one. */
const vmAnswers = (byDest) => vmRule((cmd, argv) => {
  const call = afterOptions(argv)
  const handler = byDest[call.dest]
  return handler === undefined ? answer('') : handler(call.command)
})

// ── Readers ─────────────────────────────────────────────────────────────────

const ghCalls = (exec) => exec.calls.filter((c) => c.cmd === 'gh')
const pathOf = (argv) => argv.find((a) => typeof a === 'string' && a.startsWith('repos/'))
const contentsReads = (exec) => ghCalls(exec)
  .filter((c) => !c.argv.includes('-X')).map((c) => pathOf(c.argv))
  .filter((p) => p !== undefined && p.includes('/contents/'))
const puts = (exec) => ghCalls(exec).filter((c) => {
  const i = c.argv.indexOf('-X')
  return i !== -1 && c.argv[i + 1] === 'PUT'
})
const fieldsOf = (call) => {
  const out = {}
  for (let i = 0; i < call.argv.length; i += 1) {
    if (call.argv[i] !== '-f') continue
    const token = String(call.argv[i + 1] ?? '')
    const eq = token.indexOf('=')
    if (eq <= 0) continue
    out[token.slice(0, eq)] = token.slice(eq + 1)
  }
  return out
}
const decode = (b64) => Buffer.from(String(b64), 'base64').toString('utf8')
/** The fleet-VM ssh calls — the hub's are told apart by their destination. */
const fleetSsh = (exec) => exec.vm().filter((c) => c.dest !== HUB_HOST)
const hubSsh = (exec) => exec.calls.filter((c) => c.cmd === 'ssh' && c.argv.includes(HUB_HOST))
const sorted = (xs) => [...xs].sort()
const vms = (entries) => sorted((entries ?? []).map((e) => e.vm))
/** The decision, as the (a)/(b) comparison reads it: what was and was not done, by VM. */
const decision = (exec, result) => ({
  rm: sorted(exec.mutating()),
  reaped: vms(result.actions),
  kept: vms(result.kept),
  stale: vms(result.stale),
  unknown: vms(result.unknown),
  deaths: vms(result.deaths)
})
const newExec = (rules) => makeExec({ rules, passthrough: [] })

// ═══════════════════════════════════════════════════════════════════════════
// The fleet of legs (a) and (b)
// ═══════════════════════════════════════════════════════════════════════════

const R_DONE = 3 // closed done two hours ago: reaped
const R_WONT = 4 // closed wontfix two hours ago: reaped
const R_61 = 13 // closed done 61 minutes ago: reaped
const R_59 = 14 // closed done 59 minutes ago: kept another minute
const R_LIVE = 6 // open, updated a minute ago, unit alive: nothing
const R_SILENT = 10 // open, updated seven hours ago, unit alive: stale
const R_OFF_HUB = 20 // no project on the hub: read from the evidence, done two hours ago
const R_KEPT = 8 // comment says do not reap
const R_NONE = 9 // no comment

const ON_HUB = [R_DONE, R_WONT, R_61, R_59, R_LIVE, R_SILENT]
const KEPT_COMMENT = 'kata hub — persistent service, do not reap'
const FLEET = [
  row(R_DONE), row(R_WONT), row(R_61), row(R_59), row(R_LIVE), row(R_SILENT), row(R_OFF_HUB),
  vmRow(vm(R_KEPT), { comment: KEPT_COMMENT, tags: [] }),
  vmRow(vm(R_NONE))
]
const CLOSED_AT = { [R_DONE]: hoursAgo(2), [R_WONT]: hoursAgo(2), [R_61]: minutesAgo(61), [R_59]: minutesAgo(59) }
const HUB_DATA = {
  projects: ON_HUB.map(project),
  issues: {
    [R_DONE]: [decoyTask(R_DONE), closedIssue(R_DONE, 'done', CLOSED_AT[R_DONE])],
    [R_WONT]: [decoyTask(R_WONT), closedIssue(R_WONT, 'wontfix', CLOSED_AT[R_WONT])],
    [R_61]: [decoyTask(R_61), closedIssue(R_61, 'done', CLOSED_AT[R_61])],
    [R_59]: [decoyTask(R_59), closedIssue(R_59, 'done', CLOSED_AT[R_59])],
    [R_LIVE]: [decoyTask(R_LIVE), openIssue(R_LIVE, minutesAgo(1))],
    [R_SILENT]: [decoyTask(R_SILENT), openIssue(R_SILENT, hoursAgo(7))]
  }
}
/** The evidence says the same thing the hub says, page for issue, at the tag. */
const page = (n, state, updatedAt) => ({ run: n, state, phase: 'x', vm: vm(n), updatedAt })
const PAGES = {
  [tagPagePath(R_DONE)]: { page: page(R_DONE, 'done', CLOSED_AT[R_DONE]) },
  [tagPagePath(R_WONT)]: { page: page(R_WONT, 'parked', CLOSED_AT[R_WONT]) },
  [tagPagePath(R_61)]: { page: page(R_61, 'done', CLOSED_AT[R_61]) },
  [tagPagePath(R_59)]: { page: page(R_59, 'done', CLOSED_AT[R_59]) },
  [tagPagePath(R_LIVE)]: { page: page(R_LIVE, 'running', minutesAgo(1)) },
  [tagPagePath(R_SILENT)]: { page: page(R_SILENT, 'running', hoursAgo(7)) },
  [tagPagePath(R_OFF_HUB)]: { page: page(R_OFF_HUB, 'done', hoursAgo(2)) }
}
const UNITS = vmAnswers({ [dest(R_LIVE)]: () => answer(unitText(ALIVE)), [dest(R_SILENT)]: () => answer(unitText(ALIVE)) })
const REAPED = [R_DONE, R_WONT, R_61, R_OFF_HUB]

const litExec = () => {
  const hub = hubStub(HUB_DATA)
  return { exec: newExec([...lsRules(FLEET), hub.rule, UNITS, ghRule(PAGES)]), hub }
}
const darkExec = () => newExec([...lsRules(FLEET), DARK_RULE, UNITS, ghRule(PAGES)])
const pass = (exec, argv = []) => janitor({ argv, exec, config: CONFIG, now: () => NOW, kataEnvPath: ENV_PATH })

// ═══════════════════════════════════════════════════════════════════════════
// (a) the hub answers [M1]
// ═══════════════════════════════════════════════════════════════════════════

let LIT
{
  const { exec, hub } = litExec()
  const result = await pass(exec)
  LIT = { exec, result }

  // ── the reads, and how they travel ────────────────────────────────────────
  assert.deepEqual(
    hub.calls.map((c) => `${c.method} ${c.path}`),
    ['GET /api/v1/projects?limit=1000', ...ON_HUB.map((n) => `GET /api/v1/projects/${n}/issues?limit=1000`)],
    '(a)/M1 the hub reads are one GET /api/v1/projects?limit=1000, then one GET /api/v1/projects/<id>/issues?limit=1000 per row the hub has a project for, in row order — the project found by name, its issues by integer id')
  assert.equal(hubSsh(exec).length, hub.calls.length,
    '(a)/M1 and each is exactly one ssh')
  for (const call of hubSsh(exec)) {
    assert.equal(call.argv[call.argv.length - 2], HUB_HOST,
      `(a)/M1 the ssh destination is the env's KATA_URL host, got ${JSON.stringify(call.argv)}`)
    const remote = String(call.argv[call.argv.length - 1])
    assert.equal(remote.startsWith(`${REMOTE_PREFIX}GET ${BEARER}`), true,
      `(a)/M1 the remote sources the bearer on the hub and names it as $KATA_AUTH_TOKEN, got ${JSON.stringify(remote)}`)
    assert.equal(call.argv.some((a) => String(a).includes(CANARY)), false,
      '(a)/M1 no argv element carries the env file\'s token')
    assert.equal(String(call.options?.input ?? '').includes(CANARY), false,
      '(a)/M1 nor does stdin')
  }
  assert.deepEqual(contentsReads(exec), [tagPagePath(R_OFF_HUB)],
    `(a)/M1 the only gh api contents read is run ${R_OFF_HUB}'s, the run the hub has no project for — no row the hub answered is read off the target`)
  for (const n of [R_KEPT, R_NONE]) {
    assert.deepEqual(hub.calls.filter((c) => c.path.includes(`/projects/${n}/`)), [],
      `(a)/M1 run ${n} (kept or unreadable) draws no hub read`)
  }

  // ── the verdicts ──────────────────────────────────────────────────────────
  assert.deepEqual(sorted(exec.mutating()), sorted(REAPED.map((n) => `rm ${vm(n)} --json`)),
    `(a)/M1 the mutating lobby verbs are exactly rm <vm> --json for runs ${R_DONE} (done), ${R_WONT} (wontfix) and ${R_61} (done, 61 minutes) off the hub and ${R_OFF_HUB} off the evidence; ${R_59} is 59 minutes closed`)
  assert.deepEqual(
    result.actions.filter((a) => ON_HUB.includes(a.run)).map((a) => [a.run, a.state, a.updatedAt]),
    [[R_DONE, 'done', CLOSED_AT[R_DONE]], [R_WONT, 'wontfix', CLOSED_AT[R_WONT]], [R_61, 'done', CLOSED_AT[R_61]]],
    '(a)/M1 a hub-read action carries closed_reason as its state and closed_at as its age')
  assert.equal(result.actions.every((a) => a.kind === 'rm' && a.applied === true), true,
    '(a)/M1 every action is an applied rm')
  assert.deepEqual(result.stale, [{
    vm: vm(R_SILENT), run: R_SILENT, state: 'open', lastUpdate: hoursAgo(7), from: `kata:${kataProjectFor(TARGET, R_SILENT)}`
  }], '(a)/M1 the open issue updated seven hours ago is the one stale row, aged from updated_at, from kata:<project>')
  assert.deepEqual(result.kept, [{ vm: vm(R_KEPT), comment: KEPT_COMMENT }], '(a)/M1 the do-not-reap row is kept')
  assert.deepEqual(result.unknown.map((u) => u.vm), [vm(R_NONE)], '(a)/M1 the commentless row is unknown')
  assert.deepEqual(result.deaths, [], '(a)/M1 no unit here is dead')
  assert.deepEqual(
    sorted(fleetSsh(exec).map((c) => c.dest)), sorted([dest(R_LIVE), dest(R_SILENT)]),
    '(a)/M1 the two open issues draw one unit read each, at their own ssh_dest; the closed ones draw none')
  assert.equal(fleetSsh(exec).every((c) => c.command.startsWith(UNIT_READ)), true, '(a)/M1 and those are unit reads')
  assert.deepEqual(result.hub, { host: HUB_HOST, dark: null }, '(a)/M1 the result names the hub it asked')

  const lines = renderJanitor(result).split('\n')
  assert.equal(lines.some((l) => l.startsWith('hub ')), false, '(a)/M1 a hub that answered prints no hub line')
  assert.equal(lines.includes(`rm ${vm(R_WONT)}  run=${R_WONT} wontfix since ${CLOSED_AT[R_WONT]}`), true,
    '(a)/M1 the rm line for a wontfix close says wontfix')
  assert.equal(lines.includes(`stale ${vm(R_SILENT)}  run=${R_SILENT} state=open last update ${hoursAgo(7)} (kata:${kataProjectFor(TARGET, R_SILENT)}) — look before you rm`), true,
    '(a)/M1 the stale line names kata:<project> as where the age came from')

  // ── --dry-run reads the same, removes nothing ─────────────────────────────
  const dry = litExec()
  const dryResult = await pass(dry.exec, ['--dry-run'])
  assert.deepEqual(dry.hub.calls.map((c) => `${c.method} ${c.path}`), hub.calls.map((c) => `${c.method} ${c.path}`),
    '(a)/M1 --dry-run issues the same hub reads')
  assert.deepEqual(dry.exec.mutating(), [], '(a)/M1 and no rm')
  assert.deepEqual(vms(dryResult.actions), vms(result.actions), '(a)/M1 while reporting the same rows')
  assert.equal(dryResult.actions.every((a) => a.applied === false), true, '(a)/M1 unapplied')
}

// ═══════════════════════════════════════════════════════════════════════════
// (b) the hub is dark: the same decision, read off the target [M2]
// ═══════════════════════════════════════════════════════════════════════════
{
  const exec = darkExec()
  const result = await pass(exec)

  assert.equal(hubSsh(exec).length, 1,
    `(b)/M2 a dark hub is asked exactly once per pass — the first failure darkens the rest — got ${hubSsh(exec).length}`)
  assert.deepEqual(sorted(contentsReads(exec)), sorted([...ON_HUB, R_OFF_HUB].map(tagPagePath)),
    '(b)/M2 every row with an assignment is then read off the target, at the evidence tag')
  assert.deepEqual(decision(exec, result), decision(LIT.exec, LIT.result),
    '(b)/M2 the reap decision is identical to the lit hub\'s: the same rm verbs, the same reaped, kept, stale and unknown VMs, no death either way')
  assert.equal(typeof result.hub.dark === 'string' && result.hub.dark.length > 0, true, '(b)/M2 result.hub.dark says why')
  assert.equal(result.hub.dark.includes('GET /api/v1/projects?limit=1000'), true,
    `(b)/M2 naming the request that failed: ${result.hub.dark}`)
  assert.equal(result.hub.dark.includes('Connection timed out'), true,
    `(b)/M2 and what ssh said: ${result.hub.dark}`)
  assert.equal(result.hub.host, HUB_HOST, '(b)/M2 and the host it tried')
  assert.equal(result.stale[0].from, evidenceTagFor(R_SILENT),
    '(b)/M2 the stale row\'s age came from the evidence tag this time, and the entry says so')

  const lines = renderJanitor(result).split('\n')
  assert.equal(lines[0].startsWith(`hub ${HUB_HOST} unreachable (`), true,
    `(b)/M2 the report opens with the hub line, got ${JSON.stringify(lines[0])}`)
  assert.equal(lines[0].endsWith("— every run read from the target's evidence instead"), true,
    '(b)/M2 which says what was done instead')
  assert.equal(lines.filter((l) => l.startsWith('hub ')).length, 1, '(b)/M2 once')

  // --dry-run under a dark hub: the same reads, no rm.
  const dry = darkExec()
  const dryResult = await pass(dry, ['--dry-run'])
  assert.equal(hubSsh(dry).length, 1, '(b)/M2 --dry-run asks the dark hub once too')
  assert.deepEqual(dry.mutating(), [], '(b)/M2 and removes nothing')
  assert.deepEqual(vms(dryResult.actions), vms(result.actions), '(b)/M2 while reporting the same rows')
}

// ═══════════════════════════════════════════════════════════════════════════
// (c) a death under the hub [M3]
// ═══════════════════════════════════════════════════════════════════════════

const R_DEAD = 30 // open on the hub, unit dead, page on the branch
const R_DEAD_BARE = 31 // open on the hub, unit dead, no page anywhere
const blobSha = (n) => String(n).repeat(20).slice(0, 40)
const livePage = (n) => ({
  run: n, state: 'running', phase: 'implement', pr: null, branch: `ultra/integration-run-${n}`,
  vm: vm(n), startedAt: minutesAgo(90), updatedAt: minutesAgo(1)
})
const journalText = (n) => `-- journal for fleet-run@${n}.service --\n${vm(n)} run[${n}]: engine exited\n`
const deadUnits = (ns) => vmAnswers(Object.fromEntries(ns.map((n) => [dest(n), (command) =>
  (command.startsWith(JOURNAL_READ) ? answer(journalText(n)) : answer(unitText(DEAD)))])))

/** A hub whose run issues are open, and whose close is recorded and answered. */
const deathHub = (ns) => hubStub({
  projects: ns.map(project),
  issues: Object.fromEntries(ns.map((n) => [n, [decoyTask(n), openIssue(n, minutesAgo(1))]])),
  close: (id, uid, body) => ({ issue: { uid, revision: 2, status: 'closed', closed_reason: body.reason } })
})
const deathExec = (ns, pages) => {
  const hub = deathHub(ns)
  return { exec: newExec([...lsRules(ns.map(row)), hub.rule, deadUnits(ns), ghRule(pages)]), hub }
}

{
  const { exec, hub } = deathExec([R_DEAD], { [branchPagePath(R_DEAD)]: { page: livePage(R_DEAD), sha: blobSha(R_DEAD) } })
  const result = await pass(exec)

  assert.deepEqual(contentsReads(exec), [branchPagePath(R_DEAD)],
    '(c)/M3 the page is fetched for the write at the evidence branch, and only there: the tag is never read for a row the hub answered')
  assert.deepEqual(fleetSsh(exec).map((c) => [c.dest, c.command.startsWith(UNIT_READ) ? 'unit' : c.command.startsWith(JOURNAL_READ) ? 'journal' : c.command]),
    [[dest(R_DEAD), 'unit'], [dest(R_DEAD), 'journal']],
    '(c)/M3 one unit read then one journal read, both at the row\'s own ssh_dest')

  const status = puts(exec).filter((c) => pathOf(c.argv) === statusPath(R_DEAD))
  assert.equal(status.length, 1, '(c)/M3 exactly one -X PUT of status.json')
  const fields = fieldsOf(status[0])
  assert.equal(fields.branch, evidenceBranchFor(R_DEAD), '(c)/M3 on the evidence branch')
  assert.equal(fields.sha, blobSha(R_DEAD), '(c)/M3 under the sha the page was read at')
  const body = JSON.parse(decode(fields.content))
  assert.equal(body.state, 'failed', '(c)/M3 the page now says failed')
  assert.equal(body.updatedAt, NOW_ISO, '(c)/M3 as of the janitor\'s clock')
  assert.equal(body.error.includes('Result=exit-code') && body.error.includes('while the hub said open'), true,
    `(c)/M3 the error names the unit's result and that the hub had said open: ${body.error}`)
  const journal = puts(exec).filter((c) => pathOf(c.argv) === journalPath(R_DEAD))
  assert.equal(journal.length, 1, '(c)/M3 and one -X PUT of janitor-journal.txt')
  assert.equal(decode(fieldsOf(journal[0]).content), journalText(R_DEAD), '(c)/M3 carrying the journal read byte for byte')

  const closes = hub.calls.filter((c) => c.method === 'POST')
  assert.deepEqual(closes.map((c) => c.path), [`/api/v1/projects/${R_DEAD}/issues/${RUN_UID(R_DEAD)}/actions/close`],
    '(c)/M3 the hub\'s one write is the run issue\'s close, by project id and issue uid')
  const close = closes[0]
  assert.equal(close.body.reason, 'wontfix', '(c)/M3 reason wontfix')
  assert.equal(close.body.actor, 'janitor', '(c)/M3 actor janitor')
  assert.equal(close.body.retry_protocol, 'close-v1', '(c)/M3 retry_protocol close-v1, as every close carries')
  assert.equal(close.body.message.length >= 40, true, `(c)/M3 a message of forty characters or more (kata's rule): ${close.body.message}`)
  assert.equal(close.body.message.includes(`fleet-run@${R_DEAD}.service`) && close.body.message.includes('Result=exit-code'), true,
    '(c)/M3 naming the unit and its result')
  assert.equal(close.remote.includes(`-H "Idempotency-Key: janitor:run-${R_DEAD}:death"`), true,
    `(c)/M3 under the idempotency key janitor:run-${R_DEAD}:death, got ${close.remote}`)
  assert.equal(close.remote.startsWith(`${REMOTE_PREFIX}POST ${BEARER}`), true, '(c)/M3 the bearer sourced on the hub, as every request')
  assert.equal(close.argv.some((a) => String(a).includes(CANARY)) || String(close.options?.input ?? '').includes(CANARY), false,
    '(c)/M3 and the canary is nowhere')

  assert.deepEqual(result.deaths, [{ vm: vm(R_DEAD), run: R_DEAD, state: 'open', unit: DEAD, applied: true, hubClosed: true }],
    '(c)/M3 the death is reported: page written, hub closed')
  assert.deepEqual(result.actions, [], '(c)/M3 and the row is in no action: the reap is the next pass\'s')
  assert.deepEqual(exec.mutating(), [], '(c)/M3 no rm')
  assert.equal(renderJanitor(result).split('\n')[0], `death ${vm(R_DEAD)}  run=${R_DEAD} open → failed: ${Object.entries(DEAD).map(([k, v]) => `${k}=${v}`).join(' ')} — ${evidenceBranchFor(R_DEAD)} and the hub`,
    '(c)/M3 rendered as the death line, ending in `and the hub`')
}

{
  // The same death with no page anywhere: the close alone.
  const { exec, hub } = deathExec([R_DEAD_BARE], {})
  const result = await pass(exec)
  assert.deepEqual(puts(exec), [], '(c)/M3 a branch with no page draws no PUT')
  assert.deepEqual(fleetSsh(exec).map((c) => c.command.startsWith(UNIT_READ)), [true], '(c)/M3 the unit read and no journal read')
  assert.deepEqual(hub.calls.filter((c) => c.method === 'POST').map((c) => c.path),
    [`/api/v1/projects/${R_DEAD_BARE}/issues/${RUN_UID(R_DEAD_BARE)}/actions/close`], '(c)/M3 the close still lands')
  assert.deepEqual(result.deaths, [{ vm: vm(R_DEAD_BARE), run: R_DEAD_BARE, state: 'open', unit: DEAD, applied: false, hubClosed: true }],
    '(c)/M3 reported as applied false — no page was written — and hubClosed true')
}

{
  // --dry-run: the unit read, and nothing written anywhere.
  const { exec, hub } = deathExec([R_DEAD], { [branchPagePath(R_DEAD)]: { page: livePage(R_DEAD), sha: blobSha(R_DEAD) } })
  const result = await pass(exec, ['--dry-run'])
  assert.deepEqual(fleetSsh(exec).map((c) => c.command.startsWith(UNIT_READ)), [true], '(c)/M3 --dry-run reads the unit')
  assert.deepEqual(puts(exec), [], '(c)/M3 and issues no PUT')
  assert.deepEqual(hub.calls.filter((c) => c.method !== 'GET'), [], '(c)/M3 and no hub write')
  assert.deepEqual(contentsReads(exec), [], '(c)/M3 and does not even fetch the page it would not write')
  assert.deepEqual(result.deaths, [{ vm: vm(R_DEAD), run: R_DEAD, state: 'open', unit: DEAD, applied: false, hubClosed: false }],
    '(c)/M3 the death is reported unapplied')
  assert.equal(renderJanitor(result).split('\n')[0].startsWith(`would write death ${vm(R_DEAD)}  run=${R_DEAD} `), true,
    '(c)/M3 as `would write death`')
}

{
  // An hour on, the hub says the issue is closed wontfix as of the death: the ordinary reap.
  const hub = hubStub({ projects: [project(R_DEAD)], issues: { [R_DEAD]: [decoyTask(R_DEAD), closedIssue(R_DEAD, 'wontfix', NOW_ISO)] } })
  const exec = newExec([...lsRules([row(R_DEAD)]), hub.rule, ghRule({})])
  const later = await janitor({ argv: [], exec, config: CONFIG, now: () => laterBy(1.5), kataEnvPath: ENV_PATH })
  assert.deepEqual(exec.mutating(), [`rm ${vm(R_DEAD)} --json`], '(c)/M3 the closed issue is reaped an hour on, by the ordinary rule')
  assert.deepEqual(later.actions.map((a) => [a.run, a.state, a.updatedAt]), [[R_DEAD, 'wontfix', NOW_ISO]],
    '(c)/M3 as wontfix, aged from the close')
  assert.deepEqual(fleetSsh(exec), [], '(c)/M3 and a closed issue draws no unit read')
}

// ═══════════════════════════════════════════════════════════════════════════
// (d) no env file, and no hub at all [M4]
// ═══════════════════════════════════════════════════════════════════════════
{
  const exec = newExec([...lsRules(FLEET), DARK_RULE, UNITS, ghRule(PAGES)])
  const result = await janitor({ argv: [], exec, config: CONFIG, now: () => NOW, kataEnvPath: ABSENT_ENV })
  assert.equal(hubSsh(exec).length, 0, '(d)/M4 with no env file no hub is asked')
  assert.equal(result.hub.host, null, '(d)/M4 there is no host')
  assert.equal(result.hub.dark.includes(`no kata hub env at ${ABSENT_ENV}`) && result.hub.dark.includes('node fleet/kata-hub.mjs'), true,
    `(d)/M4 hub.dark names the path and the command that writes it: ${result.hub.dark}`)
  assert.deepEqual(decision(exec, result), decision(LIT.exec, LIT.result), '(d)/M4 and the decision is the lit hub\'s, read off the target')
  assert.equal(renderJanitor(result).split('\n')[0].startsWith('hub none unreachable (no kata hub env at '), true,
    '(d)/M4 the report opens with the hub line')

  const told = newExec([...lsRules(FLEET), DARK_RULE, UNITS, ghRule(PAGES)])
  const toldResult = await janitor({ argv: [], exec: told, config: CONFIG, now: () => NOW, kata: null })
  assert.equal(hubSsh(told).length, 0, '(d)/M4 kata: null asks no hub')
  assert.equal(toldResult.hub, null, '(d)/M4 and answers hub null')
  assert.equal(renderJanitor(toldResult).split('\n').some((l) => l.startsWith('hub ')), false, '(d)/M4 printing no hub line')
  assert.deepEqual(decision(told, toldResult), decision(LIT.exec, LIT.result), '(d)/M4 with the same decision')
}

cleanup(HOME)

// ── (e) ─────────────────────────────────────────────────────────────────────
console.log('ALL TESTS PASSED')

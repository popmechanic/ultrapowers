/**
 * fleet/tests/test_janitor_state_key.mjs — the exam for Task 2: *the janitor
 * reads a run's finish from the state key*.
 *
 * This file is the Proof's `Test:` and its `Guard:`, written where the Proof
 * names it. Every relative import is written for THIS directory: `../` is the
 * repository's `fleet/`, `./` is `fleet/tests/`.
 *
 * The claim (#964): the janitor reads a run's finish from that `work.state`
 * key (any of `done|parked|failed`) or from `closed`, never from `open` alone,
 * so a parked run's VM is reaped an hour after the park like any other.
 *
 * The rig is the sibling sim's — `makeExec` over `ssh`/`gh`, `ls` and `rm`
 * canned as lobby verbs, a unit answer per VM, and a stub hub: one rule over
 * `ssh <KATA_URL host> <remote>` that reads the method and the path out of the
 * remote `curl` line and answers what kata answers, `<json>\n<status>`. It is
 * copied rather than imported because that file is a script, not a module.
 * Nothing here opens a socket, spawns a process or reads a path outside the
 * checkout and `os.tmpdir()`; the `KATA_TOKEN` in the env file is a canary.
 *
 * The legs, and what each asserts — every assertion below names its leg and the
 * Machine clause it comes from, so a reader can map this file back to the
 * contract:
 *
 *   (a) [M1] For each of `done`, `parked`, `failed`: a fake hub answering an
 *       `open` run issue whose `metadata['work.state']` is that value, updated
 *       two hours ago, makes the janitor's reading `finished: true` with
 *       `state` that value and `updatedAt` the issue's `updated_at` — read
 *       here off the pass's own action row, since `readingOfIssue` is not
 *       exported — and the pass's mutating lobby verbs carry
 *       `rm <vm> --json` for that VM. The key is the FLAT `'work.state'` kata
 *       stores (#960): a reader of `metadata.work.state` finds nothing here
 *       and reaps nothing. M1's reading is also `live: false`, which is
 *       visible as the one thing a non-live row never draws: a unit read.
 *   (b) [M2] The rows that are read as before: an `open` issue with no
 *       `work.state` key updated seven hours ago is `finished: false` — in no
 *       action, no `rm` for its VM — and is the pass's one `stale` row, aged
 *       from `updated_at` and `from` `kata:<project>`; a `closed` issue with
 *       `closed_reason: 'done'` reads `state: 'done'` and is aged from
 *       `closed_at` (its `updated_at` is five minutes old here, so a reader
 *       that aged it from `updated_at` would not reap it at all).
 *   (c) [M3] A dead unit with an open hub row writes the death to the hub as
 *       ONE hub request that writes — the pass's two GET reads are the
 *       ordinary read path of (a) — a `POST` whose URL ends
 *       `/issues/<run uid>/metadata`, whose body deep-equals
 *       `{actor: 'janitor', patch: {'work.state': 'failed',
 *       'work.attention': 'needs-human', 'work.attention_msg': <the death
 *       error>}}` and whose remote carries
 *       `Idempotency-Key: janitor:run-<N>:death`; no request's URL ends
 *       `/actions/close`; the death row reads `hubMarked: true` and carries no
 *       `hubClosed` (the report flag is renamed, not doubled). *The death
 *       error* is the one string the janitor writes for this death: the page's
 *       own `error` cell, which the unchanged branch write puts on the status
 *       page — this leg reads that cell and asserts the patch carries exactly
 *       it, and separately that it names the unit, its result and what the hub
 *       had said, so the check cannot be met by an empty string.
 *   (d) [M4] `fleet/CONTRACT.md`'s janitor bullet — the `- **Janitor (…)**`
 *       bullet alone, up to the next top-level bullet, read as one line —
 *       matches `closed.*or.*work\.state.*done\|parked\|failed` and
 *       `death.*work\.state.*failed`, names the other two of the three keys,
 *       and no longer matches `wontfix. close of the run issue under`. Only
 *       that bullet is read: the boot's bullets in the same file are a sibling
 *       task's, and this exam runs in a clone where they are untouched.
 */

import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { evidenceBranchFor, kataProjectFor } from '../lobby.mjs'
import { janitor } from '../janitor.mjs'
import {
  answer, cleanup, cmdRule, makeExec, sshRule, tempDir, vmRow, vmRule, vmsPayload
} from './_lobby_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const NOW = new Date('2026-09-12T12:00:00.000Z')
const NOW_ISO = NOW.toISOString()
const minutesAgo = (m) => new Date(NOW.getTime() - m * 60000).toISOString()
const hoursAgo = (h) => minutesAgo(h * 60)

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
const HOME = tempDir('fleet-janitor-state-key-')
const ENV_PATH = path.join(HOME, 'kata-hub.env')
fs.writeFileSync(ENV_PATH, `KATA_URL=https://${HUB_HOST}\nKATA_TOKEN=${CANARY}\n`)

/** The remote's prefix: the bearer sourced on the hub, the token never here. */
const REMOTE_PREFIX = 'set -a; . /etc/kata/kata.env; exec curl -sS -X '
const BEARER = '-H "Authorization: Bearer $KATA_AUTH_TOKEN"'

const project = (n) => ({ id: n, uid: `P${n}`, name: kataProjectFor(TARGET, n), metadata: {}, revision: 1 })
const RUN_UID = (n) => `U${n}`
const baseMetadata = (n) => ({ run: n, target: TARGET, base: SHA, closes: [] })
const openIssue = (n, at, extra = {}) => ({
  id: 100 + n, uid: RUN_UID(n), project_id: n, title: `run-${n}: a plan`, status: 'open',
  metadata: { ...baseMetadata(n), ...extra },
  revision: 1, created_at: hoursAgo(9), updated_at: at
})
const closedIssue = (n, reason, at, updatedAt) => ({
  id: 100 + n, uid: RUN_UID(n), project_id: n, title: `run-${n}: a plan`, status: 'closed',
  closed_reason: reason, metadata: baseMetadata(n),
  revision: 2, created_at: hoursAgo(9), updated_at: updatedAt ?? at, closed_at: at
})
/** A task issue, closed long ago, listed FIRST — the run issue is the one whose
 *  `metadata.run` is N, and this row is here so that stays true. */
const decoyTask = (n) => ({
  id: 200 + n, uid: `T${n}`, project_id: n, title: 'task 1: one', status: 'closed',
  closed_reason: 'done', metadata: { task: '1', wave: 1 }, revision: 2,
  created_at: hoursAgo(9), updated_at: hoursAgo(8), closed_at: hoursAgo(8)
})

const hubAnswer = (json, status = 200) => answer(`${JSON.stringify(json)}\n${status}`)

/**
 * The stub hub: one rule over `ssh … hub.test <remote>`, answering by the
 * method and path it reads out of the remote curl line. Every call is recorded
 * with its parsed body (the stdin the transport handed the seam). It answers
 * BOTH writes — the metadata patch and the close — so a pass that still closes
 * is reported by the assertions and not by a hub error.
 */
function hubStub ({ projects = [], issues = {} } = {}) {
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
      const patching = /^\/api\/v1\/projects\/(\d+)\/issues\/([^/]+)\/metadata$/.exec(p)
      if (method === 'POST' && patching) {
        return hubAnswer({
          issue: {
            uid: patching[2], revision: 2, status: 'open', project_id: Number(patching[1]),
            metadata: { ...baseMetadata(Number(patching[1])), ...(body?.patch ?? {}) }
          }
        })
      }
      const closing = /^\/api\/v1\/projects\/(\d+)\/issues\/([^/]+)\/actions\/close$/.exec(p)
      if (method === 'POST' && closing) {
        return hubAnswer({ issue: { uid: closing[2], revision: 2, status: 'closed', closed_reason: body?.reason ?? null } })
      }
      return hubAnswer({ status: 404, error: { code: 'not_found' } }, 404)
    }
  }
  return { rule, calls }
}

// ── The evidence and the VMs, as the sibling sim cans them ──────────────────

const statusPath = (n) => `repos/${TARGET}/contents/.ultrapowers/runs/${n}/status.json`
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
const sorted = (xs) => [...xs].sort()
const newExec = (rules) => makeExec({ rules, passthrough: [] })
const pass = (exec, argv = []) => janitor({ argv, exec, config: CONFIG, now: () => NOW, kataEnvPath: ENV_PATH })
const actionFor = (result, run) => result.actions.find((a) => a.run === run) ?? null

// ═══════════════════════════════════════════════════════════════════════════
// (a) the state key is the finish [M1]  and  (b) the rows read as before [M2]
// ═══════════════════════════════════════════════════════════════════════════

/** One row per value of the state key, the same three words `REAPABLE_STATES` has. */
const STATE_ROWS = [{ run: 3, value: 'done' }, { run: 4, value: 'parked' }, { run: 5, value: 'failed' }]
const R_CLOSED = 7 // closed done, closed two hours ago, commented on five minutes ago
const R_OPEN = 10 // open, no work.state, updated seven hours ago, unit alive: stale
const KEY_UPDATED_AT = hoursAgo(2)
const CLOSED_AT = hoursAgo(2)
const CLOSED_UPDATED_AT = minutesAgo(5)

const READ_RUNS = [...STATE_ROWS.map((r) => r.run), R_CLOSED, R_OPEN]
const FLEET = READ_RUNS.map(row)
const HUB_DATA = {
  projects: READ_RUNS.map(project),
  issues: {
    ...Object.fromEntries(STATE_ROWS.map(({ run, value }) => [
      run,
      // The FLAT key kata stores (#960) — never a nested `work: {state}`.
      [decoyTask(run), openIssue(run, KEY_UPDATED_AT, { 'work.state': value })]
    ])),
    [R_CLOSED]: [decoyTask(R_CLOSED), closedIssue(R_CLOSED, 'done', CLOSED_AT, CLOSED_UPDATED_AT)],
    [R_OPEN]: [decoyTask(R_OPEN), openIssue(R_OPEN, hoursAgo(7))]
  }
}
const UNITS = vmAnswers({ [dest(R_OPEN)]: () => answer(unitText(ALIVE)) })

{
  const hub = hubStub(HUB_DATA)
  const exec = newExec([...lsRules(FLEET), hub.rule, UNITS, ghRule({})])
  const result = await pass(exec)
  const mutating = exec.mutating()

  // ── (a) one row per value of the key ──────────────────────────────────────
  for (const { run, value } of STATE_ROWS) {
    const action = actionFor(result, run)
    assert.notEqual(action, null,
      `(a)/M1 an open run issue whose metadata['work.state'] is ${JSON.stringify(value)}, updated two hours ago, is a finished run older than --age: run ${run} is reaped, and the janitor read the flat key kata stores`)
    assert.deepEqual([action.state, action.updatedAt], [value, KEY_UPDATED_AT],
      `(a)/M1 the reading's state is that value and its updatedAt the issue's updated_at, for ${JSON.stringify(value)}`)
    assert.deepEqual([action.kind, action.applied], ['rm', true],
      `(a)/M1 and the row is an applied rm, for ${JSON.stringify(value)}`)
    assert.equal(mutating.includes(`rm ${vm(run)} --json`), true,
      `(a)/M1 the pass's mutating verbs include rm ${vm(run)} --json, for ${JSON.stringify(value)} — got ${JSON.stringify(mutating)}`)
  }

  // ── (b) the closed issue, read exactly as before ──────────────────────────
  const closed = actionFor(result, R_CLOSED)
  assert.notEqual(closed, null,
    '(b)/M2 a closed issue is a finished run as before, and this one closed two hours ago is reaped')
  assert.deepEqual([closed.state, closed.updatedAt], ['done', CLOSED_AT],
    "(b)/M2 a closed issue reads closed_reason as its state and is aged from closed_at, not from the updated_at a later comment moved")

  // ── (b) the open issue with no key: unfinished, stale, never removed ──────
  assert.equal(actionFor(result, R_OPEN), null,
    '(b)/M2 an open issue with no work.state key is finished: false — it is in no action')
  assert.deepEqual(result.stale, [{
    vm: vm(R_OPEN), run: R_OPEN, state: 'open', lastUpdate: hoursAgo(7), from: `kata:${kataProjectFor(TARGET, R_OPEN)}`
  }], '(b)/M2 it is the pass\'s one stale row, state open, aged from updated_at, from kata:<project>')
  assert.equal(mutating.includes(`rm ${vm(R_OPEN)} --json`), false,
    `(b)/M2 and no rm is issued for it — got ${JSON.stringify(mutating)}`)

  // ── the whole verdict, so nothing else moved ──────────────────────────────
  assert.deepEqual(sorted(mutating), sorted([...STATE_ROWS.map((r) => r.run), R_CLOSED].map((n) => `rm ${vm(n)} --json`)),
    '(a)/M1 (b)/M2 the pass\'s mutating lobby verbs are exactly the three state-key rows and the closed row')
  assert.deepEqual(result.deaths, [], '(a)/M1 (b)/M2 no unit here is dead')

  // ── the reading of a finished row is live: false, and a non-live row is
  //    never probed at its unit ───────────────────────────────────────────────
  assert.deepEqual(fleetSsh(exec).map((c) => c.dest), [dest(R_OPEN)],
    '(a)/M1 a row whose work.state says finished is live: false and draws no unit read; only the open, keyless row is probed')
  assert.equal(fleetSsh(exec).every((c) => c.command.startsWith(UNIT_READ)), true,
    '(b)/M2 and that one read is the unit read')
}

// ═══════════════════════════════════════════════════════════════════════════
// (c) a death is written as the three keys, not a close [M3]
// ═══════════════════════════════════════════════════════════════════════════

const R_DEAD = 30
const DEAD_SHA = '3'.repeat(40)
const livePage = (n) => ({
  run: n, state: 'running', phase: 'implement', pr: null, branch: `ultra/integration-run-${n}`,
  vm: vm(n), startedAt: minutesAgo(90), updatedAt: minutesAgo(1)
})
const journalText = (n) => `-- journal for fleet-run@${n}.service --\n${vm(n)} run[${n}]: engine exited\n`
const deadUnits = (ns) => vmAnswers(Object.fromEntries(ns.map((n) => [dest(n), (command) =>
  (command.startsWith(JOURNAL_READ) ? answer(journalText(n)) : answer(unitText(DEAD)))])))

{
  const hub = hubStub({
    projects: [project(R_DEAD)],
    issues: { [R_DEAD]: [decoyTask(R_DEAD), openIssue(R_DEAD, minutesAgo(1))] }
  })
  const exec = newExec([
    ...lsRules([row(R_DEAD)]), hub.rule, deadUnits([R_DEAD]),
    ghRule({ [branchPagePath(R_DEAD)]: { page: livePage(R_DEAD), sha: DEAD_SHA } })
  ])
  const result = await pass(exec)

  // The death error: the one string this death writes. The page write is the
  // unchanged part of writeDeath, read here only to name that string.
  const status = puts(exec).filter((c) => pathOf(c.argv) === statusPath(R_DEAD))
  assert.equal(status.length, 1,
    '(c)/M3 the death still writes the page on the evidence branch — its error cell is the death error M3 names')
  const written = JSON.parse(decode(fieldsOf(status[0]).content))
  const deathError = written.error
  assert.equal(typeof deathError === 'string' && deathError.length > 0, true,
    `(c)/M3 the death error is a string, got ${JSON.stringify(deathError)}`)
  assert.equal(
    deathError.includes(`fleet-run@${R_DEAD}.service`) &&
    deathError.includes('Result=exit-code') &&
    deathError.includes('while the hub said open'), true,
    `(c)/M3 naming the unit, its result and what the hub had said: ${deathError}`)
  assert.deepEqual([written.state, written.updatedAt], ['failed', NOW_ISO],
    '(c)/M3 and the page says failed as of the janitor\'s clock, as before')

  // ── the one hub write ─────────────────────────────────────────────────────
  const writes = hub.calls.filter((c) => c.method !== 'GET')
  assert.deepEqual(writes.map((c) => c.path), [`/api/v1/projects/${R_DEAD}/issues/${RUN_UID(R_DEAD)}/metadata`],
    '(c)/M3 the death is exactly one hub request that writes, a POST whose URL ends /issues/<run uid>/metadata — the pass\'s GETs are the ordinary read path')
  const patch = writes[0]
  assert.equal(patch.method, 'POST', '(c)/M3 a POST')
  assert.deepEqual(patch.body, {
    actor: 'janitor',
    patch: {
      'work.state': 'failed',
      'work.attention': 'needs-human',
      'work.attention_msg': deathError
    }
  }, '(c)/M3 whose body deep-equals {actor: janitor, patch: {work.state: failed, work.attention: needs-human, work.attention_msg: <the death error>}} — the flat spellings kata stores')
  assert.equal(patch.remote.includes(`-H "Idempotency-Key: janitor:run-${R_DEAD}:death"`), true,
    `(c)/M3 under Idempotency-Key: janitor:run-${R_DEAD}:death, got ${patch.remote}`)
  assert.equal(patch.remote.startsWith(`${REMOTE_PREFIX}POST ${BEARER}`), true,
    `(c)/M3 travelling the same ssh-curl seam as every other request, the bearer sourced on the hub: ${patch.remote}`)
  assert.equal(patch.argv.some((a) => String(a).includes(CANARY)) || String(patch.options?.input ?? '').includes(CANARY), false,
    '(c)/M3 and the canary is nowhere')
  assert.deepEqual(hub.calls.filter((c) => c.path.endsWith('/actions/close')).map((c) => `${c.method} ${c.path}`), [],
    '(c)/M3 and no request whose URL ends /actions/close is made — the death is a mark, not a wontfix close')

  // ── the report row ────────────────────────────────────────────────────────
  assert.equal(result.deaths.length, 1, '(c)/M3 one death is reported')
  const death = result.deaths[0]
  assert.equal(death.hubMarked, true,
    `(c)/M3 the death row reads hubMarked: true, got ${JSON.stringify(death)}`)
  assert.equal(Object.hasOwn(death, 'hubClosed'), false,
    `(c)/M3 and carries no hubClosed: the report flag is renamed, not doubled — got ${JSON.stringify(death)}`)
  assert.deepEqual([death.vm, death.run, death.state, death.applied], [vm(R_DEAD), R_DEAD, 'open', true],
    '(c)/M3 for the dead unit\'s own row, whose page was written')
  assert.deepEqual(exec.mutating(), [],
    '(c)/M3 and no rm: the reap is the next pass\'s, an hour on')
  assert.deepEqual(fleetSsh(exec).map((c) => c.dest), [dest(R_DEAD), dest(R_DEAD)],
    '(c)/M3 the unit read and the journal read, both at the row\'s own ssh_dest')
}

// ═══════════════════════════════════════════════════════════════════════════
// (d) the contract's janitor bullet [M4]
// ═══════════════════════════════════════════════════════════════════════════
{
  const contract = fs.readFileSync(path.join(HERE, '..', 'CONTRACT.md'), 'utf8').split('\n')
  const start = contract.findIndex((l) => l.startsWith('- **Janitor ('))
  assert.notEqual(start, -1, '(d)/M4 fleet/CONTRACT.md carries a `- **Janitor (…)**` bullet')
  let end = start + 1
  while (end < contract.length && !contract[end].startsWith('- **')) end += 1
  // Read as one line: the bullet wraps mid-sentence, and only this bullet is
  // read — the boot's bullets in the same file are a sibling task's.
  const bullet = contract.slice(start, end).join(' ').replace(/\s+/g, ' ')

  assert.match(bullet, /closed.*or.*work\.state.*done\|parked\|failed/,
    '(d)/M4 the janitor bullet says a run issue `closed` OR carrying `work.state` in `done|parked|failed` is a finished run')
  assert.match(bullet, /death.*work\.state.*failed/,
    '(d)/M4 and that a death is written as work.state failed')
  assert.equal(bullet.includes('work.attention_msg'), true,
    '(d)/M4 naming the third of the three keys, work.attention_msg')
  assert.equal(bullet.includes('work.attention'), true,
    '(d)/M4 and the second, work.attention')
  assert.doesNotMatch(bullet, /wontfix. close of the run issue under/,
    '(d)/M4 and no longer says the death is a `wontfix` close of the run issue')
}

cleanup(HOME)

console.log('ALL TESTS PASSED')

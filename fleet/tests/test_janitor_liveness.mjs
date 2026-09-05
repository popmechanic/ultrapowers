/**
 * fleet/tests/test_janitor_liveness.mjs — the janitor reads the unit and writes the death.
 *
 * When a sandbox's run unit has failed while its status page still says the run
 * is in flight, the janitor writes `failed` into the run's record with the
 * unit's result and the journal tail beside it; a unit still running is left
 * alone. Every read and every write here goes through the recording exec seam:
 * one `ls 'fleet-r*' --json` through the lobby, `gh api` on the laptop, and — new
 * with this clause — one `ssh <ssh_dest> <one command>` per live row.
 *
 * What is pinned, clause by clause:
 *
 *   M1 — exactly one unit read per row whose evidence page says
 *        `booting|running|publishing`, at the row's own `ssh_dest`, with the
 *        `systemctl --user show fleet-run@<N>.service` literal; a `done`,
 *        `parked` or `failed` page, a 404 and an unreadable assignment draw
 *        none                                                          — leg (a)
 *   M2 — a dead unit draws exactly one `gh api -X PUT …/status.json` carrying
 *        `branch=`, the read envelope's `sha=`, a `message=` and a `content=`
 *        decoding to the page as read with `state` `failed`, `updatedAt` the
 *        injected clock and `error` naming the unit's result and the state the
 *        page had said                                                 — leg (b)
 *   M3 — beside it one `journalctl _SYSTEMD_USER_UNIT=…` read to the same
 *        destination and one `gh api -X PUT …/janitor-journal.txt` whose
 *        `content=` is that read's stdout byte for byte, with no `sha=`
 *                                                                      — leg (c)
 *   M4 — the death is reported in `deaths` and printed by `renderJanitor`, the
 *        writing pass reaps nothing, and the next pass an hour on reaps the
 *        `failed` page by the ordinary rule                            — leg (d)
 *   M5 — a live unit, an unreadable unit and an empty answer write nothing,
 *        journal nothing, kill nothing, and leave the row exactly as at BASE;
 *        no `git` is ever run                                          — leg (e)
 *   M6 — `--dry-run` reads the unit, writes nothing, and says `applied: false`
 *                                                                      — leg (f)
 *   M1–M6 — the sim prints `ALL TESTS PASSED`                          — leg (g)
 */

import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'

import { evidenceBranchFor, planBranchFor } from '../lobby.mjs'
import { janitor, renderJanitor } from '../janitor.mjs'
import {
  answer, cmdRule, makeExec, sshRule, vmRow, vmRule, vmsPayload
} from './_lobby_helpers.mjs'

const NOW = new Date('2026-09-05T12:00:00.000Z')
const NOW_ISO = NOW.toISOString()
const minutesAgo = (m) => new Date(NOW.getTime() - m * 60000).toISOString()
const hoursAgo = (h) => minutesAgo(h * 60)
const laterBy = (h) => new Date(NOW.getTime() + h * 60 * 60 * 1000)

const TARGET = 'acme/widgets'
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
/** The config file's whole surface: two keys, `cpu` and `memory`. */
const CONFIG = { cpu: '8', memory: '16GB' }

const vm = (n) => `fleet-r${n}-2609050900-a1b2`
/** `vmRow` sets `ssh_dest` to `exedev@<name>.ssh.exe.xyz`, deliberately not
 *  `<name>.exe.xyz`: a janitor deriving the destination from the name is caught
 *  by every equality on `dest` below. */
const dest = (n) => `exedev@${vm(n)}.ssh.exe.xyz`
const comment = (run, target = TARGET) =>
  `run=${run} plan=${SHA} target=${target} base=${SHA} engine=${SHA}`
/** One `ls` row for run N, carrying the assignment comment the launcher set. */
const row = (n) => vmRow(vm(n), { comment: comment(n) })

// ── The literals the contract names ─────────────────────────────────────────

/** The unit read, one argv element after the destination. `$(id -u)` is the
 *  VM's shell's, so it travels as text. */
const unitCommand = (n) =>
  `XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user show fleet-run@${n}.service` +
  ' -p ActiveState -p SubState -p Result -p ExecMainStatus'
/** The journal read — `fleet/CONTRACT.md`, "Logs without an env var". */
const journalCommand = (n) =>
  `journalctl _SYSTEMD_USER_UNIT=fleet-run@${n}.service --no-pager -n 200`

const statusPath = (n, target = TARGET) =>
  `repos/${target}/contents/.ultrapowers/runs/${n}/status.json`
const evidencePath = (n, target = TARGET) =>
  `${statusPath(n, target)}?ref=${evidenceBranchFor(n)}`
const journalPath = (n, target = TARGET) =>
  `repos/${target}/contents/.ultrapowers/runs/${n}/janitor-journal.txt`
const planPath = (n, target = TARGET) => `repos/${target}/branches/${planBranchFor(n)}`

// ── The `gh api` seam: a contents GET, and the contents PUT ─────────────────

/** What `gh api` prints for an absent file: exit 1, `HTTP 404` on stderr. */
const NOT_FOUND = answer('', { code: 1, stderr: 'gh: Not Found (HTTP 404)' })

/** A distinct blob sha per run — what the PUT must echo back as `sha=`. */
const blobSha = (n) => String(n).repeat(20).slice(0, 40)

/** The contents envelope: the status page base64 under `content`, beside the
 *  blob `sha` of the file as it sits on the branch. */
const envelope = (status, sha) => answer({
  path: '.ultrapowers/runs/x/status.json',
  content: Buffer.from(JSON.stringify(status), 'utf8').toString('base64'),
  encoding: 'base64',
  sha
})

/** The branch document, of which only the committer date is read. */
const branchDoc = (date) => answer({ commit: { commit: { committer: { date } } } })

/** What the contents API answers a successful PUT. */
const PUT_OK = answer({
  content: { sha: 'f'.repeat(40) },
  commit: { sha: 'e'.repeat(40) }
})

/**
 * `gh api` answers the canned paths and 404s everything else, so a read at the
 * wrong path cannot look like a read at the right one. A call carrying `-X` is
 * a write: it is answered like the contents API answers 200/201, and it is
 * `exec.calls` that records it.
 */
const ghRule = ({ evidence = {}, shas = {}, plans = {} } = {}) =>
  cmdRule('gh', 'api', (cmd, argv) => {
    if (argv.includes('-X')) return PUT_OK
    const p = argv.find((a) => typeof a === 'string' && a.startsWith('repos/'))
    if (p !== undefined && Object.hasOwn(evidence, p)) return envelope(evidence[p], shas[p])
    if (p !== undefined && Object.hasOwn(plans, p)) return branchDoc(plans[p])
    return NOT_FOUND
  })

/** `ls '<pattern>'` answers the rows whose names match — what the server does. */
const lsRules = (fleet) => [
  sshRule('ls ', (cmd, argv) => {
    const pattern = /^ls '([^']+)'/.exec(argv[1])[1]
    const re = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`)
    return vmsPayload(fleet.filter((r) => re.test(r.vm_name)))
  }),
  sshRule('rm ', answer(''))
]

// ── The VM seam: one canned answer per destination ──────────────────────────

/** The ssh arguments after the `-o` options — `_lobby_helpers`' own reading. */
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

/** `systemctl show` prints one `key=value` per line. */
const unitText = (unit) =>
  `${Object.entries(unit).map(([k, v]) => `${k}=${v}`).join('\n')}\n`

/** A rule answering per destination; an unruled destination answers empty and
 *  green, which is exactly what `makeExec({ passthrough: [] })` does anyway. */
const vmAnswers = (byDest) => vmRule((cmd, argv) => {
  const call = afterOptions(argv)
  const handler = byDest[call.dest]
  return handler === undefined ? answer('') : handler(call.command)
})

// ── Readers over the recording seam ─────────────────────────────────────────

/** Every exec this exam built, so leg (e)'s "no git" covers every leg. */
const EXECS = []
const newExec = (rules) => {
  // passthrough: [] — no command in this exam ever really runs.
  const exec = makeExec({ rules, passthrough: [] })
  EXECS.push(exec)
  return exec
}

const ghCalls = (exec) => exec.calls.filter((c) => c.cmd === 'gh')
const pathOf = (argv) => argv.find((a) => typeof a === 'string' && a.startsWith('repos/'))
/** Every `gh` call spelled as a write: `-X` immediately followed by `PUT`. */
const puts = (exec) => ghCalls(exec).filter((c) => {
  const i = c.argv.indexOf('-X')
  return i !== -1 && c.argv[i + 1] === 'PUT'
})
const putsTo = (exec, apiPath) => puts(exec).filter((c) => pathOf(c.argv) === apiPath)
/** The `-f key=value` fields of one call, split on the first `=`. */
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
const unitReads = (exec) => exec.vm().filter((c) => c.command.startsWith('XDG_RUNTIME_DIR='))
const journalReads = (exec) => exec.vm().filter((c) => c.command.startsWith('journalctl'))
const byDest = (calls) => [...calls].sort((a, b) => (a.dest < b.dest ? -1 : 1))
const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]))
/**
 * `unit` as the janitor recorded it, with keys it spelled `undefined` dropped:
 * a parser that skips an absent `SubState` line and one that sets the key to
 * `undefined` are the same reading of "as read", and M4 is about the four
 * values, not that spelling. Every *defined* key still has to match.
 */
const definedUnit = (unit) =>
  Object.fromEntries(Object.entries(unit ?? {}).filter(([, v]) => v !== undefined))
const deathsByRun = (result) => [...(result.deaths ?? [])]
  .sort((a, b) => a.run - b.run)
  .map((d) => ({ ...d, unit: definedUnit(d.unit) }))

// ── A run's status page: what rides through the write untouched ─────────────

const page = (n, state, updatedAt) => ({
  run: n,
  state,
  phase: 'implement',
  pr: `https://github.com/${TARGET}/pull/${100 + n}`,
  prAuthor: 'fleet',
  merged: false,
  branch: `ultra/run-${n}`,
  vm: vm(n),
  startedAt: minutesAgo(90),
  updatedAt
})
/** The five cells M2 pins unchanged across the write. */
const CARRIED = ['run', 'pr', 'branch', 'vm', 'startedAt']

// ═══════════════════════════════════════════════════════════════════════════
// (a) exactly one unit read, and only for a live page [M1]
// ═══════════════════════════════════════════════════════════════════════════

const ALIVE = { ActiveState: 'active', SubState: 'running', Result: 'success', ExecMainStatus: '0' }

{
  // Three live rows, each a minute old, each with its own ssh_dest; then a
  // `done` row two hours old, a `parked` row, a `failed` row, a row whose
  // evidence answers 404, and a row with no comment at all.
  const LIVE = [[31, 'booting'], [32, 'running'], [33, 'publishing']]
  const QUIET = [[34, 'done', hoursAgo(2)], [35, 'parked', minutesAgo(30)], [36, 'failed', minutesAgo(30)]]
  const fleet = [
    ...LIVE.map(([n]) => row(n)),
    ...QUIET.map(([n]) => row(n)),
    row(37), // no evidence: 404
    vmRow(vm(38)) // no comment: no readable assignment
  ]
  const evidence = Object.fromEntries([
    ...LIVE.map(([n, state]) => [evidencePath(n), page(n, state, minutesAgo(1))]),
    ...QUIET.map(([n, state, at]) => [evidencePath(n), page(n, state, at)])
  ])
  const exec = newExec([
    ...lsRules(fleet),
    ghRule({ evidence, plans: { [planPath(37)]: hoursAgo(3) } }),
    vmAnswers(Object.fromEntries(fleet.map((r) => [r.ssh_dest, () => answer(unitText(ALIVE))])))
  ])
  await janitor({ argv: [], exec, config: CONFIG, now: () => NOW })

  assert.deepEqual(
    byDest(exec.vm()),
    byDest(LIVE.map(([n]) => ({ dest: dest(n), command: unitCommand(n) }))),
    '(a)/M1 exactly three ssh commands, one per live row: the destination is the row\'s own ssh_dest field and the remote command is the `XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user show fleet-run@<N>.service -p ActiveState -p SubState -p Result -p ExecMainStatus` literal with that row\'s N'
  )
  assert.equal(exec.vm().length, 3,
    '(a)/M1 exactly one ssh per live row — a page in booting|running|publishing is read once, not twice')

  const dests = exec.vm().map((c) => c.dest)
  assert.equal(dests.includes(dest(34)), false,
    '(a)/M1 the `done` row (run 34) draws no ssh <ssh_dest> command: a finished page has nothing to cross-check')
  assert.equal(dests.includes(dest(35)), false,
    '(a)/M1 the `parked` row (run 35) draws no ssh <ssh_dest> command')
  assert.equal(dests.includes(dest(36)), false,
    '(a)/M1 the `failed` row (run 36) draws no ssh <ssh_dest> command')
  assert.equal(dests.includes(dest(37)), false,
    '(a)/M1 the row whose evidence answers 404 (run 37) draws no ssh <ssh_dest> command: there is no page to transition')
  assert.equal(dests.includes(dest(38)), false,
    '(a)/M1 the row with no readable assignment (run 38) draws no ssh <ssh_dest> command')
}

// ═══════════════════════════════════════════════════════════════════════════
// (b) the death is written [M2]   (c) the journal beside it [M3]
// (d) the death is reported, and reaped only by the ordinary rule [M4]
// ═══════════════════════════════════════════════════════════════════════════

/** Three dead rows: a failed unit, a timed-out unit, and a unit that went away
 *  over the budget. Each carries a distinct envelope sha. */
const DEAD = [
  {
    n: 41,
    state: 'running',
    unit: { ActiveState: 'failed', SubState: 'failed', Result: 'exit-code', ExecMainStatus: '1' }
  },
  {
    n: 42,
    state: 'publishing',
    unit: { ActiveState: 'failed', Result: 'timeout', ExecMainStatus: '15' }
  },
  {
    n: 43,
    state: 'booting',
    unit: { ActiveState: 'inactive', SubState: 'dead', Result: 'timeout', ExecMainStatus: '0' }
  }
]
const journalText = (n) =>
  `-- journal for fleet-run@${n}.service --\nSep 05 11:58:01 ${vm(n)} run[${n}]: boot ok\n` +
  `Sep 05 11:59:02 ${vm(n)} run[${n}]: engine exited\n`

const DEAD_FLEET = DEAD.map(({ n }) => row(n))
const DEAD_PAGES = Object.fromEntries(DEAD.map(({ n, state }) => [n, page(n, state, minutesAgo(1))]))
const deadExec = () => newExec([
  ...lsRules(DEAD_FLEET),
  ghRule({
    evidence: Object.fromEntries(DEAD.map(({ n }) => [evidencePath(n), DEAD_PAGES[n]])),
    shas: Object.fromEntries(DEAD.map(({ n }) => [evidencePath(n), blobSha(n)]))
  }),
  vmAnswers(Object.fromEntries(DEAD.map(({ n, unit }) => [
    dest(n),
    (command) => (command.startsWith('journalctl') ? answer(journalText(n)) : answer(unitText(unit)))
  ])))
])

const wet = deadExec()
const wetResult = await janitor({ argv: [], exec: wet, config: CONFIG, now: () => NOW })

/** The page each status PUT carried, per run — leg (d)'s second pass reads it back. */
const WRITTEN = {}

for (const { n, state, unit } of DEAD) {
  // ── (b) the status write [M2] ─────────────────────────────────────────────
  const written = putsTo(wet, statusPath(n))
  assert.equal(written.length, 1,
    `(b)/M2 run ${n}: exactly one gh call has -X followed by PUT and the path ${statusPath(n)}`)
  const fields = fieldsOf(written[0])
  assert.equal(fields.branch, evidenceBranchFor(n),
    `(b)/M2 run ${n}: the write carries -f branch=${evidenceBranchFor(n)}`)
  assert.equal(fields.sha, blobSha(n),
    `(b)/M2 run ${n}: the write carries -f sha=<the sha of the contents envelope the page was read from>`)
  assert.equal(typeof fields.message, 'string',
    `(b)/M2 run ${n}: the write carries an -f message= field`)
  assert.equal(typeof fields.content, 'string',
    `(b)/M2 run ${n}: the write carries an -f content=<base64> field`)

  const body = JSON.parse(decode(fields.content))
  WRITTEN[n] = body
  assert.equal(body.state, 'failed',
    `(b)/M2 run ${n}: the content decodes to the page as read with state failed`)
  assert.equal(body.updatedAt, NOW_ISO,
    `(b)/M2 run ${n}: with updatedAt the janitor's clock as ISO-8601`)
  assert.equal(typeof body.error, 'string',
    `(b)/M2 run ${n}: and an error string`)
  assert.equal(body.error.includes(`Result=${unit.Result}`), true,
    `(b)/M2 run ${n}: the error contains Result=${unit.Result}, the unit's own Result`)
  assert.equal(body.error.includes(`ExecMainStatus=${unit.ExecMainStatus}`), true,
    `(b)/M2 run ${n}: the error contains ExecMainStatus=${unit.ExecMainStatus}, the unit's own ExecMainStatus`)
  assert.equal(body.error.includes(state), true,
    `(b)/M2 run ${n}: the error names the state the page had said (${state})`)
  assert.deepEqual(pick(body, CARRIED), pick(DEAD_PAGES[n], CARRIED),
    `(b)/M2 run ${n}: run, pr, branch, vm and startedAt ride through the write unchanged`)

  // ── (c) the journal beside it [M3] ────────────────────────────────────────
  const reads = journalReads(wet).filter((c) => c.dest === dest(n))
  assert.deepEqual(reads, [{ dest: dest(n), command: journalCommand(n) }],
    `(c)/M3 run ${n}: exactly one more ssh to the same ssh_dest, whose remote command is the \`journalctl _SYSTEMD_USER_UNIT=fleet-run@${n}.service --no-pager -n 200\` literal`)

  const journals = putsTo(wet, journalPath(n))
  assert.equal(journals.length, 1,
    `(c)/M3 run ${n}: exactly one gh call has -X PUT and the path ${journalPath(n)}`)
  const jf = fieldsOf(journals[0])
  assert.equal(jf.branch, evidenceBranchFor(n),
    `(c)/M3 run ${n}: the journal write carries -f branch=${evidenceBranchFor(n)}`)
  assert.equal(typeof jf.message, 'string',
    `(c)/M3 run ${n}: and an -f message= field`)
  assert.equal(decode(jf.content), journalText(n),
    `(c)/M3 run ${n}: its content= decodes to that read's stdout byte for byte`)
  assert.deepEqual(journals[0].argv.filter((a) => String(a).startsWith('sha=')), [],
    `(c)/M3 run ${n}: no argv element starts sha= — janitor-journal.txt is a new file`)
}

// ── (d) the death is reported, and the pass that wrote it reaps nothing [M4] ─
{
  assert.deepEqual(
    deathsByRun(wetResult),
    DEAD.map(({ n, state, unit }) => ({
      vm: vm(n),
      run: n,
      state,
      unit,
      applied: true
    })),
    '(d)/M4 deaths carries one entry per written death, shaped { vm, run, state, unit, applied } with state the page\'s and unit the four keys as read from the systemctl output'
  )

  const printed = renderJanitor(wetResult)
  for (const { n, unit } of DEAD) {
    assert.match(
      printed,
      new RegExp(`^death ${vm(n)}  run=${n} .*Result=${unit.Result}.*ExecMainStatus=${unit.ExecMainStatus}.*${evidenceBranchFor(n)}$`, 'm'),
      `(d)/M4 run ${n}: renderJanitor prints a line beginning \`death <vm>  run=<N> \` that contains Result=${unit.Result} and ExecMainStatus=${unit.ExecMainStatus} and ends with ${evidenceBranchFor(n)}`
    )
  }

  assert.deepEqual(
    wet.mutating().filter((line) => DEAD.some(({ n }) => line.includes(vm(n)))),
    [],
    '(d)/M4 the pass that wrote the death issues no rm <vm> --json for that row: updatedAt is now, so the ordinary reap does not fire in the same pass'
  )
  assert.equal(wetResult.dryRun, false, '(d)/M4 dryRun keeps its BASE shape: false for a wet pass')
  assert.equal(wetResult.age, '1h', '(d)/M4 age keeps its BASE shape: the default 1h')
  assert.deepEqual(wetResult.actions, [], '(d)/M4 actions keeps its BASE shape, and is empty here')
  assert.deepEqual(wetResult.stale, [], '(d)/M4 stale keeps its BASE shape, and is empty here')
  assert.deepEqual(wetResult.unknown, [], '(d)/M4 unknown keeps its BASE shape, and is empty here')

  // A later pass, more than --age after the write, over a fleet where the row's
  // page *is* the written page.
  const n = DEAD[0].n
  const later = newExec([
    ...lsRules([row(n)]),
    ghRule({
      evidence: { [evidencePath(n)]: WRITTEN[n] },
      shas: { [evidencePath(n)]: blobSha(n) }
    }),
    vmAnswers({ [dest(n)]: () => answer(unitText(DEAD[0].unit)) })
  ])
  const reaped = await janitor({ argv: [], exec: later, config: CONFIG, now: () => laterBy(2) })

  assert.deepEqual(later.mutating(), [`rm ${vm(n)} --json`],
    '(d)/M4 two hours on, the written `failed` page is older than --age and the row is removed by the ordinary rule')
  assert.deepEqual(reaped.actions, [{
    kind: 'rm',
    vm: vm(n),
    run: n,
    state: 'failed',
    updatedAt: NOW_ISO,
    command: `rm ${vm(n)} --json`,
    applied: true
  }], '(d)/M4 with an action shaped exactly as at BASE, aged from the updatedAt the janitor itself wrote')
  assert.deepEqual(later.vm(), [],
    '(d)/M4 and no ssh <ssh_dest> for it: the page now says failed, which is not a live state')
  assert.deepEqual(reaped.deaths, [],
    '(d)/M4 the reaping pass writes no second death')
}

// ═══════════════════════════════════════════════════════════════════════════
// (e) nothing else is written, and no git is ever run [M5]
// ═══════════════════════════════════════════════════════════════════════════
{
  // Six `running` rows, one per case. The first's page is seven hours old; the
  // rest are a minute old.
  const CASES = [
    { n: 51, at: hoursAgo(7), reply: () => answer(unitText({ ActiveState: 'active', SubState: 'running', Result: 'success', ExecMainStatus: '0' })) },
    { n: 52, at: minutesAgo(1), reply: () => answer(unitText({ ActiveState: 'activating' })) },
    { n: 53, at: minutesAgo(1), reply: () => answer(unitText({ ActiveState: 'active', SubState: 'exited', Result: 'success', ExecMainStatus: '0' })) },
    { n: 54, at: minutesAgo(1), reply: () => answer(unitText({ ActiveState: 'inactive', SubState: 'dead', Result: 'success', ExecMainStatus: '0' })) },
    { n: 55, at: minutesAgo(1), reply: () => answer('', { code: 255, stderr: 'ssh: connect to host: Connection timed out' }) },
    { n: 56, at: minutesAgo(1), reply: () => answer('') }
  ]
  const fleet = CASES.map(({ n }) => row(n))
  const exec = newExec([
    ...lsRules(fleet),
    ghRule({
      evidence: Object.fromEntries(CASES.map(({ n, at }) => [evidencePath(n), page(n, 'running', at)])),
      shas: Object.fromEntries(CASES.map(({ n }) => [evidencePath(n), blobSha(n)]))
    }),
    vmAnswers(Object.fromEntries(CASES.map(({ n, reply }) => [dest(n), reply])))
  ])
  const result = await janitor({ argv: [], exec, config: CONFIG, now: () => NOW })

  assert.deepEqual(ghCalls(exec).filter((c) => c.argv.includes('-X')).map((c) => c.line), [],
    '(e)/M5 a live unit, an unreadable unit and an empty answer each yield no gh api call carrying -X: nothing is written')
  assert.equal(exec.vm().length, 6,
    '(e)/M5 exactly six ssh commands — one unit read per row, and nothing more')
  assert.deepEqual(journalReads(exec), [],
    '(e)/M5 and no journalctl read: the journal is only written beside a death')
  assert.deepEqual(result.deaths, [],
    '(e)/M5 no deaths entry: ActiveState=active/running, activating, active/exited with Result=success, inactive/dead with Result=success, an ssh exiting 255 and an ssh exiting 0 with empty output are each "alive or unreadable"')
  assert.deepEqual(exec.mutating(), [],
    '(e)/M5 and no rm')
  assert.deepEqual(result.actions, [],
    '(e)/M5 the rows are treated exactly as at BASE: no action')
  assert.deepEqual(result.stale, [{
    vm: vm(51),
    run: 51,
    state: 'running',
    lastUpdate: hoursAgo(7),
    from: evidenceBranchFor(51)
  }], '(e)/M5 in stale shaped { vm, run, state, lastUpdate, from } when its updatedAt is six hours old — run 51 alone; the other five were updated a minute ago')
  assert.deepEqual(result.unknown, [],
    '(e)/M5 every row here has a readable assignment')
}

// ═══════════════════════════════════════════════════════════════════════════
// (f) --dry-run reads the unit and writes nothing [M6]
// ═══════════════════════════════════════════════════════════════════════════
{
  const dry = deadExec()
  const result = await janitor({ argv: ['--dry-run'], exec: dry, config: CONFIG, now: () => NOW })

  assert.deepEqual(byDest(unitReads(dry)), byDest(unitReads(wet)),
    '(f)/M6 under --dry-run a dead unit draws the same unit read: a read is a read')
  assert.deepEqual(ghCalls(dry).filter((c) => c.argv.includes('-X')).map((c) => c.line), [],
    '(f)/M6 and no gh api call carrying -X')
  assert.deepEqual(dry.mutating(), [],
    '(f)/M6 and no rm')
  assert.equal(result.deaths.length, DEAD.length,
    '(f)/M6 a deaths entry per dead row all the same')
  assert.equal(result.deaths.every((d) => d.applied === false), true,
    '(f)/M6 each with applied false')
  assert.equal(result.dryRun, true, '(f)/M6 and the result says it was a dry run')

  const printed = renderJanitor(result)
  for (const { n } of DEAD) {
    assert.match(printed, new RegExp(`^would write death ${vm(n)}  run=${n} `, 'm'),
      `(f)/M6 run ${n}: rendered as a line beginning \`would write death <vm>  run=<N> \``)
  }
}

// ── (e) across every leg: no git, ever [M5] ─────────────────────────────────
for (const [i, exec] of EXECS.entries()) {
  assert.deepEqual(exec.calls.filter((c) => c.cmd === 'git').map((c) => c.line), [],
    `(e)/M5 leg ${i}: the janitor issues no git command — its reads and its writes of the target both go through gh api`)
}

// ── (g) ─────────────────────────────────────────────────────────────────────
console.log('ALL TESTS PASSED')

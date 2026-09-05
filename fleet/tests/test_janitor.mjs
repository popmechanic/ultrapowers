/**
 * fleet/tests/test_janitor.mjs — the expiry: reap within 1 h of done/parked/failed.
 *
 * The janitor reads the *target*, never a side repository and never a VM. Its
 * only reads are one `ls 'fleet-r*' --json` through the lobby and `gh api` on
 * the laptop, through the same exec seam; this exam cans both.
 *
 * What is pinned, clause by clause:
 *
 *   M1 — every `ls 'fleet-r*' --json` row carries the assignment comment; `run=`
 *        and `target=` come out of it, the state comes out of
 *        `gh api repos/<target>/contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence-run-<N>`
 *        as the answer's base64 `content`, and `rm <vm> --json` fires exactly
 *        for `done|parked|failed` older than `--age` (default `1h`);
 *   M2 — no comment, no `target=`, a 404, too young, and `booting|running|
 *        publishing` are never removed; a 404 whose `ultra/plan-run-<N>` commit
 *        is over six hours old, and a live run silent for six hours, are stale;
 *   M3 — `--dry-run` reads everything and removes nothing; the only
 *        `ssh <ssh_dest>` commands are the unit and journal reads of #607, each
 *        at the `ssh_dest` of a row whose page said `booting|running|
 *        publishing`; no `git`, and nothing under `~/.ultrapowers/` but
 *        `fleet.json`.
 *
 * No VM answers in this exam: every `ssh <ssh_dest>` falls through to the
 * fixture's empty-and-green default, which is "unit unreadable", which is
 * "leave the row alone" — so every verdict below is the one the janitor reached
 * before #607 as well.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { evidenceBranchFor, planBranchFor } from '../lobby.mjs'
import { janitor, renderJanitor } from '../janitor.mjs'
import {
  answer, cleanup, cmdRule, makeExec, sshRule, tempDir, vmRow, vmsPayload
} from './_lobby_helpers.mjs'

const NOW = new Date('2026-09-03T12:00:00.000Z')
const minutesAgo = (m) => new Date(NOW.getTime() - m * 60000).toISOString()
const hoursAgo = (h) => minutesAgo(h * 60)

const TARGET = 'acme/widgets'
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
/** The config file's whole surface: two keys, `cpu` and `memory`. */
const CONFIG = { cpu: '8', memory: '16GB' }

const vm = (n, rand = 'a1b2') => `fleet-r${n}-2609030900-${rand}`
const comment = (run, target = TARGET) =>
  `run=${run} plan=${SHA} target=${target} base=${SHA} engine=${SHA}`
/** One `ls` row for run N, carrying the assignment comment the launcher set. */
const row = (n, { target = TARGET, rand } = {}) =>
  vmRow(vm(n, rand), { comment: comment(n, target) })

// ── The two `gh api` paths the contract names ───────────────────────────────

const evidencePath = (target, run) =>
  `repos/${target}/contents/.ultrapowers/runs/${run}/status.json?ref=${evidenceBranchFor(run)}`
const planPath = (target, run) => `repos/${target}/branches/${planBranchFor(run)}`

/** What `gh api` prints for an absent file: exit 1, `HTTP 404` on stderr. */
const NOT_FOUND = answer('', { code: 1, stderr: 'gh: Not Found (HTTP 404)' })

/** The contents envelope: the status page, base64, under `content`. */
const envelope = (status) => answer({
  content: Buffer.from(JSON.stringify(status), 'utf8').toString('base64'),
  encoding: 'base64'
})

/** The branch document, of which only the committer date is read. */
const branchDoc = (date) => answer({ commit: { commit: { committer: { date } } } })

/**
 * `gh api <path>` answers only the paths a leg canned; every other path is a
 * 404, so a read at the wrong path cannot look like a read at the right one.
 */
const ghRule = ({ evidence = {}, plans = {} } = {}) => cmdRule('gh', 'api', (cmd, argv) => {
  const p = argv.find((a) => typeof a === 'string' && a.startsWith('repos/'))
  if (p !== undefined && Object.hasOwn(evidence, p)) {
    const canned = evidence[p]
    // `{ raw: … }` is the status page served bare, without the envelope.
    return canned && canned.raw !== undefined ? answer(JSON.stringify(canned.raw)) : envelope(canned)
  }
  if (p !== undefined && Object.hasOwn(plans, p)) return branchDoc(plans[p])
  return NOT_FOUND
})

/** The states whose page says the run is in flight: the rows #607 may ssh into. */
const LIVE_STATES = ['booting', 'running', 'publishing']
/** Every such row's `ssh_dest`, collected as the legs can their pages. */
const LIVE_DESTS = new Set()

/** `evidence:` for a whole fleet, `[[run, status], …]` on one target. */
const evidenceFor = (entries, { target = TARGET, wrap = (s) => s } = {}) => {
  const canned = {}
  for (const [run, status] of entries) {
    if (LIVE_STATES.includes(status.state)) LIVE_DESTS.add(vmRow(vm(run)).ssh_dest)
    canned[evidencePath(target, run)] = wrap(status)
  }
  return canned
}

/** `ls '<pattern>'` answers the rows whose names match — what the server does. */
const lsRules = (fleet) => [
  sshRule('ls ', (cmd, argv) => {
    const pattern = /^ls '([^']+)'/.exec(argv[1])[1]
    const re = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`)
    return vmsPayload(fleet.filter((r) => re.test(r.vm_name)))
  }),
  sshRule('rm ', answer(''))
]

// ── Readers over the recording seam ─────────────────────────────────────────

/** Every exec this exam built, so leg (c)'s two negatives cover every leg. */
const EXECS = []
const newExec = (rules) => {
  // passthrough: [] — no command in this exam ever really runs.
  const exec = makeExec({ rules, passthrough: [] })
  EXECS.push(exec)
  return exec
}

const ghPaths = (exec) => exec.calls
  .filter((c) => c.cmd === 'gh')
  .map((c) => c.argv.find((a) => typeof a === 'string' && a.startsWith('repos/')) ?? c.argv.join(' '))
const contentsReads = (exec) => ghPaths(exec).filter((p) => p.includes('/contents/'))
const lsReads = (exec) => exec.lobby().filter((line) => line.startsWith('ls '))
const sorted = (xs) => [...xs].sort()

const vmOf = (entry) => (typeof entry === 'string' ? entry : entry?.vm ?? entry?.name)
const unknownVms = (result) => (result.unknown ?? []).map(vmOf)
const actionVms = (result) => (result.actions ?? []).map((a) => a.vm)
const staleRuns = (result) => (result.stale ?? []).map((s) => s.run)
/** Does a `gh api` path speak about run N at all? */
const mentions = (p, n) => p.includes(`/runs/${n}/`) || p.endsWith(`-run-${n}`)

// ── The fleet of leg (a): nine rows, nine states ────────────────────────────

const LEG_A = [
  [3, { run: 3, state: 'done', updatedAt: hoursAgo(2) }],
  [4, { run: 4, state: 'parked', updatedAt: hoursAgo(2) }],
  [8, { run: 8, state: 'failed', updatedAt: hoursAgo(2) }],
  [5, { run: 5, state: 'failed', updatedAt: minutesAgo(30) }],
  [13, { run: 13, state: 'done', updatedAt: minutesAgo(61) }],
  [14, { run: 14, state: 'done', updatedAt: minutesAgo(59) }],
  [6, { run: 6, state: 'running', updatedAt: minutesAgo(1) }],
  [10, { run: 10, state: 'booting', updatedAt: hoursAgo(3) }],
  [11, { run: 11, state: 'publishing', updatedAt: hoursAgo(3) }]
]
const LEG_A_FLEET = LEG_A.map(([n]) => row(n))
const LEG_A_RM = [3, 4, 8, 13].map((n) => `rm ${vm(n)} --json`)
const legAExec = ({ wrap } = {}) =>
  newExec([...lsRules(LEG_A_FLEET), ghRule({ evidence: evidenceFor(LEG_A, { wrap }) })])

// ── (a) rm fires exactly on terminal-and-old-enough [M1] ────────────────────
{
  const exec = legAExec()
  const result = await janitor({ argv: [], exec, config: CONFIG, now: () => NOW })

  assert.deepEqual(lsReads(exec), ["ls 'fleet-r*' --json"],
    '(a)/M1 one fleet-wide read: the janitor works from the `ls \'fleet-r*\' --json` rows')
  assert.deepEqual(sorted(contentsReads(exec)), sorted(LEG_A.map(([n]) => evidencePath(TARGET, n))),
    '(a)/M1 every row gets its own evidence read, at repos/<target>/contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence-run-<N>')
  assert.equal(
    contentsReads(exec)[0].startsWith(`repos/${TARGET}/contents/.ultrapowers/runs/`), true,
    '(a)/M1 the target in the path is the one the row\'s comment carries')

  assert.deepEqual(sorted(exec.mutating()), sorted(LEG_A_RM),
    '(a)/M1 with no --age: runs 3 (done), 4 (parked), 8 (failed) two hours old and 13 (done, 61 minutes) go; run 14 stays — the default is one hour, not less; 5 is 30 minutes old, 6 is running, 10 is booting and 11 is publishing')
  assert.deepEqual(sorted(actionVms(result)), sorted([3, 4, 8, 13].map((n) => vm(n))),
    '(a)/M1 four rm actions, one per row')
  assert.equal(result.actions.every((a) => a.applied), true,
    '(a)/M1 and they were applied')
  assert.equal(result.age, '1h', '(a)/M1 the default age is 1h')
  assert.equal(result.dryRun, false, '(a)/M1 this run was not a dry run')
  assert.deepEqual(result.stale, [],
    '(b)/M2 nothing here is stale: the three-hour-old booting (run 10) and publishing (run 11) rows are in neither stale nor actions')
  assert.equal(Array.isArray(result.unknown), true,
    '(a)/M1 the result carries { dryRun, age, actions, stale, unknown }')
  assert.deepEqual(unknownVms(result), [],
    '(a)/M1 every row here has a readable assignment')

  // --age 3h moves the bar past all four.
  const exec3h = legAExec()
  const older = await janitor({ argv: ['--age', '3h'], exec: exec3h, config: CONFIG, now: () => NOW })
  assert.deepEqual(exec3h.mutating(), [],
    '(a)/M1 --age 3h over the same fleet removes nothing at all')
  assert.deepEqual(older.actions, [], '(a)/M1 and reports no action')
  assert.equal(older.age, '3h', '(a)/M1 --age is echoed back')
  assert.deepEqual(sorted(contentsReads(exec3h)), sorted(LEG_A.map(([n]) => evidencePath(TARGET, n))),
    '(a)/M1 --age 3h still issues every evidence read')

  // The state lives in the envelope's base64 `content`, nowhere else.
  const execRaw = legAExec({ wrap: (s) => ({ raw: s }) })
  const raw = await janitor({ argv: [], exec: execRaw, config: CONFIG, now: () => NOW })
  assert.deepEqual(execRaw.mutating(), [],
    '(a)/M1 with the stub answering the raw status JSON instead of the contents envelope, no row is removed')
  assert.deepEqual(raw.actions, [], '(a)/M1 and no action is reported')
}

// ── (a2) the path is the row's target and the row's run [M1] ────────────────
{
  const fleet = [row(9, { target: 'other/repo' })]
  const evidence = evidenceFor([[9, { run: 9, state: 'done', updatedAt: hoursAgo(2) }]], { target: 'other/repo' })
  const exec = newExec([...lsRules(fleet), ghRule({ evidence })])
  const result = await janitor({ argv: [], exec, config: CONFIG, now: () => NOW })

  assert.deepEqual(contentsReads(exec),
    ['repos/other/repo/contents/.ultrapowers/runs/9/status.json?ref=ultra/evidence-run-9'],
    '(a2)/M1 a row whose comment reads target=other/repo is read under repos/other/repo, run 9 under runs/9/, with ref=ultra/evidence-run-9')
  assert.deepEqual(exec.mutating(), [`rm ${vm(9)} --json`],
    '(a2)/M1 the read landed: every other path answers 404, so the rm proves the exact path')
  assert.deepEqual(actionVms(result), [vm(9)], '(a2)/M1 one action, for run 9')
}

// ── (b) unknown, stale, and everything left alone [M2] ──────────────────────
const PLAN_STALE = '2026-09-03T05:00:00Z' // seven hours before NOW
const PLAN_FRESH = '2026-09-03T09:00:00Z' // three hours before NOW
{
  const fleet = [
    // No comment at all, and a comment with no `target=`: nothing to read.
    vmRow(vm(20)),
    vmRow(vm(12), { comment: 'run=12 base=abc' }),
    // 404 evidence, plan branch seven hours old → stale.
    row(21),
    // Alive and silent for seven hours → stale.
    row(22),
    // Alive and fresh → neither.
    row(23),
    // 404 evidence, plan branch three hours old → neither.
    row(26)
  ]
  const evidence = evidenceFor([
    [22, { run: 22, state: 'running', updatedAt: hoursAgo(7) }],
    [23, { run: 23, state: 'running', updatedAt: minutesAgo(1) }]
  ])
  const plans = { [planPath(TARGET, 21)]: PLAN_STALE, [planPath(TARGET, 26)]: PLAN_FRESH }
  const exec = newExec([...lsRules(fleet), ghRule({ evidence, plans })])
  const result = await janitor({ argv: [], exec, config: CONFIG, now: () => NOW })

  assert.deepEqual(sorted(unknownVms(result)), sorted([vm(20), vm(12)]),
    '(b)/M2 a row with no comment and a row whose comment is `run=12 base=abc` with no target= both land in unknown')
  assert.deepEqual(exec.mutating(), [],
    '(b)/M2 nothing in this fleet is removed')
  assert.deepEqual(result.actions, [],
    '(b)/M2 and nothing is reported as an action')
  assert.deepEqual(ghPaths(exec).filter((p) => mentions(p, 12) || mentions(p, 20)), [],
    '(b)/M2 an unreadable assignment causes no gh api read at all')

  assert.deepEqual(sorted(staleRuns(result)), [21, 22],
    '(b)/M2 stale is exactly run 21 (404, plan seven hours old) and run 22 (running, updatedAt seven hours old); run 23 was updated a minute ago and run 26\'s plan is three hours old, so neither is stale')
  const s21 = result.stale.find((s) => s.run === 21)
  assert.equal(s21.vm, vm(21), '(b)/M2 the stale entry names the VM')
  assert.equal(s21.from, 'ultra/plan-run-21',
    '(b)/M2 a run with no evidence is aged from `from` = ultra/plan-run-21')
  assert.equal(Date.parse(s21.lastUpdate), Date.parse(PLAN_STALE),
    '(b)/M2 with the plan commit\'s .commit.commit.committer.date as its last update')
  const s22 = result.stale.find((s) => s.run === 22)
  assert.equal(s22.vm, vm(22), '(b)/M2 the silent live run is named too')
  assert.equal(s22.state, 'running', '(b)/M2 carrying the state its evidence reported')
  assert.equal(Date.parse(s22.lastUpdate), Date.parse(hoursAgo(7)),
    '(b)/M2 aged from the evidence page\'s updatedAt, never created_at')

  const printed = renderJanitor(result)
  assert.equal(printed.includes(`unknown ${vm(20)}  no readable assignment — look before you rm`), true,
    '(b)/M2 an unknown row is printed verbatim: `unknown <vm>  no readable assignment — look before you rm`')
  assert.equal(printed.includes(`unknown ${vm(12)}  no readable assignment — look before you rm`), true,
    '(b)/M2 both unknown rows are printed')
  assert.match(printed, new RegExp(`^stale ${vm(21)}  run=21 state=none last update .* \\(ultra/plan-run-21\\) — look before you rm$`, 'm'),
    '(b)/M2 the stale line keeps its shape')
  assert.equal(/^(would )?rm /m.test(printed), false,
    '(b)/M2 and no rm line is printed')
}

// ── (c) --dry-run, no ssh, no git, nothing under ~/.ultrapowers [M3] ────────
{
  const wet = legAExec()
  const applied = await janitor({ argv: [], exec: wet, config: CONFIG, now: () => NOW })
  const dry = legAExec()
  const result = await janitor({ argv: ['--dry-run'], exec: dry, config: CONFIG, now: () => NOW })

  assert.deepEqual(ghPaths(dry), ghPaths(wet),
    '(c)/M3 --dry-run issues exactly the same gh api reads')
  assert.deepEqual(lsReads(dry), lsReads(wet),
    '(c)/M3 and exactly the same ls read')
  assert.deepEqual(dry.mutating(), [],
    '(c)/M3 and no rm')
  assert.deepEqual(sorted(actionVms(result)), sorted(actionVms(applied)),
    '(c)/M3 it still reports the four rows it would have removed')
  assert.equal(result.actions.every((a) => a.applied === false), true,
    '(c)/M3 unapplied')
  assert.equal(result.dryRun, true, '(c)/M3 and says so')
  assert.match(renderJanitor(result), new RegExp(`^would rm ${vm(3)}  run=3 done since `, 'm'),
    '(c)/M3 printed as "would rm", keeping the line shape')

  assert.equal(renderJanitor({ dryRun: false, age: '1h', actions: [], stale: [], unknown: [] }),
    'nothing to do', '(c)/M3 an empty result still says so')
}

// ── (c) the only file read under ~/.ultrapowers/ is fleet.json [M3] ─────────
{
  const home = tempDir('fleet-janitor-home-')
  const dot = path.join(home, '.ultrapowers')
  fs.mkdirSync(path.join(dot, 'runs', '3'), { recursive: true })
  fs.writeFileSync(path.join(dot, 'fleet.json'), JSON.stringify(CONFIG))
  // A canary: a status page saying run 3 finished a day ago. A janitor that
  // reads it would reap run 3; the target's evidence — the only reader — 404s.
  fs.writeFileSync(path.join(dot, 'runs', '3', 'status.json'),
    JSON.stringify({ run: 3, state: 'done', updatedAt: hoursAgo(24) }))
  // Spelled in two halves on purpose: the string itself is banned under fleet/.
  const sideRepo = path.join(dot, ['fleet', 'runs'].join('-'), 'plans')
  fs.mkdirSync(sideRepo, { recursive: true })
  fs.writeFileSync(path.join(sideRepo, 'run-3.md'), '# run 3\n')

  const exec = newExec([
    ...lsRules([row(3)]),
    ghRule({ plans: { [planPath(TARGET, 3)]: PLAN_STALE } })
  ])
  const previous = process.env.HOME
  let result
  try {
    process.env.HOME = home
    // No `config`: the fleet.json under this HOME is the only file it may read.
    result = await janitor({ argv: [], exec, now: () => NOW })
  } finally {
    if (previous === undefined) delete process.env.HOME
    else process.env.HOME = previous
  }

  assert.deepEqual(exec.mutating(), [],
    '(c)/M3 the run-3 VM is not removed: the canary status page under ~/.ultrapowers/ is not a reader the janitor has')
  assert.deepEqual(result.actions, [],
    '(c)/M3 and run 3 is in no action')
  assert.equal(
    staleRuns(result).includes(3) || unknownVms(result).includes(vm(3)), true,
    '(c)/M3 run 3 appears in stale or unknown — never in actions')
  cleanup(home)
}

// ── (c) across every leg: the only VM ssh is #607's read, and no git ────────
const UNIT_READ = 'XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user show fleet-run@'
const JOURNAL_READ = 'journalctl _SYSTEMD_USER_UNIT=fleet-run@'
for (const [i, exec] of EXECS.entries()) {
  for (const call of exec.vm()) {
    assert.equal(LIVE_DESTS.has(call.dest), true,
      `(c)/M3 leg ${i}: every ssh <ssh_dest> goes to the ssh_dest of a row whose page said booting|running|publishing, and ${call.dest} is not one`)
    assert.equal(
      call.command.startsWith(UNIT_READ) || call.command.startsWith(JOURNAL_READ), true,
      `(c)/M3 leg ${i}: the only commands run on a VM are the unit read and the journal read, not ${JSON.stringify(call.command)}`)
  }
  assert.deepEqual(exec.calls.filter((c) => c.cmd === 'git').map((c) => c.line), [],
    `(c)/M3 leg ${i}: the janitor issues no git command`)
}

console.log('ALL TESTS PASSED')

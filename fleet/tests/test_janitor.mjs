/**
 * fleet/tests/test_janitor.mjs — the janitor reads a finished run by its tag.
 *
 * The janitor reads the *target*, never a side repository and never a VM but for
 * #607's one unit read. Its only reads are one `ls 'fleet-r*' --json` through the
 * lobby and `gh api` on the laptop, through the same exec seam; this exam cans
 * both, and every path a leg did not can answers `HTTP 404`, so a read at the
 * wrong path cannot look like a read at the right one.
 *
 * What is pinned, clause by clause:
 *
 *   M1 — the first contents read of every row with a readable assignment is
 *        `repos/<target>/contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence/run-<N>`;
 *        the same path with `?ref=ultra/evidence-run-<N>` is read only when the
 *        tag read answered no contents envelope — a 404, or a body with no
 *        string `content` — and never when the tag answered one; a page found on
 *        either ref drives the verdict as at BASE (`rm <vm> --json` for a `state`
 *        in `done|parked|failed` older than `--age`, default `1h`), and a page
 *        served bare on both refs removes nothing         — legs (a), (b), (c)
 *   M2 — a run with no page on either ref is aged from the plan tag:
 *        `git/ref/tags/ultra/plan/run-<N>` for `.object.sha`, then
 *        `commits/<that sha>` for `.commit.committer.date`;
 *        `branches/ultra/plan-run-<N>` is read for
 *        `.commit.commit.committer.date` only when the tag ref answered no hex
 *        `.object.sha`, and then no `commits/` read is issued for that row; six
 *        hours or more is `stale`, younger is neither `stale` nor `actions`, and
 *        no age at all is neither                                     — leg (d)
 *   M3 — every `stale` entry's `from` is the ref its `lastUpdate` came from —
 *        `ultra/evidence/run-<N>`, `ultra/evidence-run-<N>`, `ultra/plan/run-<N>`
 *        or `ultra/plan-run-<N>` — and `renderJanitor` prints it in the
 *        parentheses of the BASE-shaped `stale` line          — legs (d), (e)
 *   M4 — #607 is unchanged: a live page draws exactly one unit read at the row's
 *        own `ssh_dest` whichever ref served it, and a dead unit draws the
 *        journal read and both `gh api -X PUT` writes, each carrying
 *        `-f branch=ultra/evidence-run-<N>` — never the tag — with the
 *        `status.json` write carrying the read envelope's `-f sha=`
 *                                                              — legs (a), (f)
 *   M5 — everything else holds as at BASE: `--dry-run` reads the same and
 *        removes nothing, an unreadable assignment is `unknown` and draws no
 *        read, every non-`-X` `gh` call is two argv words `api` and a path
 *        beginning `repos/`, no `git` is run, every `ssh <ssh_dest>` is #607's
 *        unit or journal read at a live row's own destination, and nothing under
 *        `~/.ultrapowers/` but `fleet.json` is opened                 — leg (g)
 */

import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'

import {
  evidenceBranchFor, evidenceTagFor, planBranchFor, planTagFor
} from '../lobby.mjs'
import { janitor, renderJanitor } from '../janitor.mjs'
import {
  answer, cleanup, cmdRule, makeExec, sshRule, tempDir, vmRow, vmRule, vmsPayload
} from './_lobby_helpers.mjs'

const NOW = new Date('2026-09-05T12:00:00.000Z')
const NOW_ISO = NOW.toISOString()
const minutesAgo = (m) => new Date(NOW.getTime() - m * 60000).toISOString()
const hoursAgo = (h) => minutesAgo(h * 60)

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
const row = (n, { target = TARGET } = {}) => vmRow(vm(n), { comment: comment(n, target) })

/** Regex-safe spelling of a literal the contract pins. */
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ── The five `gh api` paths the contract names ──────────────────────────────

const statusPath = (target, run) =>
  `repos/${target}/contents/.ultrapowers/runs/${run}/status.json`
const journalPath = (target, run) =>
  `repos/${target}/contents/.ultrapowers/runs/${run}/janitor-journal.txt`
/** The page at the evidence *tag* — the read M1 puts first. */
const tagPagePath = (target, run) => `${statusPath(target, run)}?ref=${evidenceTagFor(run)}`
/** The same path at the evidence *branch* — the read M1 allows only after it. */
const branchPagePath = (target, run) => `${statusPath(target, run)}?ref=${evidenceBranchFor(run)}`
/** The plan tag's own document: slashes in the tag name spelled as they are. */
const planTagRefPath = (target, run) => `repos/${target}/git/ref/tags/${planTagFor(run)}`
const planBranchPath = (target, run) => `repos/${target}/branches/${planBranchFor(run)}`
const commitPath = (target, sha) => `repos/${target}/commits/${sha}`

// ── The canned answers ──────────────────────────────────────────────────────

/** What `gh api` prints for an absent ref: exit 1, `HTTP 404` on stderr. */
const NOT_FOUND = answer('', { code: 1, stderr: 'gh: Not Found (HTTP 404)' })

/** The contents envelope: the status page, base64, under `content`, beside the
 *  blob `sha` of the file as it sits on the ref it was read from. */
const envelope = (status, sha) => answer({
  content: Buffer.from(JSON.stringify(status), 'utf8').toString('base64'),
  encoding: 'base64',
  sha
})
/** The status page served *bare* — no envelope, so no `content` string. */
const barePage = (status) => answer(JSON.stringify(status))
/** The branches endpoint's document: the date is one level deeper than a commit's. */
const branchDoc = (date) => answer({ commit: { commit: { committer: { date } } } })
/** The commits endpoint's document: `.commit.committer.date`. */
const commitDoc = (date) => answer({ commit: { committer: { date } } })
/** A lightweight tag's ref document, as `git/ref/tags/<name>` answers it. */
const tagRefDoc = (run, sha) => ({
  ref: `refs/tags/${planTagFor(run)}`,
  node_id: 'MDM6UmVmMQ==',
  url: `https://api.github.com/${planTagRefPath(TARGET, run)}`,
  object: { sha, type: 'commit', url: `https://api.github.com/${commitPath(TARGET, sha)}` }
})
/** What the contents API answers a successful PUT. */
const PUT_OK = answer({ content: { sha: 'f'.repeat(40) }, commit: { sha: 'e'.repeat(40) } })

/**
 * `gh api <path>` answers only what a leg canned; every other path is a 404. A
 * call carrying `-X` is a write, answered as the contents API answers a 200.
 */
const ghRule = ({ pages = {}, plans = {}, tags = {}, commits = {} } = {}) =>
  cmdRule('gh', 'api', (cmd, argv) => {
    if (argv.includes('-X')) return PUT_OK
    const p = argv.find((a) => typeof a === 'string' && a.startsWith('repos/'))
    if (p === undefined) return NOT_FOUND
    if (Object.hasOwn(pages, p)) {
      const canned = pages[p]
      return canned.raw !== undefined ? barePage(canned.raw) : envelope(canned.page, canned.sha)
    }
    if (Object.hasOwn(plans, p)) return branchDoc(plans[p])
    if (Object.hasOwn(tags, p)) return answer(tags[p])
    if (Object.hasOwn(commits, p)) return commitDoc(commits[p])
    return NOT_FOUND
  })

/** The states whose page says the run is in flight: the rows #607 may ssh into. */
const LIVE_STATES = ['booting', 'running', 'publishing']
/** Every such row's `ssh_dest`, collected as the legs can their pages. */
const LIVE_DESTS = new Set()
const noteLive = (run, status) => {
  if (LIVE_STATES.includes(status.state)) LIVE_DESTS.add(dest(run))
}

/** `pages:` for a whole fleet served from one ref, `[[run, status], …]`. */
const pagesAt = (at, entries, { target = TARGET } = {}) => {
  const canned = {}
  for (const [run, status] of entries) {
    noteLive(run, status)
    canned[at(target, run)] = { page: status }
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

// ── The VM seam: #607's two reads, one canned answer per destination ────────

const UNIT_READ = 'XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user show fleet-run@'
const JOURNAL_READ = 'journalctl _SYSTEMD_USER_UNIT=fleet-run@'
/** The unit read, one argv element after the destination. `$(id -u)` is the
 *  VM's shell's, so it travels as text. */
const unitCommand = (n) =>
  `${UNIT_READ}${n}.service -p ActiveState -p SubState -p Result -p ExecMainStatus`
const journalCommand = (n) => `${JOURNAL_READ}${n}.service --no-pager -n 200`
/** `systemctl show` prints one `key=value` per line. */
const unitText = (unit) =>
  `${Object.entries(unit).map(([k, v]) => `${k}=${v}`).join('\n')}\n`

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

/** A rule answering per destination; an unruled destination answers empty and
 *  green, which is "unit unreadable", which is "leave the row alone". */
const vmAnswers = (byDest) => vmRule((cmd, argv) => {
  const call = afterOptions(argv)
  const handler = byDest[call.dest]
  return handler === undefined ? answer('') : handler(call.command)
})

// ── Readers over the recording seam ─────────────────────────────────────────

/** Every exec this exam built, so leg (g)'s sweep covers every leg. */
const EXECS = []
const newExec = (rules) => {
  // passthrough: [] — no command in this exam ever really runs.
  const exec = makeExec({ rules, passthrough: [] })
  EXECS.push(exec)
  return exec
}

const ghCalls = (exec) => exec.calls.filter((c) => c.cmd === 'gh')
const pathOf = (argv) => argv.find((a) => typeof a === 'string' && a.startsWith('repos/'))
const ghPaths = (exec) => ghCalls(exec).map((c) => pathOf(c.argv) ?? c.argv.join(' '))
const readPaths = (exec) => ghCalls(exec)
  .filter((c) => !c.argv.includes('-X'))
  .map((c) => pathOf(c.argv))
  .filter((p) => p !== undefined)
/** The status-page reads, in the order they were issued. */
const contentsReads = (exec) => readPaths(exec).filter((p) => p.includes('/contents/'))
const commitReads = (exec) => readPaths(exec).filter((p) => p.includes('/commits/'))
const readsFor = (exec, run) =>
  contentsReads(exec).filter((p) => p.includes(`/runs/${run}/status.json`))
const lsReads = (exec) => exec.lobby().filter((line) => line.startsWith('ls '))
const sorted = (xs) => [...xs].sort()

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

const unitReads = (exec) => exec.vm().filter((c) => c.command.startsWith(UNIT_READ))
const journalReads = (exec) => exec.vm().filter((c) => c.command.startsWith(JOURNAL_READ))
const byDest = (calls) => [...calls].sort((a, b) => (a.dest < b.dest ? -1 : 1))

const vmOf = (entry) => (typeof entry === 'string' ? entry : entry?.vm ?? entry?.name)
const unknownVms = (result) => (result.unknown ?? []).map(vmOf)
const actionVms = (result) => (result.actions ?? []).map((a) => a.vm)
const staleRuns = (result) => (result.stale ?? []).map((s) => s.run)
const staleOf = (result, run) => (result.stale ?? []).find((s) => s.run === run)
/** Does a `gh api` path speak about run N at all — by branch, tag or contents? */
const mentions = (p, n) =>
  new RegExp(`/runs/${n}/|(?:^|[^0-9])run-${n}(?:$|[^0-9])`).test(p)

// ═══════════════════════════════════════════════════════════════════════════
// The fleet of legs (a) and (b): nine rows, nine ages
// ═══════════════════════════════════════════════════════════════════════════

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
const FLEET = LEG_A.map(([n]) => row(n))
const REAPED = [3, 4, 8, 13]
const LIVE_ROWS = [6, 10, 11]
const RM_LINES = REAPED.map((n) => `rm ${vm(n)} --json`)
const TAG_READS = LEG_A.map(([n]) => tagPagePath(TARGET, n))

const legAExec = () => newExec([...lsRules(FLEET), ghRule({ pages: pagesAt(tagPagePath, LEG_A) })])

// ═══════════════════════════════════════════════════════════════════════════
// (a) the tag is the first — and, when it answers, the only — page read [M1],
//     and a live page still draws its one unit read [M4]
// ═══════════════════════════════════════════════════════════════════════════
{
  const exec = legAExec()
  const result = await janitor({ argv: [], exec, config: CONFIG, now: () => NOW })

  assert.deepEqual(lsReads(exec), ["ls 'fleet-r*' --json"],
    '(a)/M1 one fleet-wide read: the janitor works from the `ls \'fleet-r*\' --json` rows')
  assert.deepEqual(sorted(contentsReads(exec)), sorted(TAG_READS),
    '(a)/M1 with every page canned at the tag, every row gets exactly one contents read, at repos/<target>/contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence/run-<N>')
  for (const [n] of LEG_A) {
    assert.deepEqual(readsFor(exec, n), [tagPagePath(TARGET, n)],
      `(a)/M1 run ${n}: one read, at the evidence tag — the branch is not read when the tag answered a contents envelope`)
  }
  assert.deepEqual(ghPaths(exec).filter((p) => p.includes('ultra/evidence-run-')), [],
    '(a)/M1 no gh path contains ultra/evidence-run-: a tag that answered is the whole read')

  assert.deepEqual(sorted(exec.mutating()), sorted(RM_LINES),
    '(a)/M1 the mutating lobby verbs are exactly `rm <vm> --json` for runs 3 (done), 4 (parked) and 8 (failed) two hours old and run 13 (done, 61 minutes); run 14 is 59 minutes old, 5 is 30 minutes old, and 6, 10 and 11 are in flight')
  assert.deepEqual(sorted(actionVms(result)), sorted(REAPED.map((n) => vm(n))),
    '(a)/M1 four rm actions, one per reaped row')
  assert.equal(result.actions.every((a) => a.applied), true,
    '(a)/M1 and they were applied')
  assert.equal(result.age, '1h', '(a)/M1 the default age is 1h')
  assert.equal(result.dryRun, false, '(a)/M1 this run was not a dry run')
  assert.deepEqual(result.stale, [],
    '(a)/M1 nothing here is stale: the three-hour-old booting (run 10) and publishing (run 11) rows are in neither stale nor actions')
  assert.deepEqual(unknownVms(result), [],
    '(a)/M1 every row here has a readable assignment')
  assert.deepEqual(sorted(Object.keys(result)),
    sorted(['dryRun', 'age', 'actions', 'stale', 'unknown', 'deaths']),
    '(a)/M1 the result carries its six fields { dryRun, age, actions, stale, unknown, deaths }')

  // ── (a)/M4 the unit read fires for a live page whichever ref served it ────
  assert.deepEqual(
    byDest(exec.vm()),
    byDest(LIVE_ROWS.map((n) => ({ dest: dest(n), command: unitCommand(n) }))),
    '(a)/M4 the running, booting and publishing rows each draw exactly one ssh <ssh_dest> unit read, at their own ssh_dest, with the systemctl literal of #607 — a page served by the tag is a page'
  )
  assert.equal(exec.vm().length, LIVE_ROWS.length,
    '(a)/M4 and the six finished rows draw none: three ssh commands in all')

  // ── --age 3h moves the bar past all four, and reads exactly the same ──────
  const exec3h = legAExec()
  const older = await janitor({ argv: ['--age', '3h'], exec: exec3h, config: CONFIG, now: () => NOW })
  assert.deepEqual(exec3h.mutating(), [],
    '(a)/M1 --age 3h over the same fleet removes nothing at all')
  assert.deepEqual(older.actions, [], '(a)/M1 and reports no action')
  assert.equal(older.age, '3h', '(a)/M1 --age is echoed back')
  assert.deepEqual(sorted(contentsReads(exec3h)), sorted(TAG_READS),
    '(a)/M1 --age 3h still issues every tag read')
}

// ═══════════════════════════════════════════════════════════════════════════
// (b) the branch is read second, and only then [M1]
// ═══════════════════════════════════════════════════════════════════════════
{
  const exec = newExec([...lsRules(FLEET), ghRule({ pages: pagesAt(branchPagePath, LEG_A) })])
  const result = await janitor({ argv: [], exec, config: CONFIG, now: () => NOW })

  assert.deepEqual(
    contentsReads(exec),
    LEG_A.flatMap(([n]) => [tagPagePath(TARGET, n), branchPagePath(TARGET, n)]),
    '(b)/M1 with every page canned at the branch, each row\'s contents reads are the tag path then the branch path ?ref=ultra/evidence-run-<N>, in that order and no others'
  )
  assert.deepEqual(sorted(exec.mutating()), sorted(RM_LINES),
    '(b)/M1 the same four rm <vm> --json fire: a page found on either ref drives the verdict')
  assert.deepEqual(sorted(actionVms(result)), sorted(REAPED.map((n) => vm(n))),
    '(b)/M1 four rm actions, one per reaped row')

  // A row on another target, its page on the branch.
  const other = newExec([
    ...lsRules([row(9, { target: 'other/repo' })]),
    ghRule({
      pages: pagesAt(branchPagePath, [[9, { run: 9, state: 'done', updatedAt: hoursAgo(2) }]],
        { target: 'other/repo' })
    })
  ])
  const result9 = await janitor({ argv: [], exec: other, config: CONFIG, now: () => NOW })

  assert.deepEqual(contentsReads(other), [
    'repos/other/repo/contents/.ultrapowers/runs/9/status.json?ref=ultra/evidence/run-9',
    'repos/other/repo/contents/.ultrapowers/runs/9/status.json?ref=ultra/evidence-run-9'
  ], '(b)/M1 a row whose comment reads target=other/repo is read under repos/other/repo/contents/.ultrapowers/runs/9/status.json with ?ref=ultra/evidence/run-9 first and ?ref=ultra/evidence-run-9 second')
  assert.deepEqual(other.mutating(), [`rm ${vm(9)} --json`],
    '(b)/M1 and its rm fires: every other path answers 404, so the rm proves the exact path')
  assert.deepEqual(actionVms(result9), [vm(9)], '(b)/M1 one action, for run 9')
}

// ═══════════════════════════════════════════════════════════════════════════
// (c) a page served bare is no contents envelope [M1]
// ═══════════════════════════════════════════════════════════════════════════

const BARE_PAGE = (n) => ({ run: n, state: 'done', updatedAt: hoursAgo(2) })
{
  // Bare on the tag, 404 on the branch: no envelope anywhere.
  const bareTag = newExec([
    ...lsRules([row(41)]),
    ghRule({ pages: { [tagPagePath(TARGET, 41)]: { raw: BARE_PAGE(41) } } })
  ])
  const r1 = await janitor({ argv: [], exec: bareTag, config: CONFIG, now: () => NOW })
  assert.deepEqual(readsFor(bareTag, 41),
    [tagPagePath(TARGET, 41), branchPagePath(TARGET, 41)],
    '(c)/M1 a bare tag answer is no contents envelope, so the branch read follows it')
  assert.deepEqual(bareTag.mutating(), [],
    '(c)/M1 a two-hour-old done page served bare on the tag with the branch 404 removes nothing')
  assert.deepEqual(r1.actions, [], '(c)/M1 and reports no action')

  // 404 on the tag, bare on the branch: likewise nothing.
  const bareBranch = newExec([
    ...lsRules([row(42)]),
    ghRule({ pages: { [branchPagePath(TARGET, 42)]: { raw: BARE_PAGE(42) } } })
  ])
  const r2 = await janitor({ argv: [], exec: bareBranch, config: CONFIG, now: () => NOW })
  assert.deepEqual(readsFor(bareBranch, 42),
    [tagPagePath(TARGET, 42), branchPagePath(TARGET, 42)],
    '(c)/M1 a 404 on the tag is no contents envelope either, so the branch read follows it')
  assert.deepEqual(bareBranch.mutating(), [],
    '(c)/M1 the same page served bare on the branch with the tag 404 removes nothing')
  assert.deepEqual(r2.actions, [], '(c)/M1 and reports no action')

  // Bare on the tag, enveloped on the branch: the branch read decides.
  const mixed = newExec([
    ...lsRules([row(43)]),
    ghRule({
      pages: {
        [tagPagePath(TARGET, 43)]: { raw: BARE_PAGE(43) },
        [branchPagePath(TARGET, 43)]: { page: BARE_PAGE(43) }
      }
    })
  ])
  const r3 = await janitor({ argv: [], exec: mixed, config: CONFIG, now: () => NOW })
  assert.deepEqual(readsFor(mixed, 43),
    [tagPagePath(TARGET, 43), branchPagePath(TARGET, 43)],
    '(c)/M1 the same page bare on the tag and enveloped on the branch draws the branch read')
  assert.deepEqual(mixed.mutating(), [`rm ${vm(43)} --json`],
    '(c)/M1 and its rm fires')
  assert.deepEqual(actionVms(r3), [vm(43)], '(c)/M1 one action, for run 43')
}

// ═══════════════════════════════════════════════════════════════════════════
// (d) a page-less run is aged from the plan tag, then the plan branch [M2, M3]
// ═══════════════════════════════════════════════════════════════════════════

/** A distinct 40-hex object name per run — what `.object.sha` carries. */
const tagSha = (n) => String(n).repeat(20).slice(0, 40)
const SEVEN = hoursAgo(7)
const THREE = hoursAgo(3)
const SIX = hoursAgo(6)
const NEARLY_SIX = minutesAgo(5 * 60 + 59)
/** Canned on every plan *branch* whose tag ref answers a hex sha: a distinct
 *  eight-hour date, so a reading of the branch cannot pass for the tag's. */
const BRANCH_DECOY = hoursAgo(8)

const PAGELESS = [21, 24, 25, 26, 27, 28, 29, 30, 31, 32]
/** The four rows whose plan tag answers a hex `.object.sha`. */
const TAGGED = [21, 24, 31, 32]

let LEG_D_RESULT
{
  const exec = newExec([
    ...lsRules(PAGELESS.map((n) => row(n))),
    ghRule({
      tags: {
        [planTagRefPath(TARGET, 21)]: tagRefDoc(21, tagSha(21)),
        [planTagRefPath(TARGET, 24)]: tagRefDoc(24, tagSha(24)),
        // A JSON array — what the sibling `git/refs/` endpoint answers.
        [planTagRefPath(TARGET, 28)]: [tagRefDoc(28, tagSha(28))],
        [planTagRefPath(TARGET, 29)]: { object: { sha: 'not-a-sha' } },
        [planTagRefPath(TARGET, 30)]: { object: {} },
        [planTagRefPath(TARGET, 31)]: tagRefDoc(31, tagSha(31)),
        [planTagRefPath(TARGET, 32)]: tagRefDoc(32, tagSha(32))
      },
      commits: {
        [commitPath(TARGET, tagSha(21))]: SEVEN,
        [commitPath(TARGET, tagSha(24))]: THREE,
        [commitPath(TARGET, tagSha(28))]: SEVEN,
        [commitPath(TARGET, tagSha(31))]: SIX,
        [commitPath(TARGET, tagSha(32))]: NEARLY_SIX
      },
      plans: {
        [planBranchPath(TARGET, 21)]: BRANCH_DECOY,
        [planBranchPath(TARGET, 24)]: BRANCH_DECOY,
        [planBranchPath(TARGET, 25)]: SEVEN,
        [planBranchPath(TARGET, 26)]: THREE,
        [planBranchPath(TARGET, 28)]: SEVEN,
        [planBranchPath(TARGET, 29)]: SEVEN,
        [planBranchPath(TARGET, 30)]: SEVEN,
        [planBranchPath(TARGET, 31)]: BRANCH_DECOY,
        [planBranchPath(TARGET, 32)]: BRANCH_DECOY
      }
    })
  ])
  LEG_D_RESULT = await janitor({ argv: [], exec, config: CONFIG, now: () => NOW })
  const result = LEG_D_RESULT

  assert.deepEqual(sorted(staleRuns(result).map(String)), sorted([21, 25, 28, 29, 30, 31].map(String)),
    '(d)/M2 stale is exactly runs 21, 25, 28, 29, 30 and 31 — six hours or more from the tag\'s commit or from the plan branch; runs 24, 26, 27 and 32 are in neither stale nor actions')
  assert.deepEqual(result.actions, [],
    '(d)/M2 a run with no page is never an action: the reap needs a state')
  assert.deepEqual(exec.mutating(), [],
    '(d)/M2 and nothing is removed')

  // run 21 — the plan tag, and only the plan tag.
  const s21 = staleOf(result, 21)
  assert.equal(s21.vm, vm(21), '(d)/M2 run 21: the stale entry names the VM')
  assert.equal(s21.from, planTagFor(21),
    '(d)/M3 run 21: aged from git/ref/tags/ultra/plan/run-21, so `from` is ultra/plan/run-21')
  assert.equal(s21.lastUpdate, SEVEN,
    '(d)/M2 run 21: lastUpdate is the .commit.committer.date of commits/<the tag\'s .object.sha>, seven hours old')
  assert.equal(s21.state, null,
    '(d)/M2 run 21: with no page there is no state')
  assert.equal(ghPaths(exec).includes(planBranchPath(TARGET, 21)), false,
    '(d)/M2 run 21: branches/ultra/plan-run-21 is never read — the tag ref answered a hex .object.sha')

  // run 24 — the same, three hours old.
  assert.equal(staleOf(result, 24), undefined,
    '(d)/M2 run 24: a tag commit three hours old is in neither stale nor actions')
  assert.equal(ghPaths(exec).includes(planBranchPath(TARGET, 24)), false,
    '(d)/M2 run 24: and its plan branch is not read either')

  // run 25 — no tag at all, so the plan branch.
  const s25 = staleOf(result, 25)
  assert.equal(s25.from, planBranchFor(25),
    '(d)/M3 run 25: the tag ref answers 404, so the age comes from branches/ultra/plan-run-25 and `from` is ultra/plan-run-25')
  assert.equal(s25.lastUpdate, SEVEN,
    '(d)/M2 run 25: lastUpdate is the branch document\'s .commit.commit.committer.date')

  // run 26 — the plan branch, three hours old.
  assert.equal(staleOf(result, 26), undefined,
    '(d)/M2 run 26: the tag ref 404s and the plan branch is three hours old, so it is in neither')

  // run 27 — nothing answers.
  assert.equal(staleOf(result, 27), undefined,
    '(d)/M2 run 27: every read 404s, so it has no age from any source and is in neither')
  assert.equal(actionVms(result).includes(vm(27)), false,
    '(d)/M2 run 27: and in no action')

  // run 28 — a JSON array is no tag.
  const s28 = staleOf(result, 28)
  assert.equal(s28.from, planBranchFor(28),
    '(d)/M3 run 28: a tag ref answering a JSON array carries no .object.sha, so the plan branch answers and `from` is ultra/plan-run-28')
  assert.equal(s28.lastUpdate, SEVEN, '(d)/M2 run 28: aged from the branch document')

  // run 29 — a non-hex sha is no sha, and is never spliced into a path.
  const s29 = staleOf(result, 29)
  assert.equal(s29.from, planBranchFor(29),
    '(d)/M3 run 29: `.object.sha` of `not-a-sha` is not hex, so the plan branch answers and `from` is ultra/plan-run-29')
  assert.deepEqual(ghPaths(exec).filter((p) => p.includes('not-a-sha')), [],
    '(d)/M2 run 29: no gh path contains not-a-sha — an unchecked value is never spliced into a path')

  // run 30 — no `.object.sha` at all.
  const s30 = staleOf(result, 30)
  assert.equal(s30.from, planBranchFor(30),
    '(d)/M3 run 30: a tag ref with no .object.sha at all falls to the plan branch, so `from` is ultra/plan-run-30')
  assert.equal(s30.lastUpdate, SEVEN, '(d)/M2 run 30: aged from the branch document')

  // run 31 — exactly six hours is stale; run 32 — a minute short is not.
  const s31 = staleOf(result, 31)
  assert.equal(s31.from, planTagFor(31),
    '(d)/M3 run 31: a tag commit exactly six hours old is stale, from ultra/plan/run-31')
  assert.equal(s31.lastUpdate, SIX, '(d)/M2 run 31: with that commit date as its lastUpdate')
  assert.equal(staleOf(result, 32), undefined,
    '(d)/M2 run 32: five hours and fifty-nine minutes is younger than six hours, so it is in neither')

  assert.deepEqual(sorted(commitReads(exec)), sorted(TAGGED.map((n) => commitPath(TARGET, tagSha(n)))),
    '(d)/M2 across these ten rows the only commits/ reads are runs 21, 24, 31 and 32\'s, each at its own tag\'s .object.sha: runs 25, 26, 27, 28, 29 and 30 issue none')
}

// ═══════════════════════════════════════════════════════════════════════════
// (e) every stale entry names the ref it was aged from, and prints it [M3]
// ═══════════════════════════════════════════════════════════════════════════
{
  const SILENT = { run: 61, state: 'running', updatedAt: hoursAgo(7) }
  const exec = newExec([
    ...lsRules([row(61), row(62), row(63)]),
    ghRule({
      pages: {
        ...pagesAt(tagPagePath, [[61, SILENT]]),
        ...pagesAt(branchPagePath, [[62, { ...SILENT, run: 62 }]]),
        ...pagesAt(tagPagePath, [[63, { run: 63, state: 'running', updatedAt: minutesAgo(1) }]])
      }
    })
  ])
  const result = await janitor({ argv: [], exec, config: CONFIG, now: () => NOW })

  assert.deepEqual(sorted(staleRuns(result).map(String)), sorted(['61', '62']),
    '(e)/M3 a running row silent seven hours is stale whichever ref served its page; run 63, updated a minute ago, is not')
  assert.equal(staleOf(result, 61).from, evidenceTagFor(61),
    '(e)/M3 run 61: its page came from the evidence tag, so `from` is ultra/evidence/run-61')
  assert.equal(staleOf(result, 62).from, evidenceBranchFor(62),
    '(e)/M3 run 62: the same page on the branch gives `from` ultra/evidence-run-62')
  assert.equal(staleOf(result, 61).lastUpdate, hoursAgo(7),
    '(e)/M3 run 61: aged from the page\'s updatedAt, never created_at')

  const printed = renderJanitor(result)
  for (const [n, from] of [[61, evidenceTagFor(61)], [62, evidenceBranchFor(62)]]) {
    assert.match(
      printed,
      new RegExp(`^stale ${esc(vm(n))}  run=${n} state=running last update ${esc(hoursAgo(7))} \\(${esc(from)}\\) — look before you rm$`, 'm'),
      `(e)/M3 run ${n}: rendered as \`stale <vm>  run=<N> state=running last update <iso> (${from}) — look before you rm\``
    )
  }

  // The page-less stale lines of leg (d) keep the same shape, with state=none.
  const printedD = renderJanitor(LEG_D_RESULT)
  for (const entry of LEG_D_RESULT.stale) {
    assert.match(
      printedD,
      new RegExp(`^stale ${esc(entry.vm)}  run=${entry.run} state=none last update ${esc(entry.lastUpdate)} \\(${esc(entry.from)}\\) — look before you rm$`, 'm'),
      `(e)/M3 run ${entry.run}: a page-less stale row prints the same line with state=none and its own from (${entry.from})`
    )
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// (f) #607's death, written to the branch whichever ref served the page [M4]
// ═══════════════════════════════════════════════════════════════════════════

const DEAD_UNIT = {
  ActiveState: 'failed', SubState: 'failed', Result: 'exit-code', ExecMainStatus: '1'
}
const ALIVE_UNIT = {
  ActiveState: 'active', SubState: 'running', Result: 'success', ExecMainStatus: '0'
}
const blobSha = (n) => String(n).repeat(20).slice(0, 40)
const livePage = (n) => ({
  run: n,
  state: 'running',
  phase: 'implement',
  pr: `https://github.com/${TARGET}/pull/${100 + n}`,
  branch: `ultra/run-${n}`,
  vm: vm(n),
  startedAt: minutesAgo(90),
  updatedAt: minutesAgo(1)
})
const journalText = (n) =>
  `-- journal for fleet-run@${n}.service --\nSep 05 11:59:02 ${vm(n)} run[${n}]: engine exited\n`
/** The cells that ride through the write untouched. */
const CARRIED = ['run', 'pr', 'branch', 'vm', 'startedAt']

/** One dead row, its page served from `at`. */
const deadExec = (n, at) => {
  noteLive(n, livePage(n))
  return newExec([
    ...lsRules([row(n)]),
    ghRule({ pages: { [at(TARGET, n)]: { page: livePage(n), sha: blobSha(n) } } }),
    vmAnswers({
      [dest(n)]: (command) =>
        (command.startsWith(JOURNAL_READ) ? answer(journalText(n)) : answer(unitText(DEAD_UNIT)))
    })
  ])
}

/** The two writes of one death, checked against the branch and the read sha. */
const assertDeathWrites = (exec, n, label) => {
  const written = putsTo(exec, statusPath(TARGET, n))
  assert.equal(written.length, 1,
    `${label}/M4 run ${n}: exactly one gh call has -X PUT and the path ${statusPath(TARGET, n)}`)
  const fields = fieldsOf(written[0])
  assert.equal(fields.branch, evidenceBranchFor(n),
    `${label}/M4 run ${n}: the status write carries -f branch=${evidenceBranchFor(n)} — the death goes to the branch, never to ${evidenceTagFor(n)}`)
  assert.equal(fields.sha, blobSha(n),
    `${label}/M4 run ${n}: and -f sha=<the sha of the envelope the page was read from>`)
  const body = JSON.parse(decode(fields.content))
  assert.equal(body.state, 'failed',
    `${label}/M4 run ${n}: its content= decodes to the page with state failed`)
  assert.equal(body.updatedAt, NOW_ISO,
    `${label}/M4 run ${n}: with updatedAt the janitor's clock as ISO-8601`)
  for (const key of CARRIED) {
    assert.deepEqual(body[key], livePage(n)[key],
      `${label}/M4 run ${n}: ${key} rides through the write unchanged`)
  }

  const journals = putsTo(exec, journalPath(TARGET, n))
  assert.equal(journals.length, 1,
    `${label}/M4 run ${n}: exactly one gh call has -X PUT and the path ${journalPath(TARGET, n)}`)
  const jf = fieldsOf(journals[0])
  assert.equal(jf.branch, evidenceBranchFor(n),
    `${label}/M4 run ${n}: the journal write carries the same -f branch=${evidenceBranchFor(n)}`)
  assert.deepEqual(journals[0].argv.filter((a) => String(a).startsWith('sha=')), [],
    `${label}/M4 run ${n}: and no sha= — janitor-journal.txt is a new file`)
  assert.equal(decode(jf.content), journalText(n),
    `${label}/M4 run ${n}: its content= decodes to the journal read's stdout byte for byte`)

  assert.deepEqual(puts(exec).map((c) => pathOf(c.argv)).sort(),
    [journalPath(TARGET, n), statusPath(TARGET, n)].sort(),
    `${label}/M4 run ${n}: those two writes are the only -X PUT calls of the pass`)
  assert.deepEqual(ghPaths(exec).filter((p) => p.includes(evidenceTagFor(n))).filter((p) => !p.includes('?ref=')), [],
    `${label}/M4 run ${n}: no write path names the evidence tag`)
}

{
  // The page on the branch, the tag 404.
  const onBranch = deadExec(71, branchPagePath)
  const result = await janitor({ argv: [], exec: onBranch, config: CONFIG, now: () => NOW })

  assert.deepEqual(readsFor(onBranch, 71), [tagPagePath(TARGET, 71), branchPagePath(TARGET, 71)],
    '(f)/M1 run 71: the tag is read first and answers nothing, so the branch answers')
  assert.deepEqual(unitReads(onBranch), [{ dest: dest(71), command: unitCommand(71) }],
    '(f)/M4 run 71: exactly one unit read, at the row\'s own ssh_dest')
  assert.deepEqual(journalReads(onBranch), [{ dest: dest(71), command: journalCommand(71) }],
    '(f)/M4 run 71: exactly one journal read, to the same destination')
  assertDeathWrites(onBranch, 71, '(f)')

  assert.deepEqual(result.deaths, [{
    vm: vm(71), run: 71, state: 'running', unit: DEAD_UNIT, applied: true
  }], '(f)/M4 run 71: the row is in deaths with applied true')
  assert.deepEqual(result.actions, [], '(f)/M4 run 71: and in no action')
  assert.deepEqual(onBranch.mutating(), [], '(f)/M4 run 71: the pass that wrote the death reaps nothing')
}

{
  // The same dead row with its page served from the tag, the branch 404.
  const onTag = deadExec(72, tagPagePath)
  const result = await janitor({ argv: [], exec: onTag, config: CONFIG, now: () => NOW })

  assert.deepEqual(readsFor(onTag, 72), [tagPagePath(TARGET, 72)],
    '(f)/M1 run 72: the tag answered a contents envelope, so the branch is not read')
  assert.deepEqual(unitReads(onTag), [{ dest: dest(72), command: unitCommand(72) }],
    '(f)/M4 run 72: the unit read fires for a live page served by the tag too')
  assert.deepEqual(journalReads(onTag), [{ dest: dest(72), command: journalCommand(72) }],
    '(f)/M4 run 72: and the journal read beside it')
  assertDeathWrites(onTag, 72, '(f)')

  assert.deepEqual(result.deaths, [{
    vm: vm(72), run: 72, state: 'running', unit: DEAD_UNIT, applied: true
  }], '(f)/M4 run 72: the row is in deaths with applied true')
  assert.deepEqual(result.actions, [], '(f)/M4 run 72: and in no action')
}

{
  // The same row whose unit is alive: nothing is written, nothing is journalled.
  noteLive(73, livePage(73))
  const alive = newExec([
    ...lsRules([row(73)]),
    ghRule({ pages: { [tagPagePath(TARGET, 73)]: { page: livePage(73), sha: blobSha(73) } } }),
    vmAnswers({ [dest(73)]: () => answer(unitText(ALIVE_UNIT)) })
  ])
  const result = await janitor({ argv: [], exec: alive, config: CONFIG, now: () => NOW })

  assert.deepEqual(ghCalls(alive).filter((c) => c.argv.includes('-X')).map((c) => c.line), [],
    '(f)/M4 run 73: a live unit draws no gh call carrying -X')
  assert.deepEqual(journalReads(alive), [],
    '(f)/M4 run 73: and no journal read')
  assert.deepEqual(result.deaths, [], '(f)/M4 run 73: nothing in deaths')
  assert.deepEqual(alive.mutating(), [], '(f)/M4 run 73: and no rm')
}

// ═══════════════════════════════════════════════════════════════════════════
// (g) unknown rows, --dry-run, and the surface the janitor may touch [M5]
// ═══════════════════════════════════════════════════════════════════════════
{
  const exec = newExec([
    ...lsRules([vmRow(vm(20)), vmRow(vm(12), { comment: 'run=12 base=abc' })]),
    ghRule({})
  ])
  const result = await janitor({ argv: [], exec, config: CONFIG, now: () => NOW })

  assert.deepEqual(sorted(unknownVms(result)), sorted([vm(20), vm(12)]),
    '(g)/M5 a row with no comment and a row whose comment is `run=12 base=abc` with no target= both land in unknown')
  assert.deepEqual(ghPaths(exec).filter((p) => mentions(p, 12) || mentions(p, 20)), [],
    '(g)/M5 an unreadable assignment causes no gh api read naming run 12 or run 20')
  assert.deepEqual(exec.mutating(), [], '(g)/M5 and nothing is removed')
  assert.deepEqual(result.actions, [], '(g)/M5 and nothing is reported as an action')

  const printed = renderJanitor(result)
  for (const n of [20, 12]) {
    assert.equal(printed.includes(`unknown ${vm(n)}  no readable assignment — look before you rm`), true,
      `(g)/M5 run ${n}'s row is printed verbatim: \`unknown <vm>  no readable assignment — look before you rm\``)
  }
}

{
  // --dry-run over the fleet of leg (a): the same reads, and no rm.
  const wet = legAExec()
  const applied = await janitor({ argv: [], exec: wet, config: CONFIG, now: () => NOW })
  const dry = legAExec()
  const result = await janitor({ argv: ['--dry-run'], exec: dry, config: CONFIG, now: () => NOW })

  assert.deepEqual(ghPaths(dry), ghPaths(wet),
    '(g)/M5 --dry-run issues exactly the same gh api paths')
  assert.deepEqual(lsReads(dry), lsReads(wet),
    '(g)/M5 and exactly the same ls read')
  assert.deepEqual(dry.mutating(), [], '(g)/M5 and no rm')
  assert.deepEqual(sorted(actionVms(result)), sorted(actionVms(applied)),
    '(g)/M5 it still reports the four rows it would have removed')
  assert.equal(result.actions.every((a) => a.applied === false), true,
    '(g)/M5 unapplied')
  assert.equal(result.dryRun, true, '(g)/M5 and says so')
  assert.match(renderJanitor(result), new RegExp(`^would rm ${esc(vm(3))}  run=3 done since `, 'm'),
    '(g)/M5 printed as "would rm", keeping the line shape')
  assert.equal(renderJanitor({ dryRun: false, age: '1h', actions: [], stale: [], unknown: [], deaths: [] }),
    'nothing to do', '(g)/M5 an empty result still says so')
}

{
  // The only file read under ~/.ultrapowers/ is fleet.json.
  const home = tempDir('fleet-janitor-home-')
  const dot = path.join(home, '.ultrapowers')
  fs.mkdirSync(path.join(dot, 'runs', '3'), { recursive: true })
  fs.writeFileSync(path.join(dot, 'fleet.json'), JSON.stringify(CONFIG))
  // A canary: a status page saying run 3 finished a day ago. A janitor that
  // read it would reap run 3; the target — the only reader — answers 404.
  fs.writeFileSync(path.join(dot, 'runs', '3', 'status.json'),
    JSON.stringify({ run: 3, state: 'done', updatedAt: hoursAgo(24) }))
  // Spelled in two halves on purpose: the string itself is banned under fleet/.
  const sideRepo = path.join(dot, ['fleet', 'runs'].join('-'), 'plans')
  fs.mkdirSync(sideRepo, { recursive: true })
  fs.writeFileSync(path.join(sideRepo, 'run-3.md'), '# run 3\n')

  const exec = newExec([
    ...lsRules([row(3)]),
    ghRule({ plans: { [planBranchPath(TARGET, 3)]: SEVEN } })
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
    '(g)/M5 the run-3 VM is not removed: the canary status page under ~/.ultrapowers/ is not a reader the janitor has')
  assert.deepEqual(result.actions, [],
    '(g)/M5 and run 3 is in no action')
  assert.equal(
    staleRuns(result).includes(3) || unknownVms(result).includes(vm(3)), true,
    '(g)/M5 run 3 appears in stale or unknown — never in actions')
  cleanup(home)
}

// ── (g) across every exec of every leg [M5] ─────────────────────────────────
for (const [i, exec] of EXECS.entries()) {
  for (const call of ghCalls(exec)) {
    if (call.argv.includes('-X')) continue
    assert.equal(call.argv.length, 2,
      `(g)/M5 leg ${i}: every gh call that is not one of #607's -X PUT writes is exactly two argv words, got ${JSON.stringify(call.argv)}`)
    assert.equal(call.argv[0], 'api', `(g)/M5 leg ${i}: the first word is \`api\``)
    assert.equal(String(call.argv[1]).startsWith('repos/'), true,
      `(g)/M5 leg ${i}: the second is a path beginning repos/, got ${JSON.stringify(call.argv[1])}`)
  }
  assert.deepEqual(exec.calls.filter((c) => c.cmd === 'git').map((c) => c.line), [],
    `(g)/M5 leg ${i}: the janitor issues no git command`)
  for (const call of exec.vm()) {
    assert.equal(LIVE_DESTS.has(call.dest), true,
      `(g)/M5 leg ${i}: every ssh <ssh_dest> goes to the ssh_dest of a row whose page said booting|running|publishing, and ${call.dest} is not one`)
    assert.equal(
      call.command.startsWith(UNIT_READ) || call.command.startsWith(JOURNAL_READ), true,
      `(g)/M5 leg ${i}: the only commands run on a VM are the unit read and the journal read, not ${JSON.stringify(call.command)}`)
  }
}

console.log('ALL TESTS PASSED')

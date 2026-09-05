/**
 * fleet/tests/test_janitor.mjs — the expiry, read by tag: reap done/parked/failed.
 *
 * The janitor reads the *target*, never a side repository and never a VM. Its
 * only reads are one `ls 'fleet-r*' --json` through the lobby and `gh api` on
 * the laptop, through the same exec seam; this exam cans both. A finished run's
 * branches are gone — the boot's `record_tags` deletes them once the two tags
 * verify — so the tag is where the janitor looks first and the branch is only
 * the fallback the one-time sweep still needs.
 *
 * What is pinned, clause by clause:
 *
 *   M1 — every row's state comes from
 *        `gh api repos/<target>/contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence/run-<N>`
 *        as the answer's base64 `content`; the same path with
 *        `?ref=ultra/evidence-run-<N>` is issued only when the tag read answers
 *        no contents envelope, and never when the tag answered a page; a page
 *        found on either ref drives the same verdict, `rm <vm> --json` for
 *        `done|parked|failed` older than `--age` (default `1h`) and nothing else;
 *   M2 — with neither ref answering a page, the age is the plan tag's commit —
 *        `git/ref/tags/ultra/plan/run-<N>` for `.object.sha`, then
 *        `commits/<sha>` for `.commit.committer.date` — and only a tag ref that
 *        answers no sha sends the reader on to `branches/ultra/plan-run-<N>`
 *        and its `.commit.commit.committer.date`; over six hours is `stale`,
 *        younger is left alone, and no age at all is neither;
 *   M3 — every `stale` entry's `from` is the ref its state or its age was read
 *        from — `ultra/evidence/run-<N>`, `ultra/evidence-run-<N>`,
 *        `ultra/plan/run-<N>` or `ultra/plan-run-<N>` — and `renderJanitor`
 *        prints it in the parentheses of the `stale` line;
 *   M4 — everything else holds as at BASE: `--dry-run` reads the same and
 *        removes nothing, a row with no comment or no `target=` is `unknown`
 *        and causes no read, every `gh` call is two argv words, and there is no
 *        `git`, no `ssh <ssh_dest>`, and nothing under `~/.ultrapowers/` but
 *        `fleet.json`.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { evidenceBranchFor, evidenceTagFor, planBranchFor, planTagFor } from '../lobby.mjs'
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

// ── The four `gh api` paths the contract names ──────────────────────────────

/** The status page, on whichever ref the caller asks for. */
const contentsPath = (target, run, ref) =>
  `repos/${target}/contents/.ultrapowers/runs/${run}/status.json?ref=${ref}`
const tagContentsPath = (target, run) => contentsPath(target, run, evidenceTagFor(run))
const branchContentsPath = (target, run) => contentsPath(target, run, evidenceBranchFor(run))
/** The plan tag's ref document, whose `.object.sha` is the plan commit. */
const planTagPath = (target, run) => `repos/${target}/git/ref/tags/${planTagFor(run)}`
/** That commit, whose date is one level shallower than the branch document's. */
const commitPath = (target, sha) => `repos/${target}/commits/${sha}`
/** The plan branch, read only when the tag ref answered no sha. */
const planBranchPath = (target, run) => `repos/${target}/branches/${planBranchFor(run)}`

/** A distinct, well-shaped commit sha per run, so a `commits/` read is traceable. */
const planSha = (run) => `c0ffee${String(run).padStart(2, '0')}`.padEnd(40, '0')

/** What `gh api` prints for an absent file: exit 1, `HTTP 404` on stderr. */
const NOT_FOUND = answer('', { code: 1, stderr: 'gh: Not Found (HTTP 404)' })

/** The contents envelope: the status page, base64, under `content`. */
const envelope = (status) => answer({
  content: Buffer.from(JSON.stringify(status), 'utf8').toString('base64'),
  encoding: 'base64'
})

/** A lightweight tag's ref document: `{ ref, object: { sha, type } }`. */
const tagDoc = (run, sha) => answer({
  ref: `refs/tags/${planTagFor(run)}`,
  object: { sha, type: 'commit' }
})
/** The commit document, of which only `.commit.committer.date` is read. */
const commitDoc = (date) => answer({ sha: 'x', commit: { committer: { date } } })
/** The branch document, whose date sits one level deeper. */
const branchDoc = (date) => answer({ commit: { commit: { committer: { date } } } })

/**
 * `gh api <path>` answers only the paths a leg canned; every other path is a
 * 404, so a read at the wrong path cannot look like a read at the right one.
 */
const ghRule = ({ contents = {}, tags = {}, commits = {}, branches = {} } = {}) =>
  cmdRule('gh', 'api', (cmd, argv) => {
    const p = argv.find((a) => typeof a === 'string' && a.startsWith('repos/'))
    if (p === undefined) return NOT_FOUND
    if (Object.hasOwn(contents, p)) {
      const canned = contents[p]
      // `{ raw: … }` is the status page served bare, without the envelope.
      return canned && canned.raw !== undefined ? answer(JSON.stringify(canned.raw)) : envelope(canned)
    }
    if (Object.hasOwn(tags, p)) return tagDoc(tags[p].run, tags[p].sha)
    if (Object.hasOwn(commits, p)) return commitDoc(commits[p])
    if (Object.hasOwn(branches, p)) return branchDoc(branches[p])
    return NOT_FOUND
  })

/** `contents:` for a whole fleet on one ref family, `[[run, status], …]`. */
const pagesOn = (pathFor, entries, { target = TARGET, wrap = (s) => s } = {}) =>
  Object.fromEntries(entries.map(([run, status]) => [pathFor(target, run), wrap(status)]))

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

/** Every exec this exam built, so leg (f)'s sweeps cover every leg. */
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
const tagRefReads = (exec) => ghPaths(exec).filter((p) => p.includes('/git/ref/tags/'))
const commitReads = (exec) => ghPaths(exec).filter((p) => p.includes('/commits/'))
const branchReads = (exec) => ghPaths(exec).filter((p) => p.includes('/branches/'))
const lsReads = (exec) => exec.lobby().filter((line) => line.startsWith('ls '))
const sorted = (xs) => [...xs].sort()

const vmOf = (entry) => (typeof entry === 'string' ? entry : entry?.vm ?? entry?.name)
const unknownVms = (result) => (result.unknown ?? []).map(vmOf)
const actionVms = (result) => (result.actions ?? []).map((a) => a.vm)
const staleRuns = (result) => (result.stale ?? []).map((s) => s.run)
const staleOf = (result, run) => (result.stale ?? []).find((s) => s.run === run)
/** Does a `gh api` path speak about run N at all? */
const mentions = (p, n) => p.includes(`/runs/${n}/`) || new RegExp(`run-${n}$`).test(p)
/** Every contents read that speaks about run N, in the order they were issued. */
const readsFor = (exec, n) => contentsReads(exec).filter((p) => p.includes(`/runs/${n}/`))

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** BASE's `stale` line, with the ref that answered inside the parentheses. */
const staleLine = (vmName, run, state, iso, from) =>
  new RegExp(`^stale ${esc(vmName)} {2}run=${run} state=${state} last update ${esc(iso)} \\(${esc(from)}\\) — look before you rm$`, 'm')

// ── The fleet of legs (a) and (b): nine rows, nine states ───────────────────

const FLEET_STATES = [
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
const FLEET = FLEET_STATES.map(([n]) => row(n))
const FLEET_RUNS = FLEET_STATES.map(([n]) => n)
const FLEET_RM = [3, 4, 8, 13].map((n) => `rm ${vm(n)} --json`)
const TAG_READS = FLEET_RUNS.map((n) => tagContentsPath(TARGET, n))
const BRANCH_READS = FLEET_RUNS.map((n) => branchContentsPath(TARGET, n))

/** The whole fleet's pages canned on one ref family and nowhere else. */
const fleetExec = (pathFor, { wrap } = {}) =>
  newExec([...lsRules(FLEET), ghRule({ contents: pagesOn(pathFor, FLEET_STATES, { wrap }) })])

// ── (a) the page is read at the evidence tag, and only there [M1] ───────────
{
  const exec = fleetExec(tagContentsPath)
  const result = await janitor({ argv: [], exec, config: CONFIG, now: () => NOW })

  assert.deepEqual(lsReads(exec), ["ls 'fleet-r*' --json"],
    '(a)/M1 one fleet-wide read: the janitor works from the `ls \'fleet-r*\' --json` rows')
  assert.deepEqual(sorted(contentsReads(exec)), sorted(TAG_READS),
    '(a)/M1 with the page canned at the tag, every row gets exactly one contents read, at repos/<target>/contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence/run-<N>')
  for (const n of FLEET_RUNS) {
    assert.deepEqual(readsFor(exec, n), [tagContentsPath(TARGET, n)],
      `(a)/M1 run ${n}: one read, and a page found on the tag issues no branch read for that row`)
  }
  assert.deepEqual(ghPaths(exec).filter((p) => p.includes('ultra/evidence-run-')), [],
    '(a)/M1 no gh path names ultra/evidence-run- at all when the tag answered')

  assert.deepEqual(sorted(exec.mutating()), sorted(FLEET_RM),
    '(a)/M1 with no --age: runs 3 (done), 4 (parked), 8 (failed) two hours old and 13 (done, 61 minutes) go; run 14 stays — the default is one hour, not less; 5 is 30 minutes old, 6 is running, 10 is booting and 11 is publishing')
  assert.deepEqual(sorted(actionVms(result)), sorted([3, 4, 8, 13].map((n) => vm(n))),
    '(a)/M1 four rm actions, one per row')
  assert.equal(result.actions.every((a) => a.kind === 'rm' && a.command === `rm ${a.vm} --json`), true,
    '(a)/M1 every action is `rm <vm> --json` — the reap is the only mutation')
  assert.equal(result.actions.every((a) => a.applied), true,
    '(a)/M1 and they were applied')
  assert.equal(result.age, '1h', '(a)/M1 the default age is 1h')
  assert.equal(result.dryRun, false, '(a)/M1 this run was not a dry run')
  assert.deepEqual(result.stale, [],
    '(a)/M1 nothing here is stale: the three-hour-old booting (run 10) and publishing (run 11) rows are in neither stale nor actions')
  assert.equal(Array.isArray(result.unknown), true,
    '(a)/M1 the result carries { dryRun, age, actions, stale, unknown }')
  assert.deepEqual(unknownVms(result), [],
    '(a)/M1 every row here has a readable assignment')

  // --age 3h moves the bar past all four, and reads exactly the same.
  const exec3h = fleetExec(tagContentsPath)
  const older = await janitor({ argv: ['--age', '3h'], exec: exec3h, config: CONFIG, now: () => NOW })
  assert.deepEqual(exec3h.mutating(), [],
    '(a)/M1 --age 3h over the same fleet removes nothing at all')
  assert.deepEqual(older.actions, [], '(a)/M1 and reports no action')
  assert.equal(older.age, '3h', '(a)/M1 --age is echoed back')
  assert.deepEqual(sorted(contentsReads(exec3h)), sorted(TAG_READS),
    '(a)/M1 --age 3h still issues every tag read')
}

// ── (b) no page on the tag: the branch is read second, same verdict [M1] ────
{
  const exec = fleetExec(branchContentsPath)
  const result = await janitor({ argv: [], exec, config: CONFIG, now: () => NOW })

  for (const n of FLEET_RUNS) {
    assert.deepEqual(readsFor(exec, n),
      [tagContentsPath(TARGET, n), branchContentsPath(TARGET, n)],
      `(b)/M1 run ${n}: the tag path is read first and the branch path second, in that order`)
  }
  assert.deepEqual(sorted(contentsReads(exec)), sorted([...TAG_READS, ...BRANCH_READS]),
    '(b)/M1 two contents reads per row and no third')
  assert.deepEqual(sorted(exec.mutating()), sorted(FLEET_RM),
    '(b)/M1 a page found on the branch drives the same verdict as one found on the tag: the same four rm <vm> --json')
  assert.deepEqual(sorted(actionVms(result)), sorted([3, 4, 8, 13].map((n) => vm(n))),
    '(b)/M1 the same four actions')
  assert.deepEqual(result.stale, [], '(b)/M1 and nothing stale')

  // The path carries the row's own target and the row's own run.
  const other = [row(9, { target: 'other/repo' })]
  const otherPages = pagesOn(branchContentsPath,
    [[9, { run: 9, state: 'done', updatedAt: hoursAgo(2) }]], { target: 'other/repo' })
  const execOther = newExec([...lsRules(other), ghRule({ contents: otherPages })])
  const result9 = await janitor({ argv: [], exec: execOther, config: CONFIG, now: () => NOW })

  assert.deepEqual(contentsReads(execOther), [
    'repos/other/repo/contents/.ultrapowers/runs/9/status.json?ref=ultra/evidence/run-9',
    'repos/other/repo/contents/.ultrapowers/runs/9/status.json?ref=ultra/evidence-run-9'
  ], '(b)/M1 a row whose comment reads target=other/repo is read under repos/other/repo/contents/.ultrapowers/runs/9/status.json, ?ref=ultra/evidence/run-9 first and ?ref=ultra/evidence-run-9 second')
  assert.deepEqual(execOther.mutating(), [`rm ${vm(9)} --json`],
    '(b)/M1 the second read landed: every other path answers 404, so the rm proves the exact path')
  assert.deepEqual(actionVms(result9), [vm(9)], '(b)/M1 one action, for run 9')
}

// ── (c) a page served bare, on either ref, is not a page [M1] ───────────────
{
  const bare = (s) => ({ raw: s })
  const execTag = fleetExec(tagContentsPath, { wrap: bare })
  const fromTag = await janitor({ argv: [], exec: execTag, config: CONFIG, now: () => NOW })
  assert.deepEqual(execTag.mutating(), [],
    '(c)/M1 with the tag read answering the raw status JSON instead of the contents envelope, no row is removed')
  assert.deepEqual(fromTag.actions, [], '(c)/M1 and no action is reported')

  const execBranch = fleetExec(branchContentsPath, { wrap: bare })
  const fromBranch = await janitor({ argv: [], exec: execBranch, config: CONFIG, now: () => NOW })
  assert.deepEqual(execBranch.mutating(), [],
    '(c)/M1 and with the branch read answering it bare, likewise: no row is removed')
  assert.deepEqual(fromBranch.actions, [], '(c)/M1 and no action is reported')
}

// ── (d) no page at all: the plan tag's commit is the age [M2, M3] ───────────
const PLAN_STALE = '2026-09-03T05:00:00Z' // seven hours before NOW
const PLAN_FRESH = '2026-09-03T09:00:00Z' // three hours before NOW
let pageless
{
  const fleet = [row(21), row(24), row(25), row(26), row(27)]
  const exec = newExec([
    ...lsRules(fleet),
    ghRule({
      // 21 and 24 have their plan tag; 25 and 26 have only the plan branch;
      // 27 has neither, so every read it makes answers 404.
      tags: {
        [planTagPath(TARGET, 21)]: { run: 21, sha: planSha(21) },
        [planTagPath(TARGET, 24)]: { run: 24, sha: planSha(24) }
      },
      commits: {
        [commitPath(TARGET, planSha(21))]: PLAN_STALE,
        [commitPath(TARGET, planSha(24))]: PLAN_FRESH
      },
      branches: {
        [planBranchPath(TARGET, 25)]: PLAN_STALE,
        [planBranchPath(TARGET, 26)]: PLAN_FRESH
      }
    })
  ])
  pageless = await janitor({ argv: [], exec, config: CONFIG, now: () => NOW })

  assert.deepEqual(sorted(staleRuns(pageless)), [21, 25],
    '(d)/M2 stale is exactly run 21 (plan tag commit seven hours old) and run 25 (plan branch seven hours old); run 24 and run 26 are three hours old and run 27 has no age at all')
  assert.deepEqual(pageless.actions, [],
    '(d)/M2 a run with no page is never an action')
  assert.deepEqual(exec.mutating(), [],
    '(d)/M2 and nothing in this fleet is removed')

  const s21 = staleOf(pageless, 21)
  assert.equal(s21.vm, vm(21), '(d)/M2 the stale entry names the VM')
  assert.equal(s21.state, null, '(d)/M2 a run with no page has no state')
  assert.equal(Date.parse(s21.lastUpdate), Date.parse(PLAN_STALE),
    '(d)/M2 run 21 is aged from the plan tag commit\'s .commit.committer.date')
  assert.equal(s21.from, 'ultra/plan/run-21',
    '(d)/M3 and says so: from is ultra/plan/run-21')
  assert.equal(ghPaths(exec).includes(planBranchPath(TARGET, 21)), false,
    '(d)/M2 the plan branch is never read for run 21: the tag ref answered a sha')

  const s25 = staleOf(pageless, 25)
  assert.equal(s25.vm, vm(25), '(d)/M2 run 25 is named too')
  assert.equal(Date.parse(s25.lastUpdate), Date.parse(PLAN_STALE),
    '(d)/M2 aged from the plan branch\'s .commit.commit.committer.date, as at BASE')
  assert.equal(s25.from, 'ultra/plan-run-25',
    '(d)/M3 with from = ultra/plan-run-25, the ref that answered')

  assert.deepEqual(sorted(tagRefReads(exec)),
    sorted([21, 24, 25, 26, 27].map((n) => planTagPath(TARGET, n))),
    '(d)/M2 every page-less row is aged from repos/<target>/git/ref/tags/ultra/plan/run-<N> first')
  assert.deepEqual(sorted(commitReads(exec)),
    sorted([21, 24].map((n) => commitPath(TARGET, planSha(n)))),
    '(d)/M2 the sha the tag ref answered is read at repos/<target>/commits/<sha>, and only for the two rows whose tag answered one — run 25 gets no commits/ read')
  assert.deepEqual(sorted(branchReads(exec)),
    sorted([25, 26, 27].map((n) => planBranchPath(TARGET, n))),
    '(d)/M2 only a tag ref answering no .object.sha sends the reader on to repos/<target>/branches/ultra/plan-run-<N>')

  assert.equal(staleRuns(pageless).includes(27), false,
    '(d)/M2 run 27, with every read a 404, is not stale')
  assert.deepEqual(actionVms(pageless).filter((v) => v === vm(27)), [],
    '(d)/M2 and not an action either')
}

// ── (e) `from` names the ref that answered, and it is printed [M3] ──────────
{
  const silent = [[22, { run: 22, state: 'running', updatedAt: hoursAgo(7) }]]
  const fresh = [[23, { run: 23, state: 'running', updatedAt: minutesAgo(1) }]]
  const fleet = [row(22), row(23)]

  const execTag = newExec([...lsRules(fleet),
    ghRule({ contents: pagesOn(tagContentsPath, [...silent, ...fresh]) })])
  const fromTag = await janitor({ argv: [], exec: execTag, config: CONFIG, now: () => NOW })

  assert.deepEqual(staleRuns(fromTag), [22],
    '(e)/M3 a running row silent for seven hours is stale; run 23, updated a minute ago, is not')
  assert.equal(staleOf(fromTag, 22).state, 'running',
    '(e)/M3 carrying the state its page reported')
  assert.equal(staleOf(fromTag, 22).from, 'ultra/evidence/run-22',
    '(e)/M3 a page read from the tag gives from = ultra/evidence/run-22')
  assert.deepEqual(execTag.mutating(), [], '(e)/M3 and a stale row is reported, never removed')
  assert.match(renderJanitor(fromTag),
    staleLine(vm(22), 22, 'running', new Date(Date.parse(hoursAgo(7))).toISOString(), 'ultra/evidence/run-22'),
    '(e)/M3 printed as `stale <vm>  run=22 state=running last update <iso> (ultra/evidence/run-22) — look before you rm`')

  const execBranch = newExec([...lsRules(fleet),
    ghRule({ contents: pagesOn(branchContentsPath, [...silent, ...fresh]) })])
  const fromBranch = await janitor({ argv: [], exec: execBranch, config: CONFIG, now: () => NOW })

  assert.deepEqual(staleRuns(fromBranch), [22],
    '(e)/M3 the same page canned at the branch path is the same verdict')
  assert.equal(staleOf(fromBranch, 22).from, 'ultra/evidence-run-22',
    '(e)/M3 but from = ultra/evidence-run-22, the ref that actually answered')
  assert.match(renderJanitor(fromBranch),
    staleLine(vm(22), 22, 'running', new Date(Date.parse(hoursAgo(7))).toISOString(), 'ultra/evidence-run-22'),
    '(e)/M3 and the printed line carries that ref in its parentheses')

  // The page-less stale lines of leg (d), in the same shape, with state=none.
  const printed = renderJanitor(pageless)
  assert.match(printed,
    staleLine(vm(21), 21, 'none', new Date(Date.parse(PLAN_STALE)).toISOString(), 'ultra/plan/run-21'),
    '(e)/M3 the plan-tag-aged row prints the same line shape with state=none and (ultra/plan/run-21)')
  assert.match(printed,
    staleLine(vm(25), 25, 'none', new Date(Date.parse(PLAN_STALE)).toISOString(), 'ultra/plan-run-25'),
    '(e)/M3 and the plan-branch-aged row prints (ultra/plan-run-25)')
  assert.equal(/^(would )?rm /m.test(printed), false,
    '(e)/M3 no rm line is printed for a fleet with no action')
}

// ── (f) unknown rows, --dry-run, and what is never issued [M4] ──────────────
{
  const fleet = [vmRow(vm(20)), vmRow(vm(12), { comment: 'run=12 base=abc' })]
  const exec = newExec([...lsRules(fleet), ghRule({})])
  const result = await janitor({ argv: [], exec, config: CONFIG, now: () => NOW })

  assert.deepEqual(sorted(unknownVms(result)), sorted([vm(20), vm(12)]),
    '(f)/M4 a row with no comment and a row whose comment is `run=12 base=abc` with no target= both land in unknown')
  assert.deepEqual(ghPaths(exec).filter((p) => mentions(p, 12) || mentions(p, 20)), [],
    '(f)/M4 an unreadable assignment causes no gh api read naming run 12 or run 20')
  assert.deepEqual(ghPaths(exec), [],
    '(f)/M4 and in fact no gh api read at all')
  assert.deepEqual(exec.mutating(), [], '(f)/M4 nothing is removed')
  assert.deepEqual(result.actions, [], '(f)/M4 and nothing is reported as an action')

  const printed = renderJanitor(result)
  assert.equal(printed.includes(`unknown ${vm(20)}  no readable assignment — look before you rm`), true,
    '(f)/M4 an unknown row is printed verbatim: `unknown <vm>  no readable assignment — look before you rm`')
  assert.equal(printed.includes(`unknown ${vm(12)}  no readable assignment — look before you rm`), true,
    '(f)/M4 both unknown rows are printed')
}

// ── (f) --dry-run reads the same and removes nothing [M4] ───────────────────
{
  const wet = fleetExec(tagContentsPath)
  const applied = await janitor({ argv: [], exec: wet, config: CONFIG, now: () => NOW })
  const dry = fleetExec(tagContentsPath)
  const result = await janitor({ argv: ['--dry-run'], exec: dry, config: CONFIG, now: () => NOW })

  assert.deepEqual(ghPaths(dry), ghPaths(wet),
    '(f)/M4 --dry-run issues exactly the same gh api reads')
  assert.deepEqual(lsReads(dry), lsReads(wet),
    '(f)/M4 and exactly the same ls read')
  assert.deepEqual(dry.mutating(), [], '(f)/M4 and no rm')
  assert.deepEqual(sorted(actionVms(result)), sorted(actionVms(applied)),
    '(f)/M4 it still reports the four rows it would have removed')
  assert.equal(result.actions.every((a) => a.applied === false), true,
    '(f)/M4 unapplied')
  assert.equal(result.dryRun, true, '(f)/M4 and says so')
  assert.match(renderJanitor(result), new RegExp(`^would rm ${vm(3)} {2}run=3 done since `, 'm'),
    '(f)/M4 printed as "would rm", keeping the line shape')

  assert.equal(renderJanitor({ dryRun: false, age: '1h', actions: [], stale: [], unknown: [] }),
    'nothing to do', '(f)/M4 an empty result still says so')
}

// ── (f) the only file read under ~/.ultrapowers/ is fleet.json [M4] ─────────
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
    ghRule({
      tags: { [planTagPath(TARGET, 3)]: { run: 3, sha: planSha(3) } },
      commits: { [commitPath(TARGET, planSha(3))]: PLAN_STALE }
    })
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
    '(f)/M4 the run-3 VM is not removed: the canary status page under ~/.ultrapowers/ is not a reader the janitor has')
  assert.deepEqual(result.actions, [],
    '(f)/M4 and run 3 is in no action')
  assert.equal(
    staleRuns(result).includes(3) || unknownVms(result).includes(vm(3)), true,
    '(f)/M4 run 3 appears in stale or unknown — never in actions')
  cleanup(home)
}

// ── (f) across every leg: two argv words, no flag, no VM ssh, no git [M4] ───
for (const [i, exec] of EXECS.entries()) {
  for (const call of exec.calls.filter((c) => c.cmd === 'gh')) {
    assert.deepEqual(call.argv.length, 2,
      `(f)/M4 leg ${i}: every gh call is two argv words — no -X, no --method, no -f, no flag of any kind: ${call.line}`)
    assert.equal(call.argv[0], 'api',
      `(f)/M4 leg ${i}: the first word is api: ${call.line}`)
    assert.equal(String(call.argv[1]).startsWith('repos/'), true,
      `(f)/M4 leg ${i}: the second is a path beginning repos/: ${call.line}`)
  }
  assert.deepEqual(exec.vm(), [],
    `(f)/M4 leg ${i}: the janitor issues no ssh <ssh_dest> command`)
  assert.deepEqual(exec.calls.filter((c) => c.cmd === 'git').map((c) => c.line), [],
    `(f)/M4 leg ${i}: the janitor issues no git command`)
}

console.log('ALL TESTS PASSED')

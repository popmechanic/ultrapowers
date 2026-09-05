/**
 * fleet/tests/test_janitor_automerge.mjs — the janitor arms auto-merge on a done run.
 *
 * A run the engine approved merges itself once CI is green with nobody waiting
 * on it: the janitor, which already reads every run's `status.json` off the
 * evidence branch on a cron, asks GitHub whether the run's PR is ready and, when
 * it is, turns auto-merge on. Every external call goes through the same
 * `exec(cmd, argv)` seam the rest of the fleet uses, so this exam cans `gh` and
 * reads `exec.calls` for what was issued; no network is touched.
 *
 * What is pinned, clause by clause:
 *
 *   M1 — a `done` run with a `pr` URL gets
 *        `gh pr view <url> --json state,isDraft,autoMergeRequest` and, when the
 *        answer is `OPEN` / not draft / no auto-merge yet,
 *        `gh pr merge <url> --auto --squash` once, recorded as
 *        `{ kind: 'auto-merge', vm, run, pr, command, applied }`; `--dry-run`
 *        still views, records `applied: false`, and issues no merge;
 *   M2 — an existing `autoMergeRequest`, a state other than `OPEN`, or a draft
 *        gets no merge command; a run that is not `done`, or is `done` with a
 *        null `pr`, gets no view at all;
 *   M3 — a `--auto` merge refused with `clean status` falls back to one
 *        `gh pr merge <url> --squash` and records `merged: true`; any other
 *        non-zero exit records `applied: false` and the output's last non-empty
 *        line under `error`;
 *   M4 — the arming is independent of the reap, and the janitor still issues no
 *        `git` command and no `ssh <vm>` command;
 *   M5 — `fleet/RUNBOOK.md`'s reap paragraph says the janitor arms auto-merge.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'

import { evidenceBranchFor } from '../lobby.mjs'
import { janitor } from '../janitor.mjs'
import {
  answer, cmdRule, makeExec, sshRule, vmRow, vmsPayload
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
const row = (n) => vmRow(vm(n), { comment: comment(n) })

/** The PR URL the contract's `status.json` carries under `"pr"`. */
const prUrl = (n) => `https://github.com/${TARGET}/pull/${n}`

/** A status page, as the contract shapes it — `pr` is the URL or null. */
const status = (run, state, { pr = prUrl(run), updatedAt = minutesAgo(10) } = {}) => ({
  run, state, phase: 'x', pr, branch: `ultra/integration-run-${run}`, vm: vm(run), updatedAt
})

// ── The `gh` seam ───────────────────────────────────────────────────────────

const evidencePath = (run) =>
  `repos/${TARGET}/contents/.ultrapowers/runs/${run}/status.json?ref=${evidenceBranchFor(run)}`

/** What `gh api` prints for an absent file: exit 1, `HTTP 404` on stderr. */
const NOT_FOUND = answer('', { code: 1, stderr: 'gh: Not Found (HTTP 404)' })

/** The contents envelope: the status page, base64, under `content`. */
const envelope = (page) => answer({
  content: Buffer.from(JSON.stringify(page), 'utf8').toString('base64'),
  encoding: 'base64'
})

/** `gh api <path>` answers the evidence a leg canned; every other path is a 404. */
const ghApiRule = (pages) => cmdRule('gh', 'api', (cmd, argv) => {
  const p = argv.find((a) => typeof a === 'string' && a.startsWith('repos/'))
  return p !== undefined && Object.hasOwn(pages, p) ? envelope(pages[p]) : NOT_FOUND
})

/**
 * `gh pr <view|merge> <url> …` answers what the leg canned for that URL. A view
 * nobody canned is a 404, and a merge nobody canned is green and silent, so a
 * call at the wrong URL cannot look like a call at the right one.
 */
const ghPrRule = ({ views = {}, merges = {} } = {}) => cmdRule('gh', 'pr', (cmd, argv) => {
  const [, sub, url] = argv
  if (sub === 'view') {
    return Object.hasOwn(views, url)
      ? answer(views[url])
      : answer('', { code: 1, stderr: 'gh: no pull requests found (HTTP 404)' })
  }
  if (sub === 'merge') {
    return Object.hasOwn(merges, url) ? merges[url](argv) : answer('')
  }
  return answer('', { code: 1, stderr: `gh: unknown pr subcommand ${sub}` })
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

/** Every exec this exam built, so leg (d)'s two negatives cover every leg. */
const EXECS = []
const buildExec = (fleet, { evidence = {}, views = {}, merges = {} } = {}) => {
  // passthrough: [] — no command in this exam ever really runs.
  const exec = makeExec({
    rules: [...lsRules(fleet), ghApiRule(evidence), ghPrRule({ views, merges })],
    passthrough: []
  })
  EXECS.push(exec)
  return exec
}

/** `evidence:` for a whole fleet, `[status, …]` keyed by each page's own run. */
const evidenceFor = (pages) => Object.fromEntries(pages.map((p) => [evidencePath(p.run), p]))

// ── Readers over the recording seam ─────────────────────────────────────────

/** The argv of every `gh pr <sub>` call, in order. */
const prCalls = (exec, sub) => exec.calls
  .filter((c) => c.cmd === 'gh' && c.argv[0] === 'pr' && c.argv[1] === sub)
  .map((c) => c.argv)
const viewCalls = (exec) => prCalls(exec, 'view')
const mergeCalls = (exec) => prCalls(exec, 'merge')

const armings = (result) => (result.actions ?? []).filter((a) => a.kind === 'auto-merge')
const reaps = (result) => (result.actions ?? []).filter((a) => a.kind === 'rm')
const sorted = (xs) => [...xs].sort()

const VIEW_JSON = 'state,isDraft,autoMergeRequest'
const viewArgv = (url) => ['pr', 'view', url, '--json', VIEW_JSON]
const autoArgv = (url) => ['pr', 'merge', url, '--auto', '--squash']
const plainArgv = (url) => ['pr', 'merge', url, '--squash']

/** The ready answer: open, not a draft, no auto-merge armed yet. */
const READY = JSON.stringify({ state: 'OPEN', isDraft: false, autoMergeRequest: null })

const run1 = (argv, exec) => janitor({ argv, exec, config: CONFIG, now: () => NOW })

// ── (a) a ready PR on a done run is armed, exactly once [M1] ────────────────
{
  const RUN = 3
  const URL = prUrl(RUN)
  const page = status(RUN, 'done')
  const legAExec = () => buildExec([row(RUN)], {
    evidence: evidenceFor([page]),
    views: { [URL]: READY },
    merges: { [URL]: () => answer('') }
  })

  const exec = legAExec()
  const result = await run1([], exec)

  assert.deepEqual(viewCalls(exec), [viewArgv(URL)],
    "(a)/M1 a done run with a pr URL gets exactly one view, argv exactly ['pr', 'view', <url>, '--json', 'state,isDraft,autoMergeRequest']")
  assert.deepEqual(mergeCalls(exec), [autoArgv(URL)],
    "(a)/M1 and, the view answering OPEN / not draft / autoMergeRequest null, exactly one merge, argv exactly ['pr', 'merge', <url>, '--auto', '--squash']")
  assert.deepEqual(result.actions, [{
    kind: 'auto-merge',
    vm: vm(RUN),
    run: RUN,
    pr: URL,
    command: `gh pr merge ${URL} --auto --squash`,
    applied: true
  }], '(a)/M1 and one action, deep-equal to { kind: \'auto-merge\', vm, run, pr, command, applied: true }')

  // --dry-run reads the same and mutates nothing.
  const dry = legAExec()
  const dryResult = await run1(['--dry-run'], dry)

  assert.deepEqual(viewCalls(dry), [viewArgv(URL)],
    '(a)/M1 --dry-run issues the same view: the view is a read and runs in the loop under --dry-run too')
  assert.deepEqual(mergeCalls(dry), [],
    '(a)/M1 and issues no merge at all')
  assert.deepEqual(dryResult.actions, [{
    kind: 'auto-merge',
    vm: vm(RUN),
    run: RUN,
    pr: URL,
    command: `gh pr merge ${URL} --auto --squash`,
    applied: false
  }], '(a)/M1 recording the same action with applied: false')
}

// ── (b) not ready, and not looked at [M2] ───────────────────────────────────
{
  // Three ready-looking runs whose views each refuse for their own reason.
  const ARMED = { run: 40, view: { state: 'OPEN', isDraft: false, autoMergeRequest: { enabledAt: '2026-09-03T11:00:00Z' } } }
  const CLOSED = { run: 41, view: { state: 'MERGED', isDraft: false, autoMergeRequest: null } }
  const DRAFT = { run: 42, view: { state: 'OPEN', isDraft: true, autoMergeRequest: null } }
  const cases = [ARMED, CLOSED, DRAFT]

  const pages = cases.map((c) => status(c.run, 'done'))
  const exec = buildExec(cases.map((c) => row(c.run)), {
    evidence: evidenceFor(pages),
    views: Object.fromEntries(cases.map((c) => [prUrl(c.run), JSON.stringify(c.view)])),
    merges: Object.fromEntries(cases.map((c) => [prUrl(c.run), () => answer('')]))
  })
  await run1([], exec)

  assert.deepEqual(sorted(viewCalls(exec).map((a) => a[2])), sorted(cases.map((c) => prUrl(c.run))),
    '(b)/M2 each of the three done runs is viewed')
  assert.deepEqual(mergeCalls(exec), [],
    '(b)/M2 and none is merged: an autoMergeRequest object, a state of MERGED, and isDraft true each get no merge command')

  // Three runs whose PR is never asked about at all.
  const PARKED = status(43, 'parked')
  const RUNNING = status(44, 'running')
  const NO_PR = status(45, 'done', { pr: null })
  const quiet = buildExec([row(43), row(44), row(45)], {
    evidence: evidenceFor([PARKED, RUNNING, NO_PR]),
    views: Object.fromEntries([43, 44, 45].map((n) => [prUrl(n), READY])),
    merges: Object.fromEntries([43, 44, 45].map((n) => [prUrl(n), () => answer('')]))
  })
  await run1([], quiet)

  assert.deepEqual(viewCalls(quiet), [],
    '(b)/M2 a parked run, a running run, and a done run whose pr is null get no gh pr view at all')
  assert.deepEqual(mergeCalls(quiet), [],
    '(b)/M2 and so no merge either')
}

// ── (c) the clean-status fallback, and every other failure [M3] ─────────────
{
  const RUN = 50
  const URL = prUrl(RUN)
  const CLEAN = 'failed to enable auto-merge\nPull request is in clean status\n'
  const exec = buildExec([row(RUN)], {
    evidence: evidenceFor([status(RUN, 'done')]),
    views: { [URL]: READY },
    merges: {
      [URL]: (argv) => (argv.includes('--auto')
        ? answer('', { code: 1, stderr: CLEAN })
        : answer('Merged pull request'))
    }
  })
  const result = await run1([], exec)

  assert.deepEqual(mergeCalls(exec), [autoArgv(URL), plainArgv(URL)],
    "(c)/M3 a --auto merge refused with `Pull request is in clean status` is followed by exactly one further `gh pr merge <url> --squash`")
  assert.equal(armings(result).length, 1,
    '(c)/M3 still one auto-merge action for the run')
  assert.equal(armings(result)[0].merged, true,
    '(c)/M3 recorded with merged: true — the fallback reached the state auto-merge would have reached on its own')

  const FAIL = 51
  const FAIL_URL = prUrl(FAIL)
  const badExec = buildExec([row(FAIL)], {
    evidence: evidenceFor([status(FAIL, 'done')]),
    views: { [FAIL_URL]: READY },
    merges: { [FAIL_URL]: () => answer('', { code: 1, stderr: 'gh: request failed\nHTTP 502\n\n' }) }
  })
  const bad = await run1([], badExec)

  assert.deepEqual(mergeCalls(badExec), [autoArgv(FAIL_URL)],
    '(c)/M3 a merge failing with HTTP 502 gets no further merge call')
  assert.equal(armings(bad).length, 1,
    '(c)/M3 the failure is still recorded as an action')
  assert.equal(armings(bad)[0].applied, false,
    '(c)/M3 with applied: false')
  assert.equal(armings(bad)[0].error, 'HTTP 502',
    "(c)/M3 and error equal to the output's last non-empty line, `HTTP 502`")
}

// ── (d) the arming is independent of the reap [M4] ──────────────────────────
{
  const YOUNG = 60 // done ten minutes ago: armed, too young to reap
  const OLD = 61 // done two hours ago: armed and reaped in the same pass
  const pages = [
    status(YOUNG, 'done', { updatedAt: minutesAgo(10) }),
    status(OLD, 'done', { updatedAt: hoursAgo(2) })
  ]
  const urls = [prUrl(YOUNG), prUrl(OLD)]
  const exec = buildExec([row(YOUNG), row(OLD)], {
    evidence: evidenceFor(pages),
    views: Object.fromEntries(urls.map((u) => [u, READY])),
    merges: Object.fromEntries(urls.map((u) => [u, () => answer('')]))
  })
  const result = await run1([], exec)

  assert.deepEqual(sorted(armings(result).map((a) => a.vm)), sorted([vm(YOUNG), vm(OLD)]),
    '(d)/M4 both done runs are armed — the ten-minute-old one and the two-hour-old one')
  assert.deepEqual(sorted(mergeCalls(exec).map((a) => a[2])), sorted(urls),
    '(d)/M4 and both merges are issued')
  assert.deepEqual(reaps(result).map((a) => a.vm), [vm(OLD)],
    '(d)/M4 only the two-hour-old run is rm\'d: the run updated ten minutes ago is in no rm action')
  assert.deepEqual(exec.mutating(), [`rm ${vm(OLD)} --json`],
    '(d)/M4 and exactly one rm is issued through the lobby')
}

// ── (d) across every leg: no VM ssh, no git [M4] ────────────────────────────
for (const [i, exec] of EXECS.entries()) {
  assert.deepEqual(exec.vm(), [],
    `(d)/M4 leg ${i}: the janitor issues no ssh <vm> command`)
  assert.deepEqual(exec.calls.filter((c) => c.cmd === 'git').map((c) => c.line), [],
    `(d)/M4 leg ${i}: the janitor issues no git command`)
}

// ── the RUNBOOK's reap paragraph says so [M5] ───────────────────────────────
{
  const runbook = fs.readFileSync(new URL('../RUNBOOK.md', import.meta.url), 'utf8')
  const joined = runbook.replace(/\s+/g, ' ')
  assert.equal(joined.includes('arms auto-merge'), true,
    '(m5)/M5 fleet/RUNBOOK.md says `arms auto-merge`, wraps joined')

  const reap = runbook.split(/\n\n+/).find((p) => p.startsWith("It lists the fleet, reads each VM's comment"))
  assert.notEqual(reap, undefined,
    "(m5)/M5 the reap paragraph — the one beginning `It lists the fleet, reads each VM's comment` — is still there")
  assert.equal(reap.replace(/\s+/g, ' ').includes('arms auto-merge'), true,
    '(m5)/M5 and it is the reap paragraph that says the janitor arms auto-merge on a done run\'s pull request')
}

// ── (e) the sentinel ────────────────────────────────────────────────────────
console.log('ALL TESTS PASSED')

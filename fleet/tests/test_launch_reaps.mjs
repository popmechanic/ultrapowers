/**
 * fleet/tests/test_launch_reaps.mjs — the launcher runs the janitor's reap.
 *
 * #660 item (3): nothing schedules the janitor, so `launch.mjs` runs it before
 * every launch. The reap sits between the pool read and the `git ls-remote`
 * that computes the run number — after the launcher has refused a run larger
 * than the plan, and before it decides which run this is — and it is a reap,
 * never a dry run: an hour-old `done` VM loses its VM on the next launch.
 *
 * A reap that fails is not a launch that fails: the fleet listing answering
 * non-zero is recorded on the result as `reapError` and the launch goes on to
 * its one `new`.
 *
 * The rig is `test_launch.mjs`'s — a real target repository whose bare origin
 * the seam points the launcher's own `ls-remote` and `push` at, so the push is
 * a real push and the refs the launcher reads are the origin's own — plus the
 * janitor's three canned rules: the fleet listing, each run's status page over
 * `gh api`, and `rm`. Nothing here opens a network socket.
 *
 * What is pinned, clause by clause:
 *
 *   (c) [M3] a green launch over a fleet of a `done` VM two hours old and a
 *       `done` VM ten minutes old issues exactly one `rm <old vm> --json`,
 *       after the `billing plan --json` verb, before the `git … ls-remote …
 *       refs/heads/ultra/*` that computes the run number and before the `new`;
 *       the result's `reaped` is `[<old vm>]` and its `reapError` is null;
 *       `renderLaunch` of it is the four BASE lines followed by one
 *       `reaped <old vm>` line; and a launch whose `ls 'fleet-r*' --json`
 *       answers exit 1 issues no `rm`, carries a non-empty `reapError` and an
 *       empty `reaped`, still issues exactly one `new`, and renders as exactly
 *       the four BASE lines;
 *   (d) the sentinel [M3].
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { launch, renderLaunch } from '../launch.mjs'
import { FLEET_DEFAULTS, defaultExec, evidenceBranchFor } from '../lobby.mjs'
import {
  answer, cleanup, cmdRule, makeExec, makeTargetRepo, sshRule, tempDir, vmRow, vmsPayload
} from './_lobby_helpers.mjs'

const TARGET = 'popmechanic/smoke'
/** The target's one GitHub integration — the `--integration` half of the `new` line. */
const GH = 'gh-popmechanic-smoke'
/** How a real target's `origin` is spelled. */
const ORIGIN_URL = `https://github.com/${TARGET}.git`
const ENGINE = 'b'.repeat(40)
const NOW = new Date('2026-09-03T22:15:00.000Z')
const PLAN_TEXT = '# a plan\n\nOne task, and a trailing newline.\n'
/** The seed the base commit carries. */
const SEED = { 'README.md': '# target\n', 'src/app.js': 'export const x = 1\n' }
/** The plan's own pool, sized by the config when no flag says otherwise. */
const CONFIG = { ...FLEET_DEFAULTS }
/** `billing plan --json`, as measured 2026-09-04. */
const BILLING_OK = {
  max_cpus: 16, max_memory_gb: 64, tier: 'XLarge', plan: 'Individual'
}

const minutesAgo = (m) => new Date(NOW.getTime() - m * 60000).toISOString()
const hoursAgo = (h) => minutesAgo(h * 60)

// ── The launcher's own rules, as test_launch.mjs cans them ──────────────────

/** `new … --json` answers the row for whatever name the line asked for. */
const NEW_OK = (cmd, argv) =>
  answer({ vm_name: /--name (\S+)/.exec(String(argv[1] ?? ''))?.[1] ?? '', status: 'running' })

/** The engine tip, when a launch reads it rather than taking `--engine`. */
const ENGINE_RULE = {
  when: (cmd, argv) =>
    cmd === 'git' && argv.includes('ls-remote') && argv.some((a) => /ultrapowers/.test(String(a))),
  answer: answer(`${ENGINE}\tHEAD\n`)
}

/**
 * The launcher names the target's remote the way an operator's checkout spells
 * it; the seam points that name at the bare repository the exam really made and
 * runs the command for real. The command the launcher issued is what the exec
 * log records, so the ordering is still its own.
 */
const localRemote = (repo) => ({
  when: (cmd, argv) => cmd === 'git' &&
    (argv.includes('push') || argv.includes('ls-remote')) &&
    !argv.includes('--get-url') &&
    !argv.some((a) => /ultrapowers/.test(String(a))),
  answer: (cmd, argv, options) => defaultExec(
    'git',
    argv.map((a) => (a === 'origin' || /github\.com/.test(String(a)) ? repo.origin : a)),
    options ?? {}
  )
})

/** No socket, whatever else the launcher tries. */
const OFFLINE = answer('', { code: 128, stderr: 'exam: this exam opens no network socket\n' })
const NO_REMOTE_OPS = {
  when: (cmd, argv) => cmd === 'git' && argv.some((a) => a === 'clone' || a === 'pull' || a === 'fetch'),
  answer: OFFLINE
}
const NO_NETWORK_GIT = {
  when: (cmd, argv) => cmd === 'git' && argv.some((a) => /:\/\/|github\.com/.test(String(a))),
  answer: OFFLINE
}

// ── The janitor's rules, over the same seam ─────────────────────────────────

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const OLD = 71 // done two hours ago: an hour past done, so its VM is ballast
const YOUNG = 72 // done ten minutes ago: still inside the hour

const reapVm = (n) => `fleet-r${n}-2609032200-a1b2`
/** The assignment comment the launcher set on that VM: `run=` and `target=`. */
const reapComment = (n) =>
  `run=${n} plan=${SHA} target=${TARGET} base=${SHA} engine=${SHA}`
const reapRow = (n) => vmRow(reapVm(n), { comment: reapComment(n) })

const evidencePath = (run) =>
  `repos/${TARGET}/contents/.ultrapowers/runs/${run}/status.json?ref=${evidenceBranchFor(run)}`

const donePage = (run, updatedAt) => ({
  run,
  state: 'done',
  phase: 'x',
  pr: `https://github.com/${TARGET}/pull/${run}`,
  branch: `ultra/integration-run-${run}`,
  vm: reapVm(run),
  updatedAt
})

const PAGES = {
  [evidencePath(OLD)]: donePage(OLD, hoursAgo(2)),
  [evidencePath(YOUNG)]: donePage(YOUNG, minutesAgo(10))
}

/** What `gh api` prints for an absent file: exit 1, `HTTP 404` on stderr. */
const NOT_FOUND = answer('', { code: 1, stderr: 'gh: Not Found (HTTP 404)' })

/** `gh api <path>` answers the pages this exam canned; every other path 404s. */
const GH_API_RULE = cmdRule('gh', 'api', (cmd, argv) => {
  const p = argv.find((a) => typeof a === 'string' && a.startsWith('repos/'))
  if (p === undefined || !Object.hasOwn(PAGES, p)) return NOT_FOUND
  return answer({
    content: Buffer.from(JSON.stringify(PAGES[p]), 'utf8').toString('base64'),
    encoding: 'base64'
  })
})

/** The fleet the janitor sees, and the `rm` it may issue over it. */
const reapRules = (listing) => [
  sshRule('ls ', listing),
  sshRule('rm ', answer('')),
  GH_API_RULE
]

const FLEET_LISTING = vmsPayload([reapRow(OLD), reapRow(YOUNG)])
/** The listing verb answering non-zero — what `listVms` throws a LobbyError on. */
const FLEET_LISTING_FAILS = answer('', { code: 1, stderr: 'exe.dev: ls failed\n' })

const readRules = ({ repo, listing = FLEET_LISTING } = {}) => [
  ...reapRules(listing),
  ENGINE_RULE,
  ...(repo ? [localRemote(repo)] : []),
  sshRule('integrations list --json', answer([{ name: GH, attachments: [] }, { name: 'claude-max', attachments: [] }])),
  sshRule('billing plan --json', answer(BILLING_OK)),
  sshRule('new ', NEW_OK),
  NO_REMOTE_OPS,
  NO_NETWORK_GIT
]

// ── The workspace: a real target repository and a plan beside it ────────────

function workspace () {
  const root = tempDir('fleet-launch-reaps-')
  const repo = makeTargetRepo({ root, files: { ...SEED } })
  repo.git(['remote', 'set-url', 'origin', ORIGIN_URL])
  const planDir = path.join(root, 'plans-src')
  fs.mkdirSync(planDir)
  const planPath = path.join(planDir, 'a-plan.md')
  fs.writeFileSync(planPath, PLAN_TEXT)
  return { root, repo, planPath, cleanup: () => cleanup(root) }
}

const argvFor = (ws) => [
  ws.planPath, '--target', TARGET, '--base', ws.repo.base, '--repo', ws.repo.dir,
  '--engine', ENGINE
]

const launchIn = (ws, { exec }) => launch({
  argv: argvFor(ws),
  exec,
  config: CONFIG,
  now: () => NOW,
  sleep: async () => {},
  refreshCredential: () => ({ ok: true })
})

// ── Readers over the recording seam ─────────────────────────────────────────

const newLines = (exec) => exec.lobby().filter((line) => line.startsWith('new '))
const rmLines = (exec) => exec.lobby().filter((line) => line.startsWith('rm '))
const indexOf = (exec, pred) => exec.calls.findIndex(pred)

const rmAtOf = (exec) => indexOf(exec, (c) => String(c.argv[1] ?? '').startsWith('rm '))
const billingAtOf = (exec) => indexOf(exec, (c) => c.argv[1] === 'billing plan --json')
const runNumberReadAtOf = (exec) => indexOf(exec, (c) =>
  c.cmd === 'git' && c.argv.includes('ls-remote') && c.argv.includes('refs/heads/ultra/*'))
const newAtOf = (exec) => indexOf(exec, (c) => String(c.argv[1] ?? '').startsWith('new '))

/** The four lines a pinned-engine launch printed at BASE. */
const baseLines = (result) => [result.runId, result.vm, result.statusUrl, result.comment]

// ── (c) the reap runs inside the launch, in its place [M3] ──────────────────
{
  const ws = workspace()
  const exec = makeExec({ rules: readRules({ repo: ws.repo }) })
  const result = await launchIn(ws, { exec })

  assert.deepEqual(rmLines(exec), [`rm ${reapVm(OLD)} --json`],
    '(c)/M3 a launch over a fleet of a done VM two hours old and a done VM ten minutes old issues exactly one `rm <old vm> --json`: launch.mjs runs the janitor, and nothing else schedules it')

  const rmAt = rmAtOf(exec)
  const billingAt = billingAtOf(exec)
  const runNumberAt = runNumberReadAtOf(exec)
  const newAt = newAtOf(exec)
  assert.ok(billingAt >= 0, '(c)/M3 the pool is read')
  assert.ok(runNumberAt >= 0, '(c)/M3 and the run number is read off the target\'s ultra/* refs')
  assert.ok(newAt >= 0, '(c)/M3 and the run is created')
  assert.ok(billingAt < rmAt,
    `(c)/M3 the reap comes after the pool read: billing plan --json is call ${billingAt}, the rm is call ${rmAt}`)
  assert.ok(rmAt < runNumberAt,
    `(c)/M3 and before the git ls-remote refs/heads/ultra/* that computes the run number: the rm is call ${rmAt}, that read is call ${runNumberAt}`)
  assert.ok(rmAt < newAt,
    `(c)/M3 and so before the new: the rm is call ${rmAt}, the new is call ${newAt}`)

  assert.equal('reaped' in result, true, '(c)/M3 the result carries reaped')
  assert.equal('reapError' in result, true, '(c)/M3 and reapError')
  assert.deepEqual(result.reaped, [reapVm(OLD)],
    '(c)/M3 reaped is the vm of every rm action that was applied — the two-hour-old one, and not the ten-minute-old one')
  assert.equal(result.reapError, null, '(c)/M3 and reapError is null: nothing failed')

  assert.deepEqual(newLines(exec).length, 1, '(c)/M3 the launch still issues exactly one `new`')
  assert.deepEqual(
    renderLaunch(result).split('\n'),
    [...baseLines(result), `reaped ${reapVm(OLD)}`],
    '(c)/M3 renderLaunch prints the four lines it printed at BASE — the run id, the VM, the status URL and the comment — followed by one `reaped <vm>` line per name'
  )
  ws.cleanup()
}

// ── (c) a reap that fails is not a launch that fails [M3] ───────────────────
{
  const ws = workspace()
  const exec = makeExec({ rules: readRules({ repo: ws.repo, listing: FLEET_LISTING_FAILS }) })
  const result = await launchIn(ws, { exec })

  assert.deepEqual(rmLines(exec), [],
    '(c)/M3 a launch whose `ls \'fleet-r*\' --json` answers exit 1 issues no rm')
  assert.equal(typeof result.reapError, 'string',
    '(c)/M3 reapError is a string')
  assert.ok(result.reapError.length > 0,
    '(c)/M3 a non-empty one: the thrown error\'s message, so the operator can read what the fleet listing said')
  assert.deepEqual(result.reaped, [], '(c)/M3 and reaped is empty')

  assert.equal(newLines(exec).length, 1,
    '(c)/M3 the launch still completes with exactly one `new`: a reap that fails does not refuse a run')
  assert.deepEqual(
    renderLaunch(result).split('\n'), baseLines(result),
    '(c)/M3 and renderLaunch is exactly the four BASE lines — no reaped line when nothing was reaped'
  )
  ws.cleanup()
}

// ── (d) the sentinel [M3] ───────────────────────────────────────────────────
console.log('ALL TESTS PASSED')

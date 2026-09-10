/**
 * fleet/tests/test_sandbox_boot_publish_fold.mjs — the boot script publishes
 * the folded head, retries the merge once a strict-mode 405 asks it to, and
 * folds again until the tip stops moving.
 *
 * WHERE THIS FILE COMES FROM. It is the second half of what used to be
 * `fleet/tests/test_sandbox_boot_merge.mjs`, carried across whole. That file's
 * first half examined a poll the script no longer makes: run-90 retired the
 * merge gate that read a commit's runs from the target's API and replaced it
 * with one that reads the PR's own tip. The retired half stays retired — it is
 * not here, and nothing below asserts anything about it. What IS here are the
 * four numberings the second half carried:
 *
 *   `publish-fold`  #715 — "The boot script publishes the folded head and
 *                   retries the merge once", clauses M1–M8, legs (a)–(j).
 *   `#808`          the deadman's widening, and the injectable clock the
 *                   fold-again window is measured on.
 *   `failing-block` the pull request quotes the fold suite's failing block.
 *   `strict-405`    #784 — the two strict-mode 405 bodies buy the second fold.
 *   `fold-again`    the fold-again window: fold and PUT again for as long as
 *                   each fold is clean and the window is open.
 *
 * Every assertion names its numbering and its leg, so a reader can map any
 * sentence here back to the task it came from and no two numberings read as
 * one.
 *
 * The rig is `_sandbox_boot_helpers.mjs` — the stub bin dir, `makeHome`,
 * `boot`, the log readers and `runTests` — shared with the other halves of the
 * boot exam. It is imported as a namespace as well as by name, so that a tree
 * missing one of the readers this file asks for fails a leg with a sentence
 * rather than a module link error.
 *
 * Ground truth for "which call happened" is `curl.log` — the tab-separated
 * argv every stub writes through the shared `argv()` prelude, which no stub
 * case can talk its way out of. The `say` lines in `fleet-boot.log` are read
 * only for ORDER, which is the one thing argv cannot show.
 *
 * No network, no systemd, no real `claude`: the stub bin answers all three, and
 * `FLEET_POLL_SECONDS=0` keeps every wait in the script down to a second.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as RIG from './_sandbox_boot_helpers.mjs'
import {
  SCRIPT, TARGET, HEAD_SHA, BASE_SHA, PR_URL, PR_AUTHOR, PLAN_H1, ASSIGNMENT,
  INTEGRATION_BRANCH, VM_NAME, HEAD_SHA_2,
  makeHome, boot, bootAsync, greenAsync as green,
  readLog, lines, argvLines, stream, statusOf, commitStates,
  prPosts, unitsRun, gitLog, verbOf, dirOf, isIntegrationPush,
  targetDir, mergePuts, checkRunRequests, mergeableReads,
  runTests, stubEnv,
} from './_sandbox_boot_helpers.mjs'

const tests = []
const test = (name, fn) => tests.push([name, fn])

// ── the scenarios, all in flight at once ─────────────────────────────────────
//
// Every scenario this file reads is an independent run of the boot script —
// its own home, its own stub counters, its own logs — so none has to wait for
// another. Each is STARTED where it is declared, at load, and a leg awaits
// only the one it asks about; the boots overlap and the file's wall is the
// slowest of them rather than the sum of all of them.
//
// `started` memoises the PROMISE, never its result, so a scenario several legs
// share is booted once however early they ask. It also settles the promise into
// a thunk, so a scenario whose boot failed throws in the leg that reads it —
// a rejection sitting unread while another leg is on the clock would otherwise
// tear the process down before the failing leg had its say.

/**
 * Every boot this file starts, as its reader — the fold-again banner's leg (g)
 * asks a question of ALL of them at once ("no `done` phase says `405 twice`"),
 * and a list built here is the only way to ask it of a scenario declared five
 * hundred lines away.
 */
const ALL_BOOTS = []

const started = (make) => {
  const settled = make().then((value) => () => value, (error) => () => { throw error })
  const read = () => settled.then((r) => r())
  ALL_BOOTS.push(read)
  return read
}

/**
 * How many boots are in flight at once, and the only knob this file's wall
 * turns on.
 *
 * A boot is ~40 forks of stub shell around a handful of tenth-of-a-second
 * waits: fork-bound, so the box's cores are what it competes for. Three at a
 * time is what the smallest box the suite runs on — a four-vCPU sandbox — can
 * work on while still leaving a core to the process reading the results. Wider
 * does not finish the boots much sooner (they queue in the kernel instead of
 * here) and narrower makes the file's wall the sum of its boots again, which is
 * what this exam stopped being.
 */
const WIDTH = 3
let inFlight = 0
const waiting = []
const pump = () => {
  while (inFlight < WIDTH && waiting.length) {
    inFlight += 1
    waiting.shift()()
  }
}
const acquire = () => new Promise((admit) => {
  waiting.push(admit)
  pump()
})
const release = () => {
  inFlight -= 1
  pump()
}
/** `bootAsync`, behind that gate. */
const gatedBoot = (ctx, args, env) =>
  acquire().then(() => bootAsync(ctx, args, env).finally(release))

/** A boot of `args` under `env`, started now; resolves to its home, the run's
 *  result hung on it as `result`. */
const bootRun = (env = {}, args = ['boot']) => {
  const ctx = makeHome()
  return gatedBoot(ctx, args, env).then((result) => {
    ctx.result = result
    return ctx
  })
}
/** The same, memoised for the legs that share it. */
const scenario = (env = {}, args = ['boot']) => started(() => bootRun(env, args))

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CONTRACT = path.join(HERE, '..', 'CONTRACT.md')
const RUNBOOK = path.join(HERE, '..', 'RUNBOOK.md')
const SKILL = path.join(HERE, '..', '..', 'skills', 'ultrapowers', 'SKILL.md')

// ── the API, spelled out ─────────────────────────────────────────────────────
//
// `GITHUB_INT_HOST` is the boot script's own constant; the PR the stub answers
// with is number 1 (`PR_JSON`'s `number`, and the tail of `PR_URL`).

const API = 'https://github.int.exe.xyz/api/v3'
const MERGE_URL = `${API}/repos/${TARGET}/pulls/1/merge`

// ── the rig, read by name ────────────────────────────────────────────────────

/** A named export of the rig, or a failure that says which one is missing. */
const rig = (name, kind = 'value') => {
  const v = RIG[name]
  assert.ok(
    v !== undefined && (kind !== 'function' || typeof v === 'function'),
    `fleet/tests/_sandbox_boot_helpers.mjs exports no ${kind} '${name}' — the rig's ` +
      'fold and merge stub cases, and their readers, are part of this task'
  )
  return v
}
const mergeSha = () => rig('MERGE_SHA')

// ── reading curl.log ─────────────────────────────────────────────────────────

/** Every curl argv whose words carry `url`, as recorded words. */
const callsTo = (ctx, url) => argvLines(ctx, 'curl').filter((a) => a.includes(url))
/** Every curl aimed at the merge endpoint. */
const mergeCalls = (ctx) => callsTo(ctx, MERGE_URL)
/** The word a call carried after `-d`. */
const payloadOf = (argv) => {
  const i = argv.indexOf('-d')
  assert.ok(i >= 0 && i + 1 < argv.length, `this curl carried no -d payload: ${argv.join(' ')}`)
  return argv[i + 1]
}

/** The CALL lines of `fleet-boot.log`, which is where ORDER is readable. */
const calls = (ctx) => stream(ctx).filter((l) => l.startsWith('CALL curl'))
const isMergeCall = (l) => l.includes('merge')

/**
 * The part of the boot log a merge leg is about — every external call and
 * every line the merge step or the status page wrote. The clone and the
 * evidence commits are forty lines this exam never asks a question about.
 */
const why = (ctx) => {
  const kept = stream(ctx).filter((l) =>
    l.startsWith('CALL curl') || l.startsWith('merge:') || l.startsWith('status:') ||
    l.startsWith('publish:') || l.startsWith('outcome:') || l.startsWith('FAILED:'))
  return `\n--- fleet-boot.log (calls and states) ---\n${kept.join('\n')}`
}

// ── reading the documents ────────────────────────────────────────────────────
//
// Read the way the Proof's own commands read them: one named slice of one
// document per assertion, its line wraps joined with spaces.

const linesOf = (file) => fs.readFileSync(file, 'utf8').split('\n')

/** `sed -n '/from/,/to/p'`, joined by `tr '\n' ' '`. */
const slice = (file, from, to) => {
  const ls = linesOf(file)
  const start = ls.findIndex((l) => from.test(l))
  assert.ok(start >= 0, `${path.basename(file)}: no line matching ${from}`)
  let end = ls.length - 1
  for (let i = start + 1; i < ls.length; i += 1) {
    if (to.test(ls[i])) { end = i; break }
  }
  return ls.slice(start, end + 1).join(' ')
}

// ── shared runs ──────────────────────────────────────────────────────────────
//
// A boot is ~40 forks of stub shell, so a run read by more than one leg is made
// once and read many times, the way the rig's own `green()` is.

/** A NEEDS_ACK verdict with no approval: the parked outcome. */
const parked = scenario({ STUB_VERDICT: 'NEEDS_ACK' })

// ═════════════════════════════════════════════════════════════════════════════
// THE PUBLISH FOLD — the exam of "The boot script publishes the folded head and
// retries the merge once" (#715, spec §3.1, §3.4, §3.6, §4).
//
// Its Machine clauses, restated as this half asserts them:
//
//   M1  after the engine's exit, on ANY outcome with commits ahead of BASE, the
//       script writes `running`/`publish fold`, makes the receipts directory,
//       and starts `fleet-fold-<N>-1` — the folder's unit — with the engine's
//       own bracket (`--pipe --wait --collect`, the memory caps, the working
//       directory, `env -u CLAUDE_CONFIG_DIR` and the three variables), its
//       output teed to `publish-fold/publish-fold-1.log`, no `phase_refresher`
//       beside it and no `ENGINE_DONE_MARKER` write; then awaits the unit and
//       writes `publishing`. Nothing ahead of BASE starts no fold unit.
//   M2  the page is read BEFORE the exit code: a `parked` page is the deadman's
//       and ends the run at 0 with no push and no PR; a non-zero exit with no
//       `disposition` for the invoked attempt restores the branch ref
//       (`engine-head` on attempt 1, attempt 1's `candidate` on attempt 2) and
//       writes a `cannot fold` row carrying the exit code, the log's last line
//       and that same sha as `candidate`; `do_deadman` stops the fold units too
//       and carries `pr`, `prAuthor` and `merged` forward.
//   M3  `push_head` pushes the branch plainly when no attempt names a
//       `pushedHead` and with `--force-with-lease` on the highest one that does,
//       then records the pushed sha as that attempt's `pushedHead`.
//   M4  `render_card` reads the receipt: a `## Publish fold` section before
//       `### Evidence` on every disposition but a resolver-less `folded` and
//       `nothing to join`; the evidence listing names `publish-fold`; the
//       `Closes` lines stay last; a disposition that lands after the POST is
//       PATCHed onto the PR body.
//   M5  `FOLD_HOLD` carries the disposition's note and `merge_pr` treats it
//       exactly as `hold=1` — no check read, no PUT — while the draft flag
//       still follows the gate's outcome.
//   M6  the merge PUT carries `commit_message`.
//   M7  a 405 whose message says the PR is not mergeable, that the base branch
//       was modified, or that a required status check is expected buys ONE
//       retry: a second fold attempt, a leased push, and a second PUT after the
//       checks and the mergeability poll; every other refusal keeps one PUT.
//       (The two strict-mode bodies are #784's; the fourth banner below is
//       their exam, and the three-body reading of this clause is its.)
//   M8  the shared rig answers the fold unit as its FIRST branch. That the rig's
//       other sims still pass on it is the SUITE's sentence, not a leg of this
//       file: every one of them is a sim of tests/test_fleet_suite.py already,
//       and re-running them from inside here proved nothing the suite does not
//       and cost more wall than every other leg put together.
//
// WHAT THIS HALF ASKS OF THE RIG (`_sandbox_boot_helpers.mjs`, the implementer's
// file). The stubs are driven by environment knobs only, so nothing here links
// against an export that may not exist yet:
//
//   `systemd-run`  a `fleet-fold-*` unit is its FIRST case (never the engine's):
//                  it says a line naming its unit, says `fold dir present` when
//                  `<evidence>/.ultrapowers/runs/7/publish-fold` already exists,
//                  prints `fold stub speaking` on stdout, writes `engine-head`,
//                  `receipt.json` and (on `suite red`) `suite-<attempt>.txt`,
//                  and exits `STUB_FOLD_CODE` / `STUB_FOLD_CODE_2`.
//   knobs          `STUB_FOLD_DISPOSITION` / `STUB_FOLD_DISPOSITION_2` (SET BUT
//                  EMPTY is a folder that wrote no disposition — read them with
//                  `${VAR-default}`, not `${VAR:-default}`), `STUB_FOLD_PATH`,
//                  `STUB_FOLD_REASON`, `STUB_FOLD_RESOLVERS`, `STUB_FOLD_CODE`,
//                  `STUB_FOLD_CODE_2`, `STUB_FOLD_PARK`, `STUB_FOLD_NO_HEAD`,
//                  `STUB_FOLD_BAD_RECEIPT`, `STUB_FOLD_ACTIVE`,
//                  `STUB_MERGE_MESSAGE`, `STUB_MERGE_CODE` (a list: PUT n gets
//                  its n-th entry whenever the list has one) and
//                  `STUB_MERGE_CODE_2` (PUT n ≥ 2 once the list runs short,
//                  default 200),
//                  `STUB_MERGEABLE_NULL`, `STUB_INTEGRATION_PUSH_FAIL`.
//   `git`          records `update-ref` and `--force-with-lease` argv the way it
//                  records every other call, and refuses the integration push
//                  under `STUB_INTEGRATION_PUSH_FAIL`.
//   `curl`         answers `GET …/pulls/<n>` with a `mergeable` body
//                  (`STUB_MERGEABLE_NULL` nulls the first N), appends each
//                  `PATCH …/pulls/<n>` payload as one JSON line of `patch.log`,
//                  and answers the merge PUT with `STUB_MERGE_MESSAGE`.
//   `systemctl`    answers `is-active fleet-fold-*` with `STUB_FOLD_ACTIVE`,
//                  `inactive` by default.
//
// The engine-head file and attempt 1's `candidate` are DISTINCT values in the
// rig — leg (b) is the reason: an exam where they are equal cannot tell the two
// restore targets apart, so it asserts they differ before it reads them.
// ═════════════════════════════════════════════════════════════════════════════

const FOLD_UNIT_1 = 'fleet-fold-7-1'
const FOLD_UNIT_2 = 'fleet-fold-7-2'
const PULL_URL = `${API}/repos/${TARGET}/pulls/1`
/** The plan header that gives `plan_closes` one ticket to print. */
const CLOSES_EXTRA = '**Goal:** the smoke\n**Closes:** #12'

// ── the fold's own files ─────────────────────────────────────────────────────

const foldDir = (ctx) => path.join(ctx.home, 'evidence', '.ultrapowers', 'runs', '7', 'publish-fold')
const foldPath = (ctx, name) => path.join(foldDir(ctx), name)
const foldRead = (ctx, name, leg) => {
  const f = foldPath(ctx, name)
  assert.ok(fs.existsSync(f), `${leg} ${f} must exist${whyFold(ctx)}`)
  return fs.readFileSync(f, 'utf8')
}
const receiptOf = (ctx, leg) => {
  const raw = foldRead(ctx, 'receipt.json', leg)
  try {
    return JSON.parse(raw)
  } catch {
    return assert.fail(`${leg} publish-fold/receipt.json must parse as JSON; it holds: ${raw}`)
  }
}
const attemptOf = (ctx, n, leg) => {
  const receipt = receiptOf(ctx, leg)
  const row = (receipt.attempts || {})[String(n)]
  assert.ok(row, `${leg} the receipt records attempt ${n}: ${JSON.stringify(receipt)}`)
  return row
}
/** The last non-blank line of a file the boot's own `tee` wrote. */
const tailLine = (text) => {
  const ls = text.split('\n').filter((l) => l.trim() !== '')
  return ls[ls.length - 1] || ''
}

/** The slice of the boot log a fold leg is about. */
const whyFold = (ctx) => {
  const kept = stream(ctx).filter((l) =>
    l.startsWith('CALL curl') || l.startsWith('CALL systemd-run') ||
    l.startsWith('CALL systemctl') || l.startsWith('CALL git') ||
    l.startsWith('status:') || l.startsWith('engine:') || l.startsWith('publish:') ||
    l.startsWith('merge:') || l.startsWith('outcome:') || l.startsWith('FAILED:') ||
    l.includes('fold'))
  return `\n--- fleet-boot.log (calls, states and fold lines) ---\n${kept.join('\n')}`
}

// ── reading the logs ─────────────────────────────────────────────────────────

const at = (ctx, pred, what, leg) => {
  const i = stream(ctx).findIndex(pred)
  assert.ok(i >= 0, `${leg} the boot log must hold ${what}${whyFold(ctx)}`)
  return i
}
const hasPair = (argv, a, b) => argv.some((w, i) => w === a && argv[i + 1] === b)
const foldUnits = (ctx) => unitsRun(ctx).filter((u) => (u || '').startsWith('fleet-fold-'))
const unitArgv = (ctx, unit, leg) => {
  const argv = argvLines(ctx, 'systemd-run').find((a) => a.includes(`--unit=${unit}`))
  assert.ok(argv, `${leg} a systemd-run of --unit=${unit}; the units run were ` +
    `${JSON.stringify(unitsRun(ctx))}${whyFold(ctx)}`)
  return argv
}
/** The stub's own line for a fold unit's start, which names the unit. */
const foldRunLine = (unit) => (l) => l.startsWith('CALL systemd-run') && l.includes(unit)

const updateRefs = (ctx) => gitLog(ctx).filter((a) => verbOf(a) === 'update-ref')
const integrationPushes = (ctx) => gitLog(ctx).filter(isIntegrationPush)
const leaseOf = (argv) => argv.find((w) => w.startsWith('--force-with-lease'))
const isBranchRevParse = (a) => verbOf(a) === 'rev-parse' && a.includes(INTEGRATION_BRANCH)

const curlCalls = (ctx) => argvLines(ctx, 'curl')
const isMergePut = (a) => a.includes(MERGE_URL)
const isPullGet = (a) => a.includes(PULL_URL) && !a.includes('-X')
const isPullPatch = (a) => a.includes(PULL_URL) && hasPair(a, '-X', 'PATCH')
const indicesOf = (ctx, pred) => curlCalls(ctx).map((a, i) => (pred(a) ? i : -1)).filter((i) => i >= 0)
/** Every PATCH the run sent, as the JSON payload `patch.log` recorded. */
const patches = (ctx) =>
  lines(readLog(ctx, 'patch.log')).map((l) => {
    try {
      return JSON.parse(l)
    } catch {
      return assert.fail(`each line of patch.log is the PATCH's JSON payload; got: ${l}`)
    }
  })

// ── the runs this half reads ─────────────────────────────────────────────────
//
// One boot per shape, started where it is declared and read by every leg that
// asks about it — the same economy `green()` is, and the same concurrency the
// merge half's scenarios are.

/** A boot with `env` on top of the rig's; `expect` null leaves the exit to the leg. */
const bootWith = (env, expect = 0) => started(() => bootRun(env).then((ctx) => {
  if (expect !== null) assert.equal(ctx.result.status, expect, ctx.result.stdout + ctx.result.stderr)
  return ctx
}))

/** The one 405 that buys a retry (M7). */
const NOT_MERGEABLE = { STUB_MERGE_CODE: '405', STUB_MERGE_MESSAGE: 'Pull Request is not mergeable' }

const noCommits = bootWith({ STUB_NO_COMMITS: '1' })
const foldCrash = bootWith({ STUB_FOLD_CODE: '3', STUB_FOLD_DISPOSITION: '' })
const foldCrashNoHead = bootWith({ STUB_FOLD_CODE: '3', STUB_FOLD_DISPOSITION: '', STUB_FOLD_NO_HEAD: '1' })
const foldCrashFolded = bootWith({ STUB_FOLD_CODE: '3', STUB_FOLD_DISPOSITION: 'folded' })
const foldCrashBadReceipt = bootWith({ STUB_FOLD_CODE: '3', STUB_FOLD_DISPOSITION: '', STUB_FOLD_BAD_RECEIPT: '1' })
const foldPark = bootWith({ STUB_FOLD_PARK: '1' }, null)
const crashOnTwo = bootWith({ ...NOT_MERGEABLE, STUB_FOLD_CODE_2: '3', STUB_FOLD_DISPOSITION_2: '' })
const pushFail = bootWith({ STUB_INTEGRATION_PUSH_FAIL: '1' }, null)
const suiteRed = bootWith({ STUB_FOLD_DISPOSITION: 'suite red', STUB_PLAN_EXTRA: CLOSES_EXTRA })
const conflictParked = bootWith({ STUB_FOLD_DISPOSITION: 'conflict parked', STUB_FOLD_PATH: 'a.txt' })
const foldedResolvers = bootWith({ STUB_FOLD_DISPOSITION: 'folded', STUB_FOLD_RESOLVERS: '1' })
const foldedPlain = bootWith({ STUB_FOLD_DISPOSITION: 'folded', STUB_FOLD_RESOLVERS: '0' })
const nothingToJoin = bootWith({ STUB_FOLD_DISPOSITION: 'nothing to join' })
const cannotFold = bootWith({ STUB_FOLD_DISPOSITION: 'cannot fold', STUB_FOLD_REASON: 'base not an ancestor' })
const suiteRedParked = bootWith({ STUB_FOLD_DISPOSITION: 'suite red', STUB_VERDICT: 'NEEDS_ACK' })
const heldFolded = bootWith({ STUB_FOLD_DISPOSITION: 'folded', FLEET_ASSIGNMENT: `${ASSIGNMENT} hold=1` })
const retryMerged = bootWith({ ...NOT_MERGEABLE })
// A merge stub that refuses EVERY PUT. Under the default `FOLD_AGAIN_WAIT` such
// a run folds again for an hour (the fold-again banner at the foot of this file
// is why), so this scenario pins the window shut: `FLEET_FOLD_AGAIN_WAIT: '0'`
// leaves the first base-moved 405 its one fold-again and refuses a third.
const retry405Twice = bootWith({
  ...NOT_MERGEABLE, STUB_MERGE_CODE_2: '405', STUB_FOLD_RESOLVERS: '1',
  FLEET_FOLD_AGAIN_WAIT: '0',
})
const retryTipUnmoved = bootWith({ ...NOT_MERGEABLE, STUB_FOLD_DISPOSITION_2: 'tip unmoved' })
const retrySuiteRed = bootWith({ ...NOT_MERGEABLE, STUB_FOLD_DISPOSITION_2: 'suite red' })
const mergeableLate = bootWith({ ...NOT_MERGEABLE, STUB_MERGEABLE_NULL: '2' })
// A 405 for a reason NO arm matches. `Base branch was modified` stood here
// until #784 made it one of the three that buy the retry; the body GitHub sends
// for a missing review names none of the three, so the scenario keeps its legs
// and only its body moved. (#784's own banner reads this boot as its leg (e).)
const merge405Other = bootWith({
  STUB_MERGE_CODE: '405',
  STUB_MERGE_MESSAGE: 'At least 1 approving review is required by reviewers with write access.',
})
const merge409 = bootWith({ STUB_MERGE_CODE: '409' })
const merge422 = bootWith({ STUB_MERGE_CODE: '422' })
const merge500 = bootWith({ STUB_MERGE_CODE: '500' })
const noGateReceipt = bootWith({ STUB_NO_RECEIPT: '1' })

// ── (a) the fold unit, its argv and its place in the order  [M1] ─────────────

test('the green boot runs the engine, then one fold unit  [publish-fold M1 / leg (a)]', async () => {
  const ctx = await green()
  const units = unitsRun(ctx)
  assert.deepEqual(foldUnits(ctx), [FOLD_UNIT_1],
    `(a) [M1] exactly one fold unit, ${FOLD_UNIT_1}; the units run were ` +
      `${JSON.stringify(units)}${whyFold(ctx)}`)
  assert.ok(units.indexOf('fleet-engine-7') >= 0 &&
    units.indexOf('fleet-engine-7') < units.indexOf(FOLD_UNIT_1),
    `(a) [M1] the engine's unit comes first: ${JSON.stringify(units)}`)
})

test("the fold unit's argv is the engine's bracket, pointed at publish-fold.mjs  [publish-fold M1 / leg (a)]", async () => {
  const ctx = await green()
  const argv = unitArgv(ctx, FOLD_UNIT_1, '(a) [M1]')
  const shown = argv.join(' ')
  for (const word of [
    '--pipe', '--wait', '--collect', 'env', '-u', 'CLAUDE_CONFIG_DIR',
    `ANTHROPIC_BASE_URL=https://claude-max.int.exe.xyz`,
    'CLAUDE_CODE_OAUTH_TOKEN=placeholder', 'ULTRAPOWERS_FLEET_RUN=run-7',
  ]) {
    assert.ok(argv.includes(word), `(a) [M1] the fold unit's argv carries '${word}': ${shown}`)
  }
  for (const [flag, value] of [
    ['-p', 'MemoryMax=40G'],
    ['-p', 'MemorySwapMax=0'],
    ['-p', `WorkingDirectory=${targetDir(ctx)}`],
    ['env', '-u'],
    ['-u', 'CLAUDE_CONFIG_DIR'],
    ['--repo', targetDir(ctx)],
    ['--base', BASE_SHA],
    ['--branch', INTEGRATION_BRANCH],
    ['--run', '7'],
    ['--attempt', '1'],
    ['--evidence-dir', `${ctx.home}/evidence/.ultrapowers/runs/7`],
    ['--run-dir', `${targetDir(ctx)}/.claude/ultrapowers/run-run-7`],
  ]) {
    assert.ok(hasPair(argv, flag, value),
      `(a) [M1] '${flag}' and '${value}' are adjacent words of the fold unit's argv: ${shown}`)
  }
  assert.ok(argv.some((w) => w.endsWith('/fleet/publish-fold.mjs')),
    `(a) [M1] the folder the unit runs is a word ending /fleet/publish-fold.mjs: ${shown}`)
})

test("the fold's output is teed into publish-fold/publish-fold-1.log  [publish-fold M1 / leg (a)]", async () => {
  const ctx = await green()
  const log = foldRead(ctx, 'publish-fold-1.log', '(a) [M1]')
  assert.ok(log.includes('fold stub speaking'),
    `(a) [M1] the boot's own tee wrote the unit's stdout into publish-fold-1.log; it holds:\n${log}`)
  assert.ok(stream(ctx).some((l) => l.includes('fold dir present')),
    `(a) [M1] the receipts directory is made BEFORE the bracket — tee -a needs it, and the ` +
      `stub says so only when it already exists${whyFold(ctx)}`)
})

test('running/publish fold, the unit, its await and publishing are in that order  [publish-fold M1 / leg (a)]', async () => {
  const ctx = await green()
  const running = at(ctx, (l) => l.startsWith('status: state=running') && l.includes('phase=publish fold'),
    'a `status: state=running phase=publish fold` line', '(a) [M1]')
  const unit = at(ctx, foldRunLine(FOLD_UNIT_1), `the fold unit's systemd-run line`, '(a) [M1]')
  const active = at(ctx, (l) => l.includes(`systemctl is-active ${FOLD_UNIT_1}.service`),
    `an is-active read of ${FOLD_UNIT_1}.service`, '(a) [M1]')
  const publishing = at(ctx, (l) => l.startsWith('status: state=publishing'),
    'a `status: state=publishing` line', '(a) [M1]')
  assert.ok(running < unit, `(a) [M1] the page says publish fold before the unit starts${whyFold(ctx)}`)
  assert.ok(unit < active, `(a) [M1] the unit is awaited after it is started${whyFold(ctx)}`)
  assert.ok(active < publishing,
    `(a) [M1] publishing is claimed only after the fold unit is inactive${whyFold(ctx)}`)
})

test('no phase_refresher runs beside the fold unit  [publish-fold M1 / leg (a)]', async () => {
  const ctx = await green()
  const s = stream(ctx)
  const exited = s.findIndex((l) => l.startsWith('engine: exited'))
  assert.ok(exited >= 0, `(a) [M1] the engine's exit line is in the log${whyFold(ctx)}`)
  const after = s.slice(exited).filter((l) => l.startsWith('status: state=running'))
  assert.equal(after.length, 1,
    `(a) [M1] exactly one running page is written after the engine exits — a refresher beside ` +
      `the fold would write more, and would erase the deadman's page:\n${after.join('\n')}`)
  assert.ok(after[0].includes('phase=publish fold'),
    `(a) [M1] and that one is the fold's: ${after[0]}`)
})

test("the engine's done marker holds the engine's code, not the fold's  [publish-fold M1 / leg (a)]", async () => {
  for (const [label, ctx] of [['the green boot', await green()], ['a fold that exited 3', await foldCrash()]]) {
    assert.deepEqual(foldUnits(ctx), [FOLD_UNIT_1],
      `(a) [M1] ${label} ran the fold unit${whyFold(ctx)}`)
    const marker = path.join(ctx.home, '.fleet-engine-done')
    assert.ok(fs.existsSync(marker), `(a) [M1] ${label} leaves the engine's marker`)
    assert.equal(fs.readFileSync(marker, 'utf8').trim(), '0',
      `(a) [M1] ${label}: the marker still holds the ENGINE's exit code — a fold that wrote ` +
        `it would be read as an engine failure on re-entry`)
  }
})

test('a parked outcome runs the fold unit too  [publish-fold M1 / leg (a)]', async () => {
  const ctx = await parked()
  assert.equal(statusOf(ctx).state, 'parked')
  assert.deepEqual(foldUnits(ctx), [FOLD_UNIT_1],
    `(a) [M1] gate-green and parked alike fold, as long as there are commits ahead of BASE` +
      `${whyFold(ctx)}`)
})

test('a branch with nothing ahead of BASE starts no fold unit  [publish-fold M1 / leg (a)]', async () => {
  const ctx = await noCommits()
  assert.equal(statusOf(ctx).state, 'parked')
  assert.deepEqual(foldUnits(ctx), [],
    `(a) [M1] nothing to publish is nothing to fold${whyFold(ctx)}`)
  assert.ok(!fs.existsSync(foldDir(ctx)),
    '(a) [M1] and no receipts directory is made for a fold that never runs')
})

// ── (b) the page first, the crash row, and the deadman  [M2] ─────────────────

test('a fold that exits non-zero with no disposition restores the ref and writes a crash row  [publish-fold M2 / leg (b)]', async () => {
  const ctx = await foldCrash()
  const leg = '(b) [M2]'
  const head = foldRead(ctx, 'engine-head', leg).trim()
  const refs = updateRefs(ctx)
  assert.equal(refs.length, 1, `${leg} exactly one update-ref: ${JSON.stringify(refs)}`)
  assert.equal(dirOf(refs[0]), targetDir(ctx), `${leg} run in the target clone: ${refs[0].join(' ')}`)
  assert.deepEqual(refs[0].slice(refs[0].indexOf('update-ref')),
    ['update-ref', `refs/heads/${INTEGRATION_BRANCH}`, head],
    `${leg} the ref goes back to the engine-head file's content (${head})`)

  const row = attemptOf(ctx, 1, leg)
  assert.equal(row.disposition, 'cannot fold', `${leg} the invoked attempt's disposition`)
  assert.ok(String(row.reason).includes('exit 3'),
    `${leg} the reason names the exit code; got: ${row.reason}`)
  const last = tailLine(foldRead(ctx, 'publish-fold-1.log', leg))
  assert.ok(last !== '' && String(row.reason).includes(last),
    `${leg} and the log's last line ('${last}'); got: ${row.reason}`)
  assert.equal(row.candidate, head, `${leg} the candidate is the restored sha`)

  assert.equal(integrationPushes(ctx).length, 1, `${leg} the branch is still pushed${whyFold(ctx)}`)
  assert.equal(prPosts(ctx).length, 1, `${leg} and the PR is still opened`)
  const status = statusOf(ctx)
  assert.equal(status.state, 'done', `${leg} the run still ends done${whyFold(ctx)}`)
  assert.ok(String(status.phase).includes('cannot fold'),
    `${leg} whose phase carries the disposition; got: ${status.phase}`)
})

test('a crash before the folder wrote engine-head reads the branch first  [publish-fold M2 / leg (b)]', async () => {
  const ctx = await foldCrashNoHead()
  const leg = '(b) [M2]'
  const git = gitLog(ctx)
  const revParse = git.findIndex(isBranchRevParse)
  const updateRef = git.findIndex((a) => verbOf(a) === 'update-ref')
  assert.ok(revParse >= 0, `${leg} the branch is read with rev-parse when engine-head is absent`)
  assert.ok(updateRef >= 0, `${leg} and the ref is restored${whyFold(ctx)}`)
  assert.ok(revParse < updateRef,
    `${leg} the rev-parse comes first — the file is written before it is read back`)
  const receipt = receiptOf(ctx, leg)
  assert.equal(receipt.engineHead, HEAD_SHA,
    `${leg} the receipt is created from nothing with engineHead = the rev-parse answer`)
  assert.equal(attemptOf(ctx, 1, leg).disposition, 'cannot fold', `${leg} and carries the crash row`)
})

test('a fold that wrote its disposition and then died keeps its row  [publish-fold M2 / leg (b)]', async () => {
  const ctx = await foldCrashFolded()
  const leg = '(b) [M2]'
  assert.deepEqual(updateRefs(ctx), [],
    `${leg} no ref is restored: the invoked attempt recorded a disposition${whyFold(ctx)}`)
  const row = attemptOf(ctx, 1, leg)
  assert.equal(row.disposition, 'folded',
    `${leg} and the folder's own disposition is not overwritten by a crash row`)
})

test("attempt 2's crash restores attempt 1's candidate, not engine-head  [publish-fold M2 / leg (b)]", async () => {
  const ctx = await crashOnTwo()
  const leg = '(b) [M2]'
  const head = foldRead(ctx, 'engine-head', leg).trim()
  const first = attemptOf(ctx, 1, leg)
  assert.notEqual(first.candidate, head,
    `${leg} the rig writes engine-head and attempt 1's candidate distinct, or this leg proves nothing`)
  const refs = updateRefs(ctx)
  assert.equal(refs.length, 1, `${leg} one update-ref: ${JSON.stringify(refs)}`)
  assert.deepEqual(refs[0].slice(refs[0].indexOf('update-ref')),
    ['update-ref', `refs/heads/${INTEGRATION_BRANCH}`, first.candidate],
    `${leg} attempt 2's restore target is attempt 1's candidate (${first.candidate})`)
  const second = attemptOf(ctx, 2, leg)
  assert.equal(second.disposition, 'cannot fold', `${leg} attempt 2's row`)
  assert.equal(second.candidate, first.candidate, `${leg} carrying that same sha as its candidate`)
  const pushes = integrationPushes(ctx)
  assert.equal(pushes.length, 2, `${leg} two pushes of the integration branch${whyFold(ctx)}`)
  assert.equal(leaseOf(pushes[1]), `--force-with-lease=${INTEGRATION_BRANCH}:${first.pushedHead}`,
    `${leg} and the second carries the lease: ${pushes[1].join(' ')}`)
})

test('an unparsable receipt at crash time is replaced, not read  [publish-fold M2 / leg (b)]', async () => {
  const ctx = await foldCrashBadReceipt()
  const leg = '(b) [M2]'
  const receipt = receiptOf(ctx, leg)
  assert.equal(receipt.engineHead, HEAD_SHA,
    `${leg} the crash row still lands, starting from { engineHead: <rev-parse>, attempts: {} }`)
  assert.equal(attemptOf(ctx, 1, leg).disposition, 'cannot fold', `${leg} with attempt 1's row`)
  const refs = updateRefs(ctx)
  assert.equal(refs.length, 1, `${leg} one update-ref: ${JSON.stringify(refs)}`)
  assert.equal(refs[0][refs[0].length - 1], HEAD_SHA, `${leg} carrying that same sha`)
  const pushes = integrationPushes(ctx)
  assert.equal(pushes.length, 1, `${leg} one push${whyFold(ctx)}`)
  assert.equal(leaseOf(pushes[0]), undefined,
    `${leg} and no attempt names a pushedHead, so the push is plain: ${pushes[0].join(' ')}`)
})

test("the deadman's parked page ends the run at 0 with no push and no PR  [publish-fold M2 / leg (b)]", async () => {
  const ctx = await foldPark()
  const leg = '(b) [M2]'
  assert.equal(ctx.result.status, 0,
    `${leg} the deadman's own exit is taken: ${ctx.result.stdout}${ctx.result.stderr}`)
  assert.equal(statusOf(ctx).state, 'parked', `${leg} the page the deadman wrote stands${whyFold(ctx)}`)

  const unit = at(ctx, foldRunLine(FOLD_UNIT_1), `the fold unit's systemd-run line`, leg)
  const after = stream(ctx).slice(unit).filter((l) => l.startsWith('status: state='))
  assert.deepEqual(after, [],
    `${leg} the boot writes no status line of its own after the deadman's:\n${after.join('\n')}`)

  assert.ok(gitLog(ctx).some((a) => verbOf(a) === 'commit' &&
    a.some((w) => w.includes('parked — deadman'))),
    `${leg} the evidence commit's subject is 'run-7: parked — deadman'${whyFold(ctx)}`)
  assert.ok(gitLog(ctx).some((a) => verbOf(a) === 'ls-remote' && a.includes('--tags')),
    `${leg} record_tags still runs${whyFold(ctx)}`)
  assert.equal(integrationPushes(ctx).length, 0, `${leg} no branch push`)
  assert.equal(prPosts(ctx).length, 0, `${leg} and no PR POST`)
  assert.ok(!fs.existsSync(foldPath(ctx, 'receipt.json.tmp')),
    `${leg} and the receipt's .tmp is removed`)
})

/** A home whose page says a fold is running, and the deadman's own pass over
 *  it — leg (i)'s scenario, started at load like every other. */
const deadmanOverFold = started(() => {
  const ctx = makeHome()
  const page = {
    run: '7', state: 'running', phase: 'publish fold', pr: PR_URL, prAuthor: PR_AUTHOR,
    merged: mergeSha(), branch: INTEGRATION_BRANCH, vm: VM_NAME,
    startedAt: '2026-09-06T00:00:00Z', updatedAt: '2026-09-06T00:00:01Z', error: null,
  }
  fs.mkdirSync(path.join(ctx.home, 'www'), { recursive: true })
  fs.writeFileSync(path.join(ctx.home, 'www', 'status.json'), JSON.stringify(page))
  return gatedBoot(ctx, ['deadman'], { STUB_ENGINE_ACTIVE: 'active', STUB_FOLD_ACTIVE: 'active' })
    .then((dead) => { ctx.dead = dead; return ctx })
})

test('the deadman stops the fold units beside the engine and carries the PR cells forward  [publish-fold M2 / leg (i)]', async () => {
  const ctx = await deadmanOverFold()
  const dead = ctx.dead
  assert.equal(dead.status, 0, dead.stdout + dead.stderr)

  const stops = argvLines(ctx, 'systemctl').filter((a) => a.includes('stop')).map((a) => a.join(' '))
  assert.ok(stops.some((l) => l.endsWith('stop fleet-engine-7.service')),
    `(i) [M2] the engine's unit is stopped:\n${stops.join('\n')}`)
  assert.ok(stops.some((l) => l.endsWith(`stop ${FOLD_UNIT_1}.service`)),
    `(i) [M2] and every active fleet-fold-7-* unit beside it:\n${stops.join('\n')}`)

  const status = statusOf(ctx)
  assert.equal(status.state, 'parked', '(i) [M2] the page is parked')
  assert.equal(status.pr, PR_URL, '(i) [M2] carrying the pr cell the page it overwrote held')
  assert.equal(status.prAuthor, PR_AUTHOR, '(i) [M2] its prAuthor')
  assert.equal(status.merged, mergeSha(), '(i) [M2] and its merged')
})

// ═════════════════════════════════════════════════════════════════════════════
// THE DEADMAN'S WIDENING — task #808, "The deadman widening and the fold-again
// window are pinned under an injectable clock" (residual of #801, PR #800).
//
// The pair above lands on the `folds=2` FLOOR: its page says `publish fold`,
// which matches no `publish fold (attempt <n>)`, so it cannot see that
// `do_deadman` reads `phase` off the page BEFORE it overwrites it and makes
// that `<n>` the highest fold unit it stops. These two legs are that widening
// and its negative. The clauses they encode, in the task's own numbering:
//
//   M1  a `deadman` over a seeded `{run: '7', state: 'running', phase:
//       'publish fold (attempt 4)'}` page with `STUB_ENGINE_ACTIVE=active` and
//       `STUB_FOLD_ACTIVE=active` exits 0 and records in `argvLines(ctx,
//       'systemctl')` one `stop fleet-fold-7-<n>.service` for each n of 1, 2, 3
//       and 4, and no stop for any other `fleet-fold-7-` unit.        leg (a)
//   M2  the same invocation against a copy of `fleet/sandbox-boot.sh` from
//       which the `case "$phase_now" in … esac` block of `do_deadman` has been
//       removed exits 0, records the stops for `-1` and `-2`, and records no
//       stop for `-3` and none for `-4` — the floor line
//       `[ "$folds" -ge 2 ]` stays, which is why two survive.         leg (b)
//
// WHAT THESE ASK OF THE RIG (`_sandbox_boot_helpers.mjs`, this task's own
// file): ONE seam, for M2 — a way to run a script other than `SCRIPT`. An
// optional trailing `script` argument on `boot` and `bootAsync`, defaulting to
// `SCRIPT`, is what leg (b) calls; the boot script has no `$0`/`BASH_SOURCE`
// self-reference, so a copy written under `ctx.home` runs identically.
// ═════════════════════════════════════════════════════════════════════════════

/** The phase the fold's fourth attempt leaves on the page — what M1 seeds. */
const DEADMAN_PHASE = 'publish fold (attempt 4)'
/** Both `is-active` knobs answering `active`, so every unit named is stopped. */
const DEADMAN_ACTIVE = { STUB_ENGINE_ACTIVE: 'active', STUB_FOLD_ACTIVE: 'active' }
const FOLD_UNIT_5 = 'fleet-fold-7-5'

/** The page a deadman reads, written by hand — no boot: `do_deadman` reads
 *  `run`, `state`, `phase`, `pr`, `prAuthor`, `merged`, `startedAt` and `vm`
 *  straight off it. */
const seedDeadmanPage = (ctx, phase) => {
  const page = {
    run: '7', state: 'running', phase, pr: PR_URL, prAuthor: PR_AUTHOR,
    merged: mergeSha(), branch: INTEGRATION_BRANCH, vm: VM_NAME,
    startedAt: '2026-09-06T00:00:00Z', updatedAt: '2026-09-06T00:00:01Z', error: null,
  }
  fs.mkdirSync(path.join(ctx.home, 'www'), { recursive: true })
  fs.writeFileSync(path.join(ctx.home, 'www', 'status.json'), JSON.stringify(page))
  return ctx
}

/** Every unit a `systemctl … stop` named, in the order the stops were made. */
const stopsOf = (ctx) => argvLines(ctx, 'systemctl')
  .filter((a) => a.includes('stop'))
  .map((a) => a[a.length - 1])
/** Only the fold units among them, sorted, so the leg reads a SET. */
const foldStopsOf = (ctx) =>
  stopsOf(ctx).filter((u) => u.startsWith('fleet-fold-7-')).slice().sort()
const stopped = (n) => `fleet-fold-7-${n}.service`

/**
 * M2's mutant, cut out of the real script's text: the lines from
 * `phase_now="$(read_status_field phase)"` through the `esac` that closes the
 * `case` over it. Everything else — the floor line included — stays.
 */
const cutPhaseNowBlock = (ls) => {
  const from = ls.findIndex((l) => l.includes('phase_now="$(read_status_field phase)"'))
  assert.ok(from >= 0,
    '(b) [#808 M2] fleet/sandbox-boot.sh must carry the line `phase_now="$(read_status_field ' +
      'phase)"` in do_deadman — it is the read this mutant cuts out')
  let to = -1
  for (let i = from + 1; i < ls.length; i += 1) {
    if (ls[i].trim() === 'esac') { to = i; break }
  }
  assert.ok(to > from,
    '(b) [#808 M2] and an `esac` after it, closing the `case "$phase_now" in` block')
  const cut = ls.slice(from, to + 1)
  assert.ok(cut.some((l) => l.includes('case "$phase_now" in')),
    `(b) [#808 M2] the cut block is the case over the phase; it was:\n${cut.join('\n')}`)
  const kept = [...ls.slice(0, from), ...ls.slice(to + 1)].join('\n')
  // The `local state phase_now folds=2` declaration stays where it is: what the
  // cut removes is the READ of the phase and the `case` that widens `folds`.
  assert.ok(!kept.includes('phase_now="$(read_status_field phase)"') &&
    !kept.includes('case "$phase_now" in'),
    '(b) [#808 M2] the mutant reads the page\'s phase nowhere and widens folds nowhere — that ' +
      'is the whole cut')
  assert.ok(kept.includes('[ "$folds" -ge 2 ]'),
    '(b) [#808 M2] but keeps the floor line `[ "$folds" -ge 2 ]`, which is why the mutant still ' +
      'stops units 1 and 2')
  return kept
}

/** `gatedBoot`, for a script other than `SCRIPT`: the rig's seam, behind the
 *  same width gate every other boot of this file runs behind. */
const gatedScript = (ctx, args, env, script) =>
  acquire().then(() => bootAsync(ctx, args, env, script).finally(release))

/** Leg (a)'s run: the real script over the widened page. */
const deadmanWide = started(() => {
  const ctx = seedDeadmanPage(makeHome(), DEADMAN_PHASE)
  return gatedBoot(ctx, ['deadman'], { ...DEADMAN_ACTIVE })
    .then((dead) => { ctx.dead = dead; return ctx })
})

/** Leg (b)'s: the same page, the same knobs, the mutant script. `async` so that
 *  a failure while CUTTING the script is this leg's rejection to report, not a
 *  throw at module load that would take the whole file down with it. */
const deadmanMutant = started(async () => {
  const ctx = seedDeadmanPage(makeHome(), DEADMAN_PHASE)
  const script = path.join(ctx.home, 'sandbox-boot-no-phase-now.sh')
  fs.writeFileSync(script, cutPhaseNowBlock(linesOf(SCRIPT)))
  ctx.script = script
  ctx.dead = await gatedScript(ctx, ['deadman'], { ...DEADMAN_ACTIVE }, script)
  return ctx
})

test(`a deadman over a '${DEADMAN_PHASE}' page stops all four fold units  [#808 M1 / leg (a)]`, async () => {
  const ctx = await deadmanWide()
  const leg = '(a) [#808 M1]'
  assert.equal(ctx.dead.status, 0,
    `${leg} the deadman exits 0: ${ctx.dead.stdout}${ctx.dead.stderr}`)

  const stops = stopsOf(ctx)
  assert.ok(stops.includes('fleet-engine-7.service'),
    `${leg} the engine's unit is stopped beside the folds. The stops were ` +
      `${JSON.stringify(stops)}`)
  for (const n of [1, 2, 3, 4]) {
    assert.ok(stops.includes(stopped(n)),
      `${leg} do_deadman reads '${DEADMAN_PHASE}' off the page before it overwrites it and ` +
        `stops fleet-fold-7-1 … -${4} — one \`systemctl --user stop ${stopped(n)}\` is owed ` +
        `and none was made. The stops were ${JSON.stringify(stops)}`)
  }
  assert.deepEqual(foldStopsOf(ctx), [stopped(1), stopped(2), stopped(3), stopped(4)],
    `${leg} and EXACTLY those four: the phase's <n> is the highest unit this run can have ` +
      `started, so a fifth such as ${FOLD_UNIT_5} is absent. The fold stops were ` +
      `${JSON.stringify(foldStopsOf(ctx))}`)
})

test('the same page against a script with the phase_now block cut stops only the floor pair  [#808 M2 / leg (b)]', async () => {
  const ctx = await deadmanMutant()
  const leg = '(b) [#808 M2]'
  assert.equal(ctx.dead.status, 0,
    `${leg} the mutant deadman exits 0 too: ${ctx.dead.stdout}${ctx.dead.stderr}`)

  const stops = stopsOf(ctx)
  const seam =
    `\nThe run was \`bootAsync(ctx, ['deadman'], env, '${ctx.script}')\` — the rig's script ` +
    `seam, an optional trailing \`script\` argument on \`boot\` and \`bootAsync\` defaulting to ` +
    `SCRIPT. A rig that ignores it runs fleet/sandbox-boot.sh itself, which stops all four, ` +
    `and this leg proves nothing about the widening. The stops were ${JSON.stringify(stops)}`
  for (const n of [1, 2]) {
    assert.ok(stops.includes(stopped(n)),
      `${leg} the floor line survives the cut, so the mutant still stops ${stopped(n)}.${seam}`)
  }
  for (const n of [3, 4]) {
    assert.ok(!stops.includes(stopped(n)),
      `${leg} and WITHOUT the phase read there is no widening: no stop names ${stopped(n)}. ` +
        `That is leg (a)'s negative — the two legs differ only in this block.${seam}`)
  }
  assert.deepEqual(foldStopsOf(ctx), [stopped(1), stopped(2)],
    `${leg} the mutant's fold stops are exactly the floor pair.${seam}`)
})

// ── (c) push_head  [M3] ──────────────────────────────────────────────────────

test('the green boot pushes the branch plainly, then reads it back  [publish-fold M3 / leg (c)]', async () => {
  const ctx = await green()
  const leg = '(c) [M3]'
  const pushes = integrationPushes(ctx)
  assert.equal(pushes.length, 1, `${leg} exactly one push of ${INTEGRATION_BRANCH}${whyFold(ctx)}`)
  assert.equal(leaseOf(pushes[0]), undefined,
    `${leg} no attempt names a pushedHead yet, so no --force-with-lease: ${pushes[0].join(' ')}`)
  const push = at(ctx, (l) => l.startsWith('CALL git') && l.includes('push') &&
    l.includes(INTEGRATION_BRANCH), `the integration branch's push`, leg)
  const visible = at(ctx, (l) => l.startsWith('CALL curl branches'),
    `the branches read await_branch_visible makes`, leg)
  assert.ok(push < visible, `${leg} await_branch_visible follows the push${whyFold(ctx)}`)
  assert.equal(attemptOf(ctx, 1, leg).pushedHead, HEAD_SHA,
    `${leg} and the pushed sha is recorded as attempt 1's pushedHead`)
})

test('a re-entry that already recorded a PR still pushes, and POSTs nothing  [publish-fold M3 / leg (c)]', () => {
  const ctx = makeHome()
  assert.equal(boot(ctx).status, 0)
  const pushesBefore = integrationPushes(ctx).length
  const postsBefore = prPosts(ctx).length
  assert.equal(postsBefore, 1, '(c) [M3] the first pass opened the PR')
  // The unit restarted with the PR already on the page: `publish` is guarded,
  // `push_head` is not.
  fs.writeFileSync(path.join(ctx.home, 'www', 'status.json'),
    JSON.stringify({ ...statusOf(ctx), state: 'running', merged: null }))

  const again = boot(ctx)
  assert.equal(again.status, 0, again.stdout + again.stderr)
  assert.equal(prPosts(ctx).length, postsBefore,
    `(c) [M3] publish keeps only the POST, and a recorded pr still skips it${whyFold(ctx)}`)
  assert.ok(integrationPushes(ctx).length > pushesBefore,
    `(c) [M3] but the head is pushed again — the push left publish with the re-entry${whyFold(ctx)}`)
})

test('a refused integration push fails the run before the PR  [publish-fold M3 / leg (c)]', async () => {
  const ctx = await pushFail()
  const leg = '(c) [M3]'
  assert.notEqual(ctx.result.status, 0, `${leg} a refused push ends the run non-zero`)
  const status = statusOf(ctx)
  assert.equal(status.state, 'failed', `${leg} the page is failed${whyFold(ctx)}`)
  assert.match(String(status.error), /push/, `${leg} the error names the push; got: ${status.error}`)
  assert.ok(String(status.error).includes(INTEGRATION_BRANCH),
    `${leg} and the branch it refused; got: ${status.error}`)
  assert.equal(curlCalls(ctx).filter((a) => a.some((w) => w.includes('/branches/'))).length, 0,
    `${leg} nothing is read back${whyFold(ctx)}`)
  assert.equal(prPosts(ctx).length, 0, `${leg} and no PR is opened`)
})

// ── (d) the PR body  [M4] ────────────────────────────────────────────────────

const bodyOf = (ctx, leg) => {
  const posts = prPosts(ctx)
  assert.equal(posts.length, 1, `${leg} the run opened one PR${whyFold(ctx)}`)
  return posts[0].body
}

test("a suite-red fold puts its section, its tail and publish-fold in the body  [publish-fold M4 / leg (d)]", async () => {
  const ctx = await suiteRed()
  const leg = '(d) [M4]'
  const body = bodyOf(ctx, leg)
  const section = body.indexOf('## Publish fold')
  const evidence = body.indexOf('### Evidence')
  assert.ok(section >= 0, `${leg} the body carries a '## Publish fold' section:\n${body}`)
  assert.ok(evidence >= 0 && section < evidence,
    `${leg} which sits before '### Evidence':\n${body}`)
  assert.ok(body.includes('suite red'), `${leg} it names the disposition:\n${body}`)
  const tail = tailLine(foldRead(ctx, 'suite-1.txt', leg))
  assert.ok(tail !== '' && body.includes(tail),
    `${leg} and the tail of publish-fold/suite-1.txt ('${tail}'):\n${body}`)
  assert.ok(body.split('\n').some((l) => l.trim() === '- publish-fold'),
    `${leg} the evidence listing names publish-fold, without a slash:\n${body}`)
  assert.equal(tailLine(body), 'Closes #12',
    `${leg} and plan_closes' lines are still the body's last:\n${body}`)
})

test('a conflict-parked fold names its path in the body  [publish-fold M4 / leg (d)]', async () => {
  const ctx = await conflictParked()
  const body = bodyOf(ctx, '(d) [M4]')
  assert.ok(body.includes('## Publish fold'), `(d) [M4] the section is rendered:\n${body}`)
  assert.ok(body.includes('conflict parked on a.txt'),
    `(d) [M4] naming the disposition and the path:\n${body}`)
})

test('a folded run renders the section only when it dispatched a resolver  [publish-fold M4 / leg (d)]', async () => {
  const withResolver = bodyOf(await foldedResolvers(), '(d) [M4] folded, one resolver:')
  assert.ok(withResolver.includes('## Publish fold'),
    `(d) [M4] a folded whose resolversDispatched is non-zero gets a section:\n${withResolver}`)
  const plain = bodyOf(await foldedPlain(), '(d) [M4] folded, no resolver:')
  assert.ok(!plain.includes('## Publish fold'),
    `(d) [M4] a folded with zero resolvers gets none — there is nothing to disclose:\n${plain}`)
})

test('nothing to join renders no section  [publish-fold M4 / leg (d)]', async () => {
  const ctx = await nothingToJoin()
  assert.equal(attemptOf(ctx, 1, '(d) [M4]').disposition, 'nothing to join',
    '(d) [M4] the fold ran and recorded its disposition')
  const body = bodyOf(ctx, '(d) [M4] nothing to join:')
  assert.ok(!body.includes('## Publish fold'),
    `(d) [M4] a run with nothing to join says nothing about the fold:\n${body}`)
})

// ── (e) FOLD_HOLD  [M5] ─────────────────────────────────────────────────────

const phaseOf = (ctx) => String(statusOf(ctx).phase)

test('a red suite holds the PR: no check read, no PUT, and the failure in the phase  [publish-fold M5 / leg (e)]', async () => {
  const ctx = await suiteRed()
  const leg = '(e) [M5]'
  assert.equal(checkRunRequests(ctx), 0,
    `${leg} a non-empty FOLD_HOLD reads no commit's runs at all${whyFold(ctx)}`)
  assert.equal(mergeableReads(ctx), 0,
    `${leg} and does not read the PR's tip either — the hold is taken before ` +
      `either read${whyFold(ctx)}`)
  assert.deepEqual(mergePuts(ctx), [], `${leg} and issues no PUT`)
  assert.equal(prPosts(ctx)[0].draft, false,
    `${leg} a gate-green outcome still opens its PR non-draft`)
  assert.ok(phaseOf(ctx).includes('left open: publish fold — suite red'),
    `${leg} and the done phase is FOLD_HOLD's text; got: ${phaseOf(ctx)}`)
})

test('a parked conflict names its path in the phase  [publish-fold M5 / leg (e)]', async () => {
  const ctx = await conflictParked()
  assert.equal(attemptOf(ctx, 1, '(e) [M5]').disposition, 'conflict parked',
    '(e) [M5] the fold parked on a conflict')
  assert.ok(phaseOf(ctx).includes('left open: publish fold — conflict parked on a.txt'),
    `(e) [M5] got: ${phaseOf(ctx)}`)
  assert.deepEqual(mergePuts(ctx), [], '(e) [M5] and no PUT was issued')
})

test('a cannot-fold names its reason in the phase  [publish-fold M5 / leg (e)]', async () => {
  const ctx = await cannotFold()
  assert.equal(attemptOf(ctx, 1, '(e) [M5]').disposition, 'cannot fold',
    '(e) [M5] the fold could not fold')
  assert.ok(phaseOf(ctx).includes('left open: publish fold — cannot fold: base not an ancestor'),
    `(e) [M5] got: ${phaseOf(ctx)}`)
  assert.deepEqual(mergePuts(ctx), [], '(e) [M5] and no PUT was issued')
})

test('a held run under a fold hold still says hold=1  [publish-fold M5 / leg (e)]', async () => {
  const ctx = await heldFolded()
  assert.deepEqual(foldUnits(ctx), [FOLD_UNIT_1],
    `(e) [M5] a held run folds all the same${whyFold(ctx)}`)
  assert.ok(phaseOf(ctx).includes('left open: hold=1'),
    `(e) [M5] hold=1 keeps its own note whatever the disposition; got: ${phaseOf(ctx)}`)
  assert.deepEqual(mergePuts(ctx), [], '(e) [M5] and no PUT')
})

test('a red suite on a parked outcome still opens a draft  [publish-fold M5 / leg (e)]', async () => {
  const ctx = await suiteRedParked()
  assert.equal(attemptOf(ctx, 1, '(e) [M5]').disposition, 'suite red',
    '(e) [M5] the fold ran and its suite was red')
  assert.equal(prPosts(ctx)[0].draft, true,
    `(e) [M5] the draft flag follows the gate's outcome, not the fold's${whyFold(ctx)}`)
})

for (const [name, folded] of [['folded', foldedPlain], ['nothing to join', nothingToJoin]]) {
  test(`a ${name} fold merges the way the green path does  [publish-fold M5 / leg (e)]`, async () => {
    const ctx = await folded()
    assert.equal(attemptOf(ctx, 1, '(e) [M5]').disposition, name,
      `(e) [M5] the fold ran and disposed of the join as '${name}'`)
    assert.equal(mergePuts(ctx).length, 1,
      `(e) [M5] '${name}' is an empty FOLD_HOLD, so the merge runs${whyFold(ctx)}`)
    assert.equal(statusOf(ctx).merged, mergeSha(), `(e) [M5] and the PR is merged`)
    assert.equal(statusOf(ctx).state, 'done')
  })
}

// ── (f) the merge payload's commit_message  [M6] ─────────────────────────────

test('the merge PUT carries the run and plan tag as its commit_message  [publish-fold M6 / leg (f)]', async () => {
  const ctx = await green()
  const puts = mergePuts(ctx)
  assert.equal(puts.length, 1, '(f) [M6] the green path merges once')
  assert.equal(puts[0].commit_message, 'Fleet-Run: 7\nPlan-Tag: ultra/plan/run-7',
    '(f) [M6] the squash body names the run and the plan tag, exactly')
  assert.equal(puts[0].commit_title, PLAN_H1, "(f) [M6] beside the unchanged commit_title")
  assert.equal(puts[0].merge_method, 'squash', '(f) [M6] merge_method')
  assert.equal(puts[0].sha, HEAD_SHA, '(f) [M6] and sha')
})

// ── (g) the one retry  [M7] ─────────────────────────────────────────────────

test('a 405 saying "not mergeable" buys one more fold, one leased push and one more PUT  [publish-fold M7 / leg (g)]', async () => {
  const ctx = await retryMerged()
  const leg = '(g) [M7]'
  assert.deepEqual(commitStates(ctx), ['running', 'publishing', 'running', 'publishing', 'done'],
    `${leg} the retry's evidence commits${whyFold(ctx)}`)
  const units = foldUnits(ctx)
  assert.deepEqual(units, [FOLD_UNIT_1, FOLD_UNIT_2],
    `${leg} a second fold unit, after the first: ${JSON.stringify(unitsRun(ctx))}`)

  const running2 = at(ctx, (l) => l.includes('phase=publish fold (attempt 2)'),
    'a `running` page with phase `publish fold (attempt 2)`', leg)
  const unit2 = at(ctx, foldRunLine(FOLD_UNIT_2), `the second fold unit's systemd-run line`, leg)
  const active2 = at(ctx, (l) => l.includes(`systemctl is-active ${FOLD_UNIT_2}.service`),
    `an is-active read of ${FOLD_UNIT_2}.service`, leg)
  const lease = at(ctx, (l) => l.startsWith('CALL git') && l.includes('--force-with-lease'),
    'the leased push', leg)
  const s = stream(ctx)
  const publishing2 = s.findIndex((l, i) => i > lease && l.startsWith('status: state=publishing'))
  assert.ok(running2 < unit2 && unit2 < active2 && active2 < lease && lease < publishing2,
    `${leg} running (attempt 2) → the unit → its await → push_head → publishing${whyFold(ctx)}`)

  const puts = indicesOf(ctx, isMergePut)
  assert.equal(puts.length, 2, `${leg} exactly two PUTs${whyFold(ctx)}`)
  const second = attemptOf(ctx, 2, leg)
  assert.ok(second.pushedHead,
    `${leg} the receipt records attempt 2's pushedHead: ${JSON.stringify(second)}`)

  // Run-90 retired the poll of the target's commit runs that this leg was first
  // written against: the merge gate reads the PR's own tip now. So what stands
  // between attempt 2's leased push and PUT 2 is a `curl pr read` — the rig's
  // line for `GET /pulls/<n>` — and the run reads no commit's runs at all.
  const put2 = s.findIndex((l, i) => i > lease && l === 'CALL curl pr merge')
  assert.ok(put2 > lease, `${leg} PUT 2 follows the leased push${whyFold(ctx)}`)
  const tipReads = s.filter((l, i) => i > lease && i < put2 && l.startsWith('CALL curl pr read')).length
  assert.ok(tipReads >= 1,
    `${leg} and at least one 'curl pr read' stands between them${whyFold(ctx)}`)
  assert.ok(mergeableReads(ctx) >= 1, `${leg} which is what the run's tip reads are`)
  assert.equal(checkRunRequests(ctx), 0,
    `${leg} while the run reads no commit's runs at all${whyFold(ctx)}`)
  assert.equal(mergePuts(ctx).length, 2, `${leg} two payloads were recorded`)
  assert.ok(phaseOf(ctx).includes('merged'), `${leg} and the run merged; got: ${phaseOf(ctx)}`)
})

test('a second 405 with the window shut is the end of it  [publish-fold M7 / leg (g)]', async () => {
  const ctx = await retry405Twice()
  assert.equal(mergePuts(ctx).length, 2,
    `(g) [M7] exactly two PUTs — with FLEET_FOLD_AGAIN_WAIT at 0 the first base-moved 405 ` +
      `still buys its one fold-again and the second buys none${whyFold(ctx)}`)
  assert.ok(phaseOf(ctx).includes('left open: merge PUT answered 405 after 0s of folding again'),
    `(g) [M7] got: ${phaseOf(ctx)}`)
})

test('a tip unmoved on attempt 2 skips the push and the merge  [publish-fold M7 / leg (g)]', async () => {
  const ctx = await retryTipUnmoved()
  const leg = '(g) [M7]'
  assert.equal(attemptOf(ctx, 2, leg).disposition, 'tip unmoved',
    `${leg} the retry ran and found the tip where it left it`)
  assert.equal(integrationPushes(ctx).length, 1, `${leg} exactly one push${whyFold(ctx)}`)
  assert.equal(mergePuts(ctx).length, 1, `${leg} exactly one PUT`)
  assert.deepEqual(commitStates(ctx).slice(-2), ['publishing', 'done'],
    `${leg} publishing is still written before done: ${JSON.stringify(commitStates(ctx))}`)
  assert.ok(phaseOf(ctx).includes('left open: merge PUT answered 405 and the fold moved nothing'),
    `${leg} got: ${phaseOf(ctx)}`)
})

test('a 405 for any other reason keeps one PUT and starts no second fold  [publish-fold M7 / leg (g)]', async () => {
  const ctx = await merge405Other()
  assert.equal(mergePuts(ctx).length, 1, `(g) [M7] one PUT${whyFold(ctx)}`)
  assert.deepEqual(foldUnits(ctx), [FOLD_UNIT_1],
    `(g) [M7] and the run folded once and only once: ${JSON.stringify(unitsRun(ctx))}`)
  assert.ok(phaseOf(ctx).includes('left open: merge PUT answered 405'),
    `(g) [M7] got: ${phaseOf(ctx)}`)
  assert.ok(!phaseOf(ctx).includes('twice'), `(g) [M7] and not twice: ${phaseOf(ctx)}`)
})

test('a 409 keeps one PUT and starts no second fold  [publish-fold M7 / leg (g)]', async () => {
  const ctx = await merge409()
  assert.equal(mergePuts(ctx).length, 1, `(g) [M7] one PUT${whyFold(ctx)}`)
  assert.deepEqual(foldUnits(ctx), [FOLD_UNIT_1],
    `(g) [M7] and the run folded once and only once: ${JSON.stringify(unitsRun(ctx))}`)
  assert.ok(phaseOf(ctx).includes('left open: merge PUT answered 409'),
    `(g) [M7] got: ${phaseOf(ctx)}`)
})

for (const [code, refused] of [['422', merge422], ['500', merge500]]) {
  test(`a ${code} keeps one PUT, three evidence commits and one note  [publish-fold M7 / leg (g)]`, async () => {
    const ctx = await refused()
    assert.equal(mergePuts(ctx).length, 1, `(g) [M7] one PUT${whyFold(ctx)}`)
    assert.deepEqual(foldUnits(ctx), [FOLD_UNIT_1],
    `(g) [M7] and the run folded once and only once: ${JSON.stringify(unitsRun(ctx))}`)
    assert.deepEqual(commitStates(ctx), ['running', 'publishing', 'done'],
      '(g) [M7] a run with no retry commits the three states it always did')
    assert.ok(phaseOf(ctx).includes(`left open: merge PUT answered ${code}`),
      `(g) [M7] got: ${phaseOf(ctx)}`)
  })
}

test('the mergeable poll runs until GitHub answers something  [publish-fold M7 / leg (g)]', async () => {
  const ctx = await mergeableLate()
  const leg = '(g) [M7]'
  const puts = indicesOf(ctx, isMergePut)
  assert.equal(puts.length, 2, `${leg} the retry ran${whyFold(ctx)}`)
  const gets = indicesOf(ctx, isPullGet).filter((i) => i < puts[1])
  assert.equal(gets.length, 3,
    `${leg} two null answers are waited on and the third is the one it goes on${whyFold(ctx)}`)
})

// ── (h) the body PATCH  [M4] ────────────────────────────────────────────────

test("a disposition that lands after the POST is PATCHed onto the body  [publish-fold M4 / leg (h)]", async () => {
  const ctx = await retrySuiteRed()
  const leg = '(h) [M4]'
  const sent = patches(ctx)
  assert.equal(sent.length, 1, `${leg} exactly one PATCH${whyFold(ctx)}`)
  assert.ok(String(sent[0].body).includes('## Publish fold'),
    `${leg} carrying the re-rendered body:\n${sent[0].body}`)
  assert.ok(String(sent[0].body).includes('suite red'),
    `${leg} which names attempt 2's disposition:\n${sent[0].body}`)
  assert.ok(phaseOf(ctx).includes('suite red'),
    `${leg} and the done page's phase carries it too; got: ${phaseOf(ctx)}`)
})

test('a run refused twice PATCHes its body after the second PUT  [publish-fold M4 / leg (h)]', async () => {
  const ctx = await retry405Twice()
  const leg = '(h) [M4]'
  const sent = patches(ctx)
  assert.equal(sent.length, 1, `${leg} exactly one PATCH${whyFold(ctx)}`)
  assert.ok(String(sent[0].body).includes('## Publish fold'),
    `${leg} the re-rendered body:\n${sent[0].body}`)
  assert.ok(String(sent[0].body).includes('merge PUT answered 405 after 0s of folding again'),
    `${leg} naming what became of the merge — this boot's note, whichever one it earns:\n${sent[0].body}`)
  const puts = indicesOf(ctx, isMergePut)
  const patch = indicesOf(ctx, isPullPatch)
  assert.equal(patch.length, 1, `${leg} one PATCH call in curl's own record`)
  assert.ok(patch[0] > puts[1],
    `${leg} sent after the second PUT, whose answer it discloses${whyFold(ctx)}`)
})

test('a one-attempt run sends no PATCH at all  [publish-fold M4 / leg (h)]', async () => {
  const ctx = await green()
  assert.deepEqual(Object.keys(receiptOf(ctx, '(h) [M4]').attempts || {}), ['1'],
    '(h) [M4] the green run folded once')
  assert.deepEqual(patches(ctx), [],
    `(h) [M4] every disposition of a one-attempt run landed before the POST${whyFold(ctx)}`)
})

// ── (j) the rig itself  [M8] ────────────────────────────────────────────────

test("the fold unit does not take the engine's branch of the stub  [publish-fold M8 / leg (j)]", async () => {
  const ctx = await noGateReceipt()
  const receipt = path.join(ctx.home, 'target', '.claude', 'ultrapowers', 'run-run-7', 'gate-receipt.json')
  assert.deepEqual(foldUnits(ctx), [FOLD_UNIT_1],
    `(j) [M8] the fold unit ran${whyFold(ctx)}`)
  assert.ok(!fs.existsSync(receipt),
    "(j) [M8] and wrote no gate-receipt.json — the fleet-fold-* case comes FIRST in the stub, " +
      'so a fold never answers as the engine')
})

test('the systemctl stub answers a fold unit inactive  [publish-fold M8 / leg (j)]', () => {
  const ctx = makeHome()
  const r = spawnSync(path.join(ctx.bin, 'systemctl'), ['--user', 'is-active', `${FOLD_UNIT_1}.service`], {
    encoding: 'utf8',
    env: stubEnv(ctx),
  })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout.trim(), 'inactive',
    '(j) [M8] a fold unit is inactive unless STUB_FOLD_ACTIVE says otherwise')
})

// ═════════════════════════════════════════════════════════════════════════════
// THE PULL REQUEST QUOTES THE FOLD SUITE'S FAILING BLOCK
//
// A THIRD numbering, belonging to a third task (#763 narrowed to part (2), on
// top of #715's `suite red` section). Its clauses are M1–M5 and its legs (a)–(e)
// of their own, and every assertion below names them with a `failing-block`
// prefix so none of the three numberings in this file reads as another.
//
//   M1  on a `suite red` fold whose `publish-fold/suite-1.txt` is TAP-shaped —
//       `ok 1 - join`, then `not ok 2 - the recorded text names the failing
//       leg`, then more than twenty indented diagnostic lines, then `# fail 1`
//       as the last line — the PR body's fenced block contains the `not ok 2`
//       line.
//   M2  that fenced block's lines are exactly `suite-1.txt`'s lines from the
//       `not ok 2` line through its last line, `# fail 1` included, in order,
//       and the `ok 1 - join` line is not in the body.
//   M3  `publish-fold/suite-1.txt` on the evidence worktree is still the whole
//       text — twenty-eight lines, the first `ok 1 - join`, the last
//       `# fail 1` — not the excerpt.
//   M4  on a `suite red` fold whose `suite-1.txt` has no line matching the
//       start rule — three plain lines — the fenced block is those three lines
//       whole.
//   M5  the boot log of the `suite red` run carries no `node DIRECT` line: the
//       excerpt is produced by the boot script's own shell and awk.
//
// What the excerpt rule is, spelled once, because these legs read it and not an
// implementation of it: START is the first line matching the ERE
// `^(___+ .+ ___+$|FAILED |FAIL[: ]|not ok |AssertionError)`; END is the line
// before the first LATER line matching `^(___+ .+ ___+$|===+ |(not )?ok [0-9])`,
// or the file's last line when no later line matches; a file with NO start line
// is printed whole.
//
// Every leg below reads the fixture's own file off the evidence worktree and
// compares the body against THAT, so what is pinned is the rule and not a
// particular way of writing it. The one thing pinned as a literal is the
// fixture itself, because leg (a) only discriminates while the `not ok` line
// sits further from the end of the file than twenty lines.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * `FOLD_SUITE_TEXT`'s twenty-eight lines, as the task spells them: `ok 1 -
 * join`, the `not ok 2` line, twenty-four two-space-indented `diagnostic line
 * N` lines for N from 1 to 24, `  ...`, and `# fail 1` last.
 */
const TAP_FIXTURE = [
  'ok 1 - join',
  'not ok 2 - the recorded text names the failing leg',
  ...Array.from({ length: 24 }, (_, i) => `  diagnostic line ${i + 1}`),
  '  ...',
  '# fail 1',
]
/** The line M1 and M2 name, verbatim. */
const NOT_OK_LINE = 'not ok 2 - the recorded text names the failing leg'
/** The first line, which M2 says the body does not carry. */
const OK_LINE = 'ok 1 - join'
/** The last line, which M3 says the record still ends on. */
const FAIL_LINE = '# fail 1'
/** What BASE's `tail -n 20` would have shown, as a number of lines. */
const BASE_TAIL = 20

/** A file's lines, one trailing newline dropped — the stub's `printf '%s\n'`
 *  leaves exactly one, and a blank line inside an excerpt is still a line. */
const fileLines = (text) => text.replace(/\n$/, '').split('\n')

/** `<evidence>/.ultrapowers/runs/7/publish-fold/suite-1.txt`, spelled out the
 *  way leg (c) spells it, read off the evidence worktree. */
const suiteRecord = (ctx, leg) => {
  const p = path.join(ctx.home, 'evidence', '.ultrapowers', 'runs', '7', 'publish-fold', 'suite-1.txt')
  assert.ok(fs.existsSync(p), `${leg} the fold's suite file is on the evidence worktree at ${p}${whyFold(ctx)}`)
  return fs.readFileSync(p, 'utf8')
}

/**
 * The fenced block of the `## Publish fold` section: the lines between the
 * first line that is exactly three backticks AFTER `## Publish fold` and the
 * next such line. The anchor matters — the `### Checks` section above carries a
 * ```json fence of its own, whose closing line is also three backticks.
 */
const foldFence = (body, leg) => {
  const ls = body.split('\n')
  const head = ls.findIndex((l) => l.trim() === '## Publish fold')
  assert.ok(head >= 0, `${leg} the body carries a '## Publish fold' section:\n${body}`)
  const open = ls.findIndex((l, i) => i > head && l === '```')
  assert.ok(open > head,
    `${leg} and a fenced block inside it — a line of exactly three backticks after the ` +
      `heading:\n${body}`)
  const close = ls.findIndex((l, i) => i > open && l === '```')
  assert.ok(close > open, `${leg} and that fence is closed by another such line:\n${body}`)
  return ls.slice(open + 1, close)
}

/** M4's fixture: a suite file with no line matching the start rule. */
const PLAIN_SUITE = ['first line', 'second line', 'third line']
const suiteRedPlain = bootWith({
  STUB_FOLD_DISPOSITION: 'suite red',
  STUB_FOLD_SUITE: PLAIN_SUITE.join('\n'),
})

// ── the fixture M1 describes  [failing-block M1] ─────────────────────────────

test("the rig's FOLD_SUITE_TEXT is the TAP shape, its last line FOLD_SUITE_LAST  [failing-block M1 / leg (a)]", () => {
  const leg = '(a) [failing-block M1]'
  assert.deepEqual(fileLines(String(rig('FOLD_SUITE_TEXT'))), TAP_FIXTURE,
    `${leg} FOLD_SUITE_TEXT is M1's TAP-shaped suite: '${OK_LINE}', the '${NOT_OK_LINE}' line, ` +
      `twenty-four indented 'diagnostic line N' lines, '  ...', and '${FAIL_LINE}' last — ` +
      `twenty-eight lines in all, so the '${NOT_OK_LINE}' line sits further than ${BASE_TAIL} ` +
      `lines from the end and a tail of ${BASE_TAIL} cannot reach it`)
  assert.equal(rig('FOLD_SUITE_LAST'), FAIL_LINE,
    `${leg} FOLD_SUITE_LAST is still that text's last line, which the body still has to carry`)
})

// ── (a) the failing leg's name is in the fenced block  [M1] ──────────────────

test("the fenced block of a suite-red body carries the not-ok line  [failing-block M1 / leg (a)]", async () => {
  const ctx = await suiteRed()
  const leg = '(a) [failing-block M1]'
  const recorded = fileLines(suiteRecord(ctx, leg))
  // The discriminator, asserted before the block is read: this fixture's
  // `not ok` line is OUTSIDE the last twenty lines, so a `tail -n 20` of it
  // cannot be what the body shows.
  assert.ok(!recorded.slice(-BASE_TAIL).includes(NOT_OK_LINE),
    `${leg} the fixture puts the '${NOT_OK_LINE}' line outside suite-1.txt's last ${BASE_TAIL} ` +
      `lines; the file's ${recorded.length} lines are:\n${recorded.join('\n')}`)
  const block = foldFence(bodyOf(ctx, leg), leg)
  assert.ok(block.includes(NOT_OK_LINE),
    `${leg} [M1] the fenced block names the failing leg — it holds the line\n  ${NOT_OK_LINE}\n` +
      `even though that line is the second of the file's ${recorded.length}; a tail of ` +
      `${BASE_TAIL} lacks it. The block is:\n${block.join('\n')}`)
})

// ── (b) the block is the failing test's own block, start to end of file  [M2] ─

test("the fenced block is suite-1.txt's lines from not-ok through its last  [failing-block M2 / leg (b)]", async () => {
  const ctx = await suiteRed()
  const leg = '(b) [failing-block M2]'
  const recorded = fileLines(suiteRecord(ctx, leg))
  const start = recorded.indexOf(NOT_OK_LINE)
  assert.ok(start >= 0, `${leg} the recorded suite holds the '${NOT_OK_LINE}' line:\n${recorded.join('\n')}`)
  assert.equal(recorded[recorded.length - 1], FAIL_LINE,
    `${leg} and ends on '${FAIL_LINE}' — with no later boundary line, the block runs to there`)
  const expected = recorded.slice(start)
  const body = bodyOf(ctx, leg)
  const block = foldFence(body, leg)
  assert.deepEqual(block, expected,
    `${leg} [M2] the block's lines are EXACTLY suite-1.txt's lines from its '${NOT_OK_LINE}' ` +
      `line through '${FAIL_LINE}', in order — ${expected.length} lines, no more and no fewer.\n` +
      `--- the block in the body (${block.length} lines) ---\n${block.join('\n')}\n` +
      `--- suite-1.txt from the not-ok line (${expected.length} lines) ---\n${expected.join('\n')}`)
  assert.ok(!body.includes(OK_LINE),
    `${leg} [M2] and the '${OK_LINE}' line above the start is nowhere in the body — the block ` +
      `begins at the marker, it does not begin at the file:\n${body}`)
})

// ── (c) the record on the evidence branch is still whole  [M3] ───────────────

test('the suite file on the evidence worktree is the whole text, not the excerpt  [failing-block M3 / leg (c)]', async () => {
  const ctx = await suiteRed()
  const leg = '(c) [failing-block M3]'
  const recorded = fileLines(suiteRecord(ctx, leg))
  assert.equal(recorded.length, 28,
    `${leg} [M3] <evidence>/.ultrapowers/runs/7/publish-fold/suite-1.txt has twenty-eight ` +
      `lines; it has ${recorded.length}:\n${recorded.join('\n')}`)
  assert.equal(recorded[0], OK_LINE,
    `${leg} [M3] the first of them is '${OK_LINE}' — the record keeps the lines the body's ` +
      `excerpt drops; got: ${JSON.stringify(recorded[0])}`)
  assert.equal(recorded[recorded.length - 1], FAIL_LINE,
    `${leg} [M3] and the last is '${FAIL_LINE}'; got: ${JSON.stringify(recorded[recorded.length - 1])}`)
  assert.deepEqual(recorded, TAP_FIXTURE,
    `${leg} [M3] the record is the whole of what the fold's suite wrote and nothing the ` +
      `excerpting touched:\n${recorded.join('\n')}`)
  const block = foldFence(bodyOf(ctx, leg), leg)
  assert.ok(block.length < recorded.length,
    `${leg} [M3] the body's block is an EXCERPT of that record, not the record — ` +
      `${block.length} lines against ${recorded.length}`)
})

// ── (d) a file with no start line is printed whole  [M4] ─────────────────────

test('a suite with no marker line is quoted whole  [failing-block M4 / leg (d)]', async () => {
  const ctx = await suiteRedPlain()
  const leg = '(d) [failing-block M4]'
  assert.deepEqual(fileLines(suiteRecord(ctx, leg)), PLAIN_SUITE,
    `${leg} the fixture's suite-1.txt is the three plain lines`)
  const block = foldFence(bodyOf(ctx, leg), leg)
  assert.deepEqual(block, PLAIN_SUITE,
    `${leg} [M4] no line of '${PLAIN_SUITE.join("', '")}' matches the start rule, so the ` +
      `fallback prints the file whole — the fenced block is exactly those three lines.\n` +
      `--- the block (${block.length} lines) ---\n${block.join('\n')}`)
})

// ── (e) the excerpt is shell and awk, never node  [M5] ──────────────────────

test("the suite-red boot calls node directly not once  [failing-block M5 / leg (e)]", async () => {
  const ctx = await suiteRed()
  const leg = '(e) [failing-block M5]'
  const log = lines(readLog(ctx, 'fleet-boot.log'))
  const direct = log.filter((l) => l.includes('node DIRECT'))
  assert.deepEqual(direct, [],
    `${leg} [M5] the stub \`node\` logs 'node DIRECT' whenever the boot script runs it as a ` +
      `command of its own, and the excerpt is the script's own shell and awk — on the sandbox ` +
      `\`node\` is argv to systemd-run only. The direct calls logged were:\n${direct.join('\n')}`)
})

// ═════════════════════════════════════════════════════════════════════════════
// THE STRICT-MODE 405 BODIES BUY THE SECOND FOLD
//
// A FOURTH numbering, belonging to a fourth task (#784, on top of #715's merge
// retry). Its clauses are M1–M6 and its legs (a)–(f) of their own, and every
// assertion below names them with a `strict-405` prefix so none of the four
// numberings in this file reads as another.
//
//   M1  for each of `Base branch was modified` and
//       `Required status check "test" is expected.`, a first merge PUT answered
//       405 with that body in its `message` buys the one retry exactly as
//       `Pull Request is not mergeable` does: the evidence commits are
//       `running, publishing, running, publishing, done`, the fold units are
//       `fleet-fold-7-1` then `fleet-fold-7-2`, the branch is pushed once more
//       under `--force-with-lease`, exactly two merge PUTs are made, and the
//       `done` phase says `merged`.
//   M2  for each of those bodies, the retry waits on the head the second fold
//       pushed: attempt 2's `pushedHead` is not the head the first PUT named,
//       and between attempt 2's leased push and the second PUT the run makes at
//       least one `GET /pulls/<n>` mergeability read — the rig's `curl pr read`
//       — and reads no commit's runs at all. (Run-90 retired the poll of the
//       target's commit runs this clause was first written against; the merge
//       gate reads the PR's own tip now, so M2 is asserted as the script
//       behaves today.)
//   M3  the match ignores letter case: `base branch was modified` and
//       `2 of 2 REQUIRED STATUS CHECKS are expected.` each buy the retry —
//       two PUTs, two fold units, a `done` phase saying `merged`.
//   M4  a 405 whose body names none of the three phrases —
//       `At least 1 approving review is required by reviewers with write
//       access.` — is left where #715 leaves it: one PUT, one fold unit, and a
//       `done` phase saying `left open: merge PUT answered 405` and not `twice`.
//   M5  the `Pull Request is not mergeable` body still buys the retry exactly as
//       before: #715's own scenario for it passes with its assertions as they
//       stand.
//   M6  `fleet/CONTRACT.md`'s merge bullet — the text from `- merge:` to
//       `- record:` — names all three bodies as the refusal that earns the
//       second fold.
//
// WHERE EACH LEG LIVES. (a)–(d) and M6 are the tests under this banner. Legs
// (e) and (f) are tests that already stood in this file and still do, so they
// are read here rather than written twice:
//
//   (e) [M4]  `a 405 for any other reason keeps one PUT and starts no second
//             fold`, on the `merge405Other` boot — its assertions are #715's,
//             unchanged; only the boot's body moved, to the one M4 names.
//   (f) [M5]  `a 405 saying "not mergeable" buys one more fold, one leased push
//             and one more PUT`, on `retryMerged` — untouched but for the same
//             run-90 rewrite: it reads the PR's own tip between the leased push
//             and PUT 2, where it once read the target's commit runs.
//
// The bodies below are GitHub's own strict-mode answers, spelled as the task
// spells them. The stub prints the body it is given inside
// `{"sha":"…","merged":true,"message":"<msg>"}`, so what the script matches is
// the phrase inside that JSON text — which is what GitHub gives it too.
//
// Each scenario is ONE `bootWith` boot of the shared rig, started at module load
// beside the others and read by its legs: the retry shape needs only
// `STUB_MERGE_CODE: '405'` and the body, because the second PUT defaults to 200.
// No leg here spawns a sim of its own.
// ═════════════════════════════════════════════════════════════════════════════

/** GitHub's answer when the base moved under a strict-mode branch. */
const BASE_MODIFIED = 'Base branch was modified'
/** GitHub's answer when a required check has not reported on the head. */
const CHECK_EXPECTED = 'Required status check "test" is expected.'
/** The same two, as GitHub also spells them — the case the match must ignore. */
const BASE_MODIFIED_LOWER = 'base branch was modified'
const CHECKS_EXPECTED_UPPER = '2 of 2 REQUIRED STATUS CHECKS are expected.'

/** A first PUT answered 405 with `message`, and a second left to default to 200. */
const refusedWith = (message, env = {}) =>
  bootWith({ STUB_MERGE_CODE: '405', STUB_MERGE_MESSAGE: message, ...env })

// M2 is an inequality — the second merge waits on the head the SECOND fold
// pushed, not the one the first PUT named — so the two boots it reads move the
// tip: `STUB_HEAD_SHA_2` is the rig's knob for a branch whose head differs once
// attempt 2 has run, and both the `rev-parse` and the branches-endpoint stubs
// answer with it, which is what a moved tip is. Without it every read answers
// `HEAD_SHA` and the inequality could not tell a fold that re-read the branch
// from one that reused the first PUT's sha.
const strictBaseModified = refusedWith(BASE_MODIFIED, { STUB_HEAD_SHA_2: HEAD_SHA_2 })
const strictCheckExpected = refusedWith(CHECK_EXPECTED, { STUB_HEAD_SHA_2: HEAD_SHA_2 })
const strictBaseModifiedLower = refusedWith(BASE_MODIFIED_LOWER)
const strictChecksExpectedUpper = refusedWith(CHECKS_EXPECTED_UPPER)

/** The one shape M1 and M3 both read: the retry ran and the PR merged. */
const assertRetriedAndMerged = (ctx, leg, body) => {
  assert.deepEqual(foldUnits(ctx), [FOLD_UNIT_1, FOLD_UNIT_2],
    `${leg} a 405 saying '${body}' buys the second fold, so the run's fold units are ` +
      `${FOLD_UNIT_1} then ${FOLD_UNIT_2}; the units run were ` +
      `${JSON.stringify(unitsRun(ctx))}${whyFold(ctx)}`)
  assert.equal(mergePuts(ctx).length, 2,
    `${leg} and exactly two merge PUTs were recorded — the retry is bought once${whyFold(ctx)}`)
  assert.equal(indicesOf(ctx, isMergePut).length, 2,
    `${leg} two PUT calls in curl's own record${whyFold(ctx)}`)
  assert.ok(phaseOf(ctx).includes('merged'),
    `${leg} and the second PUT merged the PR; the done phase was: ${phaseOf(ctx)}`)
}

// ── (a) and (b) the two strict-mode bodies  [M1] [M2] ────────────────────────

for (const [body, refused, leg] of [
  [BASE_MODIFIED, strictBaseModified, '(a) [strict-405 M1]'],
  [CHECK_EXPECTED, strictCheckExpected, '(b) [strict-405 M1]'],
]) {
  test(`a 405 saying '${body}' buys one more fold, one leased push and one more PUT  [strict-405 M1 / legs (a)(b)]`, async () => {
    const ctx = await refused()
    assert.deepEqual(commitStates(ctx), ['running', 'publishing', 'running', 'publishing', 'done'],
      `${leg} the retry's evidence commits, exactly as the 'not mergeable' body's are: ` +
        `${JSON.stringify(commitStates(ctx))}${whyFold(ctx)}`)
    assertRetriedAndMerged(ctx, leg, body)
    const pushes = integrationPushes(ctx)
    assert.equal(pushes.length, 2,
      `${leg} the branch is pushed once more for the second fold; the pushes were ` +
        `${JSON.stringify(pushes)}${whyFold(ctx)}`)
    assert.ok(leaseOf(pushes[1]),
      `${leg} and that second push carries --force-with-lease: ${pushes[1].join(' ')}`)
  })
}

for (const [body, refused, leg] of [
  [BASE_MODIFIED, strictBaseModified, '(a) [strict-405 M2]'],
  [CHECK_EXPECTED, strictCheckExpected, '(b) [strict-405 M2]'],
]) {
  test(`the retry a '${body}' 405 buys waits on the head the second fold pushed  [strict-405 M2 / legs (a)(b)]`, async () => {
    const ctx = await refused()
    const puts = indicesOf(ctx, isMergePut)
    assert.equal(puts.length, 2, `${leg} the retry ran${whyFold(ctx)}`)
    const second = attemptOf(ctx, 2, leg)
    assert.notEqual(second.pushedHead, mergePuts(ctx)[0].sha,
      `${leg} attempt 2's pushedHead (${second.pushedHead}) is not the head the first PUT ` +
        `named (${mergePuts(ctx)[0].sha}) — the second merge waits on what the second fold pushed`)

    // Run-90 retired the poll of the target's commit runs: the second merge
    // waits on the PR's own tip. Between attempt 2's leased push and PUT 2 the
    // run makes at least one `curl pr read` and no read of a commit's runs.
    const s = stream(ctx)
    const lease = s.findIndex((l) => l.startsWith('CALL git') && l.includes('--force-with-lease'))
    assert.ok(lease >= 0, `${leg} attempt 2's leased push${whyFold(ctx)}`)
    const put2 = s.findIndex((l, i) => i > lease && l === 'CALL curl pr merge')
    assert.ok(put2 > lease, `${leg} PUT 2 follows it${whyFold(ctx)}`)
    const tipReads = s.filter((l, i) => i > lease && i < put2 && l.startsWith('CALL curl pr read')).length
    assert.ok(tipReads >= 1,
      `${leg} with at least one 'curl pr read' between them${whyFold(ctx)}`)
    assert.ok(mergeableReads(ctx) >= 1, `${leg} which is what the run's tip reads are`)
    assert.equal(checkRunRequests(ctx), 0,
      `${leg} and no read of a commit's runs anywhere in the run${whyFold(ctx)}`)
  })
}

// ── (c) and (d) the match ignores letter case  [M3] ──────────────────────────

for (const [body, refused, leg] of [
  [BASE_MODIFIED_LOWER, strictBaseModifiedLower, '(c) [strict-405 M3]'],
  [CHECKS_EXPECTED_UPPER, strictChecksExpectedUpper, '(d) [strict-405 M3]'],
]) {
  test(`a 405 saying '${body}' buys the retry too — the phrases are matched whatever their case  [strict-405 M3 / legs (c)(d)]`, async () => {
    const ctx = await refused()
    assertRetriedAndMerged(ctx, leg, body)
  })
}

// ── (f) M6: the contract names all three bodies ──────────────────────────────

test("CONTRACT.md's merge bullet names all three bodies that earn the second fold  [strict-405 M6]", () => {
  const text = slice(CONTRACT, /^ *- merge:/, /^ *- record:/)
  for (const [phrase, what] of [
    [/not mergeable/i, 'the pull request not being mergeable'],
    [/base branch was modified/i, 'the base branch having been modified'],
    [/required status check/i, 'a required status check being expected'],
  ]) {
    assert.match(text, phrase,
      `[strict-405 M6] the merge bullet — the text from '- merge:' to '- record:' — names ` +
        `${what} as a refusal that earns the second fold, and says it in words matching ` +
        `${phrase}:\n${text}`)
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// A BASE-MOVED 405 FOLDS AGAIN UNTIL THE PUT IS ACCEPTED, BOUNDED BY
// FOLD_AGAIN_WAIT
//
// A FIFTH numbering, belonging to a fifth task (#798, on top of #715's one
// retry and #784's three bodies). Its clauses are M1–M6 and its legs (a)–(j) of
// their own, and every assertion below names them with a `fold-again` prefix so
// none of the five numberings in this file reads as another. Legs (i)(j) of that
// numbering are the suite's own rows, not tests here. [#809, task 3]
//
// What the claim is, in the task's own words: a merge refused with the
// base-moved 405 folds again for as long as each fold is clean and the suite is
// green, bounded by wall clock rather than by a count of two. A fold that is not
// clean, or a suite that goes red on the joined tree, is the hold it is today.
//
//   M1  a gate-green boot whose merge PUT stub answers the base-moved 405
//       (`STUB_MERGE_MESSAGE` `Base branch was modified`) three times and then
//       200 — `STUB_MERGE_CODE` `405 405 405 200` — under the DEFAULT
//       `FLEET_FOLD_AGAIN_WAIT` runs exactly four fold units, `fleet-fold-7-1`
//       … `fleet-fold-7-4`, in that order; issues exactly four merge PUTs, each
//       after the first preceded by at least one `GET /pulls/1` mergeability
//       read — the rig's `curl pr read` — made after that attempt's leased push,
//       and by no read of a commit's runs (run-90 retired that poll);
//       writes evidence commits `running, publishing` four times over and then
//       `done`; appends no `publish:hold` line; and ends `done` with a phase
//       that says `merged`.                                        leg  (a)
//   M2  on that same boot the receipt carries `attempts` rows `1`–`4`, each
//       `folded`; exactly one PR-body PATCH is sent, after the fourth PUT, and
//       its body lists `- attempt 1:` … `- attempt 4:`; and the run's
//       `publish:merge` lines are three refusals with `detail` `merge PUT
//       answered 405` and then the merge sha, carrying neither `left` nor
//       `detail`.                                                  leg  (b)
//   M3  each of the three unclean dispositions as attempt 2's disposition under
//       the same stub — `suite red`, `conflict parked` on `a.txt`, `cannot
//       fold` for `base not an ancestor` — runs exactly two fold units, issues
//       exactly one merge PUT, writes five evidence commits, appends exactly
//       one `publish:hold` whose `why` is exactly that row's hold text, and
//       ends `done` with `left open: ` followed by that same text.
//                                                            legs (c)(d)(e)
//   M4  the boot script defines the knob as the line
//       `FOLD_AGAIN_WAIT="${FLEET_FOLD_AGAIN_WAIT:-3600}"`; the FIRST
//       base-moved 405 always earns a second fold and each later one earns
//       another only while fewer than `FOLD_AGAIN_WAIT` seconds have passed
//       since the first — so with the window at `0` and a stub refusing every
//       PUT the run makes two folds, two PUTs and the
//       `after 0s of folding again` note; and a fold-again that records
//       `tip unmoved` ends after one push and one PUT with the
//       `the fold moved nothing` note.                       legs (f)(g)
//   M5  `405 twice` is in neither `fleet/sandbox-boot.sh` nor
//       `fleet/CONTRACT.md`; the contract's merge bullet names
//       `FOLD_AGAIN_WAIT`, `3600` and both new notes; its status.json bullet
//       describes one `running → publishing` pair per fold and names
//       `FOLD_AGAIN_WAIT`; and `retried exactly once` is nowhere in the
//       contract.                                                  leg  (h)
//   M6  the two other boot sims that drive the merge retry still pass on the
//       changed rig. [#809, task 3] That is the SUITE's sentence, not a leg of
//       this file: each of them is already its own row of
//       `tests/test_fleet_suite.py`, so re-running them from inside here proved
//       nothing the suite does not and cost more wall than every other leg put
//       together. Their rows are the ninth `Run:` of the Proof.
//
// WHAT THIS BANNER ASKS OF THE RIG (`_sandbox_boot_helpers.mjs`, the
// implementer's file), driven by environment knobs only so nothing here links
// against an export that may not exist yet: `STUB_MERGE_CODE` as a list answers
// PUT n with its n-th entry whenever the list has at least n entries, and
// `STUB_MERGE_CODE_2` / `STUB_MERGE_MESSAGE_2` apply to PUT n ≥ 2 only when the
// list has fewer than n entries — so a one-entry list plus `STUB_MERGE_CODE_2`,
// which is every case above this banner, answers exactly what it answers today.
//
// WHY EVERY REFUSING CASE HERE CARRIES `FLEET_FOLD_AGAIN_WAIT: '0'`. Under the
// default 3600 a stub that answers 405 to every PUT would fold again for an
// hour. The `405 405 405 200` stub stops itself on the fourth PUT and therefore
// runs under the default, which is what M1 asks about; a stub that keeps
// refusing runs with the window shut, where the shape is deterministic whatever
// the box's speed: the first 405 always earns its fold, and the second is
// checked against `fewer than 0 seconds`.
// ═════════════════════════════════════════════════════════════════════════════

const FOLD_UNIT_3 = 'fleet-fold-7-3'
const FOLD_UNIT_4 = 'fleet-fold-7-4'

/** The stub of M1: three base-moved 405s, then the 200 that merges. */
const FOUR_PUTS = { STUB_MERGE_CODE: '405 405 405 200', STUB_MERGE_MESSAGE: BASE_MODIFIED }

/** The two notes this task adds, spelled once — the phase carries them after
 *  `left open: `, the `publish:merge` line as its `detail`. */
const WINDOW_CLOSED = 'merge PUT answered 405 after 0s of folding again'
const MOVED_NOTHING = 'merge PUT answered 405 and the fold moved nothing'
/** The note this task retires, which no `done` phase may carry. */
const RETIRED_NOTE = '405 twice'
/** The knob line M4 names, as `grep -F` reads it. */
const KNOB_LINE = 'FOLD_AGAIN_WAIT="${FLEET_FOLD_AGAIN_WAIT:-3600}"'

// ── the run's own event log ─────────────────────────────────────────────────
//
// The boot appends its publish record to the engine's `events.jsonl` in the run
// directory; the readers are this file's own, so no leg here depends on an
// export the rig may not have. `unstamped` drops `id` and `ts`, which are the
// only other keys `append_event` writes.

const runEventsPath = (ctx) => path.join(targetDir(ctx), '.claude', 'ultrapowers', 'run-run-7', 'events.jsonl')
const runEvents = (ctx) => {
  const f = runEventsPath(ctx)
  if (!fs.existsSync(f)) return []
  return fs.readFileSync(f, 'utf8').split('\n').filter((l) => l !== '').map((line, i) => {
    try {
      return JSON.parse(line)
    } catch (error) {
      return assert.fail(`${f} line ${i + 1} is not one JSON object: ${line}\n${error}`)
    }
  })
}
const ofKind = (ctx, kind) => runEvents(ctx).filter((e) => e.kind === kind)
const unstamped = (e) => {
  const rest = { ...e }
  delete rest.id
  delete rest.ts
  return rest
}
/** A refusal line, as M2 and M4 spell one. */
const refusal = (detail) => ({ kind: 'publish:merge', sha: null, left: 'refused', detail })

// ── the boots this banner reads ─────────────────────────────────────────────

/** M1 and M2's boot: the stub stops itself, so it runs under the default window. */
const foldAgainFour = bootWith({ ...FOUR_PUTS })
/** M3's three, each an unclean attempt 2 under that same stub. */
const foldAgainSuiteRed = bootWith({ ...FOUR_PUTS, STUB_FOLD_DISPOSITION_2: 'suite red' })
const foldAgainConflict = bootWith({
  ...FOUR_PUTS, STUB_FOLD_DISPOSITION_2: 'conflict parked', STUB_FOLD_PATH: 'a.txt',
})
const foldAgainCannotFold = bootWith({
  ...FOUR_PUTS, STUB_FOLD_DISPOSITION_2: 'cannot fold', STUB_FOLD_REASON: 'base not an ancestor',
})
/** M4's window, shut: every PUT is refused and the clock allows no second one. */
const foldAgainWindowClosed = bootWith({
  STUB_MERGE_CODE: '405', STUB_MERGE_CODE_2: '405', STUB_MERGE_MESSAGE: BASE_MODIFIED,
  FLEET_FOLD_AGAIN_WAIT: '0',
})
/** M4's other half: the fold-again that moved nothing. */
const foldAgainTipUnmoved = bootWith({
  STUB_MERGE_CODE: '405', STUB_MERGE_MESSAGE: BASE_MODIFIED,
  STUB_FOLD_DISPOSITION_2: 'tip unmoved',
})

// ── (a) four folds, four PUTs, and the merge  [M1] ──────────────────────────

test('three base-moved 405s and then a 200 run four folds and four PUTs  [fold-again M1 / leg (a)]', async () => {
  const ctx = await foldAgainFour()
  const leg = '(a) [fold-again M1]'
  assert.deepEqual(foldUnits(ctx), [FOLD_UNIT_1, FOLD_UNIT_2, FOLD_UNIT_3, FOLD_UNIT_4],
    `${leg} a base-moved 405 folds again for as long as the fold is clean, so a stub that ` +
      `answers 405 three times and then 200 runs FOUR fold units in order — ${FOLD_UNIT_1}, ` +
      `${FOLD_UNIT_2}, ${FOLD_UNIT_3}, ${FOLD_UNIT_4}. The units run were ` +
      `${JSON.stringify(unitsRun(ctx))}${whyFold(ctx)}`)

  const puts = indicesOf(ctx, isMergePut)
  assert.equal(puts.length, 4,
    `${leg} and exactly four merge PUTs in curl's own record${whyFold(ctx)}`)
  assert.equal(mergePuts(ctx).length, 4, `${leg} four payloads were recorded`)

  // Each PUT after the first waits on the head the fold before it pushed. Run-90
  // retired the poll of the target's commit runs, so the wait is on the PR's own
  // tip: between attempt n's leased push and PUT n there is at least one
  // `curl pr read`, and the whole run reads no commit's runs at all.
  const s = stream(ctx)
  const at2 = (pred) => s.map((l, i) => (pred(l) ? i : -1)).filter((i) => i >= 0)
  const merges = at2((l) => l === 'CALL curl pr merge')
  const leases = at2((l) => l.startsWith('CALL git') && l.includes('--force-with-lease'))
  assert.equal(merges.length, 4, `${leg} four PUTs in the boot log too${whyFold(ctx)}`)
  assert.ok(leases.length >= 3,
    `${leg} one leased push per fold-again${whyFold(ctx)}`)
  for (let n = 2; n <= 4; n += 1) {
    const put = merges[n - 1]
    const before = leases.filter((i) => i < put)
    assert.ok(before.length >= 1, `${leg} PUT ${n} follows a leased push${whyFold(ctx)}`)
    const push = before[before.length - 1]
    const reads = s.filter((l, i) => i > push && i < put && l.startsWith('CALL curl pr read')).length
    assert.ok(reads >= 1,
      `${leg} PUT ${n} is preceded by at least one 'curl pr read' made after attempt ` +
        `${n}'s leased push${whyFold(ctx)}`)
  }
  assert.ok(mergeableReads(ctx) >= 3,
    `${leg} the PR's tip is read at least once per fold-again${whyFold(ctx)}`)
  assert.equal(checkRunRequests(ctx), 0,
    `${leg} and no commit's runs are read at all${whyFold(ctx)}`)

  assert.deepEqual(commitStates(ctx), [
    'running', 'publishing', 'running', 'publishing',
    'running', 'publishing', 'running', 'publishing', 'done',
  ], `${leg} one running → publishing pair per fold, then done — four pairs for four ` +
    `folds${whyFold(ctx)}`)
  assert.deepEqual(ofKind(ctx, 'publish:hold').map(unstamped), [],
    `${leg} a run whose folds were all clean holds nothing${whyFold(ctx)}`)
  assert.ok(phaseOf(ctx).includes('merged'),
    `${leg} and the fourth PUT merged the PR; the done phase was: ${phaseOf(ctx)}`)
})

// ── (b) the receipt, the one PATCH and the four merge lines  [M2] ───────────

test('the four-fold run records four attempts, one PATCH and four merge lines  [fold-again M2 / leg (b)]', async () => {
  const ctx = await foldAgainFour()
  const leg = '(b) [fold-again M2]'
  const receipt = receiptOf(ctx, leg)
  assert.deepEqual(Object.keys(receipt.attempts || {}), ['1', '2', '3', '4'],
    `${leg} the receipt carries a row per attempt: ${JSON.stringify(receipt)}`)
  for (const n of [1, 2, 3, 4]) {
    assert.equal(attemptOf(ctx, n, leg).disposition, 'folded',
      `${leg} attempt ${n} folded clean — every fold-again this run made was one`)
  }

  const sent = patches(ctx)
  assert.equal(sent.length, 1,
    `${leg} exactly one PR-body PATCH, however many attempts there were${whyFold(ctx)}`)
  const body = String(sent[0].body)
  for (const row of ['- attempt 1:', '- attempt 2:', '- attempt 3:', '- attempt 4:']) {
    assert.ok(body.includes(row),
      `${leg} whose body lists '${row}' — the reader opening the PR sees every ` +
        `attempt:\n${body}`)
  }
  const puts = indicesOf(ctx, isMergePut)
  const patch = indicesOf(ctx, isPullPatch)
  assert.equal(puts.length, 4, `${leg} the four PUTs${whyFold(ctx)}`)
  assert.equal(patch.length, 1, `${leg} one PATCH call in curl's own record`)
  assert.ok(patch[0] > puts[3],
    `${leg} sent after the FOURTH PUT, whose answer it discloses — the PATCH is at curl ` +
      `call ${patch[0]} and the last PUT at ${puts[3]}${whyFold(ctx)}`)

  assert.deepEqual(ofKind(ctx, 'publish:merge').map(unstamped), [
    refusal('merge PUT answered 405'),
    refusal('merge PUT answered 405'),
    refusal('merge PUT answered 405'),
    { kind: 'publish:merge', sha: mergeSha() },
  ], `${leg} one publish:merge per PUT, in order: three refusals keeping today's detail, ` +
    `then the merge sha carrying NEITHER left NOR detail — the last line is what became of the ` +
    `PR${whyFold(ctx)}`)
})

// ── (c)(d)(e) an unclean fold-again is the hold it is today  [M3] ───────────

for (const [tag, refused, disposition, hold] of [
  ['(c)', foldAgainSuiteRed, 'suite red', 'publish fold — suite red'],
  ['(d)', foldAgainConflict, 'conflict parked', 'publish fold — conflict parked on a.txt'],
  ['(e)', foldAgainCannotFold, 'cannot fold', 'publish fold — cannot fold: base not an ancestor'],
]) {
  test(`an attempt 2 that dispositions '${disposition}' holds the PR and folds no more  [fold-again M3 / leg ${tag}]`, async () => {
    const ctx = await refused()
    const leg = `${tag} [fold-again M3]`
    assert.equal(attemptOf(ctx, 2, leg).disposition, disposition,
      `${leg} the fold-again ran and recorded '${disposition}'`)
    assert.deepEqual(foldUnits(ctx), [FOLD_UNIT_1, FOLD_UNIT_2],
      `${leg} an unclean fold ends the folding, whatever the merge stub would have ` +
        `answered next: exactly two fold units. The units run were ` +
        `${JSON.stringify(unitsRun(ctx))}${whyFold(ctx)}`)
    assert.equal(mergePuts(ctx).length, 1,
      `${leg} and exactly one merge PUT — the held head is never PUT${whyFold(ctx)}`)
    assert.equal(indicesOf(ctx, isMergePut).length, 1,
      `${leg} one PUT call in curl's own record${whyFold(ctx)}`)
    assert.deepEqual(commitStates(ctx), ['running', 'publishing', 'running', 'publishing', 'done'],
      `${leg} two folds are two running → publishing pairs, then done${whyFold(ctx)}`)
    const holdLines = ofKind(ctx, 'publish:hold').map(unstamped)
    assert.equal(holdLines.length, 1,
      `${leg} exactly one publish:hold: ${JSON.stringify(holdLines)}${whyFold(ctx)}`)
    assert.equal(holdLines[0].why, hold,
      `${leg} whose why is exactly '${hold}' — a hold's why is the phase's text after ` +
        `'left open: ', word for word`)
    assert.ok(phaseOf(ctx).includes(`left open: ${hold}`),
      `${leg} and the done page's phase carries 'left open: ${hold}'; got: ${phaseOf(ctx)}`)
    assert.equal(statusOf(ctx).state, 'done', `${leg} the run still ends done`)
  })
}

// ── (f) the window, and the knob that bounds it  [M4] ───────────────────────

test('sandbox-boot.sh defines the fold-again window as one line  [fold-again M4 / leg (f)]', () => {
  assert.ok(linesOf(SCRIPT).some((l) => l.includes(KNOB_LINE)),
    `(f) [fold-again M4] fleet/sandbox-boot.sh must carry the knob line, byte for byte:\n  ` +
      `${KNOB_LINE}\nIt is the shape every other knob in that file is written in ` +
      `(MERGE_CHECK_WAIT="\${FLEET_MERGE_CHECK_WAIT:-1800}"), and it is what this task ` +
      `Produces — a later reader looks for that name and that default.`)
})

test('with the window at 0 a refusing stub folds again once and stops  [fold-again M4 / leg (f)]', async () => {
  const ctx = await foldAgainWindowClosed()
  const leg = '(f) [fold-again M4]'
  assert.deepEqual(foldUnits(ctx), [FOLD_UNIT_1, FOLD_UNIT_2],
    `${leg} the FIRST base-moved 405 always earns its fold-again, and a later one earns ` +
      `another only while fewer than FOLD_AGAIN_WAIT seconds have passed since the first — at ` +
      `0 that is none, so the run folds exactly twice. The units run were ` +
      `${JSON.stringify(unitsRun(ctx))}${whyFold(ctx)}`)
  assert.equal(mergePuts(ctx).length, 2, `${leg} and exactly two PUTs${whyFold(ctx)}`)
  assert.equal(indicesOf(ctx, isMergePut).length, 2,
    `${leg} two PUT calls in curl's own record${whyFold(ctx)}`)
  assert.ok(phaseOf(ctx).includes(`left open: ${WINDOW_CLOSED}`),
    `${leg} the clock's end leaves the PR open with 'left open: ${WINDOW_CLOSED}'; the ` +
      `done phase was: ${phaseOf(ctx)}`)
  const merges = ofKind(ctx, 'publish:merge').map(unstamped)
  assert.ok(merges.length >= 1, `${leg} the run recorded its merge decisions${whyFold(ctx)}`)
  assert.deepEqual(merges[merges.length - 1], refusal(WINDOW_CLOSED),
    `${leg} and the LAST publish:merge line — what became of the PR — is the refusal ` +
      `carrying that same account as its detail. The lines were ` +
      `${JSON.stringify(merges)}${whyFold(ctx)}`)
})

// ═════════════════════════════════════════════════════════════════════════════
// THE FOLD-AGAIN WINDOW, MEASURED — task #808, "The deadman widening and the
// fold-again window are pinned under an injectable clock".
//
// The two cases above are the window's two ENDS: `foldAgainWindowClosed` shuts
// it at `0`, `foldAgainFour` leaves it at the default 3600 and never reaches
// it. Neither measures the boundary, because neither can move the clock. This
// block adds the clock and one case that crosses it.
//
//   M3  the rig's `date` stub answers argv `+%s` with the real epoch plus the
//       integer in `$FLEET_HOME/stub/clock` (0 when absent) and hands any other
//       argv to the real `date` unchanged; the `systemd-run` stub's
//       `fleet-fold-*` arm adds `STUB_CLOCK_STEP` seconds (default 0) to that
//       file once per fold unit.                                  legs (c)(d)
//   M4  a boot with `STUB_MERGE_CODE='405 405 405 405 200'`,
//       `STUB_MERGE_MESSAGE='Base branch was modified'`,
//       `FLEET_FOLD_AGAIN_WAIT=1000` and `STUB_CLOCK_STEP=600` runs exactly the
//       three fold units `fleet-fold-7-1`, `-2`, `-3`, issues exactly three
//       merge PUTs, and its `done` page's phase carries `left open: merge PUT
//       answered 405 after 1000s of folding again`.                legs (e)(f)
//
// THE ARITHMETIC, and why it is a BOUNDARY and not an end. Fold unit 1 ticks
// the clock to 600 before the first PUT, so `FOLD_AGAIN_SINCE = r0 + 600`;
// fold 2 ticks it to 1200 and PUT 2 measures `600 + Δ` seconds (Δ the real
// seconds between the PUTs) — under 1000, so the run folds again; fold 3 ticks
// it to 1800 and PUT 3 measures `1200 + Δ` ≥ 1000, so `merge_pr` writes the
// note and returns without raising `FOLD_AGAIN`. Three units, three PUTs. The
// leg therefore establishes the window lies in `(600 + Δ, 1200 + Δ]`: a defect
// that mis-measures elapsed seconds either trips at PUT 2 (two units) or never
// trips (the stub's fifth code, 200, merges after five units), and both are red
// against "exactly three".
// ═════════════════════════════════════════════════════════════════════════════

/** What one fold unit adds to the clock, and the window it has to cross. */
const CLOCK_STEP = 600
const CLOCK_WAIT = 1000
/** M4's note, spelled from those two so the exam cannot drift from its own case. */
const WINDOW_CROSSED = `merge PUT answered 405 after ${CLOCK_WAIT}s of folding again`
/** M4's stub: four base-moved 405s and a 200 that no run here should reach. */
const FIVE_PUTS = { STUB_MERGE_CODE: '405 405 405 405 200', STUB_MERGE_MESSAGE: BASE_MODIFIED }
/** M4's boot. */
const foldAgainClocked = bootWith({
  ...FIVE_PUTS,
  FLEET_FOLD_AGAIN_WAIT: String(CLOCK_WAIT),
  STUB_CLOCK_STEP: String(CLOCK_STEP),
})

/** Where the rig keeps the offset every `date +%s` under a home is shifted by. */
const clockFile = (ctx) => path.join(ctx.home, 'stub', 'clock')
/** The `date` stub itself, or a failure that says the rig has none. */
const dateStub = (ctx, leg) => {
  const f = path.join(ctx.bin, 'date')
  assert.ok(fs.existsSync(f),
    `${leg} fleet/tests/_sandbox_boot_helpers.mjs must write a 'date' stub into the stub bin ` +
      `dir alongside every other stub: FLEET_BIN_DIR is prefixed to PATH by the boot script, so ` +
      `a file named 'date' there is what every date call in the run resolves to, and it is the ` +
      `only way this exam can move the clock the boot measures its window with. Expected ${f}`)
  return f
}
/** `date <argv>` as the run's own calls resolve it, under that home. */
const dateUnder = (ctx, argv, leg) => {
  const r = spawnSync(dateStub(ctx, leg), argv, {
    encoding: 'utf8',
    env: stubEnv(ctx),
  })
  assert.equal(r.status, 0,
    `${leg} \`date ${argv.join(' ')}\` exits 0; it exited ${r.status} and printed: ` +
      `${r.stdout}${r.stderr}`)
  return r.stdout.trim()
}
/** The seconds since the epoch, now. */
const nowSeconds = () => Date.now() / 1000
const near = (got, want) => Math.abs(got - want) <= 5

// ── (c) the date stub  [#808 M3] ────────────────────────────────────────────

test('the rig\'s date stub shifts +%s by the clock file and hands every other argv to the real date  [#808 M3 / leg (c)]', () => {
  const ctx = makeHome()
  const leg = '(c) [#808 M3]'

  assert.ok(!fs.existsSync(clockFile(ctx)),
    `${leg} a fresh home carries no clock file, so the stub's offset there is 0`)
  const plain = Number(dateUnder(ctx, ['+%s'], leg))
  assert.ok(Number.isFinite(plain),
    `${leg} \`date +%s\` prints an integer; it printed '${plain}'`)
  assert.ok(near(plain, nowSeconds()),
    `${leg} and with no clock file it is the REAL epoch, within 5 s of Date.now()/1000 — the ` +
      `stub is transparent until a case moves it. It answered ${plain}, and now is ` +
      `${Math.round(nowSeconds())}`)

  fs.writeFileSync(clockFile(ctx), `${CLOCK_STEP}\n`)
  const shifted = Number(dateUnder(ctx, ['+%s'], leg))
  assert.ok(near(shifted, nowSeconds() + CLOCK_STEP),
    `${leg} with $FLEET_HOME/stub/clock written as ${CLOCK_STEP} it is the real epoch PLUS that ` +
      `integer, within 5 s — that sum is the whole injectable clock. It answered ${shifted}, ` +
      `and now + ${CLOCK_STEP} is ${Math.round(nowSeconds() + CLOCK_STEP)}`)

  const iso = dateUnder(ctx, ['-u', '+%Y-%m-%dT%H:%M:%SZ'], leg)
  assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
    `${leg} and EVERY other argv is handed to the real date unchanged, clock file or no — the ` +
      `boot's now_iso, its log stamps and the stubs' own \`say\` prelude all go through this ` +
      `file, and a stub that answered them itself would rewrite every timestamp in the run. ` +
      `\`date -u +%Y-%m-%dT%H:%M:%SZ\` answered '${iso}'`)
})

// ── (d) the tick, once per fold unit  [#808 M3] ─────────────────────────────

test('the fold unit ticks the clock by STUB_CLOCK_STEP, and an unset step never moves it  [#808 M3 / leg (d)]', async () => {
  const ctx = await foldAgainClocked()
  const leg = '(d) [#808 M3]'
  const f = clockFile(ctx)
  assert.ok(fs.existsSync(f),
    `${leg} the systemd-run stub's fleet-fold-* arm adds STUB_CLOCK_STEP seconds to ` +
      `$FLEET_HOME/stub/clock once per fold unit, so a run of three fold units under a step of ` +
      `${CLOCK_STEP} leaves that file behind. Expected ${f}${whyFold(ctx)}`)
  assert.equal(fs.readFileSync(f, 'utf8').trim(), String(3 * CLOCK_STEP),
    `${leg} and leaves it reading ${3 * CLOCK_STEP} — three fold units at ${CLOCK_STEP} each, ` +
      `ONCE per unit. The fold units run were ${JSON.stringify(foldUnits(ctx))}${whyFold(ctx)}`)

  const unclocked = await foldAgainFour()
  const answered = Number(dateUnder(unclocked, ['+%s'], leg))
  assert.ok(near(answered, nowSeconds()),
    `${leg} with STUB_CLOCK_STEP unset the default step is 0, so four fold units move the clock ` +
      `nowhere and \`date +%s\` under that home is the real epoch, within 5 s of ` +
      `Date.now()/1000 — every case above this banner runs on a clock it never asked to move. ` +
      `It answered ${answered}, and now is ${Math.round(nowSeconds())}`)
})

// ── (e) three folds, three PUTs — the boundary crossed  [#808 M4] ───────────

test(`a window of ${CLOCK_WAIT}s outlasted across two folds runs exactly three folds  [#808 M4 / leg (e)]`, async () => {
  const ctx = await foldAgainClocked()
  const leg = '(e) [#808 M4]'
  assert.deepEqual(foldUnits(ctx), [FOLD_UNIT_1, FOLD_UNIT_2, FOLD_UNIT_3],
    `${leg} fold 1 ticks the clock to ${CLOCK_STEP} and PUT 1 opens the window there; PUT 2 ` +
      `measures ${CLOCK_STEP} + Δ, under ${CLOCK_WAIT}, so the run folds again; PUT 3 measures ` +
      `${2 * CLOCK_STEP} + Δ, at or past ${CLOCK_WAIT}, so it stops. EXACTLY three fold units — ` +
      `${FOLD_UNIT_1}, ${FOLD_UNIT_2}, ${FOLD_UNIT_3} — and no ${FOLD_UNIT_4}. A run that trips ` +
      `at PUT 2 makes two and one that never trips makes five (the stub's fifth code merges). ` +
      `The units run were ${JSON.stringify(unitsRun(ctx))}${whyFold(ctx)}`)
  assert.equal(mergePuts(ctx).length, 3,
    `${leg} and exactly three merge PUT payloads${whyFold(ctx)}`)
  assert.equal(indicesOf(ctx, isMergePut).length, 3,
    `${leg} three PUT calls in curl's own record${whyFold(ctx)}`)
})

// ── (f) the note the crossing writes  [#808 M4] ─────────────────────────────

test(`the crossed window leaves '${WINDOW_CROSSED}' on the page and in the record  [#808 M4 / leg (f)]`, async () => {
  const ctx = await foldAgainClocked()
  const leg = '(f) [#808 M4]'
  assert.equal(statusOf(ctx).state, 'done', `${leg} the run ends done${whyFold(ctx)}`)
  assert.ok(phaseOf(ctx).includes(`left open: ${WINDOW_CROSSED}`),
    `${leg} the done page's phase carries 'left open: ${WINDOW_CROSSED}' — the note names the ` +
      `WINDOW, ${CLOCK_WAIT}s, not the seconds any one PUT measured. The done phase was: ` +
      `${phaseOf(ctx)}`)
  const merges = ofKind(ctx, 'publish:merge').map(unstamped)
  assert.ok(merges.length >= 1, `${leg} the run recorded its merge decisions${whyFold(ctx)}`)
  assert.equal(merges[merges.length - 1].detail, WINDOW_CROSSED,
    `${leg} and the LAST publish:merge line — what became of the PR — carries exactly that ` +
      `account as its detail. The lines were ${JSON.stringify(merges)}${whyFold(ctx)}`)
  assert.deepEqual(merges[merges.length - 1], refusal(WINDOW_CROSSED),
    `${leg} as a refusal, sha null and left 'refused'. The lines were ` +
      `${JSON.stringify(merges)}${whyFold(ctx)}`)
})

// ── (g) a fold-again that moved nothing  [M4] ───────────────────────────────

test('a fold-again that records tip unmoved skips the push and the PUT  [fold-again M4 / leg (g)]', async () => {
  const ctx = await foldAgainTipUnmoved()
  const leg = '(g) [fold-again M4]'
  assert.equal(attemptOf(ctx, 2, leg).disposition, 'tip unmoved',
    `${leg} the fold-again ran and found the tip where it left it`)
  assert.equal(integrationPushes(ctx).length, 1,
    `${leg} exactly one integration push — there is no new head to push${whyFold(ctx)}`)
  assert.equal(mergePuts(ctx).length, 1,
    `${leg} and exactly one PUT — nothing new to merge${whyFold(ctx)}`)
  assert.ok(phaseOf(ctx).includes(`left open: ${MOVED_NOTHING}`),
    `${leg} the run ends done with 'left open: ${MOVED_NOTHING}'; the done phase was: ` +
      `${phaseOf(ctx)}`)
  const merges = ofKind(ctx, 'publish:merge').map(unstamped)
  assert.ok(merges.length >= 1, `${leg} the run recorded its merge decisions${whyFold(ctx)}`)
  assert.equal(merges[merges.length - 1].detail, MOVED_NOTHING,
    `${leg} and the last publish:merge line's detail is that same account. The lines were ` +
      `${JSON.stringify(merges)}${whyFold(ctx)}`)
})

test(`no done phase of any boot in this file says '${RETIRED_NOTE}'  [fold-again M4 / leg (g)]`, async () => {
  const phases = []
  for (const read of [...ALL_BOOTS, green]) {
    let ctx
    try {
      ctx = await read()
    } catch {
      // A boot whose own leg fails is that leg's to report, not this one's.
      continue
    }
    let status
    try {
      status = statusOf(ctx)
    } catch {
      continue
    }
    if (status.state !== 'done') continue
    phases.push(String(status.phase))
  }
  assert.ok(phases.length > 0,
    `(g) [fold-again M4] this file boots the script many times; at least one of them ends done`)
  assert.deepEqual(phases.filter((p) => p.includes(RETIRED_NOTE)), [],
    `(g) [fold-again M4] the count of two is gone and so is its note: no run in this file ends ` +
      `done with a phase carrying '${RETIRED_NOTE}'. The ${phases.length} done phases were:\n` +
      `${phases.join('\n')}`)
})

// ── (h) the contract and the script say so  [M5] ────────────────────────────

test(`'${RETIRED_NOTE}' is in neither the boot script nor the contract  [fold-again M5 / leg (h)]`, () => {
  for (const file of [SCRIPT, CONTRACT]) {
    const hits = linesOf(file)
      .map((l, i) => [i + 1, l])
      .filter(([, l]) => l.includes(RETIRED_NOTE))
    assert.deepEqual(hits, [],
      `(h) [fold-again M5] ${path.basename(file)} must not carry '${RETIRED_NOTE}' anywhere — ` +
        `the bound is a wall clock now, not a count of two. The lines carrying it are:\n` +
        `${hits.map(([n, l]) => `${n}: ${l}`).join('\n')}`)
  }
})

test("CONTRACT.md's merge bullet names FOLD_AGAIN_WAIT, its default and both notes  [fold-again M5 / leg (h)]", () => {
  const text = slice(CONTRACT, /^ *- merge:/, /^ *- record:/)
  assert.match(text, /FOLD_AGAIN_WAIT.*3600/,
    `(h) [fold-again M5] the merge bullet — the lines from '- merge:' to '- record:' — must ` +
      `name FOLD_AGAIN_WAIT and then its default 3600:\n${text}`)
  for (const phrase of ['of folding again', 'the fold moved nothing']) {
    assert.ok(text.includes(phrase),
      `(h) [fold-again M5] and must name the new note '${phrase}':\n${text}`)
  }
})

test("CONTRACT.md's status.json bullet is one running → publishing pair per fold  [fold-again M5 / leg (h)]", () => {
  const text = slice(CONTRACT, /^- \*\*status\.json:\*\*/, /^- \*\*Publish:\*\*/)
  assert.ok(text.includes('FOLD_AGAIN_WAIT'),
    `(h) [fold-again M5] the status.json bullet — the lines from '- **status.json:**' to ` +
      `'- **Publish:**' — must name FOLD_AGAIN_WAIT, because the state sequence it describes is ` +
      `bounded by it:\n${text}`)
  assert.ok(!text.includes('no third'),
    `(h) [fold-again M5] and must not still promise there is 'no third' publishing — a run that ` +
      `folds again three times writes four:\n${text}`)
})

test("'retried exactly once' is nowhere in CONTRACT.md  [fold-again M5 / leg (h)]", () => {
  const hits = linesOf(CONTRACT)
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => l.includes('retried exactly once'))
  assert.deepEqual(hits, [],
    `(h) [fold-again M5] the contract must not say the merge is 'retried exactly once' — it is ` +
      `retried for as long as each fold is clean and the window is open. The lines saying it ` +
      `are:\n${hits.map(([n, l]) => `${n}: ${l}`).join('\n')}`)
})

// ═════════════════════════════════════════════════════════════════════════════
// THE HELD PR IS PATCHED ONCE, AFTER IT IS OPENED
//
// A red the gate can charge to no task holds the merge — `merge_pr` writes
// `left open: suite red, unattributed: <path>` and returns before any read —
// and `do_boot` re-patches the PR body whenever the merge note begins that way.
// Once, however the run got there: the PATCH is the last word on a body the
// POST already wrote, not a second body.
//
// The negative half of this sentence is the fold-again leg above it (`a
// one-attempt run sends no PATCH at all`), and it is read here again from the
// other side: a gate-green run that merges on its first PUT sends none.
//
// Order is read from the boot log, which is the only place it is readable: the
// PATCH is `curl pr patch`, the POST that opened the PR is `curl pr create`,
// and the unattributed red is the line the gate wrote on its way to the hold.
// ═════════════════════════════════════════════════════════════════════════════

/** The path the gate receipt says went red with no task to charge it to. */
const HELD_PATH = 'tests/other.py'

const heldRed = scenario({
  STUB_GATE_RECEIPT: JSON.stringify({ verdict: 'PASS', suite: { unattributed: [HELD_PATH] } }),
  STUB_REPORT: JSON.stringify({
    stamp: 'run-7',
    tests: { command: 'python3 -m pytest', passed: false, output: `FAILED ${HELD_PATH}` },
  }),
})

test('an unattributed red holds the PR and patches its body once, after it is opened  [held-patch]', async () => {
  const ctx = await heldRed()
  const leg = '[held-patch]'
  const s = stream(ctx)

  const charged = s.findIndex((l) =>
    l.includes(`went red on ${HELD_PATH} with no task to charge it to`))
  assert.ok(charged >= 0,
    `${leg} the gate's suite went red on a path it could charge to no task${whyFold(ctx)}`)
  assert.ok(phaseOf(ctx).includes(`left open: suite red, unattributed: ${HELD_PATH}`),
    `${leg} so the PR is held open; the done phase was: ${phaseOf(ctx)}`)

  const created = s.findIndex((l) => l === 'CALL curl pr create')
  assert.ok(created >= 0, `${leg} the PR was opened${whyFold(ctx)}`)
  const patched = s.map((l, i) => (l === 'CALL curl pr patch' ? i : -1)).filter((i) => i >= 0)
  assert.equal(patched.length, 1,
    `${leg} exactly one 'curl pr patch' in the stream${whyFold(ctx)}`)
  assert.equal(patches(ctx).length, 1,
    `${leg} and patch.log recorded that one payload: ${JSON.stringify(patches(ctx))}`)
  assert.ok(patched[0] > created,
    `${leg} the PATCH lands after the POST that opened the PR${whyFold(ctx)}`)
  assert.ok(patched[0] > charged,
    `${leg} and after the line saying the red was charged to no task${whyFold(ctx)}`)

  const clean = await green()
  assert.equal(mergePuts(clean).length, 1,
    `${leg} the gate-green path merges on its first PUT${why(clean)}`)
  assert.equal(stream(clean).filter((l) => l === 'CALL curl pr patch').length, 0,
    `${leg} and a run that merges on its first PUT sends no PATCH at all${why(clean)}`)
})

runTests(tests)

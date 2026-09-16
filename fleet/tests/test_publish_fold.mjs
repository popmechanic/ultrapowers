/**
 * fleet/tests/test_publish_fold.mjs — the exam for Task B: *the publish fold
 * writes its receipts and reads them back*.
 *
 * This file is the Proof's `Test: fleet/tests/test_publish_fold.mjs` and its
 * `Guard:`, written whole at that guarded path. Every relative path below is
 * written for THIS directory: `../` is the repository's `fleet/`, `./` is
 * `fleet/tests/`. Nothing here imports anything under `fleet/tests/exams/` —
 * an exam that reaches main as a pointer into a run's reserved directory is
 * the shape publish strips (#1053), and leg (e) is that fact as an assertion.
 *
 * The Claim under test: when the run's last fold onto main meets a conflict,
 * its resolver's reply and the fold's own event land on the run's record with
 * the files named, and a resolver briefed again on a file that already
 * conflicted is shown that receipt first.
 *
 * The Machine clauses, restated:
 *
 *   M1 — `publishFold`'s `resolveConflicts` call passes `onEvent:
 *        eventLog.onEvent`, so each publish-fold resolver dispatch appends one
 *        `resolver:reply` event to `<runDir>/events.jsonl`, a `BLOCKED`
 *        reply's row carrying `paths` `[<the conflicted path>]` and `evidence`
 *        whose `read` begins `BLOCKED`.
 *   M2 — Both sites that append a `driver:publish-fold` event build it with
 *        `publishFoldEvent(row, conflictsIndex())`, so the row of an attempt
 *        with an open conflict carries `paths` naming that conflict's path and
 *        `evidence.read` beginning with its disposition, and the row of an
 *        attempt that folded with no conflict carries neither key.
 *   M3 — `writeResolverBriefs` takes a `receipts` argument, `[]` when absent,
 *        and appends `factsBlock(receipts, [<that conflict's path>])` to the
 *        string it returns for each conflict; `publishFold` hands it
 *        `receiptRows(<runDir>/events.jsonl)` — the rows on the log when the
 *        attempt starts — and a prior attempt that ended `conflict parked` no
 *        longer ends a later attempt on the same tip as `tip unmoved`, so a
 *        second attempt's resolver on a path the first attempt parked on reads
 *        a `FACTS:` block naming the first attempt's `resolver:reply` row and
 *        its `driver:publish-fold` row, and `publishFold` appends one
 *        `driver:facts` event `{label: 'resolve:publish-fold:<attempt>:<i>',
 *        receipts: [<ids>]}` per non-empty brief.
 *   M4 — An attempt whose log holds no receipt on its conflicted path
 *        dispatches a resolver whose brief carries no `FACTS:` and appends no
 *        `driver:facts`.
 *
 * The Proof legs, and where each is answered below. Every assertion names its
 * leg and the clause it comes from, so a reader can map this file back to the
 * contract:
 *
 *   (a) [M1] the conflict rig with a canned `BLOCKED` resolver: after
 *            `publishFold` returns, `<runDir>/events.jsonl` holds exactly one
 *            `resolver:reply` row, `label` `resolve:publish-fold:1:1:1`,
 *            `status` `BLOCKED`, `paths` `['a.txt']`, `evidence.read`
 *            beginning `BLOCKED`; and the second `Run:` — the fold's
 *            `resolveConflicts({ … })` call, read from its opening line to its
 *            closing `})`, carries `onEvent: eventLog.onEvent`, which at BASE
 *            it does not.
 *   (b) [M2] the same run's `driver:publish-fold` row carries `disposition`
 *            `conflict parked`, `paths` `['a.txt']` and `evidence.read`
 *            beginning `conflict parked`; the rig re-driven at attempt 1 (the
 *            replayed site) appends a second `driver:publish-fold` row with the
 *            same `paths` and `pathsConflicted` `1`, where the BASE literal
 *            would have written `0` and no `paths`; and a rig whose `main` and
 *            integration branch edit different files folds with a
 *            `driver:publish-fold` row carrying `disposition` `folded` and no
 *            `paths` and no `evidence` key.
 *   (c) [M3] leg (a)'s parked rig driven again as attempt 2 with a canned
 *            `RESOLVED` resolver, the origin's `main` unmoved: attempt 2
 *            dispatches `resolve:publish-fold:2:1:1` rather than ending `tip
 *            unmoved`, its recorded brief
 *            (`<evidenceDir>/publish-fold/resolver-brief-1-2.txt`) ends with a
 *            `FACTS:` block carrying exactly two `- receipt` lines, in
 *            ascending id — attempt 1's `resolver:reply` row and attempt 1's
 *            `driver:publish-fold` row, both on `a.txt` — and the log holds
 *            exactly one `driver:facts` row, `label` `resolve:publish-fold:2:1`,
 *            `receipts` those two ids in the same order; attempt 2 then ends
 *            `folded`; and a fresh rig whose attempt 1 ended `folded` and is
 *            driven again as attempt 2 on the unmoved tip still ends `tip
 *            unmoved` with no resolver dispatched.
 *   (d) [M4] attempt 1 of leg (a) — no receipt on the log when it starts: its
 *            recorded brief (`resolver-brief-1-1.txt`) carries no `FACTS:` and
 *            ends with the `MAIN PATCH FILE:` line's text, and after attempt 1
 *            no `driver:facts` row is on the log.
 *   (e) [M3] the third `Run:` — this file carries no `import` line naming a
 *            path under `exams/`.
 *
 * THE RIG is real below the agent seam, exactly as the engine's sims are: a
 * bare origin, a full clone of it as `repo`, the run's integration branch in
 * that clone, a real `fleet/clones/integration` checkout, the real
 * `fold_wave.py` kernel and the real `execSeam`. Only `makeAgent` is stubbed —
 * the one seam `publishFold` documents for exactly this — and it returns a
 * canned reply in `RESOLVER_SCHEMA`'s own shape. No sibling sim is spawned, no
 * network is reached, every child gets `simEnv()`'s environment, and every
 * path written lives under one `mkdtemp` directory removed on exit. The whole
 * file drives four kernel folds of a one-file conflict, which is seconds, not
 * the bridge's 300 s cap.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { execSeam } from '../run-main.mjs'
// Read through the namespace rather than by name: a named import of an export
// that is not there yet is an ESM link error that would kill this file before
// any leg could report. The namespace form lets a leg fail as "the export is
// not there yet" instead.
import * as fold from '../publish-fold.mjs'
// The two Consumes this task reads back with: the matcher the brief renders
// with, and the parser over the run's own log. Both are at BASE (the Proof's
// `Stale-if: path-absent: fleet/facts-block.mjs`).
import { factsBlock, receiptRows } from '../facts-block.mjs'
import { simEnv } from './_helpers.mjs'

const SELF = fileURLToPath(import.meta.url)
const HERE = path.dirname(SELF)
const FLEET = path.join(HERE, '..')

// ── the literals the legs are written against, spelled once ─────────────────
const RUN = 160
const BRANCH = 'ultra/integration-run-' + RUN
const CONFLICTED = 'a.txt'
const SEED = 'l1\nl2\nl3\n'
// The tail `writeResolverBriefs` ends its string with at BASE — leg (d)'s
// "ends with the `MAIN PATCH FILE:` line's text".
const MAIN_PATCH_SUFFIX = " (everything main gained since this run's base)"
const DISPATCH_1 = 'resolve:publish-fold:1:1:1'
const DISPATCH_2 = 'resolve:publish-fold:2:1:1'
const FACTS_LABEL_2 = 'resolve:publish-fold:2:1'

// The two canned replies, in `RESOLVER_SCHEMA`'s own shape. `h1` is the one
// hunk the kernel narrates for this rig's single-line conflict, and the
// resolution keeps both sides, main's first.
const BLOCKED_REPLY = { status: 'BLOCKED', hunks: [], notes: 'cannot' }
const RESOLVED_REPLY = {
  status: 'RESOLVED', hunks: [{ id: 'h1', content: 'MAIN\nRUN\n' }], notes: 'kept both',
}

// ── the sim's environment ───────────────────────────────────────────────────
// One for the file: git sees a HOME of its own, so no `~/.gitconfig` of the box
// reaches a repository this sim builds, and the identity rides the environment
// rather than a `git config` of the parent's.
const ENV = simEnv({
  env: {
    GIT_AUTHOR_NAME: 'sim', GIT_AUTHOR_EMAIL: 'sim@test',
    GIT_COMMITTER_NAME: 'sim', GIT_COMMITTER_EMAIL: 'sim@test',
  },
})
const git = (argv, cwd) =>
  execFileSync('git', argv, { cwd, env: ENV, encoding: 'utf8' }).trim()
// The exec seam `publishFold` runs every subprocess through — the real one,
// handed this sim's environment so the kernel and git stay hermetic.
const exec = (cmd, argv, opts = {}) => execSeam(cmd, argv, { ...opts, env: ENV })

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'publish-fold-')))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

/**
 * One rig, as the task's Context names it.
 *
 *   a bare origin whose `main` holds BASE plus one commit rewriting line 2 of
 *   a seeded `a.txt`; a full clone of it as `repo` with
 *   `refs/remotes/origin/HEAD` pointing at `main`; the run's integration
 *   `branch` in that clone at BASE plus one commit rewriting the same line
 *   differently; `<runDir>/launch.json` with `tasks: []` and
 *   `<runDir>/args.json` with no `testCmd`; `<evidenceDir>` empty.
 *
 * With `mainFile` left at `a.txt` the two sides meet on one line of one file —
 * one narrated conflict, one resolver. With `mainFile: 'b.txt'` the two sides
 * edit different files and the fold joins nothing, which is leg (b)'s third
 * clause.
 */
function rig (tag, { mainFile = CONFLICTED, mainText = 'MAIN', runText = 'RUN' } = {}) {
  const root = path.join(tmp, tag)
  const seed = path.join(root, 'seed')
  fs.mkdirSync(seed, { recursive: true })

  git(['init', '-q', '-b', 'main', '.'], seed)
  fs.writeFileSync(path.join(seed, 'a.txt'), SEED)
  fs.writeFileSync(path.join(seed, 'b.txt'), SEED)
  git(['add', '-A'], seed)
  git(['commit', '-qm', 'base'], seed)
  const base = git(['rev-parse', 'HEAD'], seed)

  const origin = path.join(root, 'origin.git')
  git(['init', '-q', '--bare', '-b', 'main', origin], root)
  git(['remote', 'add', 'origin', origin], seed)
  git(['push', '-q', 'origin', 'main'], seed)

  // Cloned while the origin still holds BASE alone, so the clone's
  // `refs/remotes/origin/HEAD` is `main` and the fold's own fetch is what
  // moves the tip under it.
  const repo = path.join(root, 'repo')
  git(['clone', '-q', origin, repo], root)

  const mainLines = SEED.split('\n')
  mainLines[1] = mainText
  fs.writeFileSync(path.join(seed, mainFile), mainLines.join('\n'))
  git(['add', '-A'], seed)
  git(['commit', '-qm', 'main moved'], seed)
  git(['push', '-q', 'origin', 'main'], seed)

  const runLines = SEED.split('\n')
  runLines[1] = runText
  git(['checkout', '-q', '-b', BRANCH, base], repo)
  fs.writeFileSync(path.join(repo, CONFLICTED), runLines.join('\n'))
  git(['add', '-A'], repo)
  git(['commit', '-qm', "the run's result"], repo)
  // The branch is a ref the fold moves; the clone's own worktree stays on main
  // so `update-ref` never fights a checkout.
  git(['checkout', '-q', 'main'], repo)

  const runDir = path.join(root, 'run')
  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(path.join(runDir, 'launch.json'), JSON.stringify({ tasks: [] }))
  fs.writeFileSync(path.join(runDir, 'args.json'), JSON.stringify({}))

  const integ = path.join(runDir, 'clones', 'integration')
  fs.mkdirSync(path.dirname(integ), { recursive: true })
  git(['clone', '-q', '--local', '--no-hardlinks', repo, integ], root)
  git(['checkout', '-q', '--detach', base], integ)

  const evidenceDir = path.join(root, 'evidence')
  fs.mkdirSync(evidenceDir, { recursive: true })

  return { root, repo, base, runDir, evidenceDir, eventsPath: path.join(runDir, 'events.jsonl') }
}

/**
 * One attempt of the fold over a rig, with the resolver canned.
 *
 * `makeAgent` is the seam `publishFold` documents for exactly this; the stub
 * records the label of every dispatch and answers `reply`. Returns
 * `{ receipt, row, labels }`.
 */
async function drive (r, attempt, reply) {
  const labels = []
  const receipt = await fold.publishFold(
    {
      repo: r.repo,
      base: r.base,
      branch: BRANCH,
      run: RUN,
      runDir: r.runDir,
      evidenceDir: r.evidenceDir,
      attempt,
    },
    {
      makeAgent: () => async (prompt, opts) => {
        labels.push(String((opts && opts.label) || ''))
        return reply
      },
      exec,
    })
  const row = (receipt && receipt.attempts && receipt.attempts[String(attempt)]) || {}
  return { receipt, row, labels }
}

/** The run's own log, row by row, in append order. */
const eventsOf = (r) => receiptRows(r.eventsPath)
const ofKind = (rows, kind) => rows.filter((e) => e && e.kind === kind)
const briefPath = (r, i, attempt) =>
  path.join(r.evidenceDir, 'publish-fold', 'resolver-brief-' + i + '-' + attempt + '.txt')
const shown = (rows) => JSON.stringify(rows, null, 2)

/**
 * The fold's `resolveConflicts({ … })` call, read the way the Proof's second
 * `Run:` reads it: `sed -n '/const resolution = await resolveConflicts({/,/})/p'`
 * — from the opening line to the first later line carrying `})`, inclusive.
 */
function resolveConflictsCall (source) {
  const lines = String(source).split('\n')
  const start = lines.findIndex((l) => l.includes('const resolution = await resolveConflicts({'))
  if (start < 0) return ''
  for (let i = start; i < lines.length; i++) {
    if (i > start && lines[i].includes('})')) return lines.slice(start, i + 1).join('\n')
  }
  return lines.slice(start).join('\n')
}

// ════════════════════════════════════════════════════════════════════════════
// legs (a), (b) and (d) — the conflict rig, attempt 1, a canned BLOCKED reply
//
// main rewrote line 2 of `a.txt` and the run rewrote the same line
// differently: one narrated conflict on one path, one resolver dispatched at
// `resolve:publish-fold:1:1:1`, whose BLOCKED reply parks the attempt.
// ════════════════════════════════════════════════════════════════════════════
const parkedRig = rig('parked')
const first = await drive(parkedRig, 1, BLOCKED_REPLY)

// ── the sim's own preconditions ─────────────────────────────────────────────
assert.equal(first.row.disposition, 'conflict parked',
  '(a): sim precondition — the rig folds a one-line conflict on ' + CONFLICTED +
  ' and the canned BLOCKED reply parks attempt 1. The receipt row: ' + shown(first.row))
assert.deepEqual(first.labels, [DISPATCH_1],
  '(a): sim precondition — attempt 1 dispatches exactly one resolver, at the label ' +
  '`resolveConflicts` builds from the fold\'s own prefix: ' + JSON.stringify(first.labels))

// ── leg (a) [M1] — the resolver's reply on the run's record ─────────────────
{
  const replies = ofKind(eventsOf(parkedRig), 'resolver:reply')
  assert.equal(replies.length, 1,
    '(a) [M1]: `publishFold`\'s `resolveConflicts` call passes `onEvent: eventLog.onEvent`, so ' +
    'the one publish-fold resolver dispatch appends exactly one `resolver:reply` event to ' +
    '<runDir>/events.jsonl. At BASE the call passes no `onEvent` at all and the row is absent. ' +
    'The log: ' + shown(eventsOf(parkedRig)))
  const reply = replies[0]
  assert.equal(reply.label, DISPATCH_1,
    '(a) [M1]: that row\'s `label` is the dispatch\'s own label: ' + shown(reply))
  assert.equal(reply.status, 'BLOCKED',
    '(a) [M1]: that row\'s `status` is the canned reply\'s: ' + shown(reply))
  assert.deepEqual(reply.paths, [CONFLICTED],
    '(a) [M1]: a BLOCKED reply\'s row carries `paths` `[<the conflicted path>]` — the one path ' +
    'the conflict was about, and no other: ' + shown(reply))
  assert.ok(typeof reply.evidence === 'object' && reply.evidence !== null &&
    typeof reply.evidence.read === 'string',
  '(a) [M1]: a BLOCKED reply\'s row carries `evidence` with a `read` string: ' + shown(reply))
  assert.ok(reply.evidence.read.startsWith('BLOCKED'),
    '(a) [M1]: that `evidence.read` begins `BLOCKED` — the status the reply carried, then its ' +
    'notes. Read: ' + JSON.stringify(reply.evidence.read))
}

// ── leg (a) [M1] — the second `Run:`, as an assertion ───────────────────────
{
  const source = fs.readFileSync(path.join(FLEET, 'publish-fold.mjs'), 'utf8')
  const call = resolveConflictsCall(source)
  assert.ok(call,
    '(a) [M1]: `fleet/publish-fold.mjs` holds a `const resolution = await resolveConflicts({` ' +
    'call — the one dispatch site this clause is about.')
  assert.ok(call.includes('onEvent: eventLog.onEvent'),
    '(a) [M1]: the fold\'s `resolveConflicts({ … })` call, read from its opening line to its ' +
    'closing `})` (the Proof\'s second `Run:`), carries `onEvent: eventLog.onEvent`. At BASE it ' +
    'passes `agent`, `runCli`, `roles`, `common`, `taskArgs`, `commutesArgs`, `open`, ' +
    '`contendingBlock`, `waveDir` and `labelPrefix` and no `onEvent`. The call:\n' + call)
}

// ── leg (b) [M2] — the parked attempt's own event ───────────────────────────
{
  const folds = ofKind(eventsOf(parkedRig), 'driver:publish-fold')
  assert.equal(folds.length, 1,
    '(b) [M2]: sim precondition — attempt 1 appended exactly one `driver:publish-fold` row: ' +
    shown(folds))
  const row = folds[0]
  assert.equal(row.disposition, 'conflict parked',
    '(b) [M2]: the row\'s `disposition` is the attempt\'s: ' + shown(row))
  assert.deepEqual(row.paths, [CONFLICTED],
    '(b) [M2]: the site is built with `publishFoldEvent(row, conflictsIndex())`, so an attempt ' +
    'with an open conflict carries `paths` naming that conflict\'s path. At BASE the site is an ' +
    'object literal with no `paths` key at all. The row: ' + shown(row))
  assert.ok(typeof row.evidence === 'object' && row.evidence !== null &&
    typeof row.evidence.read === 'string',
  '(b) [M2]: that row carries `evidence` with a `read` string: ' + shown(row))
  assert.ok(row.evidence.read.startsWith('conflict parked'),
    '(b) [M2]: its `evidence.read` begins with the attempt\'s disposition. Read: ' +
    JSON.stringify(row.evidence.read))
}

// ── leg (d) [M4] — the brief of an attempt whose log held no receipt ────────
{
  const brief = fs.readFileSync(briefPath(parkedRig, 1, 1), 'utf8')
  assert.ok(!brief.includes('FACTS:'),
    '(d) [M4]: attempt 1 started with no receipt on its conflicted path — the log held only ' +
    'this attempt\'s own `run:open` — so its resolver\'s brief carries no `FACTS:` at all, and a ' +
    'receipt-free fold briefs its resolver exactly as the base fold does. The brief:\n' + brief)
  assert.ok(brief.endsWith(MAIN_PATCH_SUFFIX),
    '(d) [M4]: and it ends with the `MAIN PATCH FILE:` line\'s text — nothing is appended after ' +
    'it when the block is empty. The brief\'s tail: ' + JSON.stringify(brief.slice(-200)))
  const last = brief.split('\n').pop()
  assert.ok(last.startsWith('MAIN PATCH FILE: '),
    '(d) [M4]: that last line is the `MAIN PATCH FILE:` line itself: ' + JSON.stringify(last))
  assert.deepEqual(ofKind(eventsOf(parkedRig), 'driver:facts'), [],
    '(d) [M4]: and after attempt 1 no `driver:facts` row is on the log — an empty block leaves ' +
    'no record row, so a run that recorded nothing writes nothing. The log: ' +
    shown(eventsOf(parkedRig)))
}

// ── leg (b) [M2] — the replayed site ────────────────────────────────────────
// Attempt 1 already recorded a disposition, so a re-drive of attempt 1 is
// replayed from the receipt: the branch is restored and the kernel is never
// invoked. The row that replay appends is the second of the two sites.
{
  const again = await drive(parkedRig, 1, BLOCKED_REPLY)
  assert.deepEqual(again.labels, [],
    '(b) [M2]: sim precondition — the re-drive is a replay: nothing is dispatched: ' +
    JSON.stringify(again.labels))
  const folds = ofKind(eventsOf(parkedRig), 'driver:publish-fold')
  assert.equal(folds.length, 2,
    '(b) [M2]: sim precondition — the replay appended a second `driver:publish-fold` row: ' +
    shown(folds))
  const row = folds[1]
  assert.deepEqual(row.paths, [CONFLICTED],
    '(b) [M2]: the replayed site is built with `publishFoldEvent(row, conflictsIndex())` too, ' +
    'so its row carries the same `paths` as the attempt it replays. At BASE the replayed literal ' +
    'writes no `paths` key. The row: ' + shown(row))
  assert.equal(row.pathsConflicted, 1,
    '(b) [M2]: and `pathsConflicted` is the count the attempt\'s own conflicts index holds, ' +
    'where the BASE literal hard-codes `0`: ' + shown(row))
  assert.ok(typeof row.evidence === 'object' && row.evidence !== null &&
    typeof row.evidence.read === 'string' && row.evidence.read.startsWith('conflict parked'),
  '(b) [M2]: and its `evidence.read` begins with the replayed disposition: ' + shown(row))
}

// ════════════════════════════════════════════════════════════════════════════
// leg (c) [M3] — the second attempt reads the first attempt's receipts
//
// A fresh parked rig, driven again as attempt 2 with a canned RESOLVED reply
// and the origin's `main` unmoved. At BASE the `tip unmoved` guard fires
// before any resolver and the attempt ends there.
// ════════════════════════════════════════════════════════════════════════════
const secondRig = rig('second-attempt')
const secondFirst = await drive(secondRig, 1, BLOCKED_REPLY)
assert.equal(secondFirst.row.disposition, 'conflict parked',
  '(c) [M3]: sim precondition — attempt 1 of the second rig parks on ' + CONFLICTED + ': ' +
  shown(secondFirst.row))

// The rows on the log when attempt 2 starts — the very argument M3 says
// `publishFold` hands `writeResolverBriefs`, snapshotted here before attempt 2
// appends anything of its own.
const rowsAtStart = eventsOf(secondRig)
const expectedBlock = factsBlock(rowsAtStart, [CONFLICTED])
const priorReply = ofKind(rowsAtStart, 'resolver:reply')[0]
const priorFold = ofKind(rowsAtStart, 'driver:publish-fold')[0]

const secondSecond = await drive(secondRig, 2, RESOLVED_REPLY)

assert.deepEqual(secondSecond.labels, [DISPATCH_2],
  '(c) [M3]: a prior attempt that ended `conflict parked` no longer ends a later attempt on the ' +
  'same tip as `tip unmoved` — a parked attempt reached no candidate, and the guard\'s own ' +
  'comment says "the attempt that already folded". So attempt 2 folds afresh and dispatches ' +
  '`' + DISPATCH_2 + '`. At BASE the guard fires first and nothing is dispatched. ' +
  'The disposition it reached instead: ' + shown(secondSecond.row))

{
  const brief = fs.readFileSync(briefPath(secondRig, 1, 2), 'utf8')
  assert.ok(expectedBlock,
    '(c) [M3]: sim precondition — the rows on the log when attempt 2 starts hold receipts on ' +
    CONFLICTED + ', so `factsBlock` over them renders a block. The rows: ' + shown(rowsAtStart))
  assert.ok(brief.endsWith(expectedBlock),
    '(c) [M3]: attempt 2\'s recorded brief ends with `factsBlock(receiptRows(' +
    '<runDir>/events.jsonl), [\'' + CONFLICTED + '\'])` over the rows the log held when the ' +
    'attempt started. At BASE `writeResolverBriefs` takes no `receipts` and the brief ends at ' +
    'the `MAIN PATCH FILE:` line. Expected tail:\n' + expectedBlock + '\n\nThe brief:\n' + brief)
  assert.ok(brief.slice(0, brief.length - expectedBlock.length).endsWith(MAIN_PATCH_SUFFIX),
    '(c) [M3]: and the block is APPENDED to the string `writeResolverBriefs` returns — the text ' +
    'before it still ends with the `MAIN PATCH FILE:` line. The brief:\n' + brief)

  const receiptLines = brief.split('\n').filter((l) => l.startsWith('- receipt '))
  assert.equal(receiptLines.length, 2,
    '(c) [M3]: the block carries exactly two `- receipt` lines — attempt 1\'s `resolver:reply` ' +
    'row and attempt 1\'s `driver:publish-fold` row, both on ' + CONFLICTED + ', and nothing ' +
    'else the run recorded. The lines: ' + shown(receiptLines))
  const ids = receiptLines.map((l) => l.split(' ')[2])
  assert.deepEqual(ids, [priorReply.id, priorFold.id],
    '(c) [M3]: in ascending id — the `resolver:reply` row first, the `driver:publish-fold` row ' +
    'second, which is the order attempt 1 appended them. The lines: ' + shown(receiptLines))
  assert.ok(ids[0] < ids[1],
    '(c) [M3]: and those two ids are ascending, which is what "ascending id" means for the ' +
    'ULIDs `makeEventLog` stamps: ' + JSON.stringify(ids))
  assert.ok(receiptLines[0].includes('resolver:reply') && receiptLines[0].includes('[' + CONFLICTED + ']'),
    '(c) [M3]: the first line is the `resolver:reply` row on ' + CONFLICTED + ': ' +
    JSON.stringify(receiptLines[0]))
  assert.ok(receiptLines[1].includes('driver:publish-fold') && receiptLines[1].includes('[' + CONFLICTED + ']'),
    '(c) [M3]: the second is the `driver:publish-fold` row on ' + CONFLICTED + ': ' +
    JSON.stringify(receiptLines[1]))

  const facts = ofKind(eventsOf(secondRig), 'driver:facts')
  assert.equal(facts.length, 1,
    '(c) [M3]: the log holds exactly one `driver:facts` row — one per non-empty brief, and ' +
    'attempt 1\'s brief was empty. The rows: ' + shown(facts))
  assert.equal(facts[0].label, FACTS_LABEL_2,
    '(c) [M3]: its `label` is the brief\'s — `resolve:publish-fold:<attempt>:<i>`, without the ' +
    'attempt-number suffix the dispatch label carries: ' + shown(facts[0]))
  assert.deepEqual(facts[0].receipts, [priorReply.id, priorFold.id],
    '(c) [M3]: and its `receipts` are the ids the block rendered, in the same order: ' +
    shown(facts[0]))
  assert.ok(!('paths' in facts[0]) && !('evidence' in facts[0]),
    '(c) [M3]: the row this plan writes is `{label, receipts}` — a record row and not a receipt ' +
    'itself, so it carries neither `paths` nor `evidence`: ' + shown(facts[0]))
}

assert.equal(secondSecond.row.disposition, 'folded',
  '(c) [M3]: attempt 2 then ends `folded` — the canned RESOLVED reply drains the same conflict ' +
  'and the candidate is materialized: ' + shown(secondSecond.row))

// ════════════════════════════════════════════════════════════════════════════
// leg (b)'s third clause and leg (c)'s last — the rig that never conflicts
//
// main edits `b.txt` and the run edits `a.txt`: the two patches join no path,
// so the fold folds clean. Attempt 1 ends `folded`; attempt 2 on the unmoved
// tip is the one case the `tip unmoved` guard is still for.
// ════════════════════════════════════════════════════════════════════════════
{
  const cleanRig = rig('clean', { mainFile: 'b.txt', mainText: 'MAINB' })
  const clean = await drive(cleanRig, 1, BLOCKED_REPLY)
  assert.equal(clean.row.disposition, 'folded',
    '(b) [M2]: sim precondition — a rig whose `main` and integration branch edit different files ' +
    'folds: ' + shown(clean.row))
  const folds = ofKind(eventsOf(cleanRig), 'driver:publish-fold')
  assert.equal(folds.length, 1,
    '(b) [M2]: sim precondition — one `driver:publish-fold` row: ' + shown(folds))
  assert.equal(folds[0].disposition, 'folded',
    '(b) [M2]: the row\'s `disposition` is `folded`: ' + shown(folds[0]))
  assert.ok(!('paths' in folds[0]),
    '(b) [M2]: and the row of an attempt that folded with no conflict carries NO `paths` key — a ' +
    'receipt names files, and a fold that conflicted on none has none to name: ' + shown(folds[0]))
  assert.ok(!('evidence' in folds[0]),
    '(b) [M2]: nor an `evidence` key: ' + shown(folds[0]))

  const again = await drive(cleanRig, 2, BLOCKED_REPLY)
  assert.equal(again.row.disposition, 'tip unmoved',
    '(c) [M3]: a rig whose attempt 1 ended `folded`, driven again as attempt 2 on the unmoved ' +
    'tip, still ends `tip unmoved` — the guard is narrowed to the attempt that already folded, ' +
    'not removed: ' + shown(again.row))
  assert.deepEqual(again.labels, [],
    '(c) [M3]: and no resolver is dispatched for it: ' + JSON.stringify(again.labels))
}

// ════════════════════════════════════════════════════════════════════════════
// leg (e) [M3] — the third `Run:`, as an assertion
//
// The exam that reaches main is the file at the guarded path, not a pointer
// into a run's reserved `fleet/tests/exams/<run>/` directory that publish
// strips (#1053, and the run's own Global Constraint: a guarded exam file is
// self-contained at its guarded path).
// ════════════════════════════════════════════════════════════════════════════
{
  const self = fs.readFileSync(SELF, 'utf8')
  const offenders = self.split('\n')
    .map((line, n) => [n + 1, line])
    .filter(([, line]) => /^import .*exams\//.test(line))
  assert.deepEqual(offenders, [],
    '(e) [M3]: this sim carries no `import` line naming a path under `exams/` — it imports the ' +
    'fold, the engine\'s seam and the sim helpers by their `fleet/tests/`-relative paths and ' +
    'nothing under `fleet/tests/exams/`. Lines that do: ' +
    JSON.stringify(offenders.map(([n, line]) => n + ': ' + line)))
}

console.log('ALL TESTS PASSED')

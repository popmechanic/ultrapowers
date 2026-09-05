/**
 * fleet/tests/test_sandbox_boot_record.mjs — the record a finished run leaves
 * behind is two tags, and the two branches go with them.
 *
 * The exam is written against the task's Machine clauses, leg by leg. Every
 * assertion names the leg it belongs to and the clause it comes from, so a
 * reader can map this file back to the contract:
 *
 *   M1  after the run's last evidence push — in a `done` outcome and in BOTH
 *       `parked` outcomes (a draft PR, and nothing ahead of base) — the script
 *       pushes `<plan sha>:refs/tags/ultra/plan/run-<N>` from the target clone
 *       and `HEAD:refs/tags/ultra/evidence/run-<N>` from the evidence worktree.
 *   M2  it then runs ONE
 *       `git -C <target> ls-remote --tags origin refs/tags/ultra/plan/run-<N>
 *        refs/tags/ultra/evidence/run-<N>`
 *       and only when that listing shows the plan tag at the plan sha and the
 *       evidence tag at the evidence worktree's HEAD does it push ONE deletion
 *       of both `refs/heads/ultra/plan-run-<N>` and
 *       `refs/heads/ultra/evidence-run-<N>`, after the listing; no command ever
 *       names `ultra/integration-run-<N>` for deletion.
 *   M3  a listing that omits a tag, one that shows the plan tag at another sha,
 *       and one that shows the evidence tag at another sha each leave both
 *       branches undeleted, log one line beginning `record:` that contains
 *       `kept`, and change neither the run's final state nor its exit code.
 *   M4  a run that ends `failed` (engine exit non-zero) pushes no tag and
 *       deletes no branch.
 *   M5  the states sequence, the evidence commit sequence, the PR POST and the
 *       one notification of the green path are unchanged from BASE, and the
 *       first tag push comes after the last evidence push.
 *
 * The rig is `_sandbox_boot_helpers.mjs` — the stub bin dir, `makeHome`,
 * `boot`, the memoized `green` run, the log readers and `runTests` — shared
 * with the other halves of the boot exam. Its `git` stub grows one `ls-remote`
 * arm, which the three env knobs this file sets steer: `STUB_TAGS_MISSING`
 * (the listing prints nothing), `STUB_TAG_PLAN_SHA` and `STUB_TAG_EVIDENCE_SHA`
 * (the listing prints a tag at some other sha). `OTHER_SHA` is the rig's
 * "some other commit", which is neither `PLAN_SHA` nor `HEAD_SHA`.
 *
 * Ground truth for "which git call happened, with which words" is `git.log` —
 * the tab-separated argv the stub writes through the shared `argv()` prelude,
 * which no stub case can talk its way out of; `gitLog(ctx)` reads it and every
 * ordering assertion here is an index comparison inside that one array. The
 * `record:` lines are read from `fleet-boot.log` through `stream`, which is
 * where the script's own log lines land.
 *
 * No network, no systemd, no real `claude`: every call is a stub in
 * `FLEET_BIN_DIR` and every path is under `FLEET_HOME`.
 */

import assert from 'node:assert/strict'

import {
  TARGET, PR_URL, PLAN_SHA, HEAD_SHA, OTHER_SHA,
  makeHome, boot, green,
  gitLog, verbOf, dirOf, evidenceDir, targetDir,
  states, commitStates, prPosts, notifies, statusOf,
  stream, indexOf, lastIndexOf, isEvidencePush,
  runTests,
} from './_sandbox_boot_helpers.mjs'

// ── the literals of the record ───────────────────────────────────────────────
//
// Assembled from the run number the rig's assignment carries (7), spelled the
// way the task spells them: the TAGS use `run/<N>` under `ultra/plan` and
// `ultra/evidence`, the BRANCHES keep their BASE `-run-<N>` spellings.

const PLAN_TAG = 'refs/tags/ultra/plan/run-7'
const EVIDENCE_TAG = 'refs/tags/ultra/evidence/run-7'
const PLAN_TAG_PUSH = `${PLAN_SHA}:${PLAN_TAG}`
const EVIDENCE_TAG_PUSH = `HEAD:${EVIDENCE_TAG}`
const PLAN_BRANCH_REF = 'refs/heads/ultra/plan-run-7'
const EVIDENCE_BRANCH_REF = 'refs/heads/ultra/evidence-run-7'
const INTEGRATION = 'ultra/integration-run-7'

// ── reading the git argv log ─────────────────────────────────────────────────

/** The words a call carried after its subcommand — `origin`, refspecs, flags. */
const tailOf = (a) => a.slice(a.indexOf(verbOf(a)) + 1)
/** Every git call whose argv carries `word` exactly. */
const carrying = (git, word) => git.filter((a) => a.includes(word))
/** Every git call any of whose words contains `text`. */
const mentioning = (git, text) => git.filter((a) => a.some((s) => s.includes(text)))
/** The index of the first git call any of whose words contains `text`. */
const firstMentioning = (git, text) => git.findIndex((a) => a.some((s) => s.includes(text)))

const lsRemotes = (git) => git.filter((a) => verbOf(a) === 'ls-remote')
const deletions = (git) => carrying(git, '--delete')
/** M2's prohibition: nothing may delete the integration branch. */
const integrationDeletions = (git) =>
  deletions(git).filter((a) => a.some((s) => s.includes(INTEGRATION)))
/** The index of the last evidence-branch push, which every tag must follow. */
const lastEvidencePushIndex = (git) => {
  for (let i = git.length - 1; i >= 0; i -= 1) if (isEvidencePush(git[i])) return i
  return -1
}
/** M3's line: `record: …kept…`, as it stands in the boot log. */
const recordKeptLines = (ctx) => stream(ctx).filter((l) => /^record: .*kept/.test(l))

/** The git log rendered one call per line, for a failure message worth reading. */
const why = (ctx) => `\n--- git.log ---\n${gitLog(ctx).map((a) => a.join(' ')).join('\n')}`
/** The script's own record lines, for the same reason. */
const whyRecord = (ctx) =>
  `\n--- fleet-boot.log (record lines) ---\n${stream(ctx).filter((l) => l.startsWith('record:')).join('\n')}`

/**
 * The two tag pushes, asserted with the exact argv each carries: the plan tag
 * from the target clone, the evidence tag from the evidence worktree. `label`
 * says which run is being read.
 */
function assertBothTagPushes(ctx, label) {
  const git = gitLog(ctx)
  const planPushes = git.filter(
    (a) => verbOf(a) === 'push' && dirOf(a) === targetDir(ctx) && a.includes(PLAN_TAG_PUSH))
  assert.equal(planPushes.length, 1,
    `${label}: exactly one 'git -C <home>/target push origin ${PLAN_TAG_PUSH}'${why(ctx)}`)
  assert.deepEqual(tailOf(planPushes[0]), ['origin', PLAN_TAG_PUSH],
    `${label}: the plan tag is pushed to origin as that refspec and nothing else`)

  const evidencePushes = git.filter(
    (a) => verbOf(a) === 'push' && dirOf(a) === evidenceDir(ctx) && a.includes(EVIDENCE_TAG_PUSH))
  assert.equal(evidencePushes.length, 1,
    `${label}: exactly one 'git -C <home>/evidence push origin ${EVIDENCE_TAG_PUSH}'${why(ctx)}`)
  assert.deepEqual(tailOf(evidencePushes[0]), ['origin', EVIDENCE_TAG_PUSH],
    `${label}: the evidence tag is pushed to origin as that refspec and nothing else`)
}

/**
 * M1/M5's order, inside one run: the first git call that names the plan tag —
 * the tag push, or the listing that reads it — comes after the LAST push of
 * the evidence branch, so the tag lands on the commit carrying the terminal
 * page and never before it.
 */
function assertTagFollowsLastEvidencePush(ctx, label) {
  const git = gitLog(ctx)
  const lastPush = lastEvidencePushIndex(git)
  assert.ok(lastPush >= 0, `${label}: the run pushed the evidence branch at all${why(ctx)}`)
  const firstTag = firstMentioning(git, PLAN_TAG)
  assert.ok(firstTag >= 0, `${label}: some git call names ${PLAN_TAG}${why(ctx)}`)
  assert.ok(firstTag > lastPush,
    `${label}: the first git call naming ${PLAN_TAG} (${firstTag}) must follow the last ` +
    `evidence push (${lastPush})${why(ctx)}`)
}

/** M2's listing-then-deletion, inside one run. `exactListing` pins the whole argv. */
function assertListedThenDeleted(ctx, label, { exactListing = false } = {}) {
  const git = gitLog(ctx)

  const listings = lsRemotes(git)
  assert.equal(listings.length, 1,
    `${label}: exactly one ls-remote call verifies the two tags${why(ctx)}`)
  const listing = listings[0]
  if (exactListing) {
    assert.equal(dirOf(listing), targetDir(ctx), `${label}: the listing runs in the target clone`)
    assert.deepEqual(tailOf(listing), ['--tags', 'origin', PLAN_TAG, EVIDENCE_TAG],
      `${label}: 'git -C <home>/target ls-remote --tags origin ${PLAN_TAG} ${EVIDENCE_TAG}'${why(ctx)}`)
  } else {
    assert.ok(listing.includes('--tags'), `${label}: the listing is a --tags listing${why(ctx)}`)
    assert.ok(listing.includes(PLAN_TAG) && listing.includes(EVIDENCE_TAG),
      `${label}: the one listing names both tags${why(ctx)}`)
  }

  const deletes = deletions(git)
  assert.equal(deletes.length, 1,
    `${label}: exactly one branch deletion${why(ctx)}`)
  const deletion = deletes[0]
  assert.equal(verbOf(deletion), 'push', `${label}: the deletion is a push`)
  assert.deepEqual(tailOf(deletion), ['origin', '--delete', PLAN_BRANCH_REF, EVIDENCE_BRANCH_REF],
    `${label}: 'push origin --delete ${PLAN_BRANCH_REF} ${EVIDENCE_BRANCH_REF}' — both refs, one push${why(ctx)}`)

  const listingIndex = git.indexOf(listing)
  const deletionIndex = git.indexOf(deletion)
  assert.ok(deletionIndex > listingIndex,
    `${label}: the deletion (${deletionIndex}) comes after the listing (${listingIndex})${why(ctx)}`)
}

/** M2's last sentence, inside one run. */
function assertIntegrationBranchSurvives(ctx, label) {
  assert.deepEqual(integrationDeletions(gitLog(ctx)).map((a) => a.join(' ')), [],
    `${label}: no git call carries both --delete and ${INTEGRATION}${why(ctx)}`)
}

const tests = []
const test = (name, fn) => tests.push([name, fn])

// ── (a) every terminal outcome that is not `failed` leaves the record  [M1, M2, M5] ──

test('the green run pushes both tags, from the target clone and the evidence worktree  [M1 / leg (a)]', () => {
  const ctx = green()
  assertBothTagPushes(ctx, 'the green run')
})

test('a parked draft PR leaves the same record: both tags, one listing, one deletion  [M1/M2/M5 / leg (a)]', () => {
  // NEEDS_ACK with no approve receipt: the run publishes a DRAFT PR and parks.
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { STUB_VERDICT: 'NEEDS_ACK' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(statusOf(ctx).state, 'parked', 'the run parked, as at BASE')

  assertBothTagPushes(ctx, 'the parked-draft run')
  assertListedThenDeleted(ctx, 'the parked-draft run')
  assertTagFollowsLastEvidencePush(ctx, 'the parked-draft run')
  // The draft PR's head must survive: only the operator closes that PR.
  assertIntegrationBranchSurvives(ctx, 'the parked-draft run')
})

test('a parked run with nothing ahead of base leaves the same record  [M1/M2/M5 / leg (a)]', () => {
  // run-69's shape: the branch equals BASE, so nothing is pushed and no PR is
  // opened — and the record is still made, on the evidence the run did commit.
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { STUB_VERDICT: 'NEEDS_ACK', STUB_NO_COMMITS: '1' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(statusOf(ctx).state, 'parked', 'the run parked, as at BASE')

  assertBothTagPushes(ctx, 'the nothing-ahead run')
  assertListedThenDeleted(ctx, 'the nothing-ahead run')
  assertTagFollowsLastEvidencePush(ctx, 'the nothing-ahead run')
  // The head nothing was pushed to is not a thing to delete either.
  assertIntegrationBranchSurvives(ctx, 'the nothing-ahead run')
})

// ── (b) the green path's listing and deletion, word for word  [M2] ───────────

test('the green run lists both tags once and deletes both branches once, after the listing  [M2 / leg (b)]', () => {
  const ctx = green()
  assertListedThenDeleted(ctx, 'the green run', { exactListing: true })
  assert.equal(dirOf(deletions(gitLog(ctx))[0]), targetDir(ctx),
    'the deletion runs in the target clone')
  assertIntegrationBranchSurvives(ctx, 'the green run')
})

// ── (c) a listing that does not agree deletes nothing and fails nothing  [M2, M3] ──
//
// Three ways the remote can disagree, each a `done` run whose gate said PASS:
// the listing omits the tags, it shows the plan tag at a sha that is not
// PLAN_SHA, and it shows the evidence tag at a sha that is not HEAD_SHA. Each
// keeps both branches, says so once, and leaves the run exactly as it was.

const UNVERIFIED = [
  ['the listing shows neither tag', { STUB_TAGS_MISSING: '1' }],
  ['the plan tag is listed at another sha', { STUB_TAG_PLAN_SHA: OTHER_SHA }],
  ['the evidence tag is listed at another sha', { STUB_TAG_EVIDENCE_SHA: OTHER_SHA }],
]

for (const [what, env] of UNVERIFIED) {
  test(`${what}: both branches are kept, the run is still done  [M2/M3 / leg (c)]`, () => {
    const ctx = makeHome()
    const r = boot(ctx, ['boot'], env)

    // M3: neither the exit code nor the final state moves.
    assert.equal(r.status, 0, `an unverified tag must not fail the run:\n${r.stdout}${r.stderr}`)
    const status = statusOf(ctx)
    assert.equal(status.state, 'done', 'the run still ends done')
    assert.equal(status.pr, PR_URL, 'the PR cell is still the PR URL')

    // M2: without the listing agreeing on BOTH tags, nothing is deleted.
    assert.deepEqual(deletions(gitLog(ctx)).map((a) => a.join(' ')), [],
      `no branch is deleted when the listing does not agree${why(ctx)}`)

    // M3: exactly one line beginning `record:` that contains `kept`.
    assert.deepEqual(recordKeptLines(ctx).length, 1,
      `exactly one 'record: … kept …' line${whyRecord(ctx)}`)
  })
}

// ── (d) a failed run leaves its branches for the sweep  [M4] ─────────────────

test('an engine exit of 2 pushes no tag and deletes no branch  [M4 / leg (d)]', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { STUB_ENGINE_CODE: '2' })
  assert.equal(r.status, 1, 'a failed run still exits 1')
  assert.equal(statusOf(ctx).state, 'failed', 'the run ends failed, as at BASE')

  const git = gitLog(ctx)
  assert.deepEqual(mentioning(git, 'refs/tags/').map((a) => a.join(' ')), [],
    `a failed run names no tag ref at all${why(ctx)}`)
  assert.deepEqual(deletions(git).map((a) => a.join(' ')), [],
    `a failed run deletes no branch — its record is the two branches${why(ctx)}`)
})

// ── (e) the green path is otherwise unchanged from BASE  [M5] ────────────────

test('the green path keeps its states, its commits, its one PR POST and its one notification  [M5 / leg (e)]', () => {
  const ctx = green()

  assert.deepEqual(states(ctx), ['booting', 'running', 'publishing', 'done'],
    `the BASE state sequence${why(ctx)}`)
  assert.deepEqual(commitStates(ctx), ['running', 'publishing', 'done'],
    'the BASE sequence of pages, as committed')
  assert.equal(prPosts(ctx).length, 1, 'exactly one POST /pulls, as at BASE')
  assert.deepEqual(notifies(ctx), [
    { title: 'run-7 done', message: `${TARGET} — ${PR_URL}` },
  ], 'the one notification of the green path, unchanged')

  assertTagFollowsLastEvidencePush(ctx, 'the green run')
})

test('the green run tags after its terminal page reached the evidence branch  [M5 / leg (e)]', () => {
  // The same order, read the other way: the `done` page is claimed in the boot
  // log before the tag step runs, so the commit the tag names carries it. Both
  // readings have to hold; only one of them can be read from the argv log.
  const ctx = green()
  const doneAt = lastIndexOf(ctx, 'status: state=done')
  const lsRemoteAt = indexOf(ctx, 'ls-remote')
  assert.ok(doneAt >= 0, 'the green run claimed done')
  assert.ok(lsRemoteAt > doneAt,
    `the tag listing (${lsRemoteAt}) follows the done page (${doneAt}) in the boot log`)
  // HEAD_SHA is what `git rev-parse` answers in the evidence worktree, so the
  // evidence tag the listing must agree with is that sha and no other.
  assert.notEqual(HEAD_SHA, OTHER_SHA, "the rig's two shas are distinct")
  assert.notEqual(PLAN_SHA, OTHER_SHA, "the rig's two shas are distinct")
})

runTests(tests)

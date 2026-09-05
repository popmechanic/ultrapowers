/**
 * The other half of the `fleet/sandbox-boot.sh` exam: sections 3–10 — the
 * retired repository, parked runs, refusals, the public-target fallback, the
 * engine's own words, failing before the clone, re-entry, and the deadman.
 * Sections 1 and 2 stay in `test_sandbox_boot.mjs`; the rig both halves share
 * is `_sandbox_boot_helpers.mjs`.
 *
 * Every case here reads the same one log stream per run that the other half
 * does, so its ordering assertions are index comparisons within a single case
 * and nothing about them depends on which file the case lives in.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SCRIPT, BASE_SHA, ENGINE_SHA, TARGET, VM_NAME, PR_URL, PR_AUTHOR, RUN_PATH,
  RETIRED_NAMES, ASSIGNMENT,
  makeHome, boot, green,
  readLog, argvLines, stream, statusOf, states, notifies, committed, commitStates,
  engineRuns, prPosts, indexOf,
  verbOf, dirOf, gitLog, evidenceDir, isEvidencePush, addArguments,
  runTests,
} from './_sandbox_boot_helpers.mjs'

const tests = []
const test = (name, fn) => tests.push([name, fn])

// ── 3. the retired repository ────────────────────────────────────────────────

test('the script names the retired repository nowhere  [M4 / leg (f)]', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8')
  for (const name of RETIRED_NAMES) {
    assert.equal(source.split(name).length - 1, 0,
      `fleet/sandbox-boot.sh still names '${name}' — no clone of it, no push to it, no variable`)
  }
  // And this exam does not smuggle it back in either — all three of its files,
  // not only the one this case happens to live in.
  const here = path.dirname(fileURLToPath(import.meta.url))
  for (const file of ['_sandbox_boot_helpers.mjs', 'test_sandbox_boot.mjs', 'test_sandbox_boot_edges.mjs']) {
    const self = fs.readFileSync(path.join(here, file), 'utf8')
    for (const name of RETIRED_NAMES) {
      assert.equal(self.split(name).length - 1, 0, `${file} still names '${name}'`)
    }
  }
})

test('no clone and no push in a real run names the retired repository  [M4 / leg (f)]', () => {
  const ctx = green()
  const git = gitLog(ctx)
  for (const a of git) {
    const joined = a.join(' ')
    for (const name of RETIRED_NAMES) {
      assert.ok(!joined.includes(name), `git call names ${name}: ${joined}`)
    }
  }
  assert.equal(git.filter((a) => a[1] === 'clone').length, 1, 'the target is the only clone')
  // Repeated here against the whole log, because leg (f) is about the log and
  // not only about the green path's staged paths.
  const args = addArguments(git)
  for (const bad of ['-A', '.', '--all']) assert.ok(!args.includes(bad))
  assert.equal(args.filter((a) => a.startsWith('.claude/')).length, 0)
})

// ── 4. parked runs ───────────────────────────────────────────────────────────

test('a non-PASS gate receipt parks the run and opens a draft PR', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { STUB_VERDICT: 'NEEDS_ACK' })
  assert.equal(r.status, 0, r.stdout + r.stderr)

  assert.deepEqual(states(ctx), ['booting', 'running', 'publishing', 'parked'])
  const status = statusOf(ctx)
  assert.equal(status.state, 'parked')
  assert.equal(status.pr, PR_URL)
  assert.equal(status.prAuthor, PR_AUTHOR)
  assert.equal(status.error, 'parked: gate verdict NEEDS_ACK')

  assert.equal(prPosts(ctx)[0].draft, true, 'a parked run publishes a DRAFT PR')
  assert.deepEqual(commitStates(ctx), ['running', 'publishing', 'parked'])
  assert.deepEqual(notifies(ctx), [
    { title: 'run-7 parked', message: `${TARGET} — ${PR_URL}` },
  ])
})

test('an engine exit of 1 with a gate receipt is a verdict, not a failure', () => {
  // run-main exits 1 on gate-blocked; the receipt is its terminal artifact.
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { STUB_ENGINE_CODE: '1', STUB_VERDICT: 'NEEDS_ACK' })
  assert.notEqual(statusOf(ctx).state, 'failed', r.stdout + r.stderr)
  assert.ok(readLog(ctx, 'fleet-boot.log').includes('a verdict, not a crash'))
})

// ── 5. refusals ──────────────────────────────────────────────────────────────

test('a malformed assignment fails the run and clones nothing', () => {
  const ctx = makeHome()
  const bad = `run=7 plan=not-a-sha target=${TARGET} base=${BASE_SHA} engine=${ENGINE_SHA}`
  const r = boot(ctx, ['boot'], { FLEET_ASSIGNMENT: bad })
  assert.notEqual(r.status, 0, 'a malformed assignment must exit non-zero')

  const status = statusOf(ctx)
  assert.equal(status.state, 'failed')
  assert.match(status.error, /plan is not a 40-hex sha/)
  assert.equal(readLog(ctx, 'git.log'), '', 'nothing is cloned on a refused assignment')
  assert.equal(engineRuns(ctx), 0, 'no engine on a refused assignment')
  assert.equal(notifies(ctx).length, 1)
  assert.equal(notifies(ctx)[0].title, 'run-7 failed')
})

test('an unknown key in the assignment fails the run', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { FLEET_ASSIGNMENT: `${ASSIGNMENT} sudo=yes` })
  assert.notEqual(r.status, 0)
  assert.match(statusOf(ctx).error, /unknown key 'sudo'/)
  assert.equal(readLog(ctx, 'git.log'), '')
})

test('without FLEET_ASSIGNMENT the comment is read from Reflection exactly once', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { FLEET_ASSIGNMENT: '' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(stream(ctx).filter((l) => l.startsWith('CALL curl comment')).length, 1)
  assert.equal(statusOf(ctx).state, 'done')
})

test('without FLEET_ASSIGNMENT and with an empty comment the run fails at once — no polling', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { FLEET_ASSIGNMENT: '', STUB_COMMENT: '' })
  assert.notEqual(r.status, 0)
  assert.equal(stream(ctx).filter((l) => l.startsWith('CALL curl comment')).length, 1,
    'one read; an empty comment is a launcher bug, not something to wait out')
  assert.equal(statusOf(ctx).state, 'failed')
  assert.match(statusOf(ctx).error, /no run= comment/)
  assert.equal(readLog(ctx, 'git.log'), '')
  assert.equal(engineRuns(ctx), 0)
})

test('an api_key auth status stops the run before the engine spends a credit', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { STUB_AUTH: 'api_key' })
  assert.notEqual(r.status, 0)
  assert.equal(statusOf(ctx).state, 'failed')
  assert.match(statusOf(ctx).error, /api_key/)
  assert.equal(engineRuns(ctx), 0, 'the engine never starts on an api_key')
})

// No subscription, no run: a `claude auth status` that shows neither
// `oauth_token` nor `api_key` is not a box to log about and continue on — it is
// a box that would bill somewhere else, so the run ends `failed` before the
// engine unit exists, and the version the run did ride on is a receipt on the
// evidence branch.

/** The last element of `list` satisfying `pred`, as an index, or -1. */
const lastWhere = (list, pred) => {
  for (let i = list.length - 1; i >= 0; i -= 1) if (pred(list[i])) return i
  return -1
}
const lastEvidence = (ctx, verb) =>
  lastWhere(gitLog(ctx), (a) => dirOf(a) === evidenceDir(ctx) && verbOf(a) === verb)

/**
 * The `failed` page was committed and THEN pushed: a script that fails without
 * pushing (no push at all), or that pushes before the `failed` commit, does not
 * leave the account on the branch.
 */
const assertFailedPageCommittedThenPushed = (ctx) => {
  const commit = lastEvidence(ctx, 'commit')
  const push = lastWhere(gitLog(ctx), isEvidencePush)
  assert.ok(commit >= 0, 'the failed page is committed in the evidence worktree')
  assert.ok(push > commit,
    `the failed page is pushed AFTER it is committed (last commit ${commit}, last push ${push})`)
}

test('an auth status showing no oauth_token fails the run before the engine starts  [M1 / leg (a)]', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { STUB_AUTH: 'none' })
  assert.notEqual(r.status, 0, 'a box without the subscription token must exit non-zero')

  const status = statusOf(ctx)
  assert.equal(status.state, 'failed')
  assert.match(status.error, /oauth_token/,
    `the error names what is missing, not something else: ${status.error}`)
  assert.equal(engineRuns(ctx), 0, 'no --unit=fleet-engine-7 is ever issued')
  assert.equal(commitStates(ctx)[commitStates(ctx).length - 1], 'failed',
    `the last committed page is the failed one: ${JSON.stringify(commitStates(ctx))}`)
  assertFailedPageCommittedThenPushed(ctx)
})

test('an empty auth status fails the same way — no oauth_token is no oauth_token  [M1 / leg (a)]', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { STUB_AUTH: '' })
  assert.notEqual(r.status, 0, 'an auth status that says nothing at all is not a green light')

  const status = statusOf(ctx)
  assert.equal(status.state, 'failed')
  assert.match(status.error, /oauth_token/, status.error)
  assert.equal(engineRuns(ctx), 0,
    'a script that logs and continues on a missing oauth_token starts the engine here')
  assert.equal(commitStates(ctx)[commitStates(ctx).length - 1], 'failed')
  assertFailedPageCommittedThenPushed(ctx)
})

test('an api_key auth status still fails, with its failed page on the branch  [M2 / leg (b)]', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { STUB_AUTH: 'api_key' })
  assert.notEqual(r.status, 0)
  assert.equal(statusOf(ctx).state, 'failed')
  assert.match(statusOf(ctx).error, /api_key/, statusOf(ctx).error)
  assert.equal(engineRuns(ctx), 0, 'the engine never starts on an api_key, as at BASE')
  assert.equal(commitStates(ctx)[commitStates(ctx).length - 1], 'failed')
})

test('the version the run rides on is read once, before the engine, and collected  [M3 / leg (c)]', () => {
  const ctx = green()

  const versionCalls = argvLines(ctx, 'claude').filter((a) => a.includes('--version'))
  assert.equal(versionCalls.length, 1,
    `claude --version runs exactly once: ${JSON.stringify(argvLines(ctx, 'claude'))}`)
  const atVersion = indexOf(ctx, 'CALL claude --version')
  const atEngine = indexOf(ctx, 'CALL systemd-run engine')
  assert.ok(atVersion >= 0, 'the boot stream carries a CALL claude --version line')
  assert.ok(atEngine >= 0, 'the boot stream carries a CALL systemd-run engine line')
  assert.ok(atVersion < atEngine,
    `the version is read BEFORE the engine unit starts (version ${atVersion}, engine ${atEngine})`)

  // The receipt itself, in the evidence worktree's run directory.
  const file = path.join(evidenceDir(ctx), RUN_PATH, 'claude-version.txt')
  assert.ok(fs.existsSync(file), `${RUN_PATH}/claude-version.txt is collected into the evidence`)
  assert.match(fs.readFileSync(file, 'utf8'), /^2\.1\.250/,
    'the file holds what `claude --version` printed')

  // …and it is STAGED, by an add whose path scope covers it, before the run's
  // last evidence commit, which is before the push that carries it off the box.
  const git = gitLog(ctx)
  const atAdd = lastEvidence(ctx, 'add')
  assert.ok(atAdd >= 0, 'the run stages its evidence in the evidence worktree')
  const staged = addArguments([git[atAdd]])
  assert.ok(
    staged.includes(RUN_PATH) || staged.some((s) => s.endsWith(`${RUN_PATH}/claude-version.txt`)),
    `the last evidence add covers the file, not a narrower path: ${JSON.stringify(staged)}`)
  const atCommit = lastEvidence(ctx, 'commit')
  const atPush = lastWhere(git, isEvidencePush)
  assert.ok(atAdd < atCommit,
    `the add precedes the last evidence commit (add ${atAdd}, commit ${atCommit})`)
  assert.ok(atCommit < atPush,
    `and that commit precedes the last evidence push (commit ${atCommit}, push ${atPush})`)
})

test('the boot log carries the auth method and the version it read  [M4 / leg (d)]', () => {
  const ctx = green()
  const log = stream(ctx)
  assert.ok(log.some((l) => l.includes('claude auth status: authMethod: oauth_token')),
    'the green path logs the auth method it accepted')
  assert.ok(log.some((l) => /^claude version: 2\.1\.250/.test(l)),
    `a line begins 'claude version: ' with what claude printed: ${JSON.stringify(log.filter((l) => l.startsWith('claude ')))}`)
})

// ── 6. the public-target fallback ────────────────────────────────────────────

test('a target the exe.dev edge cannot find is cloned from github.com and re-pointed', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], {
    STUB_CLONE_404: `https://github.int.exe.xyz/${TARGET}.git`,
  })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const H = ctx.home
  const git = gitLog(ctx)
  assert.ok(git.some((a) => a[1] === 'clone' && a[2] === `https://github.com/${TARGET}.git`),
    'a public target falls back to github.com')
  assert.ok(git.some((a) => a.join(' ') ===
    `git -C ${H}/target remote set-url origin https://github.int.exe.xyz/${TARGET}.git`),
    'origin goes back to the edge, because the attached integration is what makes the push work')
})

// ── 7. the engine's own words ────────────────────────────────────────────────

test("the engine's output is served, logged, and quoted in the error", () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { STUB_ENGINE_CODE: '1', STUB_NO_RECEIPT: '1' })
  assert.notEqual(r.status, 0)

  // Served beside the status page, so a laptop with a VM token can read it.
  const engineLog = readLog(ctx, path.join('www', 'engine.log'))
  assert.ok(engineLog.includes('run-main: preflight'), 'stdout is captured')
  assert.ok(engineLog.includes('run-main: knob-validate-failed'), 'stderr is captured')
  assert.ok(readLog(ctx, 'fleet-boot.log').includes('run-main: knob-validate-failed'),
    'and the boot log carries it too')

  // The reason is in the cell a reader opens, not only in a file on a VM the
  // janitor is about to delete.
  const status = statusOf(ctx)
  assert.equal(status.state, 'failed')
  assert.match(status.error, /^engine exited 1\n/)
  assert.ok(status.error.includes('run-main: knob-validate-failed'), status.error)

  // …and it rides out on `ultra/evidence-run-7`, which is the only artifact a
  // run that never reached its gate produces.
  assert.ok(fs.existsSync(path.join(evidenceDir(ctx), RUN_PATH, 'engine.log')))
  assert.equal(commitStates(ctx)[commitStates(ctx).length - 1], 'failed')
})

// ── 8. failing before the clone ──────────────────────────────────────────────

test('a failure before the target clone has no branch to write to  [M2]', () => {
  // Nothing has been cloned, so there is no worktree and no evidence branch:
  // the record of such a failure is the status page and the notify.
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { STUB_CLONE_FAIL: `https://github.int.exe.xyz/${TARGET}.git` })
  assert.notEqual(r.status, 0)
  assert.equal(statusOf(ctx).state, 'failed')
  assert.match(statusOf(ctx).error, /^clone: target/)
  assert.equal(engineRuns(ctx), 0, 'the engine never started')

  assert.equal(gitLog(ctx).filter(isEvidencePush).length, 0,
    'there is no branch to push to before the clone')
  assert.equal(committed(ctx).length, 0, 'and nothing to commit')
  assert.deepEqual(notifies(ctx).map((n) => n.title), ['run-7 failed'],
    'the notify is the record')
})

// ── 9. re-entry ──────────────────────────────────────────────────────────────

test('a run that failed after its engine ran is not restarted  [M5/(g)]', () => {
  const ctx = makeHome()
  assert.notEqual(boot(ctx, ['boot'], { STUB_ENGINE_CODE: '1', STUB_NO_RECEIPT: '1' }).status, 0)
  const gitBefore = gitLog(ctx).length

  const again = boot(ctx)
  assert.equal(again.status, 0, 'exit 0: finished, whatever it finished as')
  assert.ok(readLog(ctx, 'fleet-boot.log').includes('already failed — leaving it for the janitor'))
  assert.equal(engineRuns(ctx), 1, 'the engine is not re-run')
  assert.equal(gitLog(ctx).length, gitBefore, 'and nothing is re-cloned')
})

test('a run parked with nothing to publish is not restarted either  [M5/(g)]', () => {
  const ctx = makeHome()
  assert.equal(boot(ctx, ['boot'], { STUB_VERDICT: 'NEEDS_ACK', STUB_NO_COMMITS: '1' }).status, 0)
  const gitBefore = gitLog(ctx).length
  const again = boot(ctx)
  assert.equal(again.status, 0)
  assert.ok(readLog(ctx, 'fleet-boot.log').includes('already parked — leaving it for the janitor'))
  assert.equal(engineRuns(ctx), 1)
  assert.equal(gitLog(ctx).length, gitBefore)
})

test('re-entering after a finished engine re-runs neither the engine nor the PR  [M5/(g)]', () => {
  const ctx = green()
  assert.equal(engineRuns(ctx), 1)
  assert.equal(prPosts(ctx).length, 1)

  // The unit restarted after the run had finished but before the page said so:
  // the clone on disk, the engine's marker written, a PR already recorded.
  const statusFile = path.join(ctx.home, 'www', 'status.json')
  const crashed = { ...statusOf(ctx), state: 'running' }
  fs.writeFileSync(statusFile, JSON.stringify(crashed))

  const again = boot(ctx)
  assert.equal(again.status, 0, again.stdout + again.stderr)
  assert.equal(engineRuns(ctx), 1, 'the engine is not re-run')
  assert.equal(prPosts(ctx).length, 1, 'a second PR is never opened')
  assert.equal(gitLog(ctx).filter((a) => a[1] === 'clone').length, 1,
    'the existing clone is not re-cloned')
  assert.equal(gitLog(ctx).filter((a) => verbOf(a) === 'worktree').length, 1,
    'and the existing evidence worktree is reused, not added again')
  assert.equal(statusOf(ctx).state, 'done')
  assert.equal(statusOf(ctx).vm, VM_NAME, 'the VM name survives a re-entry')
  assert.equal(statusOf(ctx).pr, PR_URL, 'and so does the PR')
  assert.equal(statusOf(ctx).prAuthor, PR_AUTHOR, 'and its author')
})

test('re-entering a run that already reached done does nothing at all  [M5/(g)]', () => {
  const ctx = green()
  const before = gitLog(ctx).length
  const again = boot(ctx)
  assert.equal(again.status, 0)
  assert.equal(gitLog(ctx).length, before, 'a done run issues no further git')
  assert.equal(engineRuns(ctx), 1)
})

// The run directory is the only receipt (#673). The re-entry guard, the
// evidence copy and the verdict all read `<target>/.claude/ultrapowers/run-<runId>/`
// and nothing else; a tracked `fleet-receipts/` in the target tree is a fossil
// of the stamped-run era and must not be able to park or green a run.

test('a fleet-receipts fossil in the target tree is not read  [M2 / leg (a)]', () => {
  // The 2026-09-05 fault, reproduced: the tree carries a stale NEEDS_ACK
  // receipt under the old path, and this run's engine writes PASS into the run
  // directory. A script that still searches `fleet-receipts/` first sees the
  // fossil before the engine has run, skips the engine and parks on it.
  const ctx = makeHome()
  const fossil = path.join(ctx.home, 'target', 'fleet-receipts', 'run-7', 'gate-receipt.json')
  fs.mkdirSync(path.dirname(fossil), { recursive: true })
  fs.writeFileSync(fossil, '{"verdict":"NEEDS_ACK"}\n')

  const r = boot(ctx, ['boot'])
  assert.equal(r.status, 0, r.stdout + r.stderr)

  assert.deepEqual(states(ctx), ['booting', 'running', 'publishing', 'done'],
    'the fossil neither parks the run nor stands in for the engine')
  assert.equal(statusOf(ctx).state, 'done')
  assert.equal(engineRuns(ctx), 1, 'the engine runs exactly once — the fossil is not its receipt')

  const body = prPosts(ctx)[0].body
  assert.ok(body.includes('| verdict | `PASS` |'),
    `the card carries this run's verdict, not the fossil's:\n${body}`)
  assert.ok(!body.includes('NEEDS_ACK'), `the fossil's verdict reached the card:\n${body}`)
  assert.equal(prPosts(ctx)[0].draft, false, 'a PASS run publishes a ready PR, not a draft')
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(evidenceDir(ctx), RUN_PATH, 'gate-receipt.json'), 'utf8')).verdict,
    'PASS', 'the evidence carries the run directory receipt')

  // And the fossil is still there, byte for byte: it is ignored, not deleted.
  assert.equal(fs.readFileSync(fossil, 'utf8'), '{"verdict":"NEEDS_ACK"}\n',
    'nothing may pass this leg by removing the fossil instead of not reading it')
})

test('a gate receipt in the run directory finishes the run without the engine  [M3 / leg (b)]', () => {
  const ctx = makeHome()
  const receipt = path.join(ctx.home, 'target', '.claude', 'ultrapowers', 'run-run-7', 'gate-receipt.json')
  fs.mkdirSync(path.dirname(receipt), { recursive: true })
  fs.writeFileSync(receipt, '{"verdict":"PASS"}\n')
  assert.ok(!fs.existsSync(path.join(ctx.home, '.fleet-engine-done')),
    'no engine marker: the run directory receipt is the whole of the guard here')

  const r = boot(ctx, ['boot'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(engineRuns(ctx), 0, 'the engine is not started a second time')
  assert.ok(readLog(ctx, 'fleet-boot.log').includes('not re-running'),
    'the boot log says why the engine was skipped')
  assert.deepEqual(states(ctx), ['booting', 'publishing', 'done'],
    'the run is finished from the receipt it found')
  assert.equal(statusOf(ctx).state, 'done')
  assert.ok(prPosts(ctx)[0].body.includes('| verdict | `PASS` |'),
    'and finished FROM that receipt — its verdict is the one on the card')
})

test('the green run\'s receipt travels from the run directory, and fleet-receipts is never made  [M4 / leg (c)]', () => {
  const ctx = green()
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(evidenceDir(ctx), RUN_PATH, 'gate-receipt.json'), 'utf8')).verdict,
    'PASS', 'the memoized green run committed its gate receipt')
  assert.equal(fs.existsSync(path.join(ctx.home, 'target', 'fleet-receipts')), false,
    'no stub and no code path creates the old receipts directory')
})

test('neither the script nor the rig names fleet-receipts at all  [M1]', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const needle = 'fleet-receipts'
  for (const file of [SCRIPT, path.join(here, '_sandbox_boot_helpers.mjs')]) {
    const source = fs.readFileSync(file, 'utf8')
    assert.equal(source.split(needle).length - 1, 0,
      `${path.basename(file)} still names '${needle}' — no path under it can be read or written`)
  }
})

// ── 10. the deadman ──────────────────────────────────────────────────────────

test('the deadman parks a run stuck in running and stops the engine service', () => {
  const ctx = makeHome()
  assert.equal(boot(ctx).status, 0)
  fs.writeFileSync(path.join(ctx.home, 'www', 'status.json'),
    JSON.stringify({ ...statusOf(ctx), state: 'running', pr: null }))

  const dead = boot(ctx, ['deadman'], { STUB_ENGINE_ACTIVE: 'active' })
  assert.equal(dead.status, 0, dead.stdout + dead.stderr)
  const status = statusOf(ctx)
  assert.equal(status.state, 'parked')
  assert.match(status.error, /^deadman: /)
  assert.equal(status.run, '7')
  assert.equal(status.vm, VM_NAME)
  const notes = notifies(ctx)
  assert.equal(notes[notes.length - 1].title, 'run-7 parked')
  assert.ok(argvLines(ctx, 'systemctl').some((a) =>
    a.join(' ') === 'systemctl --user stop fleet-engine-7.service'), 'the service, not a scope')
  // The run unit (fleet-run@7.service) is this script's own process; the
  // deadman stops the engine unit and never the unit it may itself be in.
  assert.ok(!argvLines(ctx, 'systemctl').some((a) => a.some((s) => s.includes('fleet-run'))),
    'the run unit is never named — only the engine unit is stopped')
})

test('the deadman leaves a finished run alone', () => {
  const ctx = green()
  const notesBefore = notifies(ctx).length
  const dead = boot(ctx, ['deadman'])
  assert.equal(dead.status, 0)
  assert.equal(statusOf(ctx).state, 'done')
  assert.equal(notifies(ctx).length, notesBefore, 'no notification for a done run')
  assert.equal(argvLines(ctx, 'systemctl').filter((a) => a[2] === 'stop').length, 0)
})

runTests(tests)

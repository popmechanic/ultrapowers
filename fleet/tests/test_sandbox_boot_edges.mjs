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
  engineRuns, prPosts,
  verbOf, gitLog, evidenceDir, isEvidencePush, addArguments,
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

// fleet/tests/test_drive_diagnostics.mjs — sentinel-style spec for the
// drive-one driver's DIAGNOSTIC LINES (#385 items 1 and 2).
//
// #362-1 kept stderr off `stdout` at the exec seam (the #337 preflight compares
// stdout byte-for-byte) and joined it back in through `execDiagnostic` for the
// failure lines alone. Nothing pinned that join: `makeExec`
// (`_drive_helpers.mjs`) answered every stubbed command with `{ code, stdout }`
// and NO `stderr`, so each of the four `execDiagnostic` call sites could have
// been reporting an exit code and nothing else — the reason a control-plane ssh
// or a `gh pr create` actually refuses lives on stderr and nowhere else.
//
// So the fixture grew one optional knob — `makeExec(onShimStart, { stderr })`,
// a `(cmd) => string` that says what a command printed on stderr — and this
// file drives all four sites with it. The knob is OFF by default and leg (f)
// pins that: every answer `makeExec` synthesizes itself is byte-identical to
// what it was, which is what keeps every sibling sim untouched.
//
// Own process, own copy of the `_drive_helpers.mjs` fixture (see its header):
// the two older drive specs already run within reach of the suite's 120 s
// per-file cap. Four drives here, in the shape `test_drive_pr.mjs` P4/P5 use.
//
// Legs:
//   (a) a failing `stat` capture         → `sandbox stat: …` carries the stderr
//   (b) a failing sandbox-log pull       → `pull sandbox logs: …` carries it
//   (c) a failing push to origin         → carries it, token scrubbed
//   (d) a failing `gh pr create`         → carries it, token scrubbed
//   (e) an unsafe plan file NAME → refused before any command (#362, #575)
//   (f) `makeExec()` with no knob        → no `stderr` key, fixture unchanged
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { driveOne, sandboxStatCommand } from '../drive.mjs'
import { isSafeRepoPath } from '../shim-main.mjs'
import {
  GH_PR_CREATE_OK,
  GITHUB_TOKEN,
  INTEGRATION_BRANCH,
  OLDER_BRANCH,
  PR_URL,
  RECEIPT_PATH,
  setupDriveFixture,
  sh,
} from './_drive_helpers.mjs'

const {
  tmp,
  repoDir,
  originRepo,
  cleanup,
  olderSha,
  integrationSha,
  unreachableSha,
  makeExec,
  startStubSandbox,
  driveDefaults,
} = await setupDriveFixture()

try {
  // A green run on the older branch: receipt pointer resolvable, gate green,
  // so the drive reaches teardown's captures AND the publish leg.
  const greenSandbox = ({ runId, exec, branch, receiptSha, receiptPath }) => (assignment) => {
    setTimeout(() => {
      exec.sandbox = startStubSandbox({ assignment, runId, receiptSha, exec, branch, receiptPath })
    }, 30)
  }
  const onOlder = { branch: OLDER_BRANCH, receiptSha: olderSha, receiptPath: 'old.txt' }
  const onIntegration = { branch: INTEGRATION_BRANCH, receiptSha: integrationSha, receiptPath: RECEIPT_PATH }
  const drive = ({ runId, exec, overrides = {} }) =>
    driveOne({
      ...driveDefaults,
      dbDir: path.join(tmp, `db-${runId}`),
      evidenceDir: path.join(tmp, `evidence-${runId}`),
      exec,
      runId,
      ...overrides,
    })

  // The fixture's ssh stub is unconditionally green, so a REFUSED control-plane
  // command needs two halves: the exit code, which this thin wrapper supplies
  // (the `makeCaptureExec` precedent, `test_drive.mjs`), and the reason, which
  // comes from the fixture's own `stderr` knob. `stdout` is emptied because
  // that is what a refused ssh returns — which is exactly why these two lines
  // used to end at the exit code with nothing after them.
  const refusing = ({ hit, code, stderr }) => (onShimStart) => {
    const inner = makeExec(onShimStart, { stderr: (cmd) => (hit(cmd) ? stderr : '') })
    const exec = async (cmd, opts) => {
      const result = await inner(cmd, opts)
      return hit(cmd) ? { ...result, code, stdout: '' } : result
    }
    exec.cmds = inner.cmds
    exec.calls = inner.calls
    return exec
  }
  const errorLine = (detail, prefix) => detail.errors.find((e) => e.startsWith(prefix))

  // -- (a) a failing `stat` capture (drive.mjs:643, via captureJson) ---------
  {
    const runId = 'run-diag-stat'
    const STAT_CMD = sandboxStatCommand({ vmName: `fleet-${runId}` })
    const STAT_STDERR = 'ssh: connect to host exe.dev port 22: Connection timed out (fixture stderr, #385)'
    const exec = refusing({ hit: (cmd) => cmd === STAT_CMD, code: 255, stderr: STAT_STDERR })((a) =>
      greenSandbox({ runId, exec, ...onOlder })(a),
    )
    const { read, detail } = await drive({ runId, exec })
    await exec.sandbox

    assert.ok(exec.cmds.includes(STAT_CMD), `expected the stat capture, got: ${JSON.stringify(exec.cmds)}`)
    assert.equal(read.o1, true, 'a refused capture never reddens the read')
    assert.equal(detail.sandboxStat, null, 'the capture degrades to null')
    // The WHOLE line: `code 255` plus the reason, and the reason is the stderr.
    assert.equal(
      errorLine(detail, 'sandbox stat:'),
      `sandbox stat: code 255 ${STAT_STDERR}`,
      `expected the stat refusal to carry its stderr, got: ${JSON.stringify(detail.errors)}`,
    )
  }

  // -- (b) a failing sandbox-log pull (drive.mjs:685) -------------------------
  {
    const runId = 'run-diag-logs'
    const PULL_STDERR = 'tar: repo/.claude/ultrapowers: Cannot stat: No such file or directory (fixture stderr, #385)'
    const isPull = (cmd) => cmd.startsWith('ssh -o BatchMode=yes') && / tar czf - /.test(cmd)
    const exec = refusing({ hit: isPull, code: 2, stderr: PULL_STDERR })((a) => greenSandbox({ runId, exec, ...onOlder })(a))
    const { read, detail } = await drive({ runId, exec })
    await exec.sandbox

    assert.ok(exec.cmds.some(isPull), `expected the log pull, got: ${JSON.stringify(exec.cmds)}`)
    assert.equal(read.o1, true, 'a failed pull never reddens the read')
    assert.equal(detail.sandboxLogs, null, 'no archive is claimed when the pull failed')
    assert.equal(
      errorLine(detail, 'pull sandbox logs:'),
      `pull sandbox logs: code 2 ${PULL_STDERR}`,
      `expected the pull failure to carry its stderr, got: ${JSON.stringify(detail.errors)}`,
    )
  }

  // -- (c) a failing push to origin (drive.mjs:1388), token scrubbed ---------
  // The failure is REAL: origin's copy of the run branch is force-parked on an
  // unrelated commit, so the driver's `push <tip>:refs/heads/<branch>` is
  // rejected as a non-fast-forward by git itself. The knob adds the one thing
  // a fixture must supply — a remote's own chatter, carrying the token, so the
  // `scrub` on this site is exercised rather than assumed.
  {
    const runId = 'run-diag-push'
    const PUSH_STDERR = `remote: Permission to popmechanic/ultrapowers.git denied to token ${GITHUB_TOKEN} (fixture stderr, #385)`
    const seeded = await sh(`git -C "${repoDir}" push origin +${unreachableSha}:refs/heads/${OLDER_BRANCH}`)
    assert.equal(seeded.code, 0, `origin seed failed: ${seeded.stderr}`)
    const exec = makeExec((a) => greenSandbox({ runId, exec, ...onOlder })(a), {
      stderr: (cmd) => (/ push origin /.test(cmd) ? PUSH_STDERR : ''),
    })
    const { read, detail } = await drive({ runId, exec })
    await exec.sandbox

    assert.equal(read.o1, true, 'a failed push never reddens the read')
    assert.equal(detail.pullRequest, null)
    const pushErr = errorLine(detail, `push ${OLDER_BRANCH} to origin failed (code 1) `)
    assert.ok(pushErr, `expected the push failure on the record, got: ${JSON.stringify(detail.errors)}`)
    assert.ok(/non-fast-forward|rejected/.test(pushErr), `git's own reason survives: ${pushErr}`)
    assert.ok(
      pushErr.includes('Permission to popmechanic/ultrapowers.git denied to token <redacted> (fixture stderr, #385)'),
      `the remote's stderr survives, scrubbed: ${pushErr}`,
    )
    // The token appears NOWHERE in the record, and nowhere on a command line.
    assert.ok(!JSON.stringify(detail.errors).includes(GITHUB_TOKEN), 'no token substring anywhere in detail.errors')
    assert.ok(!JSON.stringify(detail).includes(GITHUB_TOKEN), 'no token substring anywhere in the detail')
    assert.ok(!exec.cmds.some((c) => c.includes(GITHUB_TOKEN)), 'the token must never appear on a command line')
    assert.ok(!exec.cmds.some((c) => / gh pr create /.test(c)), 'no PR after a failed push')
    // …and origin still carries the parked commit: nothing was force-moved.
    assert.equal((await sh(`git rev-parse refs/heads/${OLDER_BRANCH}`, originRepo)).stdout.trim(), unreachableSha)
  }

  // -- (d) a failing `gh pr create` (drive.mjs:1399), token scrubbed ---------
  {
    const runId = 'run-diag-gh'
    const GH_STDERR = `HTTP 401: Bad credentials — GH_TOKEN=${GITHUB_TOKEN} (fixture stderr, #385)`
    const exec = makeExec((a) => greenSandbox({ runId, exec, ...onIntegration })(a), {
      gh: { code: 1, stdout: '' },
      stderr: (cmd) => (/ gh pr create /.test(cmd) ? GH_STDERR : ''),
    })
    const { read, detail } = await drive({ runId, exec })
    await exec.sandbox

    assert.equal(read.o1, true, 'a failed gh never reddens the read')
    assert.equal(detail.pullRequest, null)
    // The push landed; only the PR failed. The WHOLE line, scrubbed: `gh` is
    // fully stubbed here, so its stderr is the entire reason on the record.
    assert.equal((await sh(`git rev-parse refs/heads/${INTEGRATION_BRANCH}`, originRepo)).stdout.trim(), integrationSha)
    assert.equal(
      errorLine(detail, `gh pr create for ${INTEGRATION_BRANCH} failed (code 1) `),
      `gh pr create for ${INTEGRATION_BRANCH} failed (code 1) ` +
        'HTTP 401: Bad credentials — GH_TOKEN=<redacted> (fixture stderr, #385)',
      `expected the gh refusal to carry its scrubbed stderr, got: ${JSON.stringify(detail.errors)}`,
    )
    assert.ok(!JSON.stringify(detail.errors).includes(GITHUB_TOKEN), 'no token substring anywhere in detail.errors')
    assert.ok(!JSON.stringify(detail).includes(GITHUB_TOKEN), 'no token substring anywhere in the detail')
    assert.ok(!exec.cmds.some((c) => c.includes(GITHUB_TOKEN)), 'the token must never appear on a command line')
  }

  // -- (e) the guard-miss refusal ---------------------------------------------
  // A plan whose FILE NAME fails the repo-path guard. #575 ships the plan from
  // wherever it lives and the sandbox knows it by basename alone, so the name
  // is what reaches the sandbox's launch argv — and the other reading,
  // "unreadable, so skip the fitness check with narration", would hand it to
  // the provisioner as-is. #362 decided the name problem wins; this pins that
  // it is a REFUSAL, and that it lands before the drive has run one command.
  {
    const runId = 'run-diag-guard'
    const PLAN_REL = 'docs/superpowers/plans/evil name;whoami.md'
    const PLAN_NAME = 'evil name;whoami.md'
    assert.equal(isSafeRepoPath(PLAN_NAME), false, 'precondition: the name fails the repo-path guard')
    assert.ok(!fs.existsSync(path.resolve(PLAN_REL)), 'precondition: absent from disk')

    const dbDir = path.join(tmp, `db-${runId}`)
    const exec = makeExec(() => assert.fail('no sandbox may start behind a refused plan name'))
    await assert.rejects(
      driveOne({ ...driveDefaults, planPath: PLAN_REL, dbDir, exec, runId }),
      (error) => {
        assert.equal(
          error.message,
          `driveOne: plan file name ${JSON.stringify(PLAN_NAME)} (from ${PLAN_REL}) fails the repo-path guard — ` +
            `[A-Za-z0-9._/-] only, no leading '-'; the name is pushed to the sandbox as-is and interpolated ` +
            `into its launch. Rename the plan (#362)`,
        )
        return true
      },
    )
    assert.deepEqual(exec.cmds, [], 'the refusal lands before any command')
    assert.deepEqual(exec.calls, [], 'and before any exec call at all')
    assert.ok(!fs.existsSync(dbDir), 'and before the orchestrator store exists')
  }

  // -- (f) the knob is off by default: the fixture's answers are unchanged ---
  // Scoped to the commands `makeExec` answers ITSELF — the ones that delegate to
  // a real `sh` carry whatever the real command printed, as they always have.
  {
    const plain = makeExec()
    const STAT_CMD = sandboxStatCommand({ vmName: 'fleet-run-diag-f' })
    const SANDBOX_PUSH = `git -C ${repoDir} -c core.sshCommand="ssh -o Foo=bar" push ssh://sandbox HEAD`
    const GH_CMD = `cd ${repoDir} && gh pr create --base main --head b --title t --body-file f`

    assert.deepEqual(await plain(STAT_CMD), { code: 0, stdout: '{}' })
    assert.deepEqual(await plain(SANDBOX_PUSH), { code: 0, stdout: '' })
    assert.deepEqual(await plain(GH_CMD), GH_PR_CREATE_OK)
    assert.deepEqual(await plain('rsync -a /a /b'), { code: 0, stdout: '' })
    for (const cmd of [STAT_CMD, SANDBOX_PUSH, GH_CMD, 'rsync -a /a /b']) {
      assert.ok(!('stderr' in (await plain(cmd))), `no stderr key by default: ${cmd}`)
    }

    // With the knob: the SAME answers plus a `stderr` key, and only on the
    // commands the knob claims. Nothing shared is mutated.
    const TEXT = 'ssh: Connection closed by remote host'
    const knobbed = makeExec(undefined, { stderr: (cmd) => (cmd === STAT_CMD ? TEXT : '') })
    assert.deepEqual(await knobbed(STAT_CMD), { code: 0, stdout: '{}', stderr: TEXT })
    assert.deepEqual(await knobbed(SANDBOX_PUSH), { code: 0, stdout: '' })
    assert.deepEqual(await knobbed(GH_CMD), GH_PR_CREATE_OK)
    assert.deepEqual(GH_PR_CREATE_OK, { code: 0, stdout: `${PR_URL}\n` }, 'the shared stub answer is never mutated')
  }

  console.log('ALL TESTS PASSED')
} finally {
  cleanup()
}

// fleet/tests/_drive_helpers.mjs — the shared fixture for the drive-one specs.
//
// NOT a test: the name is outside the `test_*.mjs` glob `tests/test_fleet_suite.py`
// collects, and running it directly is a no-op (pure exports). The two drive
// specs — `test_drive.mjs` (the gate read: receipt resolution, publish,
// evidence capture, the production receipt writer) and
// `test_drive_lifecycle.mjs` (driver lifecycle + refusals, shim-main helpers,
// the engine launch leg, park and version-stamp verdicts) — were one file
// until it ran within a few seconds of the suite's 120 s per-file cap; each
// now builds its own copy of this fixture in its own process.
//
// Concurrency-safe by construction: drives use `port: 0` (an ephemeral port,
// read back off `detail.effectivePort`), and every byte of state — the
// throwaway git repos, the orchestrator's sqlite dir, the gate-read report —
// lives under an `fs.mkdtemp` directory unique to the calling process. No
// shared fixtures across processes.
//
// The sandbox VM is simulated; nothing about the *verification* is. Three
// REAL git repos stand in for the ends of the transport (#575) — `repoDir` is
// the orchestrator-side ENGINE checkout, `originRepo` is the bare stand-in for
// the target's GitHub repository, `sandboxRepo` is the sandbox's target clone
// (`/home/exedev/target`; it plays the engine clone too, so both refs sit on
// one commit) — and the driver's first-use clone of the target is retargeted
// from the GitHub URL onto `originRepo`, its fetch of the run branch from the
// sandbox ssh URL onto `sandboxRepo`, and both are executed for real into the
// cache clone under `targetsDir`. So `refs/fleet/<runId>` is a real ref, and
// every receipt is resolved by a real `git cat-file -e` plus a real
// `git merge-base --is-ancestor <sha> <tip>`.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { WebSocket } from 'ws'
import { createMergeableStore } from 'tinybase'
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client'
import { runShim } from '../shim.mjs'
import { cacheDirNameFor, GH_CREDENTIAL } from '../drive.mjs'
import {
  applyBranch,
  applyReceipt,
  auxStoreId,
  applyReportedTokens,
  applyStamp,
  BASE_REF,
  ENGINE_REF,
  readStamp,
  sandboxIdFor,
} from '../shim-main.mjs'

// A frozen clock. Every claim/guard decision in the fleet is a pure function of
// it, so freezing removes all wall-clock flake from lease continuity; the
// driver's own timeouts deliberately use wall time and are unaffected.
export const T = 2_000_000
export const clock = () => T

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// The engine integrates to `ultra/integration-<stamp>` and never to a name the
// fleet chose — these are the two such branches the stand-in sandbox carries.
export const INTEGRATION_BRANCH = 'ultra/integration-20260821125904'
export const OLDER_BRANCH = 'ultra/integration-19990101000000'
// Both artifacts live in the SAME run directory — that is where `ultra_gate.py`
// writes them, and the whole point of discovery is that neither has a fixed
// path the fleet may assume.
export const RUN_DIR = '.claude/ultrapowers/run-20260821125904'
export const RECEIPT_PATH = `${RUN_DIR}/gate-receipt.json`
export const REPORT_PATH = `${RUN_DIR}/report.json`

// #368: the stand-in GitHub token and the stubbed `gh pr create` answer. The
// token is a fixture string a spec can grep every command line for — it must
// appear in NO command and in NO detail, only in the env `gh` was handed.
export const GITHUB_TOKEN = 'ghp_FIXTURE_TOKEN_0123456789abcdef'
export const PR_URL = 'https://github.com/popmechanic/ultrapowers/pull/4242'
// #575: the target every drive names, and the cache clone's directory name
// (`<owner>--<repo>`) the driver derives from it.
export const TARGET = 'octo/widgets'
export const CACHE_DIR_NAME = cacheDirNameFor(TARGET)
export const GH_PR_CREATE_OK = { code: 0, stdout: `${PR_URL}\n` }

// Real shell execution, used for the git commands the spec insists must be real.
export const sh = (cmd, cwd) =>
  new Promise((resolve) => {
    execFile('/bin/sh', ['-c', cmd], { cwd }, (error, stdout, stderr) =>
      resolve({
        code: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
        stdout: stdout ?? '',
        // Kept off `stdout` so command output stays exactly what git printed;
        // it is here only to make a failed fixture command legible.
        stderr: stderr ?? '',
      }),
    )
  })

export const writeFile = (root, rel, contents) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  fs.writeFileSync(path.join(root, rel), contents)
}

// Build the fixture: the two real repos, the shared exec stub, the stand-in
// sandbox, and the drive defaults. The caller owns `cleanup()` — call it from
// a `finally` once the scenarios are done. A fixture that fails to build
// cleans up after itself before rethrowing.
export const setupDriveFixture = async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-drive-'))
  const repoDir = path.join(tmp, 'repo')
  const sandboxRepo = path.join(tmp, 'sandbox-repo')
  const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true })
  try {
    // -- the orchestrator-side checkout: a real one-commit repo ----------------
    fs.mkdirSync(repoDir, { recursive: true })
    writeFile(repoDir, '.claude-plugin/plugin.json', JSON.stringify({ version: '9.9.9' }))
    writeFile(repoDir, 'f.txt', 'hi\n')
    const init = await sh(
      'git init -q -b main . && git config user.email t@example.com && git config user.name t && ' +
        'git add -A && git -c commit.gpgsign=false commit -q -m init',
      repoDir,
    )
    assert.equal(init.code, 0, `git init/commit failed: ${init.stderr}`)
    const headSha = (await sh('git rev-parse HEAD', repoDir)).stdout.trim()
    assert.match(headSha, /^[0-9a-f]{40}$/, 'the test fixture must produce a real 40-hex commit sha')
    // Every sandbox carries this ref: `provisionRun` pushes the driver's base to
    // it, and it is the ONLY name that identifies the code under test once the
    // engine has moved the checkout onto its own integration branch. The stand-in
    // sandboxes below stamp from it exactly as `main()` does.
    assert.equal((await sh(`git branch ${BASE_REF} main`, repoDir)).code, 0)

    // -- the stand-in sandbox repo --------------------------------------------
    // A real clone carrying two `ultra/integration-*` branches with explicit,
    // far-apart committer dates, so `--sort=-committerdate` has an unambiguous
    // winner. The newest one carries the machine-written gate receipt the engine
    // leaves behind.
    const cloned = await sh(`git clone -q "${repoDir}" "${sandboxRepo}"`, tmp)
    assert.equal(cloned.code, 0, `git clone failed: ${cloned.stderr}`)
    await sh('git config user.email t@example.com && git config user.name t', sandboxRepo)
    // The pushed base, as the provisioner leaves it. It stays put for the whole
    // run while HEAD moves twice (base checkout, then the engine's integration
    // branch), which is precisely why the stamp is read from it and not from HEAD.
    assert.equal((await sh(`git branch ${BASE_REF} main`, sandboxRepo)).code, 0)
    // The engine ref, at the SAME commit. Live, this ref lives in a second
    // directory — the golden's baked engine clone — and the base lives in the
    // target. This one stand-in repo plays both, so the two refs are pinned to
    // one commit and the stamp `main()` reads from `ENGINE_REF` is still the
    // fixture checkout's own sha and manifest, which is what the drive's
    // `versionStamp` check compares against.
    assert.equal((await sh(`git branch ${ENGINE_REF} main`, sandboxRepo)).code, 0)

    await sh(`git checkout -q -b ${OLDER_BRANCH}`, sandboxRepo)
    writeFile(sandboxRepo, 'old.txt', 'old\n')
    const older = await sh(
      "git add -A && GIT_COMMITTER_DATE='2020-01-01T00:00:00Z' git -c commit.gpgsign=false commit -q -m older",
      sandboxRepo,
    )
    assert.equal(older.code, 0, `older-branch commit failed: ${older.stderr}`)
    const olderSha = (await sh('git rev-parse HEAD', sandboxRepo)).stdout.trim()

    await sh(`git checkout -q main && git checkout -q -b ${INTEGRATION_BRANCH}`, sandboxRepo)
    writeFile(sandboxRepo, RECEIPT_PATH, JSON.stringify({ verdict: 'PASS', gate: 'ultra_gate' }))
    const integrated = await sh(
      "git add -A && GIT_COMMITTER_DATE='2030-01-01T00:00:00Z' git -c commit.gpgsign=false commit -q -m integration",
      sandboxRepo,
    )
    assert.equal(integrated.code, 0, `integration commit failed: ${integrated.stderr}`)
    const integrationSha = (await sh('git rev-parse HEAD', sandboxRepo)).stdout.trim()
    assert.notEqual(integrationSha, olderSha)

    // The engine's run report — in the run directory beside the gate receipt.
    // Receipt discovery must still not pick it up: it is scoped to the receipt's
    // FILE NAME, not merely to the directory.
    writeFile(sandboxRepo, REPORT_PATH, JSON.stringify({ usage: { outputTokens: 4200 } }))

    // -- the GitHub stand-in (#368) --------------------------------------------
    // A bare repo plays `origin`: the driver's publish leg pushes the fetched
    // tip to it FOR REAL (`git push origin <sha>:refs/heads/<branch>`), so a
    // spec can read the pushed ref back and prove it is byte-for-byte the tip
    // the sandbox integrated — never a rebase. `gh pr create` itself is stubbed
    // (below); the token file stands in for /home/exedev/.fleet/github-token.
    const originRepo = path.join(tmp, 'origin.git')
    // `symbolic-ref HEAD` is not decoration (#579): the bare is initialised
    // under whatever `init.defaultBranch` the ambient config says, so under
    // git's own default its HEAD names `master` — a branch this fixture never
    // creates, because it pushes `main:main`. A clone cut from a bare whose
    // HEAD dangles gets NO `refs/remotes/origin/HEAD`, and the drive's
    // default-branch check would then refuse every base with code 128. Naming
    // `main` explicitly makes the bare's default branch the one it actually
    // holds, whatever the ambient config says.
    const originInit = await sh(
      `git init -q --bare "${originRepo}" && git -C "${originRepo}" symbolic-ref HEAD refs/heads/main && ` +
        `git -C "${repoDir}" remote add origin "${originRepo}"`,
      tmp,
    )
    assert.equal(originInit.code, 0, `origin fixture failed: ${originInit.stderr}`)
    // #575: origin really HOLDS the base. The driver's preflight asks the
    // target's cache clone `cat-file -e <baseSha>^{commit}` after a `fetch
    // origin`, and refuses a base origin does not carry — so `main` is pushed
    // there, and the dangling `unreachableSha` below deliberately is not.
    const seeded = await sh(`git -C "${repoDir}" push -q origin main:main`, tmp)
    assert.equal(seeded.code, 0, `origin seed failed: ${seeded.stderr}`)
    const githubTokenPath = path.join(tmp, 'github-token')
    fs.writeFileSync(githubTokenPath, `${GITHUB_TOKEN}\n`, { mode: 0o600 })
    // #575: where the driver keeps the target's cache clone. Created lazily by
    // the first drive in this process (the clone command below is retargeted
    // onto `originRepo`); every later drive `fetch origin`s it.
    const targetsDir = path.join(tmp, 'targets')
    const cacheDir = path.join(targetsDir, CACHE_DIR_NAME)

    // -- a sha that EXISTS locally but is reachable from no fetched branch -----
    // Built with `commit-tree` so it never touches a working tree: `cat-file -e`
    // will find it, `merge-base --is-ancestor` against FETCH_HEAD will not.
    const dangling = await sh("git commit-tree 'HEAD^{tree}' -p HEAD -m unreachable", repoDir)
    const unreachableSha = dangling.stdout.trim()
    assert.match(unreachableSha, /^[0-9a-f]{40}$/, `commit-tree failed: ${dangling.stderr}`)
    await sh(`git branch fleet-unreachable ${unreachableSha}`, repoDir)

    // -- shared exec stub ------------------------------------------------------
    // ssh never happens, and the two sandbox-bound `git push`es (engine and
    // target, #575) and the sandbox's `git init` would need it, so those legs
    // are stubbed green. The target's first-use CLONE is real — retargeted
    // from `https://github.com/<target>.git` onto the bare `originRepo` — and
    // so is the FETCH of the run branch, retargeted from the sandbox's ssh URL
    // onto the stand-in sandbox repo on disk with its `<branch>:refs/fleet/<runId>`
    // refspec intact — which is what makes `refs/fleet/<runId>` a real ref
    // and reachability a real answer. The GitHub-bound `push origin` (#368)
    // is real too, from the cache clone into `originRepo`. `gh pr create` is stubbed: it answers with a PR URL
    // (or whatever `gh` is overridden to), and the env the driver handed it is
    // recorded in `exec.calls` so a spec can prove the token rode the env and
    // never the command line. Every other git command runs for real.
    // #385-1: `stderr` is an OPTIONAL knob — `(cmd) => string`, the text that
    // command printed on stderr, empty for the ones that print nothing. The
    // driver's four diagnostic lines join stdout and stderr through
    // `execDiagnostic`, and no stubbed answer here has ever carried a stderr,
    // so those lines were pinned by nothing: a refused ssh or `gh` reports its
    // reason on stderr and nowhere else. Absent — every existing call — the
    // decoration is a no-op and every answer below stays byte-identical.
    const makeExec = (onShimStart, { gh = GH_PR_CREATE_OK, stderr = null } = {}) => {
      const cmds = []
      const calls = []
      const withStderr = (cmd, result) => {
        const text = stderr ? stderr(cmd) : ''
        // Appended, never replaced: a command answered by the real `sh` keeps
        // what it actually printed, and nothing is mutated in place — `gh` is
        // handed a shared object.
        return text ? { ...result, stderr: `${result?.stderr ?? ''}${text}` } : result
      }
      const dispatch = async (cmd, opts) => {
        if (cmd.startsWith('ssh ')) {
          const payload = cmd.match(/<<'FLEET_EOF'\n([\s\S]*?)\nFLEET_EOF/)
          if (payload) exec.delivered = JSON.parse(payload[1])
          if (/nohup node .*shim-main\.mjs/.test(cmd)) onShimStart(exec.delivered)
          return { code: 0, stdout: '{}' }
        }
        if (/^git -C \S+ -c core\.sshCommand="[^"]*" push /.test(cmd)) return { code: 0, stdout: '' }
        const fetched = cmd.match(/^git -C (\S+) -c core\.sshCommand="[^"]*" fetch ssh:\/\/\S+ (\S+)$/)
        if (fetched) return sh(`git -C "${fetched[1]}" fetch "${sandboxRepo}" ${fetched[2]}`)
        // #575: the first-use cache clone — `https://github.com/<target>.git`
        // stands for `originRepo`, whatever the target was spelled as.
        const clonePrefix = `git ${GH_CREDENTIAL} clone https://github.com/`
        if (cmd.startsWith(clonePrefix)) {
          const dest = cmd.slice(clonePrefix.length).match(/^\S+\.git (\S+)$/)
          if (dest) return sh(`git clone -q "${originRepo}" "${dest[1]}"`)
        }
        // …and the credentialed reuse fetch is real too (the cache's origin IS `originRepo`).
        if (cmd.startsWith(`git -C `) && cmd.includes(` ${GH_CREDENTIAL} fetch origin`)) return sh(cmd)
        if (/ gh pr create /.test(cmd)) return typeof gh === 'function' ? gh(cmd, opts) : gh
        if (cmd.startsWith('git ')) return sh(cmd)
        return { code: 0, stdout: '' }
      }
      const exec = async (cmd, opts) => {
        cmds.push(cmd)
        calls.push({ cmd, env: opts?.env ?? null })
        return withStderr(cmd, await dispatch(cmd, opts))
      }
      exec.cmds = cmds
      exec.calls = calls
      exec.delivered = null
      return exec
    }

    // A hand-rolled stand-in sandbox, used only where the sandbox must publish
    // something production code would never write: a sha that does not exist, a
    // sha on no fetched branch, a path absent from the tree, a branch cell full of
    // shell metacharacters, or nothing at all. It is a real `runShim` against the
    // driver's own orchestrator, over the real ws transport, holding a real claim,
    // using shim-main's own store writers.
    //
    // `rawBranch` bypasses `applyBranch` deliberately: a hostile sandbox writes
    // the cell directly, so validating only on the write side would leave the
    // orchestrator's shell exposed. `publish: false` writes neither branch nor
    // receipt — the run resolves and publishes nothing.
    const startStubSandbox = ({
      assignment,
      runId,
      receiptSha,
      exec,
      branch = INTEGRATION_BRANCH,
      receiptPath = 'gate-receipt.json',
      rawBranch = null,
      publish = true,
      // #318: a parked run publishes exactly as a green one does — the verdict
      // is the only difference. `false` drives the park path.
      gateGreen = true,
      // Test scaffolding overrides (additive): default to the shared frozen
      // `clock` and the current happy-path `invokeRun` behavior. A test that
      // needs to advance time (lease-expiry legibility, #279) supplies its own
      // mutable clock here and passes the SAME clock to `driveOne`.
      clock: stubClock = clock,
      invokeRun: invokeRunOverride = null,
      // #282/#190: the stamp the sandbox publishes. Defaults to the honest
      // `readStamp` answer; a scenario that must model a sandbox running code
      // OTHER than the pushed base (a stale golden) supplies a wrong one here.
      stamp: stampOverride = null,
    }) => {
      const sandboxId = sandboxIdFor(runId)
      return (async () => {
        // Distinct store id — see shim-main's `auxStoreId`: two live
        // MergeableStores sharing an id mint colliding HLCs and lose writes.
        const store = createMergeableStore(auxStoreId(sandboxId))
        const socket = new WebSocket(`${assignment.wsUrl}?token=${assignment.token}`)
        const synchronizer = await createWsSynchronizer(store, socket)
        await synchronizer.startSync()

        const stamp = { ...(stampOverride ?? (await readStamp({ repoDir, exec }))) }
        // Stamped before the run so a crashed run still carries its identity, and
        // again after, because `runShim`'s status `setRow` replaces the whole row
        // and can drop cells it has not yet synced.
        applyStamp(store, runId, stamp)

        const invokeRun =
          invokeRunOverride ??
          (async () => {
            if (publish) applyReceipt(store, runId, 'gate', { sha: receiptSha, path: receiptPath, verdict: 'PASS' })
            // A real run takes minutes; this one must at least take a tick. The
            // shim's teardown does not await its synchronizer, so a run that
            // resolves inside the same tick it started leaves `running`,
            // `gate-green` and the spend row un-flushed and they never reach the
            // orchestrator at all. Sleeping here keeps the harness faithful to
            // the timescale the shim is actually written against.
            await sleep(250)
            return { gateGreen }
          })

        const outcome = await runShim({
          wsUrl: assignment.wsUrl,
          token: assignment.token,
          sandboxId,
          runId,
          ttlMs: assignment.ttlMs,
          clock: stubClock,
          invokeRun,
          readReportTokens: () => 4200,
        })

        // Published AFTER the run, exactly as `main()` does: `runShim`'s status
        // writes replace the whole row from their own synced view.
        applyStamp(store, runId, stamp)
        applyReportedTokens(store, runId, 4200)
        if (rawBranch !== null) store.setCell('runs', runId, 'branch', rawBranch)
        else if (publish) applyBranch(store, runId, branch)
        await synchronizer.save()
        await synchronizer.stopSync()
        await synchronizer.destroy()
        return outcome
      })()
    }

    const driveDefaults = {
      planPath: 'docs/superpowers/plans/example.md',
      golden: 'fleet-golden',
      port: 0,
      // #575: the two a launch names — the target (its cache clone is cut
      // from `originRepo`) and the base, which is the fixture's one commit —
      // and the engine checkout every drive runs out of.
      target: TARGET,
      baseSha: headSha,
      repoDir,
      targetsDir,
      clock,
      ttlMs: 60_000,
      tickMs: 25,
      settleMs: 150,
      heartbeatTimeoutMs: 20_000,
      publishPollMs: 50,
      publishTimeoutMs: 8_000,
      // #318: the parked publish wait applies to every parked scenario below.
      // Keep it short — the file runs against a 120 s cap.
      parkedPublishWaitMs: 500,
      // #368: the publish leg reads the token here — the fixture file, never
      // the orchestrator's real path.
      githubTokenPath,
    }

    return {
      tmp,
      repoDir,
      sandboxRepo,
      originRepo,
      targetsDir,
      cacheDir,
      githubTokenPath,
      cleanup,
      headSha,
      olderSha,
      integrationSha,
      unreachableSha,
      makeExec,
      startStubSandbox,
      driveDefaults,
    }
  } catch (error) {
    cleanup()
    throw error
  }
}

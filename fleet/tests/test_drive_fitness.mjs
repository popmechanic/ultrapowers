// fleet/tests/test_drive_fitness.mjs — sentinel-style spec for the W1
// drive-one driver: the FITNESS PREFLIGHT (#322, #362) on a plan that is a
// RUN ARTIFACT (#544, #575).
//
// The plan the sandbox executes is the working-tree FILE at `planPath` — any
// readable file, in a checkout or nowhere near one — shipped in the run
// assignment. Nothing reads it out of git: the engine checkout is not the
// target, and the target's cache clone carries no plan. The 13-series pins
// the source and every way it can go wrong: an unfit plan (13a) and its
// operator override (13b), the clean control (13d), a plan whose FILE NAME
// fails the interpolation guard (13f), and a plan that is not there at all
// (13g). The #337 divergences (uncommitted, dirty) died with the `git show`
// that detected them — there is no second copy of the plan for the shipped
// text to diverge from.
//
// Split off from `test_drive.mjs` the way `test_drive_lifecycle.mjs` was
// (#460): the suite schedules whole FILES, so its wall clock is the longest
// file's runtime. Receipt resolution stays in `test_drive.mjs`; evidence
// capture and the publish leg are in `test_drive_evidence.mjs`. The fixture —
// three real git repos, the shared exec stub, the stand-in sandbox — is
// `_drive_helpers.mjs`. Every plan here lives under `<tmp>/plans/`, outside
// every fixture repo, so the engine checkout stays clean (#575's one new
// refusal) and no block is order-dependent on another.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { driveOne } from '../drive.mjs'
import { OLDER_BRANCH, setupDriveFixture, sh } from './_drive_helpers.mjs'

const {
  tmp,
  repoDir,
  cleanup,
  olderSha,
  makeExec,
  startStubSandbox,
  driveDefaults,
} = await setupDriveFixture()

try {
  const plansDir = path.join(tmp, 'plans')
  fs.mkdirSync(plansDir, { recursive: true })
  const UNFIT_PLAN =
    '# P\n\n### Task 1: Docs only\n**Type:** implementation\n**Depends-on:** none\n\n**Files:**\n- Modify: `docs/a.md`\n\n- [ ] **Step 1: edit**\n'
  const FIT_PLAN =
    '# P\n\n### Task 1: Code\n**Type:** implementation\n**Depends-on:** none\n\n**Files:**\n- Modify: `fleet/x.mjs`\n- Test: `fleet/tests/test_x.mjs`\n\n- [ ] **Step 1: edit**\n'
  const unfitFile = path.join(plansDir, 'unfit.md')
  const fitFile = path.join(plansDir, 'fit.md')
  fs.writeFileSync(unfitFile, UNFIT_PLAN)
  fs.writeFileSync(fitFile, FIT_PLAN)
  const neverProvision = async () => {
    throw new Error('must never provision on a fitness refusal')
  }

  // 13a. an UNFIT plan file is refused — before provisioning, before the
  //      orchestrator, before any teardown capture.
  {
    let provisioned = false
    await assert.rejects(
      driveOne({
        ...driveDefaults,
        planPath: unfitFile,
        dbDir: path.join(tmp, 'db-13a'),
        exec: makeExec(() => {}),
        runId: 'run-drive-unfit-file',
        provision: async () => {
          provisioned = true
          return neverProvision()
        },
      }),
      /headless-unfit/,
    )
    assert.equal(provisioned, false, 'the refusal must precede provisioning')
    // #362-6: the refusal precedes the orchestrator start AND teardown — no
    // store dir, no evidence dir (scenario 18 in test_drive_lifecycle.mjs is
    // the pattern). Pinned so a later reordering of the preflight is caught.
    assert.equal(fs.existsSync(path.join(tmp, 'db-13a')), false, 'refusal must precede the orchestrator start — no store dir may exist')
    assert.equal(fs.existsSync(path.join(tmp, 'db-13a-evidence')), false, 'refusal must precede teardown captures — no evidence dir may exist')
  }

  // 13b. allowUnfitPlan proceeds, with the override on the record, and the
  //      UNFIT text is what ships — the override changes the verdict, never
  //      the plan.
  {
    const runId = 'run-drive-unfit-override'
    let seen = null
    const exec = makeExec(() => {})
    const { detail } = await driveOne({
      ...driveDefaults,
      planPath: unfitFile,
      allowUnfitPlan: true,
      dbDir: path.join(tmp, 'db-13b'),
      exec,
      runId,
      provision: async (options) => {
        seen = options
        throw new Error('sentinel-13b')
      },
    })
    assert.ok(seen, 'the override drives as far as provisioning')
    assert.deepEqual(seen.plan, { text: UNFIT_PLAN, verdicts: null })
    assert.equal(seen.planPath, 'unfit.md', 'the sandbox knows the plan by its basename')
    assert.ok(
      detail.errors.some((e) => /headless-fitness: proceeding on operator override/.test(e)),
      `the override is on the record, got: ${JSON.stringify(detail.errors)}`,
    )
  }

  // 13d. control: a FIT plan file drives normally — no refusal, no override
  //      line, the stamp cross-check against the engine checkout resolves, and
  //      no command ever reads a plan out of git.
  {
    const runId = 'run-drive-fit-file'
    let sandbox = null
    const exec = makeExec((assignment) => {
      setTimeout(() => {
        sandbox = startStubSandbox({
          assignment,
          runId,
          receiptSha: olderSha,
          exec,
          branch: OLDER_BRANCH,
          receiptPath: 'old.txt',
        })
      }, 30)
    })
    const { read, detail } = await driveOne({
      ...driveDefaults,
      planPath: fitFile,
      dbDir: path.join(tmp, 'db-13d'),
      exec,
      runId,
    })
    await sandbox
    assert.equal(read.o1, true, 'a fit plan file drives normally')
    assert.equal(read.versionStamp, true, 'the stamp expectation resolved from the engine checkout')
    assert.ok(
      !detail.errors.some((e) => /headless|#337/.test(e)),
      `no fitness noise on the clean path, got: ${JSON.stringify(detail.errors)}`,
    )
    assert.deepEqual(exec.delivered.plan, { text: FIT_PLAN, verdicts: null }, 'the file\'s bytes are what ships')
    assert.equal(exec.delivered.planPath, 'fit.md')
    assert.ok(
      !exec.cmds.some((c) => / show \S+:\S*\.md/.test(c)),
      `no command reads a plan out of git (#575 M6), got: ${JSON.stringify(exec.cmds.filter((c) => / show /.test(c)))}`,
    )
    // …and the sibling gate verdicts ride along when there are some.
    fs.writeFileSync(path.join(plansDir, 'fit.gate-verdicts.json'), '{"tasks":{}}')
    let seen = null
    await driveOne({
      ...driveDefaults,
      planPath: fitFile,
      dbDir: path.join(tmp, 'db-13d-verdicts'),
      exec: makeExec(() => {}),
      runId: 'run-drive-fit-verdicts',
      provision: async (options) => {
        seen = options
        throw new Error('sentinel-13d')
      },
    })
    assert.deepEqual(seen.plan, { text: FIT_PLAN, verdicts: '{"tasks":{}}' })
    fs.rmSync(path.join(plansDir, 'fit.gate-verdicts.json'))
  }

  // -- 13f. #362-2: a plan whose FILE NAME fails the interpolation guard is
  //        refused AS a name problem — before any exec call, before the
  //        orchestrator. The directory it sits in is irrelevant: the basename
  //        is all the sandbox ever sees.
  {
    const unsafeFile = path.join(plansDir, 'plan with space.md')
    fs.writeFileSync(unsafeFile, FIT_PLAN)
    const cmds = []
    const exec = async (cmd) => {
      cmds.push(cmd)
      return { code: 0, stdout: '' }
    }
    await assert.rejects(
      driveOne({
        ...driveDefaults,
        planPath: unsafeFile,
        dbDir: path.join(tmp, 'db-362f-space'),
        exec,
        runId: 'run-drive-362-space',
        provision: neverProvision,
      }),
      (error) => {
        assert.match(error.message, /fails the repo-path guard/, error.message)
        assert.match(error.message, /#362/, error.message)
        assert.ok(error.message.includes('"plan with space.md"'), `names the file name, got: ${error.message}`)
        return true
      },
    )
    assert.equal(cmds.length, 0, `refusal must precede every exec call, got: ${JSON.stringify(cmds)}`)
    assert.equal(fs.existsSync(path.join(tmp, 'db-362f-space')), false, 'refusal must precede the orchestrator start — no store dir may exist')
    fs.rmSync(unsafeFile)
  }

  // -- 13g. #362-3: a plan that is not there skips the fitness check with
  //        exactly this narration — the branch every scenario driving
  //        `driveDefaults.planPath` reaches implicitly, pinned by its text.
  {
    const absentRel = 'docs/superpowers/plans/example.md'
    assert.equal(driveDefaults.planPath, absentRel, 'precondition: this IS the default every other scenario drives')
    assert.equal(fs.existsSync(path.resolve(absentRel)), false, 'precondition: absent from disk')
    const lines = []
    let seen = null
    const { read, detail } = await driveOne({
      ...driveDefaults,
      dbDir: path.join(tmp, 'db-362g'),
      exec: makeExec(() => {}),
      runId: 'run-drive-362-skip',
      progressLog: (line) => lines.push(line),
      // Stop the drive right after the preflight — the narration is what is
      // under test, not a run.
      provision: async (options) => {
        seen = options
        throw new Error('sentinel-362-skip')
      },
    })
    assert.equal(read.o1, false)
    assert.ok(
      detail.errors.some((e) => e === 'drive: sentinel-362-skip'),
      `the aborted provision is on the record, got: ${JSON.stringify(detail.errors)}`,
    )
    const expected = `plan unreadable at ${path.resolve(absentRel)} — nothing to ship, fitness check skipped`
    assert.ok(
      lines.includes(expected),
      `expected the skip narration verbatim, got: ${JSON.stringify(lines.filter((l) => /plan/.test(l)))}`,
    )
    assert.ok(
      !detail.errors.some((e) => /headless|#337/.test(e)),
      `a skipped check is narration only, never an errors line, got: ${JSON.stringify(detail.errors)}`,
    )
    assert.equal('plan' in seen, false, 'nothing ships for a plan that is not there')
    assert.equal(seen.planPath, 'example.md', 'the sandbox still learns the name it was dispatched under')
  }

  // The engine checkout was never written to: every plan lived outside it.
  assert.equal((await sh('git status --porcelain', repoDir)).stdout.trim(), '', 'the 13-series leaves the engine checkout clean')

  console.log('ALL TESTS PASSED')
} finally {
  cleanup()
}

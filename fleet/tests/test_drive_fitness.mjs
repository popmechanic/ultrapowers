// fleet/tests/test_drive_fitness.mjs — sentinel-style spec for the W1
// drive-one driver: the FITNESS PREFLIGHT (#337, #362).
//
// The plan the sandbox executes is the one the driver PUSHES (baseRef), never
// the driver's working tree. The 13-series pins that source and every way the
// two sides can diverge: an unfit plan committed at baseRef with no
// working-tree copy at all (13a), a working-tree copy that differs (13b), a
// plan uncommitted at baseRef (13c), the clean control (13d), a plan path that
// fails the interpolation guard (13f), a plan absent from BOTH sides (13g),
// and stderr chatter on `git show` (13e).
//
// Split off from `test_drive.mjs` the way `test_drive_lifecycle.mjs` was
// (#460): the suite schedules whole FILES, so its wall clock is the longest
// file's runtime, and `test_drive.mjs` had grown back to 46.8 s of a 73 s
// wall. Receipt resolution stays in `test_drive.mjs`; evidence capture and the
// publish leg are in `test_drive_evidence.mjs`. The fixture — two real git
// repos, the shared exec stub, the stand-in sandbox — is `_drive_helpers.mjs`.
//
// 13d's invariant binds every block in this file, not just 13d: a block that
// mints a `plan-*` side branch or a `docs/` dir inside `repoDir` removes both
// before it returns, so nothing here is order-dependent on anything else.
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
  // -- 13. #337: the fitness preflight reads the plan AS COMMITTED AT baseRef --
  // The sandbox executes the plan the driver PUSHES (baseRef), never the
  // driver's working tree. These four scenarios pin the source and the two
  // divergences that are refused as operator errors. Plans are committed onto
  // side branches through a temporary index — HEAD, the working tree and the
  // fixture shas every other scenario relies on are untouched.
  const commitPlanOnBranch = async ({ branch, relPath, text }) => {
    const tag = branch.replace(/[^A-Za-z0-9]/g, '_')
    const idx = path.join(tmp, `${tag}.idx`)
    const blobFile = path.join(tmp, `${tag}.blob`)
    fs.writeFileSync(blobFile, text)
    const r = await sh(
      `set -e; blob=$(git hash-object -w "${blobFile}"); ` +
        `GIT_INDEX_FILE="${idx}" git read-tree main; ` +
        `GIT_INDEX_FILE="${idx}" git update-index --add --cacheinfo 100644,$blob,${relPath}; ` +
        `tree=$(GIT_INDEX_FILE="${idx}" git write-tree); ` +
        `commit=$(git commit-tree $tree -p main -m ${branch}); ` +
        `git branch ${branch} $commit; printf '%s' $commit`,
      repoDir,
    )
    assert.equal(r.code, 0, `commitPlanOnBranch(${branch}) failed: ${r.stderr}`)
    const sha = r.stdout.trim()
    assert.match(sha, /^[0-9a-f]{40}$/)
    return sha
  }
  const UNFIT_PLAN =
    '# P\n\n### Task 1: Docs only\n**Type:** implementation\n**Depends-on:** none\n\n**Files:**\n- Modify: `docs/a.md`\n\n- [ ] **Step 1: edit**\n'
  const FIT_PLAN =
    '# P\n\n### Task 1: Code\n**Type:** implementation\n**Depends-on:** none\n\n**Files:**\n- Modify: `fleet/x.mjs`\n- Test: `fleet/tests/test_x.mjs`\n\n- [ ] **Step 1: edit**\n'
  const unfitRel = 'docs/committed-unfit.md'
  const fitRel = 'docs/committed-fit.md'
  await commitPlanOnBranch({ branch: 'plan-unfit', relPath: unfitRel, text: UNFIT_PLAN })
  const fitSha = await commitPlanOnBranch({ branch: 'plan-fit', relPath: fitRel, text: FIT_PLAN })
  const neverProvision = async () => {
    throw new Error('must never provision on a #337 refusal')
  }

  // 13a. the silent-pass direction: an UNFIT plan committed at baseRef with NO
  //      working-tree copy at all is refused — the source is baseRef, not disk.
  {
    assert.equal(fs.existsSync(path.join(repoDir, unfitRel)), false, 'precondition: absent from the working tree')
    let provisioned = false
    await assert.rejects(
      driveOne({
        ...driveDefaults,
        planPath: unfitRel,
        baseRef: 'plan-unfit',
        dbDir: path.join(tmp, 'db-337a'),
        exec: makeExec(() => {}),
        runId: 'run-drive-337-committed-unfit',
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
    assert.equal(fs.existsSync(path.join(tmp, 'db-337a')), false, 'refusal must precede the orchestrator start — no store dir may exist')
    assert.equal(fs.existsSync(path.join(tmp, 'db-337a-evidence')), false, 'refusal must precede teardown captures — no evidence dir may exist')
  }

  // 13b. the dirty direction: a FIT plan at baseRef whose working-tree copy
  //      differs is refused, naming both sides — and allowUnfitPlan does NOT
  //      cover it (it is an operator error, not a fitness verdict).
  {
    fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true })
    fs.writeFileSync(path.join(repoDir, fitRel), UNFIT_PLAN)
    let provisioned = false
    await assert.rejects(
      driveOne({
        ...driveDefaults,
        planPath: fitRel,
        baseRef: 'plan-fit',
        allowUnfitPlan: true,
        dbDir: path.join(tmp, 'db-337b'),
        exec: makeExec(() => {}),
        runId: 'run-drive-337-dirty',
        provision: async () => {
          provisioned = true
          return neverProvision()
        },
      }),
      (error) => {
        assert.match(error.message, /differs between plan-fit:docs\/committed-fit\.md/)
        assert.ok(error.message.includes(path.join(repoDir, fitRel)), `must name the working-tree path, got: ${error.message}`)
        assert.match(error.message, /#337/)
        return true
      },
    )
    assert.equal(provisioned, false, 'the refusal must precede provisioning')
    // #362-6: the refusal precedes the orchestrator start AND teardown — no
    // store dir, no evidence dir (scenario 18 in test_drive_lifecycle.mjs is
    // the pattern). Pinned so a later reordering of the preflight is caught.
    assert.equal(fs.existsSync(path.join(tmp, 'db-337b')), false, 'refusal must precede the orchestrator start — no store dir may exist')
    assert.equal(fs.existsSync(path.join(tmp, 'db-337b-evidence')), false, 'refusal must precede teardown captures — no evidence dir may exist')
    // #362-5, block-local: this block minted `docs/`, so this block removes it.
    fs.rmSync(path.join(repoDir, 'docs'), { recursive: true, force: true })
  }

  // 13c. the uncommitted direction: a plan in the working tree but ABSENT at
  //      baseRef (HEAD here — main never carried it) is refused: the sandbox
  //      would receive nothing.
  {
    fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true })
    fs.writeFileSync(path.join(repoDir, fitRel), UNFIT_PLAN)
    let provisioned = false
    await assert.rejects(
      driveOne({
        ...driveDefaults,
        planPath: fitRel,
        allowUnfitPlan: true,
        dbDir: path.join(tmp, 'db-337c'),
        exec: makeExec(() => {}),
        runId: 'run-drive-337-uncommitted',
        provision: async () => {
          provisioned = true
          return neverProvision()
        },
      }),
      /not committed at HEAD/,
    )
    assert.equal(provisioned, false, 'the refusal must precede provisioning')
    // #362-6: the refusal precedes the orchestrator start AND teardown — no
    // store dir, no evidence dir (scenario 18 in test_drive_lifecycle.mjs is
    // the pattern). Pinned so a later reordering of the preflight is caught.
    assert.equal(fs.existsSync(path.join(tmp, 'db-337c')), false, 'refusal must precede the orchestrator start — no store dir may exist')
    assert.equal(fs.existsSync(path.join(tmp, 'db-337c-evidence')), false, 'refusal must precede teardown captures — no evidence dir may exist')
    // #362-5, block-local: this block minted `docs/`, so this block removes it.
    fs.rmSync(path.join(repoDir, 'docs'), { recursive: true, force: true })
  }

  // 13d. control: a FIT plan at baseRef with an IDENTICAL working-tree copy
  //      drives normally — no refusal, no override line, stamp cross-check
  //      against the side branch resolves.
  {
    fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true })
    fs.writeFileSync(path.join(repoDir, fitRel), FIT_PLAN)
    const runId = 'run-drive-337-clean'
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
          stamp: { pluginVersion: '9.9.9', engineSha: fitSha },
        })
      }, 30)
    })
    const { read, detail } = await driveOne({
      ...driveDefaults,
      planPath: fitRel,
      baseRef: 'plan-fit',
      dbDir: path.join(tmp, 'db-337d'),
      exec,
      runId,
    })
    await sandbox
    assert.equal(read.o1, true, 'a clean committed plan drives normally')
    assert.equal(read.versionStamp, true, 'the stamp expectation resolved from the side branch')
    assert.ok(
      !detail.errors.some((e) => /headless|#337/.test(e)),
      `no fitness or #337 noise on the clean path, got: ${JSON.stringify(detail.errors)}`,
    )
    assert.ok(
      exec.cmds.some((cmd) => cmd === `git -C ${repoDir} show plan-fit:${fitRel}`),
      `the plan must have been read from baseRef, got: ${JSON.stringify(exec.cmds.filter((c) => c.includes(' show ')))}`,
    )
    // Leave the fixture as found for whatever scenario is unioned after this.
    fs.rmSync(path.join(repoDir, fitRel))
    // #362-5: and the side branches + the `docs/` dir this block minted — a
    // later scenario enumerating `refs/heads/*` or asserting a clean tree must
    // not be order-dependent on these blocks. Every block in this file mints
    // and removes its own `docs/`; only this one uses plan-fit/plan-unfit.
    assert.equal((await sh('git branch -D plan-fit plan-unfit', repoDir)).code, 0, 'the 13-series side branches are deleted')
    fs.rmSync(path.join(repoDir, 'docs'), { recursive: true, force: true })
    assert.equal(fs.existsSync(path.join(repoDir, 'docs')), false, 'the 13-series leaves no docs/ dir in repoDir')
    assert.equal((await sh('git branch --list "plan-*"', repoDir)).stdout.trim(), '', 'the 13-series leaves no plan-* branch')
  }

  // -- 13f. #362-2: a plan path that fails the interpolation guard is refused
  //        AS a path problem — before any exec call, before the orchestrator —
  //        never as "not committed at baseRef" (which it may well be).
  {
    const unsafeRel = 'docs/plan with space.md'
    fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true })
    fs.writeFileSync(path.join(repoDir, unsafeRel), FIT_PLAN)
    const outside = path.join(tmp, 'outside-362.md')
    fs.writeFileSync(outside, FIT_PLAN)
    for (const [label, planPath, dbName] of [
      ['a space in the path', unsafeRel, 'db-362f-space'],
      ['an absolute path outside repoDir', outside, 'db-362f-outside'],
    ]) {
      const cmds = []
      const exec = async (cmd) => {
        cmds.push(cmd)
        return { code: 0, stdout: '' }
      }
      await assert.rejects(
        driveOne({
          ...driveDefaults,
          planPath,
          dbDir: path.join(tmp, dbName),
          exec,
          runId: `run-drive-362-${dbName}`,
          provision: neverProvision,
        }),
        (error) => {
          assert.match(error.message, /fails the repo-path guard/, `${label}: ${error.message}`)
          assert.match(error.message, /#362/, `${label}: ${error.message}`)
          assert.doesNotMatch(error.message, /not committed/, `${label}: must not claim the plan is uncommitted: ${error.message}`)
          return true
        },
      )
      assert.equal(cmds.length, 0, `${label}: refusal must precede every exec call, got: ${JSON.stringify(cmds)}`)
      assert.equal(fs.existsSync(path.join(tmp, dbName)), false, `${label}: refusal must precede the orchestrator start — no store dir may exist`)
    }
    fs.rmSync(path.join(repoDir, unsafeRel))
    fs.rmSync(outside)
    // #362-5, block-local: this block minted `docs/`, so this block removes it.
    fs.rmSync(path.join(repoDir, 'docs'), { recursive: true, force: true })
  }

  // -- 13g. #362-3: a plan absent from BOTH baseRef and the working tree skips
  //        the fitness check with exactly this narration — the branch every
  //        pre-#337 scenario reaches implicitly via driveDefaults.planPath,
  //        pinned by its text for the first time.
  {
    const absentRel = 'docs/superpowers/plans/example.md'
    assert.equal(driveDefaults.planPath, absentRel, 'precondition: this IS the default every other scenario drives')
    assert.equal(fs.existsSync(path.join(repoDir, absentRel)), false, 'precondition: absent from the working tree')
    assert.notEqual((await sh(`git cat-file -e HEAD:${absentRel}`, repoDir)).code, 0, 'precondition: absent at HEAD')
    const lines = []
    const { read, detail } = await driveOne({
      ...driveDefaults,
      dbDir: path.join(tmp, 'db-362g'),
      exec: makeExec(() => {}),
      runId: 'run-drive-362-skip',
      progressLog: (line) => lines.push(line),
      // Stop the drive right after the preflight — the narration is what is
      // under test, not a run.
      provision: async () => {
        throw new Error('sentinel-362-skip')
      },
    })
    assert.equal(read.o1, false)
    assert.ok(
      detail.errors.some((e) => e === 'drive: sentinel-362-skip'),
      `the aborted provision is on the record, got: ${JSON.stringify(detail.errors)}`,
    )
    const expected = `headless-fitness: plan absent at HEAD:${absentRel} and unreadable at ${path.join(repoDir, absentRel)} — check skipped`
    assert.ok(
      lines.includes(expected),
      `expected the skip narration verbatim, got: ${JSON.stringify(lines.filter((l) => /headless/.test(l)))}`,
    )
    assert.ok(
      !detail.errors.some((e) => /headless|#337/.test(e)),
      `a skipped check is narration only, never an errors line, got: ${JSON.stringify(detail.errors)}`,
    )
  }

  // -- 13e. #362-1: stderr chatter on `git show` must not read as a dirty plan
  // The production seam used to fold stderr into stdout, so a `warning:` line
  // from `git show <baseRef>:<plan>` made `workingText !== committedText`
  // fire on a clean, committed plan — a hard refusal with no override. The
  // seam is pinned pure in test_drive_one.mjs; this pins the other half: the
  // preflight compares `stdout` ONLY and ignores a `stderr` field. Own side
  // branch, own file, cleaned up below — order-independent of 13f/13g.
  {
    const chatterRel = 'docs/committed-chatter.md'
    const chatterSha = await commitPlanOnBranch({ branch: 'plan-chatter', relPath: chatterRel, text: FIT_PLAN })
    fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true })
    fs.writeFileSync(path.join(repoDir, chatterRel), FIT_PLAN)
    const runId = 'run-drive-362-chatter'
    let sandbox = null
    let chattered = 0
    const inner = makeExec((assignment) => {
      setTimeout(() => {
        sandbox = startStubSandbox({
          assignment,
          runId,
          receiptSha: olderSha,
          exec,
          branch: OLDER_BRANCH,
          receiptPath: 'old.txt',
          stamp: { pluginVersion: '9.9.9', engineSha: chatterSha },
        })
      }, 30)
    })
    // Wraps the fixture exec; `opts` (#368's per-command env) rides through.
    // Matched by exact command (not a `show plan-chatter:` prefix, which the
    // #282 stamp cross-check's own `git show plan-chatter:<manifest>` also
    // satisfies) so only the #337 preflight's read of the plan itself chatters.
    const exec = async (cmd, opts) => {
      const result = await inner(cmd, opts)
      if (cmd === `git -C ${repoDir} show plan-chatter:${chatterRel}`) {
        chattered += 1
        return { ...result, stderr: `warning: fixture chatter on stderr (#362)\n${result.stderr ?? ''}` }
      }
      return result
    }
    exec.cmds = inner.cmds
    exec.calls = inner.calls
    const { read, detail } = await driveOne({
      ...driveDefaults,
      planPath: chatterRel,
      baseRef: 'plan-chatter',
      dbDir: path.join(tmp, 'db-362e'),
      exec,
      runId,
    })
    await sandbox
    assert.equal(chattered, 1, 'the plan must have been read from baseRef through the chattering exec')
    assert.equal(read.o1, true, 'stderr chatter on git show must not refuse a clean committed plan')
    assert.equal(read.versionStamp, true, 'the stamp expectation resolved from the side branch')
    assert.ok(
      !detail.errors.some((e) => /headless|#337|differs between/.test(e)),
      `no fitness or #337 noise on the clean path, got: ${JSON.stringify(detail.errors)}`,
    )

    // #362-4: `git show` emits the raw blob; the working tree is the smudged
    // checkout. The byte-for-byte comparison above assumes they coincide,
    // which holds only while NO attribute (eol/text/filter) covers the plan
    // path. Ask git what it would apply, rather than looking for a tracked
    // `.gitattributes`: `check-attr` is the same resolution the smudge itself
    // uses, so it also catches an UNTRACKED .gitattributes, one in
    // `.git/info/attributes`, and a global `core.attributesFile` — none of
    // which `git ls-files` can see.
    //
    // Two repos, and BOTH have to be asked. This first one is the FIXTURE repo
    // the drive above actually read; it pins the assertion three lines up, that
    // `chatterRel`'s blob and working tree coincide *here*.
    const attrs = await sh(`git check-attr -a -- ${chatterRel}`, repoDir)
    assert.equal(attrs.code, 0, `git check-attr failed: ${attrs.stderr}`)
    assert.equal(
      attrs.stdout.trim(),
      '',
      'an attribute now covers the fixture plan path — the #337 byte-equality check needs to compare smudged text (#362-4)',
    )

    // … and this second one is the REAL checkout, where the refusal #362-4
    // exists to pre-empt would actually happen: a live drive reads its plan
    // from THIS repo, and an attribute committed here is invisible to any
    // question asked of `fs.mkdtemp`'s throwaway. Ask it of the paths a live
    // plan occupies — every tracked plan, plus a not-yet-written one, so a
    // directory-wide pattern is caught before the plan it would break exists.
    const repoRoot = decodeURIComponent(new URL('../..', import.meta.url).pathname)
    const LIVE_PLANS = 'docs/superpowers/plans'
    const tracked = await sh(`git ls-files -- '${LIVE_PLANS}/*.md'`, repoRoot)
    assert.equal(tracked.code, 0, `git ls-files failed: ${tracked.stderr}`)
    const livePlans = tracked.stdout.split('\n').filter(Boolean)
    assert.ok(livePlans.length > 0, `the real checkout must carry the plans under ${LIVE_PLANS} this pin is about`)
    // Every one of them, uncapped — a sample would read as coverage it isn't.
    const probes = [...livePlans, `${LIVE_PLANS}/9999-12-31-not-yet-written.md`]
    const liveAttrs = await sh(`git check-attr -a -- ${probes.map((p) => `'${p}'`).join(' ')}`, repoRoot)
    assert.equal(liveAttrs.code, 0, `git check-attr failed in ${repoRoot}: ${liveAttrs.stderr}`)
    assert.equal(
      liveAttrs.stdout.trim(),
      '',
      'an attribute now covers a real plan path — every clean live drive is about to refuse with `differs between …` (#362-4)',
    )

    // The blanket read BASE carried, kept beside the two above rather than
    // replaced by them: `check-attr` answers only for the paths it is handed,
    // so a `.gitattributes` landing where no plan has been written yet passes
    // both. This one sees the file itself, wherever in the repo it is.
    const declared = await sh('git ls-files -- .gitattributes "*/.gitattributes"', repoRoot)
    assert.equal(declared.code, 0, `git ls-files failed: ${declared.stderr}`)
    assert.equal(
      declared.stdout.trim(),
      '',
      'a .gitattributes entered the repo — re-read the #337 byte-equality check against what it now covers (#362-4)',
    )

    // Leave the fixture as found.
    fs.rmSync(path.join(repoDir, chatterRel))
    assert.equal((await sh('git branch -D plan-chatter', repoDir)).code, 0)
    // #362-5, block-local: this block minted `docs/`, so this block removes it.
    fs.rmSync(path.join(repoDir, 'docs'), { recursive: true, force: true })
  }

  console.log('ALL TESTS PASSED')
} finally {
  cleanup()
}

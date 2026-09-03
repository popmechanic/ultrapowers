// fleet/tests/test_drive_plan_in_assignment.mjs — #544 step 2: the plan and
// its gate verdicts ride the RUN ASSIGNMENT, not the repo at `baseRef`.
//
// The #337 rule ("the text assessed is the plan AS COMMITTED AT baseRef") is
// what makes a plan a repo file: a plan uncommitted at the base ref, or
// differing from it, is refused outright. `planSource: 'assignment'` makes
// that rule OPTIONAL — the driver reads the plan (and its sibling
// `<stem>.gate-verdicts.json`) from the working tree, assesses THAT text, and
// ships both to the sandbox inside `fleet-run.json`. It does not untrack
// `docs/`; #544 steps 1 and 3 are later work.
//
// `planSource` is a `driveOne` option, not a flag: #575 deleted
// `--plan-from-assignment` from the CLI, so every leg below sets the option
// directly.
//
// The absent-flag path is the load-bearing half of this spec: with no
// `planSource`, every exec string and the delivered payload must be
// byte-identical to BASE. Leg (j) freezes the whole BASE exec sequence as a
// literal, recorded from this same stub against BASE before the edit, so any
// added or reordered command reddens here.
//
// No network, no ssh, no gh: `exec` is a stub, `provision` and `destroy` are
// the injected seams, and every byte of state lives under one `fs.mkdtemp`.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { driveOne, shellQuote } from '../drive.mjs'
import { provisionRun, SANDBOX_SSH_OPTS } from '../provision.mjs'
import { PR_URL, setupDriveFixture } from './_drive_helpers.mjs'

const ok = (line) => console.log(`ok - ${line}`)

// A plan the headless-fitness preflight passes, and one it refuses (the same
// shapes `test_drive_fitness.mjs` uses).
const FIT_PLAN =
  '# P\n\n### Task 1: Code\n**Type:** implementation\n**Depends-on:** none\n\n**Files:**\n- Modify: `fleet/x.mjs`\n- Test: `fleet/tests/test_x.mjs`\n\n- [ ] **Step 1: edit**\n'
const UNFIT_PLAN =
  '# P\n\n### Task 1: Docs only\n**Type:** implementation\n**Depends-on:** none\n\n**Files:**\n- Modify: `docs/a.md`\n\n- [ ] **Step 1: edit**\n'
const VERDICTS = '{"tasks":{"1":{"hash":"abc","verdict":"pass","reason":"r"}},"tally":{"dispatched":1,"rejected":0}}'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-plan-assign-'))

try {
  // -- a/b/c. provisionRun: the payload carries `plan`, on the same terms as
  //           `overlap` — absent key IS the old path (#514's precedent).
  const provisionArgs = {
    golden: 'fleet-golden',
    runId: 'r1',
    baseRef: 'refs/heads/main',
    repoDir: '/tmp/repo',
    ttlMs: 60000,
    wsUrl: 'ws://127.0.0.1:8151/fleet',
    planPath: 'docs/p.md',
    clock: () => 1000,
  }
  const recordingExec = () => {
    const cmds = []
    const exec = async (cmd) => {
      cmds.push(cmd)
      return { code: 0, stdout: '{}', stderr: '' }
    }
    exec.cmds = cmds
    return exec
  }
  const deliveryOf = (cmds) => cmds.find((cmd) => cmd.includes('/home/exedev/fleet-run.json'))
  const payloadOf = (cmds) => JSON.parse(deliveryOf(cmds).match(/<<'FLEET_EOF'\n([\s\S]*?)\nFLEET_EOF/)[1])

  // (a) the plan and its verdicts ride the heredoc; nothing else moves.
  {
    const exec = recordingExec()
    const result = await provisionRun({ ...provisionArgs, exec, plan: { text: 'P', verdicts: 'V' } })
    const payload = payloadOf(exec.cmds)
    assert.deepEqual(payload.plan, { text: 'P', verdicts: 'V' })
    const { plan, ...rest } = payload
    assert.deepEqual(rest, {
      runId: 'r1',
      token: result.token,
      wsUrl: 'ws://127.0.0.1:8151/fleet',
      ttlMs: 60000,
      planPath: 'docs/p.md',
    })
    ok('(a) the assignment payload carries plan.text/plan.verdicts beside the untouched BASE keys')
  }

  // (b) without `plan`, the delivery command is byte-identical to BASE —
  //     asserted against a literal, not a substring.
  {
    const exec = recordingExec()
    const result = await provisionRun({ ...provisionArgs, exec })
    assert.equal(
      deliveryOf(exec.cmds),
      `ssh ${SANDBOX_SSH_OPTS} fleet-r1.exe.xyz 'umask 077 && cat > /home/exedev/fleet-run.json' <<'FLEET_EOF'\n` +
        `{"runId":"r1","token":"${result.token}","wsUrl":"ws://127.0.0.1:8151/fleet","ttlMs":60000,"planPath":"docs/p.md"}\n` +
        'FLEET_EOF',
    )
    assert.equal('plan' in payloadOf(exec.cmds), false, 'no plan key when unset — old assignments stay byte-identical')
    ok('(b) the no-plan delivery command is byte-identical to BASE')
  }

  // (c) the heredoc sentinel is refused BEFORE the golden is cloned, exactly
  //     as `engineEnvFileBody` refuses it for an env value — text that carries
  //     `FLEET_EOF` would close the heredoc early and shell the remainder.
  {
    for (const plan of [{ text: `x\nFLEET_EOF\ny`, verdicts: null }, { text: 'P', verdicts: `FLEET_EOF` }]) {
      const exec = recordingExec()
      await assert.rejects(
        provisionRun({ ...provisionArgs, exec, plan }),
        /FLEET_EOF|heredoc sentinel/,
      )
      assert.deepEqual(exec.cmds, [], 'the sentinel refusal must precede every exec call')
    }
    ok('(c) a plan or verdict text carrying FLEET_EOF is refused before any exec')
  }

  // -- d-j. driveOne: the preflight source and what reaches `provision`. -----
  // A stub exec answering the three git reads the preflight and the version
  // cross-check make; `provision` records its options and stops the drive
  // there (its throw is caught into the read, as any provisioner failure is),
  // and `destroy` is a no-op so teardown issues only its two captures.
  const G128 = { code: 128, stdout: '', stderr: 'fatal: path does not exist' }
  const stubDrive = async ({
    label,
    runId = `run-plan-${label}`,
    planSource,
    planText = FIT_PLAN,
    verdicts = null,
    show,
    allowUnfitPlan = false,
  }) => {
    const root = path.join(tmp, label)
    const repoDir = path.join(root, 'repo')
    fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true })
    if (planText !== null) fs.writeFileSync(path.join(repoDir, 'docs/p.md'), planText)
    if (verdicts !== null) fs.writeFileSync(path.join(repoDir, 'docs/p.gate-verdicts.json'), verdicts)
    const cmds = []
    const provisionCalls = []
    const exec = async (cmd) => {
      cmds.push(cmd)
      if (/ rev-parse base-ref$/.test(cmd)) return { code: 0, stdout: `${'a'.repeat(40)}\n`, stderr: '' }
      if (/ show base-ref:\.claude-plugin\/plugin\.json$/.test(cmd)) return { code: 0, stdout: '{"version":"9.9.9"}', stderr: '' }
      if (/ show base-ref:docs\/p\.md$/.test(cmd)) return show
      return { code: 0, stdout: '', stderr: '' }
    }
    const drive = () =>
      driveOne({
        planPath: 'docs/p.md',
        golden: 'fleet-golden',
        port: 0,
        dbDir: path.join(root, 'db'),
        evidenceDir: path.join(root, 'ev'),
        repoDir,
        exec,
        clock: () => 2_000_000,
        runId,
        baseRef: 'base-ref',
        ttlMs: 60_000,
        tickMs: 25,
        settleMs: 20,
        publishPollMs: 25,
        publishTimeoutMs: 500,
        parkedPublishWaitMs: 100,
        heartbeatTimeoutMs: 1_000,
        progressLog: () => {},
        allowUnfitPlan,
        provision: async (options) => {
          provisionCalls.push(options)
          throw new Error('provision-stop')
        },
        destroy: async () => {},
        ...(planSource === undefined ? {} : { planSource }),
      })
    return { drive, cmds, provisionCalls, repoDir, root }
  }
  const showedPlan = (cmds) => cmds.filter((cmd) => / show base-ref:docs\/p\.md$/.test(cmd))

  // (d) absent at baseRef (`git show` code 128) is NOT a refusal under
  //     `planSource: 'assignment'` — the drive proceeds, and the working-tree
  //     plan and its sibling verdicts reach `provision`.
  {
    const h = await stubDrive({ label: 'd', planSource: 'assignment', verdicts: VERDICTS, show: G128 })
    const read = await h.drive()
    assert.equal(h.provisionCalls.length, 1, `expected one provision call, got ${h.provisionCalls.length}`)
    assert.deepEqual(h.provisionCalls[0].plan, { text: FIT_PLAN, verdicts: VERDICTS })
    assert.deepEqual(showedPlan(h.cmds), [], 'planSource: assignment never runs git show <baseRef>:<plan>')
    assert.deepEqual(
      read.detail.errors.filter((line) => /#337/.test(line)),
      [],
      'no #337 refusal reaches the read',
    )
    ok('(d) a plan absent at baseRef ships from the working tree with its verdicts')
  }

  // (e) no sibling verdict file — `verdicts` is null, not absent and not ''.
  {
    const h = await stubDrive({ label: 'e', planSource: 'assignment', show: G128 })
    await h.drive()
    assert.deepEqual(h.provisionCalls[0].plan, { text: FIT_PLAN, verdicts: null })
    ok('(e) an absent sibling verdict file ships plan.verdicts === null')
  }

  // (f) WITHOUT `planSource` the #337 rule is exactly as it was: a plan
  //     uncommitted at baseRef is refused, before provisioning, with the BASE
  //     message.
  {
    const h = await stubDrive({ label: 'f', show: G128 })
    await assert.rejects(
      h.drive(),
      (error) => {
        assert.equal(
          error.message,
          'driveOne: plan docs/p.md is in the working tree but not committed at base-ref — the sandbox ' +
            'executes the pushed base-ref, never the working tree; commit it, or pass the ref that carries it (#337)',
        )
        return true
      },
    )
    assert.deepEqual(h.provisionCalls, [], 'the refusal must precede provisioning')
    ok('(f) without planSource an absent-at-base plan keeps the BASE #337 refusal')
  }

  // (g) fitness is assessed on the shipped text, and still gates: the
  //     preflight is relocated, not removed.
  {
    const h = await stubDrive({ label: 'g', planSource: 'assignment', planText: UNFIT_PLAN, show: G128 })
    await assert.rejects(h.drive(), /headless-unfit/)
    assert.deepEqual(h.provisionCalls, [], 'an unfit plan must not provision')

    const allowed = await stubDrive({
      label: 'g-allowed',
      planSource: 'assignment',
      planText: UNFIT_PLAN,
      show: G128,
      allowUnfitPlan: true,
    })
    await allowed.drive()
    assert.deepEqual(allowed.provisionCalls[0].plan, { text: UNFIT_PLAN, verdicts: null })
    ok('(g) an unfit working-tree plan is refused under planSource: assignment unless allowUnfitPlan')
  }

  // (h) was the CLI flag. #575 deleted `--plan-from-assignment` from
  // `fleet/drive-one.mjs` — a launch names its target and its base and nothing
  // else about where the plan comes from — so `parseArgs` refuses it as an
  // unknown flag now and `buildDriveOptions` carries no `planSource` key at
  // all. That refusal is pinned in `test_drive_one_target.mjs` leg (a); what
  // remains this file's is the `driveOne({ planSource })` option itself, which
  // every other leg here drives directly.

  // (i) a working tree that DIFFERS from baseRef is not a refusal either —
  //     and the text that ships is the working tree's, never `git show`'s.
  {
    const h = await stubDrive({
      label: 'i',
      planSource: 'assignment',
      show: { code: 0, stdout: `${FIT_PLAN}# a different committed copy\n`, stderr: '' },
    })
    await h.drive()
    assert.equal(h.provisionCalls[0].plan.text, FIT_PLAN)
    assert.deepEqual(showedPlan(h.cmds), [], 'planSource: assignment never runs git show <baseRef>:<plan>')
    ok('(i) a plan differing at baseRef ships the working-tree text')
  }

  // (j) the frozen BASE exec sequence. Recorded from this same stub against
  //     BASE (1e09182) BEFORE this task's edit: the absent-flag drive must
  //     issue these five commands, in this order, byte for byte. The
  //     `planSource: 'assignment'` drive differs by exactly one thing — the
  //     `git show <baseRef>:<plan>` read is gone.
  const BASE_EXEC_SEQUENCE = [
    'git -C <root>/repo show base-ref:docs/p.md',
    'git -C <root>/repo rev-parse base-ref',
    'git -C <root>/repo show base-ref:.claude-plugin/plugin.json',
    'ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ' +
      'fleet-run-plan-j.exe.xyz \'cd /home/exedev && tar czf - --exclude="repo/.claude/ultrapowers/run-*/clones" ' +
      'shim.log fleet-run.json .claude/projects $(cd repo && ls -d .claude/ultrapowers/run-*/ 2>/dev/null | ' +
      'sed "s|^|repo/|") 2>/dev/null\' > <root>/ev/sandbox-logs/fleet-run-plan-j-<ts>/sandbox-logs.tgz',
    'ssh -o BatchMode=yes -o ConnectTimeout=10 exe.dev "stat fleet-run-plan-j --json --range=24h"',
  ]
  // The two varying substrings — the mkdtemp root and the log-pull directory's
  // wall-clock stamp — and nothing else.
  const normalize = (cmds, root) =>
    cmds.map((cmd) => cmd.split(root).join('<root>').replace(/(\/fleet-[A-Za-z0-9-]+)-\d+\//, '$1-<ts>/'))
  {
    const control = await stubDrive({ label: 'j', runId: 'run-plan-j', show: { code: 0, stdout: FIT_PLAN, stderr: '' } })
    await control.drive()
    assert.deepEqual(normalize(control.cmds, control.root), BASE_EXEC_SEQUENCE)
    assert.equal(control.provisionCalls.length, 1)
    assert.equal('plan' in control.provisionCalls[0], false, 'no plan key reaches provision without planSource')

    const shipped = await stubDrive({
      label: 'j-assignment',
      runId: 'run-plan-j',
      planSource: 'assignment',
      show: { code: 0, stdout: FIT_PLAN, stderr: '' },
    })
    await shipped.drive()
    assert.deepEqual(normalize(shipped.cmds, shipped.root), BASE_EXEC_SEQUENCE.slice(1))
    ok('(j) the absent-flag exec sequence is BASE byte for byte; assignment drops only the git show')
  }

  // -- k. the PUBLISH leg renders from the DISPATCHED plan. -----------------
  // The two preflight branches are not the end of the plan text's life: the
  // publish leg reads it again, for the PR body's `Closes #NNN` lines
  // (`parsePlanCloses`) and for the PR title (`planTitleFrom`, whose fallback
  // is the plan file's BASENAME). Both used to read `committedText`, which
  // `planSource: 'assignment'` never assigns — so a shipped plan opened a PR
  // that closed nothing and was titled `fleet <runId>: <file>.md`, silently,
  // because neither render throws on `null`. Legs (a)-(j) are all upstream of
  // the publish leg and stayed green with that defect present; this one is
  // the leg that reddens on it.
  //
  // A REAL drive to a green publish: the shared `_drive_helpers.mjs` fixture
  // (its own tmp, two real git repos, a bare `origin`, a real `runShim` over
  // the real ws transport). `gh pr create` is the only stub — its command
  // string carries the title, and its `--body-file` is read off disk.
  {
    const fixture = await setupDriveFixture()
    try {
      const { tmp: fxTmp, repoDir, headSha, makeExec, startStubSandbox, driveDefaults } = fixture
      const runId = 'run-plan-k'
      // The plan lives ONLY in the working tree — uncommitted at `main`, which
      // is exactly the #337 divergence leg (f) still refuses without the flag.
      const PLAN_REL = 'docs/superpowers/plans/2026-09-02-shipped.md'
      const PLAN_TEXT =
        '# The shipped plan H1 (#544)\n\n' +
        '**Closes:** #544, #337\n\n' +
        FIT_PLAN.split('\n').slice(1).join('\n')
      fs.mkdirSync(path.join(repoDir, path.dirname(PLAN_REL)), { recursive: true })
      fs.writeFileSync(path.join(repoDir, PLAN_REL), PLAN_TEXT)

      const exec = makeExec((assignment) => {
        setTimeout(() => {
          exec.sandbox = startStubSandbox({
            assignment,
            runId,
            receiptSha: headSha,
            receiptPath: 'f.txt',
            exec,
            stamp: { pluginVersion: '9.9.9', engineSha: headSha },
          })
        }, 30)
      })
      const { detail } = await driveOne({
        ...driveDefaults,
        planPath: PLAN_REL,
        baseRef: 'main',
        planSource: 'assignment',
        dbDir: path.join(fxTmp, `db-${runId}`),
        evidenceDir: path.join(fxTmp, `evidence-${runId}`),
        exec,
        runId,
      })
      await exec.sandbox

      // Precondition: the plan really is absent at the base ref, so this is a
      // drive only `planSource: 'assignment'` could have reached at all.
      assert.deepEqual(detail.pullRequest?.url, PR_URL, `expected a published PR, got ${JSON.stringify(detail.pullRequest)}`)
      const ghCmd = exec.cmds.find((cmd) => / gh pr create /.test(cmd))
      assert.ok(ghCmd, `expected gh pr create, got: ${JSON.stringify(exec.cmds.filter((c) => / gh /.test(c)))}`)

      // The title is the SHIPPED plan's H1 — not `basename(planPath)`.
      assert.ok(
        ghCmd.includes(`--title ${shellQuote(`fleet ${runId}: The shipped plan H1 (#544)`)}`),
        `the PR title must carry the shipped plan's H1, got: ${ghCmd}`,
      )
      assert.ok(!ghCmd.includes('2026-09-02-shipped.md'), 'the basename fallback means the plan text never reached the title')

      // …and the body closes the issues the shipped header names.
      const bodyFile = path.join(fxTmp, `evidence-${runId}`, `pr-body-${runId}.md`)
      const body = fs.readFileSync(bodyFile, 'utf8')
      assert.ok(/^Closes #544$/m.test(body), `the PR body must close #544, got:\n${body}`)
      assert.ok(/^Closes #337$/m.test(body), `the PR body must close #337, got:\n${body}`)
      ok('(k) a shipped plan publishes a PR with its own H1 title and its own Closes lines')
    } finally {
      fixture.cleanup()
    }
  }

  console.log('ALL TESTS PASSED')
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

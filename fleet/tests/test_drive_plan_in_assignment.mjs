// fleet/tests/test_drive_plan_in_assignment.mjs — #544 step 2, #575: the plan
// and its gate verdicts ride the RUN ASSIGNMENT. Always.
//
// Under #337 the plan was a repo file, read as committed at a base ref, and a
// working-tree copy that diverged was refused. #544 step 2 made shipping the
// working-tree text an option (`planSource: 'assignment'`); #575 made it the
// only path — there is no base ref to read a plan from any more (the engine
// checkout is not the target, and the target's cache clone carries no plan),
// so `planSource` is gone and every drive ships the file at `planPath`, from
// wherever it lives, known to the sandbox by its basename.
//
// The load-bearing leg is (j): the preflight's whole exec sequence, frozen as
// a literal — the engine checkout's cleanliness, HEAD and manifest reads, the
// target's cache clone (a first-use `clone`, or a `fetch origin` when the
// clone exists) and the `cat-file -e <base>^{commit}` that refuses a base
// origin does not carry. Any added, dropped or reordered command reddens here.
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

const ENGINE_SHA = 'a'.repeat(40)
const BASE_SHA = 'b'.repeat(40)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-plan-assign-'))

try {
  // -- a/b/c. provisionRun: the payload carries `plan`, on the same terms as
  //           `overlap` — absent key IS the old path (#514's precedent).
  const provisionArgs = {
    golden: 'fleet-golden',
    runId: 'r1',
    engineDir: '/tmp/engine',
    engineSha: ENGINE_SHA,
    targetDir: '/tmp/targets/o--r',
    baseSha: BASE_SHA,
    ttlMs: 60000,
    wsUrl: 'ws://127.0.0.1:8151/fleet',
    planPath: 'p.md',
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
      planPath: 'p.md',
    })
    ok('(a) the assignment payload carries plan.text/plan.verdicts beside the untouched keys')
  }

  // (b) without `plan`, the delivery command is byte-identical to the
  //     shipped pin — asserted against a literal, not a substring — and
  //     carries no `engine` key (#575 deleted it).
  {
    const exec = recordingExec()
    const result = await provisionRun({ ...provisionArgs, exec })
    assert.equal(
      deliveryOf(exec.cmds),
      `ssh ${SANDBOX_SSH_OPTS} fleet-r1.exe.xyz 'umask 077 && cat > /home/exedev/fleet-run.json' <<'FLEET_EOF'\n` +
        `{"runId":"r1","token":"${result.token}","wsUrl":"ws://127.0.0.1:8151/fleet","ttlMs":60000,"planPath":"p.md"}\n` +
        'FLEET_EOF',
    )
    assert.equal('plan' in payloadOf(exec.cmds), false, 'no plan key when unset — old assignments stay byte-identical')
    assert.equal('engine' in payloadOf(exec.cmds), false, 'no engine key, ever')
    ok('(b) the no-plan delivery command is byte-identical to the shipped pin')
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

  // -- d-j. driveOne: the preflight and what reaches `provision`. ------------
  // A stub exec answering the reads the preflight makes of the engine checkout
  // and the target's cache; `provision` records its options and stops the
  // drive there (its throw is caught into the read, as any provisioner failure
  // is), and `destroy` is a no-op so teardown issues only its two captures.
  const stubDrive = async ({
    label,
    runId = `run-plan-${label}`,
    planText = FIT_PLAN,
    verdicts = null,
    allowUnfitPlan = false,
    cacheExists = false,
    // The cache's answer to `cat-file -e <base>^{commit}`: 0 holds it, 1 does not.
    catFileCode = 0,
  }) => {
    const root = path.join(tmp, label)
    const repoDir = path.join(root, 'repo')
    const targetsDir = path.join(root, 'targets')
    const planFile = path.join(root, 'plans', 'p.md')
    fs.mkdirSync(repoDir, { recursive: true })
    fs.mkdirSync(path.dirname(planFile), { recursive: true })
    if (cacheExists) fs.mkdirSync(path.join(targetsDir, 'o--r'), { recursive: true })
    if (planText !== null) fs.writeFileSync(planFile, planText)
    if (verdicts !== null) fs.writeFileSync(path.join(root, 'plans', 'p.gate-verdicts.json'), verdicts)
    const cmds = []
    const calls = []
    const provisionCalls = []
    const exec = async (cmd, opts) => {
      cmds.push(cmd)
      calls.push({ cmd, env: opts?.env ?? null })
      if (/ rev-parse HEAD$/.test(cmd)) return { code: 0, stdout: `${ENGINE_SHA}\n`, stderr: '' }
      if (/ show HEAD:\.claude-plugin\/plugin\.json$/.test(cmd)) return { code: 0, stdout: '{"version":"9.9.9"}', stderr: '' }
      if (/ cat-file -e /.test(cmd)) return { code: catFileCode, stdout: '', stderr: '' }
      return { code: 0, stdout: '', stderr: '' }
    }
    const drive = () =>
      driveOne({
        planPath: planFile,
        golden: 'fleet-golden',
        port: 0,
        dbDir: path.join(root, 'db'),
        evidenceDir: path.join(root, 'ev'),
        target: 'o/r',
        baseSha: BASE_SHA,
        repoDir,
        targetsDir,
        exec,
        clock: () => 2_000_000,
        runId,
        ttlMs: 60_000,
        tickMs: 25,
        settleMs: 20,
        publishPollMs: 25,
        publishTimeoutMs: 500,
        parkedPublishWaitMs: 100,
        heartbeatTimeoutMs: 1_000,
        progressLog: () => {},
        allowUnfitPlan,
        githubTokenPath: path.join(root, 'no-such-token'),
        provision: async (options) => {
          provisionCalls.push(options)
          throw new Error('provision-stop')
        },
        destroy: async () => {},
      })
    return { drive, cmds, calls, provisionCalls, repoDir, root }
  }
  const showedPlan = (cmds) => cmds.filter((cmd) => / show \S+:\S*\.md/.test(cmd))

  // (d) the working-tree plan and its sibling verdicts reach `provision`, and
  //     no command reads a plan out of git.
  {
    const h = await stubDrive({ label: 'd', verdicts: VERDICTS })
    const read = await h.drive()
    assert.equal(h.provisionCalls.length, 1, `expected one provision call, got ${h.provisionCalls.length}`)
    assert.deepEqual(h.provisionCalls[0].plan, { text: FIT_PLAN, verdicts: VERDICTS })
    assert.equal(h.provisionCalls[0].planPath, 'p.md', 'the sandbox knows the plan by its basename')
    assert.deepEqual(showedPlan(h.cmds), [], 'nothing ever runs git show <ref>:<plan>')
    assert.deepEqual(
      read.detail.errors.filter((line) => /#337/.test(line)),
      [],
      'no #337 refusal reaches the read',
    )
    ok('(d) a plan file ships from the working tree with its verdicts')
  }

  // (e) no sibling verdict file — `verdicts` is null, not absent and not ''.
  {
    const h = await stubDrive({ label: 'e' })
    await h.drive()
    assert.deepEqual(h.provisionCalls[0].plan, { text: FIT_PLAN, verdicts: null })
    ok('(e) an absent sibling verdict file ships plan.verdicts === null')
  }

  // (g) fitness is assessed on the shipped text, and still gates.
  {
    const h = await stubDrive({ label: 'g', planText: UNFIT_PLAN })
    await assert.rejects(h.drive(), /headless-unfit/)
    assert.deepEqual(h.provisionCalls, [], 'an unfit plan must not provision')

    const allowed = await stubDrive({ label: 'g-allowed', planText: UNFIT_PLAN, allowUnfitPlan: true })
    await allowed.drive()
    assert.deepEqual(allowed.provisionCalls[0].plan, { text: UNFIT_PLAN, verdicts: null })
    ok('(g) an unfit plan file is refused unless allowUnfitPlan')
  }

  // (h) an absent plan ships nothing, and says so — the sandbox still learns
  //     the name it was dispatched under.
  {
    const h = await stubDrive({ label: 'h', planText: null })
    await h.drive()
    assert.equal('plan' in h.provisionCalls[0], false, 'no plan key reaches provision for a plan that is not there')
    assert.equal(h.provisionCalls[0].planPath, 'p.md')
    ok('(h) an absent plan file ships no plan key')
  }

  // (j) the frozen preflight exec sequence (#575). The drive must issue these
  //     commands, in this order, byte for byte: the run tip's ref name (git's
  //     own grammar, before any VM); the engine checkout's cleanliness, its
  //     HEAD, its manifest; the target's first-use clone (the token file is
  //     absent here, so the clone's env carries no GH_TOKEN) or its
  //     credentialed fetch; the `cat-file` that refuses a base origin does not
  //     carry; then, from the aborted provision's teardown, the two captures.
  const PULL =
    'ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ' +
    "fleet-run-plan-j.exe.xyz sh > <root>/ev/sandbox-logs/fleet-run-plan-j-<ts>/sandbox-logs.tgz <<'FLEET_PULL_EOF'\n" +
    `cd /home/exedev && tar czf - --transform 's,^target/,repo/,' --exclude="target/.claude/ultrapowers/run-*/clones" ` +
    'shim.log fleet-run.json .claude/projects $(cd target && ls -d .claude/ultrapowers/run-*/ 2>/dev/null | ' +
    'sed "s|^|target/|") 2>/dev/null\nFLEET_PULL_EOF'
  const STAT = 'ssh -o BatchMode=yes -o ConnectTimeout=10 exe.dev "stat fleet-run-plan-j --json --range=24h"'
  const FIRST_USE_SEQUENCE = [
    'git check-ref-format refs/fleet/run-plan-j',
    'git -C <root>/repo status --porcelain',
    'git -C <root>/repo rev-parse HEAD',
    'git -C <root>/repo show HEAD:.claude-plugin/plugin.json',
    `git -c credential.helper= -c credential.helper='!gh auth git-credential' clone https://github.com/o/r.git <root>/targets/o--r`,
    `git -C <root>/targets/o--r cat-file -e ${BASE_SHA}^{commit}`,
    PULL,
    STAT,
  ]
  const CACHED_SEQUENCE = [
    'git check-ref-format refs/fleet/run-plan-j',
    'git -C <root>/repo status --porcelain',
    'git -C <root>/repo rev-parse HEAD',
    'git -C <root>/repo show HEAD:.claude-plugin/plugin.json',
    `git -C <root>/targets/o--r -c credential.helper= -c credential.helper='!gh auth git-credential' fetch origin`,
    `git -C <root>/targets/o--r cat-file -e ${BASE_SHA}^{commit}`,
    PULL,
    STAT,
  ]
  // The two varying substrings — the mkdtemp root and the log-pull directory's
  // wall-clock stamp — and nothing else.
  const normalize = (cmds, root) =>
    cmds.map((cmd) => cmd.split(root).join('<root>').replace(/(\/fleet-[A-Za-z0-9-]+)-\d+\//, '$1-<ts>/'))
  {
    const first = await stubDrive({ label: 'j', runId: 'run-plan-j' })
    await first.drive()
    assert.deepEqual(normalize(first.cmds, first.root), FIRST_USE_SEQUENCE)
    assert.equal(first.provisionCalls.length, 1)
    const clone = first.calls.find((c) => / clone /.test(c.cmd))
    assert.ok(clone && !('GH_TOKEN' in (clone.env ?? {})), `no token file → no GH_TOKEN in the clone env: ${JSON.stringify(clone?.env)}`)
    assert.ok(!first.cmds.slice(0, 5).some((c) => /exe\.dev|\.exe\.xyz/.test(c)), 'nothing reaches exe.dev before the base is known to be real')

    const cached = await stubDrive({ label: 'j-cached', runId: 'run-plan-j', cacheExists: true })
    await cached.drive()
    assert.deepEqual(normalize(cached.cmds, cached.root), CACHED_SEQUENCE)
    assert.ok(!cached.cmds.some((c) => / clone /.test(c)), 'an existing cache clone is fetched, never re-cloned')
    ok('(j) the preflight exec sequence is frozen byte for byte, first-use and cached')
  }

  // (j-refuse) a base the cache does not hold is refused, naming the sha and
  //            the remedy, before anything reaches exe.dev.
  {
    const h = await stubDrive({ label: 'j-absent', runId: 'run-plan-absent', catFileCode: 1 })
    await assert.rejects(h.drive(), (error) => {
      assert.ok(error.message.includes('push'), `names the remedy: ${error.message}`)
      assert.ok(error.message.includes(BASE_SHA), `names the base: ${error.message}`)
      return true
    })
    assert.deepEqual(h.provisionCalls, [], 'an absent base must not provision')
    assert.ok(!h.cmds.some((c) => /exe\.dev|\.exe\.xyz/.test(c)), `no exe.dev command for a refused base: ${JSON.stringify(h.cmds)}`)
    assert.equal(fs.existsSync(path.join(h.root, 'db')), false, 'refusal precedes the orchestrator start')
    ok('(j-refuse) a base absent from origin is refused with push + the sha, before any VM')
  }

  // -- k. the PUBLISH leg renders from the DISPATCHED plan. -----------------
  // The publish leg reads the plan text again, for the PR body's
  // `Closes #NNN` lines (`parsePlanCloses`) and for the PR title
  // (`planTitleFrom`, whose fallback is the plan file's BASENAME). A REAL
  // drive to a green publish: the shared `_drive_helpers.mjs` fixture (its own
  // tmp, three real git repos, a bare `origin`, a real `runShim` over the real
  // ws transport). `gh pr create` is the only stub — its command string
  // carries the title, and its `--body-file` is read off disk.
  {
    const fixture = await setupDriveFixture()
    try {
      const { tmp: fxTmp, headSha, makeExec, startStubSandbox, driveDefaults } = fixture
      const runId = 'run-plan-k'
      // The plan lives ONLY under a `plans/` dir beside the fixture repos —
      // in no checkout at all, which is the #575 shape.
      const planFile = path.join(fxTmp, 'plans', '2026-09-02-shipped.md')
      const PLAN_TEXT =
        '# The shipped plan H1 (#544)\n\n' +
        '**Closes:** #544, #337\n\n' +
        FIT_PLAN.split('\n').slice(1).join('\n')
      fs.mkdirSync(path.dirname(planFile), { recursive: true })
      fs.writeFileSync(planFile, PLAN_TEXT)

      const exec = makeExec((assignment) => {
        setTimeout(() => {
          exec.sandbox = startStubSandbox({
            assignment,
            runId,
            receiptSha: headSha,
            receiptPath: 'f.txt',
            exec,
          })
        }, 30)
      })
      const { detail } = await driveOne({
        ...driveDefaults,
        planPath: planFile,
        dbDir: path.join(fxTmp, `db-${runId}`),
        evidenceDir: path.join(fxTmp, `evidence-${runId}`),
        exec,
        runId,
      })
      await exec.sandbox

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

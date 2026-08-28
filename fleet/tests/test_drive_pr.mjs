// fleet/tests/test_drive_pr.mjs — sentinel-style spec for the drive-one
// driver's PUBLISH LEG (#368): the orchestrator pushes the fetched run branch
// to GitHub and opens the PR whose body is the gate receipt.
//
// Own process, own copy of the `_drive_helpers.mjs` fixture (see its header)
// — the two older drive specs each run within reach of the suite's 120 s
// per-file cap, so this leg gets its own file. The bare `originRepo` stands
// in for GitHub: the push is REAL, so the pushed ref can be read back and
// compared to the tip the sandbox integrated — including its merge parents,
// which is what "as-is, never rebased" (#363) means mechanically. `gh pr
// create` is stubbed; the env it was handed is recorded, which is how the
// token is proven to ride the env and nothing else.
//
// Scenarios:
//   P1  green → push + `gh pr create` with the receipt-rendered body, no --draft
//   P2  parked with parkedPublish → --draft, `[parked] ` title, acks FIRST
//   P3  token file missing → no push, no gh, error recorded, read unchanged
//   P4  push failure → recorded, pullRequest null, read unchanged
//   P5  gh failure → recorded, pullRequest null, read unchanged
//   P6  parked with NOTHING fetched → no publish leg at all
//   P7  unsafe prBase → refused at entry, before any command
//   P8  the pure helpers: Closes parsing, title, body order, quoting, url parse
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  driveOne,
  parsePlanCloses,
  parsePullRequestUrl,
  planTitleFrom,
  pullRequestTitle,
  renderPullRequestBody,
  shellQuote,
} from '../drive.mjs'
import {
  GITHUB_TOKEN,
  OLDER_BRANCH,
  PR_URL,
  setupDriveFixture,
  sh,
  writeFile,
} from './_drive_helpers.mjs'

const { tmp, repoDir, sandboxRepo, originRepo, githubTokenPath, cleanup, headSha, makeExec, startStubSandbox, driveDefaults } =
  await setupDriveFixture()

const TRAILER = '🤖 Generated with [Claude Code](https://claude.com/claude-code)'

try {
  // -- fixture: a plan at baseRef carrying the #368 Closes convention --------
  // Committed on a side branch through a temporary index (HEAD, the working
  // tree and every fixture sha stay put — the test_drive 13 pattern).
  const PLAN_REL = 'docs/superpowers/plans/2026-08-28-pr-leg.md'
  const PLAN_TEXT =
    '# Fleet PR Leg Implementation Plan (#368)\n\n' +
    '**Goal:** the orchestrator opens the PR.\n\n' +
    '**Closes:** #318, #319\n\n' +
    'Closes #320\n\n' +
    '### Task 1: Code\n**Type:** implementation\n**Depends-on:** none\n\n' +
    '**Files:**\n- Modify: `fleet/x.mjs`\n- Test: `fleet/tests/test_x.mjs`\n\n- [ ] **Step 1: edit**\n\n' +
    '## Not the header\n\nCloses #999\n'
  const planSha = await (async () => {
    const idx = path.join(tmp, 'plan-pr.idx')
    const blobFile = path.join(tmp, 'plan-pr.blob')
    fs.writeFileSync(blobFile, PLAN_TEXT)
    const r = await sh(
      `set -e; blob=$(git hash-object -w "${blobFile}"); ` +
        `GIT_INDEX_FILE="${idx}" git read-tree main; ` +
        `GIT_INDEX_FILE="${idx}" git update-index --add --cacheinfo 100644,$blob,${PLAN_REL}; ` +
        `tree=$(GIT_INDEX_FILE="${idx}" git write-tree); ` +
        `commit=$(git commit-tree $tree -p main -m plan-pr); ` +
        `git branch plan-pr $commit; printf '%s' $commit`,
      repoDir,
    )
    assert.equal(r.code, 0, `plan-pr fixture failed: ${r.stderr}`)
    return r.stdout.trim()
  })()
  assert.match(planSha, /^[0-9a-f]{40}$/)

  // -- fixture: two integration branches carrying REAL-shaped gate receipts --
  // Shaped like fleet-receipts/run-20/gate-receipt.json (gateCheck.{verdict,
  // checks, acks} + verdict), plus the two report.json-only fields so the
  // body renders them when a receipt carries them. The GREEN branch's tip is
  // a `--no-ff` MERGE commit: the one shape a rebase would flatten.
  const GREEN_BRANCH = 'ultra/integration-20260828000001'
  const PARKED_BRANCH = 'ultra/integration-20260828000002'
  const greenReceiptPath = 'fleet-receipts/run-pr-green/gate-receipt.json'
  const parkedReceiptPath = 'fleet-receipts/run-pr-parked/gate-receipt.json'
  const checks = ['report-parse', 'lock', 'clean-tree', 'wave-merges', 'head-match', 'git-verified', 'ancestry', 'deliverables'].map(
    (name) => ({ name, ok: true, detail: '' }),
  )
  const GREEN_RECEIPT = {
    mode: 'gate',
    branch: GREEN_BRANCH,
    gateCheck: { verdict: 'PASS', checks, acks: [] },
    acceptance: { disposition: 'suite', exit: 0 },
    verdict: 'PASS',
    autoResolved: 1,
    completenessFindings: ['socket leak in shim teardown (run-14 precedent)'],
  }
  const PARKED_ACKS = [
    { type: 'deferred:manual', detail: 'the #345 adoption verdict is the operator\'s call at integration' },
    { type: 'deferred:external', detail: 'RUNBOOK smoke needs a live exe.dev drive' },
  ]
  const PARKED_RECEIPT = {
    mode: 'gate',
    branch: PARKED_BRANCH,
    gateCheck: { verdict: 'NEEDS_ACK', checks: [...checks, { name: 'acceptance', ok: false, detail: 'ack required' }], acks: PARKED_ACKS },
    verdict: 'NEEDS_ACK',
  }
  const cutBranch = async ({ name, receiptPath, receipt, merge }) => {
    await sh(`git checkout -q main && git checkout -q -b ${name}`, sandboxRepo)
    writeFile(sandboxRepo, receiptPath, JSON.stringify(receipt, null, 2))
    const r = await sh(
      `git add -A && GIT_COMMITTER_DATE='2031-01-01T00:00:00Z' git -c commit.gpgsign=false commit -q -m "fleet: receipts for ${name}"` +
        (merge ? ` && git -c commit.gpgsign=false merge -q --no-ff -m "fold: ${merge}" ${merge}` : ''),
      sandboxRepo,
    )
    assert.equal(r.code, 0, `${name} fixture failed: ${r.stderr}`)
    return (await sh(`git rev-parse ${name}`, sandboxRepo)).stdout.trim()
  }
  const greenTip = await cutBranch({ name: GREEN_BRANCH, receiptPath: greenReceiptPath, receipt: GREEN_RECEIPT, merge: OLDER_BRANCH })
  const parkedTip = await cutBranch({ name: PARKED_BRANCH, receiptPath: parkedReceiptPath, receipt: PARKED_RECEIPT })
  const greenParents = (await sh(`git rev-list --parents -1 ${greenTip}`, sandboxRepo)).stdout.trim().split(/\s+/).slice(1)
  assert.equal(greenParents.length, 2, 'precondition: the green tip is a merge commit')
  // The receipt is committed in the FIRST-parent commit, not the tip — the
  // stub sandbox points its receipt row at that sha, exactly as
  // `applyRunReceipts` records the branch tip AFTER its own commit; the fold
  // merge lands on top of it in this fixture.
  const greenReceiptSha = greenParents[0]
  assert.equal((await sh(`git cat-file -e ${greenReceiptSha}:${greenReceiptPath}`, sandboxRepo)).code, 0)

  const pushCmdFor = (tip, branch) =>
    `git -C ${repoDir} -c credential.helper= -c credential.helper='!gh auth git-credential' push origin ${tip}:refs/heads/${branch}`
  const ghCmdFor = ({ branch, title, bodyFile, draft }) =>
    `cd ${shellQuote(repoDir)} && gh pr create --base main --head ${branch} --title ${shellQuote(title)} --body-file ${shellQuote(bodyFile)}${draft ? ' --draft' : ''}`
  const noTokenAnywhere = (exec, detail) => {
    assert.ok(!exec.cmds.some((c) => c.includes(GITHUB_TOKEN)), 'the token must never appear on a command line')
    assert.ok(!JSON.stringify(detail).includes(GITHUB_TOKEN), 'the token must never land in the detail')
    assert.ok(!exec.cmds.some((c) => /rebase/.test(c)), `no rebase, ever: ${JSON.stringify(exec.cmds.filter((c) => /rebase/.test(c)))}`)
  }
  const driveGreen = async ({ runId, exec, overrides = {} }) =>
    driveOne({
      ...driveDefaults,
      planPath: PLAN_REL,
      baseRef: 'plan-pr',
      dbDir: path.join(tmp, `db-${runId}`),
      evidenceDir: path.join(tmp, `evidence-${runId}`),
      exec,
      runId,
      ...overrides,
    })
  const greenSandbox = ({ runId, exec, gateGreen = true, branch = GREEN_BRANCH, receiptSha = greenReceiptSha, receiptPath = greenReceiptPath }) =>
    (assignment) => {
      setTimeout(() => {
        exec.sandbox = startStubSandbox({
          assignment,
          runId,
          receiptSha,
          receiptPath,
          exec,
          branch,
          gateGreen,
          stamp: { pluginVersion: '9.9.9', engineSha: planSha },
        })
      }, 30)
    }

  // -- P1. green: push the fetched tip as-is, open a normal PR ---------------
  {
    const runId = 'run-pr-green'
    const exec = makeExec((a) => greenSandbox({ runId, exec })(a))
    const { read, detail, detailPath } = await driveGreen({ runId, exec })
    await exec.sandbox

    // The read is the gate-green read it always was — five keys, all green.
    assert.deepEqual(read, {
      o1: true,
      receiptsResolvable: true,
      leaseContinuity: true,
      versionStamp: true,
      spendObservational: { reported: 4200, ledger: 4200 },
    })
    assert.deepEqual(detail.pullRequest, { number: 4242, url: PR_URL, draft: false, branch: GREEN_BRANCH })
    assert.deepEqual(JSON.parse(fs.readFileSync(detailPath, 'utf8')).pullRequest, detail.pullRequest)
    noTokenAnywhere(exec, detail)

    // The push: the EXACT command shape, pushing the fetched tip by sha to
    // refs/heads/<runBranch> on origin — no rebase anywhere.
    const pushCmd = pushCmdFor(greenTip, GREEN_BRANCH)
    const pushIdx = exec.cmds.indexOf(pushCmd)
    assert.ok(pushIdx >= 0, `expected the push, got: ${JSON.stringify(exec.cmds.filter((c) => / push /.test(c)))}`)
    assert.equal(exec.cmds.filter((c) => / push origin /.test(c)).length, 1, 'exactly one push to origin')
    assert.deepEqual(exec.calls[pushIdx].env, { GH_TOKEN: GITHUB_TOKEN, GIT_TERMINAL_PROMPT: '0' }, 'the token rides the push env')
    // …and it REALLY landed on origin: the pushed ref IS the sandbox's tip,
    // merge commit and both parents intact.
    assert.equal((await sh(`git rev-parse refs/heads/${GREEN_BRANCH}`, originRepo)).stdout.trim(), greenTip, 'origin carries the fetched tip byte for byte')
    assert.deepEqual(
      (await sh(`git rev-list --parents -1 refs/heads/${GREEN_BRANCH}`, originRepo)).stdout.trim().split(/\s+/).slice(1),
      greenParents,
      'the merge commit reached origin with both parents — never rebased',
    )

    // The PR: base main, head the run branch, receipt-rendered body file, no
    // --draft; token in the env only.
    const bodyFile = path.join(tmp, `evidence-${runId}`, `pr-body-${runId}.md`)
    const ghCmd = ghCmdFor({ branch: GREEN_BRANCH, title: `fleet ${runId}: Fleet PR Leg Implementation Plan (#368)`, bodyFile, draft: false })
    const ghIdx = exec.cmds.indexOf(ghCmd)
    assert.ok(ghIdx >= 0, `expected gh pr create, got: ${JSON.stringify(exec.cmds.filter((c) => / gh /.test(c)))}`)
    assert.ok(!exec.cmds[ghIdx].includes('--draft'), 'a green run is a normal PR, never a draft')
    assert.deepEqual(exec.calls[ghIdx].env, { GH_TOKEN: GITHUB_TOKEN, GH_PROMPT_DISABLED: '1' }, 'the token rides the gh env')
    assert.ok(pushIdx < ghIdx, 'push before PR')
    // After teardown: the billing clock never waits on GitHub.
    const rmIdx = exec.cmds.findIndex((c) => c === `ssh exe.dev "rm fleet-${runId} --json"`)
    assert.ok(rmIdx >= 0 && rmIdx < pushIdx, 'the sandbox is destroyed BEFORE the publish leg starts')
    // The receipt was read off the fetched branch, by its resolved pointer.
    assert.ok(exec.cmds.includes(`git -C ${repoDir} show ${greenReceiptSha}:${greenReceiptPath}`), 'the receipt is read from the branch')

    // The body IS the gate receipt rendered.
    const body = fs.readFileSync(bodyFile, 'utf8')
    assert.ok(body.startsWith(`# fleet ${runId} — gate receipt\n`), body.slice(0, 80))
    assert.ok(body.includes('## Verdict: PASS'))
    for (const c of checks) assert.ok(body.includes(`- [x] ${c.name}`), `check ${c.name} rendered`)
    assert.ok(body.includes('## Acks (0)\n- none'), 'green: empty acks, after the checks')
    assert.ok(body.indexOf('## Verdict') < body.indexOf('## Acks'), 'green: verdict before acks')
    for (const leg of ['| o1 | true |', '| receiptsResolvable | true |', '| leaseContinuity | true |', '| versionStamp | true |', '| spendObservational | reported 4200 / ledger 4200 |']) {
      assert.ok(body.includes(leg), `leg rendered: ${leg}`)
    }
    assert.ok(body.includes('## autoResolved: 1'), 'autoResolved rendered when the receipt carries it')
    assert.ok(body.includes('## Completeness-critic findings (1)\n- socket leak in shim teardown'), 'critic findings rendered')
    assert.ok(body.includes(`- \`${greenReceiptSha}\` \`${greenReceiptPath}\` — PASS, resolved`), 'receipt pointer rendered')
    // Closes: from the plan HEADER only — #318/#319 (bold line) and #320
    // (bare line); the #999 under a `##` section is NOT a close.
    assert.ok(body.includes('Closes #318\nCloses #319\nCloses #320\n'), `closes lines: ${body}`)
    assert.ok(!body.includes('#999'), 'Closes below the header are never harvested')
    assert.ok(body.endsWith(`\n${TRAILER}\n`), 'the standard trailer ends the body')
    assert.ok(!body.includes(GITHUB_TOKEN))
    assert.ok(!body.includes('[parked]'))
  }

  // -- P2. parked with parkedPublish: a DRAFT PR, [parked] title, acks FIRST -
  {
    const runId = 'run-pr-parked'
    const exec = makeExec((a) =>
      greenSandbox({ runId, exec, gateGreen: false, branch: PARKED_BRANCH, receiptSha: parkedTip, receiptPath: parkedReceiptPath })(a),
    )
    const { read, detail } = await driveGreen({ runId, exec, overrides: { parkedPublishWaitMs: 8_000 } })
    await exec.sandbox

    // The park reads exactly as #318/#336 pinned it — untouched by the PR.
    assert.equal(detail.status, 'parked')
    assert.deepEqual(read, {
      o1: false,
      receiptsResolvable: false,
      leaseContinuity: true,
      versionStamp: true,
      spendObservational: { reported: 4200, ledger: 4200 },
    })
    assert.deepEqual(detail.parkedPublish, { branch: PARKED_BRANCH, fetched: true, receiptsResolvable: true, unapproved: true })
    assert.deepEqual(detail.pullRequest, { number: 4242, url: PR_URL, draft: true, branch: PARKED_BRANCH })
    noTokenAnywhere(exec, detail)

    assert.ok(exec.cmds.includes(pushCmdFor(parkedTip, PARKED_BRANCH)), 'the parked branch is pushed as-is too')
    assert.equal((await sh(`git rev-parse refs/heads/${PARKED_BRANCH}`, originRepo)).stdout.trim(), parkedTip)
    const bodyFile = path.join(tmp, `evidence-${runId}`, `pr-body-${runId}.md`)
    const ghCmd = ghCmdFor({ branch: PARKED_BRANCH, title: `[parked] fleet ${runId}: Fleet PR Leg Implementation Plan (#368)`, bodyFile, draft: true })
    assert.ok(exec.cmds.includes(ghCmd), `expected a draft gh pr create, got: ${JSON.stringify(exec.cmds.filter((c) => / gh /.test(c)))}`)

    const body = fs.readFileSync(bodyFile, 'utf8')
    assert.ok(body.startsWith(`# fleet ${runId} — parked gate receipt\n`))
    const acksIdx = body.indexOf('## Acks required (2)')
    const verdictIdx = body.indexOf('## Verdict: NEEDS_ACK')
    assert.ok(acksIdx >= 0 && verdictIdx >= 0 && acksIdx < verdictIdx, 'parked: the ack list comes FIRST, before the verdict')
    for (const ack of PARKED_ACKS) assert.ok(body.includes(`- **${ack.type}** — ${ack.detail}`), `ack rendered: ${ack.type}`)
    assert.ok(body.includes('- [ ] acceptance — ack required'), 'a failed check renders unchecked with its detail')
    assert.ok(body.includes('mark it ready to ack'), 'the draft PR says how to ack')
    assert.ok(!body.includes('## autoResolved'), 'absent report-only fields are omitted, not invented')
    assert.ok(body.endsWith(`\n${TRAILER}\n`))
  }

  // -- P3. token file missing: no push, no gh, error recorded, read unchanged
  {
    const runId = 'run-pr-notoken'
    const missing = path.join(tmp, 'no-such-github-token')
    const exec = makeExec((a) => greenSandbox({ runId, exec })(a))
    const { read, detail } = await driveGreen({ runId, exec, overrides: { githubTokenPath: missing } })
    await exec.sandbox

    assert.equal(read.o1, true, 'green stays green — a missing token is never a false red')
    assert.equal(read.receiptsResolvable, true)
    assert.equal(detail.pullRequest, null)
    assert.ok(detail.errors.includes(`github-token missing at ${missing} — PR not opened`), JSON.stringify(detail.errors))
    assert.ok(!exec.cmds.some((c) => / push origin /.test(c)), 'nothing pushed without a token')
    assert.ok(!exec.cmds.some((c) => / gh pr create /.test(c)), 'no PR without a token')
    assert.ok(!fs.existsSync(path.join(tmp, `evidence-${runId}`, `pr-body-${runId}.md`)), 'no body file is written either')
    // …and the branch is still fetched and resolved locally exactly as before.
    assert.ok(exec.cmds.some((c) => new RegExp(` fetch ssh://\\S+ ${GREEN_BRANCH}$`).test(c)))
  }

  // -- P4. push failure: recorded, pullRequest null, no gh, read unchanged ---
  {
    const runId = 'run-pr-pushfail'
    const inner = makeExec((a) => greenSandbox({ runId, exec })(a))
    const exec = async (cmd, opts) => {
      if (/ push origin /.test(cmd)) {
        inner.cmds.push(cmd)
        inner.calls.push({ cmd, env: opts?.env ?? null })
        return { code: 128, stdout: `remote: Permission to popmechanic/ultrapowers.git denied (${GITHUB_TOKEN} would be a leak here)\n` }
      }
      return inner(cmd, opts)
    }
    exec.cmds = inner.cmds
    exec.calls = inner.calls
    const { read, detail } = await driveGreen({ runId, exec })
    await exec.sandbox

    assert.equal(read.o1, true, 'a failed push never reddens the read')
    assert.equal(detail.pullRequest, null)
    const pushErr = detail.errors.find((e) => e.startsWith(`push ${GREEN_BRANCH} to origin failed (code 128)`))
    assert.ok(pushErr, `expected the push failure on the record, got: ${JSON.stringify(detail.errors)}`)
    assert.ok(pushErr.includes('Permission to') && pushErr.includes('<redacted>') && !pushErr.includes(GITHUB_TOKEN), 'recorded output is token-scrubbed')
    assert.ok(!exec.cmds.some((c) => / gh pr create /.test(c)), 'no PR after a failed push')
    noTokenAnywhere(exec, detail)
  }

  // -- P5. gh failure: recorded, pullRequest null, read unchanged -------------
  {
    const runId = 'run-pr-ghfail'
    const exec = makeExec((a) => greenSandbox({ runId, exec })(a), {
      gh: { code: 1, stdout: 'GraphQL: Resource not accessible by integration (createPullRequest)\n' },
    })
    const { read, detail } = await driveGreen({ runId, exec })
    await exec.sandbox

    assert.equal(read.o1, true, 'a failed gh never reddens the read')
    assert.equal(detail.pullRequest, null)
    assert.ok(
      detail.errors.some((e) => e.startsWith(`gh pr create for ${GREEN_BRANCH} failed (code 1)`) && /Resource not accessible/.test(e)),
      `expected the gh failure on the record, got: ${JSON.stringify(detail.errors)}`,
    )
    // The push still happened — the branch is on origin even though no PR
    // wraps it; the operator can open one by hand.
    assert.equal((await sh(`git rev-parse refs/heads/${GREEN_BRANCH}`, originRepo)).stdout.trim(), greenTip)
    noTokenAnywhere(exec, detail)
  }

  // -- P6. a park that published nothing has no publish leg at all ----------
  {
    const runId = 'run-pr-park-empty'
    const exec = makeExec((assignment) => {
      setTimeout(() => {
        exec.sandbox = startStubSandbox({ assignment, runId, receiptSha: headSha, exec, publish: false, gateGreen: false })
      }, 30)
    })
    const { detail } = await driveOne({ ...driveDefaults, dbDir: path.join(tmp, `db-${runId}`), exec, runId })
    await exec.sandbox
    assert.equal(detail.status, 'parked')
    assert.equal(detail.parkedPublish, null)
    assert.equal(detail.pullRequest, null)
    assert.ok(!exec.cmds.some((c) => / push origin | gh pr create /.test(c)), 'nothing to publish → nothing pushed, no PR')
    assert.ok(!detail.errors.some((e) => /github-token|PR not opened/.test(e)), 'and no token noise for a run with nothing to publish')
  }

  // -- P7. an unsafe prBase is refused at entry, before any command ----------
  {
    const cmds = []
    await assert.rejects(
      driveOne({
        ...driveDefaults,
        dbDir: path.join(tmp, 'db-pr-unsafe-base'),
        runId: 'run-pr-unsafe-base',
        prBase: 'main; touch /tmp/fleet-pwned',
        exec: async (cmd) => {
          cmds.push(cmd)
          return { code: 0, stdout: '' }
        },
      }),
      /unsafe prBase/,
    )
    assert.deepEqual(cmds, [], 'refusal precedes every exec call')
    assert.equal(fs.existsSync(path.join(tmp, 'db-pr-unsafe-base')), false, 'refusal precedes the orchestrator start')
  }

  // -- P8. the pure helpers ---------------------------------------------------
  {
    // Closes: header only; bold-key and bare forms; de-duplicated; order kept.
    assert.deepEqual(parsePlanCloses(PLAN_TEXT), [318, 319, 320])
    assert.deepEqual(parsePlanCloses('# T\n\n**Closes:** #5 #5, #7\n'), [5, 7])
    assert.deepEqual(parsePlanCloses('# T\n\nCloses #12\ncloses: #13\n'), [12, 13])
    assert.deepEqual(parsePlanCloses('# T\n\n**Spec:** issues #1 and #2 are the spec.\n'), [], 'Spec lines never close')
    assert.deepEqual(parsePlanCloses('# T (#318 #319)\n'), [], 'title parentheticals never close')
    assert.deepEqual(parsePlanCloses(null), [])
    assert.deepEqual(parsePlanCloses(''), [])

    // Title: the H1, control characters stripped; the file name when absent.
    assert.equal(planTitleFrom(PLAN_TEXT, 'x.md'), 'Fleet PR Leg Implementation Plan (#368)')
    assert.equal(planTitleFrom('no heading here', 'docs/plans/2026-08-28-thing.md'), '2026-08-28-thing.md')
    assert.equal(planTitleFrom('# a\tb\nc\n', 'x.md'), 'a b')
    assert.equal(planTitleFrom(null, 'x.md'), 'x.md')
    assert.equal(pullRequestTitle({ runId: 'run-1', planText: PLAN_TEXT, planPath: 'x.md', parked: true }), '[parked] fleet run-1: Fleet PR Leg Implementation Plan (#368)')
    assert.equal(pullRequestTitle({ runId: 'run-1', planText: PLAN_TEXT, planPath: 'x.md', parked: false }), 'fleet run-1: Fleet PR Leg Implementation Plan (#368)')

    // Quoting: a title with a single quote survives `/bin/sh -c` intact.
    const quoted = await sh(`printf %s ${shellQuote(`it's "quoted" $HOME \`x\``)}`, tmp)
    assert.equal(quoted.stdout, `it's "quoted" $HOME \`x\``)

    // URL parse: the first PR url in gh's output, wherever it sits.
    assert.deepEqual(parsePullRequestUrl(`Creating pull request…\n${PR_URL}\n`), { url: PR_URL, number: 4242 })
    assert.equal(parsePullRequestUrl('no url here'), null)
    assert.equal(parsePullRequestUrl(''), null)

    // Body: an unreadable receipt says so; empty acks/checks/receipts render
    // as `none`; no Closes → no blank line before the trailer.
    const body = renderPullRequestBody({
      runId: 'run-x',
      planPath: 'p.md',
      branch: 'b',
      vmName: 'fleet-run-x',
      parked: false,
      receipt: null,
      receiptSource: 'deadbeef:fleet-receipts/run-x/gate-receipt.json',
      read: { o1: false, receiptsResolvable: false, leaseContinuity: true, versionStamp: true, spendObservational: { reported: null, ledger: 0 } },
      receipts: [],
      closes: [],
      errors: ['version cross-check unavailable: could not resolve x locally'],
    })
    assert.ok(body.includes('## Verdict: unknown'))
    assert.ok(body.includes('_gate receipt unreadable (deadbeef:fleet-receipts/run-x/gate-receipt.json)'))
    assert.ok(body.includes('## Checks (0)\n- none'))
    assert.ok(body.includes('## Receipts (0)\n- none'))
    assert.ok(body.includes('| spendObservational | reported null / ledger 0 |'))
    assert.ok(body.includes('## Driver notes (1)\n- version cross-check unavailable'))
    assert.ok(!body.includes('Closes #'))
    assert.ok(body.endsWith(`\n${TRAILER}\n`))
  }

  console.log('ALL TESTS PASSED')
} finally {
  cleanup()
}

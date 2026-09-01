// fleet/tests/test_drive_pr_runbook.mjs — sentinel-style spec for the PR
// body's POST-MERGE RUNBOOK section (#527): the release/manual tasks the
// compiler set aside, carried on the PR by id and title so the operator
// reading the merge knows what is still theirs to do.
//
// The runbook is NOT in `args.json` or `launch.json` — the compiler writes
// both from the `implementation` tasks alone, and `post_merge_runbook` is
// exactly the `release`/`manual` set. It lives in the compiler's stdout
// `result`, which `ultra_run.py` stores verbatim as `receipt["compile"]` in
// `run-<stamp>/receipt.json` — a file inside the sandbox evidence bundle the
// drive pulls BEFORE teardown, and therefore before the PR body is written.
// So the read is one `tar -xzO` through the injected `exec`, and no scenario
// here needs a tarball on disk.
//
// Own process, own copy of the `_drive_helpers.mjs` fixture (see its header):
// `test_drive_pr.mjs` already runs within reach of the suite's 120 s per-file
// cap, so this leg gets its own file. No network, no ssh, no `gh`.
//
// Scenarios:
//   R1  render: the section, its exact lines, and where it sits
//   R2  render: `[]`, `null` and an absent runbook leave the body byte-identical
//   R3  read: the ids joined to `tasks` titles, in TASKS order
//   R4  read: a tar that exits non-zero → null
//   R5  read: a receipt with no `compile` key → null
//   R6  render: a title carrying markdown is rendered verbatim
//   R7  end to end: the body carries the runbook the bundle named
//   R8  end to end: an unreadable bundle → no section, one Driver-notes line
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { driveOne, readRunbookFromBundle, renderPullRequestBody } from '../drive.mjs'
import { OLDER_BRANCH, setupDriveFixture, sh, writeFile } from './_drive_helpers.mjs'

const { tmp, repoDir, sandboxRepo, cleanup, makeExec, startStubSandbox, driveDefaults } = await setupDriveFixture()

const TRAILER = '🤖 Generated with [Claude Code](https://claude.com/claude-code)'

try {
  // -- the `test_drive_pr.mjs` P1 fixture shapes, as pure render arguments ---
  // Identical field-for-field to what the green scenario there hands the
  // renderer; the sha is a constant because the renderer only ever prints it.
  const PLAN_REL = 'docs/superpowers/plans/2026-08-28-pr-leg.md'
  const GREEN_BRANCH = 'ultra/integration-20260828000001'
  const RECEIPT_PATH = 'fleet-receipts/run-pr-green/gate-receipt.json'
  const RECEIPT_SHA = 'a'.repeat(40)
  const checks = ['report-parse', 'lock', 'clean-tree', 'wave-merges', 'head-match', 'git-verified', 'ancestry', 'deliverables'].map(
    (name) => ({ name, ok: true, detail: '' }),
  )
  const P1_ARGS = {
    runId: 'run-pr-green',
    planPath: PLAN_REL,
    branch: GREEN_BRANCH,
    vmName: 'fleet-run-pr-green',
    parked: false,
    receipt: {
      mode: 'gate',
      branch: GREEN_BRANCH,
      gateCheck: { verdict: 'PASS', checks, acks: [] },
      acceptance: { disposition: 'suite', exit: 0 },
      verdict: 'PASS',
      autoResolved: 1,
      completenessFindings: ['socket leak in shim teardown (run-14 precedent)'],
    },
    receiptSource: `${RECEIPT_SHA}:${RECEIPT_PATH}`,
    read: { o1: true, receiptsResolvable: true, leaseContinuity: true, versionStamp: true, spendObservational: { reported: 4200, ledger: 4200 } },
    receipts: [{ sha: RECEIPT_SHA, path: RECEIPT_PATH, verdict: 'PASS', resolved: true }],
    closes: [318, 319, 320],
    errors: [],
  }

  // The body those arguments rendered BEFORE this task — captured byte for
  // byte off the pre-#527 renderer. R2's whole claim is that a run with no
  // runbook still renders exactly this.
  const GOLDEN = [
    '# fleet run-pr-green — gate receipt',
    '',
    'Plan `docs/superpowers/plans/2026-08-28-pr-leg.md` · branch `ultra/integration-20260828000001` · sandbox `fleet-run-pr-green`',
    '',
    '## Verdict: PASS',
    '',
    '## Checks (8)',
    '- [x] report-parse',
    '- [x] lock',
    '- [x] clean-tree',
    '- [x] wave-merges',
    '- [x] head-match',
    '- [x] git-verified',
    '- [x] ancestry',
    '- [x] deliverables',
    '',
    '## Acks (0)',
    '- none',
    '',
    '## §W1d gate read',
    '',
    '| leg | value |',
    '|---|---|',
    '| o1 | true |',
    '| receiptsResolvable | true |',
    '| leaseContinuity | true |',
    '| versionStamp | true |',
    '| spendObservational | reported 4200 / ledger 4200 |',
    '',
    '## Spend',
    '',
    'reported: 4200 · ledger: 4200 (output tokens)',
    '',
    '## autoResolved: 1',
    '',
    '## Completeness-critic findings (1)',
    '',
    '### Blocking (0)',
    '- none',
    '',
    '### Minor (1)',
    '- socket leak in shim teardown (run-14 precedent)',
    '',
    '## Receipts (1)',
    '- `' + RECEIPT_SHA + '` `' + RECEIPT_PATH + '` — PASS, resolved',
    '',
    '_`autoResolved` and the completeness-critic findings render only when the receipt carries them; otherwise they live in `report.json` inside the evidence bundle, not on this branch._',
    '',
    'Closes #318',
    'Closes #319',
    'Closes #320',
    '',
    TRAILER,
    '',
  ].join('\n')

  // -- R1. the section: exact lines, in the given order, in its place -------
  {
    const runbook = [
      { id: '5', title: 'Deploy' },
      { id: '6', title: 'Rotate the key' },
    ]
    const body = renderPullRequestBody({ ...P1_ARGS, runbook })
    const SECTION = '## Post-merge runbook (2)\n- 5 — Deploy\n- 6 — Rotate the key\n'

    // The WHOLE body: the golden with exactly this block spliced in ahead of
    // `## Receipts` — which pins the section's bytes, its position and the
    // fact that nothing else moved, in one equality.
    assert.equal(body, GOLDEN.replace('## Receipts (1)', `${SECTION}\n## Receipts (1)`))
    assert.ok(body.includes(`\n${SECTION}\n`), `the section renders as one block: ${body}`)
    assert.ok(
      body.indexOf('## Completeness-critic findings') < body.indexOf('## Post-merge runbook'),
      'the runbook follows the completeness-critic findings',
    )
    assert.ok(body.indexOf('## Post-merge runbook') < body.indexOf('## Receipts'), 'the runbook precedes the receipts')
    assert.ok(body.endsWith(`\n${TRAILER}\n`))

    // …and when the findings are absent it sits after whatever section came
    // before them, still immediately ahead of `## Receipts`.
    const noFindings = { ...P1_ARGS, receipt: { ...P1_ARGS.receipt, completenessFindings: undefined } }
    const body2 = renderPullRequestBody({ ...noFindings, runbook })
    assert.ok(!body2.includes('## Completeness-critic findings'), 'precondition: no findings section')
    assert.equal(
      renderPullRequestBody(noFindings).replace('## Receipts (1)', `${SECTION}\n## Receipts (1)`),
      body2,
      'with no findings the runbook still lands directly before the receipts, and nothing else moves',
    )
    assert.ok(body2.indexOf('## autoResolved: 1') < body2.indexOf('## Post-merge runbook'), 'after the section preceding the findings')

    // Order is the caller's, never sorted.
    const reversed = renderPullRequestBody({ ...P1_ARGS, runbook: [runbook[1], runbook[0]] })
    assert.ok(reversed.includes('## Post-merge runbook (2)\n- 6 — Rotate the key\n- 5 — Deploy\n'), `given order kept: ${reversed}`)
  }

  // -- R2. no runbook: the body is byte-identical to today's ----------------
  {
    assert.equal(renderPullRequestBody(P1_ARGS), GOLDEN, 'an absent runbook changes nothing')
    assert.equal(renderPullRequestBody({ ...P1_ARGS, runbook: [] }), GOLDEN, 'an EMPTY runbook renders no section — the common case')
    assert.equal(renderPullRequestBody({ ...P1_ARGS, runbook: null }), GOLDEN, 'a null runbook renders no section')
    for (const body of [renderPullRequestBody(P1_ARGS), renderPullRequestBody({ ...P1_ARGS, runbook: [] })]) {
      assert.ok(!body.includes('Post-merge runbook'), 'not even the heading, and never an empty section')
    }
    // A malformed runbook renders a body rather than throwing.
    let malformed
    assert.doesNotThrow(() => {
      malformed = renderPullRequestBody({ ...P1_ARGS, runbook: [null, { id: '9' }] })
    }, 'the renderer never throws on a malformed runbook entry')
    assert.ok(malformed.includes('## Post-merge runbook (2)\n-  — \n- 9 — \n'), `malformed entries still render: ${malformed}`)
  }

  // -- R3. the read: ids joined to titles, in TASKS order -------------------
  {
    const TGZ = '/tmp/evidence/sandbox-logs/fleet-run-x-1/sandbox-logs.tgz'
    const receipt = {
      ok: true,
      compile: {
        tasks: [
          { id: '1', title: 'Code', disposition: 'implementation' },
          { id: '5', title: 'Deploy', disposition: 'release' },
          { id: '6', title: 'Rotate the key', disposition: 'manual' },
        ],
        post_merge_runbook: ['5', '6'],
      },
    }
    const stub = (answer) => {
      const exec = async (cmd) => {
        exec.cmds.push(cmd)
        return answer
      }
      exec.cmds = []
      return exec
    }

    const exec = stub({ code: 0, stdout: JSON.stringify(receipt, null, 2) })
    assert.deepEqual(await readRunbookFromBundle(TGZ, exec), [
      { id: '5', title: 'Deploy' },
      { id: '6', title: 'Rotate the key' },
    ])
    // ONE command, and exactly this one: the member is matched inside the
    // archive (tar's own wildcards), never by a shell glob on the host.
    assert.deepEqual(exec.cmds, [`tar -xzOf '${TGZ}' --wildcards 'repo/.claude/ultrapowers/run-*/receipt.json'`])

    // The runbook's own order is NOT the render order: the plan's is.
    const reversed = { ...receipt, compile: { ...receipt.compile, post_merge_runbook: ['6', '5'] } }
    assert.deepEqual(await readRunbookFromBundle(TGZ, stub({ code: 0, stdout: JSON.stringify(reversed) })), [
      { id: '5', title: 'Deploy' },
      { id: '6', title: 'Rotate the key' },
    ])

    // The empty runbook — the common case — is an empty list, not a failure.
    const empty = { ...receipt, compile: { ...receipt.compile, post_merge_runbook: [] } }
    assert.deepEqual(await readRunbookFromBundle(TGZ, stub({ code: 0, stdout: JSON.stringify(empty) })), [])

    // An id with no task carrying it is dropped, not rendered as a hole.
    const ghost = { ...receipt, compile: { ...receipt.compile, post_merge_runbook: ['5', '404'] } }
    assert.deepEqual(await readRunbookFromBundle(TGZ, stub({ code: 0, stdout: JSON.stringify(ghost) })), [{ id: '5', title: 'Deploy' }])
  }

  // -- R4. a tar that fails is a null, never a throw ------------------------
  {
    const failing = async () => ({ code: 2, stdout: '', stderr: 'tar: repo/.claude/ultrapowers/run-*/receipt.json: Not found in archive\n' })
    assert.equal(await readRunbookFromBundle('/tmp/no-such.tgz', failing), null)
    assert.equal(await readRunbookFromBundle('/tmp/no-such.tgz', async () => ({ code: 0, stdout: 'not json at all' })), null)
    assert.equal(
      await readRunbookFromBundle('/tmp/no-such.tgz', async () => {
        throw new Error('exec blew up')
      }),
      null,
      'a throwing exec is a null too — this read never propagates',
    )
    assert.equal(await readRunbookFromBundle(null, failing), null, 'no bundle, no read')
  }

  // -- R5. a receipt with no `compile` key is a null ------------------------
  {
    const answer = (obj) => async () => ({ code: 0, stdout: JSON.stringify(obj) })
    const TGZ = '/tmp/b.tgz'
    assert.equal(await readRunbookFromBundle(TGZ, answer({ ok: true, baseBranch: 'main', stages: [] })), null)
    assert.equal(await readRunbookFromBundle(TGZ, answer({ compile: null })), null)
    assert.equal(await readRunbookFromBundle(TGZ, answer({ compile: { tasks: [] } })), null, 'a compile with no runbook key is unreadable, not empty')
    assert.equal(await readRunbookFromBundle(TGZ, answer({ compile: { post_merge_runbook: ['5'] } })), null, 'a compile with no tasks is unreadable too')
  }

  // -- R6. a title carrying markdown is rendered verbatim -------------------
  {
    const title = 'Tag `v2` and **announce** — see [#527](x) <br> $(rm -rf /)'
    const body = renderPullRequestBody({ ...P1_ARGS, runbook: [{ id: '9', title }] })
    const line = body.split('\n').find((l) => l.startsWith('- 9 '))
    assert.equal(line, `- 9 — ${title}`, 'the title is neither escaped nor interpreted')
    assert.ok(body.includes(`## Post-merge runbook (1)\n- 9 — ${title}\n`))
  }

  // -- the end-to-end fixture: the `test_drive_pr.mjs` P1 drive -------------
  const PLAN_TEXT =
    '# Fleet PR Leg Implementation Plan (#368)\n\n' +
    '**Goal:** the orchestrator opens the PR.\n\n' +
    '**Closes:** #318\n\n' +
    '### Task 1: Code\n**Type:** implementation\n**Depends-on:** none\n\n' +
    '**Files:**\n- Modify: `fleet/x.mjs`\n- Test: `fleet/tests/test_x.mjs`\n\n- [ ] **Step 1: edit**\n'
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

  const GREEN_RECEIPT = {
    mode: 'gate',
    branch: GREEN_BRANCH,
    gateCheck: { verdict: 'PASS', checks, acks: [] },
    verdict: 'PASS',
  }
  const greenReceiptPath = 'fleet-receipts/run-pr-green/gate-receipt.json'
  await sh(`git checkout -q main && git checkout -q -b ${GREEN_BRANCH}`, sandboxRepo)
  writeFile(sandboxRepo, greenReceiptPath, JSON.stringify(GREEN_RECEIPT, null, 2))
  {
    const r = await sh(
      `git add -A && GIT_COMMITTER_DATE='2031-01-01T00:00:00Z' git -c commit.gpgsign=false commit -q -m "fleet: receipts" && ` +
        `git -c commit.gpgsign=false merge -q --no-ff -m "fold" ${OLDER_BRANCH}`,
      sandboxRepo,
    )
    assert.equal(r.code, 0, `green-branch fixture failed: ${r.stderr}`)
  }
  const greenTip = (await sh(`git rev-parse ${GREEN_BRANCH}`, sandboxRepo)).stdout.trim()
  const greenReceiptSha = (await sh(`git rev-list --parents -1 ${greenTip}`, sandboxRepo)).stdout.trim().split(/\s+/)[1]

  // The sandbox bundle's receipt.json: the compiler `result` `ultra_run.py`
  // stores verbatim under `compile` — one release task set aside.
  const BUNDLE_RECEIPT = {
    ok: true,
    stamp: '20260828000001',
    compile: {
      tasks: [
        { id: '1', title: 'Code', disposition: 'implementation' },
        { id: '5', title: 'Deploy', disposition: 'release' },
      ],
      post_merge_runbook: ['5'],
      waves: [['1']],
    },
  }

  // The drive, with the bundle read answered by `answerTar`. Everything else
  // is the shared fixture's exec: real git, stubbed ssh and `gh`.
  const driveWithBundle = async ({ runId, answerTar }) => {
    const inner = makeExec((assignment) => {
      setTimeout(() => {
        exec.sandbox = startStubSandbox({
          assignment,
          runId,
          receiptSha: greenReceiptSha,
          receiptPath: greenReceiptPath,
          exec,
          branch: GREEN_BRANCH,
          stamp: { pluginVersion: '9.9.9', engineSha: planSha },
        })
      }, 30)
    })
    const exec = async (cmd, opts) => {
      if (cmd.startsWith('tar ')) {
        inner.cmds.push(cmd)
        inner.calls.push({ cmd, env: opts?.env ?? null })
        return answerTar(cmd)
      }
      return inner(cmd, opts)
    }
    exec.cmds = inner.cmds
    exec.calls = inner.calls
    const result = await driveOne({
      ...driveDefaults,
      planPath: PLAN_REL,
      baseRef: 'plan-pr',
      dbDir: path.join(tmp, `db-${runId}`),
      evidenceDir: path.join(tmp, `evidence-${runId}`),
      exec,
      runId,
    })
    await exec.sandbox
    return { ...result, exec, body: fs.readFileSync(path.join(tmp, `evidence-${runId}`, `pr-body-${runId}.md`), 'utf8') }
  }

  // Everything below a heading, up to and including the blank line that ends
  // the section — so two bodies can be compared with a section lifted out.
  const dropSection = (body, heading) => {
    const start = body.indexOf(heading)
    if (start < 0) return body
    const end = body.indexOf('\n\n', start)
    assert.ok(end > start, `section ${heading} must end in a blank line`)
    return body.slice(0, start) + body.slice(end + 2)
  }

  // -- R7. end to end: the body carries the runbook the bundle named --------
  const GREEN_RUN = 'run-pr-runbook'
  const green = await driveWithBundle({
    runId: GREEN_RUN,
    answerTar: async () => ({ code: 0, stdout: JSON.stringify(BUNDLE_RECEIPT, null, 2) }),
  })
  {
    const { read, detail, body, exec } = green
    assert.deepEqual(read, {
      o1: true,
      receiptsResolvable: true,
      leaseContinuity: true,
      versionStamp: true,
      spendObservational: { reported: 4200, ledger: 4200 },
    })
    assert.equal(detail.pullRequest?.draft, false, 'the green PR still opens')
    // The read went at the bundle the pre-teardown pull landed, exactly once.
    const tars = exec.cmds.filter((c) => c.startsWith('tar '))
    assert.deepEqual(
      tars,
      [`tar -xzOf '${detail.sandboxLogs}' --wildcards 'repo/.claude/ultrapowers/run-*/receipt.json'`],
      'one bundle read, at detail.sandboxLogs',
    )
    const tarIdx = exec.cmds.indexOf(tars[0])
    const ghIdx = exec.cmds.findIndex((c) => / gh pr create /.test(c))
    assert.ok(tarIdx >= 0 && ghIdx > tarIdx, 'the bundle is read BEFORE the PR is opened')

    assert.ok(body.includes('## Post-merge runbook (1)\n- 5 — Deploy\n'), `the runbook rides the body: ${body}`)
    assert.ok(body.indexOf('## Post-merge runbook') < body.indexOf('## Receipts'), 'in its place')
    assert.ok(!detail.errors.some((e) => /post-merge runbook/.test(e)), `a read that worked says nothing: ${JSON.stringify(detail.errors)}`)
  }

  // -- R8. end to end: an unreadable bundle → no section, ONE notes line ----
  {
    const runId = 'run-pr-runbook-fail'
    const { read, detail, body } = await driveWithBundle({
      runId,
      answerTar: async () => ({ code: 2, stdout: '', stderr: 'tar: Not found in archive\n' }),
    })
    assert.deepEqual(read, green.read, 'an unreadable runbook never touches the gate read')
    assert.equal(detail.pullRequest?.draft, false, 'and the PR still opens')
    assert.ok(!body.includes('## Post-merge runbook'), `no section, and no empty one: ${body}`)

    const notes = detail.errors.filter((e) => e.startsWith('post-merge runbook:'))
    assert.equal(notes.length, 1, `exactly one line names the runbook read, got: ${JSON.stringify(detail.errors)}`)
    assert.equal(notes[0], `post-merge runbook: unreadable in ${detail.sandboxLogs} — omitted from this PR`)
    assert.ok(body.includes(`\n- ${notes[0]}\n`), `the note rides the body's Driver notes: ${body}`)

    // The runId is the only thing that legitimately differs between the two
    // runs' text (it names the VM, the report and the stat artifact).
    const normalize = (text, id) => String(text).split(id).join('<run>')

    // The record: R7's notes, plus this ONE line, appended and nothing else.
    assert.deepEqual(
      detail.errors.map((e) => normalize(e, runId)),
      [...green.detail.errors.map((e) => normalize(e, GREEN_RUN)), normalize(notes[0], runId)],
      'the unreadable bundle costs exactly one line on the record',
    )

    // Verdict, checks and every other section: byte-identical to R7's, once
    // the runbook section and the driver's notes are lifted out of both.
    const withoutBoth = (text) => dropSection(dropSection(text, '## Post-merge runbook'), '## Driver notes')
    assert.equal(
      normalize(withoutBoth(body), runId),
      normalize(withoutBoth(green.body), GREEN_RUN),
      'nothing but the runbook and its note differs',
    )
  }

  console.log('ALL TESTS PASSED')
} finally {
  cleanup()
}

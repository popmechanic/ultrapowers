// fleet/tests/test_drive_pr_rescue.mjs — the park card carries the rescue
// (#524 item 3, #497).
//
// `renderPullRequestBody` is pure, so this spec calls it directly with the
// `test_drive_pr.mjs` P8 fixture shapes: no sandbox, no network, no ssh, no
// `gh`. What is under test is one optional parameter and one section.
//
// The claim: a PARKED run whose `errors` carry a `push … to origin failed`
// or `gh pr create … failed` entry gets a `## Rescue` section holding ONE
// fenced `bash` block, and that block names the pinned ref
// `refs/fleet/<runId>`, the fetched tip sha, the integration branch and the
// orchestrator host — the four things #497's run-44 comment spelled out in
// prose and never as a literal block. Anything else — a park without such an
// error, or any green body — renders no `## Rescue` at all.
//
// Legs:
//   R1  parked + push failure   → the block, verbatim
//   R2  parked + gh failure     → the block
//   R3  parked, neither failure → no section
//   R4  green + a rescue object → no section
//   R5  section order: after `## Driver notes`, before the `Closes` lines
//   R6  a tip carrying shell metacharacters is refused, never interpolated
//   R7  fleet/RUNBOOK.md carries the same four commands
//   R8  `orchestratorHost` — the host the card names, and its total fallback
//   R9  END TO END: a real parked drive whose `gh pr create` fails leaves the
//       section in the card ON DISK, with this run's real ref/sha/branch/host
//   R10 END TO END: the same for a failed PUSH; and a drive that publishes
//       cleanly leaves a card with no `## Rescue` in it at all
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { driveOne, isSafeVmName, orchestratorHost, renderPullRequestBody } from '../drive.mjs'
import { INTEGRATION_BRANCH, RECEIPT_PATH, setupDriveFixture, sh } from './_drive_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TRAILER = '🤖 Generated with [Claude Code](https://claude.com/claude-code)'

const RUN_ID = 'run-9'
const BRANCH = 'ultra/integration-run-9'
const HOST = 'fleet-orchestrator.exe.xyz'
const TIP = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
// #575: the pin lives in the TARGET's cache clone, so the card names the target.
const TARGET = 'octo/widgets'
const CACHE = '/home/exedev/targets/octo--widgets'
const RESCUE = { runId: RUN_ID, tip: TIP, branch: BRANCH, host: HOST, target: TARGET }

// The two real failure texts, in the shape `driveOne`'s publish leg pushes
// onto `errors`, already scrubbed of the token. R9/R10 below assert against
// the texts the drive really produces, so these two cannot drift silently.
const PUSH_ERROR =
  `push ${BRANCH} to origin failed (code 128) fatal: refusing to allow an OAuth App to create or ` +
  'update workflow `.github/workflows/ci.yml` without `workflow` scope'
const GH_ERROR = `gh pr create for ${BRANCH} failed (code 1) GraphQL: Resource not accessible by integration`
const OTHER_ERROR = 'version cross-check unavailable: could not resolve x locally'

// The P8 parked fixture shape, verbatim in every field the rescue leg does
// not own.
const PARKED_RECEIPT = {
  mode: 'gate',
  branch: BRANCH,
  gateCheck: {
    verdict: 'NEEDS_ACK',
    checks: [{ name: 'acceptance', ok: false, detail: 'ack required' }],
    acks: [{ type: 'deferred:manual', detail: 'the #345 adoption verdict is the operator\'s call at integration' }],
  },
  verdict: 'NEEDS_ACK',
}

// `rescue: undefined` is a case under test, so it is read off the options
// object rather than defaulted by destructuring.
const body = (opts = {}) => {
  const { parked = true, errors = [PUSH_ERROR], closes = [524] } = opts
  return renderPullRequestBody({
    runId: RUN_ID,
    planPath: 'docs/superpowers/plans/2026-08-31-park-rescue.md',
    branch: BRANCH,
    vmName: `fleet-${RUN_ID}`,
    parked,
    receipt: PARKED_RECEIPT,
    receiptSource: `${TIP}:fleet-receipts/${RUN_ID}/gate-receipt.json`,
    read: { o1: true, receiptsResolvable: true, leaseContinuity: true, versionStamp: true, spendObservational: { reported: 1, ledger: 1 } },
    receipts: [],
    closes,
    errors,
    rescue: 'rescue' in opts ? opts.rescue : RESCUE,
  })
}

/** The `## Rescue` section's single fenced block, or null when there is none. */
const rescueBlock = (text) => {
  const start = text.indexOf('## Rescue\n')
  if (start < 0) return null
  const section = text.slice(start, text.indexOf('\n## ', start + 1) >= 0 ? text.indexOf('\n## ', start + 1) : undefined)
  const fences = [...section.matchAll(/```bash\n([\s\S]*?)```/g)]
  assert.equal(fences.length, 1, `exactly one fenced bash block in the Rescue section: ${section}`)
  return fences[0][1]
}

// The block, to the byte. The four commands are the four steps of #497's
// run-44 comment; nothing here is computed, every value is one the drive
// already held.
const EXPECTED_BLOCK = `# 1. the run tip is already pinned on the orchestrator (#497) — confirm it
ssh ${HOST} 'cd ${CACHE} && git rev-parse refs/fleet/${RUN_ID}'
#    expect ${TIP}
# 2. fetch that pinned ref to your laptop over ssh
git fetch ssh://exedev@${HOST}${CACHE} refs/fleet/${RUN_ID}:refs/heads/${BRANCH}
# 3. push it with an operator credential — the drive's token could not
git push origin ${BRANCH}
# 4. open the PR by hand, carrying this gate receipt as the body
gh pr create --draft --head ${BRANCH} --title '[parked] fleet ${RUN_ID}' --body-file pr-body-${RUN_ID}.md
`

// -- R1: parked + a push failure renders the block, verbatim ----------------
{
  const text = body()
  assert.ok(text.includes('## Rescue\n'), `the section renders: ${text}`)
  assert.equal(rescueBlock(text), EXPECTED_BLOCK)
  // The four values, present in the block itself and not merely in the prose.
  const block = rescueBlock(text)
  for (const value of [`refs/fleet/${RUN_ID}`, TIP, BRANCH, HOST, CACHE]) {
    assert.ok(block.includes(value), `the block names ${value}: ${block}`)
  }
  assert.ok(!block.includes('/home/exedev/repo'), `the engine checkout holds no run refs (#575): ${block}`)
  assert.ok(text.endsWith(`\n${TRAILER}\n`))
}

// -- R2: parked + a `gh pr create` failure renders the same block -----------
{
  const text = body({ errors: [GH_ERROR] })
  assert.equal(rescueBlock(text), EXPECTED_BLOCK)
  // …and so does the pair of them, once.
  assert.equal(rescueBlock(body({ errors: [OTHER_ERROR, PUSH_ERROR, GH_ERROR] })), EXPECTED_BLOCK)
}

// -- R3: parked with neither failure renders no section ---------------------
{
  for (const errors of [[], [OTHER_ERROR], ['fetch ultra/integration-run-9 failed (code 128)']]) {
    const text = body({ errors })
    assert.ok(!text.includes('## Rescue'), `no rescue without a publish failure: ${text}`)
    assert.ok(!text.includes('refs/fleet/'), `and no stray pinned ref: ${text}`)
  }
}

// -- R4: a green body renders no section, even handed a rescue object -------
{
  for (const errors of [[PUSH_ERROR], [GH_ERROR]]) {
    const text = body({ parked: false, errors })
    assert.ok(!text.includes('## Rescue'), `green bodies never carry the rescue: ${text}`)
  }
}

// -- R5: order — after `## Driver notes`, before the `Closes` lines ---------
{
  const text = body({ errors: [OTHER_ERROR, PUSH_ERROR] })
  const notes = text.indexOf('## Driver notes')
  const rescue = text.indexOf('## Rescue')
  const closes = text.indexOf('Closes #524')
  assert.ok(notes >= 0 && rescue >= 0 && closes >= 0, `all three present: ${text}`)
  assert.ok(notes < rescue, 'the rescue sits after the driver notes')
  assert.ok(rescue < closes, 'the rescue sits before the Closes lines')
  // The sections that were there before are still there, in their old order.
  const order = ['# fleet run-9 — parked gate receipt', '## Acks required (1)', '## Verdict: NEEDS_ACK', '## Checks (1)', '## §W1d gate read', '## Spend', '## Receipts (0)', '## Driver notes (2)', '## Rescue']
  let at = -1
  for (const heading of order) {
    const next = text.indexOf(heading)
    assert.ok(next > at, `${heading} keeps its place: ${text}`)
    at = next
  }
}

// -- R6: an unsafe tip is refused, never interpolated -----------------------
{
  for (const tip of ['abc; rm -rf /', '$(cat /etc/passwd)', '`id`', 'HEAD~1', '', null]) {
    const text = body({ rescue: { ...RESCUE, tip } })
    assert.ok(!text.includes('## Rescue'), `no block for tip ${JSON.stringify(tip)}: ${text}`)
    assert.ok(!text.includes('```bash'), `no fenced block at all: ${text}`)
    if (typeof tip === 'string' && tip.length > 0) assert.ok(!text.includes(`refs/heads/${BRANCH}`), 'no rescue command survived')
    const line = text.split('\n').find((l) => l.startsWith('- rescue block omitted'))
    assert.ok(line, `a driver note names the refusal: ${text}`)
    assert.ok(line.includes('tip') && line.includes(JSON.stringify(tip)), `the note names the offending tip: ${line}`)
    // The heading's count still equals the number of notes rendered.
    const heading = text.split('\n').find((l) => l.startsWith('## Driver notes'))
    assert.equal(heading, '## Driver notes (2)', `the count includes the refusal: ${heading}`)
  }
  // The other four fields are validated the same way.
  for (const [field, value] of [['branch', 'ultra/integration; id'], ['runId', '../../etc'], ['host', 'orchestrator.exe.xyz; id'], ['target', 'a/b/c'], ['target', 'octo/widgets; id']]) {
    const text = body({ rescue: { ...RESCUE, [field]: value } })
    assert.ok(!text.includes('## Rescue'), `no block for ${field} ${JSON.stringify(value)}: ${text}`)
    const line = text.split('\n').find((l) => l.startsWith('- rescue block omitted'))
    assert.ok(line && line.includes(field) && line.includes(JSON.stringify(value)), `the note names ${field}: ${line}`)
  }
  // A missing rescue object is not a refusal — it is simply no section.
  for (const rescue of [undefined, null]) {
    const text = body({ rescue })
    assert.ok(!text.includes('## Rescue'), 'no rescue object, no section')
    assert.ok(!text.includes('rescue block omitted'), 'and no refusal note either')
    assert.equal(text.split('\n').find((l) => l.startsWith('## Driver notes')), '## Driver notes (1)')
  }
}

// -- R7: the RUNBOOK carries the same four commands ------------------------
// The card and the RUNBOOK must not drift: §Park triage step 3 already says
// the tip is pinned, so it is where the four steps belong.
{
  const runbook = fs.readFileSync(path.join(HERE, '..', 'RUNBOOK.md'), 'utf8')
  const triage = runbook.slice(runbook.indexOf('## Park triage'), runbook.indexOf('## Teardown guarantee'))
  assert.ok(triage.length > 0, 'the Park triage section is findable')
  for (const verb of ['refs/fleet/', 'git fetch ssh://', 'git push origin', 'gh pr create']) {
    assert.ok(triage.includes(verb), `§Park triage carries \`${verb}\`: ${triage}`)
  }
  // The two shapes the card prints, spelled the same way in the RUNBOOK.
  // #575: the RUNBOOK spells the cache clone with the literal placeholder in
  // both positions the card fills from `target`.
  assert.ok(triage.includes("cd /home/exedev/targets/<owner>--<repo> && git rev-parse refs/fleet/run-<N>"), 'the confirm line names the target cache')
  assert.ok(/git fetch ssh:\/\/exedev@fleet-orchestrator\.exe\.xyz\/home\/exedev\/targets\/<owner>--<repo> refs\/fleet\//.test(triage), 'the fetch line matches the card')
  assert.ok(triage.includes('```bash'), 'the four steps are a fenced bash block')
}

// -- R8: the host the card names -------------------------------------------
// The rescue fetches from the ORCHESTRATOR, which is the machine `drive.mjs`
// itself runs on — so the host is read off it, not baked. The fallback is
// total: every answer passes `isSafeVmName`, because a hostname the renderer
// would refuse must cost the operator a wrong string, never the whole block.
{
  assert.equal(orchestratorHost('fleet-orchestrator'), 'fleet-orchestrator.exe.xyz', 'a bare exe.dev name gets the domain')
  assert.equal(orchestratorHost('fleet-orch.exe.xyz'), 'fleet-orch.exe.xyz', 'a name that already has one is used as-is')
  assert.equal(orchestratorHost('fleet-orchestrator.'), 'fleet-orchestrator.exe.xyz', 'a trailing root dot is not a domain')
  // `undefined` is NOT in this list on purpose: it is the parameter's default,
  // which is the ambient hostname — the production path, asserted just below.
  for (const bad of ['', '   ', null, 'a host; id', '$(id)', 'x'.repeat(200)]) {
    assert.equal(orchestratorHost(bad), 'fleet-orchestrator.exe.xyz', `${JSON.stringify(bad)} falls back to the RUNBOOK's name`)
  }
  // The invariant the card depends on: whatever this machine is called, the
  // answer is printable — so R9/R10 below are the same test everywhere.
  assert.ok(isSafeVmName(orchestratorHost()), `the ambient answer is always printable, got ${orchestratorHost()}`)
  assert.equal(rescueBlock(body({ rescue: { ...RESCUE, host: orchestratorHost() } })).includes(orchestratorHost()), true)
}

// -- R9/R10: the wiring, end to end ----------------------------------------
// The legs above call the renderer directly. These two drive `driveOne` for
// real — a real parked run, a real fetch, a real pin, a real `git push` — and
// read the card OFF DISK. They are the legs that would have failed before the
// publish leg re-rendered its body: the card is written BEFORE the push and
// the `gh pr create`, so the failures that make a rescue necessary land on
// `errors` after it, and a snapshot card can neither carry them nor the
// section they gate.
{
  const fixture = await setupDriveFixture()
  const { tmp, repoDir, cacheDir, integrationSha, unreachableSha, makeExec, startStubSandbox, driveDefaults, cleanup } = fixture
  try {
    // A parked run that publishes: status `parked` + a receipt row is what
    // makes the drive fetch the branch, pin `refs/fleet/<runId>` and reach the
    // publish leg with a draft park card to open.
    const parkedDrive = async ({ runId, gh, before = async () => {} }) => {
      let sandbox = null
      const exec = makeExec(
        (assignment) => {
          setTimeout(() => {
            sandbox = startStubSandbox({
              assignment,
              runId,
              receiptSha: integrationSha,
              receiptPath: RECEIPT_PATH,
              exec,
              branch: INTEGRATION_BRANCH,
              gateGreen: false,
            })
          }, 30)
        },
        { gh },
      )
      await before()
      const dbDir = path.join(tmp, `db-${runId}`)
      const { detail } = await driveOne({ ...driveDefaults, parkedPublishWaitMs: 8_000, dbDir, exec, runId })
      await sandbox
      const evidenceDir = `${dbDir}-evidence`
      const cardPath = path.join(evidenceDir, `pr-body-${runId}.md`)
      return { detail, cardPath, evidenceDir, card: fs.readFileSync(cardPath, 'utf8'), exec }
    }

    // The four values the block must name, for a REAL run — none of them
    // invented by the card: the pinned ref is the one the drive wrote, the tip
    // is the sha it fetched, the branch is the one the sandbox published.
    const assertCarriesRescue = async ({ card, runId }) => {
      assert.ok(card.includes('\n## Rescue\n'), `the card on disk carries the section:\n${card}`)
      const block = rescueBlock(card)
      // #575: the pin is in the TARGET's cache clone — the fetch wrote it.
      const tip = (await sh(`git -C "${cacheDir}" rev-parse --verify refs/fleet/${runId}`)).stdout.trim()
      assert.match(tip, /^[0-9a-f]{40}$/, 'the drive really pinned refs/fleet/<runId>')
      assert.equal(tip, integrationSha, 'and it pinned the tip the sandbox integrated')
      for (const value of [`refs/fleet/${runId}`, tip, INTEGRATION_BRANCH, orchestratorHost()]) {
        assert.ok(block.includes(value), `the block names ${value}:\n${block}`)
      }
      // Every one of the four steps, in order, with this run's values in them.
      // The card names the operator's box — `/home/exedev/targets/<owner>--<repo>`
      // — spelled from the target, not this process's `targetsDir`.
      assert.ok(block.includes(`ssh ${orchestratorHost()} 'cd /home/exedev/targets/octo--widgets && git rev-parse refs/fleet/${runId}'`), block)
      assert.ok(block.includes(`git fetch ssh://exedev@${orchestratorHost()}/home/exedev/targets/octo--widgets refs/fleet/${runId}:refs/heads/${INTEGRATION_BRANCH}`), block)
      assert.ok(block.includes(`git push origin ${INTEGRATION_BRANCH}`), block)
      assert.ok(block.includes(`gh pr create --draft --head ${INTEGRATION_BRANCH}`), block)
    }

    // -- R9: `gh pr create` refuses ------------------------------------------
    {
      const runId = 'run-rescue-gh'
      const { detail, card } = await parkedDrive({ runId, gh: { code: 1, stdout: '', stderr: 'GraphQL: Resource not accessible by integration' } })
      assert.equal(detail.status, 'parked')
      assert.equal(detail.pullRequest, null, 'the PR was refused — this IS the case the rescue answers')
      const failure = detail.errors.find((e) => e.startsWith(`gh pr create for ${INTEGRATION_BRANCH} failed`))
      assert.ok(failure, `the failure is on the record: ${JSON.stringify(detail.errors)}`)
      await assertCarriesRescue({ card, runId })
      // …and the notes the section sits under are no longer a snapshot taken
      // before the failure. This is the staleness the section exposed.
      assert.ok(card.includes(`- ${failure}`), `the card's Driver notes carry the publish failure itself:\n${card}`)
      const heading = card.split('\n').find((l) => l.startsWith('## Driver notes'))
      assert.equal(heading, `## Driver notes (${detail.errors.length})`, `the count matches the settled errors: ${heading}`)
    }

    // -- R10a: the push refuses (run-33's shape: no `workflow` scope) --------
    // origin's copy of the run branch is force-parked on an unrelated commit,
    // so the real `git push origin <sha>:refs/heads/<branch>` is rejected as a
    // non-fast-forward by git itself — locally, with no network, and with
    // origin still reachable for the preflight's (fatal, #575) `fetch origin`.
    // `gh pr create` is never reached.
    {
      const runId = 'run-rescue-push'
      const { detail, card, exec } = await parkedDrive({
        runId,
        gh: { code: 0, stdout: 'https://github.com/popmechanic/ultrapowers/pull/1\n' },
        before: async () => {
          const parked = await sh(`git -C "${repoDir}" push -q origin +${unreachableSha}:refs/heads/${INTEGRATION_BRANCH}`, tmp)
          assert.equal(parked.code, 0, `could not park origin's branch: ${parked.stderr}`)
        },
      })
      assert.equal(detail.pullRequest, null)
      assert.ok(
        detail.errors.some((e) => e.startsWith(`push ${INTEGRATION_BRANCH} to origin failed`)),
        `the push really failed: ${JSON.stringify(detail.errors)}`,
      )
      assert.ok(!exec.cmds.some((c) => / gh pr create /.test(c)), 'and `gh pr create` was never reached')
      await assertCarriesRescue({ card, runId })
    }

    // -- R10b: a park that publishes cleanly carries no rescue ---------------
    // The re-render must be a no-op when nothing failed: the bytes `gh` was
    // handed are the bytes left on disk.
    {
      const runId = 'run-rescue-ok'
      const restored = await sh(`git -C "${repoDir}" push -q origin :refs/heads/${INTEGRATION_BRANCH}`, tmp)
      assert.equal(restored.code, 0, `could not clear origin's branch: ${restored.stderr}`)
      const { detail, card, evidenceDir } = await parkedDrive({ runId, gh: { code: 0, stdout: 'https://github.com/popmechanic/ultrapowers/pull/4243\n' } })
      assert.equal(detail.pullRequest?.number, 4243, `the draft park card opened: ${JSON.stringify(detail.errors)}`)
      assert.ok(!card.includes('## Rescue'), `a published park card carries no rescue:\n${card}`)
      assert.ok(!card.includes('```bash'), 'and no rescue commands anywhere in it')
      // #543 put the pinned ref on EVERY card, so "no stray ref" narrowed to
      // what this leg is about: the one mention is the standing #543 sentence
      // — a fact, not the recovery block a failed publish would print.
      assert.deepEqual(
        card.split('\n').filter((l) => l.includes('refs/fleet/')),
        [
          `Closing this PR does not lose the work: tip pinned as \`refs/fleet/${runId}\` on the orchestrator; ` +
            `evidence at \`${path.join(evidenceDir, `gate-read-${runId}.json`)}\`; the branch is swept after adoption.`,
        ],
        `the only pinned ref on a published card is the #543 line:\n${card}`,
      )
    }
  } finally {
    cleanup()
  }
}

console.log('ALL TESTS PASSED')

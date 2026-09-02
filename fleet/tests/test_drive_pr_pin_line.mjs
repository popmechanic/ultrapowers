// fleet/tests/test_drive_pr_pin_line.mjs — the PR says the work is pinned
// (#543 §Proposed policy "Say it on the PR", #497).
//
// The rescue block (`test_drive_pr_rescue.mjs`) fires only when the publish
// leg FAILED — which is the rare case. The common one is a card an operator
// closes, or a loser branch nobody adopts, and until now nothing on either
// body said the tip survives that. So every body a pinned run produces —
// parked or green — carries ONE line naming the ref, the evidence, and the
// sweep. It is not a section and not a fenced block: it is one sentence the
// operator reads before hitting Close.
//
// `renderPullRequestBody` is pure, so legs A–C call it directly: no sandbox,
// no network, no ssh, no `gh`. Leg D drives `driveOne` against the stub-exec
// fixture and reads the card OFF DISK, because the claim is as much about the
// two values the drive carries into the render as about the sentence itself.
//
// Legs:
//   A  green and parked, both pinned → exactly one line, with the run's values
//   B  no `pinnedRef` → no such line at all (and no half-rendered sentence)
//   C  the line sits outside every fenced block and before the `Closes` lines
//   D  END TO END: a drive whose `update-ref` succeeds leaves the line on disk
//      with `refs/fleet/<runId>` and `<evidenceDir>/gate-read-<runId>.json`;
//      one whose `update-ref` fails leaves a card without it
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { driveOne, renderPullRequestBody } from '../drive.mjs'
import { INTEGRATION_BRANCH, RECEIPT_PATH, setupDriveFixture } from './_drive_helpers.mjs'

const TRAILER = '🤖 Generated with [Claude Code](https://claude.com/claude-code)'

const RUN_ID = 'run-9'
const BRANCH = 'ultra/integration-run-9'
const HOST = 'fleet-orchestrator.exe.xyz'
const TIP = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const PINNED_REF = `refs/fleet/${RUN_ID}`
const EVIDENCE_PATH = '/e/gate-read-run-9.json'
const PUSH_ERROR = `push ${BRANCH} to origin failed (code 128) fatal: no workflow scope`

// The sentence, to the byte. Every value in it is one the drive already held;
// nothing here is computed by the renderer.
const pinLine = (ref, evidence) =>
  `Closing this PR does not lose the work: tip pinned as \`${ref}\` on the orchestrator; ` +
  `evidence at \`${evidence}\`; the branch is swept after adoption.`

const OPENING = 'Closing this PR does not lose the work'

const RECEIPT = {
  mode: 'gate',
  branch: BRANCH,
  gateCheck: { verdict: 'PASS', checks: [{ name: 'acceptance', ok: true, detail: '' }], acks: [] },
  verdict: 'PASS',
}

// `pinnedRef`/`evidencePath` absent is a case under test, so they are read off
// the options object rather than defaulted by destructuring.
const body = (opts = {}) => {
  const { parked = false, errors = [], closes = [543] } = opts
  return renderPullRequestBody({
    runId: RUN_ID,
    planPath: 'docs/superpowers/plans/2026-09-02-pin-line.md',
    branch: BRANCH,
    vmName: `fleet-${RUN_ID}`,
    parked,
    receipt: RECEIPT,
    receiptSource: `${TIP}:fleet-receipts/${RUN_ID}/gate-receipt.json`,
    read: { o1: true, receiptsResolvable: true, leaseContinuity: true, versionStamp: true, spendObservational: { reported: 1, ledger: 1 } },
    receipts: [],
    closes,
    errors,
    rescue: 'rescue' in opts ? opts.rescue : undefined,
    pinnedRef: 'pinnedRef' in opts ? opts.pinnedRef : PINNED_REF,
    evidencePath: 'evidencePath' in opts ? opts.evidencePath : EVIDENCE_PATH,
  })
}

/** The indices of the lines equal to `wanted`, in order. */
const linesEqual = (text, wanted) =>
  text.split('\n').reduce((out, line, i) => (line === wanted ? [...out, i] : out), [])

/** Whether line `index` sits inside a ``` fenced block. */
const insideFence = (text, index) => {
  const before = text.split('\n').slice(0, index)
  return before.filter((l) => l.trimStart().startsWith('```')).length % 2 === 1
}

// -- A: green and parked, both pinned, both carry exactly one line ----------
{
  const expected = pinLine(PINNED_REF, EVIDENCE_PATH)
  for (const parked of [false, true]) {
    const text = body({ parked })
    assert.equal(linesEqual(text, expected).length, 1, `exactly one pin line in the ${parked ? 'parked' : 'green'} body:\n${text}`)
    // …and no OTHER line says it differently — the sentence is the whole
    // occurrence of the phrase in the body.
    const mentions = text.split('\n').filter((l) => l.includes(OPENING))
    assert.deepEqual(mentions, [expected], `the only mention is the sentence itself:\n${text}`)
    assert.ok(text.endsWith(`\n${TRAILER}\n`), 'the trailer is still last')
  }
  // The run's REAL values, not the fixture's: a different ref and a different
  // evidence path render a different line, substituted in both slots.
  const other = body({ pinnedRef: 'refs/fleet/run-51', evidencePath: '/var/evidence/gate-read-run-51.json' })
  assert.deepEqual(
    other.split('\n').filter((l) => l.includes(OPENING)),
    [pinLine('refs/fleet/run-51', '/var/evidence/gate-read-run-51.json')],
  )
}

// -- B: no `pinnedRef` → no line, and no half-rendered sentence ------------
{
  for (const opts of [{ pinnedRef: undefined }, { pinnedRef: null }, { pinnedRef: '' }]) {
    for (const parked of [false, true]) {
      const text = body({ ...opts, parked })
      assert.ok(!text.includes(OPENING), `no pin line without a pinned ref: ${text}`)
      assert.ok(!text.includes('refs/fleet/'), `and no stray pinned ref: ${text}`)
      assert.ok(!text.includes('undefined'), `and nothing half-rendered: ${text}`)
    }
  }
  // A ref with no evidence path is a half-supplied pair: the sentence names a
  // path, so it renders no sentence rather than one pointing at `undefined`.
  for (const evidencePath of [undefined, null, '']) {
    const text = body({ evidencePath })
    assert.ok(!text.includes(OPENING), `no half sentence for evidencePath ${JSON.stringify(evidencePath)}: ${text}`)
  }
}

// -- C: outside every fence, before the `Closes` lines ---------------------
{
  const expected = pinLine(PINNED_REF, EVIDENCE_PATH)
  // The one body that HAS a fenced block: a parked run whose publish failed,
  // which renders `## Rescue` and its ```bash block.
  const parkedWithRescue = body({
    parked: true,
    errors: [PUSH_ERROR],
    rescue: { runId: RUN_ID, tip: TIP, branch: BRANCH, host: HOST },
  })
  assert.ok(parkedWithRescue.includes('```bash'), `precondition: this body carries a fence:\n${parkedWithRescue}`)
  for (const text of [body(), body({ parked: true }), parkedWithRescue]) {
    const at = text.split('\n').indexOf(expected)
    assert.ok(at >= 0, `the line renders: ${text}`)
    assert.equal(insideFence(text, at), false, `the line is outside every fenced block:\n${text}`)
    assert.ok(text.indexOf(expected) < text.indexOf('Closes #543'), `the line sits before the Closes lines:\n${text}`)
    // It is a paragraph of its own, not appended to a section's last line.
    const lines = text.split('\n')
    assert.equal(lines[at - 1], '', 'a blank line above')
    assert.equal(lines[at + 1], '', 'a blank line below')
  }
  // The rescue section, when there is one, still comes first — the fence is
  // the failure story, the sentence is the standing fact.
  assert.ok(
    parkedWithRescue.indexOf('## Rescue') < parkedWithRescue.indexOf(expected),
    `the rescue section keeps its place above the pin line:\n${parkedWithRescue}`,
  )
}

// -- D: the wiring, end to end ---------------------------------------------
// The legs above call the renderer. This one drives `driveOne` for real — a
// real fetch, a real `git update-ref`, a real publish — and reads the card off
// disk, because what is under test is the two values the drive carries into
// the render: the ref IT wrote and the evidence path IT was given.
{
  const fixture = await setupDriveFixture()
  const { tmp, repoDir, integrationSha, makeExec, startStubSandbox, driveDefaults, cleanup } = fixture
  try {
    // `failPin` wraps the fixture's exec to refuse exactly the pin, leaving
    // every other command real — the shape of a `update-ref` that cannot lock.
    const greenDrive = async ({ runId, failPin = false }) => {
      let sandbox = null
      const inner = makeExec((assignment) => {
        setTimeout(() => {
          sandbox = startStubSandbox({
            assignment,
            runId,
            receiptSha: integrationSha,
            receiptPath: RECEIPT_PATH,
            exec: inner,
            branch: INTEGRATION_BRANCH,
          })
        }, 30)
      })
      const exec = async (cmd, opts) => {
        if (failPin && / update-ref refs\/fleet\//.test(cmd)) {
          inner.cmds.push(cmd)
          inner.calls.push({ cmd, env: opts?.env ?? null })
          return { code: 128, stdout: '', stderr: 'fatal: cannot lock ref\n' }
        }
        return inner(cmd, opts)
      }
      exec.cmds = inner.cmds
      exec.calls = inner.calls
      const evidenceDir = path.join(tmp, `evidence-${runId}`)
      const { detail } = await driveOne({
        ...driveDefaults,
        dbDir: path.join(tmp, `db-${runId}`),
        evidenceDir,
        exec,
        runId,
      })
      await sandbox
      const cardPath = path.join(evidenceDir, `pr-body-${runId}.md`)
      return { detail, exec, evidenceDir, card: fs.readFileSync(cardPath, 'utf8') }
    }

    // -- D1: the pin lands → the card names the ref and the evidence --------
    {
      const runId = 'run-pin-green'
      const { detail, evidenceDir, card } = await greenDrive({ runId })
      assert.equal(detail.status, 'gate-green', `precondition: a green run: ${JSON.stringify(detail.errors)}`)
      assert.equal(detail.pullRequest?.draft, false, `the green PR opened: ${JSON.stringify(detail.errors)}`)
      // The ref really exists on the orchestrator side, and holds the tip.
      const pinned = fs.readFileSync(path.join(repoDir, '.git', 'refs', 'fleet', runId), 'utf8').trim()
      assert.equal(pinned, integrationSha, 'the drive really pinned the tip it fetched')
      // The line on disk, to the byte — the ref the drive wrote and the
      // evidence path IT was given, never a path the renderer invented.
      const expected = pinLine(`refs/fleet/${runId}`, path.join(evidenceDir, `gate-read-${runId}.json`))
      assert.deepEqual(
        card.split('\n').filter((l) => l.includes(OPENING)),
        [expected],
        `the card carries exactly the pin line:\n${card}`,
      )
      // And that evidence file is really there to be read.
      assert.ok(fs.existsSync(path.join(evidenceDir, `gate-read-${runId}.json`)), 'the path the line names exists')
      assert.ok(card.indexOf(expected) < card.indexOf(TRAILER), 'above the trailer')
    }

    // -- D2: the pin fails → no line, and the failure is on the record ------
    {
      const runId = 'run-pin-nopin'
      const { detail, card } = await greenDrive({ runId, failPin: true })
      assert.ok(
        detail.errors.some((e) => e.startsWith(`could not pin refs/fleet/${runId}`)),
        `the pin really failed: ${JSON.stringify(detail.errors)}`,
      )
      assert.ok(!fs.existsSync(path.join(repoDir, '.git', 'refs', 'fleet', runId)), 'and no ref was written')
      assert.ok(!card.includes(OPENING), `a card with no pin behind it promises nothing:\n${card}`)
      // The ref name still appears once — as the RECORDED FAILURE in the
      // driver notes, which is the opposite of a promise.
      assert.deepEqual(
        card.split('\n').filter((l) => l.includes('refs/fleet/')),
        [`- could not pin refs/fleet/${runId} to ${integrationSha} (code 128) — the run tip is reachable only via FETCH_HEAD and will not survive the next fetch or gc (#497)`],
        `the only mention of the ref is the failure itself:\n${card}`,
      )
      assert.ok(card.endsWith(`\n${TRAILER}\n`), 'the rest of the card is untouched')
    }
  } finally {
    cleanup()
  }
}

console.log('ALL TESTS PASSED')

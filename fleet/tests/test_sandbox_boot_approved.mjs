/**
 * Exam for the two-move rule at the sandbox side: a run the engine APPROVED
 * publishes a ready PR, and nothing else about the outcome moves.
 *
 * The gate can end a run at `NEEDS_ACK` and then approve it — `run-main.mjs`
 * writes `approve-receipt.json` into the run directory, beside the gate
 * receipt, after `ultra_gate.py --approve` succeeds. At BASE the boot script
 * reads only the verdict, so such a run is published as a DRAFT: the approval
 * the engine already made is thrown away on the last step of the run. This sim
 * pins the three outcomes the task's Machine clauses name:
 *
 *   M1 / leg (a)  NEEDS_ACK + an approve receipt → `gate-green`
 *   M2 / leg (b)  NEEDS_ACK, no approve receipt  → `parked`, exactly as at BASE
 *   M3 / leg (c)  PASS, no approve receipt       → `gate-green`, as at BASE
 *   M4            the two operator documents say so, in their own words
 *
 * The rig is `_sandbox_boot_helpers.mjs` — the stub bin dir, `makeHome`,
 * `boot`, the log readers and `runTests` — shared with `test_sandbox_boot.mjs`
 * and `test_sandbox_boot_edges.mjs`. The one thing that rig cannot do is leave
 * an approval behind, so `approvedHome()` below extends its engine stub with
 * exactly that write, at the path `fleet/run-main.mjs` writes it to.
 *
 * `tests/test_docs_agree_with_code.py`, the structural pin over the same two
 * documents, is M4's other half and runs as its own Proof command; this file
 * reads the two documents for the sentences the clause quotes.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SCRIPT, PR_URL, PR_AUTHOR,
  STUBS, PRELUDE, makeHome, boot,
  readLog, stream, statusOf, states, prPosts,
  runTests,
} from './_sandbox_boot_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CONTRACT = path.join(HERE, '..', 'CONTRACT.md')
const RUNBOOK = path.join(HERE, '..', 'RUNBOOK.md')

const tests = []
const test = (name, fn) => tests.push([name, fn])

// ── the rig: an engine that leaves its approval behind ───────────────────────

/** The last line of the shared engine stub — where the extension is spliced. */
const ENGINE_EXIT = 'exit ${STUB_ENGINE_CODE:-0}'

/**
 * `run-main.mjs` writes `fs.writeFileSync(path.join(runDir,
 * 'approve-receipt.json'), app.stdout)` once `ultra_gate.py --approve` has
 * succeeded — the run directory, the same one the gate receipt and
 * `events.jsonl` are written to. The stub writes it there and nowhere else,
 * under `STUB_APPROVE`.
 */
const APPROVE_SNIPPET = `
if [ -n "\${STUB_APPROVE:-}" ]; then
  printf '{"stamp":"run-7","approved":true}\\n' >"$run_dir/approve-receipt.json"
fi
`

/** Where that write lands, read back so a green leg (a) cannot be a rig that
 *  quietly wrote nothing. */
const approveReceipt = (ctx) =>
  path.join(ctx.home, 'target', '.claude', 'ultrapowers', 'run-run-7', 'approve-receipt.json')

function approvedHome() {
  const ctx = makeHome()
  const body = STUBS['systemd-run']
  assert.ok(body.includes(ENGINE_EXIT),
    `the shared engine stub no longer ends in '${ENGINE_EXIT}' — this sim's splice is stale`)
  const file = path.join(ctx.bin, 'systemd-run')
  fs.writeFileSync(file, PRELUDE + body.replace(ENGINE_EXIT, () => APPROVE_SNIPPET + ENGINE_EXIT))
  fs.chmodSync(file, 0o755)
  return ctx
}

test('the boot script parses', () => {
  assert.equal(spawnSync('bash', ['-n', SCRIPT]).status, 0)
})

// ── (a) an approved NEEDS_ACK run is gate-green  [M1] ────────────────────────

test('a NEEDS_ACK receipt with an approve-receipt.json publishes a ready PR  [M1 / leg (a)]', () => {
  const ctx = approvedHome()
  const r = boot(ctx, ['boot'], { STUB_VERDICT: 'NEEDS_ACK', STUB_APPROVE: '1' })
  assert.equal(r.status, 0, r.stdout + r.stderr)

  // The rig actually left the approval where the engine leaves it.
  assert.ok(fs.existsSync(approveReceipt(ctx)),
    `the engine stub must write ${approveReceipt(ctx)}`)

  // M1's first half: the POST payload carries "draft":false — read both as the
  // literal bytes the script builds and as the parsed field.
  const posts = prPosts(ctx)
  assert.equal(posts.length, 1, 'one POST /pulls')
  assert.ok(readLog(ctx, 'pr.log').includes('"draft":false'),
    'the recorded POST payload must carry "draft":false — an approved run is not a draft:\n' +
      readLog(ctx, 'pr.log'))
  assert.equal(posts[0].draft, false, 'the two-move rule approved this run: the PR is ready')

  // M1's second half: the page ends at `done`, carrying the PR.
  assert.deepEqual(states(ctx), ['booting', 'running', 'publishing', 'done'],
    'an approved run walks the gate-green path, not the parked one')
  const status = statusOf(ctx)
  assert.equal(status.state, 'done')
  assert.equal(status.pr, PR_URL, 'the page carries the PR URL')
  assert.equal(status.prAuthor, PR_AUTHOR)
  assert.equal(status.error, null, 'an approved run records no parked error')

  // M1's third half: one log line, verbatim, naming the verdict AND why it was
  // published anyway.
  const line = 'outcome: gate-green (verdict=NEEDS_ACK, approved by the two-move rule)'
  assert.ok(stream(ctx).includes(line),
    `the log must carry exactly '${line}':\n` +
      stream(ctx).filter((l) => l.startsWith('outcome:')).join('\n'))
})

// ── (b) the same run without the approval is parked  [M2] ────────────────────

test('the same NEEDS_ACK receipt with no approve-receipt.json parks, exactly as at BASE  [M2 / leg (b)]', () => {
  // The approval is the whole difference between this case and leg (a): same
  // stub engine, same verdict, STUB_APPROVE unset.
  const ctx = approvedHome()
  const r = boot(ctx, ['boot'], { STUB_VERDICT: 'NEEDS_ACK' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.ok(!fs.existsSync(approveReceipt(ctx)), 'no approval was written for this run')

  assert.ok(readLog(ctx, 'pr.log').includes('"draft":true'),
    'an unapproved NEEDS_ACK run still publishes a DRAFT:\n' + readLog(ctx, 'pr.log'))
  assert.equal(prPosts(ctx).length, 1)
  assert.equal(prPosts(ctx)[0].draft, true)

  assert.deepEqual(states(ctx), ['booting', 'running', 'publishing', 'parked'])
  const status = statusOf(ctx)
  assert.equal(status.state, 'parked', 'the verdict alone does not publish a ready PR')
  assert.equal(status.error, 'parked: gate verdict NEEDS_ACK', 'the BASE error, unchanged')
  assert.equal(status.pr, PR_URL, 'the draft PR is still recorded')

  // The BASE log line, with nothing about the two-move rule in it.
  assert.ok(stream(ctx).includes('outcome: parked (verdict=NEEDS_ACK)'),
    'the parked log line is the one at BASE:\n' +
      stream(ctx).filter((l) => l.startsWith('outcome:')).join('\n'))
  assert.equal(stream(ctx).filter((l) => l.includes('two-move rule')).length, 0,
    'no run without an approve receipt may claim the two-move rule approved it')
})

// ── (c) PASS is untouched  [M3] ──────────────────────────────────────────────

test('a PASS receipt with no approve-receipt.json is gate-green, exactly as at BASE  [M3 / leg (c)]', () => {
  const ctx = approvedHome()
  const r = boot(ctx, ['boot'], { STUB_VERDICT: 'PASS' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.ok(!fs.existsSync(approveReceipt(ctx)), 'a PASS run needs no approval')

  assert.ok(readLog(ctx, 'pr.log').includes('"draft":false'),
    'PASS is a ready PR, with or without the new branch:\n' + readLog(ctx, 'pr.log'))
  assert.equal(prPosts(ctx).length, 1)
  assert.equal(prPosts(ctx)[0].draft, false)

  assert.deepEqual(states(ctx), ['booting', 'running', 'publishing', 'done'])
  assert.equal(statusOf(ctx).state, 'done')
  assert.equal(statusOf(ctx).pr, PR_URL)
  assert.equal(statusOf(ctx).error, null)

  // PASS keeps the BASE line: the new clause is worn only by a run the
  // two-move rule actually approved.
  assert.ok(stream(ctx).includes('outcome: gate-green (verdict=PASS)'),
    'the PASS log line is the one at BASE:\n' +
      stream(ctx).filter((l) => l.startsWith('outcome:')).join('\n'))
  assert.equal(stream(ctx).filter((l) => l.includes('two-move rule')).length, 0,
    'a PASS run was not approved by the two-move rule and does not say it was')
})

// ── (d) the documents say what the script does  [M4] ─────────────────────────

/** A document with its line wraps joined, the way M4's own commands read it. */
const joined = (file) => fs.readFileSync(file, 'utf8').replace(/\n/g, ' ')

test('CONTRACT.md\'s REST-call sentence carries both disjuncts  [M4]', () => {
  // The dots stand for the backticks around the file name, exactly as the
  // Proof's own grep spells it.
  const text = joined(CONTRACT)
  assert.match(text, /unless the verdict is PASS or .approve-receipt\.json. is present/,
    'the REST-call sentence must say draft is true unless the verdict is PASS or ' +
      'approve-receipt.json is present')
})

test('CONTRACT.md\'s Publish bullet and RUNBOOK.md\'s publish paragraph name the two-move rule  [M4]', () => {
  const sentence = "ready on PASS or on the two-move rule's approval"
  assert.ok(joined(CONTRACT).includes(sentence),
    `the Publish bullet must read '${sentence}'`)
  assert.ok(joined(RUNBOOK).includes(sentence),
    `the publish paragraph must read '${sentence}'`)
})

runTests(tests)

// fleet/tests/test_run_engine_proposed_patch.mjs — a referee's output is help
// (#551): when a reviewer can write the fix for a blocking issue it returns it
// as `proposedPatch`, and the fix round is handed that patch under the issue
// it belongs to. The sims here pin the schema field, the fix-prompt block and
// the `proposedPatches` count on the task result.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeRepo, rig, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'
import { REVIEWER_SCHEMA } from '../run-engine.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-patch-'))
const HEADER = 'PROPOSED PATCH (from the referee — apply it when it is right; say why not when it is not):'
const PATCH1 = '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-1\n+2\n'
const PATCH2 = '--- a/y\n+++ b/y\n@@ -1 +1 @@\n-a\n+b\n'

const wavesOf = (ids) => ids.map((wave) => wave.map((id) => ({
  id, title: 't', files: [id + '.txt'], tier: 'standard', review: 'lean',
  writes: [id + '.txt'], commutes: [], body: 'sim task ' + id,
})))

// One round-1 review reply, then PASS: the fix-round prompt is the artifact
// under test, so every sim shares this stub shape (copied from the fixloop sim).
async function sim(name, round1) {
  const repo = makeRepo(path.join(tmp, 'repo-' + name))
  const prompts = {}
  let reviews = 0
  const labels = []
  const stub = (prompt, opts, cwd) => {
    prompts[opts.label] = prompt
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') { fs.writeFileSync(path.join(cwd, 'T1.txt'), 'v1\n'); return doneImpl(cwd) }
    if (kind === 'fix') { fs.writeFileSync(path.join(cwd, 'T1.txt'), 'v2 fixed\n'); return doneImpl(cwd) }
    if (kind === 'review') {
      reviews += 1
      return reviews === 1 ? round1 : passReview()
    }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected: ' + opts.label)
  }
  const { run } = rig({ repo, runDir: path.join(tmp, 'run-' + name), waves: wavesOf([['T1']]), stub, stamp: name })
  const report = await run()
  return { report, prompts, labels }
}

// The fix prompt's issue block is appended last, so it is the prompt's tail.
const issueBlock = (prompt) => prompt.slice(prompt.indexOf('\n\nBlocking issues to resolve:\n'))
const countOf = (haystack, needle) => haystack.split(needle).length - 1
const fixRequired = (issues) => ({ verdict: 'FIX_REQUIRED', issues })

// ── (a) [M1] the schema carries proposedPatch and never requires it ─────────
// `actor` joined `required` with the actor-routing change; `proposedPatch` is
// what this file pins, and it stays optional.
{
  const item = REVIEWER_SCHEMA.properties.issues.items
  assert.deepEqual(item.properties.proposedPatch, { type: 'string' })
  assert.equal(item.required.indexOf('proposedPatch'), -1,
    'a proposed patch is help, never a requirement')
  assert.deepEqual(item.required, ['severity', 'detail', 'actor'])
}

// ── (b) [M2] the patch lands under its own issue; the patchless one is bare ─
{
  const { report, prompts } = await sim('pp1', fixRequired([
    { severity: 'blocking', detail: 'v1 is wrong', proposedPatch: PATCH1 },
    { severity: 'blocking', detail: 'v1 is also late' },
  ]))
  assert.equal(report.tasks[0].status, 'done', 'sim precondition: the fix round merged')
  const fix = prompts['fix:T1:1']
  assert.ok(fix, 'a fix round dispatched')
  assert.equal(countOf(fix, HEADER), 1, 'exactly one header')
  assert.equal(issueBlock(fix),
    '\n\nBlocking issues to resolve:\n' +
    '- v1 is wrong\n' + HEADER + '\n' + PATCH1 + '\n' +
    '- v1 is also late')

  // ── (c) [M3] that run counted one proposed patch ──────────────────────────
  assert.equal(report.tasks[0].proposedPatches, 1)
}

// ── (c) [M3] a clean first review still carries the field, at zero ──────────
{
  const { report, labels } = await sim('pp2', passReview())
  assert.equal(report.tasks[0].reviewVerdict, 'clean')
  assert.ok('proposedPatches' in report.tasks[0], 'the field is present on a clean review')
  assert.equal(report.tasks[0].proposedPatches, 0)
  assert.ok(!labels.some((l) => l.startsWith('fix:')), 'no fix round on a clean review')
}

// ── (c)+(f) [M2, M3] two issues, two patches: two headers, two counted ──────
{
  const { report, prompts } = await sim('pp3', fixRequired([
    { severity: 'blocking', detail: 'v1 is wrong', proposedPatch: PATCH1 },
    { severity: 'blocking', detail: 'v1 is also late', proposedPatch: PATCH2 },
  ]))
  const fix = prompts['fix:T1:1']
  assert.equal(countOf(fix, HEADER), 2, 'exactly two headers')
  assert.equal(issueBlock(fix),
    '\n\nBlocking issues to resolve:\n' +
    '- v1 is wrong\n' + HEADER + '\n' + PATCH1 + '\n' +
    '- v1 is also late\n' + HEADER + '\n' + PATCH2)
  assert.equal(report.tasks[0].proposedPatches, 2)
}

// ── (d) [M4] no proposedPatch anywhere → the prompt is the old one ──────────
{
  const { report, prompts } = await sim('pp4', fixRequired([
    { severity: 'blocking', detail: 'v1 is wrong' },
    { severity: 'blocking', detail: 'v1 is also late' },
  ]))
  const fix = prompts['fix:T1:1']
  assert.equal(countOf(fix, HEADER), 0, 'no header when no issue carries a patch')
  assert.equal(issueBlock(fix),
    '\n\nBlocking issues to resolve:\n- v1 is wrong\n- v1 is also late')
  assert.equal(report.tasks[0].proposedPatches, 0)
}

// ── (e) [M2] three issues, only the third carries a patch ──────────────────
{
  const { prompts } = await sim('pp5', fixRequired([
    { severity: 'blocking', detail: 'one' },
    { severity: 'blocking', detail: 'two' },
    { severity: 'blocking', detail: 'three', proposedPatch: PATCH1 },
  ]))
  const fix = prompts['fix:T1:1']
  assert.equal(countOf(fix, HEADER), 1, 'exactly one header')
  assert.equal(issueBlock(fix),
    '\n\nBlocking issues to resolve:\n- one\n- two\n' +
    '- three\n' + HEADER + '\n' + PATCH1)
}

// ── (e) [M2] three issues, none carrying a patch → no header at all ────────
{
  const { prompts } = await sim('pp6', fixRequired([
    { severity: 'blocking', detail: 'one' },
    { severity: 'blocking', detail: 'two' },
    { severity: 'blocking', detail: 'three' },
  ]))
  const fix = prompts['fix:T1:1']
  assert.equal(countOf(fix, HEADER), 0)
  assert.equal(issueBlock(fix), '\n\nBlocking issues to resolve:\n- one\n- two\n- three')
}

// ── (g) [M2, M3] an empty patch is no patch, and a minor's patch is not the
//        fix round's business ─────────────────────────────────────────────────
{
  const { report, prompts } = await sim('pp7', fixRequired([
    { severity: 'blocking', detail: 'v1 is wrong', proposedPatch: '' },
    { severity: 'minor', detail: 'a nit', proposedPatch: PATCH2 },
  ]))
  const fix = prompts['fix:T1:1']
  assert.equal(countOf(fix, HEADER), 0, 'an empty patch produces no block')
  assert.ok(!fix.includes(PATCH2), "a minor issue's patch never reaches the fix round")
  assert.equal(issueBlock(fix), '\n\nBlocking issues to resolve:\n- v1 is wrong')
  assert.equal(report.tasks[0].proposedPatches, 0)
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')

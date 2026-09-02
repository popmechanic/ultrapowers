// The role files speak in the peer-review register (#556, map #551; operator
// decision 2026-09-02). The register is scientific peer review: the reviewer is
// a referee who checks that a submission establishes its claim by the stated
// exam and helps it get there, the critic is the editor's completeness read,
// and what the diff cannot settle is a question for the editor rather than a
// finding against the author.
//
// These are prose pins. The role files are data — `fleet/run-engine.mjs` reads
// them verbatim at dispatch — so the only way to hold a stance is to hold the
// sentences that carry it. Each pinned sentence is asserted as an exact
// substring, not a loose match: a paraphrase that drops "help it get there" or
// turns `cannotVerify` back into a finding is the regression this file exists
// to catch.
import assert from 'node:assert'
import fs from 'node:fs'

const rolesDir = new URL('../roles/', import.meta.url)
const read = (name) => fs.readFileSync(new URL(name, rolesDir), 'utf8')
const roleFiles = fs.readdirSync(rolesDir)
const occurrences = (haystack, needle) => haystack.split(needle).length - 1

// The two directory-wide sweeps below are only worth anything if the directory
// actually holds the files they are meant to police.
assert.ok(roleFiles.length >= 6, 'fleet/roles/ holds fewer files than the roles it dispatches')
for (const expected of ['reviewer.md', 'critic.md', 'fix.md', 'implementer.md', 'README.md']) {
  assert.ok(roleFiles.includes(expected), 'fleet/roles/ is missing ' + expected)
}

// ── (a) M1: the word `adversarial` is gone from the roles ────────────────────
// CLAUDE.md §How features are built already replaced the adversarial trim
// review; the role files were the last place the word lived.
for (const f of roleFiles) {
  assert.ok(!/adversarial/i.test(read(f)),
    'role file ' + f + ' still calls the review adversarial (#556)')
}

// ── (b) M2: the referee's three sentences, verbatim ──────────────────────────
const reviewer = read('reviewer.md')
const REFEREE_SENTENCES = [
  'You are a referee: your job is to check that this submission establishes its claim by the stated exam, and to help it get there.',
  'When you can write the fix for a `blocking` issue, put it in that issue\'s `proposedPatch` as a unified diff.',
  'A requirement the diff cannot settle is a question for the editor: put it under `cannotVerify` with why, never among the findings.',
]
for (const sentence of REFEREE_SENTENCES) {
  assert.ok(reviewer.includes(sentence),
    'reviewer.md no longer carries, verbatim: ' + sentence)
}

// ── (c) M3: the two rules the run-32 evidence bought, still in the file ──────
// Same three expressions `fleet/tests/test_run_engine.mjs:144-158` pins (#344,
// #441). Re-checked here because this run rewrites the stance of the file they
// live in, and a stance rewrite is exactly the edit that takes them with it.
// Each is also run against fix.md, which never made either promise: a pin that
// matches any role file is not pinning reviewer.md.
const REVIEWER_RULE_PATTERNS = [
  /`plan-defect:`[\s\S]{0,80}blocking[\s\S]{0,80}FILES/,
  /red-then-green/,
  /neither a finding nor a `cannotVerify` entry/,
]
const fix = read('fix.md')
for (const pattern of REVIEWER_RULE_PATTERNS) {
  assert.ok(pattern.test(reviewer), 'reviewer.md no longer satisfies ' + pattern)
  assert.ok(!pattern.test(fix), 'pin ' + pattern + ' matches fix.md too, so it pins nothing')
}

// ── (d) M4: the fix role knows what a `PROPOSED PATCH` block is ──────────────
// The block header and the `proposedPatch` field are a sibling engine task's
// route; this file writes the prose that names them. Exactly once: two copies
// of an instruction are two chances to follow half of it.
const FIX_SENTENCE =
  'An issue may carry a `PROPOSED PATCH` from the referee: apply it when it is right; when it is not, say why in your summary.'
assert.equal(occurrences(fix, FIX_SENTENCE), 1,
  'fix.md must carry the PROPOSED PATCH sentence verbatim, exactly once')

// ── (e) M5: the implementer receives the exam (#553 item 4) ──────────────────
const IMPLEMENTER_SENTENCE =
  'A Proof `Test:` file already in your tree when you start is a peer\'s exam and your grading: run it, do not edit it, and if it is red for a reason other than the missing implementation, report that as a `concerns` entry prefixed `exam:`.'
assert.ok(read('implementer.md').includes(IMPLEMENTER_SENTENCE),
  'implementer.md no longer tells the implementer what a peer-written exam is')

// ── (f) M6: the critic is the editor, and keeps every slot-by-slot check ─────
const critic = read('critic.md')
assert.ok(critic.includes('You are the editor\'s completeness read of the whole submission.'),
  'critic.md no longer opens in the editor register')
assert.ok(critic.includes('deferredVerification'),
  'critic.md lost the deferredVerification route to the gate acknowledgement')
for (const check of ['1. Claim', '2. Interfaces', '3. Context', '4. Proof', '5. The cannot-verify checklist']) {
  assert.equal(occurrences(critic, check), 1,
    'critic.md must carry the numbered check "' + check + '" exactly once')
}

// ── (g) M7: no role file shouts ──────────────────────────────────────────────
// A rule that needs shouting belongs in code. Held here as well as in
// test_run_engine.mjs so a role-file edit fails against its own test file.
for (const f of roleFiles) {
  assert.ok(!/\b(NEVER|ALWAYS|MUST)\b/.test(read(f)),
    'role file ' + f + ' shouts an imperative')
}

// ── (h) M8: the README lists all seven roles and gates no size ───────────────
// Sizes are reported, not gated (#496). The two literals `tests/test_roles_readme.py`
// pins stay.
const readme = read('README.md')
for (const name of ['implementer.md', 'reviewer.md', 'fix.md', 'resolver.md',
                    'reconcile.md', 'critic.md', 'examiner.md']) {
  assert.ok(readme.includes(name), 'fleet/roles/README.md does not list ' + name)
}
assert.ok(!readme.includes('350 words'),
  'fleet/roles/README.md still advertises the deleted 350-word ceiling (#496)')
assert.ok(readme.includes('run-engine.mjs') && readme.includes('Amendment 10'),
  'fleet/roles/README.md dropped a literal tests/test_roles_readme.py pins')

console.log('ALL TESTS PASSED')

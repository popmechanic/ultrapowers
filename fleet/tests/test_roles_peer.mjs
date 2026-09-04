// The role files speak in the peer-review register (#556, map #551; operator
// decision 2026-09-02). The register is scientific peer review: the reviewer is
// a referee who checks that a submission establishes its claim by the stated
// exam and helps it get there, the critic is the editor's completeness read,
// and a requirement the diff cannot settle is a `minor` finding prefixed
// `unverified:` rather than a separate channel to the editor.
//
// These are prose pins, and #612 settled how far they reach: a sweep over the
// directory's register (no `adversarial`, no shouting, every role listed) is
// worth holding, but freezing a whole sentence verbatim only pins the sentence
// against its own author. So the rule pins below are expressions — the clause
// each rule turns on — and the verbatim-sentence legs are gone.
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

// ── (c) M3: the three rules the run-32 evidence bought, still in the file ────
// The first two are the expressions `fleet/tests/test_run_engine.mjs` pins
// (#344, #441); the third is what replaced the editor's separate channel —
// what a diff cannot settle is now a finding the referee grades `minor`.
// Each is also run against fix.md, which never made any of them: a pin that
// matches any role file is not pinning reviewer.md.
const reviewer = read('reviewer.md')
const REVIEWER_RULE_PATTERNS = [
  /`plan-defect:`[\s\S]{0,80}blocking[\s\S]{0,80}FILES/,
  /red-then-green/,
  /unverified:/,
]
const fix = read('fix.md')
for (const pattern of REVIEWER_RULE_PATTERNS) {
  assert.ok(pattern.test(reviewer), 'reviewer.md no longer satisfies ' + pattern)
  assert.ok(!pattern.test(fix), 'pin ' + pattern + ' matches fix.md too, so it pins nothing')
}

// ── (f) M6: the critic is the editor, and keeps the two checks only the ──────
//    integrated view can make
// Interfaces is settled by the compiler's derived edges, Proof by the wave-0
// examiner and the proof gate, and the escalated cannot-verify channel is gone
// with the reviewer's: two duties, not five.
const critic = read('critic.md')
assert.ok(critic.includes('You are the editor\'s completeness read of the whole submission.'),
  'critic.md no longer opens in the editor register')
assert.ok(critic.includes('deferredVerification'),
  'critic.md lost the deferredVerification route to the gate acknowledgement')
for (const check of ['1. Claim', '2. Context']) {
  assert.equal(occurrences(critic, check), 1,
    'critic.md must carry the numbered check "' + check + '" exactly once')
}
assert.ok(!/^[345]\. /m.test(critic),
  'critic.md carries a numbered duty beyond the two the integrated view can settle')
for (const gone of ['cannot-verify', 'checklist']) {
  assert.ok(!critic.toLowerCase().includes(gone),
    'critic.md still routes work through the deleted ' + gone + ' channel')
}

// ── (g) M7: no role file shouts ──────────────────────────────────────────────
// A rule that needs shouting belongs in code. Held here as well as in
// test_run_engine.mjs so a role-file edit fails against its own test file.
for (const f of roleFiles) {
  assert.ok(!/\b(NEVER|ALWAYS|MUST)\b/.test(read(f)),
    'role file ' + f + ' shouts an imperative')
}

// ── (h) M8: the README lists all seven roles and gates no size ───────────────
// Sizes are reported, not gated (#496).
const readme = read('README.md')
for (const name of ['implementer.md', 'reviewer.md', 'fix.md', 'resolver.md',
                    'reconcile.md', 'critic.md', 'examiner.md']) {
  assert.ok(readme.includes(name), 'fleet/roles/README.md does not list ' + name)
}
assert.ok(!readme.includes('350 words'),
  'fleet/roles/README.md still advertises the deleted 350-word ceiling (#496)')
assert.ok(readme.includes('run-engine.mjs') && readme.includes('Amendment 10'),
  'fleet/roles/README.md dropped a literal the readme pins rely on')

console.log('ALL TESTS PASSED')

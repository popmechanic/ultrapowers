// fleet/tests/test_roles_examiner.mjs — #553 (map #551, item 1): the examiner's
// role file. The examiner is the peer who writes a task's exam — the runnable
// test file at the Proof `Test:` path — and hands it to the implementer already
// red. The role prompt is data read at dispatch, so the pins here are on its
// words: the four sentences the engine and the reviewer both rely on, and the
// register rules the roles directory keeps (#496 reports sizes, never gates).
import assert from 'node:assert/strict'
import fs from 'node:fs'

const roleUrl = new URL('../roles/examiner.md', import.meta.url)

// ── leg (a) [M1]: the file exists and carries the charter sentence ───────────
assert.ok(fs.existsSync(roleUrl), 'fleet/roles/examiner.md does not exist')
const text = fs.readFileSync(roleUrl, 'utf8')

const M1 = "You are a peer writing this task's exam, not its implementation: "
  + 'the runnable test file(s) at the Proof `Test:` path(s), written against '
  + 'the Machine clauses and the Proof legs, and expected to fail at BASE for '
  + 'exactly one reason — the implementation does not exist yet.'
const carriesM1 = (s) => s.includes(M1)

assert.ok(carriesM1(text), 'examiner.md does not carry the M1 charter sentence verbatim')

// The substring check is live, not vacuous: delete three words from a copy of
// the text and the same check has to go red. A pin that passes against a
// mutilated copy is pinning nothing.
const mutilated = text.split('not its implementation').join('')
assert.ok(!carriesM1(mutilated),
  'the M1 check still passes with `not its implementation` deleted — it is not a live substring test')

// ── leg (b) [M2]: the unsatisfiable-leg rule ─────────────────────────────────
const M2 = 'A leg you cannot encode as written goes under `unsatisfiable` as '
  + '`{leg, why}`; return `BLOCKED` only when no exam at all can be written.'
assert.ok(text.includes(M2), 'examiner.md does not carry the M2 unsatisfiable-leg sentence verbatim')

// ── leg (c) [M3]: the reply shape, spelled exactly once — and no startHead ──
const SHAPE = '{status: DONE|BLOCKED, summary, unsatisfiable: [{leg, why}]}'
const shapeCount = text.split(SHAPE).length - 1
assert.equal(shapeCount, 1,
  'the reply shape is spelled ' + shapeCount + ' times in examiner.md; it is a shared literal with the engine, spelled exactly once')

// The driver knows BASE; no prompt asks a model to run git (Amendment 10).
assert.ok(!/startHead|rev-parse/.test(text), 'examiner.md still asks the examiner to run git and report a sha')

// ── leg (d) [M4]: the register the roles directory keeps ─────────────────────
assert.ok(!/\b(NEVER|ALWAYS|MUST)\b/.test(text), 'examiner.md shouts an imperative')
assert.ok(!/adversarial/i.test(text), 'examiner.md calls the peer adversarial (#551 — it is collaborative)')
assert.ok(!text.includes('Implement the minimum to make them pass'),
  'examiner.md carries the implementer.md build instruction — the examiner writes the exam, not the implementation')

console.error('role prose size: examiner.md = ' + text.split(/\s+/).filter(Boolean).length + ' words')
console.log('ALL TESTS PASSED')

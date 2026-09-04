// fleet/tests/test_roles_examiner.mjs — #553 (map #551, item 1), narrowed by
// #612: the examiner's role file. The examiner is the peer who writes a task's
// exam — the runnable test file at the Proof `Test:` path — and hands it to the
// implementer already red. The role prompt is data read at dispatch, so what is
// pinned here is its register and the one literal the engine shares with it:
// the reply shape, spelled exactly once, and the sweeps the roles directory
// keeps (#496 reports sizes, never gates). Its sentences are prose and are free
// to be rewritten; a sentence pin only makes the file harder to edit.
import assert from 'node:assert/strict'
import fs from 'node:fs'

const roleUrl = new URL('../roles/examiner.md', import.meta.url)

assert.ok(fs.existsSync(roleUrl), 'fleet/roles/examiner.md does not exist')
const text = fs.readFileSync(roleUrl, 'utf8')

// ── leg (c) [M2]: the reply shape, spelled exactly once — and no startHead ──
const SHAPE = '{status: DONE|BLOCKED, summary, unsatisfiable: [{leg, why}]}'
const shapeCount = text.split(SHAPE).length - 1
assert.equal(shapeCount, 1,
  'the reply shape is spelled ' + shapeCount + ' times in examiner.md; it is a shared literal with the engine, spelled exactly once')

// The driver knows BASE; no prompt asks a model to run git (Amendment 10).
assert.ok(!/startHead|rev-parse/.test(text), 'examiner.md still asks the examiner to run git and report a sha')

// ── leg (d) [M2]: the register the roles directory keeps ─────────────────────
assert.ok(!/\b(NEVER|ALWAYS|MUST)\b/.test(text), 'examiner.md shouts an imperative')
assert.ok(!/adversarial/i.test(text), 'examiner.md calls the peer adversarial (#551 — it is collaborative)')
assert.ok(!text.includes('Implement the minimum to make them pass'),
  'examiner.md carries the implementer.md build instruction — the examiner writes the exam, not the code under test')

console.error('role prose size: examiner.md = ' + text.split(/\s+/).filter(Boolean).length + ' words')
console.log('ALL TESTS PASSED')

// fleet/tests/test_exam_dispatch_role.mjs — run-53's finding, and the class of
// finding it belongs to.
//
// run-52 shipped the wave-0 examiner green. On run-53, its first live dispatch,
// all six tasks died before the examiner said a word:
//
//   runWorker: no role declared for label "exam:1". A new agent() dispatch site
//   must declare its role in roleForLabel — defaulting one to a permissive role
//   is how isolation is lost silently.
//
// `run-engine.mjs` dispatches `label: 'exam:' + task.id`; `roleForLabel` knew
// eight label shapes and threw on the ninth, exactly as it is designed to. The
// guard worked. What was missing was the row.
//
// WHY EVERY EXISTING SIM MISSED IT (#461). The engine sims stub `agent()`, so
// `roleForLabel` is never on their path — the label is a string they record and
// compare, not one anything resolves. A test that asserts "the engine dispatches
// a worker labelled exam:T1" is true in a world where that label cannot be
// dispatched at all. So this file tests the JOIN rather than either side: it
// takes the label shape the engine really emits and pushes it through the real
// resolver, with nothing stubbed between them.
//
// The pins are on the join and on the isolation the examiner needs, NOT on
// `roleForLabel`'s internals — a future engine may relabel, and then this file
// should fail loudly rather than quietly agree with itself.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ROLES, roleForLabel } from '../run-worker.mjs'
import { ROLE_PROMPTS, writeRoleFiles, writeConfineSettings } from '../run-main.mjs'

// ── (a) the label the ENGINE emits resolves ─────────────────────────────────
// Read the dispatch label off run-engine.mjs's source rather than retyping it,
// so a rename there fails here instead of drifting past.
const engineSrc = fs.readFileSync(new URL('../run-engine.mjs', import.meta.url), 'utf8')
const labelExpr = /label:\s*'([a-z]+):'\s*\+\s*task\.id,[^]{0,200}?EXAMINER_SCHEMA/.exec(engineSrc)
assert.ok(labelExpr, 'run-engine.mjs no longer dispatches `label: <prefix>: + task.id` with EXAMINER_SCHEMA')
const prefix = labelExpr[1]
assert.equal(prefix, 'exam', 'the examiner dispatch prefix moved; update this pin and roleForLabel together')

const role = roleForLabel(prefix + ':T1')
assert.equal(role, 'examiner',
  'the engine\'s examiner label does not resolve to a role — this is run-53\'s failure exactly')

// Live, not vacuous: the resolver still refuses a label nobody declared.
assert.throws(() => roleForLabel('nosuchsite:T1'), /no role declared for label/,
  'roleForLabel stopped refusing undeclared labels — the guard that caught this is gone')

// ── (b) the examiner writes, so it needs a writable clone ───────────────────
// It authors the Proof `Test:` files in the task's own clone at BASE. A
// read-only posture would fail it at the first Write, which is a slower, more
// confusing version of the same outage.
const examiner = ROLES[role]
assert.ok(examiner, 'ROLES has no `' + role + '` entry')
assert.equal(examiner.writableRoot, 'clone',
  'the examiner must write its exam into the task\'s own clone')
assert.deepEqual(examiner.disallowedTools, ['Bash(git stash *)', 'Bash(git push *)'],
  'the examiner keeps the write-role escape hatches closed')

// ── (c) it is NOT the implementer, and does not borrow its prompt ───────────
// The design's whole point: the agent writing the measure must not be the one
// told to make it pass. `promptFileFor` resolves `roles/<role>.md`, so routing
// `exam:*` to the implementer role would have handed the examiner the
// implementer's preamble — a passing run that quietly voids the experiment.
assert.notEqual(role, 'implementer',
  'the examiner must not share the implementer\'s role, or it inherits its prompt file')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exam-role-'))
const promptFileFor = writeRoleFiles(path.join(tmp, 'roles'))
const examPrompt = promptFileFor(role)
assert.ok(examPrompt, 'no prompt file is written for the examiner role')
assert.notEqual(examPrompt, promptFileFor('implementer'),
  'the examiner resolves to the implementer\'s prompt file')
const examText = fs.readFileSync(examPrompt, 'utf8')
assert.ok(!/\bpass\b|\bgreen\b/i.test(examText),
  'the examiner preamble tells it something about passing: ' + JSON.stringify(examText))
assert.ok(ROLE_PROMPTS[role], 'ROLE_PROMPTS has no examiner entry')

// ── (d) a writing role is bounded by the confine hook ───────────────────────
// The two other bypassPermissions roles get the PreToolUse settings; a third
// that writes and does not would be an unbounded worker.
const settingsFor = writeConfineSettings({ runDir: tmp, hookPath: '/nowhere/confine-hook.mjs' })
assert.ok(settingsFor(role), 'the examiner writes under bypassPermissions with no confine settings')
assert.equal(settingsFor(role), settingsFor('implementer'),
  'the examiner should share the one confine settings file')
assert.equal(settingsFor('reviewer'), undefined,
  'read-only roles still get no settings — the allowlist is their boundary')

fs.rmSync(tmp, { recursive: true, force: true })

console.log('ALL TESTS PASSED')

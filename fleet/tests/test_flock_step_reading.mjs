import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { latestResults, readSteps, stepState } from '../../factory/flock/step_reading.mjs'

const tests = []
const test = (name, fn) => tests.push({ name, fn })

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'step-reading-'))
const write = (dir, name, r, ageMs = 0) => {
  const p = path.join(dir, name); fs.writeFileSync(p, JSON.stringify(r))
  const t = new Date(Date.now() - ageMs); fs.utimesSync(p, t, t)
}

test('the newest result per clause wins', () => {
  const d = tmp()
  write(d, 'S1.1@A.json', { clause: 'S1.1', exit: 1 }, 5000)
  write(d, 'S1.1@edge.json', { clause: 'S1.1', exit: 0 })
  write(d, 'junk.json', 'not a result')
  assert.equal(latestResults(d).get('S1.1').exit, 0)
})

test('the state names the story sentence, guard clauses included', () => {
  const s = stepState({ clause: 'G:p0/S2.3', did: [1], before: [{}, {}], after: [{}, {}], screen_text: 'x' }, { S2: 'tag it' })
  assert.deepEqual(s, { story: 'tag it', step: 'G:p0/S2.3', did: [1], before: [{}, {}], after: [{}, {}], screen_text: 'x' })
})

test('only green steps are read, and an unanswered one records null', async () => {
  const rows = []
  const asked = []
  const ask = async ({ state }) => { asked.push(state.step); return state.step === 'S1.1' ? { delivered: { choice: 'supports', confidence: 0.93 } } : null }
  await readSteps({ ask, results: [{ clause: 'S1.1', exit: 0 }, { clause: 'S2.2', exit: 0 }, { clause: 'S3.1', exit: 1 }],
    sentences: {}, question: { type: 'choice' }, emit: (r) => rows.push(r) })
  assert.deepEqual(asked.sort(), ['S1.1', 'S2.2'])
  assert.deepEqual(rows.sort((a, b) => a.clause.localeCompare(b.clause)), [
    { clause: 'S1.1', answer: 'supports', confidence: 0.93 },
    { clause: 'S2.2', answer: null, confidence: null }])
})

let failures = 0
for (const t of tests) {
  const t0 = Date.now()
  try { await t.fn(); console.log(`ok (${Date.now() - t0} ms) — ${t.name}`) } catch (e) { failures++; console.log(`FAIL — ${t.name}\n${e.stack}`) }
}
if (failures) { console.log(`${failures} FAILED`); process.exit(1) }
console.log('ALL TESTS PASSED')

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { renderPrBody } from '../../factory/record.mjs'

const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-body-'))
const plan = path.join(d, 'plan.md'); const events = path.join(d, 'events.jsonl')
fs.writeFileSync(plan, '# T\n\n**Summary:** A todo list.\n')
const rows = [
  { kind: 'landing', task: '1', k: 1, factsExit: 0, candidateSha: 'abc' },
  { kind: 'jev:step', clause: 'S1.1', answer: 'says_nothing', confidence: 0.4 },
  { kind: 'jev:step', clause: 'S1.1', answer: 'supports', confidence: 0.91 },
  { kind: 'jev:step', clause: 'S2.2', answer: null, confidence: null }]
fs.writeFileSync(events, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
const body = renderPrBody(plan, events)
assert.match(body, /### Jev read each story step \(record only\)/)
assert.match(body, /\| S1\.1 \| supports \| 0\.91 \|/)
assert.doesNotMatch(body, /says_nothing/)
assert.match(body, /\| S2\.2 \| no reading \| — \|/)

fs.writeFileSync(events, JSON.stringify(rows[0]) + '\n')
assert.doesNotMatch(renderPrBody(plan, events), /Jev read/)
console.log('ALL TESTS PASSED')

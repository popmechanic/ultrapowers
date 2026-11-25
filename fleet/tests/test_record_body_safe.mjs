import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import { simEnv } from './_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RECORD_MJS = path.resolve(HERE, '../../factory/record.mjs')
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'record-safe-home-'))
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'record-safe-'))
const PLAN = '# Plan\n\n**Summary:** The run does a thing.\n\n**Goal:** a goal.\n**Closes:** #77\n\n### Task 1: x\n'
const EVIDENCE = 'https://evidence.example/run-1529'
const CLOSING = /\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\s+#\d+/i

let n = 0
function body (rows, evidence) {
  n++
  const plan = path.join(DIR, `plan-${n}.md`)
  const events = path.join(DIR, `events-${n}.jsonl`)
  fs.writeFileSync(plan, PLAN)
  fs.writeFileSync(events, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
  const args = [RECORD_MJS, 'pr-body', plan, '--events', events]
  if (evidence) args.push('--evidence', evidence)
  const res = spawnSync(process.execPath, args, { encoding: 'utf8', env: simEnv({ home: HOME }) })
  assert.equal(res.status, 0, `pr-body exits 0: ${res.stderr}`)
  return res.stdout
}

const loose = (items) => ({ kind: 'loose-ends', items })
const open = (over) => ({ by: 'B', task: 2, about: 'app', path: 'a.txt', stale: 'x', claim: 'c', state: 'open', ...over })

function section (text, name) {
  const lines = text.split('\n')
  const at = lines.indexOf(name)
  if (at < 0) return ''
  const end = lines.findIndex((l, i) => i > at + 1 && l === '')
  return lines.slice(at, end < 0 ? undefined : end).join('\n')
}

{
  const out = body([loose([open({ stale: 'x\n### Injected heading' })])])
  assert.ok(!out.split('\n').some((l) => l.startsWith('### Injected heading')), '(a) [M1] no injected heading line')
}

{
  const out = body([loose([open({ claim: 'hide <!-- the rest' })])])
  assert.ok(!out.includes('<!--'), '(b) [M2] no <!-- in the body')
}

{
  const out = body([loose([open({ claim: 'this resolves #1334' })])])
  const le = section(out, '### Loose ends')
  assert.ok(le.includes('resolves'), '(c) [M3] the loose end is shown')
  assert.ok(!CLOSING.test(le), '(c) [M3] no closing keyword in Loose ends')
}

{
  const items = Array.from({ length: 400 }, (_, i) => open({ claim: String(i).padEnd(300, 'q') }))
  const out = body([loose(items)], EVIDENCE)
  assert.ok(out.length <= 60000, `(e) [M5] body is ${out.length} characters`)
  const lines = out.split('\n')
  assert.ok(lines.includes('Closes #77'), '(e) [M5] Closes #77 kept')
  const last = lines.findLastIndex((l) => l.startsWith('- open: '))
  assert.ok(last >= 0, '(e) [M5] some loose ends shown')
  assert.ok(lines.slice(last + 1).some((l) => l.includes(EVIDENCE)), '(e) [M5] evidence URL after the last loose end')
}

{
  const out = body([loose([open({ path: 'a.txt', stale: 'x WIPE z', claim: 'a.txt wipes every folder', by: 'B', task: 2 })])])
  assert.ok(out.split('\n').includes('- open: a.txt still contains "x WIPE z" — a.txt wipes every folder (B, task 2)'), '(f) [M6] byte-equal line')
}

fs.rmSync(DIR, { recursive: true, force: true })
fs.rmSync(HOME, { recursive: true, force: true })
console.log('ALL TESTS PASSED')

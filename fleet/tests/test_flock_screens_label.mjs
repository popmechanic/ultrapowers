#!/usr/bin/env node
// The screens check is the last fact of a stories-v1 task and has no clause (#1523): when it is the
// red fact, the parked reason names it `(screens)`, not `(undefined)`. `bun` is a fake on PATH that
// passes every call but the screens check, which prints one finding and exits 1.
// Prints `ALL TESTS PASSED` and exits 0, or `FAIL screens label: ...` and exits 1.
import fs from 'node:fs'
import path from 'node:path'
import { simEnv } from './_helpers.mjs'
import { flockTarget, flockRun } from './_flock_helpers.mjs'

const F = '```'
const PROBE = '{"clause":"S1.1","do":[{"click":{"name":"Add","role":"button"}}],"expect":[{"unchanged":true}],"given":[],"holds_before":true,"judge":null,"layer":"ui","see":[{"count":1,"name":"Add","role":"button"}]}'
const PLAN = `# Sim plan

**Grammar:** stories-v1
**Stack:** tinyapp
**Plan-id:** p1
**Kind:** behaviour
**Summary:** One. Two. Three.
**Store:** \`store.js\` sha256:${'0'.repeat(64)}

## Stories

- S1: You add a note; it shows.

### Task 1: The note piece

**Piece:** note
**Depends-on-pieces:** none

**Files:**
- Create: \`client/src/pieces/note.json\`

**Purpose:** Keep notes.

**Stories:**
- S1: You add a note; it shows.

**Proof:**
${F}probe
${PROBE}
${F}
`
const BUN = `#!/bin/sh
case "$*" in *screens.ts*) echo 'SCREENS note: no element runs addNote'; exit 1;; esac
exit 0
`

const t = flockTarget({ 'note.txt': 'base\n' })
try {
  const bin = path.join(t.tmp, 'bin')
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, 'bun'), BUN, { mode: 0o755 })
  t.over.PATH = simEnv({ bin, home: t.tmp }).PATH
  const plan = path.join(t.tmp, 'plan.md')
  fs.writeFileSync(plan, PLAN)
  const r = await flockRun(t, { plan, script: { 1: { 'client/src/pieces/note.json': '{"root":"note","elements":{}}\n' } } })
  const parked = r.of('task:parked')
  if (parked.length !== 1 || !String(parked[0].reason).startsWith('the scripted files leave red facts: fact 2 (screens) exit 1\n')) {
    throw new Error(`task:parked rows: ${JSON.stringify(parked)} (exit ${r.code}; ${r.out.slice(-600)})`)
  }
  console.log('ALL TESTS PASSED')
} catch (e) {
  console.log(`FAIL screens label: ${e.message}`)
  process.exitCode = 1
} finally {
  t.done()
}

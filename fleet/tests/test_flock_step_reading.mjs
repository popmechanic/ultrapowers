#!/usr/bin/env node
// The Jev step reading on a stories-v1 run (#1509): every checked step is offered to Jev whether the
// settled run lands a commit or settles equal to its base with nothing to build. Jev is a local
// stand-in (a node:http server on 127.0.0.1); `bun` is a fake on PATH that passes every call and, as
// the checker, writes a green result for its clause into FLOCK_CHECK_OUT.
//   empty   the builder writes note.json unchanged: `landing:empty`, no `landing`, one jev:step for S1.1
//   landed  the builder changes note.json: a `landing` row, and still one jev:step for S1.1
// Prints `ALL TESTS PASSED` and exits 0, or names each case that differed and exits 1.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { simEnv } from './_helpers.mjs'
import { flockTarget, flockRun } from './_flock_helpers.mjs'

const fails = []
const assert = (ok, why) => { if (!ok) throw new Error(why) }

const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    let keys = []
    try { keys = Object.keys(JSON.parse(body).questions || {}) } catch {}
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ answers: Object.fromEntries(keys.map((k) => [k, { choice: 'yes', confidence: 0.9 }])) }))
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const JEV = `http://127.0.0.1:${server.address().port}`

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
- Create: \`note.json\`

**Purpose:** Keep notes.

**Stories:**
- S1: You add a note; it shows.

**Proof:**
${F}probe
${PROBE}
${F}
`
const BUN = `#!/bin/sh
clause=''
prev=''
for a in "$@"; do
  if [ "$prev" = "--clause" ]; then clause="$a"; fi
  prev="$a"
done
if [ -n "$clause" ] && [ -n "$FLOCK_CHECK_OUT" ]; then
  printf '%s' '{"clause":"'"$clause"'","exit":0,"stage":"ui","diff":[],"did":[],"before":null,"after":null,"screen_text":"ok"}' > "$FLOCK_CHECK_OUT/$clause@x.json"
fi
exit 0
`

for (const [CASE, text] of [['empty', '{}\n'], ['landed', '{"n":1}\n']]) {
  const t = flockTarget({ 'note.json': '{}\n' }, { env: { TYPESAFE_BASE_URL: JEV } })
  try {
    const bin = path.join(t.tmp, 'bin')
    fs.mkdirSync(bin)
    fs.writeFileSync(path.join(bin, 'bun'), BUN, { mode: 0o755 })
    t.over.PATH = simEnv({ bin, home: t.tmp }).PATH
    const plan = path.join(t.tmp, 'plan.md')
    fs.writeFileSync(plan, PLAN)
    const r = await flockRun(t, { plan, script: { 1: { 'note.json': text } } })
    const tail = `(exit ${r.code}; ${r.out.slice(-600)})`
    assert(r.code === 0, `exit ${r.code} ${tail}`)
    if (CASE === 'empty') {
      assert(r.of('landing:empty').length === 1 && r.of('landing').length === 0, `landing rows: ${JSON.stringify([...r.of('landing:empty'), ...r.of('landing')])} ${tail}`)
      assert(r.of('landing:empty')[0].grammar === 'stories-v1', `landing:empty row: ${JSON.stringify(r.of('landing:empty'))} ${tail}`)
    }
    else assert(r.of('landing').length >= 1, `no landing row ${tail}`)
    const js = r.of('jev:step')
    assert(js.length === 1 && js[0].clause === 'S1.1', `jev:step rows: ${JSON.stringify(js)} ${tail}`)
    console.log(`ok   ${CASE}`)
  } catch (e) {
    fails.push(CASE)
    console.log(`FAIL ${CASE}: ${e.message}`)
  } finally {
    t.done()
  }
}
server.close()
if (fails.length) { console.log(`${fails.length} FAILED: ${fails.join(', ')}`); process.exit(1) }
console.log('ALL TESTS PASSED')

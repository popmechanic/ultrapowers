#!/usr/bin/env node
// PROTOTYPE (map #1292, ticket 4 follow-up). An offline pin for the host's replay of an Edit
// call into the weave: every case's spans, applied to the real weave keeper (weave.py),
// must leave the copy reading exactly what the Edit tool wrote. The named cases include the
// ledger rename (amt -> amount, replace-all, two matches on one line in `largest` and
// `smallest`), which the first pass missed once per run in 4 of 7 runs; the rest is a seeded
// fuzz over look-alike lines.
//
//   node flock/proto/readings/replace_all_check.mjs      (exit 0 = every case exact)
//   SPANS=<module> node ...                               (check another editSpans)
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { WORKLOADS } from '../workloads.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const { editSpans } = await import(process.env.SPANS ? pathToFileURL(path.resolve(process.env.SPANS)).href : '../edit_spans.mjs')

const cases = [
  { name: 'ledger rename amt->amount (replace-all)', before: WORKLOADS.ledger.base['ledger/core.py'], old: 'amt', neu: 'amount', all: true },
  { name: 'two matches on one line', before: 'x = a + a\ny = a\n', old: 'a', neu: 'bb', all: true },
  { name: 'three on one line, one next line', before: 'f(e.amt, e.amt, e.amt)\ng(e.amt)\nh()\n', old: 'e.amt', neu: 'e.amount', all: true },
  { name: 'deleting two on one line', before: 'a, b, a\nc\n', old: 'a, ', neu: '', all: true },
  { name: 'whole lines on adjacent lines', before: '}\n}\nx\n}\n', old: '}\n', neu: '};\n', all: true },
  { name: 'multi-line old, matches touching', before: 'p\nq\np\nq\nr\n', old: 'q\np', neu: 'Q\nP', all: true },
  { name: 'neu contains old', before: 'amt amt\n', old: 'amt', neu: 'amt_x', all: true },
  { name: 'single replace, unchanged path', before: 'a a\na\n', old: 'a', neu: 'b', all: false },
]
// seeded fuzz: short files of look-alike lines, a random substring, replace-all or first
let seed = 1292
const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
const WORDS = ['e.amt', 'amt', 'abs(e.amt) > abs(best.amt)', '    return None', '', 'out = []', 't += e.amt', '}']
for (let k = 0; k < 400; k++) {
  const lines = Array.from({ length: 3 + rnd(10) }, () => Array.from({ length: 1 + rnd(3) }, () => WORDS[rnd(WORDS.length)]).join(' '))
  const before = lines.join('\n') + (rnd(2) ? '\n' : '')
  const i = rnd(Math.max(1, before.length - 3)); const old = before.slice(i, i + 1 + rnd(8))
  if (!old) continue
  cases.push({ name: 'fuzz ' + k, before, old, neu: ['X', '', 'amount', 'Y\nZ', old + 'q'][rnd(5)], all: rnd(3) > 0 })
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replace-all-'))
cases.forEach((c, i) => fs.writeFileSync(path.join(dir, 'f' + i), c.before))
const wp = spawn('python3', [path.join(HERE, '..', 'weave.py')], { stdio: ['pipe', 'pipe', 'inherit'] })
const waiting = []
readline.createInterface({ input: wp.stdout }).on('line', (l) => waiting.shift()(JSON.parse(l)))
const weave = (o) => new Promise((res) => { waiting.push(res); wp.stdin.write(JSON.stringify(o) + '\n') })
await weave({ op: 'base', root: dir, paths: cases.map((_, i) => 'f' + i) })

let bad = 0
const named = []
for (const [i, c] of cases.entries()) {
  const want = c.all ? c.before.split(c.old).join(c.neu) : c.before.replace(c.old, () => c.neu)
  for (const s of editSpans(c.before, c.old, c.neu, c.all)) {
    const r = await weave({ op: 'edit', agent: 'A', path: 'f' + i, ...s })
    if (!r.ok) throw new Error(r.error)
  }
  const got = (await weave({ op: 'view', agent: 'A', path: 'f' + i })).text
  const ok = got === want
  if (!ok) bad += 1
  if (!c.name.startsWith('fuzz')) named.push(`${ok ? 'exact ' : 'MISSED'}  ${c.name}`)
  else if (!ok && bad <= 5) named.push(`MISSED  ${c.name}: ${JSON.stringify(c.old)} -> ${JSON.stringify(c.neu)} in ${JSON.stringify(c.before).slice(0, 80)}`)
}
wp.stdin.end()
fs.rmSync(dir, { recursive: true, force: true })
console.log(named.join('\n'))
console.log(`${cases.length - bad} of ${cases.length} cases exact (${cases.filter((c) => !c.name.startsWith('fuzz')).length} named, ${cases.filter((c) => c.name.startsWith('fuzz')).length} fuzz)`)
process.exit(bad ? 1 : 0)

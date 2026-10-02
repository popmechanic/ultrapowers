// fleet/tests/gate_jev_replay_probe.mjs — a live probe, run by hand on the laptop (see PROBES.md): every
// labelled gate disagreement in the operator's untracked plans, re-read through the live Jev with the
// gate as it stands now, beside two known-bad controls that must still read `fail`.
//
//   node fleet/tests/gate_jev_replay_probe.mjs [dir] [reps]   (dir: <repo>/docs/superpowers/plans; reps: 1;
//                                                              key in $ULTRAPOWERS_HOME/typesafe.env)
//
// For each `<stem>.gate-verdicts.json` with its `<stem>.md` beside it, each round where agent and jev
// both read and either differ with `right` set (jev failed it) or both read `fail` (an agreed fail, #1528):
// the diet is rebuilt by extract_gate_input.py (with the tally's base when the round was asked `pinned`)
// and skipped when its hash moved; gate_jev.ts reads it `reps` times, never `--record`. Spends
// reps × (rounds + 2) calls. Exit 0 when both controls read `fail` in a majority, no agreed fail now
// passes and at least two thirds of the wrong fails now pass; 2 no key, or no wrong or agreed fail
// replayable; 1 otherwise. The scoring is _gate_replay_helpers.mjs.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exitCode, majority, replayRounds, score, summary } from './_gate_replay_helpers.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const home = process.env.ULTRAPOWERS_HOME || path.join(os.homedir(), '.ultrapowers')
const envFile = path.join(home, 'typesafe.env')
const keyLine = fs.existsSync(envFile) && fs.readFileSync(envFile, 'utf8').split('\n').find((l) => l.startsWith('TYPESAFE_API_KEY='))
if (!keyLine) { console.log(`gate_jev_replay_probe: no TYPESAFE_API_KEY in ${envFile}`); process.exit(2) }

const dir = path.resolve(process.argv[2] || path.join(REPO, 'docs', 'superpowers', 'plans'))
const reps = Number(process.argv[3] || 1)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-jev-replay-'))

// gate_jev.ts on one diet, `reps` times: the verdict off each run's last stdout line.
let n = 0
function readings(diet) {
  const file = path.join(tmp, `diet-${n++}.json`)
  fs.writeFileSync(file, JSON.stringify(diet))
  const out = []
  for (let i = 0; i < reps; i++) {
    const r = spawnSync('bun', ['skills/ultrawrite/stories/gate_jev.ts', file], { cwd: REPO, env: process.env, encoding: 'utf8' })
    const last = (r.stdout || '').trim().split('\n').pop()
    let v = null
    try { v = JSON.parse(last).verdict } catch {}
    out.push(v ?? 'none')
  }
  return out
}

const stems = []
const total = { wrong: 0, wrongPass: 0, right: 0, rightFail: 0, agreed: 0, agreedPass: 0 }
for (const f of (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((x) => x.endsWith('.gate-verdicts.json')).sort()) {
  const stem = f.slice(0, -'.gate-verdicts.json'.length)
  const plan = path.join(dir, `${stem}.md`)
  if (!fs.existsSync(plan)) continue
  let rec
  try { rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { continue }
  const base = rec?.tally?.base
  const items = replayRounds(rec).filter((item) => {
    const args = ['skills/ultrawrite/scripts/extract_gate_input.py', plan, '--task', item.task]
    if (typeof item.r.pinned === 'number' && base) args.push('--base', String(base))
    const x = spawnSync('python3', args, { cwd: REPO, encoding: 'utf8' })
    if (x.status !== 0) return false
    try { item.diet = JSON.parse(x.stdout) } catch { return false }
    return item.diet.hash === item.r.hash
  })
  if (items.length) stems.push(stem)
  const s = score(items, (item) => {
    const now = readings(item.diet)
    console.log(`${stem} task ${item.task} round ${item.round} ${item.side} was=${item.r.jev} now=${now.join(',')}`)
    return now
  })
  for (const k of Object.keys(total)) total[k] += s[k]
}

const CONTROLS = {
  'uncaught-output': {
    task: 'uncaught-output', hash: 'control',
    claim: 'The report prints its total. (derived)\nMachine: M1. `node report.mjs` exits 0. M2. `node report.mjs` prints exactly `total 3`.',
    proof: '- Run: node report.mjs [M1]\n- Legs: (a) the report exits 0 [M1]; (b) it prints the total [M2].',
  },
  'pinned-by-sibling': {
    task: 'pinned-by-sibling', hash: 'control',
    claim: 'The census moves to the new paths. (derived)\nMachine: M1. `census` prints `skills/new/a.md` and never `skills/old/a.md`. M2. `node fleet/tests/census.test.mjs` exits 0.',
    proof: '- Run: node skills/census.mjs | grep -qx skills/new/a.md [M1]\n- Run: node fleet/tests/census.test.mjs [M2]\n- Legs: (a) it prints the new path [M1]; (b) the census test still passes [M2].',
    base: { rev: 'x', files: [
      { path: 'skills/census.mjs', status: 'present', lines: 30, headings: [], excerpt: "12: const ROOT = 'skills/old'", truncated: false, own: 'modify' },
      { path: 'fleet/tests/census.test.mjs', status: 'present', lines: 42, headings: ["  test('census lists the old paths', () => {"],
        excerpt: "12:   assert.deepEqual(paths, ['skills/old/a.md', 'skills/old/b.md'])\n13:   assert.equal(code, 0)", truncated: false },
    ] },
  },
}
let controlsOk = true
for (const [name, diet] of Object.entries(CONTROLS)) {
  const now = readings(diet)
  if (majority(now) !== 'fail') controlsOk = false
  console.log(`control ${name} now=${now.join(',')}`)
}
fs.rmSync(tmp, { recursive: true, force: true })

const dates = stems.length ? `${stems[0].slice(0, 10)}..${stems[stems.length - 1].slice(0, 10)}` : '-'
console.log(summary(total, dates, controlsOk))
process.exit(exitCode(total, controlsOk))

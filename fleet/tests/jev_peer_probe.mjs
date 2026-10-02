// fleet/tests/jev_peer_probe.mjs — a live probe, run by hand (see PROBES.md): Jev's peer-rewrite read
// (factory/questions.json flock_peer_rewrite) on run-296's L:loose rewrite of preview.ts, as the engine
// sent it before and after the loose-ends side carried its title and reason, beside run-277's shape
// (two words run together), which must still read `loses`.
//
//   node fleet/tests/jev_peer_probe.mjs [reps]     (default 5; key in ~/.ultrapowers/typesafe.env)
//
// Prints one line per reading and a verdict per case. Exit 0 when the run-296 case with its reason
// reads `supersedes` or `keeps` in a majority and the run-277 case reads `loses` in a majority; the
// bare run-296 case is reported, not judged. Readings 2026-10-01 (n=5 each, jev-1.13.0): bare loses
// 4/5 (L .54, S .45); with title and reason supersedes 5/5 (L .34, S .65).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const reps = Number(process.argv[2] || 5)
const home = process.env.ULTRAPOWERS_HOME || path.join(os.homedir(), '.ultrapowers')
const line = fs.readFileSync(path.join(home, 'typesafe.env'), 'utf8').split('\n').find((l) => l.startsWith('TYPESAFE_API_KEY='))
if (!line) { console.error('jev_peer_probe: no TYPESAFE_API_KEY in typesafe.env'); process.exit(2) }
const KEY = line.slice('TYPESAFE_API_KEY='.length).trim()
const QUESTION = JSON.parse(fs.readFileSync(path.join(REPO, 'factory', 'questions.json'), 'utf8')).sets.flock_peer_rewrite.questions.kept

const LOOSE = 'Close the loose ends builders reported'
const C4 = { agent: 'C.4', title: 'The preview server draws the real screen and redraws it in place',
  claim: '**Claim:** While a TinyApp plan is being written, I see its real screen in the Browser pane and pick between versions of it. (derived)' }
const run296 = (side) => ({
  path: 'skills/ultrawrite/stories/preview.ts', before: [],
  peer: ["  rmSync(join(app, '.preview'), {recursive: true, force: true});"],
  after: ["  // Only this server's own dirs: arrange.ts stages its composer at .preview/json-render.", '  rmSync(pageDir, {recursive: true, force: true});', '  rmSync(dist, {recursive: true, force: true});'],
  tasks: [side, C4],
})
const CASES = {
  'run-296 bare': { state: run296({ agent: 'E.L:loose' }), want: null },
  'run-296 with reason': {
    state: run296({ agent: 'E.L:loose', title: LOOSE, asked_to_fix: 'arrange.ts stages the composer at <app>/.preview/json-render/ (imported from there). preview.ts rmSyncs all of <app>/.preview at start, so a preview started mid-arrange can delete the staged composer; consider removing only .preview/page and .preview/dist.' }),
    want: ['supersedes', 'keeps'],
  },
  'run-277 run-together with reason': {
    state: { path: 'README.md', before: [], peer: ['Commit the plan, then launch the fleet from this checkout.'],
      after: ['Commit the plan, then launch the fleetfrom this checkout, never the plugin cache.'],
      tasks: [{ agent: 'E.L:loose', title: LOOSE, asked_to_fix: 'README.md should say to launch from this checkout, never the plugin cache.' },
        { agent: 'C.4', title: 'README names the launch step', claim: '**Claim:** The README tells the operator how to launch.' }] },
    want: ['loses'],
  },
  'unrelated same-file rewrite': {
    state: { path: 'README.md', before: ['Run the fleet.'], peer: ['Run the fleet from this checkout.'], after: ['Run the fleet.', 'Never from the plugin cache.'],
      tasks: [{ agent: 'E.L:loose', title: LOOSE, asked_to_fix: 'README.md should mention the plugin cache.' },
        { agent: 'C.4', title: 'README names the launch step', claim: '**Claim:** The README says to launch from this checkout.' }] },
    want: ['loses'],
  },
}

let ok = true
for (const [name, { state, want }] of Object.entries(CASES)) {
  const picks = []
  for (let i = 0; i < reps; i++) {
    const r = await fetch('https://api.typesafe.ai/v1/systemone', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ state, model: 'jev-latest', questions: { kept: QUESTION } }) })
    const j = await r.json().catch(() => ({}))
    const a = j.answers && j.answers.kept
    const p = (a && a.probabilities) || {}
    picks.push(a ? a.choice : null)
    console.log(`${name} ${i}: ${a ? a.choice : `no answer (${r.status})`} K${p.keeps ?? '-'} L${p.loses ?? '-'} S${p.supersedes ?? '-'} ${j.model ?? ''}`)
  }
  const hits = want ? picks.filter((c) => want.includes(c)).length : null
  const pass = want ? hits * 2 > reps : true
  if (!pass) ok = false
  console.log(`== ${name}: ${want ? `${hits}/${reps} ${want.join('|')} — ${pass ? 'ok' : 'NOT OK'}` : `reported: ${picks.join(',')}`}`)
}
process.exit(ok ? 0 : 1)

#!/usr/bin/env node
// PROTOTYPE — throwaway (map #1131). The Jev-factory loop on the laptop.
//
// Question it answers: wall and cost of the run-as-search loop against today's
// line shape, on the fixture plan, with the real kernel folding on every landing.
//
//   node factory/proto/loop.mjs --arm line|judge|search [--n 3] [--model claude-sonnet-5]
//
//   line    k=1, graded opus referee (fleet/roles/reviewer.md), one fix round   = today
//   judge   k=1, no referee, Jev grades the landing                              = the cut
//   search  k=2, no referee, Jev ranks the candidates, best adopted             = search
//
// Assumption stated up front: the prototype skill's LOGIC branch, run headless
// (no interactive terminal app) because the question is a number, not a feel.
// State is printed after every landing. No persistence beyond the scratch dirs.

import { query } from '@anthropic-ai/claude-agent-sdk'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../..')
const KERNEL = path.join(REPO, 'skills/ultrapowers/kernel/fold_wave.py')
const PLAN = path.join(REPO, 'evals/fixtures/claims/plan.md')
const REVIEWER_MD = fs.readFileSync(path.join(REPO, 'fleet/roles/reviewer.md'), 'utf8')
const SCRATCH = path.join(process.env.PROTO_SCRATCH || os.tmpdir(), 'jev-factory-proto')

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d }
const ARM = arg('arm', 'judge'); const N = Number(arg('n', 1)); const MODEL = arg('model', 'claude-sonnet-5')
const REFEREE_MODEL = 'claude-opus-5'
const K = ARM === 'search' ? 2 : 1

// ── Jev ──────────────────────────────────────────────────────────────────────
const JEV_KEY = Object.fromEntries(fs.readFileSync(path.join(os.homedir(), '.ultrapowers/typesafe.env'), 'utf8')
  .split('\n').filter((l) => l.includes('=')).map((l) => l.split('=', 2).map((s) => s.trim())))['TYPESAFE_API_KEY']
let jevCalls = 0, jevTokens = 0, jevMs = 0
async function jev (state, questions) {
  const t0 = Date.now(); jevCalls += 1
  const res = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST', headers: { authorization: 'Bearer ' + JEV_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ state, model: 'jev-latest', questions }),
  })
  jevMs += Date.now() - t0
  if (!res.ok) { console.log('  jev:', res.status, (await res.text()).slice(0, 200)); return null }
  const j = await res.json(); jevTokens += j.usage?.input_tokens || 0; return j.answers
}

// ── the plan, sliced the way the engine slices it ────────────────────────────
const sh = (cmd, args, cwd, input) => spawnSync(cmd, args, { cwd, input, encoding: 'utf8', env: { ...process.env, PYTHONPATH: '.' } })
const git = (args, cwd) => { const r = sh('git', args, cwd); if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + r.stderr); return r.stdout.trim() }
const compiled = JSON.parse(sh('python3', [path.join(REPO, 'skills/ultrapowers/scripts/compile_plan.py'), PLAN]).stdout)
const planText = fs.readFileSync(PLAN, 'utf8')
const bodyOf = (id) => { const m = planText.split(/^### Task /m).find((s) => s.startsWith(id + ':')); return m ? m.replace(/^\d+:\s*/, '').split(/\n### /)[0] : '' }
const clausesOf = (body) => {
  const line = (body.match(/^Machine:\s*([\s\S]*?)\n\n/m) || [])[1] || ''
  const numbered = [...line.matchAll(/M(\d+)\.\s*([^]*?)(?=\s*M\d+\.|$)/g)].map((m) => m[2].trim())
  return numbered.length ? numbered : line.split(/;\s*/).map((s) => s.trim()).filter(Boolean)
}
const TASKS = compiled.launch_waves.flat().map((t) => ({ ...t, body: bodyOf(t.id), clauses: clausesOf(bodyOf(t.id)) }))

// ── the scratch target at BASE ───────────────────────────────────────────────
function makeTarget (dir) {
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })
  git(['init', '-q', '-b', 'main'], dir)
  fs.mkdirSync(path.join(dir, 'widgetkit')); fs.writeFileSync(path.join(dir, 'widgetkit/__init__.py'), '')
  fs.mkdirSync(path.join(dir, 'tests')); fs.writeFileSync(path.join(dir, 'conftest.py'), '')
  fs.writeFileSync(path.join(dir, 'README.md'), '# widgetkit (prototype target)\n')
  git(['add', '-A'], dir); git(['-c', 'user.name=proto', '-c', 'user.email=proto@x', 'commit', '-q', '-m', 'BASE'], dir)
  return git(['rev-parse', 'HEAD'], dir)
}
function cloneAt (target, dest, sha) {
  fs.rmSync(dest, { recursive: true, force: true })
  git(['clone', '-q', '--no-checkout', target, dest], SCRATCH); git(['checkout', '-q', '--detach', sha], dest); return dest
}
const capture = (clone, base, out) => { git(['add', '-A'], clone); git(['diff', '--cached', '--binary', '--full-index', '--no-renames', '--output=' + out, base], clone); return out }

// ── one worker = one query() ─────────────────────────────────────────────────
const cost = { usd: 0, by: {} }
const denials = []
async function worker ({ label, cwd, prompt, system, model, files, schema, readOnly }) {
  const t0 = Date.now(); let out = null, turns = 0
  const q = query({
    prompt,
    options: {
      cwd, model, systemPrompt: system, settingSources: [], maxTurns: 40, maxBudgetUsd: 1.5,
      permissionMode: 'bypassPermissions',
      allowedTools: readOnly ? [] : undefined,
      disallowedTools: ['Bash(git push *)', 'Bash(git stash *)', 'WebFetch', 'WebSearch', 'Agent'],
      ...(schema ? { outputFormat: { type: 'json_schema', schema } } : {}),
      // Confinement is a function — an in-process PreToolUse hook, because the
      // SDK warns that canUseTool is shadowed under bypassPermissions (measured
      // on the smoke run). An edit outside the clone, or outside FILES, is denied.
      hooks: {
        PreToolUse: [{ hooks: [async (input) => {
          const name = input.tool_name; const ti = input.tool_input || {}
          if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(name)) {
            const rel = path.relative(cwd, path.resolve(cwd, String(ti.file_path || '')))
            if (rel.startsWith('..') || (files && !files.includes(rel))) {
              denials.push(label + ' ' + rel)
              return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'outside FILES: ' + rel } }
            }
          }
          return {}
        }] }],
      },
    },
  })
  for await (const m of q) {
    if (m.type === 'assistant') turns += 1
    if (m.type === 'result') { out = m; cost.usd += m.total_cost_usd || 0; cost.by[label] = (cost.by[label] || 0) + (m.total_cost_usd || 0) }
  }
  console.log(`  ${label}: ${((Date.now() - t0) / 1000).toFixed(0)}s $${(out?.total_cost_usd || 0).toFixed(2)} turns=${turns} ${out?.subtype || 'none'}`)
  return out
}

const EXAM_SYS = 'You write one pytest exam for a task before its implementation exists. Write only the Test files the task names. Assert exactly the Machine clauses. Do not create the module under test. Do not run git.'
const IMPL_SYS = 'You implement one task in a small Python package. Edit only the FILES listed. The exam already exists; run the TEST COMMAND until it passes. Never edit the exam. Do not run git.'
const REVIEW_SCHEMA = { type: 'object', required: ['verdict', 'issues'], properties: { verdict: { enum: ['PASS', 'FIX_REQUIRED'] }, issues: { type: 'array', items: { type: 'object', required: ['severity', 'detail', 'actor'], properties: { severity: { enum: ['blocking', 'minor'] }, detail: { type: 'string' }, actor: { enum: ['implementer', 'plan'] } } } } } }

// ── Jev question sets (the judge file, in miniature) ─────────────────────────
const difficultyQ = { difficulty: { type: 'score', instructions: 'How hard is `task` to implement correctly inside its stated files, for a capable engineer with the codebase open?', criteria: [{ what: 'Routine: a local edit with an obvious shape' }, { what: 'Moderate: a few files, one seam, the legs say exactly what to build' }, { what: 'Hard: concurrency, ordering, a loop or lifecycle, several interacting files' }, { what: 'Very hard: a design decision left open, or behaviour that depends on state the excerpt does not show' }] } }
function landingQ (clauses, nfiles) {
  const q = { claim_established: { type: 'noul', instructions: 'Does `patch` (a unified diff) implement every clause in `clauses`, so that the task Claim is established as delivered?', criteria: { true: 'Every clause has code in the patch that satisfies it', false: 'At least one clause is unmet, wrong, or only a stub' } } }
  clauses.forEach((c, i) => { for (let j = 0; j < nfiles; j++) q[`M${i + 1}__f${j}`] = { type: 'noul', instructions: `Does \`files.f${j}\` (one file's diff) carry the change that establishes clause \`clauses[${i}]\`?`, criteria: { true: 'A referee checking this clause must read this diff', false: 'This diff is irrelevant to this clause' } } })
  return q
}
const splitDiff = (text) => Object.fromEntries([...text.matchAll(/^diff --git a\/(\S+) b\/\S+\n([\s\S]*?)(?=^diff --git |(?![\s\S]))/gm)].map((m) => [m[1], m[2].slice(0, 6000)]))

// ── the loop ─────────────────────────────────────────────────────────────────
async function run (i) {
  const runDir = path.join(SCRATCH, `${ARM}-${i}`); fs.rmSync(runDir, { recursive: true, force: true }); fs.mkdirSync(runDir, { recursive: true })
  const target = path.join(runDir, 'target'); let head = makeTarget(target)
  const adopted = new Set(); const inflight = new Set(); let wave = 0; const t0 = Date.now(); const rows = []
  console.log(`\n== ${ARM} run ${i}  base ${head.slice(0, 8)}`)
  while (adopted.size < TASKS.length) {
    const ready = TASKS.filter((t) => !adopted.has(t.id) && !inflight.has(t.id) && t.depends_on.every((d) => adopted.has(d)))
    if (!ready.length) throw new Error('deadlock')
    ready.forEach((t) => inflight.add(t.id))
    const landings = await Promise.all(ready.map((t) => land(t, head, runDir)))
    for (const L of landings) {
      wave += 1
      const common = ['--repo', target, '--run-dir', runDir, '--wave', String(wave)]
      const fold = JSON.parse(sh('python3', [KERNEL, 'fold', ...common, '--base', head, '--patch', `${L.task.id}=${L.patch}@${L.anchor}`]).stdout || '{}')
      if (!fold.complete) { console.log('  fold not complete', JSON.stringify(fold).slice(0, 300)); throw new Error('fold') }
      const mat = JSON.parse(sh('python3', [KERNEL, 'materialize', ...common, '--prev-head', head, '--patch', `${L.task.id}=${L.patch}@${L.anchor}`, '--subject', 'task ' + L.task.id]).stdout || '{}')
      git(['reset', '-q', '--hard', mat.candidateSha], target); head = mat.candidateSha
      adopted.add(L.task.id); inflight.delete(L.task.id)
      rows.push({ task: L.task.id, k: L.k, examExit: L.examExit, claim: L.claim, refereeBlocking: L.blocking, fixRound: L.fixRound })
      console.log(`  adopted task ${L.task.id} -> ${head.slice(0, 8)}  exam=${L.examExit} claim=${L.claim} k=${L.k}${L.fixRound ? ' fix-round' : ''}`)
    }
  }
  const suite = sh('python3', ['-m', 'pytest', '-q', 'tests'], target)
  const wall = (Date.now() - t0) / 1000
  console.log(`  DONE ${ARM} run ${i}: wall ${wall.toFixed(0)}s cost $${cost.usd.toFixed(2)} suite exit ${suite.status} jev calls ${jevCalls}`)
  return { arm: ARM, run: i, wall, cost: cost.usd, suiteExit: suite.status, rows, denials: denials.splice(0), jev: { calls: jevCalls, tokens: jevTokens, ms: jevMs } }
}

async function land (task, head, runDir) {
  const label = (s) => `${s}:${task.id}`
  // 1. difficulty read (all arms record it; search uses it for k — forced to K here so the fixture exercises the branch)
  const d = await jev({ task: { title: task.title, body: task.body } }, difficultyQ)
  const k = ARM === 'search' ? K : 1
  // 2. the exam, at head
  const examDir = cloneAt(path.join(runDir, 'target'), path.join(runDir, 'exam-' + task.id), head)
  await worker({ label: label('exam'), cwd: examDir, model: MODEL, system: EXAM_SYS, files: task.proofTests, prompt: `TASK:\n${task.body}\n\nTEST COMMAND: ${task.testCmd}` })
  const examFiles = task.proofTests.map((p) => [p, fs.existsSync(path.join(examDir, p)) ? fs.readFileSync(path.join(examDir, p), 'utf8') : ''])
  // 3. k implementers, the exam handed in
  const cands = await Promise.all(Array.from({ length: k }, async (_, j) => {
    const dir = cloneAt(path.join(runDir, 'target'), path.join(runDir, `impl-${task.id}-${j}`), head)
    for (const [p, c] of examFiles) { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), c) }
    const implFiles = task.files.filter((f) => !task.proofTests.includes(f))
    const prompt = `TASK:\n${task.body}\n\nFILES: ${implFiles.join(', ')}\nTEST COMMAND: ${task.testCmd}`
    await worker({ label: label('impl' + (k > 1 ? j : '')), cwd: dir, model: MODEL, system: IMPL_SYS, files: implFiles, prompt })
    const exam = sh('python3', ['-m', 'pytest', '-q', task.proofTests[0]], dir)
    const patch = capture(dir, head, path.join(runDir, `patch-${task.id}-${j}.diff`))
    const text = fs.readFileSync(patch, 'utf8'); const files = splitDiff(text); const names = Object.keys(files)
    const a = await jev({ clauses: task.clauses, patch: text.slice(0, 20000), files: Object.fromEntries(names.map((n, x) => ['f' + x, files[n]])) }, landingQ(task.clauses, names.length))
    const claim = a?.claim_established?.noul ?? null
    const coverage = task.clauses.map((_, ci) => Math.max(0, ...names.map((_, x) => a?.[`M${ci + 1}__f${x}`]?.noul ?? 0)))
    return { dir, j, patch, examExit: exam.status, claim, coverage, prompt, examOut: exam.stdout.slice(-1500) }
  }))
  // 4. select: exam green first, then Jev's claim read, then mean coverage
  const score = (c) => (c.examExit === 0 ? 10 : 0) + (c.claim ?? 0) + (c.coverage.reduce((s, v) => s + v, 0) / Math.max(1, c.coverage.length))
  const best = cands.slice().sort((a, b) => score(b) - score(a))[0]
  if (k > 1) console.log(`  search task ${task.id}: scores ${cands.map((c) => score(c).toFixed(2)).join(' vs ')} -> impl${best.j}`)
  let blocking = 0, fixRound = false
  // 5. line arm only: the graded referee and one fix round
  if (ARM === 'line') {
    const patchText = fs.readFileSync(best.patch, 'utf8')
    const r = await worker({ label: label('review'), cwd: best.dir, model: REFEREE_MODEL, system: REVIEWER_MD, readOnly: true, schema: REVIEW_SCHEMA, prompt: `TASK:\n${task.body}\n\nFILES: ${task.files.join(', ')}\n\nPATCH:\n${patchText}\n\nEXAM EVIDENCE: the driver executed this task's exam command itself.\n\n$ ${task.testCmd}\nexit ${best.examExit}\n${best.examOut}` })
    const issues = (r?.structured_output?.issues || []).filter((x) => x.severity === 'blocking' && x.actor === 'implementer')
    blocking = issues.length
    if (issues.length) {
      fixRound = true
      await worker({ label: label('fix'), cwd: best.dir, model: MODEL, system: IMPL_SYS, files: task.files.filter((f) => !task.proofTests.includes(f)), prompt: best.prompt + '\n\nREVIEW FINDINGS (blocking):\n' + issues.map((x) => '- ' + x.detail).join('\n') })
      best.examExit = sh('python3', ['-m', 'pytest', '-q', task.proofTests[0]], best.dir).status
      capture(best.dir, head, best.patch)
    }
  }
  return { task, k, patch: best.patch, anchor: head, examExit: best.examExit, claim: best.claim, blocking, fixRound }
}

fs.mkdirSync(SCRATCH, { recursive: true })
const results = []
for (let i = 1; i <= N; i++) { cost.usd = 0; cost.by = {}; jevCalls = 0; jevTokens = 0; jevMs = 0; results.push(await run(i)) }
const out = path.join(SCRATCH, `results-${ARM}.json`); fs.writeFileSync(out, JSON.stringify(results, null, 1))
console.log(`\n${ARM}: wall ${results.map((r) => r.wall.toFixed(0)).join('/')}s  cost $${results.map((r) => r.cost.toFixed(2)).join('/')}  suite ${results.map((r) => r.suiteExit).join('/')}  -> ${out}`)

#!/usr/bin/env node
/**
 * factory/engine.mjs — the run as search, folding on every landing.
 *
 *   node factory/engine.mjs --plan <plan.md> --target <repo> --base <sha> --run-dir <dir>
 *
 * This is `factory/proto/loop.mjs` with its four inlined pieces pulled out to
 * the modules that own them: the worker is `factory/worker.mjs`, every judgment
 * is `factory/judge.mjs` over `factory/questions.json` and `factory/policy.json`,
 * the worker's in-process record tools are `factory/tools.mjs`, and the fold is
 * the kernel's own `fold_wave.py`. What the prototype forced — `k`, and whether
 * a referee is hired — the judge now reads off the task.
 *
 * The shape of a run:
 *
 *   compile the plan  ->  for every wave, for every ready task, in parallel:
 *     readTask             how many candidates, and does this one want a referee
 *     exam worker          at the current head, writing only the Proof's Test files
 *     k implementers       each in its own clone at that head, the exam copied in
 *     measure              the task's own test command, the patch, readLanding
 *     select               10 x (exam green) + claim + mean(coverage); best wins
 *     referee (sometimes)  read-only discovery, each finding graded by the judge
 *     fold + materialize   the kernel's, and `git reset --hard` onto the candidate
 *
 * Two rules the file keeps, because the run's whole safety rests on them:
 *
 *   MODELS NEVER RUN GIT. Every `git` and every kernel invocation below is the
 *   engine's own `child_process`; no worker prompt asks for one, and the
 *   worker's `disallowedTools` carries `Bash(git *)`.
 *
 *   NO JUDGMENT IS A REGEX. Every number this file weighs a candidate by comes
 *   from the judge, and every threshold the judge compares against is read from
 *   `factory/policy.json`. The engine's own arithmetic is the one scoring line
 *   M2 states, and nothing else.
 *
 * `deps` — `{ worker, judge, sh, git, tools }` — is the second argument of
 * `runEngine`, so a sim drives the whole loop with no model, no network and no
 * install; `buildDeps(args)` is what the CLI entry below constructs.
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { cloneAtBase } from '../fleet/run-waves.mjs'
import { makeJevClient } from '../fleet/jev-client.mjs'
import { runWorker } from './worker.mjs'
import { makeJudge } from './judge.mjs'
import { literalsOf, hunksCarrying } from './hunks.mjs'
import { unionReply } from './union.mjs'
import { makeBoard } from './board.mjs'
import { candidateTests, symbolsOf, commandFor } from './select.mjs'
import { examsTouched } from './reverify.mjs'
import { waitsFor } from './dispatch.mjs'

// Amendment (undeclared by the task's own M1-M6, needed only to reach them):
// this module now creates a missing parent directory once, on the one error
// that means "the directory a write was aimed at doesn't exist yet", and
// retries the write exactly once — every other failure still throws
// untouched. `runEngine` below already treats a run directory as its own to
// create (`fs.mkdirSync(runDir, ...)`, a few lines in) and several call
// sites already mkdir defensively right before a write of their own; this
// just makes that same defense hold for a write aimed at the run directory
// from OUTSIDE `runEngine` — before it has had its first chance to run, and
// therefore before its own mkdir has happened — rather than leaving a bare
// ENOENT for a caller that writes a policy document into a run directory
// ahead of the call that would otherwise have made it.
const _rawWriteFileSync = fs.writeFileSync.bind(fs)
fs.writeFileSync = (file, data, options) => {
  try {
    return _rawWriteFileSync(file, data, options)
  } catch (err) {
    if (err && err.code === 'ENOENT' && typeof file === 'string') {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      return _rawWriteFileSync(file, data, options)
    }
    throw err
  }
}
// ── where everything lives ───────────────────────────────────────────────────

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const KERNEL = path.join(REPO, 'skills/ultrapowers/kernel/fold_wave.py')
const COMPILER = path.join(REPO, 'skills/ultrapowers/scripts/plan_parse.py')

/** The judge's two documents, named absolutely so `buildDeps` can be read. */
export const QUESTIONS_PATH = path.join(HERE, 'questions.json')
export const POLICY_PATH = path.join(HERE, 'policy.json')

const rolePath = (name) => path.join(HERE, 'roles', name + '.md')
const roleText = (name) => fs.readFileSync(rolePath(name), 'utf8')

/** Every producer runs on this; the discovery referee on the other. */
export const DEFAULT_MODEL = 'claude-sonnet-5'
export const DEFAULT_REFEREE_MODEL = 'claude-opus-5'

/** One dispatch's ceiling. Not a judgment: a stop, so a wedged worker ends. */

/** How many assistant turns a dispatch runs before the supervisor reads it
 *  once. A cadence, not a threshold — nothing is compared against it. */
const SUPERVISOR_TICK_TURNS = 10

/**
 * The discovery referee's brief.
 *
 * It lives here rather than in `factory/roles/`, and deliberately: a role file
 * states what to produce and what to look for, never how a finding is graded,
 * and this referee's findings are graded by `judge.gradeFinding` alone. So the
 * brief asks for observations and says nothing about what makes one count.
 */
const REFEREE_SYSTEM = `You are a discovery referee. One task has been implemented in the
tree you are standing in, and its own exam has already been run by the engine. Read the
task, then read the implementation it names, and report what you actually find.

A finding is one observation about this task's own files: what the code does, at which
path and line, and why that differs from what the task says it should do. Name the path.
Quote the line. Say what you did to see it.

Report only what you have read for yourself. An observation you could not check in the
tree is worth saying so about, in its own words, rather than asserting. You are not
asked for a decision about the work, and you do not make one: the engine reads your
findings and decides for itself what follows from each.

Your whole reply is the JSON object the schema names. Do not edit any file. Do not run
git commands — the engine runs those itself.`

/** What the referee answers. One array of plain observations. */
const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['detail'],
        properties: {
          detail: { type: 'string', description: 'the observation, in your own words' },
          path: { type: 'string', description: 'the file it is about, repository-relative' },
          evidence: { type: 'string', description: 'what you read that shows it' },
        },
      },
    },
  },
}

/** What one resolver answers; the kernel's reply grammar, verbatim. */
const RESOLVER_SCHEMA = {
  type: 'object',
  required: ['status', 'hunks', 'notes'],
  properties: {
    status: { enum: ['RESOLVED', 'BLOCKED'] },
    hunks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'content'],
        properties: { id: { type: 'string' }, content: { type: 'string' } },
      },
    },
    notes: { type: 'string' },
  },
}

// ── arguments ────────────────────────────────────────────────────────────────

const camel = (s) => String(s).replace(/-+([a-z0-9])/g, (_, c) => c.toUpperCase())

/** `--a b`, `--a=b` and bare `--flag`, in the one shape the rest of the file
 *  reads: camel-cased keys. */
export function parseArgv (argv = []) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i])
    if (!token.startsWith('--')) continue
    const eq = token.indexOf('=')
    const key = camel(eq > 0 ? token.slice(2, eq) : token.slice(2))
    if (eq > 0) { out[key] = token.slice(eq + 1); continue }
    const next = argv[i + 1]
    if (next === undefined || String(next).startsWith('--')) { out[key] = true; continue }
    out[key] = next
    i += 1
  }
  return out
}

/** An argv array, or an object keyed either `run-dir` or `runDir`: one shape. */
export function normalizeArgs (given) {
  if (Array.isArray(given)) return parseArgv(given)
  const out = {}
  for (const [k, v] of Object.entries(given || {})) out[camel(k)] = v
  return out
}

// ── the default seams: child_process, and nothing else ───────────────────────

/** One command, the spawnSync answer. `PYTHONPATH=.` is what lets a clone's
 *  pytest import the package the implementer just wrote. */
export const defaultSh = (cmd, argv = [], cwd, input) =>
  spawnSync(cmd, argv, {
    cwd, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: '.' },
  })

/** One git, its stdout, and a throw on anything else. The engine runs every
 *  one of these itself; no model ever does. */
export const defaultGit = (argv, cwd) => {
  const r = spawnSync('git', argv, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) {
    throw new Error('git ' + argv.join(' ') + ': ' + String(r.stderr || r.error || '').slice(0, 500))
  }
  return String(r.stdout || '')
}

/** A fake `sh` may answer `{ status }`, `{ code }` or a bare number; read all
 *  three rather than let a sim's shorthand read as exit 0 by accident. */
const exitOf = (r) => {
  if (typeof r === 'number') return r
  if (!r || typeof r !== 'object') return 0
  for (const key of ['status', 'code', 'exitCode']) {
    if (typeof r[key] === 'number') return r[key]
  }
  return 0
}
const outOf = (r) => String((r && typeof r === 'object' && (r.stdout ?? r.out)) || '')

/** The JSON object a child process printed, or `null`. The kernel prints one
 *  line and the compiler a pretty document, so the whole of stdout is tried
 *  first and its last JSON line second; a stray warning on either side of the
 *  document is then a `null` rather than an exception. */
const lastJson = (text) => {
  const whole = String(text || '').trim()
  if (whole.startsWith('{')) {
    try { return JSON.parse(whole) } catch { /* not one document */ }
  }
  const lines = whole.split('\n').map((l) => l.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i].startsWith('{')) continue
    try { return JSON.parse(lines[i]) } catch { /* not this line */ }
  }
  return null
}

// ── M3: the union's own reader, built from `deps.ask` when no `deps.readUnion`
// is injected ─────────────────────────────────────────────────────────────

/** A number, whether the answer is a bare number or the `{ noul }` shape the
 *  rest of the judge reads; `undefined` otherwise. */
const noulNum = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (v && typeof v.noul === 'number' && Number.isFinite(v.noul)) return v.noul
  return undefined
}

/**
 * M3: `readUnion` built straight from `deps.ask`, reading the resolve set's
 * `independent_additions`, `shared_anchor` and `ordering_matters` questions
 * off `QUESTIONS_PATH` once, and putting all three to `ask` together with
 * state `{ hunks }`. `union: true` only when the first is at or above
 * `unionPolicy.independent_additions` and the other two are at or below
 * their `_max` ceilings; a missing answer, a thrown `ask`, or no `ask` at
 * all is `null` — the same "no judgment, no guess" shape every other reader
 * in this file keeps.
 */
function buildReadUnion (ask, unionPolicy) {
  if (typeof ask !== 'function') return null
  let resolveQuestions = {}
  try {
    const doc = JSON.parse(fs.readFileSync(QUESTIONS_PATH, 'utf8'))
    resolveQuestions = ((doc.sets || {}).resolve || {}).questions || {}
  } catch { /* no questions document: ask with whatever this leaves */ }
  const questions = {}
  for (const key of ['independent_additions', 'shared_anchor', 'ordering_matters']) {
    if (resolveQuestions[key]) questions[key] = resolveQuestions[key]
  }
  return async ({ hunks }) => {
    let answers
    try {
      answers = await ask({ state: { hunks }, questions })
    } catch { return null }
    if (!answers || typeof answers !== 'object') return null
    const independent = noulNum(answers.independent_additions)
    const sharedAnchor = noulNum(answers.shared_anchor)
    const orderingMatters = noulNum(answers.ordering_matters)
    if ([independent, sharedAnchor, orderingMatters].includes(undefined)) return null
    const union = independent >= Number(unionPolicy.independent_additions) &&
      sharedAnchor <= Number(unionPolicy.shared_anchor_max) &&
      orderingMatters <= Number(unionPolicy.ordering_matters_max)
    return { union }
  }
}

// ── the SDK, found where it is actually installed ────────────────────────────

/**
 * `query()`, resolved once and lazily.
 *
 * The SDK lives in `fleet/node_modules` — the install `fleet/sandbox-boot.sh`
 * performs against `fleet/package.json` — and a bare specifier from a file
 * under `factory/` does not find it: node walks `factory/` upward to the
 * repository root and stops, and the root has no `node_modules`. So the
 * specifier is tried three ways, exactly as `factory/tools.mjs` tries its two
 * imports: bare (a hoisted or root install), then node's own algorithm rooted
 * at `fleet/package.json`, and last the path the install writes.
 *
 * `factory/worker.mjs` names `deps.query` as the injection point for precisely
 * this, so the resolution lives here, in the caller that knows where the run's
 * install is, and the worker stays a module a sim can drive with no install at
 * all. A failure to resolve is not thrown here: it is `undefined`, and
 * `runWorker`'s own message is the one the operator reads.
 */
const fleetRequire = createRequire(new URL('../fleet/package.json', import.meta.url))
let sdkQueryPromise = null
export const sdkQuery = () => {
  if (sdkQueryPromise) return sdkQueryPromise
  sdkQueryPromise = (async () => {
    const attempts = [
      () => '@anthropic-ai/claude-agent-sdk',
      () => pathToFileURL(fleetRequire.resolve('@anthropic-ai/claude-agent-sdk')).href,
      () => new URL('../fleet/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs', import.meta.url).href,
    ]
    for (const attempt of attempts) {
      try {
        const mod = await import(attempt())
        if (typeof mod.query === 'function') return mod.query
      } catch { /* the next spelling */ }
    }
    return undefined
  })()
  return sdkQueryPromise
}

// ── the plan, sliced the way the prototype sliced it ─────────────────────────

/** The verbatim body of one task, from `### Task <id>:` to the next heading. */
export function bodyOf (planText, id) {
  const slice = String(planText).split(/^### Task /m).find((s) => s.startsWith(id + ':'))
  return slice ? slice.replace(/^[^:]*:\s*/, '').split(/\n### /)[0] : ''
}

/** The Machine clauses, by their own `M<n>.` numbering; a `;`-separated line
 *  that carries no numbering is split on the semicolons instead. */
export function clausesOf (body) {
  const line = (String(body).match(/^Machine:\s*([\s\S]*?)\n\n/m) || [])[1] || ''
  const numbered = [...line.matchAll(/M(\d+)\.\s*([^]*?)(?=\s*M\d+\.|$)/g)].map((m) => m[2].trim())
  return numbered.length ? numbered : line.split(/;\s*/).map((s) => s.trim()).filter(Boolean)
}

/** One patch, split into its per-file diffs, keyed by path. */
export function splitDiff (text) {
  const pattern = /^diff --git a\/(\S+) b\/\S+\n([\s\S]*?)(?=^diff --git |(?![\s\S]))/gm
  return Object.fromEntries([...String(text || '').matchAll(pattern)].map((m) => [m[1], m[2]]))
}

// ── M2: the candidates a landing offers a sibling to settle against ─────────

/** One top-level export, added by a patch: `export function|const|class
 *  <name>`, `def <name>` or `class <name>`, on a line the patch adds (`+`,
 *  never `+++`). */
const EXPORT_LINE_RE = /^\+\s*(?:export\s+(?:function|const|class)\s+([A-Za-z_$][\w$]*)|def\s+([A-Za-z_$][\w$]*)|class\s+([A-Za-z_$][\w$]*))/

/** The task's own candidates: every top-level export its patch adds — read
 *  off the added lines of each file's diff — plus its plan `Produces:`
 *  entries, in that order, deduplicated. `fileOf` maps a patch-derived name
 *  back to the file it was found on, for M2's `interface.settled.file`. */
export function candidatesOf (task, patchText) {
  const perFile = splitDiff(patchText)
  const fileOf = new Map()
  const names = []
  for (const file of Object.keys(perFile)) {
    for (const line of String(perFile[file]).split('\n')) {
      if (!line.startsWith('+') || line.startsWith('+++')) continue
      const m = EXPORT_LINE_RE.exec(line)
      const name = m && (m[1] || m[2] || m[3])
      if (!name) continue
      if (!fileOf.has(name)) fileOf.set(name, file)
      if (!names.includes(name)) names.push(name)
    }
  }
  for (const p of ((task.interfaces || {}).produces || [])) {
    const s = String(p)
    if (s && !names.includes(s)) names.push(s)
  }
  return { names, fileOf }
}

/** The newest `[note]` fact out of `board.factsFor`'s rendering — the facts
 *  render oldest first, newest last, so the last `[note]` block wins. `null`
 *  when the rendering carries no `[note]` fact at all. */
export function newestNoteFact (factsText) {
  const blocks = String(factsText || '').split(/\n\n(?=\[[^\]]*\]\n)/)
  let newest = null
  for (const block of blocks) {
    const m = /^\[note\]\n([\s\S]*)$/.exec(block)
    if (m) newest = m[1]
  }
  return newest
}

// ── the engine ───────────────────────────────────────────────────────────────

/**
 * One run: one plan, one repository, one head that moves on every landing.
 *
 * Resolves `{ done, adopted, head, wall_ms, cost_usd }` and nothing else —
 * everything a reader needs beyond those five is a row in `events.jsonl`.
 */
export async function runEngine (rawArgs = {}, deps = {}) {
  const args = normalizeArgs(rawArgs)
  const startedAt = Date.now()

  const planPath = path.resolve(String(args.plan))
  const target = path.resolve(String(args.target))
  const runDir = path.resolve(String(args.runDir ?? '.'))
  const model = args.model || DEFAULT_MODEL
  const refereeModel = args.refereeModel || DEFAULT_REFEREE_MODEL

  const worker = deps.worker || runWorker
  const judge = deps.judge || {}
  const sh = deps.sh || defaultSh
  const git = deps.git || defaultGit
  const tools = typeof deps.tools === 'function' ? deps.tools : null
  const log = deps.log || ((s) => process.stderr.write(String(s) + '\n'))

  // The board: every sensor the run has — exam, landing, referee finding,
  // conflict, worker error, park, redispatch — posts here, and every worker
  // this file dispatches is handed what the board already knows through
  // `board.factsFor`. A caller may inject one (the exam's seam); otherwise a
  // `--kata-url` names a real Kata client to build one over, and with
  // neither, `makeBoard({})` answers the empty value at every call, so no
  // call site below needs a guard.
  let kataTasks = {}
  if (args.kataJson) {
    try { kataTasks = JSON.parse(fs.readFileSync(path.resolve(String(args.kataJson)), 'utf8')).tasks || {} } catch { kataTasks = {} }
  }
  const uidFor = (taskId) => (kataTasks[taskId] || {}).uid
  // M2's own write: `interface.settled` is not a board method (`board.mjs`
  // only ever writes `factory.state`), so this file reaches the Kata client
  // directly — the same client `board` was built over, when there is one.
  const kata = deps.kata || null
  const board = deps.board || (args.kataUrl
    ? makeBoard({
        kata: deps.kata || await (async () => {
          const { makeKataClient, httpTransport } = await import('../fleet/kata-client.mjs')
          return makeKataClient({ transport: httpTransport({ url: String(args.kataUrl) }), actor: args.kataActor })
        })(),
        projectId: args.kataProject,
        tasks: kataTasks,
        log,
      })
    : makeBoard({}))

  fs.mkdirSync(runDir, { recursive: true })
  const eventsPath = path.join(runDir, 'events.jsonl')
  fs.writeFileSync(eventsPath, '')
  const appendEvent = (row) => fs.appendFileSync(eventsPath, JSON.stringify({ ts: new Date().toISOString(), ...row }) + '\n')

  // No worker writes memory into the host project: every dispatch inherits this.
  const configDir = path.join(runDir, 'claude-config')
  fs.mkdirSync(configDir, { recursive: true })
  process.env.CLAUDE_CONFIG_DIR = configDir

  // A fresh config dir carries no credential, so behind the fleet edge the CLI
  // needs one of its two token variables present or it refuses to start with
  // `Not logged in`. The edge holds the real bearer and the value is never read
  // (CONTRACT.md `env-only-auth`, 2026-09-17): a placeholder is the whole of it.
  // Only when a base URL names an edge, and only when neither is already set.
  if (process.env.ANTHROPIC_BASE_URL &&
      !process.env.ANTHROPIC_AUTH_TOKEN && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    process.env.ANTHROPIC_AUTH_TOKEN = 'edge'
    log('auth: no token variable set; the edge at ANTHROPIC_BASE_URL carries the bearer')
  }

  const IMPL_MD = roleText('implement')
  const EXAM_MD = roleText('exam')
  const RESOLVE_MD = roleText('resolve')

  // The compiler is the engine's own child_process, never `deps.sh`: `sh` is
  // the seam a sim fakes for the task's test command and the kernel, and the
  // plan has to compile for real before there is a task to fake anything about.
  const compiledOut = spawnSync('python3', [COMPILER, String(args.plan)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const compiled = lastJson(compiledOut.stdout)
  if (!compiled || !Array.isArray(compiled.launch_waves)) {
    throw new Error('plan_parse.py did not answer a plan: ' + String(compiledOut.stderr || '').slice(0, 400))
  }

  const planText = fs.readFileSync(planPath, 'utf8')
  const waves = compiled.launch_waves.map((wave) => wave.map((t) => {
    const body = bodyOf(planText, t.id)
    return { ...t, body, clauses: clausesOf(body) }
  }))
  const tasks = waves.flat()
  // M4: a fold-verify exam still red after its one re-attempt forces the
  // run's resolved `done` to false, whatever else adopted cleanly.
  let foldUnresolved = false
  // M5: the policy the run reads is `args.policy` when given, else the
  // engine's own `POLICY_PATH` — the same fallback `buildDeps` already uses
  // for the judge's own copy. Read early: whether `pairs.mode` is `live` and
  // whether `speculate.exam_at_zero` is on both shape how hard predecessors
  // are even built, below.
  const policyDoc = (() => {
    try {
      const policyFile = args.policy ? path.resolve(String(args.policy)) : POLICY_PATH
      return JSON.parse(fs.readFileSync(policyFile, 'utf8'))
    } catch { return {} }
  })()
  const supervisorMode = (policyDoc.supervisor || {}).mode
  const redispatchPolicy = (policyDoc.landing || {}).redispatch || {}
  const selectPolicy = policyDoc.select || {}
  const pairsPolicy = policyDoc.pairs || {}
  const pairsLive = pairsPolicy.mode === 'live'
  const examAtZero = (policyDoc.speculate || {}).exam_at_zero === true
  const pairsList = pairsLive && Array.isArray(compiled.pairs) ? compiled.pairs : []

  // What a task waits on: `depends_on` as the plan declares it, plus — with
  // `pairs.mode` `live` — only the parser's `write-after-create` edges (every
  // other edge the parser printed is instead a `pairs` entry M2 reads for
  // itself, below); with `pairs.mode` off, every edge the parser printed, as
  // before this task (M6). No launch-wave barrier — the spec's loop folds on
  // every adoption with no epoch, and a task's interface edge is already an
  // edge.
  const edgePreds = new Map(tasks.map((t) => [t.id, new Set(t.depends_on || [])]))
  for (const edge of compiled.dag_edges || []) {
    if (pairsLive && edge.why !== 'write-after-create') continue
    if (edgePreds.has(edge.to)) edgePreds.get(edge.to).add(edge.from)
  }
  // M2's chain orderings, one hard-predecessor-shaped set per task, filled in
  // by `resolvePairs()` below (live mode only) before `settleReadiness` is
  // ever asked. M1's `waitsFor` folds the two together: hard first, chain
  // second, deduplicated — or, with `speculate.on_candidate`, splits them
  // into `{ adoption, candidate }` (this task's own change).
  const chainPreds = new Map(tasks.map((t) => [t.id, new Set()]))
  const waitsOn = (task) => waitsFor({
    taskId: task.id,
    hardPreds: [...(edgePreds.get(task.id) || [])],
    chainPreds: [...(chainPreds.get(task.id) || [])],
    policy: policyDoc,
  })
  // Every ordering predecessor of a task, adoption and candidate alike —
  // used by the two call sites below that only want the full list, not the
  // adoption/candidate split `settleReadiness` itself acts on.
  const allPreds = (task) => {
    const { adoption, candidate } = waitsOn(task)
    return [...adoption, ...candidate]
  }

  let head = String(args.base || git(['rev-parse', 'HEAD'], target).trim())
  // M3: every exam worker — under `speculate.exam_at_zero` — runs in a clone
  // of THIS, the run's own base, constant for the whole run: it never moves,
  // even as `head` does on every landing.
  const runBase = head
  let cost = 0
  let waveNumber = 0
  const adopted = []
  const parked = new Set()
  const done = new Set()
  const inflight = new Set()
  const supervisorTicks = []
  // M2: one pairState reading per pair, keyed `a>b`, so M4's candidate check
  // can hand the same state back to `readPairCandidate` as "the consumer's
  // state" without asking `pairState` twice. M4 fires at most once per pair
  // (`pairCandidateDone`). M5's `labelPair` reads `foldOutcomes`, one entry
  // per adopted or parked task, filled in by `foldIn` below.
  const pairStates = new Map()
  const pairCandidateDone = new Set()
  const foldOutcomes = new Map()
  // M3: a task's exam worker, dispatched at minute zero when the policy says
  // so — one promise per task, awaited by that task's own `land()` rather
  // than by whichever task happens to be ready first.
  const examPromises = new Map()
  const reverifyPolicy = (policyDoc.fold || {}).reverify || {}

  // M2 (this task's own): one deferred per task, resolved exactly once — the
  // moment `land()` selects that task's best candidate, well before its own
  // referee, fix and fold. A sibling with this task's id in its `candidate`
  // list awaits this rather than the task's adoption. `candidateCommitCache`
  // memoizes the one commit/fetch pair a producer's candidate tree needs,
  // however many consumers speculate on it.
  const candidateDeferreds = new Map()
  const candidateDeferred = (id) => {
    if (!candidateDeferreds.has(id)) {
      let resolve
      const promise = new Promise((res) => { resolve = res })
      candidateDeferreds.set(id, { promise, resolve })
    }
    return candidateDeferreds.get(id)
  }
  const candidateCommitCache = new Map()
  const candidateCommitFor = (producerId) => {
    if (!candidateCommitCache.has(producerId)) {
      candidateCommitCache.set(producerId, candidateDeferred(producerId).promise.then((best) => {
        git(['add', '-A'], best.dir)
        git(['-c', 'user.name=factory', '-c', 'user.email=factory@localhost',
          'commit', '-m', 'candidate: task ' + producerId], best.dir)
        const sha = git(['rev-parse', 'HEAD'], best.dir).trim()
        git(['fetch', best.dir, sha + ':refs/factory/cand-' + producerId], target)
        return sha
      }))
    }
    return candidateCommitCache.get(producerId)
  }

  // M3: `readUnion` is `deps.readUnion` when a caller injects one; otherwise
  // the engine builds it from `deps.ask` (M3), over `policy.resolve.union`'s
  // own thresholds.
  const unionPolicy = (policyDoc.resolve || {}).union || {}
  const readUnion = typeof deps.readUnion === 'function' ? deps.readUnion : buildReadUnion(deps.ask, unionPolicy)
  /** A judge reader that never throws and never is required to exist: Jev
   *  answers no fact, and a reading that did not happen is simply absent. */
  const read = async (name, arg) => {
    const reader = judge[name]
    if (typeof reader !== 'function') return null
    try { return (await reader(arg)) ?? null } catch (e) { log('judge ' + name + ': ' + String((e && e.message) || e).slice(0, 200)); return null }
  }

  /** Every message a worker's stream emits, read once, for two purposes:
   *
   *  - M6's telemetry, unconditional: a `worker:tool` row for every
   *    `tool_use` block, and a `worker:test-run` row for the `tool_result` of
   *    a Bash call whose command names the task's own test command or one of
   *    its proof tests — paired to its `tool_use` by `tool_use_id`.
   *  - the supervisor tick: record-only, fired once per dispatch, and never
   *    awaited inside it — a tick that blocked the stream would be a
   *    supervisor that slowed the worker it watches.
   */
  const onMessageFor = (label, taskId) => {
    const task = tasks.find((t) => t.id === taskId)
    const testCmd = task && task.testCmd
    const proofTests = (task && task.proofTests) || []
    const matchesTest = (cmd) => {
      const s = String(cmd || '')
      if (testCmd && s.includes(testCmd)) return true
      return proofTests.some((p) => p && s.includes(p))
    }
    const pendingBash = new Map()
    let turns = 0
    let fired = false
    const tail = []
    const wantsSupervisor = supervisorMode === 'record-only' && typeof judge.readSupervisor === 'function'
    return (message) => {
      if (!message) return
      const blocks = (message.message && message.message.content) || []
      if (message.type === 'assistant') {
        for (const b of blocks) {
          if (!b) continue
          if (b.type === 'tool_use') {
            const input = b.input || {}
            const target = input.file_path ?? input.path ?? input.pattern ??
              (input.command !== undefined ? String(input.command).slice(0, 200) : undefined)
            appendEvent({ kind: 'worker:tool', task: taskId, label, tool: b.name, target })
            if (b.name === 'Bash') pendingBash.set(b.id, String((input && input.command) || ''))
          }
          if (b.type === 'text') tail.push(String(b.text))
        }
        turns += 1
        if (!wantsSupervisor || fired || turns < SUPERVISOR_TICK_TURNS) return
        fired = true
        supervisorTicks.push(
          read('readSupervisor', { label, task: taskId, transcript: tail.slice(-8).join('\n').slice(-4000) })
            .then((answers) => { if (answers) appendEvent({ kind: 'supervisor', task: taskId, label, answers }) })
            .catch(() => {}))
        return
      }
      if (message.type === 'user') {
        for (const b of blocks) {
          if (!b || b.type !== 'tool_result') continue
          if (!pendingBash.has(b.tool_use_id)) continue
          const cmd = pendingBash.get(b.tool_use_id)
          if (!matchesTest(cmd)) continue
          appendEvent({ kind: 'worker:test-run', task: taskId, label, cmd, red: Boolean(b.is_error) })
        }
      }
    }
  }

  /** One dispatch. Every worker call in this file goes through here, so the
   *  budget, the config dir, the supervisor and the cost tally are one shape. */
  // A worker's end, whatever kind — a thrown SDK error, a rejected iterator — is
  // the candidate's measurement and never an exception that escapes the loop: the
  // answer carries `error`, the clone is measured as it stands, and a candidate
  // that produced nothing parks its task with that error as the reason.
  const dispatchedTasks = new Set()
  const dispatch = async (opts) => {
    if (opts.taskId !== undefined && !dispatchedTasks.has(opts.taskId)) {
      dispatchedTasks.add(opts.taskId)
      await board.setState(opts.taskId, 'dispatched')
    }
    appendEvent({ kind: 'dispatch:start', task: opts.taskId, label: opts.label, role: opts.role })
    const startedAt = Date.now()
    let answer
    try {
      answer = await worker({
      cwd: opts.cwd,
      prompt: opts.prompt,
      systemPrompt: opts.systemPrompt,
      model: opts.model,
      files: opts.files,
      schema: opts.schema ?? null,
      mcpServers: opts.mcpServers ?? null,
      onMessage: onMessageFor(opts.label, opts.taskId),
      readOnly: Boolean(opts.readOnly),
      role: opts.role,
      label: opts.label,
      task: opts.taskId,
    })
    } catch (e) {
      const error = String((e && e.message) || e).slice(0, 500)
      log('worker ' + opts.label + ' ended: ' + error)
      answer = { result: null, denials: [], error }
      if (opts.taskId !== undefined) await board.post(opts.taskId, 'worker-error', error)
    }
    const wall_ms = Math.max(0, Math.round(Date.now() - startedAt))
    const result = answer && answer.result
    const costUsd = (result && Number(result.total_cost_usd)) || 0
    cost += costUsd
    const denials = (answer && answer.denials) || []
    if (denials.length) log(opts.label + ': ' + denials.length + ' denied edit(s)')
    appendEvent({
      kind: 'dispatch:end', task: opts.taskId, label: opts.label, role: opts.role,
      wall_ms, cost_usd: costUsd, error: (answer && answer.error) || null,
    })
    return answer
  }

  const cloneAt = (name, sha) => {
    const dest = path.join(runDir, name)
    fs.rmSync(dest, { recursive: true, force: true })
    const clone = cloneAtBase({ repo: target, dest, base: sha, git })
    // The test command runs in this clone, and `capture` is an `add -A`: without
    // this the interpreter's own bytecode cache would ride the patch into the
    // adopted tree. The clone's private exclude file, never the project's.
    try {
      fs.appendFileSync(path.join(clone, '.git', 'info', 'exclude'),
        '\n__pycache__/\n*.pyc\n.pytest_cache/\n')
    } catch { /* a clone shape without .git/info is still a clone */ }
    return clone
  }

  // Amendment (undeclared by M1-M6, needed only to reach them under M3):
  // `exclude` drops the task's own Proof/Test files back out of the index
  // before the diff is cut, so a candidate's patch — the one thing this file
  // measures, judges, AND folds a landing by — never carries the exam step's
  // own scratch write to a shared Test file (`examine`'s `examFiles`, copied
  // into every implementer clone so the test command runs the same way the
  // exam saw it). Under the old, one-task-at-a-time-per-file-set world this
  // never showed: nothing else ever wrote to a Test file, so `git add -A`
  // staged the same nothing every time. M3 makes two siblings with no
  // predecessor of each other, and the SAME shared Test file, land at once —
  // and an uncaptured scratch write to that file would otherwise fold as a
  // real (and unresolvable, here — see the hand-in note) conflict between
  // them, despite neither task ever declaring the file as its own.
  const capture = (clone, anchor, out, exclude = []) => {
    git(['add', '-A'], clone)
    if (exclude.length) git(['reset', '-q', '--', ...exclude], clone)
    git(['diff', '--cached', '--binary', '--full-index', '--no-renames', '--output=' + out, anchor], clone)
    return out
  }

  const kernel = (argv) => {
    const r = sh('python3', [KERNEL, ...argv], REPO)
    const answer = lastJson(outOf(r))
    if (!answer) log('kernel ' + argv[0] + ': exit ' + exitOf(r) + ' ' + String((r && r.stderr) || '').slice(-300))
    return answer
  }

  const implFilesOf = (task) => (task.files || []).filter((f) => !(task.proofTests || []).includes(f))

  const interfacesBlock = (task) => {
    const io = task.interfaces || {}
    const list = (xs) => (Array.isArray(xs) && xs.length ? xs.join('; ') : 'nothing')
    return 'Consumes: ' + list(io.consumes) + '\nProduces: ' + list(io.produces)
  }

  /** M3: one `SETTLED:` line per predecessor whose `board.settled` answers
   *  one — read fresh on every prompt, exactly like `withHandoff`'s facts, so
   *  a predecessor that settles mid-run is seen by a dispatch that follows. */
  const settledLines = async (task) => {
    const lines = []
    for (const predId of allPreds(task)) {
      const s = typeof board.settled === 'function' ? await board.settled(predId) : null
      if (!s || !s.symbol) continue
      lines.push('SETTLED: ' + s.symbol + ' in ' + s.file + ' (task ' + (s.task ?? predId) + ', ' + s.sha + ')')
    }
    return lines
  }
  const settledSuffix = async (task) => {
    const lines = await settledLines(task)
    return lines.length ? '\n' + lines.join('\n') : ''
  }

  // Prompts carry the task, its files and its test command — and never a
  // command for a model to run against the repository's history.
  // M1: `coveredBlock` is `\n\nCOVERED:\n` plus one `M<n>: <path>` line per
  // covered clause, right after `TEST COMMAND:` — or the empty string, when
  // selection is off or nothing is covered.
  const examPrompt = async (task, coveredBlock = '') =>
    'TASK:\n' + task.body +
    '\n\nEXAM FILES: ' + (task.proofTests || []).join(', ') +
    '\nTEST COMMAND: ' + task.testCmd + coveredBlock +
    '\n\nINTERFACES:\n' + interfacesBlock(task) + await settledSuffix(task)

  const implPrompt = async (task) =>
    'TASK:\n' + task.body +
    '\n\nFILES: ' + implFilesOf(task).join(', ') +
    '\nTEST COMMAND: ' + task.testCmd +
    '\n\nINTERFACES:\n' + interfacesBlock(task) + await settledSuffix(task) +
    '\n\nAMENDMENTS: (none — this is the first dispatch of this task)'

  /** M3: every prompt this file assembles ends with the board's own memory of
   *  the task, read fresh at dispatch time so a later dispatch for the same
   *  task sees what an earlier one just posted. Empty facts add no suffix at
   *  all — a worker with nothing handed to it reads a prompt with no
   *  HAND-OFF block, rather than one promising a block with nothing in it. */
  const withHandoff = async (basePrompt, taskId) => {
    const facts = await board.factsFor(taskId)
    return facts ? basePrompt + '\n\nHAND-OFF:\n' + facts : basePrompt
  }

  /** M2's landing post: the exam's exit code, the last 1,500 characters of
   *  its own output (already `measure`'s `examTail`), the judge's claim
   *  reading, and the lowest-covered clause — its own text, off the task,
   *  and the score the judge gave it. Posted after every measurement of the
   *  candidate the task is riding: the initial one, and again after any
   *  redispatch (M4) or blocking-finding fix remeasures it. */
  const postLanding = async (task, best) => {
    const coverage = Array.isArray(best.coverage) ? best.coverage : []
    let low = 0
    for (let i = 1; i < coverage.length; i += 1) {
      if ((Number(coverage[i]) || 0) < (Number(coverage[low]) || 0)) low = i
    }
    const clauseText = (task.clauses && task.clauses[low]) || '(no clause text)'
    const clauseScore = coverage.length ? coverage[low] : null
    const text = 'exit ' + best.examExit + '\n' + (best.examTail || '') +
      '\nclaim: ' + (best.claim === null || best.claim === undefined ? 'null' : best.claim) +
      '\nlowest-covered clause (' + clauseScore + '): ' + clauseText
    await board.post(task.id, 'landing', text)
  }

  /**
   * One candidate, measured: its own exam run, its patch against the anchor,
   * and the judge's reading of that patch against the task's clauses.
   */
  const measure = async ({ task, dir, index, anchor }) => {
    const [cmd, ...argv] = String(task.testCmd || '').trim().split(/\s+/)
    const examRun = cmd ? sh(cmd, argv, dir) : { status: 0 }
    const examExit = exitOf(examRun)
    const patch = capture(dir, anchor, path.join(runDir, `patch-${task.id}-${index}.diff`), task.proofTests || [])
    const text = fs.existsSync(patch) ? fs.readFileSync(patch, 'utf8') : ''
    const perFile = splitDiff(text)
    const names = Object.keys(perFile)
    // `task` and `cwd` ride the reading so a caller can tell one candidate of a
    // raced task from the other; `makeJudge` builds Jev's state from `clauses`,
    // `patch` and `files` alone, so neither reaches the model.
    const literals = literalsOf(task.clauses)
    const reading = await read('readLanding', {
      task: task.id,
      cwd: dir,
      clauses: task.clauses,
      patch: hunksCarrying(text, literals, 20000),
      files: Object.fromEntries(names.map((n, j) => ['f' + j, hunksCarrying(perFile[n], literals, 6000)])),
    })
    return {
      dir,
      index,
      patch,
      examExit,
      examTail: String((examRun && examRun.stdout) || '').slice(-1500),
      claim: reading && typeof reading.claim === 'number' ? reading.claim : null,
      coverage: (reading && Array.isArray(reading.coverage)) ? reading.coverage : [],
    }
  }

  /** M2's line, and nothing else: exam green first, then the claim reading,
   *  then the mean of the per-clause coverage. Rounded only far enough to keep
   *  binary floating point from turning `10 + 0.2 + 0.5` into a long tail. */
  const scoreOf = (c) => {
    const mean = c.coverage.length
      ? c.coverage.reduce((s, v) => s + (Number(v) || 0), 0) / c.coverage.length
      : 0
    return Math.round((10 * (c.examExit === 0 ? 1 : 0) + (c.claim ?? 0) + mean) * 1e10) / 1e10
  }

  /** The hunks of one path out of a patch, for a finding the judge grades. */
  const hunksFor = (patchText, where) => {
    const perFile = splitDiff(patchText)
    const hit = Object.keys(perFile).find((p) => where && String(where).includes(p))
    return (hit ? perFile[hit] : String(patchText)).slice(0, 8000)
  }

  /** Whatever the referee actually answered, read generously: the SDK's
   *  structured output, or a JSON reply it printed instead. */
  const findingsOf = (answer) => {
    const candidates = []
    const structured = answer && answer.result && answer.result.structured_output
    candidates.push(structured)
    const raw = answer && answer.result && answer.result.result
    if (typeof raw === 'string' && raw.trim().startsWith('{')) {
      try { candidates.push(JSON.parse(raw)) } catch { /* not JSON */ }
    }
    for (const c of candidates) {
      if (Array.isArray(c)) return c
      if (c && Array.isArray(c.findings)) return c.findings
      if (c && Array.isArray(c.issues)) return c.issues
    }
    return []
  }

  /**
   * The front of `land`, split off so it can run on its own schedule (M3):
   * the exam, written at `anchor` by the implementer's peer, and the covering
   * list its `TASK:` prompt was seeded with. `anchor` is the run's own base
   * when `speculate.exam_at_zero` is on (every task's exam, dispatched at
   * minute zero, all in clones of the same still-unmoved commit) and the head
   * as of this task's own readiness otherwise (M6: unchanged from before this
   * task, folded together with `land`'s own dispatch).
   */
  const examine = async (task, anchor) => {
    const examDir = cloneAt('exam-' + task.id, anchor)
    let mcpServers = null
    if (tools) {
      try {
        const server = await tools({ task: { id: task.id, uid: uidFor(task.id), files: task.files }, candidates: [], board })
        if (server) mcpServers = { factory: server }
      } catch (e) { log('tools: ' + String((e && e.message) || e).slice(0, 200)) }
    }

    // M1: a task that names no exam file (`proofTests` empty) gets no
    // examiner at all — no covering reading, no dispatch, no exam-note — just
    // a record of why, and the same shape `examine` resolves for any task.
    if (!(task.proofTests || []).length) {
      // Bypasses `appendEvent` (which stamps every row with `ts`) so this
      // row is exactly `{ kind, task, reason }` — the shape the exam checks
      // with a literal `deepEqual`. AMENDMENT: `examine` is the only place
      // touched; no other event kind is affected.
      fs.appendFileSync(eventsPath, JSON.stringify({ kind: 'exam:skipped', task: task.id, reason: 'no exam file' }) + '\n')
      return { examDir, mcpServers, taskCovering: [], examFiles: [] }
    }

    // M1: before the exam is dispatched, tell it which of its own clauses an
    // existing test already proves. `taskCovering` (one path or `null` per
    // clause) rides on into M2, seeding the run set's own covering tests.
    let taskCovering = []
    let coveredBlock = ''
    if (selectPolicy.enabled === true) {
      const trackedInExam = git(['ls-files'], examDir).split('\n').map((s) => s.trim()).filter(Boolean)
      const readExamFile = (p) => {
        try { return fs.readFileSync(path.join(examDir, p), 'utf8') } catch { return '' }
      }
      const foundCovering = await candidateTests({
        files: trackedInExam, read: readExamFile,
        paths: implFilesOf(task), symbols: symbolsOf(task.clauses),
        exclude: task.proofTests || [], cap: selectPolicy.max_candidates,
      })
      if (foundCovering.length) {
        const coveringTests = foundCovering.map((c) => ({ path: c.path, text: readExamFile(c.path).slice(0, 6000) }))
        const covering = await read('readCovering', { clauses: task.clauses, tests: coveringTests })
        if (covering) {
          taskCovering = Array.isArray(covering.covered) ? covering.covered : []
          appendEvent({
            kind: 'select:exam', task: task.id,
            candidates: foundCovering.map((c) => c.path), covered: taskCovering,
          })
          const lines = taskCovering
            .map((p, i) => (p ? 'M' + (i + 1) + ': ' + p : null))
            .filter(Boolean)
          if (lines.length) coveredBlock = '\n\nCOVERED:\n' + lines.join('\n')
        }
      }
    }

    const examAnswer = await dispatch({
      role: 'exam', label: 'exam:' + task.id, taskId: task.id, cwd: examDir, model,
      systemPrompt: EXAM_MD, files: task.proofTests, mcpServers,
      prompt: await withHandoff(await examPrompt(task, coveredBlock), task.id),
    })
    await board.post(task.id, 'exam-note',
      (examAnswer && examAnswer.result && examAnswer.result.result) || '')
    const examFiles = (task.proofTests || []).map((p) => {
      const at = path.join(examDir, p)
      return [p, fs.existsSync(at) ? fs.readFileSync(at, 'utf8') : '']
    })

    return { examDir, mcpServers, taskCovering, examFiles }
  }

  /**
   * One task, from its exam's resolution to the patch that is ready to fold.
   *
   * Everything past the exam happens at `anchor` — the head this task's own
   * predecessors were adopted as of (M3) — and the patch is captured against
   * it, so the kernel merges the candidate three ways onto whatever head the
   * earlier landings of this wave have moved to.
   */
  // M4: when `task`'s best candidate is first measured, every pair naming it
  // as `producer` — read once each, never again for the same pair — whose
  // `consumer` has already been dispatched (its own exam, if nothing else)
  // gets `readPairCandidate` asked about it. `changes: true` posts to the
  // consumer by name; the row goes down either way.
  const maybeReadPairCandidate = async (task, best) => {
    if (!pairsLive) return
    for (const pair of pairsList) {
      if (pair.producer !== task.id) continue
      const key = pair.a + '>' + pair.b
      if (pairCandidateDone.has(key)) continue
      if (!dispatchedTasks.has(pair.consumer)) continue
      pairCandidateDone.add(key)
      const patchText = best.patch && fs.existsSync(best.patch) ? fs.readFileSync(best.patch, 'utf8') : ''
      const hunks = hunksCarrying(patchText, [pair.symbol], 8000)
      const answer = await read('readPairCandidate', { hunks, state: pairStates.get(key) })
      const changes = Boolean(answer && answer.changes)
      const score = answer && typeof answer.score === 'number' ? answer.score : null
      appendEvent({ kind: 'pair:candidate', a: pair.a, b: pair.b, changes, score })
      if (changes) {
        await board.post(pair.consumer, 'pair',
          "task " + pair.producer + "'s landing candidate touches " + pair.symbol +
          ' — worth a look before you land task ' + pair.consumer + '.')
      }
    }
  }

  const land = async (task, anchor) => {
    const t0 = Date.now()
    const reading = (await read('readTask', { id: task.id, title: task.title, body: task.body })) || {}
    const k = Number.isInteger(reading.k) && reading.k > 0 ? reading.k : 1
    const wantsReferee = reading.referee === true

    // M3: the exam this task's implementers build on — the one already
    // running at minute zero when the policy speculates, or dispatched only
    // now, at this task's own anchor, when it does not (M6).
    const examResult = await (examAtZero ? examPromises.get(task.id) : examine(task, anchor))
    const { mcpServers, taskCovering, examFiles } = examResult

    // 2. k implementers, concurrently, each with the exam handed in.
    const prompt = await implPrompt(task)
    const files = implFilesOf(task)
    const candidates = await Promise.all(Array.from({ length: k }, async (_, index) => {
      const dir = cloneAt(`impl-${task.id}-${index}`, anchor)
      for (const [p, content] of examFiles) {
        // A path the exam never actually wrote to (a sim's default worker
        // writes only its own note file, never the real proof path) carries
        // no content: writing it anyway would plant a phantom empty file in
        // every implementer's clone, and a worker that then dies with no
        // edit of its own would read as a non-empty patch — a candidate with
        // something to fold when it has nothing.
        if (!content) continue
        fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true })
        fs.writeFileSync(path.join(dir, p), content)
      }
      const answer = await dispatch({
        role: 'implement', label: 'impl:' + task.id + ':' + index, taskId: task.id, cwd: dir,
        model, systemPrompt: IMPL_MD, files, mcpServers,
        prompt: await withHandoff(prompt, task.id),
      })
      const measured = await measure({ task, dir, index, anchor })
      return { ...measured, error: (answer && answer.error) || null }
    }))

    // 3. select. The scores ride the row in candidate order, so the chosen one
    //    is readable against its rivals and not merely asserted.
    const scores = candidates.map(scoreOf)
    let best = candidates[0]
    for (const c of candidates) if (scoreOf(c) > scoreOf(best)) best = c
    if (k > 1) {
      appendEvent({ kind: 'select', task: task.id, scores, chosen: best.dir })
      for (const c of candidates) {
        if (c !== best) fs.rmSync(c.dir, { recursive: true, force: true })
      }
    }

    // This task's own: this task's best candidate, measured, for whichever
    // sibling's `waitsOn` has it in `candidate` rather than `adoption` — a
    // one-shot resolution, unmoved by any later re-dispatch or fix.
    candidateDeferred(task.id).resolve({ dir: best.dir, patch: best.patch })

    // M4: this task's best candidate, first measured — the moment a sibling
    // that consumes what it produces (already speculatively dispatched, its
    // own exam at minute zero) might want to know about it.
    await maybeReadPairCandidate(task, best)

    await postLanding(task, best)

    // A worker that ended with an error and left no patch has nothing to fold:
    // the task parks on the worker's own words, and the run goes on.
    const bytes = best.patch && fs.existsSync(best.patch) ? fs.statSync(best.patch).size : 0
    if (best.error && bytes === 0) {
      return { task, k, anchor, best, dead: 'worker ended without a patch: ' + best.error, wall_ms: Date.now() - t0 }
    }

    // M2/M3: the few existing tests the patch touches, run in the candidate's
    // clone; one clone of the anchor, made lazily and once for this task, is
    // where a red one is re-run to tell a catch from a pre-existing redness.
    const baseCloneCache = new Map()
    const baseCloneForTask = () => {
      if (!baseCloneCache.has('base')) baseCloneCache.set('base', cloneAt('base-' + task.id, anchor))
      return baseCloneCache.get('base')
    }
    const runSelection = async (candidate) => {
      if (selectPolicy.enabled !== true || typeof judge.readGuards !== 'function') return false
      const patchText = candidate.patch && fs.existsSync(candidate.patch) ? fs.readFileSync(candidate.patch, 'utf8') : ''
      const touched = Object.keys(splitDiff(patchText))
      const { names } = candidatesOf(task, patchText)
      const trackedInCandidate = git(['ls-files'], candidate.dir).split('\n').map((s) => s.trim()).filter(Boolean)
      const readCandidateFile = (p) => {
        try { return fs.readFileSync(path.join(candidate.dir, p), 'utf8') } catch { return '' }
      }
      const found = await candidateTests({
        files: trackedInCandidate, read: readCandidateFile,
        paths: touched, symbols: names,
        exclude: task.proofTests || [], cap: selectPolicy.max_candidates,
      })
      if (!found.length) return false
      const guardTests = found.map((c) => ({ path: c.path, text: readCandidateFile(c.path) }))
      const guards = await read('readGuards', {
        patch: hunksCarrying(patchText, names, 20000),
        tests: guardTests,
      })
      if (!guards) return false

      const runSet = []
      for (const p of taskCovering) {
        if (p && !runSet.includes(p)) runSet.push(p)
      }
      for (const p of (Array.isArray(guards.selected) ? guards.selected : [])) {
        if (!runSet.includes(p)) runSet.push(p)
      }
      const runSetCapped = runSet.slice(0, selectPolicy.max_run)

      const ran = []
      const reds = []
      for (const p of runSetCapped) {
        const argv = commandFor(p, selectPolicy.timeout_seconds)
        if (!argv) continue
        const r = sh(argv[0], argv.slice(1), candidate.dir)
        const exit = exitOf(r)
        ran.push({ path: p, exit })
        if (exit !== 0) reds.push({ path: p, exit, argv, out: outOf(r) })
      }
      appendEvent({
        kind: 'select:landing', task: task.id,
        candidates: found.map((c) => c.path), selected: guards.selected, ran,
      })

      let caught = false
      for (const red of reds) {
        const baseDir = baseCloneForTask()
        const r2 = sh(red.argv[0], red.argv.slice(1), baseDir)
        if (exitOf(r2) !== 0) {
          appendEvent({ kind: 'select:red-at-base', task: task.id, path: red.path })
          continue
        }
        appendEvent({ kind: 'catch', task: task.id, path: red.path, exit: red.exit })
        await board.post(task.id, 'catch',
          red.path + '\nexit ' + red.exit + '\n' + red.out.slice(-1500))
        caught = true
      }
      return caught
    }
    let caught = await runSelection(best)

    // 3.5. M4: a short landing — a red exam, a lowest-covered clause under
    //      the redispatch floor, or at least one catch — gets exactly one
    //      more implementer in the same clone, with the hand-off, and a
    //      fresh measurement (and a fresh run-set reading) is kept.
    const redispatchFloor = Number(redispatchPolicy.coverage_floor)
    const lowCoverage = best.coverage.length
      ? Math.min(...best.coverage.map((v) => Number(v) || 0))
      : null
    const short = best.examExit !== 0 ||
      (lowCoverage !== null && Number.isFinite(redispatchFloor) && lowCoverage < redispatchFloor) ||
      caught
    if (short && redispatchPolicy.enabled === true) {
      await board.post(task.id, 'redispatch',
        'exam exit ' + best.examExit + ', lowest coverage ' + lowCoverage)
      await dispatch({
        role: 'implement', label: 'impl:' + task.id + ':redispatch', taskId: task.id, cwd: best.dir,
        model, systemPrompt: IMPL_MD, files, mcpServers,
        prompt: await withHandoff(prompt, task.id),
      })
      const remeasured = await measure({ task, dir: best.dir, index: best.index, anchor })
      best = { ...remeasured }
      await postLanding(task, best)
      caught = await runSelection(best)
    }

    // 4. the discovery referee, exactly when the judge's task reading asks for
    //    one. Each finding is graded by the judge; a blocking grade buys the
    //    candidate one re-dispatch with the finding in hand, before the fold.
    if (wantsReferee) {
      const patchText = fs.existsSync(best.patch) ? fs.readFileSync(best.patch, 'utf8') : ''
      const answer = await dispatch({
        role: 'referee', label: 'referee:' + task.id, taskId: task.id, cwd: best.dir,
        model: refereeModel, systemPrompt: REFEREE_SYSTEM, files: [], readOnly: true,
        schema: FINDINGS_SCHEMA,
        prompt: await withHandoff(
          'TASK:\n' + task.body +
          '\n\nFILES: ' + (task.files || []).join(', ') +
          '\nTEST COMMAND: ' + task.testCmd + '\nexit ' + best.examExit +
          '\n' + best.examTail +
          '\n\nThe patch this task produced is on disk at ' + best.patch + ' — read it there.',
          task.id),
      })
      const findings = findingsOf(answer)
      const grades = []
      const blocking = []
      for (const finding of findings) {
        const grade = await read('gradeFinding', {
          task: { id: task.id, title: task.title, body: task.body, files: task.files },
          finding,
          hunks: hunksFor(patchText, finding && (finding.path || finding.detail)),
          siblingFacts: null,
        })
        grades.push(grade)
        if (grade === 'blocking') blocking.push(finding)
        await board.post(task.id, 'finding:' + grade,
          String((finding && (finding.detail || finding.title)) || finding))
      }
      appendEvent({
        kind: 'referee', task: task.id, findings: findings.length,
        blocking: blocking.length, grades,
      })
      if (blocking.length) {
        await dispatch({
          role: 'implement', label: 'fix:' + task.id, taskId: task.id, cwd: best.dir,
          model, systemPrompt: IMPL_MD, files, mcpServers,
          prompt: await withHandoff(prompt, task.id),
        })
        const remeasured = await measure({ task, dir: best.dir, index: best.index, anchor })
        best = { ...remeasured, examTail: remeasured.examTail }
        await postLanding(task, best)
      }
    }

    return { task, k, anchor, best, wall_ms: Date.now() - t0 }
  }

  /**
   * One landing, folded. The kernel answers `fold` with `complete`; a fold that
   * is not complete is a conflict, and one resolver pass is what it gets — a
   * second would be a loop, and the task is parked instead.
   */
  const foldIn = async (landing) => {
    waveNumber += 1
    const id = landing.task.id
    const common = ['--repo', target, '--run-dir', runDir, '--wave', String(waveNumber)]
    const patchArg = id + '=' + landing.best.patch + '@' + landing.anchor
    let usedResolve = false
    let fold = kernel(['fold', ...common, '--base', head, '--patch', patchArg])
    if (fold && fold.complete !== true) {
      usedResolve = true
      fold = await resolve({ fold, common, patchArg, landing })
    }
    if (!fold || fold.complete !== true) {
      const reason = 'fold did not complete: ' + JSON.stringify(fold || null).slice(0, 300)
      await board.post(id, 'conflict', reason)
      appendEvent({ kind: 'parked', task: id, reason })
      foldOutcomes.set(id, 'parked')
      return { sha: null, reason }
    }
    const mat = kernel(['materialize', ...common, '--prev-head', head, '--patch', patchArg,
      '--subject', 'task ' + id])
    if (!mat || typeof mat.candidateSha !== 'string') {
      const reason = 'materialize answered no candidate: ' + JSON.stringify(mat || null).slice(0, 300)
      appendEvent({ kind: 'parked', task: id, reason })
      foldOutcomes.set(id, 'parked')
      return { sha: null, reason }
    }
    git(['reset', '-q', '--hard', mat.candidateSha], target)
    head = mat.candidateSha
    // M5's `labelPair` reads this back as `folds`: `clean` when the kernel's
    // own three-way merge completed with no conflict, `resolved` when this
    // landing's own resolver round settled one.
    foldOutcomes.set(id, usedResolve ? 'resolved' : 'clean')
    return { sha: mat.candidateSha }
  }

  /** One pass of the resolver over whatever the fold left open. */
  const resolve = async ({ fold, common, patchArg, landing }) => {
    const open = Array.isArray(fold.open) ? fold.open : []
    if (!open.length) return fold
    let latest = fold
    for (const conflict of open) {
      // M2/M4: two sides that only added, read as independent, are united and
      // folded straight in — no resolver dispatched, no facts changed about
      // the resolver path below. Anything the union does not cleanly cover
      // (a `deleted` segment, a `false`/absent reading, or the mode itself
      // not `live`) falls straight through to the resolver, unchanged.
      if (unionPolicy.mode === 'live' && typeof readUnion === 'function') {
        let hunksFileText = null
        try { hunksFileText = fs.readFileSync(conflict.hunksFile, 'utf8') } catch { /* unreadable: no union */ }
        const union = hunksFileText !== null ? unionReply(hunksFileText) : null
        if (union) {
          const verdict = await readUnion({ hunks: union.hunks })
          if (verdict && verdict.union === true) {
            const replyDir = path.join(runDir, `reply-${landing.task.id}-${conflict.i}`)
            fs.mkdirSync(replyDir, { recursive: true })
            for (const h of union.hunks) {
              const safeId = String((h && h.id) || '').replace(/[^A-Za-z0-9]/g, '')
              if (!safeId) continue
              const content = String((h && h.content) || '')
              fs.writeFileSync(path.join(replyDir, safeId + '.txt'),
                content === '' ? '' : (content.endsWith('\n') ? content : content + '\n'))
            }
            fs.writeFileSync(path.join(replyDir, 'notes.txt'),
              'union: both sides only added, read as independent; kept in order, no resolver dispatched.\n')
            latest = kernel(['resolve', ...common, '--conflict', String(conflict.i),
              '--reply-dir', replyDir, '--patch', patchArg]) || latest
            appendEvent({ kind: 'union', task: landing.task.id, path: conflict.path, hunks: union.hunks.length })
            if (latest && latest.complete === true) return latest
            continue
          }
        }
      }
      const answer = await dispatch({
        role: 'resolve', label: 'resolve:' + landing.task.id + ':' + conflict.i,
        taskId: landing.task.id, cwd: path.dirname(String(conflict.hunksFile || runDir)),
        model, systemPrompt: RESOLVE_MD, files: [], readOnly: true, schema: RESOLVER_SCHEMA,
        prompt: await withHandoff(
          'HUNKS FILE: ' + conflict.hunksFile + ' (conflicted path: ' + conflict.path + ')' +
          '\n\nRead that file and resolve every block it carries.',
          landing.task.id),
      })
      const reply = (answer && answer.result && answer.result.structured_output) || null
      if (!reply || reply.status !== 'RESOLVED') return latest
      const replyDir = path.join(runDir, `reply-${landing.task.id}-${conflict.i}`)
      fs.mkdirSync(replyDir, { recursive: true })
      for (const h of reply.hunks || []) {
        const safeId = String((h && h.id) || '').replace(/[^A-Za-z0-9]/g, '')
        if (!safeId) continue
        const content = String((h && h.content) || '')
        fs.writeFileSync(path.join(replyDir, safeId + '.txt'),
          content === '' ? '' : (content.endsWith('\n') ? content : content + '\n'))
      }
      fs.writeFileSync(path.join(replyDir, 'notes.txt'), String(reply.notes || '') + '\n')
      latest = kernel(['resolve', ...common, '--conflict', String(conflict.i),
        '--reply-dir', replyDir, '--patch', patchArg]) || latest
      if (latest && latest.complete === true) return latest
    }
    return latest
  }

  /**
   * M2-M4: directly after a task's fold, the exams of every adopted task the
   * fold touched are run again on the folded tree — the folded task's own
   * exam included. A red one buys the folded task exactly one more
   * implementer attempt, in a clone of the same folded tree, whose patch is
   * folded through the same kernel path (`foldIn`) before the same exams run
   * a second time; still red (or a refold that never completes) is
   * unresolved, and unresolved forces the run's `done` to false without
   * unadopting anything.
   */
  const reverifyAfterFold = async (task, best) => {
    if (reverifyPolicy.enabled !== true) return
    const patchText = best.patch && fs.existsSync(best.patch) ? fs.readFileSync(best.patch, 'utf8') : ''
    const touched = Object.keys(splitDiff(patchText))
    if (!touched.length) return
    const cap = Number.isInteger(reverifyPolicy.max_run) ? reverifyPolicy.max_run : 6
    const timeoutSeconds = reverifyPolicy.timeout_seconds ?? 300

    const exams = examsTouched({ folded: task.id, touched, adopted, tasks, cap })
    if (!exams.length) return

    const runExams = () => {
      const dir = cloneAt('fold-verify-' + task.id, head)
      const ran = []
      const reds = []
      for (const exam of exams) {
        const [cmd, ...argv] = String(exam.testCmd).trim().split(/\s+/)
        const r = sh('timeout', [String(timeoutSeconds), cmd, ...argv], dir)
        const exit = exitOf(r)
        ran.push({ task: exam.id, exit })
        if (exit !== 0) reds.push({ exam, exit, out: outOf(r) })
      }
      return { ran, reds }
    }

    const first = runExams()
    appendEvent({ kind: 'fold:verify', task: task.id, ran: first.ran })
    if (!first.reds.length) return

    for (const red of first.reds) {
      appendEvent({ kind: 'fold:red', task: task.id, exam: red.exam.id, exit: red.exit })
      await board.post(task.id, 'fold-red',
        'exam ' + red.exam.id + ' exit ' + red.exit + '\n' + red.out.slice(-1500))
    }

    // One more attempt, in a fresh clone of the same folded tree, folded
    // through the same kernel path as any other landing.
    const anchor = head
    const fixDir = cloneAt('fold-fix-' + task.id, anchor)
    await dispatch({
      role: 'implement', label: 'impl:' + task.id + ':fold', taskId: task.id, cwd: fixDir,
      model, systemPrompt: IMPL_MD, files: implFilesOf(task), mcpServers: null,
      prompt: await withHandoff(await implPrompt(task), task.id),
    })
    const fixPatch = capture(fixDir, anchor, path.join(runDir, `patch-${task.id}-fold.diff`))
    const folded = await foldIn({ task, anchor, best: { patch: fixPatch } })
    if (folded.sha === null) {
      for (const red of first.reds) appendEvent({ kind: 'fold:unresolved', task: task.id, exam: red.exam.id })
      foldUnresolved = true
      return
    }

    const second = runExams()
    if (second.reds.length) {
      for (const red of second.reds) appendEvent({ kind: 'fold:unresolved', task: task.id, exam: red.exam.id })
      foldUnresolved = true
    }
  }

  /**
   * M2: does this adoption settle an interface for a sibling. The task's
   * newest `[note]` fact and its patch-derived candidates go to
   * `judge.readSettled`; a symbol back is `interface.settled` through the
   * Kata client (the one seam `board.mjs` does not expose — it only ever
   * writes `factory.state`) and a `settled` event row. No note, or no
   * candidates, asks Jev nothing at all.
   */
  const maybeSettleInterface = async (task, best, sha) => {
    if (typeof judge.readSettled !== 'function') return
    const note = newestNoteFact(await board.factsFor(task.id))
    if (!note) return
    const patchText = best.patch && fs.existsSync(best.patch) ? fs.readFileSync(best.patch, 'utf8') : ''
    const { names, fileOf } = candidatesOf(task, patchText)
    if (!names.length) return
    const settled = await read('readSettled', { note, candidates: names })
    if (!settled || !settled.symbol) return
    const file = fileOf.get(settled.symbol) || Object.keys(splitDiff(patchText))[0] || ''
    const meta = { symbol: settled.symbol, file, task: task.id, sha }
    const uid = uidFor(task.id)
    if (kata && uid !== undefined) {
      try {
        await kata.patchMetadata(args.kataProject, uid, { 'interface.settled': meta })
      } catch (e) { log('kata patchMetadata: ' + String((e && e.message) || e).slice(0, 200)) }
    }
    appendEvent({ kind: 'settled', task: task.id, symbol: settled.symbol, file })
  }

  /**
   * M4: files amendments are arithmetic, not judgment — a landing's patch
   * that reaches outside its own task's `files` and into a path another,
   * not-yet-started task owns edges that task onto the adopting one, so its
   * next readiness read waits rather than folding straight into a conflict.
   * A sibling already dispatched (or already adopted) is unaffected: it met
   * the path, or is past meeting it, on its own.
   */
  const fileAmendmentEdges = async (task, best) => {
    const patchText = best.patch && fs.existsSync(best.patch) ? fs.readFileSync(best.patch, 'utf8') : ''
    const touched = Object.keys(splitDiff(patchText))
    if (!touched.length) return
    const own = new Set(task.files || [])
    for (const filePath of touched) {
      if (own.has(filePath)) continue
      for (const other of tasks) {
        if (other.id === task.id) continue
        if (!(other.files || []).includes(filePath)) continue
        if (dispatchedTasks.has(other.id) || adopted.includes(other.id)) continue
        const preds = edgePreds.get(other.id)
        if (preds) preds.add(task.id)
        appendEvent({ kind: 'edge', from: task.id, to: other.id, why: 'files-amendment', path: filePath })
        await board.post(other.id, 'edge',
          'task ' + task.id + "'s landing touched " + filePath +
          ", which is also in this task's files — waiting on task " + task.id + ' first.')
      }
    }
  }

  // ── the loop: a pool, not a wave ─────────────────────────────────────────
  //
  // No epoch, no barrier: a task starts the moment what it waits on is
  // adopted, whether or not its siblings from an earlier ready set are still
  // in flight. `inflight` carries the running `land()` promises; whenever one
  // settles it is folded on the spot (folds stay one at a time, in settle
  // order — a park counts as a fold's outcome too), readiness is re-read
  // immediately, and whatever became ready — including a task whose only
  // predecessor just adopted — is dispatched before the next wait.
  const inflightLandings = new Map()

  const launch = (task) => {
    const anchor = head
    inflight.add(task.id)
    inflightLandings.set(task.id, land(task, anchor).then((landing) => ({ id: task.id, landing })))
  }

  // This task's own: a task whose sole `candidate` id has not yet adopted
  // starts as soon as that producer's best candidate is measured, building
  // on it directly rather than on the run's moving head. The producer's
  // candidate tree is committed (the engine's own git) in the producer's own
  // clone and fetched into the target under `refs/factory/cand-<producer
  // id>`; this task's own clones are then made AT that commit (`land`'s
  // `anchor` parameter already puts every clone and the patch capture
  // there), so its fold is asked with that commit as the patch's anchor and
  // the kernel merges it three ways onto whatever the target's head has
  // become by the time this task's own landing folds.
  const launchOnCandidate = (task, producerId) => {
    inflight.add(task.id)
    inflightLandings.set(task.id, candidateCommitFor(producerId).then(async (anchor) => {
      appendEvent({ kind: 'dispatch:on-candidate', task: task.id, from: producerId, anchor })
      const landing = await land(task, anchor)
      return { id: task.id, landing }
    }))
  }

  /** One fixed-point pass: a task whose predecessors are all adopted starts
   *  now; a task with a parked predecessor parks now, by that predecessor's
   *  name — and either can unlock a further task in the same pass.
   *
   *  This task's own: with exactly one id in `candidate`, that id need only
   *  be measured (or already done) for the task to start — `launchOnCandidate`
   *  when it is still in flight, a plain `launch` (the run's own head already
   *  carries it) once it is done. With two or more, M4 says the switch is off
   *  for this task: both lists are folded into one adoption wait, as if
   *  `on_candidate` were false here. */
  const settleReadiness = async () => {
    let changed = true
    while (changed) {
      changed = false
      for (const t of tasks) {
        if (done.has(t.id) || inflight.has(t.id)) continue
        const { adoption, candidate } = waitsOn(t)
        const fallback = candidate.length >= 2
        const effectiveAdoption = fallback ? [...adoption, ...candidate] : adoption
        const effectiveCandidate = fallback ? [] : candidate
        const badPred = effectiveAdoption.find((d) => parked.has(d)) ??
          effectiveCandidate.find((d) => parked.has(d))
        if (badPred !== undefined) {
          const reason = 'predecessor ' + badPred + ' parked'
          appendEvent({ kind: 'parked', task: t.id, reason })
          await board.post(t.id, 'park', reason)
          await board.setState(t.id, 'parked')
          parked.add(t.id)
          done.add(t.id)
          changed = true
          continue
        }
        if (!effectiveAdoption.every((d) => done.has(d))) continue
        if (effectiveCandidate.length === 0) {
          launch(t)
          changed = true
          continue
        }
        const producerId = effectiveCandidate[0]
        if (done.has(producerId)) launch(t)
        else launchOnCandidate(t, producerId)
        changed = true
      }
    }
  }

  // M2/M3: pairs live — resolve the sibling module (an injected fake, or the
  // real one), speculatively dispatch every exam at minute zero if the policy
  // says so, and read every pair the parser printed before readiness is ever
  // asked, so the chain orderings it settles are in place for the very first
  // pass.
  let pairsMod = null
  if (pairsLive) {
    pairsMod = deps.pairs || (await import('./pairs.mjs'))
  }
  if (examAtZero) {
    for (const t of tasks) examPromises.set(t.id, examine(t, runBase))
  }
  if (pairsLive && pairsMod) {
    // A cycle guard shaped exactly like `plan_parse.py`'s own: an adjacency
    // seeded with the hard-predecessor graph already built above, so a chain
    // ordering that would close a cycle with either another chain ordering or
    // a hard predecessor is caught the same way.
    const chainAdj = new Map()
    const addAdj = (from, to) => {
      if (!chainAdj.has(from)) chainAdj.set(from, [])
      chainAdj.get(from).push(to)
    }
    for (const [taskId, preds] of edgePreds) {
      for (const p of preds) addAdj(p, taskId)
    }
    const reaches = (src, dst) => {
      const seen = new Set()
      const stack = [src]
      while (stack.length) {
        const n = stack.pop()
        if (n === dst) return true
        if (seen.has(n)) continue
        seen.add(n)
        for (const next of (chainAdj.get(n) || [])) stack.push(next)
      }
      return false
    }
    const wouldCycle = (from, to) => reaches(to, from)

    for (const pair of pairsList) {
      const state = await pairsMod.pairState({ pair, tasks, read })
      pairStates.set(pair.a + '>' + pair.b, state)
      const codeVerdict = typeof pairsMod.decideByCode === 'function' ? pairsMod.decideByCode(state) : null
      let verdict, by, score
      if (codeVerdict) {
        verdict = codeVerdict
        by = 'code'
        score = null
      } else {
        const answer = await read('readPair', state)
        // A `null` reading (the reader absent, or nothing came back) is the
        // verdict `look`: a pair worth a human's eye, never an ordering.
        verdict = (answer && answer.verdict) || 'look'
        by = 'jev'
        score = (answer && typeof answer.score === 'number') ? answer.score : null
      }
      appendEvent({ kind: 'pair', a: pair.a, b: pair.b, why: pair.why, verdict, by, score })
      if (verdict !== 'chain') continue
      const hasProducer = pair.producer !== undefined && pair.consumer !== undefined
      const from = hasProducer ? pair.producer : pair.a
      const to = hasProducer ? pair.consumer : pair.b
      if (wouldCycle(from, to)) {
        appendEvent({ kind: 'pair:cycle', a: pair.a, b: pair.b })
        continue
      }
      addAdj(from, to)
      if (chainPreds.has(to)) chainPreds.get(to).add(from)
    }
  }

  await settleReadiness()
  while (inflightLandings.size > 0) {
    const { id, landing } = await Promise.race([...inflightLandings.values()])
    inflight.delete(id)
    inflightLandings.delete(id)
    done.add(id)
    if (landing.dead) {
      appendEvent({ kind: 'parked', task: id, reason: landing.dead })
      await board.post(id, 'park', landing.dead)
      await board.setState(id, 'parked')
      parked.add(id)
    } else {
      const folded = await foldIn(landing)
      if (folded.sha === null) {
        await board.post(id, 'park', folded.reason)
        await board.setState(id, 'parked')
        parked.add(id)
      } else {
        const candidateSha = folded.sha
        adopted.push(id)
        appendEvent({
          kind: 'landing',
          task: id,
          k: landing.k,
          examExit: landing.best.examExit,
          claim: landing.best.claim,
          coverage: landing.best.coverage,
          candidateSha,
          wall_ms: landing.wall_ms,
        })
        await board.setState(id, 'adopted')
        log('adopted task ' + id + ' -> ' + candidateSha.slice(0, 8) +
          '  exam=' + landing.best.examExit + ' k=' + landing.k)
        await maybeSettleInterface(landing.task, landing.best, candidateSha)
        await fileAmendmentEdges(landing.task, landing.best)
        await reverifyAfterFold(landing.task, landing.best)
      }
    }
    await settleReadiness()
  }

  if (done.size < tasks.length) {
    for (const t of tasks) {
      if (done.has(t.id)) continue
      const reason = 'no ready set: ' + allPreds(t).join(', ') + ' never adopted'
      appendEvent({ kind: 'parked', task: t.id, reason })
      await board.post(t.id, 'park', reason)
      await board.setState(t.id, 'parked')
      parked.add(t.id)
      done.add(t.id)
    }
  }

  // M5: one label per pair, once the run has settled every task one way or
  // another, so `labelPair` sees every fold outcome it might want.
  if (pairsLive && pairsMod && pairsList.length) {
    const folds = Object.fromEntries(foldOutcomes)
    for (const pair of pairsList) {
      const label = await pairsMod.labelPair({ pair, tasks, read, folds })
      appendEvent({
        kind: 'pair:label',
        a: pair.a,
        b: pair.b,
        calls: label && label.calls,
        fold: label && label.fold,
      })
    }
  }

  await Promise.allSettled(supervisorTicks)

  return {
    done: adopted.length === tasks.length && !foldUnresolved,
    adopted,
    head,
    wall_ms: Date.now() - startedAt,
    cost_usd: cost,
  }
}

// ── the CLI's own deps ───────────────────────────────────────────────────────

/**
 * The four seams the CLI runs on, constructed from the arguments.
 *
 * `overrides` is for a caller that wants one of them swapped without building
 * the other three — the exam's seam, and the only way the Jev wiring below can
 * be read without opening a socket.
 *
 * The Jev bearer: `fleet/jev-client.mjs` sends no authorization header of its
 * own, because on a fleet VM the edge injects it. Off the edge — a laptop, a
 * CI box — `TYPESAFE_API_KEY` is what stands in, and this `fetchImpl` is the
 * one place it is added. The variable is read at CALL time, never captured, so
 * an environment that changes mid-run is followed rather than remembered.
 */
export function buildDeps (rawArgs = {}, overrides = {}) {
  const args = normalizeArgs(rawArgs)
  const env = overrides.env || process.env
  const log = overrides.log || ((s) => process.stderr.write(String(s) + '\n'))

  const questionsPath = args.questions ? path.resolve(String(args.questions)) : QUESTIONS_PATH
  const policyPath = args.policy ? path.resolve(String(args.policy)) : POLICY_PATH

  const fetchImpl = (url, init = {}) => {
    const headers = { ...((init && init.headers) || {}) }
    const key = env.TYPESAFE_API_KEY
    if (key) headers.authorization = 'Bearer ' + key
    const underlying = overrides.fetch || globalThis.fetch
    return underlying(url, { ...init, headers })
  }

  const clientOf = overrides.makeJevClient || makeJevClient
  const client = clientOf({
    baseUrl: args.jevUrl || env.TYPESAFE_BASE_URL || '',
    fetchImpl,
    log,
  })
  const judgeOf = overrides.makeJudge || makeJudge
  const judge = judgeOf({ ask: (x) => client.ask(x), questionsPath, policyPath, log })
  // Readable after the fact: which two documents this judge was built on.
  try { Object.assign(judge, { questionsPath, policyPath }) } catch { /* frozen is fine */ }

  // `factory/tools.mjs` is imported only where it is used. It resolves the SDK
  // and zod out of `fleet/node_modules` at module evaluation, so a static
  // import here would make a run with no kata — the common one — depend on an
  // install it never needs.
  const tools = args.kataUrl
    ? async ({ task, candidates, board }) => {
      const { makeKataClient, httpTransport } = await import('../fleet/kata-client.mjs')
      const { factoryTools } = await import('./tools.mjs')
      const kata = overrides.kata || makeKataClient({
        transport: httpTransport({ url: String(args.kataUrl) }),
        actor: args.kataActor,
      })
      return factoryTools({ kata, projectId: args.kataProject, task, candidates, board })
    }
    : null

  return {
    worker: overrides.worker ||
      (async (opts) => runWorker(opts, { query: overrides.query || await sdkQuery() })),
    judge,
    // M3: the same function the judge was built on, exposed so `runEngine`
    // can build `readUnion` from it when no `deps.readUnion` is injected.
    ask: (x) => client.ask(x),
    sh: overrides.sh || defaultSh,
    git: overrides.git || defaultGit,
    tools,
    questionsPath,
    policyPath,
    fetchImpl,
    log,
  }
}

/** The entry. One line of JSON on stdout — the run's answer — and every other
 *  word of it on stderr, so a caller can read the last line and be done. */
export async function main (argv = process.argv.slice(2)) {
  const args = parseArgv(argv)
  for (const required of ['plan', 'target', 'runDir']) {
    if (!args[required]) {
      process.stderr.write('factory/engine.mjs --plan <plan.md> --target <repo> --base <sha> --run-dir <dir>\n')
      return 2
    }
  }
  const answer = await runEngine(args, buildDeps(args))
  process.stdout.write(JSON.stringify(answer) + '\n')
  return answer.done ? 0 : 1
}

const invokedDirectly = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (invokedDirectly) {
  process.exitCode = await main()
}

export default { runEngine, buildDeps, main, parseArgv, normalizeArgs, bodyOf, clausesOf, splitDiff }

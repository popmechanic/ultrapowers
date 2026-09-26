#!/usr/bin/env node
/**
 * factory/engine.mjs — the run as search, folding on every landing.
 *
 *   node factory/engine.mjs --plan <plan.md> --target <repo> --base <sha> --run-dir <dir>
 *
 * The worker is `factory/worker.mjs`, every judgment is `factory/judge.mjs` over
 * `factory/questions.json` and `factory/policy.json`, the worker's in-process
 * record tools are `factory/tools.mjs`, the fold is the kernel's own
 * `fold_wave.py`, and `k` — and whether a referee is hired — the judge reads off
 * the task.
 *
 * The shape of a run:
 *
 *   parse the plan  ->  for every ready task in the pool, in parallel:
 *     readTask             how many candidates, and does this one want a referee
 *     k implementers       each in its own clone at the current head
 *     measure              the task's own Proof `Run:` lines, then the tests the
 *                          engine selects against the patch, then readLanding
 *     select               10 x (factsExit 0) + claim + mean(coverage); best wins
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
import { fileURLToPath } from 'node:url'

import { makeJevClient } from './jev-client.mjs'
import { makeKataClient, httpTransport } from '../fleet/kata-client.mjs'
import { runWorker } from './worker.mjs'
import { makeJudge } from './judge.mjs'
import { hunksCarrying } from './hunks.mjs'
import { makeBoard, patchWithRevision } from './board.mjs'
import { commandFor } from './select.mjs'
import { waitsFor, hardEdgePreds, speculationFor, requeueDecision } from './dispatch.mjs'
import { runLines } from './proofs.mjs'
import { checksAtBase } from './checks-at-base.mjs'
import { observedWork, supervisorTick, makeObservedWatch } from './watch.mjs'
import { kFor, probeRecord } from './kprobe.mjs'
import { retrying, isRateLimited } from './retry.mjs'
import { baseReader } from './baseread.mjs'
import { makeKernel, makeCloner, makeFold } from './fold.mjs'
import { runRefold, makeRefoldDispatch, modelCells } from './refold.mjs'
import { makeMeasure, candidatesOf, splitDiff } from './measure.mjs'

export { candidatesOf, splitDiff } from './measure.mjs'
// ── where everything lives ───────────────────────────────────────────────────

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const COMPILER = path.join(REPO, 'skills/ultrapowers/scripts/plan_parse.py')

/** The judge's two documents, named absolutely. */
const QUESTIONS_PATH = path.join(HERE, 'questions.json')
const POLICY_PATH = path.join(HERE, 'policy.json')

const rolePath = (name) => path.join(HERE, 'roles', name + '.md')
const roleText = (name) => fs.readFileSync(rolePath(name), 'utf8')

/** Every producer runs on this; the discovery referee on the other. */
export const DEFAULT_MODEL = 'claude-opus-5-5'
const DEFAULT_REFEREE_MODEL = 'claude-opus-5-5'

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

// ── arguments ────────────────────────────────────────────────────────────────

const camel = (s) => String(s).replace(/-+([a-z0-9])/g, (_, c) => c.toUpperCase())

/** `--a b`, `--a=b` and bare `--flag`, in the one shape the rest of the file
 *  reads: camel-cased keys. */
function parseArgv (argv = []) {
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
 *  pytest import the package the implementer just wrote. A fifth argument,
 *  `env`, is a caller's own environment (a proof line's, or a fold check's
 *  `ULTRA_BASE`) merged OVER the default rather than replacing it. */
export const defaultSh = (cmd, argv = [], cwd, input, env) =>
  spawnSync(cmd, argv, {
    cwd, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: '.', ...(env || {}) },
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
export const lastJson = (text) => {
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

// ── the SDK, found where it is actually installed ────────────────────────────

/**
 * The agent SDK and its zod, imported once, lazily, and cached.
 *
 * Both are installed in `factory/node_modules` — `factory/boot.sh`'s
 * `engine_deps` installs against `factory/package.json` — so a bare specifier
 * from any file under `factory/` resolves on node's own walk. This is the one
 * place the engine resolves them: `buildDeps` hands `query` to `runWorker` and
 * `{ createSdkMcpServer, tool, z }` to `factoryTools` as its `sdk`.
 *
 * A failure to resolve is not thrown here: it answers `null`, and
 * `runWorker`'s own `no query()` message is the one the operator reads.
 */
let sdkPromise = null
export const loadSdk = () => {
  if (sdkPromise) return sdkPromise
  sdkPromise = (async () => {
    try {
      const mod = await import('@anthropic-ai/claude-agent-sdk')
      const zod = await import('zod')
      const z = zod.z || zod.default
      if (!z) return null
      return { query: mod.query, createSdkMcpServer: mod.createSdkMcpServer, tool: mod.tool, z }
    } catch { return null }
  })()
  return sdkPromise
}

// ── the plan, sliced the way the prototype sliced it ─────────────────────────

/** The verbatim body of one task, from `### Task <id>:` to the next heading. */
function bodyOf (planText, id) {
  const slice = String(planText).split(/^### Task /m).find((s) => s.startsWith(id + ':'))
  return slice ? slice.replace(/^[^:]*:\s*/, '').split(/\n### /)[0] : ''
}

/** The Machine clauses, by their own `M<n>.` numbering; a `;`-separated line
 *  that carries no numbering is split on the semicolons instead. */
function clausesOf (body) {
  const line = (String(body).match(/^Machine:\s*([\s\S]*?)\n\n/m) || [])[1] || ''
  const numbered = [...line.matchAll(/M(\d+)\.\s*([^]*?)(?=\s*M\d+\.|$)/g)].map((m) => m[2].trim())
  return numbered.length ? numbered : line.split(/;\s*/).map((s) => s.trim()).filter(Boolean)
}

/** The timeout every command a proof or bootstrap runs gets, wherever no
 *  more specific policy field applies (`policy.fold.reverify.timeout_seconds`
 *  and `policy.select.timeout_seconds` are the two that do). */
const DEFAULT_TIMEOUT_SECONDS = 300

/** The newest `[note]` fact out of `board.factsFor`'s rendering — the facts
 *  render oldest first, newest last, so the last `[note]` block wins. `null`
 *  when the rendering carries no `[note]` fact at all. */
function newestNoteFact (factsText) {
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
        kata: deps.kata,
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
  const RESOLVE_MD = roleText('resolve')

  // The compiler is the engine's own child_process, never `deps.sh`: `sh` is
  // the seam a sim fakes for the task's test command and the kernel, and the
  // plan has to compile for real before there is a task to fake anything about.
  // `deps.compiled` is the one seam around that: the parser's own answer,
  // handed in directly — for a caller (this task's own exam) whose checkout
  // parses a plan into no `proofRuns` or `checks` at all yet.
  let compiled = deps.compiled
  if (!compiled) {
    const compiledOut = spawnSync('python3', [COMPILER, String(args.plan)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    compiled = lastJson(compiledOut.stdout)
    if (!compiled || !Array.isArray(compiled.launch_waves)) {
      throw new Error('plan_parse.py did not answer a plan: ' + String(compiledOut.stderr || '').slice(0, 400))
    }
  }
  if (!compiled || !Array.isArray(compiled.launch_waves)) {
    throw new Error('deps.compiled did not answer a plan: no launch_waves array')
  }
  // M4: the plan's own bootstrap command, when the parser printed one —
  // `bootstrapFor`'s `planCmd`. `null` when it did not, so every clone's own
  // tracked files (a lockfile) decide instead.
  const bootstrapCmd = typeof compiled.bootstrapCmd === 'string' && compiled.bootstrapCmd !== ''
    ? compiled.bootstrapCmd
    : null

  const planText = fs.readFileSync(planPath, 'utf8')
  const waves = compiled.launch_waves.map((wave) => wave.map((t) => {
    const body = bodyOf(planText, t.id)
    return { ...t, body, clauses: clausesOf(body) }
  }))
  const tasks = waves.flat()
  // M4: a fold-verify probe or test still red after its one re-attempt
  // forces the run's resolved `done` to false, whatever else adopted cleanly.
  let foldUnresolved = false
  // #1211: every task's `readTask` reading, taken once before the first
  // dispatch, and the `k_probe` plan built off those readings — `land` reads
  // both by closure; a task the pass did not reach (there should be none)
  // falls back to `land`'s own lazy read.
  let taskReadings = new Map()
  let kPlan = { probe: null, k: {} }
  // M5: the policy the run reads is `args.policy` when given, else the
  // engine's own `POLICY_PATH` — the same fallback `buildDeps` already uses
  // for the judge's own copy. Read early: whether `pairs.mode` is `live`
  // shapes how hard predecessors are even built, below.
  const policyDoc = (() => {
    try {
      const policyFile = args.policy ? path.resolve(String(args.policy)) : POLICY_PATH
      return JSON.parse(fs.readFileSync(policyFile, 'utf8'))
    } catch { return {} }
  })()
  const supervisorMode = (policyDoc.supervisor || {}).mode
  const redispatchPolicy = (policyDoc.landing || {}).redispatch || {}
  const selectPolicy = policyDoc.select || {}
  // M2-M4: the plan's own proof commands — a task's own `Run:` lines, and the
  // plan's `Check:` lines on every folded tree — run only when this is true;
  // with it false, no `bash -lc` call for a proof line happens and no
  // `run:line`/`check:line` event is appended (M4).
  const proofsPolicy = policyDoc.proofs || {}
  const proofsEnabled = proofsPolicy.run_lines === true
  const proofTimeoutSeconds = Number.isFinite(Number(proofsPolicy.timeout_seconds))
    ? Number(proofsPolicy.timeout_seconds) : 300
  // M4: with `landing.facts.enabled`, `measure` hands Jev the facts the
  // task's own proof lines and selected tests already settled, instead of
  // asking it to guess a cited clause's coverage from the diff alone
  // (run-200).
  const factsPolicy = (policyDoc.landing || {}).facts || {}
  const factsEnabled = factsPolicy.enabled === true
  const factsCapBytes = Number.isFinite(Number(factsPolicy.cap_bytes))
    ? Number(factsPolicy.cap_bytes) : 4000
  // M8: `gate.jev_claim.mode` rides on every `gate:jev_claim` row this run
  // writes; `record-only` means neither `short` nor adoption ever reads it.
  const jevClaimMode = ((policyDoc.gate || {}).jev_claim || {}).mode ?? null
  const pairsPolicy = policyDoc.pairs || {}
  const pairsLive = pairsPolicy.mode === 'live'
  const pairsList = pairsLive && Array.isArray(compiled.pairs) ? compiled.pairs : []

  // What a task waits on: `depends_on` as the plan declares it, plus —
  // through `hardEdgePreds` (`factory/dispatch.mjs`) — with `pairs.mode`
  // `live`, only the parser's `write-after-create` edges, and `proof-run`
  // edges too when `pairs.proof_run_hard.enabled` is true (a probe that
  // imports a sibling's file can only run once that file lands, so that edge
  // is a fact, not a judgment `pairs` alone should carry); every other edge
  // the parser printed is instead a `pairs` entry M2 reads for itself, below.
  // With `pairs.mode` off, every edge the parser printed, as before this task
  // (M6). No launch-wave barrier — the spec's loop folds on every adoption
  // with no epoch, and a task's interface edge is already an edge.
  const proofRunHard = (pairsPolicy.proof_run_hard || {}).enabled === true
  // `pairs.interface_hard.enabled`: a consumed symbol absent at BASE is
  // chained by code (`decideByCode`), not left to the reader.
  const interfaceHard = (pairsPolicy.interface_hard || {}).enabled === true
  const edgePreds = new Map(tasks.map((t) => [t.id, new Set(t.depends_on || [])]))
  const hardEdges = hardEdgePreds({ dagEdges: compiled.dag_edges || [], pairsLive, proofRunHard })
  for (const [to, from] of hardEdges) {
    if (!edgePreds.has(to)) continue
    for (const id of from) edgePreds.get(to).add(id)
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
  // The run's own base, constant for the whole run — it never moves, even as
  // `head` does on every landing. `checksAtBase` runs the plan's own
  // `Check:` lines here, once, before any task's own work begins.
  const runBase = head
  let cost = 0
  let waveNumber = 0
  const adopted = []
  // M6: `{ [taskId]: [paths] }`, filled in on every landing — the tests
  // `measure` selected and ran for that task's own best candidate — so a
  // later fold's own re-verify (`proofsAdopted`, `runProofsAndChecks`) knows
  // which tests, beyond a task's own probes, belong on the folded tree.
  const selectedByTask = {}
  const parked = new Set()
  const done = new Set()
  const inflight = new Set()
  const supervisorTicks = []
  // M5: `supervisor.observed.enabled` off `policyDoc`, read once — whether
  // the second, facts-only supervisor reading fires at all.
  const observedEnabled = ((policyDoc.supervisor || {}).observed || {}).enabled === true
  const minElapsedMs = Number((((policyDoc.supervisor || {}).observed || {}).min_elapsed_ms || {}).value) || 0
  // M5: one `{ tools, proofRuns }` accumulator per dispatch, keyed by that
  // dispatch's own label — filled in by `onMessageFor`'s own `tool_use`
  // handling and by both places a `worker:test-run` row is appended (the
  // `run_proof` closure in `mcpServersFor`, and the Bash-named-a-proof-line
  // case inside `onMessageFor` itself) — so `observedWork` sees exactly that
  // dispatch's own history, never a sibling's.
  const dispatchObserved = new Map()
  const observedFor = (label) => {
    if (!dispatchObserved.has(label)) dispatchObserved.set(label, { tools: [], proofRuns: [] })
    return dispatchObserved.get(label)
  }
  // M2: one pairState reading per pair, keyed `a>b`, so M4's candidate check
  // can hand the same state back to `readPairCandidate` as "the consumer's
  // state" without asking `pairState` twice. M4 fires at most once per pair
  // (`pairCandidateDone`). M5's `labelPair` reads `foldOutcomes`, one entry
  // per adopted or parked task, filled in by `foldIn` below.
  const pairStates = new Map()
  const pairCandidateDone = new Set()
  const foldOutcomes = new Map()
  // M5: the order tasks folded in — earliest first — handed to `labelPair`
  // as `foldOrder` so a pair's label reads the later of its two folds.
  const foldOrder = []
  const reverifyPolicy = (policyDoc.fold || {}).reverify || {}
  const attributionPolicy = (policyDoc.fold || {}).attribution || {}

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
        if (!best) throw new Error('no candidate: task ' + producerId + ' landed without one')
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

  // M5: `readUnion` is `deps.readUnion` when a caller injects one; else the
  // judge's own `readUnion`, over `policy.resolve.union`'s own thresholds.
  const unionPolicy = (policyDoc.resolve || {}).union || {}
  const readUnion = typeof deps.readUnion === 'function' ? deps.readUnion
    : typeof judge.readUnion === 'function' ? judge.readUnion
      : null
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
   *    a Bash call whose command names one of the task's own proof `Run:`
   *    lines — paired to its `tool_use` by `tool_use_id`.
   *  - the supervisor tick: record-only, fired once per dispatch, and never
   *    awaited inside it — a tick that blocked the stream would be a
   *    supervisor that slowed the worker it watches.
   */
  const onMessageFor = (label, taskId) => {
    const task = tasks.find((t) => t.id === taskId)
    const proofRunsOf = (task && task.proofRuns) || []
    const matchesTest = (cmd) => {
      const s = String(cmd || '')
      return proofRunsOf.some((p) => p && s.includes(p))
    }
    const pendingBash = new Map()
    let turns = 0
    let fired = false
    let observedAsked = false
    const tail = []
    const wantsSupervisor = supervisorMode === 'record-only' && typeof judge.readSupervisor === 'function'
    const dispatchStartedAt = Date.now()
    const observed = observedFor(label)
    const watch = makeObservedWatch({ read, appendEvent, observedEnabled, minElapsedMs, label, task: taskId })
    const watchFacts = () => observedWork({
      tools: observed.tools, proofRuns: observed.proofRuns,
      taskFiles: (task && task.files) || [], startedAt: dispatchStartedAt, now: Date.now(),
    })
    return (message) => {
      if (!message) return
      const blocks = (message.message && message.message.content) || []
      if (message.type === 'result') {
        supervisorTicks.push(watch.end(watchFacts()))
        return
      }
      if (message.type === 'assistant') {
        for (const b of blocks) {
          if (!b) continue
          if (b.type === 'tool_use') {
            const input = b.input || {}
            const target = input.file_path ?? input.path ?? input.pattern ??
              (input.command !== undefined ? String(input.command).slice(0, 200) : undefined)
            appendEvent({ kind: 'worker:tool', task: taskId, label, tool: b.name, target })
            observed.tools.push({ at: Date.now(), tool: b.name, target })
            if (b.name === 'Bash') pendingBash.set(b.id, String((input && input.command) || ''))
          }
          if (b.type === 'text') tail.push(String(b.text))
        }
        turns += 1
        if (wantsSupervisor && !fired && turns >= SUPERVISOR_TICK_TURNS) {
          fired = true
          supervisorTicks.push(
            supervisorTick({
              read, appendEvent,
              label, task: taskId, transcript: tail.slice(-8).join('\n').slice(-4000),
            }))
        }
        if (!observedAsked && turns >= SUPERVISOR_TICK_TURNS) {
          supervisorTicks.push(
            watch.turn(watchFacts()).then((r) => { if (r === 'asked' || r === 'off') observedAsked = true }))
        }
        return
      }
      if (message.type === 'user') {
        for (const b of blocks) {
          if (!b || b.type !== 'tool_result') continue
          if (!pendingBash.has(b.tool_use_id)) continue
          const cmd = pendingBash.get(b.tool_use_id)
          if (!matchesTest(cmd)) continue
          // The stream only shows a Bash call that happened to name the test
          // command — never its real exit, which a `| tail` or `; echo
          // EXIT:$?` hides from `is_error` regardless of what the run did.
          // Say so rather than guess: this row's result is unknown.
          appendEvent({ kind: 'worker:test-run', task: taskId, label, cmd, exit: null, red: null, via: 'bash' })
          observed.proofRuns.push({ via: 'bash', exit: null })
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
  const dispatchOnce = async (opts) => {
    if (opts.taskId !== undefined && !dispatchedTasks.has(opts.taskId)) {
      dispatchedTasks.add(opts.taskId)
      await board.setState(opts.taskId, 'dispatched')
    }
    appendEvent({
      kind: 'dispatch:start', task: opts.taskId, label: opts.label, role: opts.role,
      ...(opts.retry_of ? { retry_of: opts.retry_of } : {}),
    })
    const startedAt = Date.now()
    let answer
    let turns = 0
    try {
      const inner = onMessageFor(opts.label, opts.taskId)
      answer = await worker({
      cwd: opts.cwd,
      prompt: opts.prompt,
      systemPrompt: opts.systemPrompt,
      model: opts.model,
      files: opts.files,
      schema: opts.schema ?? null,
      mcpServers: opts.mcpServers ?? null,
      onMessage: (m) => { if (m && m.type === 'assistant') turns += 1; return inner(m) },
      readOnly: Boolean(opts.readOnly),
      role: opts.role,
      label: opts.label,
      task: opts.taskId,
      onDenied: (row) => appendEvent(row),
    })
    } catch (e) {
      const error = String((e && e.message) || e).slice(0, 500)
      log('worker ' + opts.label + ' ended: ' + error)
      answer = { result: null, denials: [], error, turns }
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
      ...modelCells({ model: opts.model, result: answer && answer.result }),
      ...(opts.retry_of ? { retry_of: opts.retry_of } : {}),
    })
    return answer
  }
  const dispatch = retrying(dispatchOnce, { policy: policyDoc })

  // The test command runs in this clone, and `capture` is an `add -A`: without
  // the clone's own private exclude, the interpreter's own bytecode cache
  // would ride the patch into the adopted tree. `makeCloner` is shared with
  // `runRefold` (`./refold.mjs`), so both entries make a clone the same way.
  const cloneAt = makeCloner({ target, runDir, git, sh, bootstrapCmd, timeoutSeconds: DEFAULT_TIMEOUT_SECONDS, appendEvent })
  // `exclude` is kept as a parameter for a caller with its own reason to drop
  // paths back out of the index before the diff is cut; no call site in this
  // file passes one any more now that there is no separate exam step writing
  // a shared scratch file into every implementer's clone.
  const capture = (clone, anchor, out, exclude = []) => {
    git(['add', '-A'], clone)
    if (exclude.length) git(['reset', '-q', '--', ...exclude], clone)
    git(['diff', '--cached', '--binary', '--full-index', '--no-renames', '--output=' + out, anchor], clone)
    return out
  }

  // fold.single_task_fast off → the kernel's old four-pass fold (#1278).
  const kernel = makeKernel({ sh, log, policy: policyDoc })

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

  // Prompts carry the task, its files (unfiltered — M7) and its own Proof
  // `Run:` lines — and never a command for a model to run against the
  // repository's history.
  const proofBlock = (task) => {
    const lines = Array.isArray(task.proofRuns) ? task.proofRuns : []
    return lines.length ? '\n\nPROOF:\n' + lines.join('\n') : '\n\nPROOF: (none)'
  }
  const implPrompt = async (task) =>
    'TASK:\n' + task.body +
    '\n\nFILES: ' + (task.files || []).join(', ') +
    proofBlock(task) +
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

  const { measure, scoreOf, postLanding } = makeMeasure({
    proofsEnabled, proofTimeoutSeconds, selectPolicy, factsEnabled, factsCapBytes, jevClaimMode,
    judge, read, board, appendEvent, capture, cloneAt, runDir, sh, git, exitOf, outOf,
  })

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
   * The tool server ONE dispatch gets, built fresh for it rather than shared
   * with any other clone: `runProof` closes over THIS dispatch's own `cwd`
   * and `label`, so the row it appends (M7) names the clone that actually
   * ran the lines and the exit it actually saw, never a sibling's. A task
   * with no `proofRuns` gets a server with no working `runProof` —
   * `factoryTools` itself answers `run_proof unavailable` for that case
   * (M7) — and a run with no `tools` dep at all (no board) gets no server,
   * exactly as before this task.
   *
   * `candidates` is a function, not a list: `settled` (`factory/tools.mjs`)
   * calls it fresh on every offer, and it re-reads the clone's own working
   * tree each time — `capture` (the same `git add -A` / `diff --cached` the
   * landing itself uses, above) against this dispatch's own `anchor` — so a
   * worker that has just written a new export sees it on its very next call,
   * with no wait for the patch this dispatch eventually lands.
   */
  const mcpServersFor = async (taskId, cwd, label, anchor) => {
    if (!tools) return null
    const task = tasks.find((t) => t.id === taskId)
    // M7: run_proof runs the same set `measure` does — the task's own
    // `proofRuns`, in order, through `runLines` — so a second line's
    // non-zero exit is what this tool resolves too, not just the first
    // line's. It resolves an array, one `{ cmd, exit, tail }` per line;
    // the one `worker:test-run` row it appends carries the first non-zero
    // exit among them, or 0 when every line ran clean.
    const lines = Array.isArray(task && task.proofRuns) ? task.proofRuns : []
    const runProof = lines.length
      ? async () => {
        const results = await runLines({
          lines, cwd, sh, env: undefined, timeoutSeconds: proofTimeoutSeconds,
        })
        const firstRed = results.find((r) => r.exit !== 0)
        const exit = firstRed ? firstRed.exit : 0
        appendEvent({
          kind: 'worker:test-run', task: taskId, label, cmd: lines.join(' && '), exit,
          red: exit !== 0, via: 'run_proof',
        })
        observedFor(label).proofRuns.push({ via: 'run_proof', exit })
        return results
      }
      : undefined
    const candidatesFor = async () => {
      const out = path.join(runDir, 'patch-' + String(label).replace(/:/g, '-') + '-settled.diff')
      capture(cwd, anchor, out)
      return candidatesOf(task, fs.readFileSync(out, 'utf8')).names
    }
    try {
      const server = await tools({
        task: { id: taskId, uid: uidFor(taskId), files: task && task.files, proofRuns: lines },
        candidates: candidatesFor, board, runProof,
      })
      return server ? { factory: server } : null
    } catch (e) {
      log('tools: ' + String((e && e.message) || e).slice(0, 200))
      return null
    }
  }

  /**
   * One task, from its own dispatch to the patch that is ready to fold.
   *
   * Everything happens at `anchor` — the head this task's own predecessors
   * were adopted as of (M3) — and the patch is captured against it, so the
   * kernel merges the candidate three ways onto whatever head the earlier
   * landings of this wave have moved to. No exam worker runs first: a task
   * is measured by its own Proof `Run:` lines and the tests the engine
   * selects against the patch, never by a file an exam step wrote (M1).
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
      const answer = await read('readPairCandidate', { hunks, state: pairStates.get(key), who: { task: task.id, label: null } })
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
    const reading = taskReadings.get(task.id) ||
      (await read('readTask', { id: task.id, title: task.title, body: task.body, who: { task: task.id, label: null } })) || {}
    const k = kPlan.k[task.id] || 1
    const wantsReferee = reading.referee === true
    // M1: the deferred this task's consumers wait on resolves once, in the
    // `finally` below, off whichever candidate is last assigned here — never
    // off a tree a re-dispatch or referee-fix worker is still editing.
    let best = null

    // M4: everything past here makes at least one clone (an implementer
    // clone, or — inside `measure`'s own base-clone cache, below — the lazy
    // base clone), and any one of them can throw a `bootstrapRed`-carrying
    // error when that clone's own dependency install goes red. That is this
    // task's own park, not an exception that should escape `land()` and
    // crash the whole run: caught below, it answers the same `dead`-carrying
    // shape a worker that ended with no patch already does, for the exact
    // same caller (the main loop) to turn into a `parked` task the usual way.
    try {
    // M2/M3: the few existing tests a candidate's patch touches are run in
    // that candidate's own clone (inside `measure`); one clone of the
    // anchor, made lazily and shared across every candidate of this task, is
    // where a red one is re-run to tell a catch from a pre-existing redness.
    const baseCloneCache = new Map()
    const baseCloneForTask = () => {
      if (!baseCloneCache.has('base')) baseCloneCache.set('base', cloneAt('base-' + task.id, anchor))
      return baseCloneCache.get('base')
    }

    // 2. k implementers, concurrently — each in its own clone at `anchor`,
    //    each with its OWN tool server, so its `run_proof` closes over its
    //    own clone. No exam worker runs first (M1): `task.files` rides the
    //    prompt unfiltered (M7), and `measure` (below) is where a
    //    candidate's own Proof `Run:` lines and the tests the engine selects
    //    against its patch both run.
    const prompt = await implPrompt(task)
    const files = task.files || []
    const candidates = await Promise.all(Array.from({ length: k }, async (_, index) => {
      const dir = cloneAt(`impl-${task.id}-${index}`, anchor)
      const label = 'impl:' + task.id + ':' + index
      const mcpServers = await mcpServersFor(task.id, dir, label, anchor)
      const answer = await dispatch({
        role: 'implement', label, taskId: task.id, cwd: dir,
        model, systemPrompt: IMPL_MD, files, mcpServers,
        prompt: await withHandoff(prompt, task.id),
      })
      const measured = await measure({ task, dir, index, anchor, baseCloneForTask })
      return { ...measured, error: (answer && answer.error) || null }
    }))

    // 3. select. The scores ride the row in candidate order, so the chosen one
    //    is readable against its rivals and not merely asserted.
    const scores = candidates.map(scoreOf)
    let refereeDied = false
    best = candidates[0]
    for (const c of candidates) if (scoreOf(c) > scoreOf(best)) best = c
    if (k > 1) {
      appendEvent({ kind: 'select', task: task.id, scores, chosen: best.dir })
      for (const c of candidates) {
        if (c !== best) fs.rmSync(c.dir, { recursive: true, force: true })
      }
    }

    // M4: this task's best candidate, first measured — the moment a sibling
    // that consumes what it produces might want to know about it.
    await maybeReadPairCandidate(task, best)

    await postLanding(task, best)

    // A worker that ended with an error and left no patch has nothing to fold:
    // the task parks on the worker's own words, and the run goes on.
    const bytes = best.patch && fs.existsSync(best.patch) ? fs.statSync(best.patch).size : 0
    if (best.error && bytes === 0) {
      const dead = (isRateLimited(best.error) ? 'rate-limited: ' : 'worker ended without a patch: ') + best.error
      return { task, k, anchor, best, dead, wall_ms: Date.now() - t0 }
    }

    // 3.5. M3: a short landing — `factsExit` non-zero (a probe or a caught
    //      selected test), or the lowest-covered clause under the
    //      redispatch floor — gets exactly one more implementer in the same
    //      clone, with the hand-off, and a fresh measurement is kept. The
    //      floor never fires for a candidate whose facts are already clean
    //      and that ran at least one probe or one selected test — coverage
    //      alone never makes that landing short.
    const redispatchFloor = Number(redispatchPolicy.coverage_floor)
    const lowCoverage = best.coverage.length
      ? Math.min(...best.coverage.map((v) => Number(v) || 0))
      : null
    const ranProofOrTest = (Array.isArray(best.runLines) && best.runLines.length > 0) ||
      (Array.isArray(best.selected) && best.selected.length > 0)
    const factsClean = best.factsExit === 0 && ranProofOrTest
    const floorFired = !factsClean && lowCoverage !== null &&
      Number.isFinite(redispatchFloor) && lowCoverage < redispatchFloor
    const short = best.factsExit !== 0 || floorFired
    appendEvent({
      kind: 'floor', task: task.id, facts: best.factsExit, lowest: lowCoverage, fired: floorFired,
    })
    if (short && redispatchPolicy.enabled === true) {
      await board.post(task.id, 'redispatch',
        'facts exit ' + best.factsExit + ', lowest coverage ' + lowCoverage)
      const redispatchLabel = 'impl:' + task.id + ':redispatch'
      const redispatchServers = await mcpServersFor(task.id, best.dir, redispatchLabel, anchor)
      await dispatch({
        role: 'implement', label: redispatchLabel, taskId: task.id, cwd: best.dir,
        model, systemPrompt: IMPL_MD, files, mcpServers: redispatchServers,
        prompt: await withHandoff(prompt, task.id),
      })
      const remeasured = await measure({ task, dir: best.dir, index: best.index, anchor, baseCloneForTask })
      best = { ...remeasured }
      await postLanding(task, best)
    }

    // 4. the discovery referee, exactly when the judge's task reading asks for
    //    one. Each finding is graded by the judge; a blocking grade buys the
    //    candidate one re-dispatch with the finding in hand, before the fold.
    appendEvent({ kind: 'referee:trigger', task: task.id, trigger: wantsReferee ? 'rung' : 'none' })
    if (wantsReferee) {
      const patchText = fs.existsSync(best.patch) ? fs.readFileSync(best.patch, 'utf8') : ''
      const refereePrompt = 'TASK:\n' + task.body +
          '\n\nFILES: ' + (task.files || []).join(', ') +
          proofBlock(task) +
          '\nexit ' + best.factsExit +
          '\n\nThe patch this task produced is on disk at ' + best.patch + ' — read it there.'
      const answer = await dispatch({
        role: 'referee', label: 'referee:' + task.id, taskId: task.id, cwd: best.dir,
        model: refereeModel, systemPrompt: REFEREE_SYSTEM, files: [], readOnly: true,
        schema: FINDINGS_SCHEMA,
        prompt: await withHandoff(refereePrompt, task.id),
      })
      if (answer && answer.error) {
        refereeDied = true
        appendEvent({
          kind: 'referee', task: task.id, died: true, error: answer.error, trigger: 'rung',
        })
      } else {
        const findings = findingsOf(answer)
        const grades = []
        const blocking = []
        for (const finding of findings) {
          const grade = await read('gradeFinding', {
            task: { id: task.id, title: task.title, body: task.body, files: task.files },
            finding,
            hunks: hunksFor(patchText, finding && (finding.path || finding.detail)),
            siblingFacts: null,
            who: { task: task.id, label: 'referee:' + task.id },
          })
          grades.push(grade)
          if (grade === 'blocking') blocking.push(finding)
          await board.post(task.id, 'finding:' + grade,
            String((finding && (finding.detail || finding.title)) || finding))
        }
        appendEvent({
          kind: 'referee', task: task.id, findings: findings.length,
          blocking: blocking.length, grades, trigger: 'rung',
        })
        if (blocking.length) {
          const fixLabel = 'fix:' + task.id
          const fixServers = await mcpServersFor(task.id, best.dir, fixLabel, anchor)
          await dispatch({
            role: 'implement', label: fixLabel, taskId: task.id, cwd: best.dir,
            model, systemPrompt: IMPL_MD, files, mcpServers: fixServers,
            prompt: await withHandoff(prompt, task.id),
          })
          const remeasured = await measure({ task, dir: best.dir, index: best.index, anchor, baseCloneForTask })
          best = { ...remeasured }
          await postLanding(task, best)
        }
      }
    }

    return {
      task, k, anchor, best, record: probeRecord({ candidates, scores }), wall_ms: Date.now() - t0,
      ...(refereeDied ? { referee: 'died' } : {}),
    }
    } catch (err) {
      if (err && err.bootstrapRed) {
        const { clone, exit, tail } = err.bootstrapRed
        const reason = 'bootstrap failed in ' + clone + ': exit ' + exit + (tail ? '\n' + tail : '')
        return { task, k, anchor, dead: reason, wall_ms: Date.now() - t0 }
      }
      const text = err && typeof err.stack === 'string' ? err.stack : String((err && err.message) || err)
      return { task, k, anchor, dead: ('landing threw: ' + text).slice(0, 1500), wall_ms: Date.now() - t0 }
    } finally {
      // M1: this task's best candidate, measured, for whichever sibling's
      // `waitsOn` has it in `candidate` rather than `adoption` — resolved
      // once, off the final `best` a re-dispatch or referee-fix worker left
      // behind, never off a tree still being edited; `null` when no
      // candidate was ever selected (e.g. a bootstrap-red park), so a
      // consumer waiting on a dead producer parks instead of hanging.
      candidateDeferred(task.id).resolve(best ? { dir: best.dir, patch: best.patch } : null)
    }
  }

  // The fold seam lives in `./fold.mjs`: `foldIn` and `reverifyAfterFold`,
  // over this run's own head, wave counter and `foldUnresolved`.
  const { foldIn, reverifyAfterFold } = makeFold({
    target, runDir, git, sh, kernel, board, appendEvent, dispatch, model, IMPL_MD, RESOLVE_MD,
    unionPolicy, readUnion, withHandoff, implPrompt, capture, cloneAt, tasks, adopted,
    reverifyPolicy, attributionPolicy, foldOutcomes, foldOrder, selectedByTask,
    selectTimeoutSeconds: selectPolicy.timeout_seconds, proofsEnabled,
    checks: compiled.checks, runBase, proofTimeoutSeconds,
    state: {
      get head () { return head },
      set head (v) { head = v },
      get wave () { return waveNumber },
      set wave (v) { waveNumber = v },
      get foldUnresolved () { return foldUnresolved },
      set foldUnresolved (v) { foldUnresolved = v },
    },
  })

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
    const settled = await read('readSettled', { note, candidates: names, who: { task: task.id, label: 'impl:' + task.id + ':' + best.index } })
    if (!settled || !settled.symbol) return
    const file = fileOf.get(settled.symbol) || Object.keys(splitDiff(patchText))[0] || ''
    const meta = { symbol: settled.symbol, file, task: task.id, sha }
    const uid = uidFor(task.id)
    if (kata && uid !== undefined) {
      try {
        await patchWithRevision(kata, args.kataProject, uid, { 'interface.settled': meta })
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

  // Where each dispatched task's implementers were cloned from — the run
  // head at plain `launch` time, or the producer's candidate commit at
  // `launchOnCandidate` time. `settleReadiness` hands a would-be consumer's
  // producer's own anchor to `speculationFor` as `producerAnchor`, since
  // that is the tree the producer's candidate sits on, whether the producer
  // itself launched plainly or on a candidate.
  const anchorOf = new Map()

  const launch = (task) => {
    const anchor = head
    anchorOf.set(task.id, anchor)
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
      anchorOf.set(task.id, anchor)
      appendEvent({ kind: 'dispatch:on-candidate', task: task.id, from: producerId, anchor })
      const landing = await land(task, anchor)
      return { id: task.id, landing }
    }).catch((err) => ({
      id: task.id,
      landing: {
        task, k: 1, anchor: null,
        dead: ('no candidate from task ' + producerId + ': ' + String((err && err.message) || err)).slice(0, 1500),
        wall_ms: 0,
      },
    })))
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
  const waitedAt = new Set()

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
        const { mode, reason } = speculationFor({
          producerDone: done.has(producerId),
          head,
          producerAnchor: anchorOf.get(producerId)
        })
        if (mode === 'launch') {
          launch(t)
        } else if (mode === 'on-candidate') {
          launchOnCandidate(t, producerId)
        } else {
          const key = t.id + '@' + head
          if (!waitedAt.has(key)) {
            waitedAt.add(key)
            appendEvent({
              kind: 'speculate:wait',
              task: t.id,
              from: producerId,
              head,
              anchor: anchorOf.get(producerId) ?? null,
              reason
            })
          }
          continue
        }
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
  await checksAtBase({
    checks: compiled.checks,
    enabled: proofsEnabled && (proofsPolicy.checks_at_base || {}).enabled === true,
    clone: () => cloneAt('checks-at-base', runBase),
    base: runBase, sh, timeoutSeconds: proofTimeoutSeconds, runLines, appendEvent,
  })
  // #1211: every task's `readTask` reading, taken once before the first
  // implementer is dispatched, feeds `kFor` — the `dispatch.k_probe`
  // experiment's one-task, k=2 probe. A `null` reading (no reader, or one
  // that threw) stores as `{}`, same as `land`'s own fallback read.
  for (const t of tasks) {
    const reading = (await read('readTask', { id: t.id, title: t.title, body: t.body, who: { task: t.id, label: null } })) || {}
    taskReadings.set(t.id, reading)
  }
  const difficulties = Object.fromEntries(
    tasks.map((t) => [t.id, taskReadings.get(t.id).answers && taskReadings.get(t.id).answers.difficulty])
  )
  const judgedK = Object.fromEntries(tasks.map((t) => [t.id, taskReadings.get(t.id).k]))
  kPlan = kFor({ tasks, difficulties, judged: judgedK, policy: policyDoc })
  appendEvent({ kind: 'dispatch:k', probe: kPlan.probe, k: kPlan.k, difficulties })
  // The pair builder reads each shared file as it stood at the run's BASE;
  // a file absent there reads as ''.
  const readAtBase = baseReader({ git, target, base: runBase })
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
      const state = await pairsMod.pairState({ pair, tasks, read: readAtBase })
      pairStates.set(pair.a + '>' + pair.b, state)
      const codeVerdict = typeof pairsMod.decideByCode === 'function' ? pairsMod.decideByCode(state, { interfaceHard }) : null
      let verdict, by, score
      if (codeVerdict) {
        verdict = codeVerdict
        by = 'code'
        score = null
      } else {
        const answer = await read('readPair', { ...state, who: { task: null, label: null } })
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
  const requeueEnabled = ((policyDoc.landing || {}).requeue_missing_producer || {}).enabled === true
  const requeuedTasks = new Set()
  while (inflightLandings.size > 0) {
    const { id, landing } = await Promise.race([...inflightLandings.values()])
    inflight.delete(id)
    inflightLandings.delete(id)
    // #1292: a landing whose red facts name a sibling's not-yet-adopted file
    // waits for that sibling and runs again (once per task), instead of being
    // accepted broken.
    const waitsOnSibling = requeueDecision({
      landing, tasks, taskId: id, adopted, requeued: requeuedTasks, enabled: requeueEnabled,
      parked, predsOf: Object.fromEntries(tasks.map((t) => [t.id, allPreds(t)])),
    })
    if (waitsOnSibling !== null) {
      if (!edgePreds.has(id)) edgePreds.set(id, new Set())
      edgePreds.get(id).add(waitsOnSibling)
      requeuedTasks.add(id)
      appendEvent({ kind: 'requeue', task: id, waits_on: waitsOnSibling })
      log('requeued task ' + id + ' behind unadopted sibling ' + waitsOnSibling)
      await settleReadiness()
      continue
    }
    done.add(id)
    if (landing.dead) {
      appendEvent({ kind: 'parked', task: id, reason: landing.dead })
      await board.post(id, 'park', landing.dead)
      await board.setState(id, 'parked')
      parked.add(id)
    } else {
      const headBeforeFold = head
      const folded = await foldIn(landing)
      if (folded.sha === null) {
        await board.post(id, 'park', folded.reason)
        await board.setState(id, 'parked')
        parked.add(id)
      } else {
        const candidateSha = folded.sha
        adopted.push(id)
        selectedByTask[id] = Array.isArray(landing.best.selected)
          ? landing.best.selected.map((s) => s.path)
          : []
        appendEvent({
          kind: 'landing',
          task: id,
          k: landing.k,
          factsExit: landing.best.factsExit,
          claim: landing.best.claim,
          coverage: landing.best.coverage,
          candidateSha,
          candidates: landing.record.candidates,
          chosen: landing.record.chosen,
          margin: landing.record.margin,
          wall_ms: landing.wall_ms,
          ...(landing.referee ? { referee: landing.referee } : {}),
        })
        await board.setState(id, 'adopted')
        log('adopted task ' + id + ' -> ' + candidateSha.slice(0, 8) +
          '  facts=' + landing.best.factsExit + ' k=' + landing.k)
        await maybeSettleInterface(landing.task, landing.best, candidateSha)
        await fileAmendmentEdges(landing.task, landing.best)
        await reverifyAfterFold(landing.task, landing.best, headBeforeFold)
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
      const label = await pairsMod.labelPair({ pair, tasks, read: readAtBase, folds, foldOrder })
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

// ── the re-fold lives in ./refold.mjs; re-exported here for its callers ──

export { runRefold, makeRefoldDispatch }

// ── the CLI's own deps ───────────────────────────────────────────────────────

/**
 * The four seams the CLI runs on, constructed from the arguments.
 *
 * `overrides` is for a caller that wants one of them swapped without building
 * the other three — the worker's seam, and the only way the Jev wiring below
 * can be read without opening a socket.
 *
 * The Jev bearer: `factory/jev-client.mjs` sends no authorization header of its
 * own, because on a fleet VM the edge injects it. Off the edge — a laptop, a
 * CI box — `TYPESAFE_API_KEY` is what stands in, and this `fetchImpl` is the
 * one place it is added. The variable is read at CALL time, never captured, so
 * an environment that changes mid-run is followed rather than remembered.
 */
function buildDeps (rawArgs = {}, overrides = {}) {
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
  // M1/M2: a writer onto this run's own record. Never throws — a run
  // directory that does not exist (yet, or ever) just swallows the row
  // rather than take the judge down with it.
  const emit = (row) => {
    try {
      const eventsPath = path.join(path.resolve(String(args.runDir ?? '.')), 'events.jsonl')
      fs.appendFileSync(eventsPath, JSON.stringify({ ts: new Date().toISOString(), ...row }) + '\n')
    } catch { /* the record is best-effort from here; the judge call itself must not fail on it */ }
  }
  const judgeOf = overrides.makeJudge || makeJudge
  const judge = judgeOf({ ask: (x) => client.ask(x), emit, questionsPath, policyPath, log })
  // Readable after the fact: which two documents this judge was built on.
  try { Object.assign(judge, { questionsPath, policyPath }) } catch { /* frozen is fine */ }

  // The one Kata client `buildDeps` ever makes: `board`, `tools` and the
  // `kata` this answers all close over this same object (M2), so the
  // `interface.settled` write in `runEngine` reaches the same place the
  // worker's own `settled` tool does.
  const kata = overrides.kata || (args.kataUrl
    ? makeKataClient({ transport: httpTransport({ url: String(args.kataUrl) }), actor: args.kataActor })
    : null)

  // `factory/tools.mjs` is imported only where it is used, and handed the SDK
  // `loadSdk` resolved — a run with no kata, the common one, never needs it.
  const tools = args.kataUrl
    ? async ({ task, candidates, board, runProof }) => {
      const { factoryTools } = await import('./tools.mjs')
      const loaded = await loadSdk()
      const sdk = loaded && { createSdkMcpServer: loaded.createSdkMcpServer, tool: loaded.tool, z: loaded.z }
      return factoryTools({ kata, projectId: args.kataProject, task, candidates, board, runProof, sdk })
    }
    : null

  return {
    worker: overrides.worker ||
      (async (opts) => runWorker(opts, { query: overrides.query || (await loadSdk())?.query })),
    judge,
    sh: overrides.sh || defaultSh,
    git: overrides.git || defaultGit,
    tools,
    kata,
    questionsPath,
    policyPath,
    fetchImpl,
    log,
  }
}

/** The entry. One line of JSON on stdout — the run's answer — and every other
 *  word of it on stderr, so a caller can read the last line and be done.
 *
 *  M4: without `--refold` this is exactly what it was; with it, the required
 *  arguments and the seam are `runRefold`'s own, and the exit is a direct
 *  function of what it answered — 0 refolded, 3 red, 4 conflict. */
export async function main (argv = process.argv.slice(2)) {
  const args = parseArgv(argv)
  if (args.refold) {
    for (const required of ['plan', 'target', 'base', 'onto', 'runDir']) {
      if (!args[required]) {
        process.stderr.write('factory/engine.mjs --refold --plan <plan.md> --target <repo> --base <sha> --onto <sha> --run-dir <dir>\n')
        return 2
      }
    }
    const answer = await runRefold(args, buildDeps(args))
    process.stdout.write(JSON.stringify(answer) + '\n')
    if (answer.refolded) return 0
    if (answer.reason === 'red') return 3
    if (answer.reason === 'conflict') return 4
    return 1
  }
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

if (import.meta.main) { process.exitCode = await main() }

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

// ── where everything lives ───────────────────────────────────────────────────

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const KERNEL = path.join(REPO, 'skills/ultrapowers/kernel/fold_wave.py')
const COMPILER = path.join(REPO, 'skills/ultrapowers/scripts/compile_plan.py')

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

  fs.mkdirSync(runDir, { recursive: true })
  const eventsPath = path.join(runDir, 'events.jsonl')
  fs.writeFileSync(eventsPath, '')
  const appendEvent = (row) => fs.appendFileSync(eventsPath, JSON.stringify(row) + '\n')

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
  const compiledOut = spawnSync('python3', [COMPILER, planPath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const compiled = lastJson(compiledOut.stdout)
  if (!compiled || !Array.isArray(compiled.launch_waves)) {
    throw new Error('compile_plan.py did not answer a plan: ' + String(compiledOut.stderr || '').slice(0, 400))
  }

  const planText = fs.readFileSync(planPath, 'utf8')
  const waves = compiled.launch_waves.map((wave) => wave.map((t) => {
    const body = bodyOf(planText, t.id)
    return { ...t, body, clauses: clausesOf(body) }
  }))
  const tasks = waves.flat()

  // What a task waits on: `depends_on` as the plan declares it and the DAG's
  // own edges. No launch-wave barrier — the spec's loop folds on every
  // adoption with no epoch, and a task's interface edge is already an edge.
  const edgePreds = new Map(tasks.map((t) => [t.id, new Set(t.depends_on || [])]))
  for (const edge of compiled.dag_edges || []) {
    if (edgePreds.has(edge.to)) edgePreds.get(edge.to).add(edge.from)
  }
  const waitsOn = (task) => [...(edgePreds.get(task.id) || [])]

  let head = String(args.base || git(['rev-parse', 'HEAD'], target).trim())
  let cost = 0
  let waveNumber = 0
  const adopted = []
  const parked = new Set()
  const done = new Set()
  const inflight = new Set()
  const supervisorTicks = []

  const supervisorMode = (() => {
    try { return (JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8')).supervisor || {}).mode } catch { return null }
  })()

  /** A judge reader that never throws and never is required to exist: Jev
   *  answers no fact, and a reading that did not happen is simply absent. */
  const read = async (name, arg) => {
    const reader = judge[name]
    if (typeof reader !== 'function') return null
    try { return (await reader(arg)) ?? null } catch (e) { log('judge ' + name + ': ' + String((e && e.message) || e).slice(0, 200)); return null }
  }

  /** The supervisor tick: record-only, fired once per dispatch off the message
   *  stream itself, and never awaited inside it — a tick that blocked the
   *  stream would be a supervisor that slowed the worker it watches. */
  const onMessageFor = (label, taskId) => {
    if (supervisorMode !== 'record-only' || typeof judge.readSupervisor !== 'function') return undefined
    let turns = 0
    let fired = false
    const tail = []
    return (message) => {
      if (!message || message.type !== 'assistant') return
      turns += 1
      const blocks = (message.message && message.message.content) || []
      for (const b of blocks) if (b && b.type === 'text') tail.push(String(b.text))
      if (fired || turns < SUPERVISOR_TICK_TURNS) return
      fired = true
      supervisorTicks.push(
        read('readSupervisor', { label, task: taskId, transcript: tail.slice(-8).join('\n').slice(-4000) })
          .then((answers) => { if (answers) appendEvent({ kind: 'supervisor', task: taskId, label, answers }) })
          .catch(() => {}))
    }
  }

  /** One dispatch. Every worker call in this file goes through here, so the
   *  budget, the config dir, the supervisor and the cost tally are one shape. */
  // A worker's end, whatever kind — a thrown SDK error, a rejected iterator — is
  // the candidate's measurement and never an exception that escapes the loop: the
  // answer carries `error`, the clone is measured as it stands, and a candidate
  // that produced nothing parks its task with that error as the reason.
  const dispatch = async (opts) => {
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
    }
    const result = answer && answer.result
    cost += (result && Number(result.total_cost_usd)) || 0
    const denials = (answer && answer.denials) || []
    if (denials.length) log(opts.label + ': ' + denials.length + ' denied edit(s)')
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

  const capture = (clone, anchor, out) => {
    git(['add', '-A'], clone)
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

  // Prompts carry the task, its files and its test command — and never a
  // command for a model to run against the repository's history.
  const examPrompt = (task) =>
    'TASK:\n' + task.body +
    '\n\nEXAM FILES: ' + (task.proofTests || []).join(', ') +
    '\nTEST COMMAND: ' + task.testCmd +
    '\n\nINTERFACES:\n' + interfacesBlock(task)

  const implPrompt = (task) =>
    'TASK:\n' + task.body +
    '\n\nFILES: ' + implFilesOf(task).join(', ') +
    '\nTEST COMMAND: ' + task.testCmd +
    '\n\nINTERFACES:\n' + interfacesBlock(task) +
    '\n\nAMENDMENTS: (none — this is the first dispatch of this task)'

  /**
   * One candidate, measured: its own exam run, its patch against the anchor,
   * and the judge's reading of that patch against the task's clauses.
   */
  const measure = async ({ task, dir, index, anchor }) => {
    const [cmd, ...argv] = String(task.testCmd || '').trim().split(/\s+/)
    const examRun = cmd ? sh(cmd, argv, dir) : { status: 0 }
    const examExit = exitOf(examRun)
    const patch = capture(dir, anchor, path.join(runDir, `patch-${task.id}-${index}.diff`))
    const text = fs.existsSync(patch) ? fs.readFileSync(patch, 'utf8') : ''
    const perFile = splitDiff(text)
    const names = Object.keys(perFile)
    // `task` and `cwd` ride the reading so a caller can tell one candidate of a
    // raced task from the other; `makeJudge` builds Jev's state from `clauses`,
    // `patch` and `files` alone, so neither reaches the model.
    const reading = await read('readLanding', {
      task: task.id,
      cwd: dir,
      clauses: task.clauses,
      patch: text.slice(0, 20000),
      files: Object.fromEntries(names.map((n, j) => ['f' + j, perFile[n].slice(0, 6000)])),
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
   * One task, from its reading to the patch that is ready to fold.
   *
   * Everything here happens at `anchor` — the head the wave started from — and
   * the patch is captured against it, so the kernel merges the candidate three
   * ways onto whatever head the earlier landings of this wave have moved to.
   */
  const land = async (task, anchor) => {
    const t0 = Date.now()
    const reading = (await read('readTask', { id: task.id, title: task.title, body: task.body })) || {}
    const k = Number.isInteger(reading.k) && reading.k > 0 ? reading.k : 1
    const wantsReferee = reading.referee === true

    // 1. the exam, written at the head by the implementer's peer.
    const examDir = cloneAt('exam-' + task.id, anchor)
    let mcpServers = null
    if (tools) {
      try {
        const server = await tools({ task: { id: task.id, uid: task.uid, files: task.files }, candidates: [] })
        if (server) mcpServers = { factory: server }
      } catch (e) { log('tools: ' + String((e && e.message) || e).slice(0, 200)) }
    }
    await dispatch({
      role: 'exam', label: 'exam:' + task.id, taskId: task.id, cwd: examDir, model,
      systemPrompt: EXAM_MD, files: task.proofTests, prompt: examPrompt(task), mcpServers,
    })
    const examFiles = (task.proofTests || []).map((p) => {
      const at = path.join(examDir, p)
      return [p, fs.existsSync(at) ? fs.readFileSync(at, 'utf8') : '']
    })

    // 2. k implementers, concurrently, each with the exam handed in.
    const prompt = implPrompt(task)
    const files = implFilesOf(task)
    const candidates = await Promise.all(Array.from({ length: k }, async (_, index) => {
      const dir = cloneAt(`impl-${task.id}-${index}`, anchor)
      for (const [p, content] of examFiles) {
        fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true })
        fs.writeFileSync(path.join(dir, p), content)
      }
      const answer = await dispatch({
        role: 'implement', label: 'impl:' + task.id + ':' + index, taskId: task.id, cwd: dir,
        model, systemPrompt: IMPL_MD, files, prompt, mcpServers,
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

    // A worker that ended with an error and left no patch has nothing to fold:
    // the task parks on the worker's own words, and the run goes on.
    const bytes = best.patch && fs.existsSync(best.patch) ? fs.statSync(best.patch).size : 0
    if (best.error && bytes === 0) {
      return { task, k, anchor, best, dead: 'worker ended without a patch: ' + best.error, wall_ms: Date.now() - t0 }
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
        prompt: 'TASK:\n' + task.body +
          '\n\nFILES: ' + (task.files || []).join(', ') +
          '\nTEST COMMAND: ' + task.testCmd + '\nexit ' + best.examExit +
          '\n' + best.examTail +
          '\n\nThe patch this task produced is on disk at ' + best.patch + ' — read it there.',
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
      }
      appendEvent({
        kind: 'referee', task: task.id, findings: findings.length,
        blocking: blocking.length, grades,
      })
      if (blocking.length) {
        const handoff = blocking
          .map((f) => '- ' + String((f && (f.detail || f.title)) || f))
          .join('\n')
        await dispatch({
          role: 'implement', label: 'fix:' + task.id, taskId: task.id, cwd: best.dir,
          model, systemPrompt: IMPL_MD, files, mcpServers,
          prompt: prompt + '\n\nHAND-OFF:\nAn earlier reading of this task was left with these:\n' + handoff,
        })
        const remeasured = await measure({ task, dir: best.dir, index: best.index, anchor })
        best = { ...remeasured, examTail: remeasured.examTail }
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
    let fold = kernel(['fold', ...common, '--base', head, '--patch', patchArg])
    if (fold && fold.complete !== true) {
      fold = await resolve({ fold, common, patchArg, landing })
    }
    if (!fold || fold.complete !== true) {
      const reason = 'fold did not complete: ' + JSON.stringify(fold || null).slice(0, 300)
      appendEvent({ kind: 'parked', task: id, reason })
      return null
    }
    const mat = kernel(['materialize', ...common, '--prev-head', head, '--patch', patchArg,
      '--subject', 'task ' + id])
    if (!mat || typeof mat.candidateSha !== 'string') {
      const reason = 'materialize answered no candidate: ' + JSON.stringify(mat || null).slice(0, 300)
      appendEvent({ kind: 'parked', task: id, reason })
      return null
    }
    git(['reset', '-q', '--hard', mat.candidateSha], target)
    head = mat.candidateSha
    return mat.candidateSha
  }

  /** One pass of the resolver over whatever the fold left open. */
  const resolve = async ({ fold, common, patchArg, landing }) => {
    const open = Array.isArray(fold.open) ? fold.open : []
    if (!open.length) return fold
    let latest = fold
    for (const conflict of open) {
      const answer = await dispatch({
        role: 'resolve', label: 'resolve:' + landing.task.id + ':' + conflict.i,
        taskId: landing.task.id, cwd: path.dirname(String(conflict.hunksFile || runDir)),
        model, systemPrompt: RESOLVE_MD, files: [], readOnly: true, schema: RESOLVER_SCHEMA,
        prompt: 'HUNKS FILE: ' + conflict.hunksFile + ' (conflicted path: ' + conflict.path + ')' +
          '\n\nRead that file and resolve every block it carries.',
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

  // ── the loop ───────────────────────────────────────────────────────────────
  while (done.size < tasks.length) {
    const ready = tasks.filter((t) =>
      !done.has(t.id) && !inflight.has(t.id) && waitsOn(t).every((d) => done.has(d)))
    if (!ready.length) {
      for (const t of tasks) {
        if (done.has(t.id)) continue
        appendEvent({ kind: 'parked', task: t.id, reason: 'no ready set: ' + waitsOn(t).join(', ') + ' never adopted' })
        parked.add(t.id)
        done.add(t.id)
      }
      break
    }
    ready.forEach((t) => inflight.add(t.id))
    const landings = await Promise.all(ready.map((t) => land(t, head)))
    for (const landing of landings) {
      const id = landing.task.id
      inflight.delete(id)
      done.add(id)
      if (landing.dead) {
        appendEvent({ kind: 'parked', task: id, reason: landing.dead })
        parked.add(id)
        continue
      }
      const candidateSha = await foldIn(landing)
      if (candidateSha === null) { parked.add(id); continue }
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
      log('adopted task ' + id + ' -> ' + candidateSha.slice(0, 8) +
        '  exam=' + landing.best.examExit + ' k=' + landing.k)
    }
  }

  await Promise.allSettled(supervisorTicks)

  return {
    done: adopted.length === tasks.length,
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
    ? async ({ task, candidates }) => {
      const { makeKataClient, httpTransport } = await import('../fleet/kata-client.mjs')
      const { factoryTools } = await import('./tools.mjs')
      const kata = overrides.kata || makeKataClient({
        transport: httpTransport({ url: String(args.kataUrl) }),
        actor: args.kataActor,
      })
      return factoryTools({ kata, projectId: args.kataProject, task, candidates })
    }
    : null

  return {
    worker: overrides.worker ||
      (async (opts) => runWorker(opts, { query: overrides.query || await sdkQuery() })),
    judge,
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

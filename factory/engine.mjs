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
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { cloneAtBase } from './clone.mjs'
import { makeJevClient } from '../fleet/jev-client.mjs'
import { runAll, bootstrapFor } from './commands.mjs'
import { runWorker } from './worker.mjs'
import { makeJudge } from './judge.mjs'
import { literalsOf, hunksCarrying, filesShown } from './hunks.mjs'
import { unionReply } from './union.mjs'
import { makeBoard, patchWithRevision } from './board.mjs'
import { candidateTests, symbolsOf, commandFor, excerptFor } from './select.mjs'
import { proofsTouched, foldRound } from './reverify.mjs'
import { waitsFor } from './dispatch.mjs'
import { runLines } from './proofs.mjs'
import { checksAtBase } from './checks-at-base.mjs'
import { settledCoverage, observedFacts, clauseFacts } from './facts.mjs'
import { observedWork, supervisorTick, makeObservedWatch } from './watch.mjs'
import { kFor, probeRecord } from './kprobe.mjs'
import { refereeTrigger } from './referee.mjs'
import { retrying, isRateLimited } from './retry.mjs'
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
export const DEFAULT_REFEREE_MODEL = 'claude-opus-5-5'

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

/** The timeout every command `runAll` runs gets, wherever no more specific
 *  policy field applies (`policy.fold.reverify.timeout_seconds` and
 *  `policy.select.timeout_seconds` are the two that do). */
const DEFAULT_TIMEOUT_SECONDS = 300

/** One patch, split into its per-file diffs, keyed by path. */
export function splitDiff (text) {
  const pattern = /^diff --git a\/(\S+) b\/\S+\n([\s\S]*?)(?=^diff --git |(?![\s\S]))/gm
  return Object.fromEntries([...String(text || '').matchAll(pattern)].map((m) => [m[1], m[2]]))
}

// ── the tests argument a Jev reader is asked: excerpted, then budget-trimmed ─

const SELECT_TESTS_BUDGET_BYTES = 60000

/**
 * `found` (a `candidateTests` result, most-matching first) turned into the
 * `tests` argument a reader gets: each candidate's file text excerpted to
 * `cap` characters around its own hits (M2), then candidates dropped from
 * the end of the list — the least-matching first — until the serialized
 * result is at most 60,000 bytes (M3). `kept`/`dropped` describe the trim
 * whether or not one actually happened.
 */
export function excerptTests (found, readFile, cap) {
  const entryFor = (c) => ({ path: c.path, text: excerptFor(readFile(c.path), c.hits, cap) })
  let kept = found
  let tests = kept.map(entryFor)
  while (kept.length > 0 && Buffer.byteLength(JSON.stringify(tests), 'utf8') > SELECT_TESTS_BUDGET_BYTES) {
    kept = kept.slice(0, -1)
    tests = kept.map(entryFor)
  }
  return { tests, kept: kept.length, dropped: found.length - kept.length }
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

// ── shared by a task's own fold (`runEngine`'s `foldIn`) and a re-fold
// (`runRefold`): cloning, the resolver pass, and the proof run ──────────────

/** A `cloneAt(name, sha)` over one `target`: a fresh clone under `runDir`,
 *  detached at `sha`, its own private exclude so a candidate's bytecode
 *  cache never rides a captured patch. The one place either entry makes a
 *  clone, so both make it the same way.
 *
 *  M4: directly after the clone is made, and before anything else runs
 *  there, this installs whatever the target needs — `bootstrapFor`'s
 *  command over `planCmd: bootstrapCmd` and this clone's own tracked files
 *  — through `sh`, under the same `timeout` an exam command runs under. A
 *  non-zero exit there is not this clone's caller's problem to notice on
 *  its own: `appendEvent` (when given) gets a `bootstrap:red` row naming
 *  this clone and that exit, and `cloneAt` THROWS — an `Error` carrying a
 *  `bootstrapRed: { clone, exit, tail }` field — rather than answering a
 *  clone whose dependencies never installed as if it were ready. Every
 *  caller either lets that propagate (a re-fold, where no per-task park
 *  exists to route it to) or catches `err.bootstrapRed` to park the one
 *  task that clone was made for. `sh` absent (no caller left needs this,
 *  but a direct unit test of `makeCloner` alone might) skips bootstrapping
 *  entirely, exactly as before this task. */
function makeCloner ({ target, runDir, git, sh, bootstrapCmd, timeoutSeconds, appendEvent }) {
  return (name, sha) => {
    const dest = path.join(runDir, name)
    fs.rmSync(dest, { recursive: true, force: true })
    const clone = cloneAtBase({ repo: target, dest, base: sha, git })
    try {
      fs.appendFileSync(path.join(clone, '.git', 'info', 'exclude'),
        '\n__pycache__/\n*.pyc\n.pytest_cache/\n')
    } catch { /* a clone shape without .git/info is still a clone */ }

    if (sh) {
      let files = []
      try { files = git(['ls-files'], clone).split('\n').map((s) => s.trim()).filter(Boolean) } catch { /* none tracked (or not a repo) reads as no evidence */ }
      const cmd = bootstrapFor({ planCmd: bootstrapCmd, files })
      if (cmd) {
        const r = runAll({ cmds: [cmd], cwd: clone, sh, timeoutSeconds: timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS })
        if (r.exit !== 0) {
          if (appendEvent) appendEvent({ kind: 'bootstrap:red', clone, exit: r.exit })
          const err = new Error('bootstrap failed in ' + clone + ': exit ' + r.exit)
          err.bootstrapRed = { clone, exit: r.exit, tail: r.out.slice(-1500) }
          throw err
        }
      }
    }

    return clone
  }
}

/**
 * One pass of the resolver over whatever a fold left open — the union first
 * (M3, gated by `unionPolicy.mode`), then one resolver dispatch per
 * still-open conflict. Shared by a task's own landing (`runEngine`'s
 * `foldIn`, which hands in `withHandoff` and its task's id) and a re-fold
 * (`runRefold`, which has neither) — "the union and the resolver included",
 * exactly the same for both.
 */
async function resolveConflicts ({
  fold, common, patchArg, runDir, unionPolicy, readUnion, dispatch, model,
  RESOLVE_MD, appendEvent, taskId, labelId, kernel, withHandoff,
}) {
  const open = Array.isArray(fold.open) ? fold.open : []
  if (!open.length) return { fold, dispatchedResolver: false }
  const suffix = withHandoff || (async (p) => p)
  let latest = fold
  let dispatchedResolver = false
  for (const conflict of open) {
    if (unionPolicy.mode === 'live' && typeof readUnion === 'function') {
      let hunksFileText = null
      try { hunksFileText = fs.readFileSync(conflict.hunksFile, 'utf8') } catch { /* unreadable: no union */ }
      const union = hunksFileText !== null ? unionReply(hunksFileText) : null
      if (union) {
        const verdict = await readUnion({ hunks: union.hunks, who: { task: taskId ?? null, label: null } })
        if (verdict && verdict.union === true) {
          const replyDir = path.join(runDir, `reply-${labelId}-${conflict.i}`)
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
          appendEvent({ kind: 'union', task: taskId, path: conflict.path, hunks: union.hunks.length })
          if (latest && latest.complete === true) return { fold: latest, dispatchedResolver }
          continue
        }
      }
    }
    dispatchedResolver = true
    const answer = await dispatch({
      role: 'resolve', label: 'resolve:' + labelId + ':' + conflict.i,
      taskId, cwd: path.dirname(String(conflict.hunksFile || runDir)),
      model, systemPrompt: RESOLVE_MD, files: [], readOnly: true, schema: RESOLVER_SCHEMA,
      prompt: await suffix(
        'HUNKS FILE: ' + conflict.hunksFile + ' (conflicted path: ' + conflict.path + ')' +
        '\n\nRead that file and resolve every block it carries.',
        taskId),
    })
    const reply = (answer && answer.result && answer.result.structured_output) || null
    if (!reply || reply.status !== 'RESOLVED') return { fold: latest, dispatchedResolver }
    const replyDir = path.join(runDir, `reply-${labelId}-${conflict.i}`)
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
    if (latest && latest.complete === true) return { fold: latest, dispatchedResolver }
  }
  return { fold: latest, dispatchedResolver }
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
  // The run's own base, constant for the whole run — it never moves, even as
  // `head` does on every landing. `checksAtBase` runs the plan's own
  // `Check:` lines here, once, before any task's own work begins.
  const runBase = head
  let cost = 0
  let waveNumber = 0
  const adopted = []
  // M6: `{ [taskId]: [paths] }`, filled in on every landing — the tests
  // `measure` selected and ran for that task's own best candidate — so a
  // later fold's own re-verify (`proofsTouched`, `runProofsAndChecks`) knows
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
  // judge's own `readUnion` when the judge has one; else the engine builds it
  // from `deps.ask` (M3), over `policy.resolve.union`'s own thresholds.
  const unionPolicy = (policyDoc.resolve || {}).union || {}
  const readUnion = typeof deps.readUnion === 'function' ? deps.readUnion
    : typeof judge.readUnion === 'function' ? judge.readUnion
      : buildReadUnion(deps.ask, unionPolicy)
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
  // `runRefold`, below, so both entries make a clone the same way.
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

  const kernel = (argv) => {
    const r = sh('env', ['python3', KERNEL, ...argv], REPO)
    const answer = lastJson(outOf(r))
    if (!answer) log('kernel ' + argv[0] + ': exit ' + exitOf(r) + ' ' + String((r && r.stderr) || '').slice(-300))
    return answer
  }

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

  /** M2's landing post: `factsExit`, any failing proof line's own command
   *  and output tail, the judge's claim reading, and the lowest-covered
   *  clause — its own text, off the task, and the score the judge gave it.
   *  Posted after every measurement of the candidate the task is riding: the
   *  initial one, and again after any redispatch (M4) or blocking-finding
   *  fix remeasures it. */
  const postLanding = async (task, best) => {
    const coverage = Array.isArray(best.coverage) ? best.coverage : []
    let low = 0
    for (let i = 1; i < coverage.length; i += 1) {
      if ((Number(coverage[i]) || 0) < (Number(coverage[low]) || 0)) low = i
    }
    const clauseText = (task.clauses && task.clauses[low]) || '(no clause text)'
    const clauseScore = coverage.length ? coverage[low] : null
    // M2: a failing proof Run: line's own command and output tail are in the
    // worker's hands — carried into this same landing fact.
    const failedRuns = Array.isArray(best.runLines) ? best.runLines.filter((r) => r.exit !== 0) : []
    const runsText = failedRuns.length
      ? '\n\nfailing proof line(s):\n' +
        failedRuns.map((r) => r.cmd + '\nexit ' + r.exit + '\n' + r.tail).join('\n\n')
      : ''
    const text = 'exit ' + best.factsExit +
      '\nclaim: ' + (best.claim === null || best.claim === undefined ? 'null' : best.claim) +
      '\nlowest-covered clause (' + clauseScore + '): ' + clauseText + runsText
    await board.post(task.id, 'landing', text)
    // M4: every landing writes Jev's claim reading to the record, whatever
    // `gate.jev_claim.mode` says — the row is unconditional; only whether
    // `short` or adoption ever reads it back is gated.
    appendEvent({
      kind: 'gate:jev_claim', task: task.id,
      claim: best.claim ?? null, claimGivenFacts: best.claimGivenFacts ?? null,
      mode: jevClaimMode,
    })
  }

  /**
   * One candidate, measured: its own Proof `Run:` lines, then — in the SAME
   * clone — the few existing tests the patch touches (M2's selection, moved
   * in here so it runs once per candidate rather than once for whichever
   * candidate a task's `land()` happened to pick), then the judge's reading
   * of the patch against the task's clauses, with both sets of facts in
   * front of it.
   */
  const measure = async ({ task, dir, index, anchor, baseCloneForTask }) => {
    // M2: a task's own Proof `Run:` lines, in this candidate's own clone —
    // never split into argv (a Run: line is often a pipeline), and every
    // line runs even after an earlier one failed.
    let proofRunResults = []
    if (proofsEnabled && Array.isArray(task.proofRuns) && task.proofRuns.length) {
      proofRunResults = await runLines({
        lines: task.proofRuns, cwd: dir, sh, env: undefined, timeoutSeconds: proofTimeoutSeconds,
      })
      for (const r of proofRunResults) {
        appendEvent({ kind: 'run:line', task: task.id, cmd: r.cmd, exit: r.exit })
      }
    }
    const patch = capture(dir, anchor, path.join(runDir, `patch-${task.id}-${index}.diff`))
    const text = fs.existsSync(patch) ? fs.readFileSync(patch, 'utf8') : ''
    const perFile = splitDiff(text)
    const literals = literalsOf(task.clauses)
    const label = 'impl:' + task.id + ':' + index

    // M2: selection, once for this candidate — the few existing tests its
    // patch touches, run in this SAME clone; a red one is re-run at the
    // anchor to tell a genuine catch from a redness the base already had.
    let selectedRan = []
    let covered = {}
    const catches = []
    if (selectPolicy.enabled === true && typeof judge.readGuards === 'function') {
      const { names: candNames } = candidatesOf(task, text)
      const touched = Object.keys(perFile)
      const trackedInCandidate = git(['ls-files'], dir).split('\n').map((s) => s.trim()).filter(Boolean)
      const readCandidateFile = (p) => {
        try { return fs.readFileSync(path.join(dir, p), 'utf8') } catch { return '' }
      }
      const found = await candidateTests({
        files: trackedInCandidate, read: readCandidateFile,
        paths: touched, symbols: candNames,
        exclude: [], cap: selectPolicy.max_candidates,
      })
      if (found.length) {
        const { tests: guardTests, kept, dropped } = excerptTests(found, readCandidateFile, 3000)
        if (dropped > 0) appendEvent({ kind: 'select:trimmed', task: task.id, kept, dropped })
        const guards = await read('readGuards', {
          patch: hunksCarrying(text, candNames, 20000),
          tests: guardTests,
          who: { task: task.id, label },
        })
        if (guards) {
          const runSetCapped = (Array.isArray(guards.selected) ? guards.selected : []).slice(0, selectPolicy.max_run)
          const ran = []
          const reds = []
          for (const p of runSetCapped) {
            const argv = commandFor(p, selectPolicy.timeout_seconds)
            if (!argv) continue
            const r = sh(argv[0], argv.slice(1), dir)
            const exit = exitOf(r)
            ran.push({ path: p, exit })
            if (exit !== 0) reds.push({ path: p, exit, argv, out: outOf(r) })
          }
          selectedRan = ran
          for (const red of reds) {
            const baseDir = baseCloneForTask
              ? baseCloneForTask()
              : cloneAt('base-' + task.id + '-' + index, anchor)
            const r2 = sh(red.argv[0], red.argv.slice(1), baseDir)
            if (exitOf(r2) !== 0) {
              appendEvent({ kind: 'select:red-at-base', task: task.id, path: red.path })
              continue
            }
            appendEvent({ kind: 'catch', task: task.id, path: red.path, exit: red.exit })
            await board.post(task.id, 'catch', red.path + '\nexit ' + red.exit + '\n' + red.out.slice(-1500))
            catches.push(red)
          }

          // M2: `covered` = `readCovering`'s per-clause answer over the
          // selected tests that exited 0, shaped `{ M1: [paths], ... }`.
          const greenPaths = new Set(ran.filter((r) => r.exit === 0).map((r) => r.path))
          const greenTests = guardTests.filter((t) => greenPaths.has(t.path))
          const coveringRead = greenTests.length
            ? await read('readCovering', { clauses: task.clauses, tests: greenTests, who: { task: task.id, label } })
            : null
          task.clauses.forEach((_c, i) => {
            const key = 'M' + (i + 1)
            const p = coveringRead && Array.isArray(coveringRead.covered) ? coveringRead.covered[i] : null
            covered[key] = p ? [p] : []
          })

          appendEvent({
            kind: 'select:landing', task: task.id,
            candidates: found.map((c) => c.path), selected: runSetCapped, ran,
            why: Object.fromEntries(found.map((c) => [c.path, c.why])),
            covered,
          })
        }
      }
    }
    if (!Object.keys(covered).length) {
      task.clauses.forEach((_c, i) => { covered['M' + (i + 1)] = [] })
    }

    // M2: `factsExit` = 0 iff every probe exited 0 AND no selected test was
    // a catch; else the first non-zero exit among probes-then-catches, in
    // that order.
    const orderedExits = [...proofRunResults.map((r) => r.exit), ...catches.map((c) => c.exit)]
    const factsExit = orderedExits.every((e) => e === 0) ? 0 : orderedExits.find((e) => e !== 0)

    // M4: Jev is handed the facts the task's own proof lines and its
    // selected tests already observed, and the per-clause coverage those
    // same facts already settled — so a clause a cited command already
    // proved is no longer a guess from the diff alone.
    let factsArgs = {}
    let settled
    if (factsEnabled) {
      const facts = observedFacts({
        clauses: task.clauses,
        proofRuns: Array.isArray(task.proofRuns) ? task.proofRuns : [],
        proofRunClauses: Array.isArray(task.proofRunClauses) ? task.proofRunClauses : [],
        runLines: proofRunResults,
        tests: selectedRan,
        capBytes: factsCapBytes,
      })
      settled = settledCoverage({
        clauses: task.clauses,
        proofRunClauses: Array.isArray(task.proofRunClauses) ? task.proofRunClauses : [],
        runLines: proofRunResults,
      })
      const clauseFactsArr = clauseFacts({
        clauses: task.clauses,
        proofRuns: Array.isArray(task.proofRuns) ? task.proofRuns : [],
        proofRunClauses: Array.isArray(task.proofRunClauses) ? task.proofRunClauses : [],
        runLines: proofRunResults,
        tests: selectedRan,
        covers: covered,
      })
      factsArgs = { facts, settled, clauseFacts: clauseFactsArr }
    }
    const reading = await read('readLanding', {
      task: task.id,
      cwd: dir,
      clauses: task.clauses,
      patch: hunksCarrying(text, literals, 20000),
      files: filesShown(perFile, literals, 6000),
      ...factsArgs,
      who: { task: task.id, label },
    })
    if (factsEnabled) {
      appendEvent({
        kind: 'landing:facts',
        task: task.id,
        settled,
        claim: reading && typeof reading.claim === 'number' ? reading.claim : null,
        claimGivenFacts: reading && typeof reading.claimGivenFacts === 'number' ? reading.claimGivenFacts : null,
        perClause: reading && Array.isArray(reading.claimGivenFactsPerClause) ? reading.claimGivenFactsPerClause : null,
        facts: factsArgs.facts ? factsArgs.facts.length : 0,
      })
    }
    return {
      dir,
      index,
      patch,
      factsExit,
      claim: reading && typeof reading.claim === 'number' ? reading.claim : null,
      claimGivenFacts: reading && typeof reading.claimGivenFacts === 'number' ? reading.claimGivenFacts : null,
      coverage: (reading && Array.isArray(reading.coverage)) ? reading.coverage : [],
      runLines: proofRunResults,
      selected: selectedRan,
      covered,
      caught: catches.length > 0,
    }
  }

  /** M2's line, and nothing else: `factsExit` 0 first, then the claim
   *  reading, then the mean of the per-clause coverage. Rounded only far
   *  enough to keep binary floating point from turning `10 + 0.2 + 0.5` into
   *  a long tail. */
  const scoreOf = (c) => {
    const mean = c.coverage.length
      ? c.coverage.reduce((s, v) => s + (Number(v) || 0), 0) / c.coverage.length
      : 0
    return Math.round((10 * (c.factsExit === 0 ? 1 : 0) + (c.claim ?? 0) + mean) * 1e10) / 1e10
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
        task: { id: taskId, uid: uidFor(taskId), files: task && task.files },
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
    const trig = refereeTrigger({ rung: wantsReferee })
    appendEvent({ kind: 'referee:trigger', task: task.id, trigger: trig.trigger })
    if (trig.dispatch) {
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
          kind: 'referee', task: task.id, died: true, error: answer.error, trigger: trig.trigger,
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
          blocking: blocking.length, grades, trigger: trig.trigger,
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
      if (!(err && err.bootstrapRed)) throw err
      const { clone, exit, tail } = err.bootstrapRed
      const reason = 'bootstrap failed in ' + clone + ': exit ' + exit + (tail ? '\n' + tail : '')
      return { task, k, anchor, dead: reason, wall_ms: Date.now() - t0 }
    }
  }

  /**
   * One landing, folded. The kernel answers `fold` with `complete`; a fold that
   * is not complete is a conflict, and one resolver pass is what it gets — a
   * second would be a loop, and the task is parked instead.
   */
  // M5: records both the outcome and the order it was set in, so `labelPair`
  // can tell which of two tasks folded later.
  const setFoldOutcome = (id, outcome) => {
    foldOutcomes.set(id, outcome)
    foldOrder.push(id)
  }

  const foldIn = async (landing) => {
    waveNumber += 1
    const id = landing.task.id
    const common = ['--repo', target, '--run-dir', runDir, '--wave', String(waveNumber)]
    const patchArg = id + '=' + landing.best.patch + '@' + landing.anchor
    let neededResolveConflicts = false
    let dispatchedResolver = false
    let fold = kernel(['fold', ...common, '--base', head, '--patch', patchArg])
    if (fold && fold.complete !== true) {
      neededResolveConflicts = true
      const result = await resolve({ fold, common, patchArg, landing })
      fold = result.fold
      dispatchedResolver = result.dispatchedResolver
    }
    if (!fold || fold.complete !== true) {
      const reason = 'fold did not complete: ' + JSON.stringify(fold || null).slice(0, 300)
      await board.post(id, 'conflict', reason)
      appendEvent({ kind: 'parked', task: id, reason })
      setFoldOutcome(id, 'parked')
      return { sha: null, reason }
    }
    const mat = kernel(['materialize', ...common, '--prev-head', head, '--patch', patchArg,
      '--subject', 'task ' + id])
    if (!mat || typeof mat.candidateSha !== 'string') {
      const reason = 'materialize answered no candidate: ' + JSON.stringify(mat || null).slice(0, 300)
      appendEvent({ kind: 'parked', task: id, reason })
      setFoldOutcome(id, 'parked')
      return { sha: null, reason }
    }
    git(['reset', '-q', '--hard', mat.candidateSha], target)
    head = mat.candidateSha
    // M5's `labelPair` reads this back as `folds`: `clean` when the kernel's
    // own three-way merge completed with no conflict, `resolved` when a
    // resolver was dispatched for this fold, `union` when `resolveConflicts`
    // settled it without ever dispatching one.
    const outcome = dispatchedResolver ? 'resolved' : (neededResolveConflicts ? 'union' : 'clean')
    setFoldOutcome(id, outcome)
    return { sha: mat.candidateSha }
  }

  /** One pass of the resolver over whatever the fold left open — the union
   *  and the resolver dispatch, both shared with `runRefold` through
   *  `resolveConflicts`. */
  const resolve = async ({ fold, common, patchArg, landing }) =>
    resolveConflicts({
      fold, common, patchArg, runDir, unionPolicy, readUnion, dispatch, model,
      RESOLVE_MD, appendEvent, taskId: landing.task.id, labelId: landing.task.id,
      kernel, withHandoff,
    })

  /**
   * The fold check's own runner: every `exam` task's test command, and — with
   * `policy.proofs.run_lines` on — every entry of the plan's own `checks`,
   * run once in `dir`. Kept callable with any list of tasks and any
   * directory (never closing over a single task) so a `--refold` entry can
   * run it over every task at once, not only the one just folded.
   *
   * M3: a check's command runs with `ULTRA_BASE` in its own environment, set
   * to the run's base sha — never the anchor, never the candidate's own
   * base — and every check runs, minor or not; only a non-minor failure is
   * folded into `reds` alongside a red exam.
   */
  const runProofsAndChecks = async ({ dir, tasksToRun, foldedTaskId, timeoutSeconds, includeChecks = true }) => {
    const ran = []
    const reds = []
    // Every touched task's own probes and selected tests, through the one
    // runner the fold check and `--refold` both use: the fold check had kept
    // its own whitespace split through two same-file folds (run-196), so a
    // joined command's second program never ran here — the defect #1163
    // names, caught on the folded tree by the commands task's own probe.
    for (const t of tasksToRun) {
      const lines = Array.isArray(t.proofRuns) ? t.proofRuns : []
      if (lines.length) {
        const results = await runLines({ lines, cwd: dir, sh, env: undefined, timeoutSeconds })
        for (const r of results) {
          ran.push({ id: t.id, kind: 'probe', cmd: r.cmd, exit: r.exit })
          if (r.exit !== 0) reds.push({ kind: 'probe', id: t.id, exit: r.exit, out: r.tail })
        }
      }
      const testPaths = selectedByTask[t.id] || selectedByTask[String(t.id)] || []
      for (const p of testPaths) {
        const argv = commandFor(p, selectPolicy.timeout_seconds)
        if (!argv) continue
        const r = sh(argv[0], argv.slice(1), dir)
        const exit = exitOf(r)
        ran.push({ id: t.id, kind: 'test', path: p, exit })
        if (exit !== 0) reds.push({ kind: 'test', id: t.id, path: p, exit, out: outOf(r) })
      }
    }
    const checks = includeChecks && proofsEnabled && Array.isArray(compiled.checks) ? compiled.checks : []
    if (checks.length) {
      const results = await runLines({
        lines: checks.map((c) => c.cmd), cwd: dir, sh,
        env: { ULTRA_BASE: runBase }, timeoutSeconds: proofTimeoutSeconds,
      })
      results.forEach((r, i) => {
        const minor = Boolean(checks[i] && checks[i].minor)
        appendEvent({ kind: 'check:line', task: foldedTaskId, cmd: r.cmd, exit: r.exit, minor })
        if (r.exit !== 0 && !minor) reds.push({ kind: 'check', cmd: r.cmd, exit: r.exit, out: r.tail })
      })
    }
    return { ran, reds }
  }

  /**
   * M2-M4/M6: directly after a task's fold, the probes and selected tests of
   * every adopted task the fold touched (the folded task's own included),
   * plus the plan's own `checks`, run once on the folded tree; every red
   * goes through one `foldRound` (`./reverify.mjs`) — attributed, judged,
   * re-attempted by the right worker, verified once more. Still red forces
   * `done` to false without unadopting anything. A minor check's own
   * failure is recorded (`check:line`) and buys neither a red row nor a
   * re-attempt.
   */
  const reverifyAfterFold = async (task, best, headBefore) => {
    const patchText = best.patch && fs.existsSync(best.patch) ? fs.readFileSync(best.patch, 'utf8') : ''
    const touched = Object.keys(splitDiff(patchText))
    if (!touched.length) return
    const cap = Number.isInteger(reverifyPolicy.max_run) ? reverifyPolicy.max_run : 6
    const timeoutSeconds = reverifyPolicy.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS

    const tasksToRun = reverifyPolicy.enabled === true
      ? proofsTouched({ folded: task.id, touched, adopted, tasks, selected: selectedByTask, cap })
      : []
    const checksNamed = proofsEnabled && Array.isArray(compiled.checks) ? compiled.checks : []
    if (!tasksToRun.length && !checksNamed.length) return

    // A `bootstrapRed` here is not this landing's own park: read as "this fold's re-verify could not run".
    let first
    try {
      first = await runProofsAndChecks({
        dir: cloneAt('fold-verify-' + task.id, head), tasksToRun, foldedTaskId: task.id, timeoutSeconds,
      })
    } catch (err) {
      if (!(err && err.bootstrapRed)) throw err
      first = { ran: [], reds: [], bootstrapRed: err.bootstrapRed }
    }
    appendEvent({ kind: 'fold:verify', task: task.id, ran: first.ran, attempt: 1 })
    if (first.bootstrapRed) { foldUnresolved = true; return }
    if (!first.reds.length) return

    for (const red of first.reds) {
      await board.post(task.id, 'fold-red',
        (red.kind === 'probe' ? ('probe ' + red.id) : red.kind === 'test' ? ('test ' + red.path) : ('check ' + red.cmd)) +
        ' exit ' + red.exit + '\n' + red.out.slice(-1500))
    }

    const hunks = hunksCarrying(patchText, [],
      Number.isInteger(attributionPolicy.hunks_cap) ? attributionPolicy.hunks_cap : 4000)

    // A `cloneAt` throw here rejects, which `foldRound` reads as `null`.
    const runProofsAt = async (id, sha) => {
      const t = tasks.find((tk) => tk.id === id)
      if (!t) return 0
      const dir = cloneAt('fold-before-' + id + '-' + task.id, sha)
      const { reds } = await runProofsAndChecks({
        dir, tasksToRun: [t], foldedTaskId: task.id, timeoutSeconds, includeChecks: false,
      })
      return reds.length ? reds[0].exit : 0
    }

    // A fresh clone, the implementer dispatched with the fact riding its own prompt, folded as any landing.
    const reattempt = async (action) => {
      const actionTask = tasks.find((t) => t.id === action.task)
      if (!actionTask) return false
      const anchor = head
      let dir
      try {
        dir = cloneAt('fold-fix-' + action.role + '-' + action.task + '-' + task.id, anchor)
      } catch (err) {
        if (err && err.bootstrapRed) return false
        throw err
      }
      await dispatch({
        role: 'implement', label: 'impl:' + action.task + ':fold',
        taskId: action.task, cwd: dir, model, mcpServers: null,
        systemPrompt: IMPL_MD, files: actionTask.files || [],
        prompt: await withHandoff(
          (await implPrompt(actionTask)) + '\n\n' + action.fact,
          action.task),
      })
      const patch = capture(dir, anchor, path.join(runDir, `patch-${action.task}-fold-${task.id}.diff`))
      const folded = await foldIn({ task: actionTask, anchor, best: { patch } })
      return folded.sha !== null
    }

    const verify = () => runProofsAndChecks({
      dir: cloneAt('fold-verify-' + task.id, head), tasksToRun, foldedTaskId: task.id, timeoutSeconds,
    })

    const { unresolved } = await foldRound({
      reds: first.reds, folded: task.id, headBefore, head,
      enabled: attributionPolicy.enabled === true, hunks,
      runProofsAt, appendEvent, reattempt, verify,
    })
    if (unresolved) foldUnresolved = true
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
      const label = await pairsMod.labelPair({ pair, tasks, read, folds, foldOrder })
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

// ── the re-fold: a finished run's whole work, folded onto a main that moved ─

/**
 * `--refold`: the same fold a task's own landing goes through (`foldIn`,
 * above — the union and the resolver included, through `resolveConflicts`),
 * asked once for the whole of a finished run's own work rather than for one
 * task's patch.
 *
 * The patch is the target's own `HEAD` (before this touches anything) against
 * `--base` — the run's own base — and the moving head the kernel folds it
 * onto is `--onto`, the new tip. A completed fold is re-verified before this
 * answers at all: every task's own Proof `Run:` lines, in a clone of the new
 * head — no exam file, no `--exams-dir` (M1). A red line there undoes the
 * reset; an unresolved conflict never touches the target to begin with.
 *
 * Resolves the one JSON object `main` prints verbatim: `{ refolded, head,
 * onto }` on success, `{ refolded: false, reason: 'red' | 'conflict', head?,
 * onto }` otherwise.
 */

// The dispatched model id and the models the SDK reports it actually used,
// for a `dispatch:end` row: `models` is the sorted keys of the result's
// `modelUsage`, or `null` when there is none to report.
export function modelCells ({ model, result }) {
  const usage = result && typeof result === 'object' ? result.modelUsage : null
  const keys = usage && typeof usage === 'object' ? Object.keys(usage) : []
  return { model: model ?? null, models: keys.length ? keys.sort() : null }
}

// M4: no board, no examiner, no implementer — the one worker role a
// re-fold ever dispatches is the resolver, exactly as a task's own fold.
export function makeRefoldDispatch ({ worker, appendEvent, policy, sleep }) {
  const dispatchOnce = async (opts) => {
    appendEvent({
      kind: 'dispatch:start', task: opts.taskId, label: opts.label, role: opts.role,
      ...(opts.retry_of ? { retry_of: opts.retry_of } : {}),
    })
    let answer
    let turns = 0
    try {
      answer = await worker({
        cwd: opts.cwd, prompt: opts.prompt, systemPrompt: opts.systemPrompt, model: opts.model,
        files: opts.files, schema: opts.schema ?? null, mcpServers: opts.mcpServers ?? null,
        onMessage: (m) => { if (m && m.type === 'assistant') turns += 1 },
        readOnly: Boolean(opts.readOnly), role: opts.role, label: opts.label,
        task: opts.taskId,
        onDenied: (row) => appendEvent(row),
      })
    } catch (e) {
      answer = { result: null, denials: [], error: String((e && e.message) || e).slice(0, 500), turns }
    }
    appendEvent({
      kind: 'dispatch:end', task: opts.taskId, label: opts.label, role: opts.role,
      error: (answer && answer.error) || null,
      ...modelCells({ model: opts.model, result: answer && answer.result }),
      ...(opts.retry_of ? { retry_of: opts.retry_of } : {}),
    })
    return answer
  }
  return retrying(dispatchOnce, { policy, sleep })
}

export async function runRefold (rawArgs = {}, deps = {}) {
  const args = normalizeArgs(rawArgs)
  const target = path.resolve(String(args.target))
  const runDir = path.resolve(String(args.runDir ?? '.'))
  const base = String(args.base)
  const onto = String(args.onto)
  const model = args.model || DEFAULT_MODEL

  const worker = deps.worker || runWorker
  const sh = deps.sh || defaultSh
  const git = deps.git || defaultGit
  const log = deps.log || ((s) => process.stderr.write(String(s) + '\n'))

  fs.mkdirSync(runDir, { recursive: true })
  // Appended to, never truncated: `runDir` is the run's own directory, and the
  // file already holds every row the engine wrote. run-198 (2026-09-21) lost
  // its live `events.jsonl` to a `writeFileSync(eventsPath, '')` here — the
  // tagged evidence survived only because the boot had copied it first.
  const eventsPath = path.join(runDir, 'events.jsonl')
  const appendEvent = (row) => fs.appendFileSync(eventsPath, JSON.stringify({ ts: new Date().toISOString(), ...row }) + '\n')

  const RESOLVE_MD = roleText('resolve')

  const policyDoc = (() => {
    try {
      const policyFile = args.policy ? path.resolve(String(args.policy)) : POLICY_PATH
      return JSON.parse(fs.readFileSync(policyFile, 'utf8'))
    } catch { return {} }
  })()
  const unionPolicy = (policyDoc.resolve || {}).union || {}
  const reverifyPolicy = (policyDoc.fold || {}).reverify || {}
  const timeoutSeconds = reverifyPolicy.timeout_seconds ?? 300
  // M5: same fallback chain as `runEngine`'s.
  const judge = deps.judge || {}
  const readUnion = typeof deps.readUnion === 'function' ? deps.readUnion
    : typeof judge.readUnion === 'function' ? judge.readUnion
      : buildReadUnion(deps.ask, unionPolicy)

  const kernel = (argv) => {
    const r = sh('python3', [KERNEL, ...argv], REPO)
    const answer = lastJson(outOf(r))
    if (!answer) log('kernel ' + argv[0] + ': exit ' + exitOf(r) + ' ' + String((r && r.stderr) || '').slice(-300))
    return answer
  }

  // M4: no board, no examiner, no implementer — the one worker role a
  // re-fold ever dispatches is the resolver, exactly as a task's own fold.
  const dispatch = makeRefoldDispatch({ worker, appendEvent, policy: policyDoc })

  // The plan, compiled only for the tasks' own test commands — every one of
  // them is what M2's re-verify runs.
  const compiledOut = spawnSync('python3', [COMPILER, String(args.plan)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const compiled = lastJson(compiledOut.stdout)
  if (!compiled || !Array.isArray(compiled.launch_waves)) {
    throw new Error('plan_parse.py did not answer a plan: ' + String(compiledOut.stderr || '').slice(0, 400))
  }
  const tasks = compiled.launch_waves.flat()
  // M4: same bootstrap-command resolution as runEngine's — the plan's own
  // `bootstrapCmd` when the parser printed one, else each clone's own
  // tracked files decide.
  const bootstrapCmd = typeof compiled.bootstrapCmd === 'string' && compiled.bootstrapCmd !== ''
    ? compiled.bootstrapCmd
    : null

  const cloneAt = makeCloner({ target, runDir, git, sh, bootstrapCmd, timeoutSeconds, appendEvent })

  // M1: the run's whole patch is the target's own HEAD, as it stands before
  // any of this touches it, against `--base`.
  const startHead = git(['rev-parse', 'HEAD'], target).trim()
  const patchFile = path.join(runDir, 'refold.diff')
  git(['diff', '--binary', '--full-index', '--no-renames', '--output=' + patchFile, base, startHead], target)
  const patchArg = 'refold=' + patchFile + '@' + base

  // The kernel's `--wave` is an integer and its fold log is per (run dir,
  // wave). run-198 passed `--wave refold`: argparse refused it, the kernel
  // answered no JSON, and the null was reported as a conflict — so no re-fold
  // had ever worked. Each re-fold gets a kernel directory of its own under the
  // run's, at wave 1, so neither the engine's waves nor an earlier re-fold's
  // log can collide with it (measured on run-198's sandbox with the real
  // kernel: `--wave 1` in a fresh directory folds clean and materializes).
  let attempt = 1
  while (fs.existsSync(path.join(runDir, 'refold-' + attempt))) attempt += 1
  const kernelDir = path.join(runDir, 'refold-' + attempt)
  fs.mkdirSync(kernelDir, { recursive: true })
  const common = ['--repo', target, '--run-dir', kernelDir, '--wave', '1']
  let fold = kernel(['fold', ...common, '--base', onto, '--patch', patchArg])
  if (!fold) {
    // A kernel that answered nothing is not a conflict: say so, and stop.
    appendEvent({ kind: 'refold:kernel-error', step: 'fold', onto })
    return { refolded: false, reason: 'kernel', onto }
  }
  if (fold && fold.complete !== true) {
    const result = await resolveConflicts({
      fold, common, patchArg, runDir, unionPolicy, readUnion, dispatch, model,
      RESOLVE_MD, appendEvent, taskId: undefined, labelId: 'refold', kernel,
    })
    fold = result.fold
  }
  if (!fold || fold.complete !== true) {
    // M3: never touches the target — it is still exactly where it was.
    const openPath = (Array.isArray(fold && fold.open) && fold.open[0] && fold.open[0].path) || null
    appendEvent({ kind: 'refold:conflict', path: openPath })
    return { refolded: false, reason: 'conflict', onto }
  }

  const mat = kernel(['materialize', ...common, '--prev-head', onto, '--patch', patchArg,
    '--subject', 'refold onto ' + onto])
  if (!mat || typeof mat.candidateSha !== 'string') {
    appendEvent({ kind: 'refold:conflict', path: null })
    return { refolded: false, reason: 'conflict', onto }
  }

  // M1: resets the target to the resulting commit.
  git(['reset', '-q', '--hard', mat.candidateSha], target)

  // M2/M6: before answering, verify the new head in its own clone — every
  // task's own Proof `Run:` lines, run there directly (no `--exams-dir`,
  // no exam file to overlay back in).
  const verifyDir = cloneAt('refold-verify', mat.candidateSha)
  const reds = []
  for (const t of tasks) {
    const lines = Array.isArray(t.proofRuns) ? t.proofRuns : []
    if (!lines.length) continue
    const results = await runLines({ lines, cwd: verifyDir, sh, env: undefined, timeoutSeconds })
    for (const r of results) {
      if (r.exit !== 0) reds.push({ task: t.id, cmd: r.cmd, exit: r.exit })
    }
  }
  if (reds.length) {
    for (const red of reds) appendEvent({ kind: 'refold:red', task: red.task, cmd: red.cmd, exit: red.exit })
    // M2: a red re-verify resets the target back to the head it had.
    git(['reset', '-q', '--hard', startHead], target)
    return { refolded: false, reason: 'red', head: mat.candidateSha, onto }
  }

  return { refolded: true, head: mat.candidateSha, onto }
}

// ── the CLI's own deps ───────────────────────────────────────────────────────

/**
 * The four seams the CLI runs on, constructed from the arguments.
 *
 * `overrides` is for a caller that wants one of them swapped without building
 * the other three — the worker's seam, and the only way the Jev wiring below
 * can be read without opening a socket.
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

  // `factory/tools.mjs` is imported only where it is used. It resolves the SDK
  // and zod out of `fleet/node_modules` at module evaluation, so a static
  // import here would make a run with no kata — the common one — depend on an
  // install it never needs.
  const tools = args.kataUrl
    ? async ({ task, candidates, board, runProof }) => {
      const { makeKataClient, httpTransport } = await import('../fleet/kata-client.mjs')
      const { factoryTools } = await import('./tools.mjs')
      const kata = overrides.kata || makeKataClient({
        transport: httpTransport({ url: String(args.kataUrl) }),
        actor: args.kataActor,
      })
      return factoryTools({ kata, projectId: args.kataProject, task, candidates, board, runProof })
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

export default { runEngine, runRefold, makeRefoldDispatch, modelCells, buildDeps, main, parseArgv, normalizeArgs, bodyOf, clausesOf, splitDiff }

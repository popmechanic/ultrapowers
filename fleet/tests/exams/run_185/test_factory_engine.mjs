/**
 * test_factory_engine.mjs — the exam for Task 5: *the engine — the run as
 * search, folding on every landing*.
 *
 * This file is the Proof's `Test:` (`fleet/tests/test_factory_engine.mjs`),
 * written whole at the landing path the run's EXAM PATHS line names:
 * `fleet/tests/exams/run_185/test_factory_engine.mjs`. Every path in it is
 * written for THIS directory — `../../../..` is the repository root, from
 * which `factory/engine.mjs`, `evals/fixtures/claims/plan.md` and
 * `skills/ultrapowers/scripts/compile_plan.py` are read.
 *
 * Run: `node fleet/tests/exams/run_185/test_factory_engine.mjs`
 *
 * ──────────────────────────────────────────────────────────────────────────
 * The Machine clauses under test, restated so a reader can map every
 * assertion below back to the contract:
 *
 *   M1 — `node factory/engine.mjs --plan <plan.md> --target <repo> --base
 *        <sha> --run-dir <dir>` compiles the plan with
 *        `skills/ultrapowers/scripts/compile_plan.py`, and for every task in
 *        `launch_waves`, once every task it `depends_on` is adopted,
 *        dispatches its exam worker at the current head, then `k` implementer
 *        workers each in its own clone cut at that head with the exam files
 *        copied in, and on each landing captures the patch against the
 *        anchor, calls the kernel's `fold`, then `materialize`, adopts
 *        `candidateSha` as the new head, and appends one JSON line
 *        `{ kind: 'landing', task, k, examExit, claim, coverage,
 *        candidateSha, wall_ms }` to `<run-dir>/events.jsonl`; when every
 *        task is adopted it answers `{ done: true, adopted, head, wall_ms,
 *        cost_usd }`.
 *   M2 — `k` is the judge's `readTask(...).k`, and with `k` 2 both candidates
 *        are dispatched CONCURRENTLY, each scored
 *        `10 × (examExit === 0) + claim + mean(coverage)`, the highest
 *        adopted and the other's clone discarded, one
 *        `{ kind: 'select', task, scores, chosen }` line appended.
 *   M3 — a discovery referee — one `runWorker` with `readOnly: true` and a
 *        findings schema — is dispatched for a task exactly when
 *        `readTask(...).referee` is true; each finding is graded by
 *        `judge.gradeFinding`, and a `'blocking'` grade sends the candidate
 *        to ONE re-dispatch of the implementer with the finding as
 *        `HAND-OFF:` BEFORE the fold. With no task reading `referee` true,
 *        `events.jsonl` carries no `referee` row.
 *   M4 — the engine's `deps` — `{ worker, judge, sh, git, tools }` — are
 *        injectable as the second argument of the exported
 *        `runEngine(args, deps)`, and the CLI entry constructs them from
 *        `factory/worker.mjs`, `factory/judge.mjs` (with `makeJevClient` at
 *        `$TYPESAFE_BASE_URL` and a `fetchImpl` adding
 *        `authorization: Bearer $TYPESAFE_API_KEY` when set),
 *        `factory/tools.mjs` when `--kata-url` is given, and `child_process`.
 *   M5 — every worker dispatch passes `files` equal to the task's Files minus
 *        its Proof `Test:` paths for an implementer and equal to the Proof
 *        `Test:` paths for the examiner; no worker prompt asks for a git
 *        command.
 *   M6 — `factory/engine.mjs` is 1,500 lines or fewer.
 *
 * The Proof's legs, and where each is answered below:
 *
 *   (a) [M1] one `runEngine` over the fixture plan against a fresh git
 *            repository, with fake `worker`/`judge`, a `sh` that answers exit
 *            0 for pytest and delegates the kernel to the real
 *            `fold_wave.py`, and real `git`: the resolved object's keys, its
 *            `done`/`adopted`/`head`/`wall_ms`/`cost_usd`; one `landing` row
 *            per task with exactly the eight keys and the pinned values; the
 *            repository's HEAD; the second-wave task's ordering against its
 *            `depends_on`; and the exam file already in every implementer's
 *            `cwd`.
 *   (b) [M2] `k` 2 for task `1`: two implementer calls with distinct `cwd`s
 *            before any fold, the first held unresolved until the second is
 *            made (which a sequential dispatch cannot survive), `scores`
 *            `[10.7, 11.4]` with `chosen` the second and the adopted marker
 *            carrying the second `cwd`; then `scores` `[10.7, 1.4]` with the
 *            second candidate's exam red, `chosen` the first, marker the
 *            first.
 *   (c) [M3] `referee` true for task `1`: a `readOnly` call, then an
 *            implementer call whose `prompt` carries `HAND-OFF:`, both before
 *            task `1`'s fold; then `referee` false everywhere: no `readOnly`
 *            call and no `referee` row.
 *   (d) [M4] `runEngine` and `buildDeps(args)` exported; `buildDeps` without
 *            `--kata-url` answering `tools` null and the two document paths;
 *            with `--kata-url` answering a `tools` function; and the
 *            `authorization: Bearer k` header on the request the judge's
 *            `ask` actually forwards, present with `TYPESAFE_API_KEY` set and
 *            absent with it unset.
 *   (e) [M5] the `files` of task `1`'s implementer and examiner calls, and no
 *            `git ` in any recorded prompt.
 *   (f) [M6] the line count of `factory/engine.mjs`.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Two readings this file had to settle, recorded here because the task does
 * not spell them and a reader would otherwise have to guess:
 *
 *   · `args`. M1 names CLI flags; M4 exports `runEngine(args, deps)` and
 *     `buildDeps(args)` without saying whether `args` is an argv array or a
 *     parsed object. This exam refuses to pick the implementer's parser for
 *     them: `mkArgs` answers an ARRAY of `--flag value` tokens carrying the
 *     kebab-case AND camelCase keys as properties, so `args.runDir`,
 *     `args['run-dir']` and `Array.isArray(args) ? parse(args) : args` all
 *     read the same run.
 *
 *   · `sh` and `git`. Leg (a) asks for real `git` and an `sh` that delegates
 *     kernel calls to the real `fold_wave.py`. Rather than guess a signature,
 *     both are taken from the engine's OWN `buildDeps()`: `git` is passed
 *     through untouched, and `sh` is wrapped so that a call whose argv
 *     mentions `pytest` is answered by handing that same real `sh` an
 *     `exit <n>`, and every other call — the kernel's `fold` and
 *     `materialize` among them — is forwarded verbatim.
 *
 * `factory/tools.mjs` is NOT importable in a tree without `fleet/node_modules`
 * (it resolves `@anthropic-ai/claude-agent-sdk` eagerly). Leg (d) therefore
 * only reads `typeof tools`, and never calls it: the engine must reach
 * `factory/tools.mjs` by a lazy import inside `buildDeps`, the way
 * `factory/worker.mjs` lazily reaches the SDK, or this whole exam dies at
 * load with no leg named.
 *
 * Nothing here opens a socket: `globalThis.fetch` is replaced with a recorder
 * before the engine is imported, and every model call is the exam's own fake.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** `fleet/tests/exams/run_185` → `fleet/tests/exams` → `fleet/tests` →
 *  `fleet` → the repository root. */
const ROOT = path.resolve(HERE, '..', '..', '..', '..')
const ENGINE_PATH = path.join(ROOT, 'factory', 'engine.mjs')
const PLAN_PATH = path.join(ROOT, 'evals', 'fixtures', 'claims', 'plan.md')
const COMPILER_PATH = path.join(ROOT, 'skills', 'ultrapowers', 'scripts', 'compile_plan.py')

/** Every temporary directory this file makes, removed at the end. */
const SCRATCH = []
const scratch = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  SCRATCH.push(dir)
  return dir
}

// ══════════════════════════════════════════════════════════════════════════
// The fetch recorder, installed BEFORE the engine is imported so an engine
// that captures `globalThis.fetch` at load still hands the exam's recorder to
// the Jev client. Leg (d) reads the request off `FETCH.calls`.
// ══════════════════════════════════════════════════════════════════════════

const FETCH = {
  calls: [],
  reply: { answers: { difficulty: { score: 1 }, design_open: { noul: 0 }, review_difficulty: { score: 1 } } },
}
globalThis.fetch = async (url, init) => {
  FETCH.calls.push({ url: String(url), init: init || {} })
  const body = JSON.stringify(FETCH.reply)
  return { status: 200, ok: true, async text () { return body }, async json () { return JSON.parse(body) } }
}

// The Jev seam M4 names. The key is set BEFORE the import so an engine that
// reads the environment at load time still sees it for leg (d)'s first case;
// leg (d) deletes it again before its second `buildDeps`.
process.env.TYPESAFE_BASE_URL = process.env.TYPESAFE_BASE_URL || 'http://jev.exam.invalid'
process.env.TYPESAFE_API_KEY = 'k'

// ══════════════════════════════════════════════════════════════════════════
// The deliverable, imported dynamically: a tree without it reports the ABSENT
// MODULE as a named assertion rather than dying at load with no leg named.
// ══════════════════════════════════════════════════════════════════════════

let mod = null
let modImportError = null
try {
  mod = await import(pathToFileURL(ENGINE_PATH).href)
} catch (error) {
  modImportError = error
}
assert.ok(modImportError === null,
  '(a) [M1] `factory/engine.mjs` is importable — the module this task creates. Got: ' +
  String(modImportError && (modImportError.stack || modImportError.message || modImportError)))

const runEngine = mod.runEngine
const buildDeps = mod.buildDeps

assert.equal(typeof runEngine, 'function',
  '(d) [M4] `factory/engine.mjs` exports `runEngine(args, deps)`; got ' + JSON.stringify(typeof runEngine))
assert.equal(typeof buildDeps, 'function',
  '(d) [M4] `factory/engine.mjs` exports `buildDeps(args)`; got ' + JSON.stringify(typeof buildDeps))

// ══════════════════════════════════════════════════════════════════════════
// The compiled fixture plan — the same `launch_waves` the engine walks.
// ══════════════════════════════════════════════════════════════════════════

const compiled = JSON.parse(execFileSync('python3', [COMPILER_PATH, PLAN_PATH], {
  cwd: ROOT, encoding: 'utf8', env: { ...process.env, PYTHONPATH: '.' },
}))
const WAVES = compiled.launch_waves
assert.ok(Array.isArray(WAVES) && WAVES.length >= 2,
  '(a) [M1] the fixture plan compiles to at least two `launch_waves`. Got: ' + JSON.stringify(WAVES && WAVES.length))

/** Each compiled task, with the two file sets M5 splits its Files into. */
const TASKS = WAVES.flat().map((t) => ({
  id: String(t.id),
  title: String(t.title),
  files: t.files.slice(),
  proofTests: t.proofTests.slice(),
  implFiles: t.files.filter((f) => !t.proofTests.includes(f)),
}))
const TASK_IDS = TASKS.map((t) => t.id)
const taskOf = (id) => TASKS.find((t) => t.id === String(id))
/** The second-wave task, whose ordering leg (a) reads against `depends_on`. */
const SECOND_WAVE = WAVES[1].map((t) => ({ id: String(t.id), depends_on: (t.depends_on || []).map(String) }))

// ══════════════════════════════════════════════════════════════════════════
// Small helpers.
// ══════════════════════════════════════════════════════════════════════════

const sorted = (list) => (list ?? []).slice().map(String).sort()
const sameSet = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  const x = sorted(a); const y = sorted(b)
  return x.every((v, i) => v === y[i])
}

/** A promise that rejects rather than hanging the run, so an engine that
 *  never resolves reads as the leg that was waiting on it. The timer is NOT
 *  unref'd — an unref'd bomb lets node exit silently on an unsettled await,
 *  which reads as nothing at all rather than as the leg. */
const withTimeout = (promise, label, ms = 300000) => {
  let timer = null
  const bomb = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('timed out after ' + (ms / 1000) + 's waiting for ' + label)), ms)
  })
  return Promise.race([promise, bomb]).finally(() => { if (timer) clearTimeout(timer) })
}

const camel = (flag) => flag.replace(/-([a-z])/g, (_m, c) => c.toUpperCase())

/**
 * The run's `args`, in both shapes at once: an array of `--flag value`
 * tokens (so an argv parser reads it) carrying the kebab and camelCase keys
 * as properties (so a parsed-object reader reads it). See the header.
 */
const mkArgs = (flags) => {
  const argv = []
  for (const [flag, value] of Object.entries(flags)) {
    if (value === undefined || value === null) continue
    argv.push('--' + flag, String(value))
  }
  const args = argv.slice()
  for (const [flag, value] of Object.entries(flags)) {
    if (value === undefined || value === null) continue
    args[flag] = value
    args[camel(flag)] = value
  }
  args.argv = argv
  return args
}

/** A fresh target repository at BASE: the tree the Proof's `Run:` builds —
 *  `widgetkit/__init__.py`, `tests/`, `conftest.py`. */
const makeTarget = () => {
  const dir = scratch('factory-engine-target-')
  const git = (argv) => execFileSync('git', argv, { cwd: dir, encoding: 'utf8' })
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.name', 'exam'])
  git(['config', 'user.email', 'exam@localhost'])
  git(['config', 'commit.gpgsign', 'false'])
  fs.mkdirSync(path.join(dir, 'widgetkit'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'widgetkit', '__init__.py'), '')
  fs.writeFileSync(path.join(dir, 'conftest.py'), '')
  fs.writeFileSync(path.join(dir, 'README.md'), '# target\n')
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'BASE'])
  return { dir, base: git(['rev-parse', 'HEAD']).trim() }
}

const headOf = (repo) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()

/** `<run-dir>/events.jsonl`, one parsed object per non-empty line. */
const readEvents = (runDir) => {
  const file = path.join(runDir, 'events.jsonl')
  assert.ok(fs.existsSync(file),
    '(a) [M1] the engine appends its rows to `<run-dir>/events.jsonl`; no such file at ' + file)
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '').map((line, i) => {
    try {
      return JSON.parse(line)
    } catch (e) {
      throw new assert.AssertionError({
        message: '(a) [M1] every `events.jsonl` line is one JSON object; line ' + (i + 1) +
          ' is not: ' + JSON.stringify(line.slice(0, 200)),
      })
    }
  })
}

const IS_SHA = /^[0-9a-f]{40}$/

// ══════════════════════════════════════════════════════════════════════════
// The real halves of `deps`: `git` and `sh`, taken from the engine's own
// `buildDeps` so the exam never guesses their signature. The wrapper answers
// pytest itself and forwards everything else — the kernel included.
// ══════════════════════════════════════════════════════════════════════════

const REAL = buildDeps(mkArgs({ plan: PLAN_PATH, model: 'claude-sonnet-5' }))
assert.ok(REAL && typeof REAL === 'object',
  '(d) [M4] `buildDeps(args)` answers a `deps` object. Got: ' + JSON.stringify(REAL))
assert.equal(typeof REAL.sh, 'function',
  '(a) [M1] `buildDeps(args).sh` is the engine\'s own `child_process` shell, the one the exam ' +
  'delegates the kernel to; got ' + JSON.stringify(typeof REAL.sh))
assert.equal(typeof REAL.git, 'function',
  '(a) [M1] `buildDeps(args).git` is the engine\'s own real `git`; got ' + JSON.stringify(typeof REAL.git))

/** Every string this call carries, whatever the signature. */
const argvOf = (callArgs) => {
  const out = []
  for (const value of callArgs) {
    if (typeof value === 'string') out.push(value)
    else if (Array.isArray(value)) out.push(...value.map(String))
    else if (value && typeof value === 'object') {
      for (const key of ['cmd', 'command', 'bin', 'argv', 'args']) {
        const v = value[key]
        if (typeof v === 'string') out.push(v)
        else if (Array.isArray(v)) out.push(...v.map(String))
      }
    }
  }
  return out
}

/** The directory this call runs in: an explicit `cwd` field, else the one
 *  positional argument that is an existing absolute directory. */
const cwdOf = (callArgs) => {
  for (const value of callArgs) {
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.cwd === 'string') return value.cwd
  }
  for (const value of callArgs) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) continue
    try {
      if (fs.statSync(value).isDirectory()) return value
    } catch { /* not a directory; keep looking */ }
  }
  return null
}

/** The same call with its command replaced by `sh -c 'exit <code>'`, so the
 *  answer carries the engine's OWN result shape and the exit code the leg
 *  asks for. */
const exitThrough = (callArgs, code) => {
  const shellArgs = ['-c', 'exit ' + code]
  const rewritten = callArgs.slice()
  if (rewritten[0] && typeof rewritten[0] === 'object' && !Array.isArray(rewritten[0])) {
    rewritten[0] = { ...rewritten[0], cmd: 'sh', command: 'sh', bin: 'sh', args: shellArgs, argv: ['sh', ...shellArgs] }
  } else if (Array.isArray(rewritten[0])) {
    rewritten[0] = ['sh', ...shellArgs]
  } else {
    rewritten[0] = 'sh'
    rewritten[1] = shellArgs
  }
  try {
    return REAL.sh(...rewritten)
  } catch {
    return { status: code, code, exitCode: code, stdout: '', stderr: '', signal: null }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// One harness: the fakes of `deps.worker` and `deps.judge`, a journal that
// orders worker calls against kernel calls, and the run that drives them.
// ══════════════════════════════════════════════════════════════════════════

const WORKER_ANSWER = { subtype: 'success', total_cost_usd: 0 }
/** The referee's findings. They carry NO severity of their own: the only
 *  source of `'blocking'` in leg (c) is `judge.gradeFinding`. */
const FINDINGS = [
  { detail: 'the constructor never validates its size', file: 'widgetkit/widget.py' },
  { detail: 'the module has no docstring', file: 'widgetkit/widget.py' },
]

/**
 * Drive one whole `runEngine`.
 *
 *   `k`         — `(task) => number`, the `k` the fake `readTask` answers
 *   `referee`   — `(task) => boolean`, likewise
 *   `landing`   — `(cwd, task) => { claim, coverage }`, read back off the
 *                 patch because `readLanding` carries no `cwd` of its own
 *   `marker`    — `(task, cwd) => string`, what the fake implementer writes
 *   `examExit`  — `(cwd) => number`, what the fake `sh` answers for pytest
 *   `gate`      — when true, the FIRST implementer call of `gateTask` does
 *                 not resolve until a SECOND one has been made
 *   `box`       — filled with `{ cwds }`, the implementer `cwd`s per task id,
 *                 as they are dispatched, so `landing` and `examExit` can name
 *                 a candidate the run has not finished yet
 */
async function drive (options = {}) {
  const {
    k = () => 1,
    referee = () => false,
    landing = () => ({ claim: 0.9, coverage: [0.9] }),
    marker = (task) => 'impl-' + task.id,
    examExit = () => 0,
    gate = false,
    gateTask = '1',
    box = {},
    label = 'the run',
  } = options

  const target = makeTarget()
  const runDir = scratch('factory-engine-run-')
  const journal = []
  const workerCalls = []
  const kernelCalls = []
  const gradeCalls = []
  const taskCalls = []
  const landingCalls = []
  const state = { gateRelease: null, gateOpened: false, gateTimedOut: false }

  // ── the fake worker ─────────────────────────────────────────────────────
  const implCwds = new Map() // task id -> [cwd, ...] in dispatch order
  // Handed out before the first dispatch, so a caller's `landing`/`examExit`
  // can name a candidate while the run is still in flight.
  box.cwds = (id) => (implCwds.get(String(id)) || []).slice()

  const classify = (opts) => {
    if (opts && opts.readOnly === true) {
      const prompt = String(opts.prompt ?? '')
      const byTitle = TASKS.find((t) => prompt.includes(t.title))
      const byFiles = TASKS.find((t) => sameSet(opts.files, t.files) || sameSet(opts.files, t.implFiles))
      const byPath = TASKS.find((t) => prompt.includes(t.implFiles[0]))
      return { role: 'referee', task: byTitle || byFiles || byPath || null }
    }
    for (const task of TASKS) {
      if (sameSet(opts.files, task.proofTests)) return { role: 'exam', task }
      if (sameSet(opts.files, task.implFiles)) return { role: 'impl', task }
    }
    const prompt = String(opts.prompt ?? '')
    const byTitle = TASKS.find((t) => prompt.includes(t.title))
    return { role: 'unknown', task: byTitle || null }
  }

  const worker = async (opts = {}) => {
    const { role, task } = classify(opts)
    const cwd = String(opts.cwd ?? '')
    const call = {
      seq: journal.length,
      role,
      taskId: task ? task.id : null,
      cwd,
      files: Array.isArray(opts.files) ? opts.files.slice() : opts.files,
      prompt: String(opts.prompt ?? ''),
      systemPrompt: String(opts.systemPrompt ?? ''),
      model: opts.model,
      readOnly: opts.readOnly === true,
      schema: opts.schema,
      handoff: String(opts.prompt ?? '').includes('HAND-OFF:'),
      examSeen: null,
      markersSeen: {},
    }
    workerCalls.push(call)
    journal.push({ kind: 'worker', call })

    if (role === 'exam' && task) {
      // "writes `exam-<id>` into the first of them"
      const file = path.join(cwd, task.proofTests[0])
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, 'exam-' + task.id)
    } else if (role === 'impl' && task) {
      // What the clone already held when the implementer was called: its own
      // exam file, and every other task's marker.
      const examFile = path.join(cwd, task.proofTests[0])
      call.examSeen = fs.existsSync(examFile) ? fs.readFileSync(examFile, 'utf8') : null
      for (const other of TASKS) {
        call.markersSeen[other.id] = fs.existsSync(path.join(cwd, other.implFiles[0]))
      }
      if (!call.handoff) {
        const list = implCwds.get(task.id) || []
        list.push(cwd)
        implCwds.set(task.id, list)
      }
      // "writes the task's first non-test file into its `cwd`"
      const file = path.join(cwd, task.implFiles[0])
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, marker(task, cwd) + '\n')
      if (gate && task.id === gateTask && !call.handoff) {
        const list = implCwds.get(task.id) || []
        if (list.length === 1) {
          // The first candidate is held until the second call has been made:
          // a sequential dispatch never makes it, and the gate then gives up
          // on its own so the run finishes and leg (b) reports WHY rather
          // than leaving the process hanging on an unsettled await.
          await new Promise((resolve) => {
            let timer = null
            state.gateRelease = () => { if (timer) clearTimeout(timer); resolve() }
            timer = setTimeout(() => { state.gateTimedOut = true; resolve() }, 60000)
          })
        } else if (state.gateRelease) {
          state.gateOpened = true
          const release = state.gateRelease
          state.gateRelease = null
          release()
        }
      }
    }

    const result = { ...WORKER_ANSWER }
    if (role === 'referee') {
      result.structured_output = { findings: FINDINGS.slice(), issues: FINDINGS.slice() }
      result.result = JSON.stringify({ findings: FINDINGS.slice(), issues: FINDINGS.slice() })
    }
    return { result, denials: [], turns: 1, wall_ms: 1 }
  }

  // ── the fake judge ──────────────────────────────────────────────────────
  const judge = {
    async readTask (state_ = {}) {
      const text = JSON.stringify(state_ ?? {})
      const task = TASKS.find((t) => text.includes(t.title)) || null
      taskCalls.push({ task: task && task.id, state: state_ })
      return { k: k(task), referee: referee(task), answers: {} }
    },
    async readLanding (state_ = {}) {
      // `readLanding` carries no `cwd`: the candidate is read back out of its
      // own patch, which is why the fake implementer writes its `cwd` as the
      // marker's content in leg (b).
      const text = JSON.stringify(state_ ?? {})
      let hit = null
      for (const list of implCwds.values()) {
        for (const cwd of list) {
          if (text.includes(cwd) && (hit === null || cwd.length > hit.length)) hit = cwd
        }
      }
      const row = landing(hit, state_)
      landingCalls.push({ cwd: hit, row })
      return row
    },
    async gradeFinding (state_ = {}) {
      gradeCalls.push(state_)
      return gradeCalls.length === 1 ? 'blocking' : 'minor'
    },
    async readNote () { return null },
    async readAmendment () { return null },
    async readSupervisor () { return null },
  }

  // ── the fake `sh` ───────────────────────────────────────────────────────
  const sh = (...callArgs) => {
    const argv = argvOf(callArgs)
    const text = argv.join(' ')
    const cwd = cwdOf(callArgs)
    if (text.includes('fold_wave')) {
      const patchAt = argv.indexOf('--patch')
      const taskHeadAt = argv.indexOf('--task-head')
      const spec = patchAt >= 0 ? argv[patchAt + 1] : (taskHeadAt >= 0 ? argv[taskHeadAt + 1] : '')
      const verb = argv.includes('materialize') ? 'materialize' : (argv.includes('fold') ? 'fold' : 'kernel')
      kernelCalls.push({ seq: journal.length, verb, taskId: String(spec || '').split('=')[0] || null, argv })
      journal.push({ kind: 'kernel', verb, taskId: String(spec || '').split('=')[0] || null })
      return REAL.sh(...callArgs)
    }
    if (text.includes('pytest')) {
      const code = examExit(cwd)
      journal.push({ kind: 'pytest', cwd, code })
      return exitThrough(callArgs, code)
    }
    return REAL.sh(...callArgs)
  }

  const args = mkArgs({
    plan: PLAN_PATH,
    target: target.dir,
    base: target.base,
    'run-dir': runDir,
    model: 'claude-sonnet-5',
    'referee-model': 'claude-opus-5',
  })

  const answer = await withTimeout(
    Promise.resolve().then(() => runEngine(args, { worker, judge, sh, git: REAL.git, tools: null })),
    label,
  )

  return {
    answer,
    target,
    runDir,
    events: readEvents(runDir),
    journal,
    workerCalls,
    kernelCalls,
    gradeCalls,
    taskCalls,
    landingCalls,
    implCwds,
    state,
  }
}

const rowsOf = (events, kind) => events.filter((e) => e && e.kind === kind)
const landingFor = (events, id) => rowsOf(events, 'landing').filter((r) => String(r.task) === String(id))

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] one whole run over the fixture plan
// ══════════════════════════════════════════════════════════════════════════

const A = await drive({ label: 'leg (a): one runEngine over the fixture plan' })

assert.ok(A.answer && typeof A.answer === 'object' && !Array.isArray(A.answer),
  '(a) [M1] `runEngine(args, deps)` resolves an object. Got: ' + JSON.stringify(A.answer))
assert.deepStrictEqual(Object.keys(A.answer).sort(),
  ['adopted', 'cost_usd', 'done', 'head', 'wall_ms'],
  '(a) [M1] the resolved object\'s keys are EXACTLY `done`, `adopted`, `head`, `wall_ms`, `cost_usd`. Got: ' +
  JSON.stringify(Object.keys(A.answer).sort()))
assert.equal(A.answer.done, true,
  '(a) [M1] `done` is true when every task is adopted. Got: ' + JSON.stringify(A.answer.done))
assert.deepStrictEqual(sorted(A.answer.adopted), sorted(TASK_IDS),
  '(a) [M1] `adopted` contains every task id of the compiled plan (' + JSON.stringify(sorted(TASK_IDS)) +
  '). Got: ' + JSON.stringify(A.answer.adopted))
assert.equal(A.answer.head, headOf(A.target.dir),
  '(a) [M1] `head` equals the repository\'s `HEAD` after the run. Got: ' + JSON.stringify(A.answer.head) +
  ' against ' + JSON.stringify(headOf(A.target.dir)))
assert.equal(typeof A.answer.wall_ms, 'number',
  '(a) [M1] `wall_ms` is a number. Got: ' + JSON.stringify(A.answer.wall_ms))
assert.equal(A.answer.cost_usd, 0,
  '(a) [M1] `cost_usd` is 0 — every fake `result.total_cost_usd` is 0. Got: ' + JSON.stringify(A.answer.cost_usd))

const aLandings = rowsOf(A.events, 'landing')
assert.equal(aLandings.length, TASKS.length,
  '(a) [M1] `<run-dir>/events.jsonl` holds EXACTLY one `landing` row per task (' + TASKS.length +
  '). Got ' + aLandings.length + ': ' + JSON.stringify(aLandings.map((r) => r.task)))
for (const id of TASK_IDS) {
  assert.equal(landingFor(A.events, id).length, 1,
    '(a) [M1] exactly one `landing` row for task ' + id + '. Got ' + landingFor(A.events, id).length)
}
for (const row of aLandings) {
  const where = '(a) [M1] the `landing` row for task ' + JSON.stringify(row.task) + ' '
  assert.deepStrictEqual(Object.keys(row).sort(),
    ['candidateSha', 'claim', 'coverage', 'examExit', 'k', 'kind', 'task', 'wall_ms'],
    where + 'has keys EXACTLY `kind`, `task`, `k`, `examExit`, `claim`, `coverage`, `candidateSha`, ' +
    '`wall_ms`. Got: ' + JSON.stringify(Object.keys(row).sort()))
  assert.equal(row.k, 1, where + 'carries `k` 1 — the fake `readTask` answered 1. Got: ' + JSON.stringify(row.k))
  assert.equal(row.examExit, 0, where + 'carries `examExit` 0. Got: ' + JSON.stringify(row.examExit))
  assert.equal(row.claim, 0.9, where + 'carries `claim` 0.9 — the fake `readLanding`\'s answer. Got: ' +
    JSON.stringify(row.claim))
  assert.deepStrictEqual(row.coverage, [0.9], where + 'carries `coverage` deep-equal to `[0.9]`. Got: ' +
    JSON.stringify(row.coverage))
  assert.equal(typeof row.wall_ms, 'number', where + 'carries a numeric `wall_ms`. Got: ' + JSON.stringify(row.wall_ms))
  assert.ok(typeof row.candidateSha === 'string' && IS_SHA.test(row.candidateSha),
    where + 'carries a 40-hex `candidateSha` — the kernel\'s `materialize` answer. Got: ' +
    JSON.stringify(row.candidateSha))
}
assert.equal(headOf(A.target.dir), aLandings[aLandings.length - 1].candidateSha,
  '(a) [M1] the repository\'s `HEAD` equals the LAST `landing` row\'s `candidateSha` — every landing is ' +
  'adopted with `git reset --hard`. Got: ' + headOf(A.target.dir) + ' against ' +
  aLandings[aLandings.length - 1].candidateSha)

// The second-wave task, ordered against its own `depends_on`. On this fixture
// `compile_plan.py` answers `depends_on: []` for it (the 1→2 edge lives in
// `dag_edges`/`waves`), so this reads as written and bites the moment the
// compiled plan carries a dependency — it is not silently strengthened into
// wave ordering, which M1 does not gate on.
const indexOfLanding = (id) => aLandings.findIndex((r) => String(r.task) === String(id))
for (const { id, depends_on: deps } of SECOND_WAVE) {
  const mine = indexOfLanding(id)
  assert.ok(mine >= 0, '(a) [M1] the second-wave task ' + id + ' has a `landing` row. Got none')
  for (const dep of deps) {
    assert.ok(indexOfLanding(dep) >= 0 && indexOfLanding(dep) < mine,
      '(a) [M1] the second-wave task ' + id + '\'s `landing` row comes AFTER the `landing` row of ' +
      'every task it `depends_on` (' + JSON.stringify(deps) + '); ' + dep + ' is at ' + indexOfLanding(dep) +
      ' and ' + id + ' at ' + mine)
    const implCall = A.workerCalls.find((c) => c.role === 'impl' && c.taskId === id)
    assert.ok(implCall, '(a) [M1] task ' + id + ' had an implementer call to read. Got none')
    assert.equal(implCall.markersSeen[dep], true,
      '(a) [M1] the `cwd` of the second-wave task ' + id + '\'s implementer call already held the marker ' +
      'file `' + taskOf(dep).implFiles[0] + '` its depended-on task ' + dep + ' wrote — the clone is cut at ' +
      'the CURRENT head. Got: ' + JSON.stringify(implCall.markersSeen))
  }
}

for (const task of TASKS) {
  const calls = A.workerCalls.filter((c) => c.role === 'impl' && c.taskId === task.id)
  assert.ok(calls.length >= 1,
    '(a) [M1] task ' + task.id + ' got at least one implementer dispatch. Got ' + calls.length)
  for (const call of calls) {
    assert.equal(call.examSeen, 'exam-' + task.id,
      '(a) [M1] the `cwd` of each implementer call for task ' + task.id + ' already held `' +
      task.proofTests[0] + '` with content `exam-' + task.id + '` — the exam files are copied into the ' +
      'implementer\'s clone. Got: ' + JSON.stringify(call.examSeen))
  }
}

// ══════════════════════════════════════════════════════════════════════════
// (e) [M5] the `files` of every dispatch, and no `git ` in any prompt
//
// Read off leg (a)'s run: the same dispatches, the same records.
// ══════════════════════════════════════════════════════════════════════════

const taskOne = taskOf('1')
const oneImpls = A.workerCalls.filter((c) => c.role === 'impl' && c.taskId === '1')
assert.ok(oneImpls.length >= 1,
  '(e) [M5] task `1` had an implementer dispatch to read `files` off. Got ' + oneImpls.length)
for (const call of oneImpls) {
  assert.deepStrictEqual(call.files, taskOne.implFiles,
    '(e) [M5] every implementer dispatch of task `1` passes `files` deep-equal to the task\'s Files minus ' +
    'its Proof `Test:` paths (' + JSON.stringify(taskOne.implFiles) + '). Got: ' + JSON.stringify(call.files))
}
const oneExams = A.workerCalls.filter((c) => c.role === 'exam' && c.taskId === '1')
assert.equal(oneExams.length, 1,
  '(e) [M5] task `1` got exactly one examiner dispatch. Got ' + oneExams.length)
assert.deepStrictEqual(oneExams[0].files, taskOne.proofTests,
  '(e) [M5] the examiner dispatch passes `files` deep-equal to the Proof `Test:` paths (' +
  JSON.stringify(taskOne.proofTests) + '). Got: ' + JSON.stringify(oneExams[0].files))

for (const call of A.workerCalls) {
  const at = call.prompt.indexOf('git ')
  assert.equal(at, -1,
    '(e) [M5] no worker prompt asks for a git command — the `' + call.role + '` prompt of task ' +
    JSON.stringify(call.taskId) + ' contains the string `git ` at ' + at + ': ' +
    JSON.stringify(call.prompt.slice(Math.max(0, at - 60), at + 60)))
}

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] `k` 2: two candidates, raced, scored, the best adopted
// ══════════════════════════════════════════════════════════════════════════

/** The marker whose content IS the candidate's own `cwd`, so the fake
 *  `readLanding` can tell the two candidates apart from the patch alone. */
const cwdMarker = (_task, cwd) => cwd

/** `chosen` "names" a candidate: its index, its `cwd`, that `cwd`'s basename,
 *  or a record carrying either. */
const namesCandidate = (chosen, index, cwd) => {
  if (chosen === index) return true
  if (typeof chosen === 'number') return chosen === index
  if (typeof chosen === 'string') {
    return chosen === cwd || chosen === String(index) || chosen === path.basename(cwd) ||
      chosen.includes(path.basename(cwd))
  }
  if (chosen && typeof chosen === 'object') {
    if ([chosen.index, chosen.j, chosen.candidate, chosen.n].includes(index)) return true
    if ([chosen.cwd, chosen.dir, chosen.path].includes(cwd)) return true
  }
  return false
}

/** `claim` 0.2 for the FIRST task-`1` candidate and 0.9 for the second, over
 *  `coverage` [0.5] — read off whichever candidate's `cwd` the patch carries. */
const claimByCandidate = (box) => (cwd) => {
  const list = box.cwds ? box.cwds('1') : []
  if (list.length === 2 && cwd && cwd === list[1]) return { claim: 0.9, coverage: [0.5] }
  return { claim: 0.2, coverage: [0.5] }
}

/** The two task-`1` candidates, in dispatch order, off a finished run. */
const candidatesOf = (run) => {
  const list = (run.implCwds.get('1') || []).slice()
  assert.equal(list.length, 2,
    '(b) [M2] with `readTask` answering `k: 2` for task `1`, the fake `worker` is called TWICE for task ' +
    '`1`\'s implementer role. Got ' + list.length + ': ' + JSON.stringify(list))
  assert.notEqual(list[0], list[1],
    '(b) [M2] the two task-`1` implementer calls run in DISTINCT `cwd`s — each candidate in its own clone. ' +
    'Got: ' + JSON.stringify(list))
  return list
}

// ── run 1: both exams green, the second candidate the better claim ────────
const b1box = {}
const B1 = await drive({
  label: 'leg (b) run 1: k=2 with the first candidate held until the second is dispatched',
  k: (task) => (task && task.id === '1' ? 2 : 1),
  referee: () => false,
  marker: cwdMarker,
  landing: claimByCandidate(b1box),
  gate: true,
  box: b1box,
})

assert.equal(B1.state.gateTimedOut, false,
  '(b) [M2] with the fake holding its FIRST task-`1` implementer call unresolved until the SECOND such ' +
  'call has been made, the run still completes — both candidates are dispatched CONCURRENTLY. The gate ' +
  'timed out, which is what a sequential dispatch does')
assert.equal(B1.state.gateOpened, true,
  '(b) [M2] the second task-`1` implementer call is what released the first — a concurrent dispatch. ' +
  'The gate was never opened by a second call')

const b1Cwds = candidatesOf(B1)
const b1FirstFold = B1.kernelCalls.findIndex((c) => c.verb === 'fold')
assert.ok(b1FirstFold >= 0,
  '(b) [M2] the run reached the kernel\'s `fold` through `deps.sh`. Got no `fold_wave.py fold` call')
const b1FoldSeq = B1.kernelCalls[b1FirstFold].seq
const b1ImplSeqs = B1.workerCalls.filter((c) => c.role === 'impl' && c.taskId === '1' && !c.handoff).map((c) => c.seq)
for (const seq of b1ImplSeqs) {
  assert.ok(seq < b1FoldSeq,
    '(b) [M2] both task-`1` implementer calls are made BEFORE any fold. An implementer call at ' + seq +
    ' came after the first `fold` at ' + b1FoldSeq)
}

const b1Selects = rowsOf(B1.events, 'select').filter((r) => String(r.task) === '1')
assert.equal(b1Selects.length, 1,
  '(b) [M2] `events.jsonl` holds ONE `select` row for task `1`. Got ' + b1Selects.length + ': ' +
  JSON.stringify(b1Selects))
const b1Select = b1Selects[0]
for (const key of ['kind', 'task', 'scores', 'chosen']) {
  assert.ok(Object.prototype.hasOwnProperty.call(b1Select, key),
    '(b) [M2] the `select` row is `{ kind: \'select\', task, scores, chosen }`; it has no `' + key +
    '`. Got: ' + JSON.stringify(b1Select))
}
assert.deepStrictEqual(b1Select.scores, [10.7, 11.4],
  '(b) [M2] each candidate is scored `10 × (examExit === 0) + claim + mean(coverage)`: with both exams ' +
  'green and `claim` 0.2/0.9 over `coverage` [0.5], `scores` are deep-equal to `[10.7, 11.4]` in dispatch ' +
  'order. Got: ' + JSON.stringify(b1Select.scores))
assert.ok(namesCandidate(b1Select.chosen, 1, b1Cwds[1]) && !namesCandidate(b1Select.chosen, 0, b1Cwds[0]),
  '(b) [M2] `chosen` names the SECOND candidate — the highest score is adopted. Got: ' +
  JSON.stringify(b1Select.chosen) + ' against ' + JSON.stringify(b1Cwds))
assert.equal(landingFor(B1.events, '1').length, 1,
  '(b) [M2] exactly one `landing` row for task `1` — the loser\'s clone is discarded, not folded. Got ' +
  landingFor(B1.events, '1').length)
assert.equal(fs.readFileSync(path.join(B1.target.dir, taskOne.implFiles[0]), 'utf8').trim(), b1Cwds[1],
  '(b) [M2] the adopted tree\'s marker file carries the SECOND `cwd`. Got: ' +
  JSON.stringify(fs.readFileSync(path.join(B1.target.dir, taskOne.implFiles[0]), 'utf8').trim()))

// ── run 2: the second candidate's exam is red ─────────────────────────────
const b2box = {}
const B2 = await drive({
  label: 'leg (b) run 2: k=2 with the second candidate\'s exam red',
  k: (task) => (task && task.id === '1' ? 2 : 1),
  referee: () => false,
  marker: cwdMarker,
  landing: claimByCandidate(b2box),
  examExit: (cwd) => {
    const list = b2box.cwds ? b2box.cwds('1') : []
    return list.length === 2 && cwd === list[1] ? 1 : 0
  },
  gate: true,
  box: b2box,
})
const b2Cwds = candidatesOf(B2)

const b2Selects = rowsOf(B2.events, 'select').filter((r) => String(r.task) === '1')
assert.equal(b2Selects.length, 1,
  '(b) [M2] one `select` row for task `1` in the red-exam run. Got ' + b2Selects.length)
assert.deepStrictEqual(b2Selects[0].scores, [10.7, 1.4],
  '(b) [M2] with `sh` answering exit 1 for the SECOND candidate\'s exam and 0 for the first, `scores` are ' +
  'deep-equal to `[10.7, 1.4]` — the exam is worth 10. Got: ' + JSON.stringify(b2Selects[0].scores))
assert.ok(namesCandidate(b2Selects[0].chosen, 0, b2Cwds[0]) && !namesCandidate(b2Selects[0].chosen, 1, b2Cwds[1]),
  '(b) [M2] `chosen` names the FIRST candidate. Got: ' + JSON.stringify(b2Selects[0].chosen) + ' against ' +
  JSON.stringify(b2Cwds))
assert.equal(fs.readFileSync(path.join(B2.target.dir, taskOne.implFiles[0]), 'utf8').trim(), b2Cwds[0],
  '(b) [M2] the adopted tree\'s marker file carries the FIRST `cwd`. Got: ' +
  JSON.stringify(fs.readFileSync(path.join(B2.target.dir, taskOne.implFiles[0]), 'utf8').trim()))

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] the discovery referee, and its absence
// ══════════════════════════════════════════════════════════════════════════

const C1 = await drive({
  label: 'leg (c) run 1: the discovery referee on task `1`',
  k: () => 1,
  referee: (task) => Boolean(task && task.id === '1'),
})

const c1ReadOnly = C1.workerCalls.filter((c) => c.readOnly === true)
assert.ok(c1ReadOnly.length >= 1,
  '(c) [M3] with `readTask` answering `referee: true` for task `1`, the fake `worker` records a call with ' +
  '`readOnly` true — the discovery referee is one `runWorker` with `readOnly: true`. Got none')
const c1Referee = c1ReadOnly.find((c) => c.taskId === '1') || c1ReadOnly[0]
assert.equal(c1Referee.taskId, '1',
  '(c) [M3] the `readOnly` call is the referee OF TASK `1` — the only task reading `referee` true. Got: ' +
  JSON.stringify(c1Referee.taskId))
assert.ok(c1Referee.schema !== undefined && c1Referee.schema !== null,
  '(c) [M3] the referee dispatch carries a findings schema. Got: ' + JSON.stringify(c1Referee.schema))

assert.ok(C1.gradeCalls.length >= 1,
  '(c) [M3] each of the referee\'s findings is graded by `judge.gradeFinding` — no regular expression over ' +
  'model prose. Got ' + C1.gradeCalls.length + ' calls')

const c1Handoffs = C1.workerCalls.filter((c) => c.role === 'impl' && c.taskId === '1' && c.handoff)
assert.equal(c1Handoffs.length, 1,
  '(c) [M3] a `\'blocking\'` grade sends the candidate to ONE re-dispatch of the implementer with the ' +
  'finding as `HAND-OFF:`. Got ' + c1Handoffs.length + ' implementer prompts containing `HAND-OFF:`')
assert.ok(c1Handoffs[0].seq > c1Referee.seq,
  '(c) [M3] the `HAND-OFF:` implementer call comes AFTER the referee\'s `readOnly` call. Got seq ' +
  c1Handoffs[0].seq + ' against ' + c1Referee.seq)
const c1TaskOneKernel = C1.kernelCalls.find((c) => c.taskId === '1')
assert.ok(c1TaskOneKernel,
  '(c) [M3] task `1` reached the kernel through `deps.sh`, so the exam can order the hand-off against the ' +
  'fold. Got no kernel call naming task `1`')
assert.ok(c1Handoffs[0].seq < c1TaskOneKernel.seq,
  '(c) [M3] the `HAND-OFF:` re-dispatch happens BEFORE the fold — the referee is off the critical path but ' +
  'its blocking finding is answered first. Got hand-off at seq ' + c1Handoffs[0].seq + ' and task `1`\'s ' +
  'first kernel call at seq ' + c1TaskOneKernel.seq)
assert.equal(landingFor(C1.events, '1').length, 1,
  '(c) [M3] task `1` still lands exactly once. Got ' + landingFor(C1.events, '1').length)

const C2 = await drive({
  label: 'leg (c) run 2: no task reads `referee` true',
  k: () => 1,
  referee: () => false,
})
assert.deepStrictEqual(C2.workerCalls.filter((c) => c.readOnly === true).map((c) => c.role), [],
  '(c) [M3] with `readTask` answering `referee` false for every task, NO `worker` call has `readOnly` true ' +
  '— a referee is hired exactly when `readTask(...).referee` is true. Got: ' +
  JSON.stringify(C2.workerCalls.filter((c) => c.readOnly === true).map((c) => ({ role: c.role, task: c.taskId }))))
assert.deepStrictEqual(rowsOf(C2.events, 'referee'), [],
  '(c) [M3] and `<run-dir>/events.jsonl` carries NO row with `kind` `referee` — on the fixture plan no task ' +
  'reads `referee` true. Got: ' + JSON.stringify(rowsOf(C2.events, 'referee')))

// ══════════════════════════════════════════════════════════════════════════
// (d) [M4] `buildDeps`: the documents, the tools, the bearer
// ══════════════════════════════════════════════════════════════════════════

/** Every string value reachable in `value` within `depth` levels — how this
 *  exam reads "a `judge` CONSTRUCTED WITH `questionsPath` …" off the answer
 *  `buildDeps` gives, without picking the field name for the implementer. */
const stringsIn = (value, depth = 4, seen = new Set()) => {
  if (depth < 0 || value === null || value === undefined) return []
  if (typeof value === 'string') return [value]
  if (typeof value !== 'object') return []
  if (seen.has(value)) return []
  seen.add(value)
  const out = []
  for (const v of Object.values(value)) out.push(...stringsIn(v, depth - 1, seen))
  return out
}

const plainDeps = buildDeps(mkArgs({ plan: PLAN_PATH, model: 'claude-sonnet-5' }))
assert.equal(plainDeps.tools, null,
  '(d) [M4] `buildDeps` WITHOUT `--kata-url` answers `tools` null — `factory/tools.mjs` is reached only ' +
  'when a kata url is given. Got: ' + JSON.stringify(plainDeps.tools))
assert.ok(plainDeps.judge && typeof plainDeps.judge === 'object',
  '(d) [M4] `buildDeps` answers a `judge`. Got: ' + JSON.stringify(typeof plainDeps.judge))
for (const reader of ['readTask', 'readLanding', 'gradeFinding', 'readNote', 'readAmendment', 'readSupervisor']) {
  assert.equal(typeof plainDeps.judge[reader], 'function',
    '(d) [M4] the `judge` `buildDeps` answers is `factory/judge.mjs`\'s — it carries `' + reader +
    '`. Got ' + JSON.stringify(typeof plainDeps.judge[reader]))
}
assert.equal(typeof plainDeps.worker, 'function',
  '(d) [M4] `buildDeps` answers a `worker` from `factory/worker.mjs`. Got ' + JSON.stringify(typeof plainDeps.worker))

const depsStrings = stringsIn(plainDeps)
const questionsPath = depsStrings.find((s) => s.endsWith(path.join('factory', 'questions.json')) || s.endsWith('factory/questions.json'))
const policyPath = depsStrings.find((s) => s.endsWith(path.join('factory', 'policy.json')) || s.endsWith('factory/policy.json'))
assert.ok(typeof questionsPath === 'string',
  '(d) [M4] the `judge` is constructed with a `questionsPath` ENDING `factory/questions.json`, and the ' +
  '`deps` `buildDeps` answers carries it. Got none among: ' + JSON.stringify(depsStrings.slice(0, 20)))
assert.ok(typeof policyPath === 'string',
  '(d) [M4] the `judge` is constructed with a `policyPath` ENDING `factory/policy.json`, and the `deps` ' +
  '`buildDeps` answers carries it. Got none among: ' + JSON.stringify(depsStrings.slice(0, 20)))
assert.ok(fs.existsSync(questionsPath),
  '(d) [M4] that `questionsPath` is a real path — `factory/questions.json` is the one question file. Got: ' +
  JSON.stringify(questionsPath))
assert.ok(fs.existsSync(policyPath),
  '(d) [M4] that `policyPath` is a real path — `factory/policy.json` is the one threshold file. Got: ' +
  JSON.stringify(policyPath))

const kataDeps = buildDeps(mkArgs({
  plan: PLAN_PATH,
  'kata-url': 'http://h',
  'kata-actor': 'a',
  'kata-project': 'p',
}))
assert.equal(typeof kataDeps.tools, 'function',
  '(d) [M4] `buildDeps` WITH `--kata-url http://h --kata-actor a --kata-project p` answers a `tools` that ' +
  'is a function. Got ' + JSON.stringify(typeof kataDeps.tools))

// ── the bearer, read off the request the judge actually forwards ──────────
const headerOf = (init, name) => {
  const headers = (init && init.headers) || {}
  if (typeof headers.get === 'function') return headers.get(name)
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === name) return value
  }
  return undefined
}

process.env.TYPESAFE_API_KEY = 'k'
const keyedDeps = buildDeps(mkArgs({ plan: PLAN_PATH }))
FETCH.calls.length = 0
await keyedDeps.judge.readTask({ title: 'The widget constructor', body: 'body' })
assert.equal(FETCH.calls.length, 1,
  '(d) [M4] the `judge` `buildDeps` answers is wired to `makeJevClient` at `$TYPESAFE_BASE_URL` through a ' +
  '`fetchImpl` that forwards — one `readTask` forwarded exactly one request. Got ' + FETCH.calls.length)
assert.equal(headerOf(FETCH.calls[0].init, 'authorization'), 'Bearer k',
  '(d) [M4] with `TYPESAFE_API_KEY` set to `k`, the `fetchImpl` `buildDeps` hands the Jev client adds an ' +
  '`authorization` header equal to `Bearer k` to the request it forwards. Got: ' +
  JSON.stringify(headerOf(FETCH.calls[0].init, 'authorization')))

delete process.env.TYPESAFE_API_KEY
const bareDeps = buildDeps(mkArgs({ plan: PLAN_PATH }))
FETCH.calls.length = 0
await bareDeps.judge.readTask({ title: 'The widget constructor', body: 'body' })
assert.equal(FETCH.calls.length, 1,
  '(d) [M4] with `TYPESAFE_API_KEY` unset the client still forwards its one request. Got ' + FETCH.calls.length)
assert.equal(headerOf(FETCH.calls[0].init, 'authorization'), undefined,
  '(d) [M4] with `TYPESAFE_API_KEY` unset the `fetchImpl` adds NO `authorization` header — the edge injects ' +
  'the bearer. Got: ' + JSON.stringify(headerOf(FETCH.calls[0].init, 'authorization')))

// ══════════════════════════════════════════════════════════════════════════
// (f) [M6] the line count
// ══════════════════════════════════════════════════════════════════════════

const engineSource = fs.readFileSync(ENGINE_PATH, 'utf8')
/** `wc -l`'s own semantics: the number of newline characters in the file —
 *  the count the Proof's `Run:` line compares against 1500. */
const lineCount = (engineSource.match(/\n/g) || []).length
assert.ok(lineCount <= 1500,
  '(f) [M6] `factory/engine.mjs` is 1,500 lines or fewer — the Proof\'s ' +
  '`test $(wc -l < factory/engine.mjs) -le 1500`. Got ' + lineCount + ' lines')

for (const dir of SCRATCH) fs.rmSync(dir, { recursive: true, force: true })

console.log('ALL TESTS PASSED')

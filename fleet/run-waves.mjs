// fleet/run-waves.mjs — the driver's shared substrate: clones at BASE, the
// label→cwd routing, the driver-owned patch capture, and the run's event log.
// (Until 0.3.0 this file also loaded skills/ultrapowers/harnesses/waves.js as
// the engine program; the Amendment 10 engine, fleet/run-engine.mjs, IS the
// program now, and the loader lives only in git history.)

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
// Explicit, like every other fleet module (run-worker, tokens, shim-main):
// the bare `crypto` global only exists on Node ≥19, and a sandbox on an older
// LTS would die with a ReferenceError at the first event append.
import { webcrypto } from 'node:crypto'

// (The waves.js loader — runWaves/loadWavesSource/defaultWavesPath — lived
// here until 0.3.0. The Amendment 10 engine, fleet/run-engine.mjs, IS the
// program now; git history holds the loader and the Function-body transform.)

// ── clones at BASE — the #314 cure (#401 work item 2) ────────────────────────
//
// `isolation: 'worktree'` appears at exactly two of the ten call sites
// (waves.js:1107 implementer, :1265 fix). The Workflow runtime honoured it by
// cutting a worktree FROM THE SESSION CHECKOUT, and waves.js:1116 names that as
// #314's cause in its own words:
//
//     "engine worktrees are cut by the runtime (isolation: 'worktree'), not by
//      this script, so the assert that HEAD equals BASE before any work can
//      only run inside the worktree"
//
// The driver cuts them itself, at BASE, before the wave starts. That is not a
// FIX for #314 — it makes the defect INEXPRESSIBLE, because there is no longer
// a step at which a worktree could be cut from anywhere else. #354 closes as
// moot for the same reason.
//
// The engine's drift guard (:1116-1140, comparing the implementer's reported
// startHead against the dispatched BASE) STAYS. It is now a check on a thing
// that cannot happen, which is exactly what a guard on an inexpressible defect
// should look like — and it is the signal the #314 eval record counts, so
// deleting it would delete the evidence that the cure worked. It goes when the
// guard-deletion rule (§8) has a measured number to license it, not before.
//
// A clone rather than a worktree — and, since Amendment 9 (2026-08-29), that
// choice is FREE and settled, not a design question. This paragraph used to
// argue clones on isolation grounds (N worktrees are N writers to one .git)
// and never asked what the isolation cost: a clone's refs are invisible to the
// integration tree, and the fold kernel then read `--branch <id>=<ref>:<sha>`
// from there, so a contended wave — the CRDT path the program exists for —
// failed outright. Isolation and CRDT merging are substitutes; every unit of
// isolation bought is width given up. The cure was not to pick the other
// substrate but to stop the kernel needing refs at all: a task leaves its
// clone as a PATCH against BASE (`patchAgainstBase` below), so no clone has
// to see another's objects and isolation's only remaining job is the one it
// should have had — a stable read-view during a task. Clone stays because it
// is already written and tested; a worktree would do the same job.
export const DEFAULT_IDENTITY = {
  'user.name': 'fleet',
  'user.email': 'fleet@localhost',
  'commit.gpgsign': 'false',
}

export function cloneAtBase({ repo, dest, base, git = defaultGit, identity = DEFAULT_IDENTITY }) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  // --shared would put the clone back into the parent's object store; --local
  // hardlinks objects (cheap) while keeping refs and HEAD independent.
  git(['clone', '--quiet', '--no-checkout', '--local', repo, dest])
  // `git clone` does not copy LOCAL config, so a clone inherits only whatever
  // is global. The sandbox golden does set a global identity (RUNBOOK step 38)
  // — but a worker that cannot commit reports BLOCKED for a reason no reviewer
  // can act on, and that would then depend on a setup step having been run.
  // shim-main.mjs:642 already stamps identity per command rather than trusting
  // the ambient config; same posture here, once, in the clone.
  //
  // commit.gpgsign=false is not tidiness: a signing prompt in a headless worker
  // blocks forever, and the worker's deadline is the only thing that would
  // notice.
  for (const [k, v] of Object.entries(identity)) git(['config', k, v], dest)
  // Detached at BASE. Never a branch, never a fetch, never the default HEAD:
  // the whole point is that the tree is BASE and nothing else.
  git(['checkout', '--quiet', '--detach', base], dest)
  const head = git(['rev-parse', 'HEAD'], dest).trim()
  if (head !== base) {
    // Fail loudly rather than let a worker start on the wrong tree. This is the
    // condition #314 was.
    throw new Error('cloneAtBase: ' + dest + ' is at ' + head + ', not BASE ' + base)
  }
  return dest
}

function defaultGit(argv, cwd) {
  return execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

// label -> the directory that worker runs in (the `cwdFor` runWorker needs).
//
// The isolation:'worktree' sites get a clone of their task's; every other role
// runs in the integration clone, matching waves.js:232-235's grouping of which
// roles write to the integration tree. A label whose task has no clone is a
// provisioning error and fails loudly — never a silent fallback to the
// integration tree, which is the one directory a stray implementer could do
// real damage in.
export function makeCwdFor({ clonesDir, taskIdOf = defaultTaskIdOf,
                             cloneNameOf = defaultCloneNameOf }) {
  const integration = path.join(clonesDir, 'integration')
  return function cwdFor(opts) {
    if (opts.isolation !== 'worktree') return integration
    const id = taskIdOf(opts.label)
    if (!id) {
      throw new Error('cwdFor: isolation:worktree on label "' + opts.label +
        '" but no task id could be read from it')
    }
    const dir = path.join(clonesDir, cloneNameOf(opts.label, id))
    if (!fs.existsSync(dir)) {
      throw new Error('cwdFor: no clone provisioned for task ' + id + ' at ' + dir +
        ' — refusing to run an isolated worker in the integration tree')
    }
    return dir
  }
}

// The three labels that carry isolation:'worktree': `exam:<id>`, `impl:<id>`
// and `fix:<id>:<iter>` — all three belong to one task, and two of its clones.
export function defaultTaskIdOf(label) {
  const m = /^(?:exam|impl|fix):([^:]+)/.exec(String(label || ''))
  return m ? m[1] : null
}

// Which of the task's two clones a label runs in (#653). The examiner writes
// the exam in a clone of its own, cut at the same BASE; the implementer and its
// fix rounds share the task clone the patch is captured from. That separation
// IS the peer rule: the graded party never holds the exam in its tree while it
// works, so it cannot type over it, and the driver hands the bytes in itself
// once both have returned. The two clones give the two captures their two
// names, `exam-<id>.patch` and `task-<id>.patch`, so the examiner's diff can
// never overwrite the diff the fold reads.
export function defaultCloneNameOf(label, id) {
  return (/^exam:/.test(String(label || '')) ? 'exam-' : 'task-') + id
}

// ── the patch against BASE — what a worker's tree becomes (Amendment 9) ──────
//
// A task's contribution leaves its clone as CONTENT, not as a ref: the diff of
// the clone's tree against BASE, binary-safe, full-index, no rename detection.
// The kernel takes it as `fold_wave.py --patch <id>=<file>` and derives the
// task's tree from it over BASE in a temporary index — so no clone has to see
// another's objects, the merge agent's integration clone needs no fetch, and
// the worktree-vs-clone question stops mattering (it was `cloneAtBase`'s
// comment above arguing the wrong trade: isolation and CRDT merging are
// substitutes, and what this buys back is width).
//
// Captured by the DRIVER after the worker exits, never reported by the worker:
// a model-typed path is a coordinate nobody verified. `git add -A` first so an
// untracked file the worker created is in the diff (the implementer prompt
// asks for a commit, but the capture must not depend on it having happened),
// then `diff --cached` against BASE so the index — committed or merely staged
// — is what is captured. `.gitignore` applies, as it would to a commit.
//
// BASE is the sha the clone was cut at, which the driver knows from
// `cloneAtBase`; it is never read back from the clone's HEAD, which the
// worker's own commits may have moved.
// STAGED, deliberately: nothing in fleet/ calls this yet — the drive-one /
// sandbox assembly that composes it around createRunWorker is #402's declared
// remainder, and it owes BOTH halves of one obligation in the SAME change:
// wrap the agent with withPatchCapture AND set args.patchInput. The flag
// without the wrapper re-opens the model-typed-patch hole; the wrapper
// without the flag strips every driver-captured patch and loses the whole
// run to lost-coordinates. They are one decision.
//
// The driver joins capture to dispatch here: wrap the driver's `agent`
// (createRunWorker) and the patch becomes a DRIVER-derived coordinate on every
// isolated worker's reply — captured from the task's own clone after the
// worker exits, against the BASE the clone was provisioned at (never the
// clone's HEAD, which the worker's own commits may have moved; for a fix
// round the same BASE makes the capture CUMULATIVE — round 2's patch carries
// round 1's work, which is what the kernel folds). Anything the MODEL typed
// into `patch`/`branch`/`headSha` is overwritten: a model-typed path is a
// coordinate nobody verified, and waves.js only honors `patch` at all when
// args.patchInput says a driver produced it.
//
// A capture failure clears ALL THREE coordinates and attaches `captureError`:
// the reply then fails hasCoordinates and the task is downgraded to
// lost-coordinates by the engine's existing guard — honest loss, never a
// silently absent diff. Clearing only `patch` was the #418 review's sharpest
// finding: IMPLEMENTER_SCHEMA requires branch and headSha, so a real reply
// always carries model-typed values for both, and leaving them alive on a
// capture failure made a fabricated-coordinate task mergeable — worst case a
// model-echoed BASE sha folds the task as a no-op and its work silently
// vanishes on a green run.
//
// The strip of the MODEL-typed patch happens before every return, including
// the unrecognized-label one: a worktree dispatch whose label taskIdOf cannot
// read must not pass a model-typed patch through the wrapper.
export function withPatchCapture(options) {
  const { agent, clonesDir, base, patchesDir,
          git = defaultGit, taskIdOf = defaultTaskIdOf,
          cloneNameOf = defaultCloneNameOf,
          onEvent = () => {} } = options || {}
  // ONE label→directory mapping: makeCwdFor already owns it (and its
  // fail-loud missing-clone error). A second copy here is where a clone-
  // naming change would silently make the capture diff a different tree
  // than the one the worker wrote to.
  const cwdFor = makeCwdFor({ clonesDir, taskIdOf, cloneNameOf })
  // The task's Files, by label (#714). The driver supplies the lookup — the
  // engine builds the implementer's `FILES:` line from the SAME compiled
  // array — and when it supplies none, the prompt the worker was handed
  // carries that line and is read as the fallback. An empty list is not
  // "no filter": a task that names no file names no binary either, so every
  // untracked binary in its clone is outside its Files.
  const filesFor = makeFilesFor(options)
  return async (prompt, opts) => {
    const reply = await agent(prompt, opts)
    if (!reply) return reply
    // EVERY reply loses any model-typed patch, not only the isolated ones a
    // capture replaces: a reviewer or merge reply carrying `patch` is the
    // same unverified coordinate, and the engine-side prefix strip is the
    // second wall, not the first.
    delete reply.patch
    if (!opts || opts.isolation !== 'worktree') return reply
    try {
      const cwd = cwdFor(opts)
      const id = taskIdOf(opts.label)
      // `base` may be a function returning the LIVE wave base (Amendment 10
      // engine: later waves build on the adopted integration head, so their
      // diffs must be taken against it, not the original BASE). A static sha
      // keeps the original single-wave semantics unchanged.
      const baseSha = (typeof base === 'function') ? base(opts) : base
      // The capture is named after the CLONE, not the task: the examiner's diff
      // lands in `exam-<id>.patch` and never over the `task-<id>.patch` the
      // fold reads.
      const out = patchAgainstBase({ cwd, base: baseSha,
        out: path.join(patchesDir, cloneNameOf(opts.label, id) + '.patch'), git,
        files: filesFor(opts, id, prompt),
        // ONE event per capture, listing every path it dropped — not one event
        // per path: the reader of the log is asking "did this task's patch
        // lose anything, and what", and a per-path stream makes that a join.
        onDropped: (paths) => onEvent({ kind: 'capture:dropped', label: opts.label, paths }),
      })
      reply.patch = out
      reply.branch = ''                                  // detached by design; no branch exists
      reply.headSha = git(['rev-parse', 'HEAD'], cwd).trim()  // driver-derived, replacing the model-typed sha
    } catch (e) {
      reply.branch = ''
      reply.headSha = ''
      reply.captureError = String((e && e.message) || e)
      // The event log is captureError's reader: without this, a systematic
      // driver-side capture failure reads as N independent worker failures
      // (lost-coordinates each), and nothing names the common cause.
      onEvent({ kind: 'capture:error', label: opts.label, detail: reply.captureError })
    }
    return reply
  }
}

// ── the untracked binaries no task named (#714) ──────────────────────────────
//
// `git add -A` stages the WHOLE tree, which is what makes the capture
// independent of the worker having committed — and, on a clone where the
// implementer ran the project's tests, also stages every `__pycache__/*.pyc`
// pytest left behind. Nineteen of them on the run-7 fixture, in four clones at
// once, named by no task's Files: the fold then had four tasks writing the
// same binary path and the wave was contended on bytes nobody wrote on
// purpose. A `.gitignore` on the target is the operator's workaround; the fix
// is capture-side, because the capture is the only place that knows both the
// task's Files and what BASE tracked.
//
// Three conditions, all required, none of them a heuristic about names:
//   - UNTRACKED AT BASE — `git ls-tree` at the task's base sha, never the
//     clone's index, which `git add -A` has just filled with everything;
//   - BINARY BY GIT'S OWN DETECTION — `--numstat` reports `-` for both counts,
//     the same test the patch's own `GIT binary patch` hunk is chosen by;
//   - OUTSIDE THE TASK'S FILES — the compiled `files` array, the same one the
//     engine's `FILES:` line is built from.
// A text file no task named still rides (it is reviewable, and the reviewers'
// scope rule is what judges it); a binary the task DID name still rides.
const normalizePath = (p) => String(p == null ? '' : p).replace(/^\.\/+/, '').replace(/^\/+/, '')

// An exact-path allow list, with a trailing `/` reading as "this directory" —
// a Files entry is a path, but a plan that scopes a task to `assets/` should
// not have its own assets dropped.
export function makeFilesAllow(files) {
  const list = (Array.isArray(files) ? files : []).map(normalizePath).filter(Boolean)
  const exact = new Set(list)
  const dirs = list.filter((f) => f.endsWith('/'))
  return (p) => exact.has(p) || dirs.some((d) => p.startsWith(d))
}

export function droppedBinaryPaths({ cwd, base, files, git = defaultGit }) {
  const allowed = makeFilesAllow(files)
  // -z so a path with a space or a non-ASCII byte arrives raw rather than
  // C-quoted; --no-renames so every row is `added\tdeleted\tpath`.
  const rows = git(['diff', '--cached', '--numstat', '-z', '--no-renames', base], cwd)
    .split('\0').filter(Boolean)
  const candidates = []
  for (const row of rows) {
    const m = /^(\S+)\t(\S+)\t([\s\S]*)$/.exec(row)
    if (!m || m[1] !== '-' || m[2] !== '-') continue
    const p = normalizePath(m[3])
    if (p && !allowed(p)) candidates.push(p)
  }
  if (candidates.length === 0) return []
  // Only now the tree read: a capture with no unnamed binary in it pays for no
  // second git call.
  const tracked = new Set(git(['ls-tree', '-r', '--name-only', '-z', base], cwd)
    .split('\0').filter(Boolean).map(normalizePath))
  return candidates.filter((p) => !tracked.has(p)).sort()
}

// `--output` writes the patch from git's own process: the bytes never pass
// through Node, so there is no maxBuffer to overflow (execFileSync's 1 MiB
// default threw ENOBUFS on a ~4 MB diff, reproduced in review) and no utf8
// decode to mangle non-UTF-8 text hunks into U+FFFD before the kernel sees
// them. `out` is resolved first — git would otherwise write relative to cwd,
// the clone.
//
// `files` absent (null) is the whole-tree capture this function has always
// been — the drop arms only for a caller that knows the task's Files, so a
// direct call with none keeps every byte of the clone.
export function patchAgainstBase({ cwd, base, out, git = defaultGit,
                                   files = null, onDropped = null }) {
  fs.mkdirSync(path.dirname(out), { recursive: true })
  git(['add', '-A'], cwd)
  const dropped = files == null ? [] : droppedBinaryPaths({ cwd, base, files, git })
  // The exclusion is a PATHSPEC, not an index edit: the capture stays
  // read-only on the clone (`git rm --cached` would leave the next fix round's
  // `add -A` diffing a tree the worker never saw). `top` makes each path
  // root-relative whatever cwd is; `literal` stops a `*` or `[` in a path from
  // being read as a glob.
  const exclude = dropped.length
    ? ['--', ':(top)', ...dropped.map((p) => ':(exclude,literal,top)' + p)]
    : []
  git(['diff', '--cached', '--binary', '--full-index', '--no-renames',
       '--output=' + path.resolve(out), base, ...exclude], cwd)
  if (dropped.length && onDropped) onDropped(dropped)
  return out
}

// The task's Files reach the capture BY LABEL: `withPatchCapture` is built
// once, before the engine runs, so it cannot hold one task's list. The driver
// (run-main) passes a lookup; this reads whichever shape it was given —
// a function of the dispatch, of the label, or of the task id, or a plain
// map keyed by either, or one flat array when every capture shares a scope —
// and falls back to the `FILES:` line of the prompt the worker was actually
// handed, which the engine builds from the same compiled array.
const FILES_KEYS = ['filesFor', 'filesOf', 'filesForLabel', 'filesForTask',
                    'taskFilesOf', 'taskFiles', 'files']

// A lookup that does not RECOGNIZE what it was handed answers `[]`, and `[]` is
// also how a task that names no file answers — the same value for "I don't know
// this dispatch" and "this task's scope is empty". They cannot be told apart at
// the call, so the resolution never lets an empty answer end the search: every
// shape and every argument is tried, the first NON-EMPTY list wins, and `[]` is
// returned only once nothing else produced a scope. Reading a label-taking
// lookup's `[]` (from being called with the dispatch object, whose taskIdOf is
// null) as "this task names nothing" is what dropped a FILES-named binary.
function makeFilesFor(options) {
  const specs = FILES_KEYS.map((k) => options && options[k]).filter((v) => v != null)
  // Returns the first non-empty list this spec yields for any of the arguments
  // the Context allows it to be a function of; `[]` when it answered but
  // answered empty; null when it did not answer at all.
  const fromSpec = (spec, opts, id) => {
    if (Array.isArray(spec)) return spec
    let sawEmpty = false
    const take = (v) => {
      if (!Array.isArray(v)) return null
      if (v.length) return v
      sawEmpty = true
      return null
    }
    if (typeof spec === 'function') {
      // Label and id first: a lookup of the dispatch reads `.label` off it and
      // still answers, while a lookup of the label handed the dispatch object
      // stringifies it to "[object Object]" and answers empty.
      for (const arg of [opts && opts.label, id, opts]) {
        let v
        try { v = spec(arg) } catch { v = null }
        const hit = take(v)
        if (hit) return hit
      }
      return sawEmpty ? [] : null
    }
    if (spec instanceof Map) {
      for (const k of [opts && opts.label, id]) {
        const hit = take(spec.get(k))
        if (hit) return hit
      }
      return sawEmpty ? [] : null
    }
    if (typeof spec === 'object') {
      for (const k of [opts && opts.label, id]) {
        const hit = take(k == null ? null : spec[k])
        if (hit) return hit
      }
    }
    return sawEmpty ? [] : null
  }
  return (opts, id, prompt) => {
    let sawEmpty = false
    for (const spec of specs) {
      const v = fromSpec(spec, opts, id)
      if (v && v.length) return v
      if (v) sawEmpty = true
    }
    // The dispatch may carry the task's scope itself — run-engine puts the same
    // compiled array on the worktree dispatch it builds the `FILES:` line from.
    if (Array.isArray(opts && opts.files) && opts.files.length) return opts.files
    if (Array.isArray(opts && opts.files)) sawEmpty = true
    // Last, the `FILES:` line of the prompt the worker was actually handed.
    const fromPrompt = filesFromPrompt(prompt)
    if (fromPrompt.length) return fromPrompt
    // Nobody named anything: an empty scope, which is not "no filter" — a task
    // that names no file names no binary either.
    return sawEmpty ? [] : fromPrompt
  }
}

// The engine's own `FILES: a, b, c` line (run-engine.mjs `filesLine`), read
// back off the prompt. Not a second parse of the plan — it is the very text
// the implementer was told to stay inside.
export function filesFromPrompt(prompt) {
  const m = /^FILES:[ \t]*(.+)$/m.exec(String(prompt == null ? '' : prompt))
  if (!m) return []
  return m[1].split(',').map((s) => s.trim().replace(/^`|`$/g, '')).filter(Boolean)
}

// ── the run's event log — the record, written while it happens (#414 P1) ─────
//
// One append-only JSONL per run: worker envelopes (run-worker's onEvent
// stream), engine log lines and phases, opened by a lineage record. This is
// the Experience Compiler map's Raw Layer probe (#415): the receipt an
// operator reads and the record a sense pass ingests should be RENDERINGS of
// this file, not parallel artifacts someone assembles afterwards.
//
// Design rules, and where they come from:
// - append-only, write-once rows; events are a grow-only SET (the row axis of
//   fleet/store.mjs's discipline — never a register, nothing here is ever
//   overwritten);
// - ids are ULID-shaped (ms timestamp in Crockford base32 + randomness), so
//   rows sort by time and never collide — the id shape Julian's ledger uses;
// - the first record carries lineage (runId, base, engine source), the
//   Julian lesson applied: `parentRunId` is NOT here because no reader for it
//   exists yet — "a version marker gets designed WITH its reader, not before";
// - this module only APPENDS. The reader is ultralearn's sense pass (#415),
//   and the file's whole contract is: replaying it is reading the run.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const b32 = (n, len) => {
  let s = ''
  for (let i = 0; i < len; i++) { s = B32[n % 32] + s; n = Math.floor(n / 32) }
  return s
}
// Monotonic within the process, even against a clock that steps BACKWARDS
// (NTP on a freshly provisioned sandbox): a now at-or-behind the last one
// reuses the last timestamp and bumps the 4-char sequence between it and the
// randomness, so the log's order is readable off the ids alone — no reader
// has to trust line order, and worker:end can never sort before worker:start.
let _ulidLastTs = -1, _ulidSeq = 0
export function ulid(now = Date.now()) {
  if (now <= _ulidLastTs) { _ulidSeq += 1 } else { _ulidLastTs = now; _ulidSeq = 0 }
  return b32(_ulidLastTs, 10) + b32(_ulidSeq, 4) +
    Array.from(webcrypto.getRandomValues(new Uint8Array(12)), (b) => B32[b % 32]).join('')
}

export function makeEventLog({ file, runId, base, source = 'fleet/run-waves.mjs' }) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  // ONE stamp site: id and ts come from the same Date.now(), so they can only
  // diverge when the monotonic clamp fires (a backwards clock step) — and then
  // deliberately: the id stays the sort key, ts stays the wall clock. The stamp
  // spreads LAST: an envelope carrying its own `id`/`ts` must not clobber the
  // ULID, or the readers-order-by-id contract breaks silently.
  const append = (e) => {
    const ts = Date.now()
    fs.appendFileSync(file, JSON.stringify({ ...e, id: ulid(ts), ts }) + '\n')
  }
  append({ kind: 'run:open', runId, base, source })
  return {
    // run-worker's onEvent sink: worker:start/end/refused, run:fatal — the
    // envelope vocabulary, recorded verbatim with an id and a clock.
    onEvent: append,
    // The engine's own narration, one event per line. waves.js log() lines are
    // prose, but they are the engine's ONLY self-report of judgment calls,
    // fallbacks and wave boundaries at the moment they happen.
    log: (line) => append({ kind: 'engine:log', line: String(line) }),
    phase: (name) => append({ kind: 'engine:phase', phase: String(name) }),
  }
}

// fleet/run-waves.mjs — the six injected globals, in one place (#401 step 2).
//
// `waves.js` is a function of six globals: agent, parallel, phase, log, args,
// budget. Step 1 built the only interesting one (`fleet/run-worker.mjs`). This
// supplies the other five and executes the program — the driver's half of the
// seam.
//
// WHY THIS FILE EXISTS AT ALL, given the sims already ran waves.js: because
// they each built the globals THEMSELVES, three times, and slightly
// differently — sim_workflow allowed overrides and left `budget` undefined,
// sim_base_ancestry and sim_derived_heads passed a live-looking budget object.
// A loader nobody shares is a loader nothing tests. Now there is one, the sims
// import it, and what they exercise is the wiring the driver actually ships.
//
// SUITE-GATE NOTE. `run_acceptance.sh:108` selects which sims to run by
// `grep -q 'harnesses/'` over `tests/*.mjs`. Before this change each sim matched
// via its own `new URL('../skills/ultrapowers/harnesses/waves.js')`; now that
// reference lives HERE, and the sims match only through the prose comment that
// names the path. The gate is still armed, but a comment tidy-up in a sim would
// now silently disarm it. When the harness moves (stage 4), fix the selector to
// key on something real rather than restoring a comment.
//
// WHAT IS NOT HERE, deliberately. #401's third work item — move waves.js into
// fleet/ and turn its baked prompt strings into roles/*.md — is not done. It is
// mechanical, but it would gut `tests/test_no_prompt_drift.py`'s pin and the
// suite-gate's harness leg in the same change that builds the replacement,
// against spec §10 stage 2: *until the first self-hosted run passes, the old
// path is untouched and remains the fallback.* So the driver READS waves.js
// where it already lives. The move belongs to stage 4, with the deletion.

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// The engine's own concurrency cap is inside waves.js (CONCURRENCY = 16, its
// chunking constant). The MEASURED wave width for a real sandbox is 8 (#398),
// and that bound belongs to the driver's scheduler, not to `parallel` — this
// function runs exactly the thunks it is handed, as the Workflow runtime's did.
export const defaultParallel = (thunks) => Promise.all(thunks.map((t) => t()))

// waves.js ships as an ES module with `export const meta`, and is executed as a
// function body — the same transform the Workflow engine applies and the sims
// have always applied. Kept as one exported function so there is one answer to
// "how is the program loaded", not three.
export function loadWavesSource(wavesPath) {
  return fs.readFileSync(wavesPath, 'utf8').replace('export const meta', 'const meta')
}

// Resolved from THIS file's location, never the caller's: where waves.js sits
// is a fact about the repository layout, and a caller-relative default silently
// resolves to a different (missing) path for every caller in a different
// directory. Anywhere the layout differs — a sandbox, a provisioned run — the
// caller passes `wavesPath` explicitly.
export function defaultWavesPath() {
  return fileURLToPath(new URL('../skills/ultrapowers/harnesses/waves.js', import.meta.url))
}

// Execute the program. `agent` is the only global the caller must supply: the
// driver passes createRunWorker(...), the sims pass a stub, and that difference
// IS the seam.
//
// `budget` defaults to undefined and should stay that way. It was the Workflow
// runtime's object; the per-run token cap is deleted (#400, Amendment 4), and
// waves.js:1839 already reads `typeof budget === 'undefined'` as "not
// exhausted", so every budget checkpoint becomes a no-op with no edit to
// waves.js. Passing a live-looking budget object here would quietly re-arm a
// subsystem the design deleted.
export function runWaves({
  agent,
  args,
  parallel = defaultParallel,
  phase = () => {},
  log = () => {},
  budget = undefined,
  source,
  wavesPath,
}) {
  const src = source !== undefined ? source : loadWavesSource(wavesPath || defaultWavesPath())
  const factory = new Function(
    'agent', 'parallel', 'phase', 'log', 'args', 'budget',
    '"use strict"; return (async () => {\n' + src + '\n})();'
  )
  return factory(agent, parallel, phase, log, args, budget)
}

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
// The two isolation:'worktree' sites get their task's own clone; every other
// role runs in the integration clone, matching waves.js:232-235's grouping of
// which roles write to the integration tree. A label whose task has no clone is
// a provisioning error and fails loudly — never a silent fallback to the
// integration tree, which is the one directory a stray implementer could do
// real damage in.
export function makeCwdFor({ clonesDir, taskIdOf = defaultTaskIdOf }) {
  const integration = path.join(clonesDir, 'integration')
  return function cwdFor(opts) {
    if (opts.isolation !== 'worktree') return integration
    const id = taskIdOf(opts.label)
    if (!id) {
      throw new Error('cwdFor: isolation:worktree on label "' + opts.label +
        '" but no task id could be read from it')
    }
    const dir = path.join(clonesDir, 'task-' + id)
    if (!fs.existsSync(dir)) {
      throw new Error('cwdFor: no clone provisioned for task ' + id + ' at ' + dir +
        ' — refusing to run an isolated worker in the integration tree')
    }
    return dir
  }
}

// The only two labels that carry isolation:'worktree': `impl:<id>` and
// `fix:<id>:<iter>`.
export function defaultTaskIdOf(label) {
  const m = /^(?:impl|fix):([^:]+)/.exec(String(label || ''))
  return m ? m[1] : null
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
// `--output` writes the patch from git's own process: the bytes never pass
// through Node, so there is no maxBuffer to overflow (execFileSync's 1 MiB
// default threw ENOBUFS on a ~4 MB diff, reproduced in review) and no utf8
// decode to mangle non-UTF-8 text hunks into U+FFFD before the kernel sees
// them. `out` is resolved first — git would otherwise write relative to cwd,
// the clone.
export function patchAgainstBase({ cwd, base, out, git = defaultGit }) {
  fs.mkdirSync(path.dirname(out), { recursive: true })
  git(['add', '-A'], cwd)
  git(['diff', '--cached', '--binary', '--full-index', '--no-renames',
       '--output=' + path.resolve(out), base], cwd)
  return out
}

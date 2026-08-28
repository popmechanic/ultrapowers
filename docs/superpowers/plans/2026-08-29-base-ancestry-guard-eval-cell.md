# Base-Ancestry Provisioning Guard + Eval Cell Implementation Plan (#314, absorbs #315)

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a task worktree provisioned at a ref other than the run's `BASE` a mechanically recorded, self-correcting event (#314) — with the `git stash` ban (#315) in the same prompt edit — and measure the guard in a real-git sim so the operator can read a mechanical verdict.

**Architecture:** The workflow script has no shell and does not provision worktrees — the runtime cuts them (`isolation: 'worktree'`, `waves.js` `runTaskInner`), so the only mechanical levers are the implementer's structured-output schema, the engine's post-reply bookkeeping, and the dispatched prompt. The guard is therefore: (1) the implementer schema REQUIRES a new `startHead` field — the sha of `git rev-parse HEAD` as the implementer's first command, before any reset — so no reply can omit it; (2) the engine compares `startHead` to the dispatched `BASE` and, on mismatch, records `baseCorrected: { from, to }` on the task's report entry plus an `autonomy` judgment call; (3) the prompt's anchor step becomes mandatory-first with the exact reset recipe and the stash ban. The predicate is **exact equality `HEAD == BASE`**, not `merge-base --is-ancestor BASE HEAD`: on the #314 shape (origin/main newer than BASE, BASE cut from main) BASE *is* an ancestor of the stale ref, so the ancestor test passes silently — proven in the sim. A new real-git sim reproduces both drift directions (newer ref, older ref), asserts zero trips on a correct base, and times the assert; an eval record transcribes the numbers.

**Tech Stack:** Node ESM sims (`tests/*.mjs`, real `git` in a per-process `mkdtemp`), the baked-prompt re-bake procedure (`references/workflow-template.md`), pytest pins.

**Spec:** Issue #314 (defect + proposal; consolidated #315 stash ban) — no separate spec doc; this plan's **Design decisions** section below is the argued design.

**Acceptance:** suite — the committed suite plus per-task review is the verification; the new sim joins the suite via `tests/test_js_specs.py` and the harness suite-gate discovers it by its `harnesses/` reference. No sealed exam.

**Bar (the operator's mechanical verdict at integration — not a task):** the eval record shows (a) the guard trips on the reproduced condition — one `baseCorrected` per task in the stale wave, in BOTH drift directions; (b) zero false trips — `baseCorrected: null` on every task cut from the correct base, and the pre-existing harness sims pass unchanged; (c) the assert's wall-clock cost per worktree stated as a mean over n=20, for both the reset path and the check-only path.

## Global Constraints

- The implementer prompt and implementer schema change lives in `skills/ultrapowers/references/reviewer-prompts.md` (the source) AND is baked word-for-word into `skills/ultrapowers/harnesses/waves.js`; `python3 -m pytest tests/test_no_prompt_drift.py` is green. Never edit only the baked copy.
- Every `tasks[]` field the harness emits is documented in `skills/ultrapowers/references/report-format.md` (schema block AND field-reference table).
- Files touched by this plan are ONLY: `skills/ultrapowers/harnesses/waves.js`, `skills/ultrapowers/harnesses/waves.harness.json`, `skills/ultrapowers/references/reviewer-prompts.md`, `skills/ultrapowers/references/report-format.md`, `tests/sim_base_ancestry.mjs`, `tests/test_js_specs.py`, `evals/frontier/results/2026-08-29-base-ancestry-guard.md`. Never touch `skills/ultrapowers/scripts/compile_plan.py`, `tests/test_compile_plan.py`, `evals/check_renders_ab.py`, `skills/ultraplan/`, `fleet/`, or the frozen verification periphery (a concurrent plan owns the compiler and `evals/` scripts).
- `tests/sim_base_ancestry.mjs` prints the exact line `ALL SCENARIOS PASSED` on success and exits non-zero on any failed assertion; it references the literal path fragment `harnesses/` (the suite-gate's discovery grep); all on-disk state lives under one `fs.mkdtempSync` directory unique to the process and is removed at exit.
- No `anthropic` SDK, no `ANTHROPIC_API_KEY`, no Anthropic API call anywhere.
- `python3 -m pytest` green on the integrated tree.

---

### Task 1: The guard — required `startHead`, engine-derived `baseCorrected`, mandatory-first anchor + stash ban (re-baked)

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Modify: `skills/ultrapowers/references/report-format.md`
- Modify: `skills/ultrapowers/harnesses/waves.harness.json`
- Test: `tests/test_no_prompt_drift.py`

**Interfaces:**
- Consumes: nothing.
- Produces: implementer reply schema field `startHead: string` (required, alongside `status/summary/branch/headSha`); report field `tasks[].baseCorrected: null | { from: string, to: string }` on every task entry that received an implementer reply; judgment-call string `task <id>: worktree provisioned at <from>, not BASE <to> — reset to BASE before any work (#314)` on every correction; judgment-call string `task <id>: implementer reported no startHead — BASE anchoring unverified (#314)` when a reply omits it; implementer-prompt literals `report the printed sha verbatim as startHead in your JSON result` and `Never run git stash in an engine worktree`.

Why this shape: `waves.js` cannot run git (the script has no shell — `references/workflow-template.md` "What the script is"), and task worktrees are cut by the runtime, not by the script (`runTaskInner` dispatches with `isolation: 'worktree'`). So the assert must execute inside the worktree as the implementer's first command, and the engine can only make it *mechanical* by (a) refusing a reply without the pre-reset sha (schema `required`), and (b) deriving the correction itself from that sha — never trusting a model-typed "I reset" claim. The predicate is exact equality: on the #314 shape `git merge-base --is-ancestor BASE <stale>` is TRUE (BASE is an ancestor of the newer origin/main), so only `HEAD == BASE` catches it.

- [ ] **Step 1: Edit the prompt source.** In `skills/ultrapowers/references/reviewer-prompts.md`, inside the `<!-- BAKE:IMPLEMENTER_PROMPT -->` block, replace the whole line that begins `1. Anchor to BASE first:` with exactly:

```markdown
1. Anchor to BASE first, before any other command: run `git rev-parse HEAD` and report the printed sha verbatim as `startHead` in your JSON result; if it differs from `BASE`, run `git reset --hard <BASE>` and confirm `git rev-parse HEAD` now equals `BASE` before anything else — engine worktrees are cut from the session checkout, not from `BASE`, so a mismatch is expected whenever the repository holds commits newer than the run base (#314), and building on the wrong parent reintroduces other tasks' changes and forces merge conflicts. Never run `git stash` in an engine worktree: stash refs are repository-global and race the implementers running beside you — read an earlier state with `git show <sha>:<path>` or `git diff <sha> -- <path>` instead.
```

- [ ] **Step 2: Edit the schema source.** In the same file, replace the whole `<!-- BAKE:IMPLEMENTER_SCHEMA -->` … `<!-- /BAKE -->` block so its fenced content is exactly:

````markdown
<!-- BAKE:IMPLEMENTER_SCHEMA -->
```
{
  type: 'object',
  required: ['status', 'summary', 'branch', 'headSha', 'startHead'],
  properties: {
    status: { enum: ['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED'] },
    summary: { type: 'string' },
    concerns: { type: 'array', items: { type: 'string' } },
    branch: { type: 'string' },
    headSha: { type: 'string' },
    startHead: { type: 'string' },
  },
}
```
<!-- /BAKE -->
````

Then, directly after the existing paragraph that begins `` `headSha` is required for every status ``, add this paragraph:

```markdown
`startHead` is likewise required for every status: the sha `git rev-parse HEAD` printed as the implementer's FIRST command, before any reset. The engine compares it to the dispatched `BASE` and, when they differ, records `baseCorrected: { from: startHead, to: BASE }` on the task's report entry plus an `autonomy` judgment call (#314) — the provisioning-drift signal `evals/frontier/results/2026-08-29-base-ancestry-guard.md` counts. A fix-round reply carries `startHead` too (same schema) but the engine does not compare it: a fix round's `BASE` is the prior implementation HEAD, so a reset there is by design.
```

- [ ] **Step 3: Run the drift pin — it must be RED now.**

Run: `python3 -m pytest tests/test_no_prompt_drift.py -q`
Expected: FAIL on `test_block_is_baked_into_workflow[IMPLEMENTER_PROMPT]` and `test_schema_block_is_baked[IMPLEMENTER_SCHEMA]` (source edited, bake not yet refreshed).

- [ ] **Step 4: Re-bake the prompt line into `waves.js`.** In `skills/ultrapowers/harnesses/waves.js`, inside the `IMPLEMENTER_PROMPT` array (the `// BAKE:IMPLEMENTER_PROMPT` block), replace the whole array element that begins `"1. Anchor to BASE first:` with exactly:

```js
  "1. Anchor to BASE first, before any other command: run git rev-parse HEAD and report the printed sha verbatim as startHead in your JSON result; if it differs from BASE, run git reset --hard <BASE> and confirm git rev-parse HEAD now equals BASE before anything else — engine worktrees are cut from the session checkout, not from BASE, so a mismatch is expected whenever the repository holds commits newer than the run base (#314), and building on the wrong parent reintroduces other tasks' changes and forces merge conflicts. Never run git stash in an engine worktree: stash refs are repository-global and race the implementers running beside you — read an earlier state with git show <sha>:<path> or git diff <sha> -- <path> instead.",
```

- [ ] **Step 5: Re-bake the schema into `waves.js`.** Replace the whole `const IMPLEMENTER_SCHEMA = { … }` literal (under `// ── Baked schemas (source: references/reviewer-prompts.md)`) with exactly:

```js
const IMPLEMENTER_SCHEMA = {
  type: 'object',
  required: ['status', 'summary', 'branch', 'headSha', 'startHead'],
  properties: {
    status: { enum: ['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED'] },
    summary: { type: 'string' },
    concerns: { type: 'array', items: { type: 'string' } },
    branch: { type: 'string' },
    headSha: { type: 'string' },
    startHead: { type: 'string' },
  },
}
```

- [ ] **Step 6: Derive `baseCorrected` in `runTaskInner`.** In `waves.js`, inside `async function runTaskInner(task, baseSha, siblings, tierOverride)`, find the first `noteConcerns(impl)` call (the one immediately after `if (impl === null) throw new Error('AGENT_NULL: implementer agent returned null …')`) and insert this block directly AFTER that `noteConcerns(impl)` line:

```js
  // #314: the provisioning-drift guard. Engine worktrees are cut by the runtime
  // (isolation: 'worktree'), not by this script, so the assert that HEAD equals
  // BASE before any work can only run inside the worktree — the prompt's step 1
  // orders it and the schema REQUIRES the pre-reset sha back as startHead. The
  // engine derives the correction here (never model-typed): a startHead that
  // differs from the dispatched BASE means the worktree was provisioned off
  // BASE and the implementer reset to it. Exact equality, not ancestry — on the
  // #314 shape BASE is an ancestor of the stale ref, so an ancestor test passes
  // silently. Recorded on the task entry and as an autonomy judgment call — the
  // signal the #314 eval record counts. An absent startHead is engine-bypass
  // class (the schema requires it): the anchor is unverified, and says so.
  // Fix-round replies are not compared: their BASE is the prior implementation
  // HEAD, so a reset there is by design.
  let baseCorrected = null
  if (typeof impl.startHead === 'string' && impl.startHead.trim()) {
    if (impl.startHead.trim() !== baseSha) {
      baseCorrected = { from: impl.startHead.trim(), to: baseSha }
      judgmentCalls.push('task ' + task.id + ': worktree provisioned at ' + baseCorrected.from +
        ', not BASE ' + baseSha + ' — reset to BASE before any work (#314)')
      log('task ' + task.id + ': provisioned off BASE — corrected (#314)')
    }
  } else {
    judgmentCalls.push('task ' + task.id + ': implementer reported no startHead — BASE anchoring unverified (#314)')
  }
```

- [ ] **Step 7: Carry `baseCorrected` on every task entry `runTaskInner` returns.** There are exactly six `return { task: task.id, …` literals in `runTaskInner` after the block you just inserted. In each, insert `baseCorrected,` immediately after `task: task.id,`. The six resulting first lines are, in file order:

```js
    return { task: task.id, baseCorrected, status: 'failed', branch: impl.branch,
             reviewVerdict: 'lost-coordinates',
```
```js
    return { task: task.id, baseCorrected, status: 'failed', branch: impl.branch,
             reviewVerdict: 'not-reviewed', notes: impl.summary,
```
```js
      return { task: task.id, baseCorrected, status: 'done', branch: impl.branch,
               headSha: impl.headSha, reviewVerdict: iter === 1 ? 'clean' : 'fixed',
```
```js
      return { task: task.id, baseCorrected, status: 'failed', branch: impl.branch,
               reviewVerdict: 'fix-loop-exhausted', notes: blocking.map((b) => b.detail).join('; '),
```
```js
      return { task: task.id, baseCorrected, status: 'failed', branch: impl.branch,
               reviewVerdict: 'lost-coordinates',
               notes: 'fix round reported done without mergeable coordinates — downgraded to failed before review',
```
```js
      return { task: task.id, baseCorrected, status: 'failed', branch: impl.branch,
               reviewVerdict: 'blocked-after-fix', notes: impl.summary,
```

The `runTask` wrapper's own two returns (`parked-infra` and the post-retry `agent-error`) and the barrier-retry `agent-error` literal in the wave loop are NOT changed: no implementer reply was received there, so the field is absent by design (documented in Step 8).

- [ ] **Step 8: Document the field.** In `skills/ultrapowers/references/report-format.md`:

(a) In the JSON schema block, inside `"tasks"` → `"items"` → `"properties"`, after `"fixIterations": {"type":"integer"}` add:

```json
"baseCorrected": { "oneOf": [{"type":"null"}, {"type":"object", "required":["from","to"], "properties": {"from":{"type":"string"}, "to":{"type":"string"}}}] }
```

(b) In the field-reference table, directly after the `tasks[].fixIterations` row, add this row:

```markdown
| `tasks[].baseCorrected` | no | The #314 provisioning-drift record. `null` when the implementer's reported `startHead` (its pre-work `git rev-parse HEAD`, a required implementer-schema field) equalled the dispatched `BASE`; `{ from, to }` when it differed and the implementer reset to `BASE` (`from` = the sha the worktree was provisioned at, `to` = `BASE`); absent when no implementer reply was received (`agent-error`, infra-park). Engine-derived, never model-typed; the predicate is exact equality, not ancestry. Every correction also pushes an `autonomy` judgment call naming both shas; a reply with no `startHead` (engine-bypass class — the schema requires it) pushes a `degradation` call `BASE anchoring unverified` instead. Fix-round replies are not compared: their `BASE` is the prior implementation HEAD by design. |
```

(c) In the `judgmentCalls` row, inside the **autonomy** parenthetical list, append `, worktree provisioned off BASE and reset before work (#314)`; inside the **degradation** parenthetical list, append `, startHead not reported so BASE anchoring unverified (#314)`.

- [ ] **Step 9: Bump the harness manifest version** (the convention `references/workflow-template.md` records for a harness code change): in `skills/ultrapowers/harnesses/waves.harness.json` change `"version": "0.0.13"` to `"version": "0.0.14"`.

- [ ] **Step 10: Run the pins — all GREEN.**

Run: `python3 -m pytest tests/test_no_prompt_drift.py tests/test_canary.py tests/test_report_runbook.py tests/test_harness_registry.py tests/test_js_specs.py -q`
Expected: PASS. (`test_js_specs.py` runs `sim_workflow.mjs` and `wave_ancestry_sim.mjs` against the changed harness — their stub implementers report no `startHead`, which exercises the `unverified` branch; nothing there asserts on judgment-call counts.) Also run the two remaining harness sims by hand: `node tests/sim_derived_heads.mjs && node tests/frontier_merge.mjs` → both print `ALL SCENARIOS PASSED`.

- [ ] **Step 11: Commit.**

```bash
git add skills/ultrapowers/references/reviewer-prompts.md skills/ultrapowers/harnesses/waves.js skills/ultrapowers/references/report-format.md skills/ultrapowers/harnesses/waves.harness.json
git commit -m "engine: base-ancestry provisioning guard — required startHead, engine-derived baseCorrected, mandatory-first anchor + stash ban (#314, #315)"
```

### Task 2: The real-git sim fixture — provisioning recipe, both drift directions, timing loop

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `tests/sim_base_ancestry.mjs`
- Modify: `tests/test_js_specs.py`
- Test: `tests/sim_base_ancestry.mjs`

**Interfaces:**
- Consumes: nothing (real `git` on PATH; `skills/ultrapowers/harnesses/waves.js` is loaded as source text exactly as `tests/wave_ancestry_sim.mjs` does).
- Produces: module-level helpers in `tests/sim_base_ancestry.mjs` — `git(cwd, ...args): string`, `makeRepo(): { tmp, target, base1, base2, newer, older }`, `provision(repo, cutRef): { dir, branch }`, `anchorToBase(dir, base): { startHead, reset: boolean }`, `isAncestor(repo, a, b): boolean`, `runWorkflow({ agent, args }): Promise<report>`, `cleanup()`; scenario functions `scenarioRecipeNewer`, `scenarioRecipeOlder`, `scenarioRecipeClean`, `scenarioTiming`; an `// ── ENGINE SCENARIOS (append zone) ──` comment block where Task 3 adds its functions, and a run list ending in `cleanup()` then `console.log('ALL SCENARIOS PASSED')`.

**Parallelization rationale:** the git fixture — bare origin, target clone, integration branch, a newer origin/main after fetch, an older main behind an advanced integration branch, worktree provisioning, the anchor recipe, and the timing loop — is the bulk of the sim and depends on nothing in the engine; a good engineer builds and proves the recipe on real git first regardless of parallelism. Task 3 then drives the real harness through it.

The fixture reproduces #314 literally: `origin` has commits newer than `BASE`, the target checkout has fetched them, and provisioning cuts from the wrong ref. It also builds the second drift direction (integration branch advanced past main — the wave-2 shape) so both are measured.

- [ ] **Step 1: Write the sim** at `tests/sim_base_ancestry.mjs`:

```js
// tests/sim_base_ancestry.mjs
//
// Behavioral sim for the #314 base-ancestry provisioning guard, on REAL git.
// Like sim_workflow.mjs this runs the real orchestrator body from
// skills/ultrapowers/harnesses/waves.js with stubbed engine globals — but its
// implementer stub provisions a real worktree in a temp repository (as the
// runtime's isolation: 'worktree' does), runs the anchor recipe the prompt
// prescribes, commits, and reports the pre-reset sha as startHead.
//
// The fixture is the #314 condition: origin holds commits newer than BASE, the
// target checkout has fetched them, and provisioning cuts from that stale ref.
// A second shape (integration branch advanced past main) covers the other
// drift direction. Both must trip; a correct base must never trip.
//
// NOT run by the suite-gate unless harness JS changed; tests/test_js_specs.py
// runs it under pytest. Run manually:  node tests/sim_base_ancestry.mjs
// Self-asserting: throws (exit 1) on any failed expectation.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const WF_URL = new URL('../skills/ultrapowers/harnesses/waves.js', import.meta.url)
const SRC = fs.readFileSync(WF_URL, 'utf8').replace('export const meta', 'const meta')

export function runWorkflow({ agent, args }) {
  const parallel = (thunks) => Promise.all(thunks.map((t) => t()))
  const phase = () => {}
  const log = () => {}
  const budget = { total: null, spent: () => 0, remaining: () => Infinity }
  const factory = new Function(
    'agent', 'parallel', 'phase', 'log', 'args', 'budget',
    '"use strict"; return (async () => {\n' + SRC + '\n})();'
  )
  return factory(agent, parallel, phase, log, args, budget)
}

function assert(cond, msg) {
  if (!cond) throw new Error('SIM ASSERT FAILED: ' + msg)
}
function eq(a, b, msg) {
  assert(JSON.stringify(a) === JSON.stringify(b), msg + ' (got ' + JSON.stringify(a) + ')')
}

// Identity/hook flags on every call so the sim never reads the host's git
// config; no shell — execFile only.
const GIT_ID = ['-c', 'user.email=sim@example.com', '-c', 'user.name=sim',
  '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null']
export const git = (cwd, ...args) =>
  execFileSync('git', [...GIT_ID, ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

// One temp root per process (concurrency-safe alongside same-wave suites);
// every repo, worktree and run dir lives under it and cleanup() removes it.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-base-ancestry-'))
export const cleanup = () => fs.rmSync(TMP, { recursive: true, force: true })

const commitFile = (repo, name, content, msg) => {
  fs.writeFileSync(path.join(repo, name), content)
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', msg)
  return git(repo, 'rev-parse', 'HEAD')
}

// The #314 fixture.
//   base1  — c0 on main; the integration branch (wave-1 BASE) is cut here.
//   newer  — origin/main after two "nightly" commits pushed from elsewhere and
//            FETCHED into the target (the stale ref #314 provisioned from).
//            base1 IS an ancestor of newer: an is-ancestor predicate passes.
//   base2  — the integration branch one commit ahead of main (the wave-2
//            shape: a merge landed); `older` = main (c0), behind base2.
export function makeRepo() {
  const origin = path.join(TMP, 'origin.git')
  const target = path.join(TMP, 'target')
  const upstream = path.join(TMP, 'upstream')
  git(TMP, 'init', '-q', '--bare', '-b', 'main', origin)
  git(TMP, 'clone', '-q', origin, target)
  git(target, 'checkout', '-q', '-b', 'main')
  const base1 = commitFile(target, 'README.md', 'c0\n', 'c0')
  git(target, 'push', '-q', '-u', 'origin', 'main')
  git(target, 'branch', 'ultra/integration-sim', base1)
  // wave-2 shape: the integration branch advances (a merged wave), main does not
  git(target, 'checkout', '-q', 'ultra/integration-sim')
  const base2 = commitFile(target, 'integration-1.txt', 'merged wave 1\n', 'integration 1')
  git(target, 'checkout', '-q', 'main')
  // #314 shape: origin advances past base1; the target FETCHES it
  git(TMP, 'clone', '-q', origin, upstream)
  commitFile(upstream, 'nightly-1.txt', 'n1\n', 'nightly 1')
  commitFile(upstream, 'nightly-2.txt', 'n2\n', 'nightly 2')
  git(upstream, 'push', '-q', 'origin', 'main')
  git(target, 'fetch', '-q', 'origin')
  const newer = git(target, 'rev-parse', 'origin/main')
  return { tmp: TMP, target, base1, base2, newer, older: base1 }
}

export const isAncestor = (repo, a, b) => {
  try { git(repo, 'merge-base', '--is-ancestor', a, b); return true } catch (e) { return false }
}

// What the runtime's isolation: 'worktree' does — a fresh worktree on its own
// engine-named branch, cut from whatever ref the runtime happens to hold.
let provisioned = 0
export function provision(repo, cutRef) {
  provisioned += 1
  const branch = 'worktree-wf_sim-' + provisioned
  const dir = path.join(TMP, 'wt-' + provisioned)
  git(repo, 'worktree', 'add', '-q', '-b', branch, dir, cutRef)
  return { dir, branch }
}

// The recipe the implementer prompt prescribes as its FIRST command sequence:
// rev-parse HEAD (that sha is startHead), reset --hard BASE on mismatch,
// re-confirm. Asserts the post-condition every time.
export let resets = 0
export function anchorToBase(dir, base) {
  const startHead = git(dir, 'rev-parse', 'HEAD')
  let reset = false
  if (startHead !== base) {
    git(dir, 'reset', '-q', '--hard', base)
    reset = true
    resets += 1
  }
  eq(git(dir, 'rev-parse', 'HEAD'), base, 'anchorToBase: HEAD equals BASE after the recipe')
  return { startHead, reset }
}

const REPO = makeRepo()

// ── Scenario 1: #314 literal — cut from the NEWER fetched ref ─────────────────
async function scenarioRecipeNewer() {
  const { target, base1, newer } = REPO
  assert(newer !== base1, 'fixture: origin/main advanced past BASE')
  // The predicate finding: BASE is an ancestor of the stale ref, so
  // `merge-base --is-ancestor BASE HEAD` would PASS on the #314 shape.
  eq(isAncestor(target, base1, newer), true, 'fixture: BASE is an ancestor of the newer ref (ancestor test is blind here)')
  const { dir } = provision(target, newer)
  eq(git(dir, 'rev-parse', 'HEAD'), newer, 'provisioned worktree sits at the stale ref')
  const r = anchorToBase(dir, base1)
  eq(r, { startHead: newer, reset: true }, 'recipe: reported the stale sha and reset')
  eq(git(dir, 'rev-parse', 'HEAD'), base1, 'recipe: worktree now at BASE')
  assert(!fs.existsSync(path.join(dir, 'nightly-1.txt')), 'recipe: stale commits gone from the tree')
  console.log('scenario recipe-newer: OK')
}

// ── Scenario 2: the other direction — cut from a ref BEHIND BASE ──────────────
async function scenarioRecipeOlder() {
  const { target, base2, older } = REPO
  eq(isAncestor(target, base2, older), false, 'fixture: BASE is not an ancestor of the older ref')
  const { dir } = provision(target, older)
  const r = anchorToBase(dir, base2)
  eq(r, { startHead: older, reset: true }, 'recipe: reported the older sha and reset forward')
  eq(git(dir, 'rev-parse', 'HEAD'), base2, 'recipe: worktree now at BASE')
  assert(fs.existsSync(path.join(dir, 'integration-1.txt')), 'recipe: the merged wave is present')
  console.log('scenario recipe-older: OK')
}

// ── Scenario 3: correct base — the recipe is a no-op ─────────────────────────
async function scenarioRecipeClean() {
  const { target, base1 } = REPO
  const before = resets
  const { dir } = provision(target, base1)
  const r = anchorToBase(dir, base1)
  eq(r, { startHead: base1, reset: false }, 'recipe: no reset on a correct base')
  eq(resets - before, 0, 'recipe: zero resets on a correct base')
  console.log('scenario recipe-clean: OK')
}

// ── Scenario 4: cost of the assert per worktree ───────────────────────────────
const N = 20
function timeAnchor(cutRef, base) {
  const { target } = REPO
  let total = 0n
  for (let i = 0; i < N; i++) {
    const { dir } = provision(target, cutRef)
    const t0 = process.hrtime.bigint()
    anchorToBase(dir, base)
    total += process.hrtime.bigint() - t0
  }
  return Number(total) / 1e6 / N
}
async function scenarioTiming() {
  const { base1, newer } = REPO
  const stale = timeAnchor(newer, base1)
  const clean = timeAnchor(base1, base1)
  assert(Number.isFinite(stale) && stale > 0, 'timing: stale-path mean is a positive number')
  assert(Number.isFinite(clean) && clean > 0, 'timing: clean-path mean is a positive number')
  console.log('TIMING anchor-to-base stale (rev-parse + reset --hard + confirm): mean ' + stale.toFixed(1) + ' ms over n=' + N)
  console.log('TIMING anchor-to-base clean (rev-parse + confirm): mean ' + clean.toFixed(1) + ' ms over n=' + N)
  console.log('scenario timing: OK')
}

// ── ENGINE SCENARIOS (append zone) ────────────────────────────────────────────
// Scenarios that drive the real harness body through runWorkflow() with a
// git-backed implementer stub are added here.

const RUN = [
  scenarioRecipeNewer,
  scenarioRecipeOlder,
  scenarioRecipeClean,
  scenarioTiming,
  // engine scenarios append here
]
try {
  for (const s of RUN) await s()
} finally {
  cleanup()
}
console.log('ALL SCENARIOS PASSED')
```

- [ ] **Step 2: Run it — GREEN.**

Run: `node tests/sim_base_ancestry.mjs`
Expected: four `scenario …: OK` lines, two `TIMING …` lines, then `ALL SCENARIOS PASSED`; exit 0. Then `ls "$TMPDIR" | grep ultra-base-ancestry` prints nothing (cleanup ran).

- [ ] **Step 3: Register it in the pytest runner.** In `tests/test_js_specs.py`, append to the `SPECS` list, after the `("sim_workflow.mjs", "ALL SCENARIOS PASSED"),` entry:

```python
    ("sim_base_ancestry.mjs", "ALL SCENARIOS PASSED"),
```

Run: `python3 -m pytest tests/test_js_specs.py -q` → PASS (7 specs).

- [ ] **Step 4: Commit.**

```bash
git add tests/sim_base_ancestry.mjs tests/test_js_specs.py
git commit -m "test: real-git base-ancestry sim — #314 fixture, both drift directions, recipe timing"
```

### Task 3: Drive the real harness through the fixture — trips, zero false trips, schema + prompt pins

**Type:** implementation
**Depends-on:** 1, 2

**Files:**
- Modify: `tests/sim_base_ancestry.mjs`
- Test: `tests/sim_base_ancestry.mjs`

**Interfaces:**
- Consumes: `runWorkflow`, `git`, `makeRepo`'s `REPO` (`target`, `base1`, `base2`, `newer`, `older`), `provision`, `anchorToBase`, `resets` (from Task 2); report field `tasks[].baseCorrected`, the two `#314` judgment-call strings, schema field `startHead`, and the implementer-prompt literals (from Task 1).
- Produces: printed summary line `TRIPS newer=<n> older=<n> clean=<n> missing=<n>` (the counts the eval record transcribes); scenario functions `scenarioEngineNewer`, `scenarioEngineOlder`, `scenarioEngineClean`, `scenarioEngineMissingStartHead`, `scenarioPromptAndSchemaPins`.

The engine side of the guard is what #314 asks for: not each implementer independently noticing, but the run recording every correction from a required field. These scenarios prove the record is engine-derived from real shas on real worktrees, in both drift directions, and is silent on a correct base.

- [ ] **Step 1: Add the git-backed stub agent and the engine scenarios** inside the `// ── ENGINE SCENARIOS (append zone) ──` block of `tests/sim_base_ancestry.mjs` (before `const RUN = [`):

```js
const WAVES = [[
  { id: 'A', title: 'alpha', body: 'create a.txt', tier: 'standard' },
  { id: 'B', title: 'beta', body: 'create b.txt', tier: 'standard' },
  { id: 'C', title: 'gamma', body: 'create c.txt', tier: 'standard' },
]]
const INTEGRATION_BRANCH = 'ultra/integration-sim'
const launchArgs = () => ({ waves: WAVES, integrationBranch: INTEGRATION_BRANCH, stamp: 'sim',
  edges: [], testCmd: 'true', pluginRoot: '/opt/plug', runDir: path.join(TMP, 'run') })
const BASE_RE = /\nBASE: ([0-9a-f]{40})\n/
const TRIP_RE = /^task [A-Z]: worktree provisioned at [0-9a-f]{40}, not BASE [0-9a-f]{40} — reset to BASE before any work \(#314\)$/
const UNVERIFIED_RE = /^task [A-Z]: implementer reported no startHead — BASE anchoring unverified \(#314\)$/
const trips = { newer: 0, older: 0, clean: 0, missing: 0 }

// A git-backed implementer: provisions a real worktree from `cutRef` (what the
// runtime does), runs the prompt's anchor recipe, commits one file on BASE,
// and reports its coordinates plus the pre-reset sha as startHead — or omits
// startHead when `omitStartHead` is set (the engine-bypass case).
function makeAgent({ base, cutRef, omitStartHead, captured, failFirstReviewOf }) {
  const { target } = REPO
  const reviews = {}
  return async (prompt, opts) => {
    const label = opts.label || ''
    if (captured) captured[label] = { prompt, opts }
    if (label === 'setup') return { branch: INTEGRATION_BRANCH, headSha: base, baselinePassed: true }
    if (label.startsWith('impl:') || label.startsWith('fix:')) {
      const id = label.split(':')[1]
      const dispatchedBase = prompt.match(BASE_RE)[1]
      const { dir, branch } = provision(target, cutRef)
      const { startHead } = anchorToBase(dir, dispatchedBase)
      fs.writeFileSync(path.join(dir, id.toLowerCase() + '.txt'), 'work ' + label + '\n')
      git(dir, 'add', '.')
      git(dir, 'commit', '-q', '-m', 'work ' + label)
      const reply = { status: 'DONE', summary: 's', branch, headSha: git(dir, 'rev-parse', 'HEAD') }
      if (!omitStartHead) reply.startHead = startHead
      return reply
    }
    if (label.startsWith('review:')) {
      const id = label.split(':')[1]
      reviews[id] = (reviews[id] || 0) + 1
      if (failFirstReviewOf === id && reviews[id] === 1)
        return { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'missing assertion' }] }
      return { verdict: 'PASS', issues: [] }
    }
    if (label.startsWith('merge:')) return { status: 'MERGED', headSha: base }
    if (label === 'integration')
      return { testsPassed: true, output: 'ok', findings: [], onIntegrationHead: true, ancestryMisses: [] }
    throw new Error('unexpected agent label: ' + label)
  }
}

// Every task's commit must sit directly on BASE — the real-git proof that the
// work was built on the right parent after the correction.
function assertBuiltOnBase(report, base) {
  const { target } = REPO
  for (const t of report.tasks) {
    eq(t.status, 'done', 'engine: task ' + t.task + ' done')
    eq(git(target, 'rev-parse', t.headSha + '^'), base, 'engine: task ' + t.task + ' commit parent is BASE')
  }
}

async function scenarioEngineNewer() {
  const { base1, newer } = REPO
  const report = await runWorkflow({ agent: makeAgent({ base: base1, cutRef: newer }), args: launchArgs() })
  eq(report.tasks.length, 3, 'engine-newer: three task entries')
  for (const t of report.tasks)
    eq(t.baseCorrected, { from: newer, to: base1 }, 'engine-newer: task ' + t.task + ' records the correction')
  const calls = report.judgmentCalls.filter((j) => TRIP_RE.test(j))
  eq(calls.length, 3, 'engine-newer: one #314 trip call per task')
  assert(calls.every((j) => j.includes(newer) && j.includes(base1)), 'engine-newer: trip calls name both shas')
  assertBuiltOnBase(report, base1)
  trips.newer = calls.length
  console.log('scenario engine-newer: OK')
}

async function scenarioEngineOlder() {
  const { base2, older } = REPO
  const report = await runWorkflow({ agent: makeAgent({ base: base2, cutRef: older }), args: launchArgs() })
  for (const t of report.tasks)
    eq(t.baseCorrected, { from: older, to: base2 }, 'engine-older: task ' + t.task + ' records the correction')
  const calls = report.judgmentCalls.filter((j) => TRIP_RE.test(j))
  eq(calls.length, 3, 'engine-older: one #314 trip call per task')
  assertBuiltOnBase(report, base2)
  trips.older = calls.length
  console.log('scenario engine-older: OK')
}

async function scenarioEngineClean() {
  const { base1 } = REPO
  const before = resets
  const report = await runWorkflow({ agent: makeAgent({ base: base1, cutRef: base1 }), args: launchArgs() })
  for (const t of report.tasks)
    eq(t.baseCorrected, null, 'engine-clean: task ' + t.task + ' records null (no correction)')
  const calls = report.judgmentCalls.filter((j) => TRIP_RE.test(j) || UNVERIFIED_RE.test(j))
  eq(calls.length, 0, 'engine-clean: zero #314 judgment calls')
  eq(resets - before, 0, 'engine-clean: zero resets')
  assertBuiltOnBase(report, base1)
  trips.clean = calls.length
  console.log('scenario engine-clean: OK')
}

async function scenarioEngineMissingStartHead() {
  const { base1, newer } = REPO
  const report = await runWorkflow({
    agent: makeAgent({ base: base1, cutRef: newer, omitStartHead: true }), args: launchArgs() })
  for (const t of report.tasks)
    eq(t.baseCorrected, null, 'engine-missing: no startHead → null, never a fabricated correction')
  eq(report.judgmentCalls.filter((j) => TRIP_RE.test(j)).length, 0, 'engine-missing: no trip call without a startHead')
  eq(report.judgmentCalls.filter((j) => UNVERIFIED_RE.test(j)).length, 3, 'engine-missing: one unverified call per task')
  trips.missing = report.judgmentCalls.filter((j) => TRIP_RE.test(j)).length
  console.log('scenario engine-missing-starthead: OK')
}

async function scenarioPromptAndSchemaPins() {
  const { base1 } = REPO
  const captured = {}
  await runWorkflow({
    agent: makeAgent({ base: base1, cutRef: base1, captured, failFirstReviewOf: 'A' }), args: launchArgs() })
  for (const label of ['impl:A', 'fix:A:1']) {
    const d = captured[label]
    assert(d, 'pins: ' + label + ' dispatched')
    assert(d.opts.schema.required.includes('startHead'), 'pins: ' + label + ' schema requires startHead')
    eq(d.opts.schema.properties.startHead, { type: 'string' }, 'pins: ' + label + ' schema types startHead')
    for (const lit of [
      '1. Anchor to BASE first, before any other command: run git rev-parse HEAD and report the printed sha verbatim as startHead in your JSON result',
      'run git reset --hard <BASE> and confirm git rev-parse HEAD now equals BASE before anything else',
      'Never run git stash in an engine worktree',
      'git show <sha>:<path> or git diff <sha> -- <path> instead',
    ]) assert(d.prompt.includes(lit), 'pins: ' + label + ' prompt carries the literal: ' + lit)
  }
  console.log('scenario prompt-and-schema-pins: OK')
}
```

Then replace the `// engine scenarios append here` line inside `RUN` with:

```js
  scenarioEngineNewer,
  scenarioEngineOlder,
  scenarioEngineClean,
  scenarioEngineMissingStartHead,
  scenarioPromptAndSchemaPins,
  async () => console.log('TRIPS newer=' + trips.newer + ' older=' + trips.older +
    ' clean=' + trips.clean + ' missing=' + trips.missing),
```

- [ ] **Step 2: Run it — GREEN.**

Run: `node tests/sim_base_ancestry.mjs`
Expected: nine `scenario …: OK` lines, two `TIMING` lines, the line `TRIPS newer=3 older=3 clean=0 missing=0`, then `ALL SCENARIOS PASSED`. (If Task 1's harness is absent from your BASE, `engine-newer` fails at `records the correction` — that is the missing dependency, not a sim defect; report BLOCKED.)

- [ ] **Step 3: Run the full JS spec runner and the neighbors.**

Run: `python3 -m pytest tests/test_js_specs.py -q && node tests/sim_derived_heads.mjs && node tests/frontier_merge.mjs`
Expected: PASS; both sims print `ALL SCENARIOS PASSED`.

- [ ] **Step 4: Commit.**

```bash
git add tests/sim_base_ancestry.mjs
git commit -m "test: base-ancestry sim drives the real harness — trips both directions, zero false trips, startHead schema + prompt pins (#314)"
```

### Task 4: The eval record — trips, false trips, cost

**Type:** implementation
**Depends-on:** 3

**Files:**
- Create: `evals/frontier/results/2026-08-29-base-ancestry-guard.md`
- Test: `tests/sim_base_ancestry.mjs`

**Interfaces:**
- Consumes: the sim's printed `TRIPS …` and `TIMING …` lines and its `scenario …: OK` lines (from Task 3); the pre-existing harness sims `tests/sim_workflow.mjs`, `tests/wave_ancestry_sim.mjs`, `tests/sim_derived_heads.mjs`, `tests/frontier_merge.mjs`; the compile-corpus tests `tests/test_compile_plan.py`, `tests/test_fixture_seals.py`.
- Produces: nothing — a record. The `Test:` entry is the runtime evidence the record transcribes; a reviewer re-runs it and compares the numbers.

The record is the operator's read surface at integration: numbers copied verbatim from real runs on the integrated tree, never typed from memory. The verdict is the operator's, not this task's.

- [ ] **Step 1: Produce the evidence** (record every command's output; the numbers below are transcribed from THESE runs):

```bash
git rev-parse --short HEAD
node tests/sim_base_ancestry.mjs | tee /tmp/base-ancestry-sim.out
node tests/sim_workflow.mjs | tail -1
node tests/wave_ancestry_sim.mjs | tail -1
node tests/sim_derived_heads.mjs | tail -1
node tests/frontier_merge.mjs | tail -1
python3 -m pytest tests/test_compile_plan.py tests/test_fixture_seals.py tests/test_js_specs.py tests/test_no_prompt_drift.py -q | tail -3
```

- [ ] **Step 2: Write the record** at `evals/frontier/results/2026-08-29-base-ancestry-guard.md` in the house style of `evals/frontier/results/2026-08-21-phase2-mechanics.md` (engine sha, what ran, tables, then the gate readings). Required sections and content:

```markdown
# Base-ancestry provisioning guard (#314) — mechanics cell, 2026-08-29

Engine at `<short sha from git rev-parse>` (this branch's integrated tree). Instrument:
`tests/sim_base_ancestry.mjs` — real git in a temp repository, the real
orchestrator body, a git-backed implementer stub that provisions each task
worktree from a chosen ref and runs the prompt's anchor recipe. Commands run:
(paste the Step-1 command list).

## Reproduced condition

| scenario | worktree cut from | `is-ancestor BASE cut` | tasks | `baseCorrected` recorded | #314 trip calls |
|---|---|---|---|---|---|
| engine-newer (#314 literal: origin/main fetched, 2 commits past BASE) | newer ref | true | 3 | 3 | <TRIPS newer> |
| engine-older (integration branch advanced past main) | older ref | false | 3 | 3 | <TRIPS older> |

Predicate note: `git merge-base --is-ancestor BASE HEAD` is TRUE on the #314
shape (row 1), so the ancestor test proposed in the issue would have passed
silently; the shipped predicate is exact equality `HEAD == BASE`.
Every task's commit parent equalled BASE after the correction (asserted).

## False trips

| control | implementer dispatches | `baseCorrected` non-null | #314 trip calls |
|---|---|---|---|
| engine-clean (cut from BASE) | 3 | 0 | <TRIPS clean> |
| engine-missing-startHead (schema bypass) | 3 | 0 | <TRIPS missing> (3 `unverified` calls, by design) |
| pre-existing harness sims (`sim_workflow`, `wave_ancestry_sim`, `sim_derived_heads`, `frontier_merge`) | all | pass unchanged — `ALL SCENARIOS PASSED` ×4 | — |
| compile corpus control (`test_compile_plan.py`, `test_fixture_seals.py`) | — | pass unchanged (the guard is runtime-only) | — |

## Cost

<paste both TIMING lines verbatim, e.g.:>
TIMING anchor-to-base stale (rev-parse + reset --hard + confirm): mean <x> ms over n=20
TIMING anchor-to-base clean (rev-parse + confirm): mean <y> ms over n=20

Per worktree, once, before any task work; the reset path only runs when the
provisioning ref was wrong.

## Bar (plan header) and readings

- Trips on the reproduced condition, both directions: <met / not met — counts>
- Zero false trips on the clean control and the pre-existing sims: <met / not met>
- Cost stated: <the two means>

## Operator verdict

_pending — the operator reads the numbers above at integration; this record
states no verdict._
```

Replace every `<…>` with the value from Step 1's output; the `TRIPS` line must read `newer=3 older=3 clean=0 missing=0` — if it does not, the sim is red and this task is BLOCKED, not a transcription to adjust.

- [ ] **Step 3: Verify the record's shape and that its numbers are real.**

```bash
F=evals/frontier/results/2026-08-29-base-ancestry-guard.md
for h in '## Reproduced condition' '## False trips' '## Cost' '## Bar (plan header) and readings' '## Operator verdict'; do grep -qF "$h" "$F" || { echo "missing: $h"; exit 1; }; done
grep -Eq 'TIMING anchor-to-base stale .*: mean [0-9]+(\.[0-9]+)? ms over n=20' "$F" || { echo "missing stale TIMING"; exit 1; }
grep -Eq 'TIMING anchor-to-base clean .*: mean [0-9]+(\.[0-9]+)? ms over n=20' "$F" || { echo "missing clean TIMING"; exit 1; }
grep -q '<' "$F" && { echo "unfilled placeholder"; exit 1; }
node tests/sim_base_ancestry.mjs | grep -E '^TRIPS newer=3 older=3 clean=0 missing=0$' || { echo "sim TRIPS line drifted"; exit 1; }
echo RECORD OK
```

Expected: `RECORD OK`.

- [ ] **Step 4: Commit.**

```bash
git add evals/frontier/results/2026-08-29-base-ancestry-guard.md
git commit -m "evals: base-ancestry guard mechanics record — trips both directions, zero false trips, assert cost (#314)"
```

---

## Design decisions (for the operator)

1. **No script-side provisioning hook exists.** `waves.js` has no shell; worktrees are cut by the runtime (`isolation: 'worktree'`). The guard therefore lives at the three seams the architecture offers — a REQUIRED schema field (`startHead`), engine-side derivation (`baseCorrected`, never model-typed), and the prompt's first step. Issue #314 explicitly allows "or as the implementer prompt's mandatory step 0"; this plan makes that step verifiable rather than trusted. A fully out-of-model check (a `scripts/anchor_base.sh` the implementer invokes, like `review-package`) would add one file outside this plan's lane; it is the natural follow-up if a live run shows an implementer still deferring the anchor.
2. **Predicate = exact equality `HEAD == BASE`.** Proven in the sim fixture: on the #314 shape `merge-base --is-ancestor BASE <stale>` is TRUE, so the issue's first-named predicate is blind to the very case it was filed on. Equality catches both drift directions.
3. **`startHead` is `required`.** A reply without it is a StructuredOutput schema trip, which `runTask` already retries once with tier escalation. That is the forcing function; the softer alternative (optional field + judgment call only) was rejected because the prompt-only form is the thing #314 proved insufficient. The engine-bypass branch (absent field) still records `unverified` rather than a false `null`-clean.
4. **Fix rounds are not compared.** Their `BASE` is the prior implementation HEAD, so the reset is by design; comparing would count every fix round as a trip.
5. **Correction is `autonomy`-kind**, not a blocker: the run self-heals; the record exists so recurrence is countable (sense passes read `judgmentCalls`).
6. **Harness manifest version bump** follows the `workflow-template.md` convention for a harness code change; nothing pins the value.

## Execution handoff

4 implementation tasks, widest wave 2 (Tasks 1 ∥ 2 → 3 → 4), risk (engine harness + prompt/schema surface every run dispatches through) → **Ultrapowers (recommended)**.

1. **Ultrapowers (recommended)** — `/ultrapowers docs/superpowers/plans/2026-08-29-base-ancestry-guard-eval-cell.md`: parallel waves, worktree isolation, per-task review (Task 1 adversarial), one pre-merge gate.
2. **Subagent-Driven** — superpowers:subagent-driven-development, sequential, review between tasks.
3. **Inline** — superpowers:executing-plans.

## Operator smoke

- do: `node tests/sim_base_ancestry.mjs | grep -E '^(TRIPS|TIMING)'`
  see: `TRIPS newer=3 older=3 clean=0 missing=0` and two `TIMING … mean … ms over n=20` lines.
- do: on the next real `/ultrapowers` run in a repo whose `origin/main` is ahead of the run base, open `<runDir>/report.json` and search `baseCorrected`
  see: `{ "from": "<sha>", "to": "<BASE>" }` on the affected tasks and a `judgmentCalls` entry ending `reset to BASE before any work (#314)` — rendered under the gate's autonomy group, never blocking Approve.
- do: on a run whose checkout sat exactly at the run base, the same search
  see: `"baseCorrected": null` on every task and no `#314` judgment call.

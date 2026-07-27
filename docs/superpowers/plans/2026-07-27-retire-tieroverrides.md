# Retire tierOverrides (#101) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the `args.tierOverrides` channel from the engine and every documenting surface; the reviewer/completeness most-capable invariant survives as unconditional, and a legacy launch that still passes the key is silently ignored — pinned by sim.

**Architecture:** One engine-and-sims task (delete the extraction, validation, and merge in the harness; rework three sim scenarios so the mechanics gate proves the silent-ignore contract and the unconditional pin) and one scrub task across the six reference/doc/script surfaces that mention the knob. `test_no_prompt_drift.py` stays green by construction — no `<!-- BAKE -->` block mentions tierOverrides.

**Tech Stack:** JavaScript (harness + `.mjs` sim), Python 3, pytest.

**Spec:** `docs/superpowers/specs/2026-07-27-retire-tieroverrides.md`

**Acceptance:** suite — mechanics hard-gate per the subtraction doctrine: the committed pytest suite plus the harness sims (`harnesses/*.js` changes make the suite gate run them). No A/B quality cell: no observed workflow passes the knob. No seal requested.

## Global Constraints

- **The reviewer most-capable invariant survives:** reviewers and the completeness critic run at `DEFAULT_TIER.mostCapable` after the deletion, now unconditionally; no code path may make the reviewer model configurable.
- **Legacy-arg contract:** a launch passing `tierOverrides` must neither throw nor alter any model — the key is ignored like any unknown top-level args key, and a sim pins it.
- **Sim sentinel discipline:** `tests/sim_workflow.mjs` must still print `ALL SCENARIOS PASSED` on success and exit non-zero on failure.
- **`test_no_prompt_drift.py` must stay green** — the edits touch no `<!-- BAKE -->` block content in `references/reviewer-prompts.md`.
- **No changes outside** `skills/ultrapowers/harnesses/waves.js`, `tests/sim_workflow.mjs`, `skills/ultrapowers/references/reviewer-prompts.md`, `skills/ultrapowers/SKILL.md`, `skills/ultrapowers/references/workflow-template.md`, `skills/ultrapowers/references/dependency-analysis.md`, `skills/ultrapowers/scripts/ultra_run.py`, `skills/ultrapowers/scripts/audit_run.py`.
- **No Anthropic SDK / `ANTHROPIC_API_KEY`** in any shipped or dev script (CLAUDE.md).
- Suite gate: `python3 -m pytest` green from the repo root.

---

### Task 1: Engine subtraction + sim rework

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Test: `tests/sim_workflow.mjs`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: `waves.js` with no `tierOverrides` symbol — `const TIER = DEFAULT_TIER`; unknown top-level args keys (including a legacy `tierOverrides`) are ignored; `REVIEWER_MODEL` / `reviewerModelFor()` still resolve `DEFAULT_TIER.mostCapable`.

- [ ] **Step 1: Rework the sims first (they are the failing tests)**

In `tests/sim_workflow.mjs`:

**(a)** In `scenarioPortability`, replace the args block:

```js
  const args = Object.assign({}, baseArgs, {
    testCmd: 'make test',
    reviewProfile: 'adversarial',
    // cheap -> opus (distinct from the haiku default); mostCapable -> haiku to prove
    // reviewers DON'T follow the override (they must stay opus, override-proof).
    tierOverrides: { cheap: 'opus', mostCapable: 'haiku' },
  })
```

with:

```js
  const args = Object.assign({}, baseArgs, {
    testCmd: 'make test',
    reviewProfile: 'adversarial',
    // Legacy knob (#101, retired): must be silently ignored — no throw, no
    // model change — like any other unknown top-level args key.
    tierOverrides: { cheap: 'opus', mostCapable: 'haiku' },
  })
```

and replace the tier assertions:

```js
  // tierOverrides: A,B are 'cheap' -> overridden to opus; C is 'standard' -> sonnet (unchanged).
  eq(seen.implModels['A'], 'opus', 'portability: cheap tier overridden to opus (A)')
  eq(seen.implModels['B'], 'opus', 'portability: cheap tier overridden to opus (B)')
  eq(seen.implModels['C'], 'sonnet', 'portability: untouched standard tier still sonnet (C)')
  // OVERRIDE-PROOF reviewers: mostCapable was overridden to haiku, but review and
  // completeness roles must still run at opus (a weak reviewer false-PASSes).
  eq(seen.reviewModels['A'], 'opus', 'portability: reviewer stays opus despite mostCapable override (A)')
  eq(seen.reviewModels['C'], 'opus', 'portability: reviewer stays opus despite mostCapable override (C)')
  eq(seen.integrationModel, 'opus', 'portability: completeness reviewer stays opus despite mostCapable override')
```

with:

```js
  // Retired knob is IGNORED: tiers map via DEFAULT_TIER (cheap->haiku,
  // standard->sonnet) even though the legacy arg asked for opus/haiku.
  eq(seen.implModels['A'], 'haiku', 'portability: legacy tierOverrides ignored — cheap stays haiku (A)')
  eq(seen.implModels['B'], 'haiku', 'portability: legacy tierOverrides ignored — cheap stays haiku (B)')
  eq(seen.implModels['C'], 'sonnet', 'portability: standard tier still sonnet (C)')
  // Unconditional reviewers: review and completeness roles run at opus always.
  eq(seen.reviewModels['A'], 'opus', 'portability: reviewer runs at opus, unconditionally (A)')
  eq(seen.reviewModels['C'], 'opus', 'portability: reviewer runs at opus, unconditionally (C)')
  eq(seen.integrationModel, 'opus', 'portability: completeness reviewer runs at opus, unconditionally')
```

Also update the scenario's banner comment from `// ── Scenario 6: portability — testCmd / reviewProfile / tierOverrides via args ─` to `// ── Scenario 6: portability — testCmd / reviewProfile via args; legacy tierOverrides ignored ─`.

**(b)** Delete `scenarioTierOverrideInvalid` entirely (the whole function, from its `// ── Scenario: invalid tierOverrides model must fail loud at launch ─...` banner through its closing `}`), and delete its runner invocation line `await scenarioTierOverrideInvalid()`.

**(c)** Rework `scenarioReconcileTierOverride` into the override-free invariant proof. Rename the function to `scenarioReconcileTier` (update its `await scenarioReconcileTierOverride()` runner line to `await scenarioReconcileTier()`), replace its banner comment block with:

```js
// ── Scenario: reconcile tracks the implementer-side mostCapable ───────────────
// From reviewer-prompts.md: "reconcile is a fixer, not a reviewer, so it tracks
// the implementer-side mostCapable" — always DEFAULT_TIER.mostCapable (opus).
// Also asserts setup and merge:wave* follow the cheap tier (haiku), pinning the
// documented tier routing with no overrides in play (#101).
```

replace its `runWorkflow` args:

```js
    args: Object.assign({}, baseArgs, { tierOverrides: { cheap: 'sonnet', mostCapable: 'sonnet' } }),
```

with:

```js
    args: baseArgs,
```

and replace its assertions:

```js
  assert(reconcileModel !== null, 'reconcileTier: reconcile agent was actually dispatched')
  eq(reconcileModel, 'sonnet', 'reconcileTier: reconcile uses overridden mostCapable model (sonnet)')
  eq(reviewerModel, 'opus', 'reconcileTier: reviewer stays opus despite mostCapable override (OVERRIDE-PROOF)')
  // setup uses cheap tier; merge:wave* uses cheap tier — both must follow the override
  eq(modelsByLabel['setup'], 'sonnet', 'reconcileTier: setup uses overridden cheap model (sonnet)')
  const mergeWaveLabel = Object.keys(modelsByLabel).find((l) => /^merge:wave/.test(l))
  assert(mergeWaveLabel !== undefined, 'reconcileTier: a merge:wave* agent was dispatched')
  eq(modelsByLabel[mergeWaveLabel], 'sonnet', 'reconcileTier: merge:wave* uses overridden cheap model (sonnet) (label=' + mergeWaveLabel + ')')
  console.log('scenario reconcile-tier-override: OK')
```

with:

```js
  assert(reconcileModel !== null, 'reconcileTier: reconcile agent was actually dispatched')
  eq(reconcileModel, 'opus', 'reconcileTier: reconcile tracks DEFAULT_TIER.mostCapable (opus)')
  eq(reviewerModel, 'opus', 'reconcileTier: reviewer runs at opus, unconditionally')
  // setup and merge:wave* follow the cheap tier (haiku).
  eq(modelsByLabel['setup'], 'haiku', 'reconcileTier: setup uses the cheap model (haiku)')
  const mergeWaveLabel = Object.keys(modelsByLabel).find((l) => /^merge:wave/.test(l))
  assert(mergeWaveLabel !== undefined, 'reconcileTier: a merge:wave* agent was dispatched')
  eq(modelsByLabel[mergeWaveLabel], 'haiku', 'reconcileTier: merge:wave* uses the cheap model (haiku) (label=' + mergeWaveLabel + ')')
  console.log('scenario reconcile-tier: OK')
```

- [ ] **Step 2: Run the sim to verify the reworked scenarios fail against the current engine**

Run: `node tests/sim_workflow.mjs`
Expected: FAIL — `scenarioPortability` asserts `haiku` for task A but the current engine honors the override and dispatches `opus` (and the reconcile scenario asserts `opus`/`haiku` where the current engine, given plain `baseArgs`, already resolves defaults — it may pass; the portability failure is the proof that the override channel is still live).

- [ ] **Step 3: Delete the channel from the engine**

In `skills/ultrapowers/harnesses/waves.js`:

**(a)** Delete the knob comment line:

```js
// tierOverrides:  remap model tiers per project, e.g. { cheap: 'sonnet' }.
```

**(b)** Delete the extraction:

```js
const tierOverrides = (ARGS && ARGS.tierOverrides && typeof ARGS.tierOverrides === 'object') ? ARGS.tierOverrides : {}
```

**(c)** Delete the entire validation block (comment included):

```js
// Fail loud on a typo'd model alias: an invalid model makes every agent error
// without doing any work (verified live 2026-06-03), so catch it before launch.
const VALID_MODELS = ['haiku', 'sonnet', 'opus']
for (const k of Object.keys(tierOverrides)) {
  if (k !== 'cheap' && k !== 'standard' && k !== 'mostCapable') {
    throw new Error('ultrapowers: tierOverrides key "' + k +
      '" is not a tier (valid: cheap, standard, mostCapable). Refusing to launch.')
  }
  if (VALID_MODELS.indexOf(tierOverrides[k]) === -1) {
    throw new Error(
      'ultrapowers: tierOverrides.' + k + ' = "' + tierOverrides[k] +
      '" is not a valid model alias (valid: haiku, sonnet, opus). Refusing to launch.'
    )
  }
}
```

**(d)** Replace the merge:

```js
const TIER = Object.assign({}, DEFAULT_TIER, tierOverrides)
```

with:

```js
const TIER = DEFAULT_TIER
```

**(e)** Replace the `REVIEWER_MODEL` comment:

```js
// Review / completeness roles always run at the strongest model, OVERRIDE-PROOF:
// tierOverrides remap implementer tiers only — a weak reviewer's failure mode is
// the silent false PASS, so it must never be downgradable. (Reconcile is a fixer,
// not a reviewer, so it tracks the implementer-side mostCapable.)
```

with:

```js
// Review / completeness roles always run at the strongest model, unconditionally —
// a weak reviewer's failure mode is the silent false PASS, so it must never be
// downgradable. (Reconcile is a fixer, not a reviewer, so it tracks the
// implementer-side mostCapable.)
```

**(f)** Replace the `reviewerModelFor` comment:

```js
// Per-task reviewer model: uniformly most-capable, built from DEFAULT_TIER so
// tierOverrides can never weaken the gate. (The lean+cheap sonnet floor is
// deleted with the heuristics — never economize on the checker.)
```

with:

```js
// Per-task reviewer model: uniformly most-capable, unconditionally. (The
// lean+cheap sonnet floor is deleted with the heuristics — never economize on
// the checker.)
```

- [ ] **Step 4: Run the sim to green**

Run: `node tests/sim_workflow.mjs`
Expected: exit 0, final line `ALL SCENARIOS PASSED`. Also verify the symbol is gone: `grep -c tierOverrides skills/ultrapowers/harnesses/waves.js` → `0`.

- [ ] **Step 5: Run the drift pin and driver tests**

Run: `python3 -m pytest tests/test_no_prompt_drift.py tests/test_canary.py -v`
Expected: ALL PASS (no `<!-- BAKE -->` content changed).

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/harnesses/waves.js tests/sim_workflow.mjs
git commit -m "refactor: retire the tierOverrides channel; reviewer pin becomes unconditional (#101)"
```

---

### Task 2: Reference and doc scrub

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultrapowers/references/workflow-template.md`
- Modify: `skills/ultrapowers/references/dependency-analysis.md`
- Modify: `skills/ultrapowers/scripts/ultra_run.py`
- Modify: `skills/ultrapowers/scripts/audit_run.py`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: nothing sibling tasks rely on (doc/commentary scrub; `LLM_DERIVES` text keeps its `waves[][].tier` substring).

- [ ] **Step 1: reviewer-prompts.md (commentary only — no BAKE block)**

Replace:

```markdown
The reviewer always runs at the most-capable tier (`opus`), built from
`DEFAULT_TIER` so `tierOverrides` cannot weaken it — a weak reviewer's failure
mode is the silent false `PASS`, worse than no reviewer.
```

with:

```markdown
The reviewer always runs at the most-capable tier (`opus`), unconditionally —
a weak reviewer's failure mode is the silent false `PASS`, worse than no
reviewer.
```

Replace the tier-table row:

```markdown
| per-task reviewer | `opus` — uniform, no floor | override-proof; `DEFAULT_TIER`-based |
```

with:

```markdown
| per-task reviewer | `opus` — uniform, no floor | unconditional |
```

In the tier-assignment paragraph, replace:

```markdown
`tierOverrides` reaches every non-review role: setup and merge run at the overridden `cheap`, reconcile and fix-rounds at the overridden `mostCapable`. Only the reviewer and completeness-critic models are pinned to the default most-capable, override-proof.
```

with:

```markdown
Setup and merge run at `cheap`; reconcile and fix-rounds at `mostCapable`. The reviewer and completeness-critic models are always the default most-capable, unconditionally.
```

- [ ] **Step 2: SKILL.md args example**

Replace:

```markdown
args = { ...argsFile, integrationBranch: 'ultra/integration-<stamp>', stamp,
         baseBranch, testCmd?, bootstrapCmd?, reviewProfile?, tierOverrides? }
```

with:

```markdown
args = { ...argsFile, integrationBranch: 'ultra/integration-<stamp>', stamp,
         baseBranch, testCmd?, bootstrapCmd?, reviewProfile? }
```

- [ ] **Step 3: workflow-template.md**

Replace the args-shape lines:

```markdown
args = { waves, integrationBranch, stamp, dependencyEdges, edges,
         baseBranch, planPath, wavesPath?, waveLabels?, resume?, testCmd?, bootstrapCmd?,
         reviewProfile?, tierOverrides?, acceptance? }
```

with:

```markdown
args = { waves, integrationBranch, stamp, dependencyEdges, edges,
         baseBranch, planPath, wavesPath?, waveLabels?, resume?, testCmd?, bootstrapCmd?,
         reviewProfile?, acceptance? }
```

Delete the whole knob bullet:

```markdown
- `args.tierOverrides` — remap model tiers per project, e.g. `{ cheap: 'sonnet' }`. Merged over the
  default `TIER` map. The plan's `most-capable` tier name is normalized to the `mostCapable` key.
  Values are validated at launch against `haiku` / `sonnet` / `opus`; an unknown alias throws
  before any agent runs.
```

Replace the tier-mapping passage:

```markdown
`reviewer-prompts.md` names tiers `cheap` / `standard` / `most-capable`; the workflow `agent()` API
takes the Claude aliases `haiku` / `sonnet` / `opus`. The mapping lives in **one place**, the `TIER`
constant in `waves.js`, and `args.tierOverrides` is merged over it per run (per-task `most-capable` is normalized to the
`mostCapable` key and unknown *task* tiers fall back to `standard` with a judgment call; unknown
override *keys or model values* throw at launch). Reviewers and the completeness critic always run at the DEFAULT `most-capable` (`opus`), override-proof; every other role follows the override-merged map (setup/merge at `cheap`, reconcile/fix at `mostCapable`).
```

with:

```markdown
`reviewer-prompts.md` names tiers `cheap` / `standard` / `most-capable`; the workflow `agent()` API
takes the Claude aliases `haiku` / `sonnet` / `opus`. The mapping lives in **one place**, the `TIER`
constant in `waves.js` (per-task `most-capable` is normalized to the `mostCapable` key and unknown
*task* tiers fall back to `standard` with a judgment call). Reviewers and the completeness critic
always run at `most-capable` (`opus`), unconditionally; every other role follows the map
(setup/merge at `cheap`, reconcile/fix at `mostCapable`).
```

Replace the reviewer-model paragraph (also correcting its stale lean-floor claim to match the shipped `reviewerModelFor()`):

```markdown
The per-task reviewer model is `reviewerModelFor(task)`: `DEFAULT_TIER.standard`
(sonnet) for a `lean` review of a `cheap`-tier task, `DEFAULT_TIER.mostCapable`
(opus) otherwise. It is built from `DEFAULT_TIER`, not `TIER`, so `tierOverrides`
cannot weaken the gate. The completeness critic, reconcile, and fix rounds keep
opus / `TIER.mostCapable`.
```

with:

```markdown
The per-task reviewer model is `reviewerModelFor()`: uniformly
`DEFAULT_TIER.mostCapable` (opus), unconditionally. The completeness critic,
reconcile, and fix rounds keep opus / `TIER.mostCapable`.
```

- [ ] **Step 4: dependency-analysis.md example**

Delete the line:

```yaml
  tierOverrides: {}
```

- [ ] **Step 5: ultra_run.py LLM_DERIVES clause**

Replace:

```python
    "waves[][].tier on the args-file wave entries (slots pre-emitted as null; "
    "the engine reads knobs ONLY from these inline entries — never a top-level "
    "launch key, never tierOverrides, which remaps tier names to models)",
```

with:

```python
    "waves[][].tier on the args-file wave entries (slots pre-emitted as null; "
    "the engine reads knobs ONLY from these inline entries — never a "
    "top-level launch key)",
```

- [ ] **Step 6: audit_run.py docstring**

Replace:

```python
above 1.5x the median turns of SAME-MODEL peers (transcripts carry resolved
model strings, not tier names — grouping by model stays correct under
tierOverrides remapping).
```

with:

```python
above 1.5x the median turns of SAME-MODEL peers (transcripts carry resolved
model strings, not tier names — grouping by model is exact).
```

- [ ] **Step 7: Verify the scrub is total and the suite is green**

Run: `grep -rn tierOverrides skills/ tests/ docs/superpowers/plans/2026-07-27-retire-tieroverrides.md --include='*.py' --include='*.js' --include='*.md' -l | grep -v docs/superpowers`
Expected: only `tests/sim_workflow.mjs` may remain (its legacy-arg scenario deliberately passes the key); no `skills/` file appears.

Run: `python3 -m pytest tests/test_ultra_run.py tests/test_no_prompt_drift.py -v`
Expected: ALL PASS (the `waves[][].tier` substring the driver test asserts survives the reworded clause).

- [ ] **Step 8: Commit**

```bash
git add skills/ultrapowers/references/reviewer-prompts.md skills/ultrapowers/SKILL.md skills/ultrapowers/references/workflow-template.md skills/ultrapowers/references/dependency-analysis.md skills/ultrapowers/scripts/ultra_run.py skills/ultrapowers/scripts/audit_run.py
git commit -m "docs: scrub tierOverrides from every reference surface (#101)"
```

---

### Task 3: Suite gate

**Type:** gate
**Depends-on:** 1, 2

- [ ] **Step 1: Run the full committed suite**

Run: `python3 -m pytest`
Expected: all tests pass.

- [ ] **Step 2: Run the harness sim**

Run: `node tests/sim_workflow.mjs`
Expected: exit 0 and `ALL SCENARIOS PASSED` (the drain's suite gate also runs this automatically because `harnesses/*.js` changed).

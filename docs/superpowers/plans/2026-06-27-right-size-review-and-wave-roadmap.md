# Right-Size Review/Safety + Wave-Roadmap Legibility Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Acceptance:** suite — this builds ultrapowers itself; the committed pytest suite + drift pins + `validate_skill.py` + operator-read diffs are the verification. No held-out exam.

**Goal:** Right-size three over-firing review/safety mechanisms in the ultrapowers engine (adversarial-review trigger, opus reviewer floor, agent-error escalation) and make the parallel-wave roadmap legible in the live progress UI (semantic wave labels + a pre-registered roadmap).

**Architecture:** Three changes narrow *when* an existing capability fires without removing it where risk is real (orchestrator prose in `SKILL.md` + engine logic in `harnesses/waves.js`). Two changes surface the already-computed wave plan to the progress panel (a `waveLabel(w)` helper feeds the engine's phase labels + a pre-registration block). Every edit lands **outside** the `<!-- BAKE -->` prompt blocks, so no prompt re-bake is required and `test_no_prompt_drift` stays green by construction.

**Tech Stack:** Python 3 (pytest, the test gate, `pytest.ini`-scoped to `tests/`), Node.js (the `tests/sim_workflow.mjs` engine simulation, driven by `tests/test_workflow_sim.py`), the committed Dynamic Workflow `harnesses/waves.js`, and the reference markdown sources under `skills/ultrapowers/references/`.

## Global Constraints

- **Disposition is `suite`.** No sealed exam is authored. No Anthropic SDK / `ANTHROPIC_API_KEY` is added to any script (a distributed plugin must need no API key).
- **Zero re-bake.** No edit may alter any text **inside** a `<!-- BAKE:NAME -->` … `<!-- /BAKE -->` block in `references/reviewer-prompts.md` or `references/wave-merge.md`. `python3 -m pytest tests/test_no_prompt_drift.py` must stay green. (All prose edits here land *outside* the markers.)
- **Reviewer floor never drops below sonnet, never haiku.** The per-task reviewer selector is built from `DEFAULT_TIER` (NOT `TIER`), so `tierOverrides` can never weaken it. Opus (`DEFAULT_TIER.mostCapable`) stays for: every `adversarial` pass, every `standard`/`most-capable`-tier review, the completeness critic, reconcile, and fix rounds. Sonnet (`DEFAULT_TIER.standard`) applies only to a `lean` review of a `cheap`-tier task.
- **Escalation keeps containment + exactly one recovery attempt.** The `runTask` `try/catch` stays unconditional (`parallel()` is fail-fast — an uncaught throw rejects the whole wave). The single retry stays single; only *which tier* it uses changes.
- **No release in this plan.** Versioning stays `0.0.x`; this plan does **not** bump the version, push, or re-pin the marketplace. It ends green on the feature branch for the operator to merge later.
- **Keep green:** `tests/test_no_prompt_drift.py`, `tests/test_superpowers_compat.py`, `scripts/validate_skill.py`, and the existing `compile_plan` / workflow-sim tests.

---

## Decomposition note (shaping, per ultraplan)

This work concentrates in `harnesses/waves.js` and three shared markdown files, so latent parallelism is genuinely limited — and splitting the 1279-line frozen engine to dodge a file collision would fail the good-engineer gate, so it is not done. The one honest parallel pair is **Task 1 ∥ Task 2** (orchestrator prose + doc vs. the engine escalation classifier — disjoint files, no logic dependency). Everything after that serializes on `waves.js` (and the shared `tests/sim_workflow.mjs`) by necessity, sequenced with `Depends-on` rather than faked into width. One contract-first seam survives the gate: Task 4 produces a `waveLabel(w)` helper that Task 5 consumes (DRY across the meta.phases mutation, the pre-registration block, and the loop label) — recorded as a `**Parallelization rationale:**` line on Task 4.

Resulting waves: **Wave 1 = {1, 2}**, then 3 → 4 → 5 serial, Task 6 is a `gate`.

---

### Task 1: Narrow the adversarial-review trigger (orchestrator prose)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Test: `tests/test_review_trigger_prose.py`

(Locations: SKILL.md Step 2 `task.review` bullet ~L156-158; reviewer-prompts.md divergence note ~L103-109 and reviewer-tier sentence ~L111 — both OUTSIDE the `<!-- BAKE -->` blocks.)

**Interfaces:**
- Consumes: nothing
- Produces: the authored rule that the engine's `taskReviewProfile`/`reviewerModelFor` rely on downstream — a task is marked `review: 'adversarial'` only on a genuine risk/data-layer surface, never on tier alone.

- [ ] **Step 1: Write the failing prose pins**

Create `tests/test_review_trigger_prose.py`:

```python
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/ultrapowers/SKILL.md"
PROMPTS = ROOT / "skills/ultrapowers/references/reviewer-prompts.md"


def test_skill_trigger_is_risk_based_not_tier_alone():
    src = SKILL.read_text()
    # The mis-firing proxy must be gone: tier alone must not warrant adversarial.
    assert "most-capable` tasks warrant\n  `adversarial`" not in src
    assert "most-capable` tasks warrant `adversarial`" not in src
    # The narrowed trigger names concrete risk surfaces and the data-layer class.
    assert "risk surface" in src
    assert "data-layer" in src
    assert "auth" in src and "migrations" in src


def test_prompts_record_no_split_decision():
    src = PROMPTS.read_text()
    # The divergence note must record the decided end-state: keep both passes
    # full-spectrum; do NOT split into spec-only / quality-only.
    assert "full-spectrum" in src
    assert "do not split" in src.lower()
    # And must NOT still present the split as the intended restoration/upgrade.
    assert "the place to restore it (pass 1 spec-only, pass 2 quality-only)" not in src
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/test_review_trigger_prose.py -v`
Expected: FAIL (`SKILL.md` still ties adversarial to most-capable tier; `reviewer-prompts.md` still says "the place to restore it").

- [ ] **Step 3: Narrow the trigger in `SKILL.md` Step 2**

Replace the `**Per-task review depth (`task.review`)**` bullet (~L156-158) with:

```markdown
  - **Per-task review depth (`task.review`)** — mark a task `adversarial` (two
    independent review passes) only when it is on a **genuine risk surface**
    (sealed acceptance, or it touches auth / payments / migrations / public-API /
    data-integrity — read from its `Type` / `Files` / body) **OR** it is a
    **foundation / data-layer** task (owns the persistence/data layer and/or has
    downstream dependents — the class that has caught real wiring bugs). Tier alone
    never triggers it: routine `cheap`/`standard` tasks with no risk signal stay
    `lean` (one pass). This is derived from the plan, not asked.
```

- [ ] **Step 4: Record the no-split decision in `reviewer-prompts.md`**

Replace the divergence note (~L103-109) with:

```markdown
**Deliberate divergence from superpowers 5.1.0:** upstream subagent-driven-development
mandates two ORDERED review passes (spec compliance first, then code quality) and
red-flags merging them. Ultrapowers runs ONE merged spec+quality pass per fix-loop
iteration (`lean`), or two independent **full-spectrum** passes (`adversarial`) whose
findings are unioned. We deliberately **do not split** the two passes into spec-only +
quality-only: today both passes check the full spectrum, so the union gives double
coverage on every defect class; splitting them would give each class a single draw and
delete the resampling redundancy that is the mechanism's whole value (an adversarial
audit confirmed the split is a net safety regression, not the upgrade it looks like).
```

Then in the reviewer-tier sentence (~L111), change the trigger clause so it no longer says "high-stakes / `most-capable` tasks" — keep it consistent with Step 2:

```markdown
The reviewer runs at the most-capable tier (`opus`) wherever risk is real: a weak reviewer's failure mode is the silent false `PASS`, which is worse than no reviewer. Review *depth* is set **per task**: the orchestrating agent (SKILL.md Step 2) marks only genuine risk/data-layer tasks `adversarial` (two independent full-spectrum passes, findings unioned) and leaves routine tasks `lean` (one pass) — derived from the plan's risk surface, not its tier, and not asked of the human. The run-wide `reviewProfile` is just the default for tasks that don't specify their own `review`.
```

(Both edits are outside the `<!-- BAKE -->` markers — confirm by checking the changed lines sit above `<!-- BAKE:REVIEWER_PROMPT -->` at L113.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `python3 -m pytest tests/test_review_trigger_prose.py tests/test_no_prompt_drift.py -v`
Expected: PASS (trigger narrowed; no-split recorded; no BAKE block touched).

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/SKILL.md skills/ultrapowers/references/reviewer-prompts.md tests/test_review_trigger_prose.py
git commit -m "feat(skill): narrow adversarial trigger to risk/data-layer surfaces; record no-split decision"
```

---

### Task 2: Classify agent-error escalation (engine)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Modify: `tests/sim_workflow.mjs`
- Test: `tests/test_escalation_classifier.py`

(Locations in `waves.js`: add fault classifiers near `escalateTier` ~L467; guard the implementer null-return in `runTaskInner` ~L651; rewrite the `runTask` catch ~L585-606.)

**Interfaces:**
- Consumes: `escalateTier(tierName): string`, `runTaskInner(task, baseSha, siblings, tierOverride)` (existing, from `waves.js`)
- Produces: `isSchemaTrip(msg): boolean`, `looksStructural(msg): boolean` (engine-internal classifiers); the retry policy "same-tier by default, escalate only on a schema trip, never escalate an Overloaded/null fault."

- [ ] **Step 1: Write the failing behavioral scenarios in `tests/sim_workflow.mjs`**

The sim runs the whole engine with stubbed globals; a per-scenario `agent` stub records the model used on each attempt. Add a helper + scenarios that drive a single one-task wave whose implementer fails the first time. Append near the other scenarios (follow the existing `runWorkflow` / `assert` / `eq` idiom):

```javascript
// ── Fork C: agent-error escalation is classified ─────────────────────────────
async function runEscalationScenario(firstFailure) {
  const attempts = []
  const agent = async (prompt, opts) => {
    const label = opts && opts.label
    if (label === 'impl:1') {
      attempts.push(opts.model)
      if (attempts.length === 1) {
        if (firstFailure === 'null') return null            // terminal Overloaded
        throw new Error(firstFailure)                       // thrown fault
      }
      return { status: 'done', branch: 'worktree-1', headSha: 'sha-impl-1', summary: 'ok' }
    }
    if (label && label.startsWith('review:1')) return { verdict: 'approve', issues: [] }
    if (label === 'setup') return { branch: 'ultra/int', headSha: 'sha-setup', baselinePassed: true }
    if (label && label.startsWith('merge')) return { status: 'MERGED', headSha: 'sha-merge' }
    if (label === 'integration') return { verdict: 'approve', issues: [] }
    return { status: 'done', branch: 'worktree-1', headSha: 'sha-x' }
  }
  const args = {
    waves: [[{ id: '1', title: 'T1', body: 'b', tier: 'cheap', review: 'lean' }]],
    integrationBranch: 'ultra/int', stamp: 's', baseBranch: 'main', edges: [],
  }
  const report = await runWorkflow({ agent, args, budget: { total: null, spent: () => 0, remaining: () => Infinity } })
  return { attempts, report }
}

// A schema/StructuredOutput trip is capability-fixable → escalate one rung (cheap→sonnet).
{
  const { attempts } = await runEscalationScenario('StructuredOutput schema validation failed')
  eq(attempts, ['haiku', 'sonnet'], 'schema trip escalates cheap→sonnet')
}
// A generic transient throw is NOT capability-fixable → retry at the SAME tier.
{
  const { attempts } = await runEscalationScenario('socket hang up')
  eq(attempts, ['haiku', 'haiku'], 'non-schema fault retries at same tier')
}
// An Overloaded null-return must NOT blind-escalate → same tier, no top-tier burn.
{
  const { attempts } = await runEscalationScenario('null')
  eq(attempts, ['haiku', 'haiku'], 'Overloaded null retries at same tier')
}
// A structural fault is diagnosed as a likely missing Depends-on edge.
{
  const { report } = await runEscalationScenario("Cannot find module './sibling'")
  assert(report.judgmentCalls.some((j) => j.includes('missing Depends-on edge')),
    'structural fault diagnosed as missing Depends-on edge')
}
```

- [ ] **Step 2: Run the sim to verify it fails**

Run: `node tests/sim_workflow.mjs`
Expected: FAIL on `non-schema fault retries at same tier` (today every fault escalates: attempts would be `['haiku','sonnet']`).

- [ ] **Step 3: Add the fault classifiers in `waves.js`**

Immediately after `escalateTier` (after ~L471), add:

```javascript
// Classify an agent() fault so the single retry uses the right lever.
// A StructuredOutput/schema contract trip is capability-fixable — a stronger
// model is the documented win. Everything else (a transient fault, or an
// Overloaded null-return surfaced as an AGENT_NULL throw) is NOT capability-
// fixable: a more-contended top tier just re-hits the wall, so retry in place.
const isSchemaTrip = (msg) =>
  /schema|structuredoutput|did not conform|required propert|invalid (?:enum|json)/i.test(msg)
// A structural fault — an import/module that resolves to nothing — usually means
// a sibling deliverable this task depends on is absent (a missing Depends-on
// edge), which no model capability fixes. Diagnose it; do NOT fail-fast.
const looksStructural = (msg) =>
  /cannot find module|module not found|no module named|importerror|cannot import|is not defined/i.test(msg)
```

- [ ] **Step 4: Guard the implementer null-return in `runTaskInner`**

Right after `let impl = await agent(...)` (~L651, before `noteConcerns(impl)`), add:

```javascript
  // agent() RETURNS null (not throws) on terminal Overloaded/skip. Surface it as
  // a tagged throw so the single retry routes it to the SAME tier (it is not a
  // schema trip) instead of letting a null-deref blind-escalate a contention
  // failure to a more-contended top model.
  if (impl === null) throw new Error('AGENT_NULL: implementer agent returned null (terminal Overloaded or skipped)')
```

- [ ] **Step 5: Rewrite the `runTask` catch to classify**

Replace the body of the `catch (e)` in `runTask` (~L585-593, down to the `try {` that re-dispatches) with:

```javascript
    const msg = String((e && e.message) || e)
    // Default the one retry to the SAME tier; escalate one rung ONLY for a
    // capability-fixable schema trip. Never escalate an Overloaded/null fault.
    const capabilityFixable = isSchemaTrip(msg)
    const retryTier = capabilityFixable ? escalateTier(task.tier) : (task.tier || 'standard')
    if (looksStructural(msg)) {
      judgmentCalls.push('task ' + task.id + ': agent error looks structural (' + msg +
        ') — looks like a missing Depends-on edge; a tier change will not fix it')
    }
    judgmentCalls.push('task ' + task.id + ': agent error at ' + (task.tier || 'standard') +
      ' — retrying once at ' + retryTier +
      (capabilityFixable ? ' (schema trip → escalate)' : ' (same tier)') + ': ' + msg)
    log('task ' + task.id + ' agent error — retrying at ' + retryTier)
```

(The existing inner `try { const res = await runTaskInner(task, baseSha, siblings, retryTier) … } catch (e2) { … }` stays as-is.)

- [ ] **Step 6: Write the CI-safe source pins**

Create `tests/test_escalation_classifier.py`:

```python
import pathlib

WAVES = pathlib.Path(__file__).resolve().parents[1] / "skills/ultrapowers/harnesses/waves.js"


def test_classifiers_present():
    src = WAVES.read_text()
    assert "const isSchemaTrip" in src
    assert "const looksStructural" in src
    assert "AGENT_NULL" in src


def test_retry_defaults_to_same_tier():
    src = WAVES.read_text()
    # Same-tier default: retryTier is task.tier unless a schema trip escalates it.
    assert "capabilityFixable ? escalateTier(task.tier) : (task.tier || 'standard')" in src


def test_structural_fault_diagnosed():
    src = WAVES.read_text()
    assert "missing Depends-on edge" in src
```

- [ ] **Step 7: Run both suites to verify they pass**

Run: `node tests/sim_workflow.mjs && python3 -m pytest tests/test_escalation_classifier.py tests/test_workflow_sim.py -v`
Expected: `ALL SCENARIOS PASSED`; pins pass.

- [ ] **Step 8: Commit**

```bash
git add skills/ultrapowers/harnesses/waves.js tests/sim_workflow.mjs tests/test_escalation_classifier.py
git commit -m "feat(engine): classify agent-error escalation — same-tier default, escalate only on schema trips, diagnose structural faults"
```

---

### Task 3: Sonnet reviewer floor for trivial lean reviews (engine)

**Type:** implementation
**Depends-on:** 1, 2

**Files:**
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `skills/ultrapowers/references/workflow-template.md`
- Modify: `tests/sim_workflow.mjs`
- Test: `tests/test_review_floor.py`

(Locations: `waves.js` — add `reviewerModelFor` after `taskReviewProfile` ~L572, use it at the per-task review dispatch ~L684; reviewer-prompts.md reviewer-tier sentence ~L111 and model-tier table ~L197-205 — OUTSIDE the BAKE blocks; workflow-template.md model-tier mapping.)

**Interfaces:**
- Consumes: `taskReviewProfile(task): 'adversarial'|'lean'`, `tierKey(t): string`, `DEFAULT_TIER` (existing); the narrowed-trigger guarantee from Task 1 (a `lean`+`cheap` task is non-risk by construction)
- Produces: `reviewerModelFor(task): string` — `sonnet` for `lean`+`cheap`, `opus` otherwise; override-proof (built from `DEFAULT_TIER`)

- [ ] **Step 1: Write the failing behavioral scenario in `tests/sim_workflow.mjs`**

Add a scenario that records the model on each `review:*` dispatch and on the `integration` (completeness critic) dispatch:

```javascript
// ── Fork B: reviewer floor — sonnet only for lean+cheap, opus everywhere else ─
{
  const models = {}
  const agent = async (prompt, opts) => {
    const label = (opts && opts.label) || ''
    if (label === 'setup') return { branch: 'ultra/int', headSha: 'sha-setup', baselinePassed: true }
    if (label.startsWith('impl:')) return { status: 'done', branch: 'worktree-' + label.slice(5), headSha: 'sha-' + label }
    if (label.startsWith('review:')) { models[label.split(':')[1]] = opts.model; return { verdict: 'approve', issues: [] } }
    if (label.startsWith('merge')) return { status: 'MERGED', headSha: 'sha-merge' }
    if (label === 'integration') { models.integration = opts.model; return { verdict: 'approve', issues: [] } }
    return { status: 'done', branch: 'w', headSha: 'sha' }
  }
  const args = {
    waves: [[
      { id: 'a', title: 'trivial', body: 'b', tier: 'cheap', review: 'lean' },        // → sonnet floor
      { id: 'b', title: 'risky', body: 'b', tier: 'cheap', review: 'adversarial' },   // → opus (adversarial)
      { id: 'c', title: 'mid', body: 'b', tier: 'standard', review: 'lean' },         // → opus (not cheap)
    ]],
    integrationBranch: 'ultra/int', stamp: 's', baseBranch: 'main', edges: [],
  }
  const report = await runWorkflow({ agent, args, budget: { total: null, spent: () => 0, remaining: () => Infinity } })
  eq(models.a, 'sonnet', 'lean+cheap task reviewed at sonnet floor')
  eq(models.b, 'opus', 'adversarial task reviewed at opus')
  eq(models.c, 'opus', 'standard-tier lean task reviewed at opus')
  eq(models.integration, 'opus', 'completeness critic stays opus')
}
```

- [ ] **Step 2: Run the sim to verify it fails**

Run: `node tests/sim_workflow.mjs`
Expected: FAIL on `lean+cheap task reviewed at sonnet floor` (today every review uses opus `REVIEWER_MODEL`, so `models.a` is `opus`).

- [ ] **Step 3: Add `reviewerModelFor` in `waves.js`**

Immediately after `taskReviewProfile` (after ~L572), add:

```javascript
// Per-task reviewer model. Built from DEFAULT_TIER (NOT TIER) so tierOverrides
// can never weaken the gate. By the narrowed adversarial trigger, a lean review
// on a cheap-tier task is a trivial non-risk diff — review it at the sonnet
// floor. Everything else (adversarial, standard/most-capable tier, any risk
// task) stays opus. Never haiku.
const reviewerModelFor = (task) =>
  (taskReviewProfile(task) === 'lean' && tierKey(task.tier) === 'cheap')
    ? DEFAULT_TIER.standard
    : DEFAULT_TIER.mostCapable
```

- [ ] **Step 4: Use it at the per-task review dispatch**

In `reviewOpts` (~L682-685), change the model from the constant to the per-task selector:

```javascript
    const reviewOpts = (pass) => ({
      label: 'review:' + task.id + ':' + iter + (pass ? ':' + pass : ''),
      model: reviewerModelFor(task), schema: REVIEWER_SCHEMA,
    })
```

Leave the completeness-critic dispatch (`model: REVIEWER_MODEL`, ~L1166), reconcile (`TIER.mostCapable`, ~L812), and fix rounds (`TIER.mostCapable`, ~L762) **unchanged**.

- [ ] **Step 5: Update the reviewer-tier doc + model-tier table**

In `reviewer-prompts.md`, refine the reviewer-tier sentence (~L111, already touched by Task 1) so it states the floor explicitly:

```markdown
The reviewer runs at the most-capable tier (`opus`) wherever risk is real — a weak reviewer's failure mode is the silent false `PASS`, worse than no reviewer — with ONE narrow exception: a `lean` review of a `cheap`-tier task (a trivial, non-risk diff by the narrowed adversarial trigger) runs at the **sonnet floor**. The floor is never haiku, is built from `DEFAULT_TIER` so `tierOverrides` cannot weaken it, and never applies to adversarial passes, `standard`/`most-capable`-tier reviews, the completeness critic, reconcile, or fix rounds. Review *depth* is still set per task (see above).
```

In the model-tier table (~L197-205), add a row documenting the floor (match the table's existing column shape), e.g.:

```markdown
| per-task reviewer | `opus` (floor: `sonnet` for `lean`+`cheap`) | override-proof; `DEFAULT_TIER`-based |
```

- [ ] **Step 6: Document the selector in `workflow-template.md`**

In the model-tier mapping section of `references/workflow-template.md`, add a sentence:

```markdown
The per-task reviewer model is `reviewerModelFor(task)`: `DEFAULT_TIER.standard`
(sonnet) for a `lean` review of a `cheap`-tier task, `DEFAULT_TIER.mostCapable`
(opus) otherwise. It is built from `DEFAULT_TIER`, not `TIER`, so `tierOverrides`
cannot weaken the gate. The completeness critic, reconcile, and fix rounds keep
opus / `TIER.mostCapable`.
```

- [ ] **Step 7: Write the CI-safe source pins**

Create `tests/test_review_floor.py`:

```python
import pathlib

WAVES = pathlib.Path(__file__).resolve().parents[1] / "skills/ultrapowers/harnesses/waves.js"


def test_floor_is_override_proof_default_tier():
    src = WAVES.read_text()
    start = src.index("const reviewerModelFor")
    block = src[start:start + 300]
    # Built from DEFAULT_TIER (override-proof), not the override-able TIER.
    assert "DEFAULT_TIER.standard" in block
    assert "DEFAULT_TIER.mostCapable" in block
    assert "TIER.standard" not in block and "TIER.mostCapable" not in block


def test_per_task_review_uses_selector():
    src = WAVES.read_text()
    assert "model: reviewerModelFor(task)" in src


def test_completeness_critic_stays_opus():
    src = WAVES.read_text()
    # The integration/completeness dispatch must remain the opus REVIEWER_MODEL.
    idx = src.index("label: 'integration'")
    assert "model: REVIEWER_MODEL" in src[idx - 80:idx + 80]
```

- [ ] **Step 8: Run the suites to verify they pass**

Run: `node tests/sim_workflow.mjs && python3 -m pytest tests/test_review_floor.py tests/test_no_prompt_drift.py -v`
Expected: `ALL SCENARIOS PASSED`; pins pass; no BAKE drift.

- [ ] **Step 9: Commit**

```bash
git add skills/ultrapowers/harnesses/waves.js skills/ultrapowers/references/reviewer-prompts.md skills/ultrapowers/references/workflow-template.md tests/sim_workflow.mjs tests/test_review_floor.py
git commit -m "feat(engine): sonnet reviewer floor for lean+cheap tasks; opus stays override-proof elsewhere"
```

---

### Task 4: Semantic wave labels (engine + orchestrator)

**Type:** implementation
**Depends-on:** 1, 3

**Files:**
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultrapowers/references/workflow-template.md`
- Modify: `tests/sim_workflow.mjs`
- Test: `tests/test_wave_roadmap.py`

(Locations: `waves.js` — define `waveLabel(w)` after the `wavesPath` setup ~L62, use it at the `meta.phases` mutation ~L206 and the wave-loop label ~L1004; SKILL.md Step 4 args block ~L325-328 + knobs list; workflow-template.md args contract; `tests/sim_workflow.mjs` — extend `runWorkflow` to capture phase calls.)

**Interfaces:**
- Consumes: `ARGS.waveLabels?: string[]`, `WAVES: Task[][]` (existing)
- Produces: `waveLabel(w: number): string` — `ARGS.waveLabels[w]` when a non-empty string, else `'Wave ' + (w+1) + ' · ' + <joined task titles, truncated>`; never a bare `'Wave N'` when titles exist. Consumed by Task 5.

**Parallelization rationale:** extracting `waveLabel(w)` as one helper (consumed by the meta.phases mutation, the loop label, and Task 5's pre-registration) is DRY a good engineer makes regardless — and it is the single shared contract that lets Task 5's pre-registration reuse identical labels instead of re-deriving them.

- [ ] **Step 1: Extend `runWorkflow` in `tests/sim_workflow.mjs` to capture phase calls**

Change the `phase` stub in `runWorkflow` to an optional recorder (backward-compatible — existing callers omit it). In the destructure add `phase: phaseRecorder`, and replace `const phase = () => {}` with:

```javascript
  const phase = typeof phaseRecorder === 'function' ? phaseRecorder : () => {}
```

- [ ] **Step 2: Write the failing label scenarios in `tests/sim_workflow.mjs`**

```javascript
// ── W1: wave labels are semantic, never a bare "Wave N" ──────────────────────
async function runLabelScenario(waveLabels) {
  const phases = []
  const agent = async (prompt, opts) => {
    const label = (opts && opts.label) || ''
    if (label === 'setup') return { branch: 'ultra/int', headSha: 'sha-setup', baselinePassed: true }
    if (label.startsWith('impl:')) return { status: 'done', branch: 'worktree-' + label.slice(5), headSha: 'sha-' + label }
    if (label.startsWith('review:')) return { verdict: 'approve', issues: [] }
    if (label.startsWith('merge')) return { status: 'MERGED', headSha: 'sha-merge' }
    if (label === 'integration') return { verdict: 'approve', issues: [] }
    return { status: 'done', branch: 'w', headSha: 'sha' }
  }
  const args = {
    waves: [[{ id: '1', title: 'Schema', body: 'b', tier: 'cheap', review: 'lean' }]],
    integrationBranch: 'ultra/int', stamp: 's', baseBranch: 'main', edges: [],
    ...(waveLabels ? { waveLabels } : {}),
  }
  await runWorkflow({ agent, args, phase: (t) => phases.push(t), budget: { total: null, spent: () => 0, remaining: () => Infinity } })
  return phases
}
// Orchestrator-supplied label wins.
{
  const phases = await runLabelScenario(['Data layer'])
  assert(phases.includes('Data layer'), 'supplied waveLabel is used')
}
// No supplied label → deterministic title-join fallback, never a bare "Wave 1".
{
  const phases = await runLabelScenario(null)
  assert(phases.some((p) => p.startsWith('Wave 1 · ') && p.includes('Schema')), 'fallback joins task titles')
  assert(!phases.includes('Wave 1'), 'bare "Wave 1" is never shown alone')
}
```

- [ ] **Step 3: Run the sim to verify it fails**

Run: `node tests/sim_workflow.mjs`
Expected: FAIL on `fallback joins task titles` (today the loop calls `phase('Wave ' + (w + 1))` → a bare `'Wave 1'`).

- [ ] **Step 4: Define `waveLabel(w)` in `waves.js`**

After the `wavesPath` const (~L62, after `WAVES` is defined at L59), add:

```javascript
// W1: name each wave by what it DELIVERS. Prefer the orchestrator-synthesized
// deliverable label (ARGS.waveLabels[w]); fall back to a deterministic join of
// the wave's task titles, truncated. A bare "Wave N" is never shown when the
// wave has titled tasks. Used by the meta.phases mutation, the wave loop, and
// the W2 roadmap pre-registration.
const waveLabel = (w) => {
  const supplied = (ARGS && Array.isArray(ARGS.waveLabels)) ? ARGS.waveLabels[w] : undefined
  if (typeof supplied === 'string' && supplied.trim()) return supplied.trim()
  const titles = WAVES[w].map((t) => t && t.title).filter(Boolean).join(', ')
  if (!titles) return 'Wave ' + (w + 1)
  const MAX = 80
  const shown = titles.length > MAX ? titles.slice(0, MAX - 1) + '…' : titles
  return 'Wave ' + (w + 1) + ' · ' + shown
}
```

- [ ] **Step 5: Use `waveLabel` at the `meta.phases` mutation and the loop label**

In the `meta.phases` mutation (~L205-207), replace `'Wave ' + (i + 1)` with `waveLabel(i)`:

```javascript
  meta.phases = [{ title: 'Setup' }]
    .concat(WAVES.map((_, i) => ({ title: waveLabel(i) })))
    .concat([{ title: 'Integration Review' }])
```

In the wave loop (~L1004), replace `phase('Wave ' + (w + 1))` with:

```javascript
  phase(waveLabel(w))
```

- [ ] **Step 6: Synthesize `waveLabels[]` in `SKILL.md` Step 4**

In Step 4c, add `waveLabels` to the args block (~L325-328) and a knobs bullet. Update the args block to include `waveLabels?` and add this bullet after the `planPath` bullet (~L351):

```markdown
- `waveLabels` — a short, human-readable **deliverable theme** per wave (one
  string per wave, in wave order), so the live progress UI names each wave by
  what it delivers instead of "Wave N". Derive it from the wave's task
  titles/deliverables you already computed in Step 2 (e.g. `['Data layer',
  'API surface', 'Wiring + integration']`). Omit it to let the engine fall back
  to a deterministic join of the wave's task titles.
```

- [ ] **Step 7: Document `waveLabels` in the `workflow-template.md` args contract**

Add `waveLabels?: string[]` to the documented args contract with a one-line description matching the bullet above.

- [ ] **Step 8: Write the CI-safe source pins**

Create `tests/test_wave_roadmap.py`:

```python
import pathlib

WAVES = pathlib.Path(__file__).resolve().parents[1] / "skills/ultrapowers/harnesses/waves.js"


def test_wave_label_helper_present():
    src = WAVES.read_text()
    assert "const waveLabel = (w) =>" in src
    assert "ARGS.waveLabels" in src


def test_loop_uses_wave_label():
    src = WAVES.read_text()
    assert "phase(waveLabel(w))" in src
    assert "phase('Wave ' + (w + 1))" not in src  # the bare label is gone


def test_meta_phases_use_wave_label():
    src = WAVES.read_text()
    assert "title: waveLabel(i)" in src
```

- [ ] **Step 9: Run the suites + skill validation to verify they pass**

Run: `node tests/sim_workflow.mjs && python3 -m pytest tests/test_wave_roadmap.py -v && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers`
Expected: `ALL SCENARIOS PASSED`; pins pass; `skill ok`.

- [ ] **Step 10: Commit**

```bash
git add skills/ultrapowers/harnesses/waves.js skills/ultrapowers/SKILL.md skills/ultrapowers/references/workflow-template.md tests/sim_workflow.mjs tests/test_wave_roadmap.py
git commit -m "feat(engine,skill): semantic wave labels — waveLabels[] with deterministic title-join fallback"
```

---

### Task 5: Wave roadmap preview (engine)

**Type:** implementation
**Depends-on:** 4

**Files:**
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Modify: `tests/sim_workflow.mjs`
- Test: `tests/test_wave_roadmap_preview.py`

(Locations: `waves.js` — pre-registration block immediately before `phase('Setup')` ~L939. The new test file is this task's own, so it never writes Task 4's test.)

**Interfaces:**
- Consumes: `waveLabel(w): string` (from Task 4), `WAVES: Task[][]`
- Produces: a pre-registered roadmap — `phase('Setup')`, `phase(waveLabel(w))` for every wave, `phase('Integration Review')` — emitted up front so the live UI shows all waves as pending before any work runs.

- [ ] **Step 1: Write the failing roadmap scenario in `tests/sim_workflow.mjs`**

Reuse `runLabelScenario`-style setup but with two waves, and assert the roadmap is pre-registered before the first `impl:` dispatch. Add:

```javascript
// ── W2: the full wave roadmap is pre-registered before work starts ───────────
{
  const phases = []
  let firstImplAtPhaseCount = -1
  const agent = async (prompt, opts) => {
    const label = (opts && opts.label) || ''
    if (label.startsWith('impl:') && firstImplAtPhaseCount === -1) firstImplAtPhaseCount = phases.length
    if (label === 'setup') return { branch: 'ultra/int', headSha: 'sha-setup', baselinePassed: true }
    if (label.startsWith('impl:')) return { status: 'done', branch: 'worktree-' + label.slice(5), headSha: 'sha-' + label }
    if (label.startsWith('review:')) return { verdict: 'approve', issues: [] }
    if (label.startsWith('merge')) return { status: 'MERGED', headSha: 'sha-merge' }
    if (label === 'integration') return { verdict: 'approve', issues: [] }
    return { status: 'done', branch: 'w', headSha: 'sha' }
  }
  const args = {
    waves: [
      [{ id: '1', title: 'Schema', body: 'b', tier: 'cheap', review: 'lean' }],
      [{ id: '2', title: 'API', body: 'b', tier: 'cheap', review: 'lean' }],
    ],
    integrationBranch: 'ultra/int', stamp: 's', baseBranch: 'main', edges: [],
    waveLabels: ['Data layer', 'API surface'],
  }
  await runWorkflow({ agent, args, phase: (t) => phases.push(t), budget: { total: null, spent: () => 0, remaining: () => Infinity } })
  const preamble = phases.slice(0, firstImplAtPhaseCount)
  assert(preamble.includes('Setup'), 'roadmap pre-registers Setup before work')
  assert(preamble.includes('Data layer') && preamble.includes('API surface'), 'roadmap pre-registers every wave before work')
  assert(preamble.includes('Integration Review'), 'roadmap pre-registers Integration Review before work')
}
```

- [ ] **Step 2: Run the sim to verify it fails**

Run: `node tests/sim_workflow.mjs`
Expected: FAIL on `roadmap pre-registers every wave before work` (today only `Setup` is emitted before the first `impl:`; wave labels appear one at a time inside the loop).

- [ ] **Step 3: Add the pre-registration block in `waves.js`**

Immediately **before** `phase('Setup')` (~L939), add:

```javascript
// W2: pre-register every phase up front so the live roadmap shows all waves as
// pending, not one-at-a-time. phase() is keyed by title — re-calling a title
// re-activates its existing group box (engine: same phase string → same group
// box). The real Setup/loop/Integration-Review calls below re-activate each in
// turn. FALLBACK (if a live run shows the roadmap reordering/duplicating rather
// than pre-listing): replace this loop with one log() line —
//   log('Roadmap: Setup · ' + WAVES.map((_, w) => waveLabel(w)).join(' · ') + ' · Integration Review')
// and leave the per-wave phase() activation below unchanged.
phase('Setup')
for (let w = 0; w < WAVES.length; w++) phase(waveLabel(w))
phase('Integration Review')
```

- [ ] **Step 4: Write the source pin in `tests/test_wave_roadmap_preview.py` (new)**

Create `tests/test_wave_roadmap_preview.py`:

```python
import pathlib

WAVES = pathlib.Path(__file__).resolve().parents[1] / "skills/ultrapowers/harnesses/waves.js"


def test_roadmap_preregistered_before_setup():
    src = WAVES.read_text()
    setup_idx = src.index("phase('Setup')")
    head = src[:setup_idx]
    # The pre-registration loop appears before the FIRST phase('Setup') call.
    assert "for (let w = 0; w < WAVES.length; w++) phase(waveLabel(w))" in head
    assert "phase('Integration Review')" in head
```

- [ ] **Step 5: Run the suites to verify they pass**

Run: `node tests/sim_workflow.mjs && python3 -m pytest tests/test_wave_roadmap_preview.py tests/test_workflow_sim.py -v`
Expected: `ALL SCENARIOS PASSED`; pins pass.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/harnesses/waves.js tests/sim_workflow.mjs tests/test_wave_roadmap_preview.py
git commit -m "feat(engine): pre-register the full wave roadmap so all waves show as pending up front"
```

> **First-live-run confirmation (operator step, not a code task):** on the first interactive `/ultrapowers` run after this lands, watch the swarm viewer — confirm the roadmap renders Setup → each wave → Integration Review in order, all pending. If it reorders or duplicates, apply the `FALLBACK` in the Step-3 comment (swap the pre-registration loop for the single `log()` line). The test suite verifies the pre-registration code, not the live UI rendering.

---

### Task 6: Full-suite verification gate

**Type:** gate
**Depends-on:** 5

**Files:** none — verification only.

Run the committed gate and confirm everything is green together. This is the `Acceptance: suite` verification.

- [ ] **Step 1: Run the full test gate**

Run: `python3 -m pytest`
Expected: PASS (all tests, including the new `test_review_trigger_prose.py`, `test_escalation_classifier.py`, `test_review_floor.py`, `test_wave_roadmap.py`, the extended `test_workflow_sim.py`, and the unchanged `test_no_prompt_drift.py` / `test_superpowers_compat.py`).

- [ ] **Step 2: Run skill validation**

Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers`
Expected: `skill ok`.

- [ ] **Step 3: Confirm no BAKE block drift**

Run: `python3 -m pytest tests/test_no_prompt_drift.py -v`
Expected: PASS (zero re-bake — confirms no prompt source diverged from `waves.js`).

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-06-27-right-size-review-and-wave-roadmap-design.md`):
- §3.1 Fork A (narrow trigger, no split) → Task 1. ✅
- §3.2 Fork B (sonnet floor, override-proof, critic/reconcile/fix stay opus) → Task 3. ✅
- §3.3 Fork C (same-tier default, escalate only on schema trips, route null/Overloaded same-tier, structural diagnostic, keep containment) → Task 2. ✅
- §3.0 A+B single risk signal (floor keys off `review`+`tier`) → Task 3 `reviewerModelFor`. ✅
- §3.4 W1 (waveLabels[] + title-join fallback) → Task 4. ✅
- §3.5 W2 (pre-registration + log() fallback + first-run confirmation) → Task 5. ✅
- §4 zero-rebake property → Global Constraints + Task 6 Step 3 + each task keeping `test_no_prompt_drift` green. ✅
- §5 acceptance = suite; source-pins + sim scenarios → every task's tests. ✅
- §6 out-of-scope (diff-size gate, worktree isolation, sealed-acceptance friction) → not included, recorded in the spec. ✅

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N" — every code and test step shows real content. The W2 fallback is exact replacement code, not a vague branch. ✅

**Type/name consistency:** `waveLabel(w)` (Task 4 Produces → Task 5 Consumes) — same name both places. `reviewerModelFor(task)`, `isSchemaTrip`/`looksStructural`, `DEFAULT_TIER.standard`/`.mostCapable`, `REVIEWER_MODEL`, `taskReviewProfile`, `tierKey` — all match the existing `waves.js` symbols read during authoring. `args.waveLabels` (orchestrator-facing, SKILL/template) vs `ARGS.waveLabels` (engine-internal, normalized) — intentional and consistent with the existing `ARGS.waves`. ✅

**ultraplan additions:**
- Decomposition shaped before annotation; the only width (Task 1 ∥ Task 2) is genuine independence, not manufactured; the rest serializes honestly on `waves.js` (escape valve disclosed). ✅
- Every task carries explicit `**Type:**` and `**Depends-on:**`; every cross-task constraint is a `Depends-on` edge (file-overlap edges declared: 3←1,2; 4←1,3; 5←4). ✅
- `**Interfaces:**` populated; the one cross-task symbol (`waveLabel`) has a matching `Depends-on` (5←4); the surviving architectural move carries a `**Parallelization rationale:**` line (Task 4). ✅
- Gate marked `gate` (Task 6); no `release`/`manual` rituals (no push/version-bump in scope). ✅
- Acceptance line present (`suite`). ✅

---

## Execution Handoff

**Fit analysis:** 5 implementation tasks (T=5), widest wave 2 (Task 1 ∥ Task 2; the rest serialize on `waves.js`), low risk (Acceptance `suite`, operator reads the diffs; engine-internal review logic, not an auth/payments/migrations/data-integrity surface, and verified by source-pins + sim scenarios). First matching branch: parallel width present **and** T≥4 → **Ultrapowers (recommended)**. *Caveat:* the parallel mass is thin (one width-2 wave), and self-hosting needs the SKILL.md Step-1 engine-skew preflight (the installed cache lags `main`); the acceptance gate remains plain `python3 -m pytest` either way — do **not** dogfood `/ultrapowers`'s own run as the gate. Subagent-Driven is a defensible honest alternative given the thin parallelism.

1. **Ultrapowers (recommended)** — `/ultrapowers docs/superpowers/plans/2026-06-27-right-size-review-and-wave-roadmap.md`: parallel waves, worktree isolation, per-task review, one pre-merge human gate. Selecting this authorizes execution: ultrapowers renders the wave plan for transparency and launches immediately, without a further approval pause.
2. **Subagent-Driven** — `superpowers:subagent-driven-development`: sequential, fresh subagent per task, review between tasks.
3. **Inline** — `superpowers:executing-plans`: continuous inline execution in this session.

**Which approach?**

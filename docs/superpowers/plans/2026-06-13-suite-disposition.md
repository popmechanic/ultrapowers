# The `suite` Acceptance Disposition — Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Acceptance:** suite — engine-internal contract change; verified by the committed compiler/engine/sim test suite + drift pins + adversarial review, not a held-out exam.

**Goal:** Add a third, load-bearing acceptance disposition `suite` (verification = the project's own committed test suite, no held-out exam), document when to choose it, and backfill every existing marked plan so the repo stays fully compilable once sealed-acceptance enforcement reaches `main`.

**Architecture:** Four seams: (1) the compiler learns to parse `**Acceptance:** suite — <reason>`; (2) the engine records a `suite` disposition honestly as `{ mode:'suite', passed: <committed-test-result>, reason }` and administers no exam; (3) the skills document the forward decision rule; (4) all eleven pre-contract plans are backfilled and a guard test asserts every committed plan compiles forever. This work lands on the existing integration branch `ultra/integration-20260612-150003` so it ships inside the sealed-acceptance PR, before enforcement reaches `main`.

**Tech Stack:** python3 + pytest, the JS workflow sim (`tests/sim_workflow.mjs` driven by `tests/test_workflow_sim.py`), the anti-drift pins.

**Spec:** `docs/superpowers/specs/2026-06-13-suite-disposition-design.md`

**Shared contract (each task restates what it needs):**
- Marker (plan-level, fence-aware, first-match-by-document-order wins): `**Acceptance:** suite — <reason>`.
- Compiler `parse_acceptance` returns `{"mode":"suite","reason":<text>}` for it.
- Engine, for a `suite` arg `{ mode:'suite', reason }`: sets `acceptance = { mode:'suite', passed: review.testsPassed, reason }`, dispatches NO exam agent, touches no vault. `acceptance.passed === tests.passed`, so the existing Approve gate `tests.passed && (acceptance is null || acceptance.passed || acceptance.mode === 'waived')` handles it with no new clause.
- `waived` keeps its meaning: verification genuinely skipped.

---

### Task 1: Compiler parses the `suite` disposition

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `tests/test_compile_plan.py`

Contract: `**Acceptance:** suite — <reason>` (em-dash, en-dash, or hyphen separator, matching the existing `ACCEPT_WAIVED` pattern) parses to `{"mode":"suite","reason":<text>}`. It satisfies the marked-plan enforcement exactly as `sealed`/`waived`. The existing first-match scan order is preserved.

- [ ] **Step 1: Add the failing tests**

In `tests/test_compile_plan.py`, follow the existing helper conventions (`compile_plan(path)` returns parsed JSON and asserts exit 0; `compile_plan_raw(path)` returns the subprocess result; `_with_waiver` exists but is NOT used here). The existing `_minimal_marked_plan(acceptance_line=None)` helper builds a minimal marked plan — reuse it. Add:

```python
def test_acceptance_suite_parsed():
    out = compile_plan_text(_minimal_marked_plan(
        "**Acceptance:** suite — verified by the committed suite"))
    assert out["acceptance"]["mode"] == "suite"
    assert "committed suite" in out["acceptance"]["reason"]


def test_acceptance_suite_satisfies_enforcement():
    # a suite line is a valid disposition: marked plan compiles, exit 0
    r = compile_raw_text(_minimal_marked_plan("**Acceptance:** suite — x"))
    assert r.returncode == 0


def test_fenced_suite_line_is_ignored():
    plan = _minimal_marked_plan("```\n**Acceptance:** suite — fenced\n```")
    r = compile_raw_text(plan)
    assert r.returncode != 0, "a fenced suite line must not count as a disposition"
```

If the file's existing helpers operate on file paths rather than text (e.g. only `compile_plan(path)` / `compile_plan_raw(path)` exist), add two thin text helpers next to them rather than duplicating subprocess logic:

```python
def compile_plan_text(plan_md):
    import tempfile, os
    fd, p = tempfile.mkstemp(suffix=".md"); os.close(fd)
    pathlib.Path(p).write_text(plan_md)
    try:
        return compile_plan(pathlib.Path(p))
    finally:
        pathlib.Path(p).unlink(missing_ok=True)


def compile_raw_text(plan_md):
    import tempfile, os
    fd, p = tempfile.mkstemp(suffix=".md"); os.close(fd)
    pathlib.Path(p).write_text(plan_md)
    try:
        return compile_plan_raw(pathlib.Path(p))
    finally:
        pathlib.Path(p).unlink(missing_ok=True)
```

(If `_minimal_marked_plan` already exists from the sealed-acceptance work, reuse it verbatim; do not redefine it.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_compile_plan.py -q`
Expected: the three new tests FAIL — `suite` currently parses to `{"mode":"missing"}`, so a marked plan with only a suite line is rejected (no `acceptance.mode == "suite"`).

- [ ] **Step 3: Add the `suite` branch**

In `skills/ultrapowers/scripts/compile_plan.py`, beside the existing acceptance regexes (after `ACCEPT_WAIVED` at ~line 359):

```python
ACCEPT_SUITE = re.compile(r"^\*\*Acceptance:\*\*\s*suite\s*[—–-]\s*(.+?)\s*$", re.I)
```

In `parse_acceptance`, inside the per-line scan, add a check for the suite form alongside the sealed/waived checks (same first-match precedence — order the checks sealed, waived, suite, consistent with their definition order; precedence is by document line, not by check order, since each line matches at most one):

```python
        m = ACCEPT_SUITE.match(s)
        if m:
            return {"mode": "suite", "reason": m.group(1)}
```

No other change — the existing enforcement (`mode == "missing"` on a marked plan → `sys.exit`) now passes for `suite` because the mode is no longer missing.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_compile_plan.py -q`
Expected: all pass, including the three new tests and every pre-existing one.

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/compile_plan.py tests/test_compile_plan.py
git commit -m "feat: compiler parses the suite acceptance disposition"
```

---

### Task 2: Engine records `suite` honestly, administers no exam

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/workflow.js`
- Modify: `tests/sim_workflow.mjs`
- Modify: `skills/ultrapowers/references/report-format.md`
- Modify: `skills/ultrapowers/references/workflow-template.md`

Contract: the engine's acceptance block currently handles `ACCEPTANCE.mode === 'waived'` and `=== 'sealed'`. Add a `'suite'` branch that sets `acceptance = { mode: 'suite', passed: review.testsPassed, reason }`, dispatches NO agent, touches no vault, and pushes the gate-blocking judgmentCall only when `review.testsPassed` is false. `review` (with `.testsPassed`) is already computed before the acceptance block. This is NOT a re-bake (no baked prompt text changes); only the JS dispatch logic and docs.

- [ ] **Step 1: Add the failing sim scenarios**

Read `tests/sim_workflow.mjs` and match the existing `scenarioAcceptanceWaived` / `scenarioAcceptanceSealedGreen` conventions exactly (helpers `runWorkflow`, `makeAcceptanceAgent`, `baseArgs`, `eq`, `assert`; the integration-review agent's `testsPassed` is what flows into `review.testsPassed` — see how the green/red scenarios set it). Add after the existing acceptance scenarios:

```javascript
// ── Scenario: acceptance-suite-green — disposition bound to the committed suite
// A suite plan administers NO held-out exam; acceptance.passed mirrors the
// integration test result. Green suite => acceptance.passed true, no exam agent
// dispatched, no gate-blocking judgmentCall.
async function scenarioAcceptanceSuiteGreen() {
  let examDispatched = false
  const agent = makeAcceptanceAgent((label) => {
    if (label === 'acceptance-exam') { examDispatched = true; return { raw: '{}' } }
    return undefined  // fall through to the harness default for other labels
  }, { testsPassed: true })
  const r = await runWorkflow({
    agent,
    args: Object.assign({}, baseArgs, { acceptance: { mode: 'suite', reason: 'committed suite' } }),
    budget: undefined,
  })
  eq(r.acceptance && r.acceptance.mode, 'suite', 'acceptance-suite-green: mode is suite')
  eq(r.acceptance && r.acceptance.passed, true, 'acceptance-suite-green: passed mirrors green tests')
  eq(examDispatched, false, 'acceptance-suite-green: no held-out exam dispatched')
  assert(!r.judgmentCalls.some((j) => /acceptance did not pass/.test(j)),
    'acceptance-suite-green: no gate-blocking judgmentCall on green')
  console.log('scenario acceptance-suite-green: OK')
}

// ── Scenario: acceptance-suite-red — failed committed suite blocks the gate ────
async function scenarioAcceptanceSuiteRed() {
  const agent = makeAcceptanceAgent(() => undefined, { testsPassed: false })
  const r = await runWorkflow({
    agent,
    args: Object.assign({}, baseArgs, { acceptance: { mode: 'suite', reason: 'committed suite' } }),
    budget: undefined,
  })
  eq(r.acceptance && r.acceptance.mode, 'suite', 'acceptance-suite-red: mode is suite')
  eq(r.acceptance && r.acceptance.passed, false, 'acceptance-suite-red: passed mirrors red tests')
  assert(r.judgmentCalls.some((j) => /acceptance did not pass/.test(j)),
    'acceptance-suite-red: red suite pushes a gate-blocking judgmentCall')
  console.log('scenario acceptance-suite-red: OK')
}
```

Wire both into the await sequence beside the other acceptance scenarios, before `console.log('ALL SCENARIOS PASSED')`.

**Harness-fit note:** `makeAcceptanceAgent`'s real signature may differ (it predates this task). Read its definition and the green/red scenarios; adapt these two scenarios to the actual signature — the REQUIRED assertions are: `r.acceptance.mode === 'suite'`, `r.acceptance.passed === <the integration testsPassed>`, no `acceptance-exam` agent dispatched in the green case, and a `did not pass` judgmentCall iff red. Do not restructure the harness; if the harness cannot express "assert no exam agent dispatched," drop only that one assertion and keep the rest.

Run: `node tests/sim_workflow.mjs` → expected: the two new scenarios FAIL (engine has no `suite` branch yet, so `r.acceptance` stays null).

- [ ] **Step 2: Add the `suite` branch to the engine**

In `skills/ultrapowers/workflow.js`, in the acceptance block (the `if (ACCEPTANCE && ACCEPTANCE.mode === 'waived')` / `else if (... === 'sealed')` chain at ~905), add a branch. Place it as an `else if` before the sealed branch or after the waived branch — anywhere in the chain is fine since the modes are exclusive:

```js
} else if (ACCEPTANCE && ACCEPTANCE.mode === 'suite') {
  // suite: verification is the committed test suite, not a held-out exam.
  // acceptance.passed mirrors the integration test result; no agent, no vault.
  acceptance = { mode: 'suite', passed: review.testsPassed,
                 reason: String(ACCEPTANCE.reason || '') }
  if (!acceptance.passed) judgmentCalls.push(
    'suite acceptance did not pass (committed test suite failed) — gate must not Approve')
}
```

(The sealed branch's existing judgmentCall says "sealed acceptance did not pass"; this one says "suite acceptance did not pass" — both match the `/acceptance did not pass/` assertion in the scenarios.)

Also extend the args-contract comment block above (where `{ mode: 'waived', reason }` is documented at ~line 108) to include `{ mode: 'suite', reason }`.

- [ ] **Step 3: Verify the sim and full suite**

Run: `node tests/sim_workflow.mjs` (expect `ALL SCENARIOS PASSED`) then `python3 -m pytest tests/ -q` (green). Confirm `git diff` shows no change to any baked prompt text (this is not a re-bake): `python3 -m pytest tests/test_no_prompt_drift.py -q` passes untouched.

- [ ] **Step 4: Update the contract docs**

- `references/report-format.md`: extend the `acceptance` block doc to include the `suite` shape: `{ mode: 'suite', passed, reason }` (passed mirrors the test result).
- `references/workflow-template.md`: add `{ mode: 'suite', reason }` to the documented `acceptance?` arg shapes, noting it administers no exam.

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/workflow.js tests/sim_workflow.mjs skills/ultrapowers/references/report-format.md skills/ultrapowers/references/workflow-template.md
git commit -m "feat: engine records the suite acceptance disposition (no held-out exam)"
```

---

### Task 3: Document the forward decision rule

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultraplan/SKILL.md`
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `tests/test_ultraplan_skill.py` (only if it pins section content; run it and update pins, never weaken assertions)

- [ ] **Step 1: Add the decision rule to ultraplan**

In `skills/ultraplan/SKILL.md`, in the "Seal the exam (after plan approval)" section (anchor: the line `The operator may instead record \`**Acceptance:** waived — <reason>\``), add a paragraph documenting all three dispositions and when to choose each:

```markdown
### Choosing the disposition

Every marked plan declares one of three Acceptance dispositions:

- **`**Acceptance:** sealed <seal-id> (sha256:<hash>)`** — feature work whose
  operator cannot read the code. A held-out exam, authored from the spec by an
  independent agent (the sealing step above). This is the default.
- **`**Acceptance:** suite — <reason>`** — ultrapowers' own engine / skill /
  doc / prompt / script development, where the author and operator both read
  the diffs and the committed test suite + drift pins + adversarial review are
  the verification. No held-out exam is authored; the engine binds acceptance
  to the committed test result (`acceptance.passed === tests.passed`).
- **`**Acceptance:** waived — <reason>`** — verification genuinely skipped, by
  explicit operator choice. Reserve this for the rare case where neither a
  held-out exam nor the committed suite applies.

Rule of thumb: building software *with* ultrapowers → `sealed`; building
ultrapowers *itself* → `suite`; opting out → `waived`.
```

Update the self-review additions bullet that currently says the plan carries a sealed line or waiver to read: `- The plan carries an **Acceptance:** line — sealed, suite, or an explicit operator waiver (see "Choosing the disposition").`

- [ ] **Step 2: Note suite in the ultrapowers gate doc**

In `skills/ultrapowers/SKILL.md`, in the Step 5 Approve bullet that states the gate condition, add a sentence: a `suite` disposition reports `acceptance.passed === tests.passed`, so it is gated by the committed suite with no special case; the report renders `suite — <reason>` like the other dispositions. In the Step 2 derived-knobs bullet about acceptance riding into args, note the three forms: `{ mode:'sealed', sealId, sha256, scriptPath }`, `{ mode:'suite', reason }`, `{ mode:'waived', reason }`.

- [ ] **Step 3: Validate**

Run: `python3 -m pytest tests/ -q && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers`
Expected: green; both validators print `skill ok`. If `tests/test_ultraplan_skill.py` pins section lists, extend the pins to include the new content — never delete an assertion.

- [ ] **Step 4: Commit**

```bash
git add skills/ultraplan/SKILL.md skills/ultrapowers/SKILL.md tests/test_ultraplan_skill.py
git commit -m "docs: document the sealed/suite/waived disposition decision rule"
```

---

### Task 4: Backfill every existing plan + add the compile-forever guard

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `docs/superpowers/plans/2026-06-10-plan-marker-injection.md`
- Modify: `docs/superpowers/plans/2026-06-11-interop-hardening.md`
- Modify: `docs/superpowers/plans/2026-06-11-open-issues-batch.md`
- Modify: `docs/superpowers/plans/2026-06-11-review-cycle-1-fixes.md`
- Modify: `docs/superpowers/plans/2026-06-11-review-cycle-2-fixes.md`
- Modify: `docs/superpowers/plans/2026-06-11-review-cycle-3-fixes.md`
- Modify: `docs/superpowers/plans/2026-06-11-review-cycle-4-fixes.md`
- Modify: `docs/superpowers/plans/2026-06-11-tier-criteria-and-effort-audit.md`
- Modify: `docs/superpowers/plans/2026-06-12-eval-driven-hardening.md`
- Modify: `docs/superpowers/plans/2026-06-12-unified-agent-visualization.md`
- Modify: `docs/superpowers/plans/2026-06-12-sealed-acceptance.md`
- Create: `tests/test_all_plans_compile.py`

This task depends on Task 1: the `suite` lines it adds only compile once the compiler recognizes `suite`. (The `2026-06-13-suite-disposition.md` plan — this one — already carries its own suite line in its header, so it needs no backfill; the guard test will cover it automatically.)

- [ ] **Step 1: Write the guard test (fails first)**

Create `tests/test_all_plans_compile.py`:

```python
"""Every committed marked plan must compile under the enforcing compiler — so
the repo can never again accumulate an uncompilable plan once sealed-acceptance
enforcement is live. A marked plan is one carrying Depends-on markers."""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
PLANS = sorted((ROOT / "docs/superpowers/plans").glob("*.md"))


def _is_marked(text):
    return "Depends-on:" in text


def test_every_marked_plan_compiles():
    failures = []
    for plan in PLANS:
        text = plan.read_text()
        if not _is_marked(text):
            continue
        r = subprocess.run([sys.executable, str(COMPILER), str(plan)],
                           capture_output=True, text=True)
        if r.returncode != 0:
            failures.append(f"{plan.name}: {r.stderr.strip().splitlines()[-1] if r.stderr.strip() else 'exit ' + str(r.returncode)}")
    assert not failures, "marked plans that do not compile:\n" + "\n".join(failures)
```

Run: `python3 -m pytest tests/test_all_plans_compile.py -q`
Expected: FAIL — it lists the eleven pre-contract plans (and would list this one if its header line were missing) as not compiling for lack of a disposition.

- [ ] **Step 2: Backfill the eleven plans**

To each file listed above, add a disposition line immediately after the plan's `> **For agentic workers:**` blockquote (or, if absent, immediately after the top-level `# ...` heading), separated by blank lines. Use a one-line reason fitting each plan; all are engine-internal so all use `suite`. Suggested lines (adjust wording to each plan's subject, keep the `**Acceptance:** suite — ` prefix exact):

- plan-marker-injection: `**Acceptance:** suite — engine/skill change; verified by the committed marker test suite, not a held-out exam.`
- interop-hardening: `**Acceptance:** suite — engine interop change; verified by the committed compat/sim suite, not a held-out exam.`
- open-issues-batch: `**Acceptance:** suite — engine fixes; verified by the committed test suite, not a held-out exam.`
- review-cycle-1-fixes through review-cycle-4-fixes: `**Acceptance:** suite — review-cycle fixes; verified by the committed test suite, not a held-out exam.`
- tier-criteria-and-effort-audit: `**Acceptance:** suite — engine/audit change; verified by the committed test suite, not a held-out exam.`
- eval-driven-hardening: `**Acceptance:** suite — engine hardening; verified by the committed test + sim suite, not a held-out exam.`
- unified-agent-visualization: `**Acceptance:** suite — docs/post change; verified by the committed post-visual test suite, not a held-out exam.`
- sealed-acceptance: `**Acceptance:** suite — the founding acceptance plan; its verification is test_run_acceptance.py plus the compiler tests, so a held-out exam would be recursive.`

- [ ] **Step 3: Run the guard + full suite**

Run: `python3 -m pytest tests/test_all_plans_compile.py -q` (expect pass — every marked plan, including this one and the eleven backfilled, compiles) then `python3 -m pytest tests/ -q` (green).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/*.md tests/test_all_plans_compile.py
git commit -m "fix: backfill suite disposition on all pre-contract plans; guard that every plan compiles"
```

---

### Task 5: Full-suite verification

**Type:** gate
**Depends-on:** 1, 2, 3, 4

Run: `python3 -m pytest tests/ -q`
Expected: every test passes — including `test_all_plans_compile.py`, the new compiler suite tests, and the sim's `ALL SCENARIOS PASSED` (which `tests/test_workflow_sim.py` asserts when node is present). Also: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` and `... skills/ultraplan` both print `skill ok`.

---

## Self-review notes

- Spec coverage: `suite` parse (Task 1), engine recording + no-exam + sim (Task 2), forward rule docs (Task 3), backfill + compile-forever guard (Task 4). The spec's error-handling edges (empty reason tolerated; first-match precedence) are inherited from the existing `parse_acceptance` scan that Task 1 extends without changing its order semantics.
- Type consistency: `{"mode":"suite","reason"}` (compiler) ↔ `{ mode:'suite', reason }` (engine arg) ↔ `{ mode:'suite', passed, reason }` (report) are the three shapes, each named in the task that owns it.
- Same-file collisions: none. Task 1 owns `compile_plan.py`/`test_compile_plan.py`; Task 2 owns `workflow.js`/`sim_workflow.mjs`/two references; Task 3 owns the two SKILL.md files; Task 4 owns the plan `.md` files + a new test file. Only edge: 1→4 (the backfilled `suite` lines need the compiler to accept `suite`). Waves: [1,2,3] → [4].
- This plan is engine-internal and declares `**Acceptance:** suite` in its own header — the contract using its new escape hatch on the work that adds it.

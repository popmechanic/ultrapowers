# Reviewer Verification Gap Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop reviewers deferring facts the system already has — give the critic the driver's suite result, and make un-sandbox-verifiable tasks visible at authoring time.

**Architecture:** Three independent changes to three files. The engine already runs the suite after each wave's fold and keeps it in `lastSuite`; the critic prompt is built a few dozen lines later without it. The compiler already prints advisory lines at `--check --renders`; it has no advisory for a task whose claims no sandbox can check. And `ultraplan` has no rule telling an author to carry evidence for such a claim. No task depends on another's output.

**Tech Stack:** Node ESM (`fleet/run-engine.mjs`, sentinel-style sims under `fleet/tests/`), Python 3.12 (pytest, pytest-xdist), Markdown.

**Spec:** No spec document — this plan implements #458, which supersedes #448. Its argument, the three measured instances behind it, and the scoping decisions are on that issue.

**Acceptance:** suite — every change here is threaded input, an advisory line, or a documented rule; the committed suite plus per-task review is the whole verification.

## Global Constraints

- **The `--check` diagnostic vocabulary is FROZEN (0.1.0); the `--renders` advisories are NOT.** Task 2 adds an advisory line only. It must not change the `PLAN OK` / violation output, must not change `--check`'s exit code, and must not add a violation string.
- **`skills/ultraplan/SKILL.md` is complexity-ratcheted** at 3038 words (`tests/test_skill_budget.py`); the file is 3033 today. Task 3's diff must be **net delta ≤ +5 words**, which consumes the remaining headroom deliberately — the next change to that file pays by trimming.
- **Fleet tests are Node ESM.** Files matching `fleet/tests/test_*.mjs` are executed by `tests/test_fleet_suite.py` with a 120 s per-file cap, and each must print the sentinel `ALL TESTS PASSED` as its final line or the bridge counts it as failed.
- **No new dependencies**, and no change to any worker's tool allowlist, `permissionMode`, or `fleet/confine-hook.mjs`. The boundary is measured and stays put (#457).
- **Every behavior change lands with a test that fails without it.** Tests assert the new behavior, not merely that the code runs.

---

### Task 1: The completeness critic receives the post-fold suite result

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `fleet/run-engine.mjs`
- Test: `fleet/tests/test_run_engine_critic_inputs.mjs`

**Interfaces:**
- Consumes: nothing
- Produces: nothing consumed by another task. Internal: a `suiteLine(suite)` helper alongside the existing `testCmdLine` / `filesLine` / `siblingLine` prompt-fragment helpers.

The `contend` A/B cell's critic established that 28 tests passed by line-by-line static trace, and then said what it actually wanted:

> That is strong but not executed evidence; the driver's independent `python3 -m pytest` run from the repo root **is the authoritative result and should be the gate's basis.**

**The driver has that result and does not pass it on.** `fleet/run-engine.mjs:1074` sets `lastSuite = merge.suite` after each wave's fold; `:1198-1199` reads `lastSuite.passed` / `lastSuite.output` when building `tests` for the report. The critic prompt at `:1121-1129` is built in between and receives only `baseline`, and only when the baseline **failed**:

```js
        roles.critic +
          (planPath ? ('\nPLAN: read the original plan document at ' + planPath + ' first.') : '') +
          globalConstraintsBlock + cannotVerifyChecklist +
          '\n\nTasks:\n' + taskList +
          '\nBlocked waves:\n' + JSON.stringify(blockedWaves) +
          (baseline.passed === false
            ? '\nBaseline: the test suite failed before any task ran — ' + tail(baseline.output, 500)
            : ''),
```

So the critic is asked whether the work is complete while being told nothing about whether the suite passed on the integrated tree.

**Scope — read this before widening it.** Only the **critic** gets a suite result, and only the driver's. The per-task **reviewer** runs before any independent suite exists, and `IMPLEMENTER_SCHEMA` (`run-engine.mjs:70-79`) carries no suite field. Adding one would make the implementer report its own grade — the self-referential acceptance problem #447 exists to fix. **Do not add a suite field to `IMPLEMENTER_SCHEMA` and do not thread a self-reported result to the reviewer.**

- [ ] **Step 1: Write the failing test**

Create `fleet/tests/test_run_engine_critic_inputs.mjs`. Follow the harness conventions in `fleet/tests/_engine_helpers.mjs` and the existing `fleet/tests/test_run_engine_gate.mjs` — drive the engine with a stubbed `agent()` that records every prompt it is given, then assert on the prompt the `integration` label received.

The assertions are the contract:

```javascript
// The critic must be told the driver's own post-fold suite result — pass or fail.
const criticPrompt = prompts.find((p) => p.label === 'integration').prompt
assert.match(criticPrompt, /SUITE \(driver-run, post-fold\)/,
  'the critic prompt carries no suite section')
assert.match(criticPrompt, /passed: true/,
  'the critic prompt does not state the suite verdict')
assert.match(criticPrompt, /the authoritative result/,
  'the critic prompt does not say the driver run is authoritative')
```

Add a second scenario asserting the failing case is carried too — a run whose post-fold suite failed must put `passed: false` and a tail of the output in the same section. A critic told only about successes is a check that cannot fail.

- [ ] **Step 2: Run it to verify it fails**

Run: `node fleet/tests/test_run_engine_critic_inputs.mjs`
Expected: FAIL on the first `assert.match` — the prompt has no `SUITE (driver-run, post-fold)` section.

- [ ] **Step 3: Add the `suiteLine` helper**

In `fleet/run-engine.mjs`, beside the other prompt-fragment helpers (`testCmdLine` at :164, `filesLine` at :168, `interfacesLine` at :170, `siblingLine` at :180):

```javascript
// #458: the driver runs the suite on the folded tree and the critic was never
// told. A read-only critic cannot run it — running a PROGRAM is not classified
// read-only, measured 2026-08-31 (#457) — so it establishes pass/fail by static
// trace and then defers it as `deferred:runtime`. That deferral is manufactured:
// the answer already exists in `lastSuite`. Naming the driver's run authoritative
// is what the contend cell's critic explicitly asked for.
const suiteLine = (suite, cmd) => {
  if (!suite) return ''
  return '\nSUITE (driver-run, post-fold) — this is the authoritative result; ' +
    'do not re-derive it by reading tests.' +
    '\ncommand: ' + (cmd || '(unknown)') +
    '\npassed: ' + Boolean(suite.passed) +
    (suite.passed === false ? '\noutput: ' + tail(suite.output, 500) : '')
}
```

- [ ] **Step 4: Thread it into the critic prompt**

At the critic call site (`run-engine.mjs:1121-1129`), insert `suiteLine(lastSuite, testCmd)` after the `blockedWaves` line and before the `baseline` clause, leaving every existing input in place and in order.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node fleet/tests/test_run_engine_critic_inputs.mjs && node fleet/tests/test_run_engine_gate.mjs && node fleet/tests/test_run_engine.mjs && node fleet/tests/test_run_engine_reconcile.mjs`
Expected: each prints `ALL TESTS PASSED`.

- [ ] **Step 6: Commit**

```bash
git add fleet/run-engine.mjs fleet/tests/test_run_engine_critic_inputs.mjs
git commit -m "fix(#458): the critic receives the driver's post-fold suite result"
```

---

### Task 2: `--check --renders` flags tasks whose claims no sandbox can verify

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Test: `tests/test_check_renders.py`

**Interfaces:**
- Consumes: nothing
- Produces: nothing consumed by another task. Internal: `HAND_EXECUTED_RECORDS`, a module-level tuple of repo-relative paths.

Run-30's three acks were not bad luck. Its RUNBOOK-correcting task's deliverable **was** a set of empirical claims about a live VM — that `pip install --user` refuses under PEP 668, that `bun install --offline` takes 17 ms, that a mis-written `du` prints 535M for `$HOME`. No sandbox can check any of those. **Those acks were guaranteed before the run started, and the plan could have said so.**

`compile_plan.py` already prints advisory lines at `--check --renders` (`:1441`, `:1463`, `:1475`) for blast radius and missing referents. This adds one more: a task that edits a **hand-executed record** — a document whose correctness is established by a human running commands against live infrastructure — cannot have its claims verified from a sandbox, so its author should carry the evidence in the task body.

**Frozen-vocabulary constraint (also in Global Constraints, repeated because it is the way to get this wrong):** advisories are additive and exempt; the `--check` verdict is frozen. This must not change `PLAN OK`, the violation list, or the exit code. A plan that trips this advisory still compiles.

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_check_renders.py`, matching the module's existing subprocess-invocation convention:

```python
HAND_EXECUTED_PLAN = """# P

**Acceptance:** suite — test

### Task 1: Correct the runbook

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `fleet/RUNBOOK.md`

- [ ] **Step 1: fix the install line**

### Task 2: Ordinary code change

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `fleet/run-engine.mjs`

- [ ] **Step 1: do it**
"""


def test_renders_flag_a_task_editing_a_hand_executed_record(tmp_path):
    """#458: run-30's three acks were guaranteed by its Task 5's shape before
    the run started. A sandbox cannot verify a claim about a live VM."""
    plan = tmp_path / "p.md"
    plan.write_text(HAND_EXECUTED_PLAN)
    r = subprocess.run([sys.executable, str(SCRIPT), "--check", "--renders", str(plan)],
                       capture_output=True, text=True)
    assert r.returncode == 0
    assert "PLAN OK" in r.stdout
    assert "ADVISORY unverifiable-from-sandbox: Task 1" in r.stdout
    assert "fleet/RUNBOOK.md" in r.stdout
    # the ordinary task must not be flagged
    assert "Task 2" not in r.stdout.split("ADVISORY unverifiable-from-sandbox")[1]


def test_renders_advisory_does_not_change_the_frozen_verdict(tmp_path):
    """The advisory is additive: the verdict, its wording and the exit code are
    frozen at 0.1.0 and must be byte-identical with and without --renders."""
    plan = tmp_path / "p.md"
    plan.write_text(HAND_EXECUTED_PLAN)
    plain = subprocess.run([sys.executable, str(SCRIPT), "--check", str(plan)],
                           capture_output=True, text=True)
    assert plain.returncode == 0
    assert plain.stdout.strip() == "PLAN OK"
```

- [ ] **Step 2: Run them to verify the first fails**

Run: `python3 -m pytest tests/test_check_renders.py -k unverifiable -v`
Expected: `test_renders_flag_a_task_editing_a_hand_executed_record` FAILS (no such advisory); the frozen-verdict test PASSES already.

- [ ] **Step 3: Add the constant and the advisory**

In `skills/ultrapowers/scripts/compile_plan.py`, near the other advisory machinery:

```python
# Documents whose correctness is established by a human running commands against
# live infrastructure, not by any check in this repo. A task that edits one makes
# claims no sandbox can verify — run-30 drew three `deferred:*` acks that were
# guaranteed by its plan's shape before the run started (#458). Extend this tuple
# when another such record appears; it is deliberately a short explicit list
# rather than a heuristic, because a heuristic here would flag ordinary docs.
HAND_EXECUTED_RECORDS = (
    "fleet/RUNBOOK.md",
    "fleet/tests/PROBES.md",
)
```

In `render_advisories`, after the existing referent lines, append one line per offending task:

```python
    for t in tasks:
        hits = [f for f in (t.get("files") or [])
                if isinstance(f, str) and f in HAND_EXECUTED_RECORDS]
        if hits:
            lines.append(
                "ADVISORY unverifiable-from-sandbox: Task {} edits {} — a "
                "hand-executed record. No reviewer can check its claims from a "
                "sandbox; carry the evidence (commands and their output) in the "
                "task body so review can check correspondence instead of truth."
                .format(t["id"], ", ".join(sorted(hits))))
```

Match the surrounding code's own idiom for iterating tasks and reading their `files` — read the neighbouring advisory blocks first rather than assuming this shape.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest -n auto tests/test_check_renders.py tests/test_plan_check.py tests/test_compile_plan.py tests/test_all_plans_compile.py -v`
Expected: all PASS.

- [ ] **Step 5: Check the advisory against this repo's own plans**

Run: `python3 skills/ultrapowers/scripts/compile_plan.py --check --renders docs/superpowers/plans/2026-08-30-papercuts-slate.md`
Expected: `PLAN OK`, plus the new advisory naming that plan's RUNBOOK-correcting task. That plan is the case this advisory was written from, so it is the honest check.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/scripts/compile_plan.py tests/test_check_renders.py
git commit -m "feat(#458): --renders flags tasks editing hand-executed records as unverifiable from a sandbox"
```

---

### Task 3: ultraplan tells authors to carry the evidence

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultraplan/SKILL.md`
- Test: `tests/test_ultraplan_skill.py`

**Interfaces:**
- Consumes: nothing
- Produces: nothing consumed by another task.

**Shrink budget: net delta ≤ +5 words** over this task's own diff, verified as word-count(after) − word-count(before) with `wc -w skills/ultraplan/SKILL.md`. The file is 3033 against a pinned ceiling of 3038 (`tests/test_skill_budget.py`), so this deliberately consumes the remaining headroom and the next change to this file pays by trimming. Be terse.

Task 2 makes the problem *visible* at compile time. This tells the author what to do about it. The rule is the inversion that makes an unverifiable claim checkable: a reviewer in a sandbox cannot establish whether "PEP 668 refuses this install" is **true**, but it can check whether the diff **corresponds** to evidence the plan carries.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_ultraplan_skill.py`, matching the module's existing root-path convention:

```python
def test_authoring_rules_require_evidence_for_live_world_claims():
    """#458: run-30's acks were guaranteed by its plan's shape. A reviewer can
    check correspondence to recorded evidence; it cannot check truth."""
    text = (ROOT / "skills/ultraplan/SKILL.md").read_text()
    assert "correspondence" in text
    assert "hand-executed record" in text
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python3 -m pytest tests/test_ultraplan_skill.py -k evidence -v`
Expected: FAIL on the first assertion.

- [ ] **Step 3: Record the before-count**

Run: `wc -w skills/ultraplan/SKILL.md`
Expected: `3033`. Step 5 subtracts from it.

- [ ] **Step 4: Add the rule**

In `skills/ultraplan/SKILL.md` §Authoring rules (the worktree-pure contract), add one bullet in the existing style:

```
- **Claims about the live world carry their evidence.** A task editing a
  hand-executed record (`fleet/RUNBOOK.md`) or asserting what a live system does
  cannot have its claims verified from a sandbox — the reviewer defers, every
  time. Paste the commands and their output into the task body so review checks
  **correspondence** to recorded evidence rather than truth it cannot reach.
  `compile_plan.py --check --renders` flags these tasks.
```

- [ ] **Step 5: Verify the budget and the tests**

Run: `wc -w skills/ultraplan/SKILL.md && python3 -m pytest -n auto tests/test_ultraplan_skill.py tests/test_skill_budget.py tests/test_marker_contract.py tests/test_recommendation_rubric.py -v`
Expected: the word count is **≤ 3038**, and all tests PASS. If it came out above, trim inside the bullet above — do not raise the ceiling in `tests/test_skill_budget.py`, which is a release-only act.

- [ ] **Step 6: Commit**

```bash
git add skills/ultraplan/SKILL.md tests/test_ultraplan_skill.py
git commit -m "docs(#458): ultraplan rule — claims about the live world carry their evidence"
```

---

### Task 4: Suite gate

**Type:** gate
**Depends-on:** 1, 2, 3

**Files:**
- none

- [ ] **Step 1: Run the full suite**

Run: `python3 -m pytest -n auto`
Expected: all tests pass, including `tests/test_fleet_suite.py` (which bridges every `fleet/tests/test_*.mjs`, the new `test_run_engine_critic_inputs.mjs` included), `tests/test_skill_budget.py` and `tests/test_update_cli.py`.

- [ ] **Step 2: Validate both skills**

Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan`
Expected: both print their OK line.

## Operator smoke

- **do:** `python3 skills/ultrapowers/scripts/compile_plan.py --check --renders docs/superpowers/plans/2026-08-30-papercuts-slate.md`
  **see:** `PLAN OK`, followed by an `ADVISORY unverifiable-from-sandbox` line naming its RUNBOOK-correcting task — the plan whose three acks prompted this work.

- **do:** `python3 skills/ultrapowers/scripts/compile_plan.py --check docs/superpowers/plans/2026-08-30-papercuts-slate.md` (no `--renders`)
  **see:** exactly `PLAN OK` and nothing else. The advisory is additive; the frozen verdict is unchanged.

- **do:** `grep -n "SUITE (driver-run, post-fold)" fleet/run-engine.mjs`
  **see:** one match, in the critic's prompt assembly — the result the `contend` cell's critic asked for and did not get.

- **do:** Open `skills/ultraplan/SKILL.md` and search for "correspondence".
  **see:** a rule telling an author that a task asserting live-world facts must paste the commands and their output into the task body.

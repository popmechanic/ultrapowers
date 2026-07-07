# Single-Channel Task Knobs Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the per-task `tier`/`review` knob slots from the launch file (which the engine never reads) onto the args wave entries (which it does), so filled knobs actually apply — fixing [#89](https://github.com/popmechanic/ultrapowers/issues/89).

**Architecture:** One representation change in `compile_plan.py` (slots emitted on `launch_waves` entries; launch payload drops its knob keys), plus the driver's guidance strings and a pre-launch enum check in `ultra_run.py`, plus four wording fixes in `SKILL.md`. `waves.js` already reads `task.tier`/`task.review` from the wave entries and is untouched.

**Tech Stack:** Python 3 (stdlib only), pytest.

**Acceptance:** suite — ultrapowers' own engine-script + skill-doc change; author and operator read the diffs; the committed suite, drift pins, and per-task review are the verification.

**Spec:** `docs/superpowers/specs/2026-07-07-single-channel-task-knobs-design.md`

## Global Constraints

- `skills/ultrapowers/harnesses/waves.js` must not change (no harness JS diff — the suite-gate's `.mjs` sims must not be triggered; `sim_workflow.mjs` scenario 6 already pins that `task.tier` on a wave entry drives the dispatched model).
- No new dependencies; no Anthropic SDK or API key anywhere (house rule).
- Tier enum, everywhere it is named: `cheap` | `standard` | `mostCapable`, plus the plan-idiom alias `most-capable` (`waves.js:508` normalizes it). Review enum: `lean` | `adversarial`.
- Complexity ratchet budget on `skills/ultrapowers/SKILL.md`: `skillWords` ≤ 1800 (aim ≤ 1784, the current baseline), `standingConcepts` ≤ 56.

---

### Task 1: Compiler emits knob slots on the args wave entries

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `tests/test_compile_plan.py`
- Modify: `tests/test_ultra_run.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: args-skeleton wave entries (both `--emit-args` file `waves` and compiler-stdout `launch_waves`) each carry `"tier": null` and `"review": "lean" | "adversarial"`; the `--emit-launch` payload's `tasks` carry **no** `tier` or `review` key.

- [ ] **Step 1: Write the failing tests in `tests/test_compile_plan.py`**

Replace the entire function `test_emit_launch_pre_emits_tier_slots` (at ~line 2448, just below the local `sh` helper) with these two functions:

```python
def test_emit_args_pre_emits_knob_slots(tmp_path):
    """Per-task knob slots ride the args wave entries — the object waves.js
    actually reads (#89: launch-file slots were filled but never consumed).
    tier is a null slot the orchestrator fills; review is plan-authored."""
    plan = tmp_path / "plan.md"
    plan.write_text(
        "# P\n\n**Acceptance:** waived — test fixture\n\n"
        "### Task 1: A\n\n**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Create: `a.py`\n\n- [ ] **Step 1: do**\n\n"
        "### Task 2: B\n\n**Type:** implementation\n**Depends-on:** 1\n\n"
        "**Files:**\n- Create: `b.py`\n\n- [ ] **Step 1: do**\n"
    )
    launch = tmp_path / "launch.json"
    args = tmp_path / "args.json"
    sh([sys.executable, str(COMPILER), str(plan),
        "--emit-launch", str(launch), "--emit-args", str(args)])
    skel = json.loads(args.read_text())
    entries = [t for wave in skel["waves"] for t in wave]
    assert entries, "no wave entries emitted"
    for t in entries:
        assert "tier" in t and t["tier"] is None
        assert t["review"] == "lean"


def test_emit_launch_carries_no_knob_slots(tmp_path):
    """The launch file is bodies + context only. A tier/review key here is
    the dual channel regrowing — the exact defect #89 removed."""
    plan = tmp_path / "plan.md"
    plan.write_text(
        "# P\n\n**Acceptance:** waived — test fixture\n\n"
        "### Task 1: A\n\n**Type:** implementation\n**Depends-on:** none\n\n"
        "**Files:**\n- Create: `a.py`\n\n- [ ] **Step 1: do**\n"
    )
    launch = tmp_path / "launch.json"
    args = tmp_path / "args.json"
    sh([sys.executable, str(COMPILER), str(plan),
        "--emit-launch", str(launch), "--emit-args", str(args)])
    payload = json.loads(launch.read_text())
    assert payload["tasks"], "no tasks emitted"
    for t in payload["tasks"]:
        assert "tier" not in t and "review" not in t
```

Then add this helper directly below the existing `_emit_launch_payload` helper (~line 2501) — do not modify `_emit_launch_payload` itself; the catch-all test still uses it:

```python
def _emit_args_entries(tmp_path, plan_markdown, name="plan.md"):
    """Compile plan_markdown with --emit-launch/--emit-args and return the
    args skeleton's wave entries keyed by task id — the knob channel the
    engine reads (#89). Asserts a clean compile."""
    plan = tmp_path / name
    plan.write_text(plan_markdown)
    launch = tmp_path / "launch.json"
    argsf = tmp_path / "args.json"
    p = sh([sys.executable, str(COMPILER), str(plan),
            "--emit-launch", str(launch), "--emit-args", str(argsf)])
    assert p.returncode == 0, p.stderr
    skel = json.loads(argsf.read_text())
    return {t["id"]: t for wave in skel["waves"] for t in wave}
```

Then migrate the two review-slot tests (leave `test_invalid_review_value_is_a_compile_error` untouched). Replace:

```python
def test_review_marker_emits_adversarial_slot(tmp_path):
    payload = _emit_launch_payload(tmp_path, REVIEW_PLAN)
    by_id = {t["id"]: t for t in payload["tasks"]}
    assert by_id["1"]["review"] == "adversarial"


def test_unmarked_task_emits_lean_review_slot(tmp_path):
    payload = _emit_launch_payload(tmp_path, REVIEW_PLAN)
    by_id = {t["id"]: t for t in payload["tasks"]}
    assert by_id["2"]["review"] == "lean"
```

with:

```python
def test_review_marker_emits_adversarial_slot(tmp_path):
    by_id = _emit_args_entries(tmp_path, REVIEW_PLAN)
    assert by_id["1"]["review"] == "adversarial"


def test_unmarked_task_emits_lean_review_slot(tmp_path):
    by_id = _emit_args_entries(tmp_path, REVIEW_PLAN)
    assert by_id["2"]["review"] == "lean"
```

- [ ] **Step 2: Update the driver's emit-shape assertions in `tests/test_ultra_run.py`**

In `test_happy_path_receipt` (~lines 61–64), replace:

```python
    # Task-1 contract: tier slots pre-emitted, named in llmDerives
    launch = json.loads((run_dir / "launch.json").read_text())
    assert all(t["tier"] is None for t in launch["tasks"])
    assert any("tier" in d for d in receipt["llmDerives"])
```

with:

```python
    # Knob contract (#89): slots ride the args wave entries the engine reads;
    # the launch file carries bodies + context only.
    launch = json.loads((run_dir / "launch.json").read_text())
    assert all("tier" not in t and "review" not in t for t in launch["tasks"])
    skel = json.loads((run_dir / "args.json").read_text())
    entries = [t for wave in skel["waves"] for t in wave]
    assert entries and all(t["tier"] is None for t in entries)
    assert all(t["review"] in ("lean", "adversarial") for t in entries)
    assert any("tier" in d for d in receipt["llmDerives"])
```

- [ ] **Step 3: Run the changed tests to verify they fail**

Run: `python3 -m pytest tests/test_compile_plan.py -k "knob_slots or review_marker_emits or unmarked_task_emits" tests/test_ultra_run.py::test_happy_path_receipt -v`
Expected: FAIL — `test_emit_args_pre_emits_knob_slots` and the review tests fail with `KeyError: 'tier'`/`'review'` (args entries lack the keys); `test_emit_launch_carries_no_knob_slots` and `test_happy_path_receipt` fail on `"tier" not in t` (launch payload still carries slots).

- [ ] **Step 4: Implement the emit change in `skills/ultrapowers/scripts/compile_plan.py`**

Replace the `launch_waves` construction (~line 1556):

```python
    launch_waves = [
        [{"id": tid, "title": by_id[tid]["title"], "files": _files_for(by_id[tid]),
          "depends_on": by_id[tid]["depends_on"],
          "interfaces": by_id[tid]["interfaces"],
          # Declared open write set (#85, additive — None when the task has
          # no `- catch-all:` bullet). waves.js ignores unknown fields today;
          # not touched by this plan.
          "catchAll": by_id[tid].get("catch_all")} for tid in wave]
        for wave in waves]
```

with:

```python
    launch_waves = [
        [{"id": tid, "title": by_id[tid]["title"], "files": _files_for(by_id[tid]),
          "depends_on": by_id[tid]["depends_on"],
          "interfaces": by_id[tid]["interfaces"],
          # Single-channel knob slots (#89): waves.js reads task.tier and
          # task.review from these inline entries — the ONLY channel (workflow
          # scripts cannot read files, so knobs never ride the launch file).
          # The orchestrator fills tier; review is plan-authored (**Review:**
          # marker, "lean" when unmarked) and never touched.
          "tier": None,
          "review": by_id[tid].get("review") or "lean",
          # Declared open write set (#85, additive — None when the task has
          # no `- catch-all:` bullet).
          "catchAll": by_id[tid].get("catch_all")} for tid in wave]
        for wave in waves]
```

Then in the `launch_payload` construction (~line 1591), delete the `tier` and `review` entries and their comments. Replace:

```python
            "tasks": [{"id": tid, "title": by_id[tid]["title"],
                       "body": by_id[tid]["body"], "files": _files_for(by_id[tid]),
                       "depends_on": by_id[tid]["depends_on"],
                       "interfaces": by_id[tid]["interfaces"],
                       # Pre-emitted slot: the orchestrator fills per-task tiers
                       # HERE (never as a top-level launch key, never via
                       # tierOverrides, which remaps tier names to models).
                       "tier": None,
                       # Authored value — filled by the plan's **Review:**
                       # marker, "lean" when unmarked. Unlike the tier slot,
                       # the orchestrator fills nothing here.
                       "review": by_id[tid].get("review") or "lean",
                       # Declared open write set (#85) — shown to the
                       # implementer prompt so a catch-all task's scope is
                       # never silently invisible. None when absent.
                       "catchAll": by_id[tid].get("catch_all")}
                      for wave in waves for tid in wave],
```

with:

```python
            "tasks": [{"id": tid, "title": by_id[tid]["title"],
                       "body": by_id[tid]["body"], "files": _files_for(by_id[tid]),
                       "depends_on": by_id[tid]["depends_on"],
                       "interfaces": by_id[tid]["interfaces"],
                       # No knob slots here (#89): the engine cannot read this
                       # file — tier/review ride the args wave entries. Task
                       # agents read only their body + context from this file.
                       # Declared open write set (#85) — shown to the
                       # implementer prompt so a catch-all task's scope is
                       # never silently invisible. None when absent.
                       "catchAll": by_id[tid].get("catch_all")}
                      for wave in waves for tid in wave],
```

- [ ] **Step 5: Run the changed tests to verify they pass**

Run: `python3 -m pytest tests/test_compile_plan.py tests/test_ultra_run.py -v`
Expected: PASS (all tests in both files, including `test_emit_args_writes_complete_launch_skeleton`, which asserts `skel["waves"] == out["launch_waves"]` — both sides now carry the slots).

- [ ] **Step 6: Run the full suite**

Run: `python3 -m pytest`
Expected: all pass. If any other test pins the old launch-payload knob shape, it is asserting the dual channel — migrate its assertion to the args entries following the pattern in Step 1, and say so in the commit message.

- [ ] **Step 7: Commit**

```bash
git add skills/ultrapowers/scripts/compile_plan.py tests/test_compile_plan.py tests/test_ultra_run.py
git commit -m "fix(compile): emit tier/review knob slots on the args wave entries, not the launch file (#89)"
```

### Task 2: Driver guidance points at the args channel; validate-knobs enum-checks the slots

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `skills/ultrapowers/scripts/ultra_run.py`
- Modify: `tests/test_ultra_run.py`

**Interfaces:**
- Consumes: the args wave-entry knob shape from Task 1 (`tier: null`, `review: "lean" | "adversarial"` on every entry).
- Produces: `validate_knobs(args_path, root)` additionally fails closed (exit 1, JSON verdict naming the task id) on a tier outside `{null, cheap, standard, mostCapable, most-capable}` or a review outside `{lean, adversarial}`; `LLM_DERIVES[0]` names `waves[][].tier` in the args file.

- [ ] **Step 1: Write the failing tests in `tests/test_ultra_run.py`**

Add after the existing `test_validate_knobs_is_a_noop_without_bootstrap` (~line 140):

```python
def test_validate_knobs_accepts_filled_knob_slots(tmp_path):
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"waves": [
        [{"id": "1", "tier": "mostCapable", "review": "adversarial"},
         {"id": "2", "tier": None, "review": "lean"}],
        [{"id": "3", "tier": "most-capable", "review": "lean"}],
    ]}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode == 0, r.stdout + r.stderr


def test_validate_knobs_rejects_an_unknown_tier(tmp_path):
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"waves": [
        [{"id": "1", "tier": "opus", "review": "lean"}]]}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode != 0
    verdict = json.loads(r.stdout)
    assert verdict["ok"] is False
    assert "task 1" in verdict["detail"] and "tier" in verdict["detail"]


def test_validate_knobs_rejects_a_missing_review(tmp_path):
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"waves": [[{"id": "1", "tier": None}]]}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode != 0
    verdict = json.loads(r.stdout)
    assert "review" in verdict["detail"]
```

Then in `test_happy_path_receipt`, replace the line:

```python
    assert any("tier" in d for d in receipt["llmDerives"])
```

with:

```python
    assert any("waves[][].tier" in d for d in receipt["llmDerives"])
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `python3 -m pytest tests/test_ultra_run.py -v`
Expected: `test_validate_knobs_rejects_an_unknown_tier`, `test_validate_knobs_rejects_a_missing_review`, and `test_happy_path_receipt` FAIL (current `validate_knobs` ignores `waves`, so both reject-cases exit 0; the receipt string still says "launch file"). `test_validate_knobs_accepts_filled_knob_slots` passes already — it is the regression guard for the accept path.

- [ ] **Step 3: Implement in `skills/ultrapowers/scripts/ultra_run.py`**

Replace the `LLM_DERIVES` constant (~line 36):

```python
LLM_DERIVES = [
    "waves[][].tier on the args-file wave entries (slots pre-emitted as null; "
    "the engine reads knobs ONLY from these inline entries — never a top-level "
    "launch key, never tierOverrides, which remaps tier names to models)",
    "testCmd — run-wide and/or per-task, only when detection would guess wrong",
    "bootstrapCmd — per-worktree dependency install for fresh worktrees; "
    "validate with --validate-knobs before launch",
    "nothing for review depth — it is plan-authored (**Review:** marker), "
    "pre-filled on the args wave entries",
]
```

Add module constants directly below `LLM_DERIVES`:

```python
VALID_TIERS = {None, "cheap", "standard", "mostCapable", "most-capable"}
VALID_REVIEWS = {"lean", "adversarial"}
```

In `validate_knobs`, update the docstring and insert the enum loop between the `knobs = json.loads(...)` block and the `cmd = knobs.get("bootstrapCmd")` line:

```python
def validate_knobs(args_path, root):
    """Pre-launch knob validation, fail-closed (#89): every wave entry's
    tier/review must be a value the engine accepts, and a bootstrapCmd must
    be a clean no-op on the session checkout — a bad knob otherwise fails
    inside every worktree simultaneously. Exit 0 = safe."""
    try:
        knobs = json.loads(Path(args_path).read_text())
    except (OSError, json.JSONDecodeError) as e:
        print(json.dumps({"ok": False, "stage": "knob-validate",
                          "detail": "unreadable args file: %s" % e}))
        return 1
    for wave in knobs.get("waves") or []:
        for t in wave:
            tid = t.get("id", "?")
            if t.get("tier") not in VALID_TIERS:
                print(json.dumps({"ok": False, "stage": "knob-validate",
                                  "detail": "task %s: tier %r is not "
                                            "null|cheap|standard|mostCapable"
                                            % (tid, t.get("tier"))}))
                return 1
            if t.get("review") not in VALID_REVIEWS:
                print(json.dumps({"ok": False, "stage": "knob-validate",
                                  "detail": "task %s: review %r is not "
                                            "lean|adversarial"
                                            % (tid, t.get("review"))}))
                return 1
    cmd = knobs.get("bootstrapCmd")
```

Everything from `cmd = knobs.get("bootstrapCmd")` down is unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_ultra_run.py -v`
Expected: PASS, including the four pre-existing bootstrap validate-knobs tests (their args files have no `waves` key, so the new loop is a no-op for them).

- [ ] **Step 5: Run the full suite**

Run: `python3 -m pytest`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/scripts/ultra_run.py tests/test_ultra_run.py
git commit -m "feat(driver): enum-check knob slots pre-launch; llmDerives points at the args channel (#89)"
```

### Task 3: SKILL.md knob guidance repoints at the args wave entries

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`

**Interfaces:**
- Consumes: nothing from other tasks (prose describes the same contract Task 1 implements; no code or test dependency).
- Produces: nothing other tasks rely on.

- [ ] **Step 1: Apply the four wording edits**

Edit A — Step 2 lead-in. Replace:

```markdown
**Derive only your knobs**, which land in named slots — per-task `tier` fills the
receipt's `launchFile` (slots pre-emitted as `null`); `testCmd` / `bootstrapCmd`
and any review override ride the launch args. The receipt's `llmDerives` list is
the checklist:
```

with:

```markdown
**Derive only your knobs**, which land in named slots — per-task `tier` fills the
wave entries of the receipt's `argsFile` (slots pre-emitted as `null`; the engine
reads knobs only from these inline entries); `testCmd` / `bootstrapCmd` ride the
same args file. The receipt's `llmDerives` list is the checklist:
```

Edit B — the validate line. Replace:

```markdown
Before launch, `ultra_run.py --validate-knobs <argsFile>` verifies any
`bootstrapCmd` no-ops cleanly on the session checkout.
```

with:

```markdown
Before launch, `ultra_run.py --validate-knobs <argsFile>` verifies any
`bootstrapCmd` no-ops cleanly on the session checkout and each wave entry's
`tier`/`review` value is one the engine accepts.
```

Edit C — the review-depth passage. Replace:

```markdown
Review depth is **plan-authored**: ultraplan's `**Review:**` marker fills each
task's `review` slot (`lean` when unmarked), shown in the render; never set
```

with:

```markdown
Review depth is **plan-authored**: ultraplan's `**Review:**` marker pre-fills each
wave entry's `review` slot (`lean` when unmarked), shown in the render; never set
```

Edit D — Step 4c, directly before the sentence beginning `` `args.edges` drives dependency blocking ``, insert:

```markdown
Your `tier` fills ride inside `argsFile.waves` — merge only run-wide knobs.
```

- [ ] **Step 2: Verify no stale launch-file knob references remain**

Run: `grep -n "launchFile" skills/ultrapowers/SKILL.md`
Expected: no hit that associates `launchFile` with `tier`, `review`, or slot-filling (hits about task bodies/`wavesPath` are fine).

- [ ] **Step 3: Check the ratchet budget (hard acceptance criterion)**

Run: `python3 skills/ultralearn/scripts/complexity_metric.py --baseline skills/ultralearn/complexity-baseline.json`
Expected: `skillWords` ≤ 1800 (aim ≤ 1784) and `standingConcepts` ≤ 56. If `skillWords` exceeds the budget, trim Step 2 prose to fit — the knob checklist bullets tolerate tightening; do not cut the enum sentence from Edit B.

- [ ] **Step 4: Run the pinned-text tests**

Run: `python3 -m pytest tests/test_recommendation_rubric.py tests/test_no_prompt_drift.py -v && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers`
Expected: PASS / exit 0 (the edits touch none of the mirrored rubric or baked-prompt sections).

- [ ] **Step 5: Run the full suite**

Run: `python3 -m pytest`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/SKILL.md
git commit -m "docs(skill): repoint knob guidance at the args wave entries (#89)"
```

### Task 4: Verification gate

**Type:** gate
**Depends-on:** 1, 2, 3

**Files:**
- Test: `tests/`

- [ ] **Step 1: Full suite green on the integrated tree**

Run: `python3 -m pytest`
Expected: all pass, count ≥ 565 (the pre-change baseline).

- [ ] **Step 2: Skill validation**

Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan`
Expected: both exit 0.

- [ ] **Step 3: Ratchet check (advisory)**

Run: `python3 skills/ultralearn/scripts/complexity_metric.py --baseline skills/ultralearn/complexity-baseline.json`
Expected: no `RATCHET:` deltas; `standingConcepts` ≤ 56.

# Authored Review Depth + Loop Hardening Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Review depth becomes a plan-authored property (`**Review:**` marker → compiler-emitted slot) and the engine's risk heuristics are deleted (#87); plus four loop-hardening fixes (receipt harvesting, deferredVerification checklist, byte-compare reviewer rule, knob pre-validation) and the exemplar docs.

**Architecture:** The compiler (`compile_plan.py`) parses one new optional header marker and pre-emits a per-task `review` slot exactly as the 0.0.31 tier slots are emitted; `waves.js` drops `RISK_PATH`/`isRiskSurface`/the sonnet floor and collapses `taskReviewProfile` to force-up semantics over the authored slot. Hardening items are independent single-surface fixes.

**Tech Stack:** Python 3 (pytest), Node (harness `.mjs` sims), markdown reference docs with anti-drift pin tests.

**Spec:** `docs/superpowers/specs/2026-07-03-authored-review-depth-design.md`

**Acceptance:** suite — ultrapowers engine/skill development; the committed pytest suite, the drift pins, the harness sims, and per-task adversarial review are the verification.

## Global Constraints

- Prompts are baked: change `references/reviewer-prompts.md` (the source), copy the changed wording into the matching `const` in `harnesses/waves.js` per `references/workflow-template.md` §Re-bake, and keep `pytest tests/test_no_prompt_drift.py` green. Never edit only the baked copy.
- `harnesses/waves.js` changes MUST be covered by a `tests/*.mjs` sim that references `harnesses/` and prints the exact sentinel `ALL SCENARIOS PASSED` on success (the suite-gate greps for `ALL (SCENARIOS|TESTS) PASSED` and refuses a green without it).
- No `anthropic` SDK and no `ANTHROPIC_API_KEY` anywhere — LLM work happens only inside Claude Code.
- `plugin.json` and `marketplace.json` stay untouched (release ritual is out of scope for this plan).
- The full check suite is `python3 -m pytest` from the repo root; expect every test green before any commit.
- `skills/ultrapowers/SKILL.md` and other gate-spec surfaces are complexity-ratcheted: after editing them, run `python3 skills/ultralearn/scripts/complexity_metric.py --baseline skills/ultralearn/complexity-baseline.json`; if metrics changed, regenerate the baseline with the metric script itself (`python3 skills/ultralearn/scripts/complexity_metric.py > skills/ultralearn/complexity-baseline.json`) and commit it — never hand-edit the baseline JSON.

---

### Task 1: Parse the `**Review:**` marker and pre-emit per-task review slots

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Test: `tests/test_compile_plan.py`

**Interfaces:**
- Consumes: nothing
- Produces: every task object in the `--emit-launch` file carries a `"review"` key — `"adversarial"` when the task's header block has `**Review:** adversarial`, `"lean"` otherwise (authored value, emitted filled, unlike the null tier slot the orchestrator fills); an invalid or duplicate `**Review:**` value is a compile-time `SystemExit`

**Parallelization rationale:** contract root — the `review` slot is the authored-depth contract the engine task and the docs task build against; parsing is confined to `compile_plan.py`, colliding with no sibling.

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_compile_plan.py`, following the file's existing helpers for writing a temp plan and invoking the compiler (mirror the style of `test_global_constraints_and_interfaces_parse_into_new_fields` at ~line 1721; reuse its plan-builder/compile helpers rather than inventing new ones):

```python
REVIEW_PLAN = """# P

**Acceptance:** suite — test

### Task 1: Risky core

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `src/a.py`

- [ ] **Step 1: do it**

### Task 2: Quiet follower

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `src/b.py`

- [ ] **Step 1: do it**
"""


def test_review_marker_emits_adversarial_slot(tmp_path):
    launch = compile_launch(tmp_path, REVIEW_PLAN)  # use the file's existing helper
    by_id = {t["id"]: t for t in launch["tasks"]}
    assert by_id["1"]["review"] == "adversarial"


def test_unmarked_task_emits_lean_review_slot(tmp_path):
    launch = compile_launch(tmp_path, REVIEW_PLAN)
    by_id = {t["id"]: t for t in launch["tasks"]}
    assert by_id["2"]["review"] == "lean"


def test_invalid_review_value_is_a_compile_error(tmp_path):
    bad = REVIEW_PLAN.replace("**Review:** adversarial", "**Review:** paranoid")
    with pytest.raises(SystemExit) as exc:
        compile_launch(tmp_path, bad)
    msg = str(exc.value)
    assert "Task 1" in msg and "adversarial" in msg and "lean" in msg


def test_duplicate_review_marker_is_a_compile_error(tmp_path):
    dup = REVIEW_PLAN.replace(
        "**Review:** adversarial",
        "**Review:** adversarial\n**Review:** lean")
    with pytest.raises(SystemExit) as exc:
        compile_launch(tmp_path, dup)
    assert "duplicate" in str(exc.value).lower() and "Task 1" in str(exc.value)
```

If the file has no single `compile_launch` helper, write the temp plan and call the module's parse/emit path the way the neighboring launch-emission tests (~line 1305 region coverage, e.g. the tier-slot tests) do — do not shell out per test.

- [ ] **Step 2: Run them to verify they fail**

Run: `python3 -m pytest tests/test_compile_plan.py -k review -v`
Expected: FAIL — `KeyError: 'review'` (or missing-marker parse), and the two error tests fail because no `SystemExit` is raised.

- [ ] **Step 3: Implement the marker parse + slot emission**

In `skills/ultrapowers/scripts/compile_plan.py`:

(a) Next to `MARKER_DEPS` (~line 34) add:

```python
MARKER_REVIEW = re.compile(r"^\*\*Review:\*\*\s*([a-z-]+)\s*$")
```

(b) Extend `MARKER_ISH` (~line 32) so a near-miss `**Review :**` / `**review**:` form surfaces as a marker near-miss instead of silently degrading to prose:

```python
MARKER_ISH = re.compile(r"^\*\*\s*(type|depends[-\s]on|review)\s*(?:\*\*)?\s*:", re.I)
```

(c) In `parse_task` where the contiguous header-marker block is consumed (the region handling `MARKER_TYPE` at ~lines 255–277 and `MARKER_DEPS` at ~278–301), add a branch mirroring the Type branch (adapt variable names to the local ones — the task id variable and the task dict):

```python
m = MARKER_REVIEW.match(line)
if m:
    val = m.group(1)
    if val not in ("adversarial", "lean"):
        raise SystemExit(
            "Task {}: invalid **Review:** value {!r} "
            "(valid: adversarial, lean)".format(task_id, val))
    if task.get("review"):
        raise SystemExit(
            "Task {}: duplicate **Review:** marker".format(task_id))
    task["review"] = val
    continue
```

The marker obeys the same placement contract as `**Type:**`: only the contiguous block immediately after the task heading counts.

(d) In `main()` where the launch payload's per-task dict is built (~lines 1305–1320, the dict that contains `"tier": None` at ~line 1313), add directly after the tier line:

```python
"review": t.get("review") or "lean",
```

with a one-line comment matching the tier slot's comment style: authored value — filled by the plan's `**Review:**` marker, `lean` when unmarked; the orchestrator fills nothing.

- [ ] **Step 4: Run the tests, then the whole suite**

Run: `python3 -m pytest tests/test_compile_plan.py -k review -v` → all 4 PASS.
Run: `python3 -m pytest` → everything green (the tier-slot pin in `tests/test_ultra_run.py` asserts `tier is None` and is unaffected; if any launch-shape test enumerates task keys exactly, extend its expectation to include `review`).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/compile_plan.py tests/test_compile_plan.py
git commit -m "feat(compiler): parse **Review:** marker, pre-emit per-task review slots (#87)"
```

### Task 2: Document the `Review:` marker — plan-markers.md + ultraplan mirror + authoring guidance

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `skills/ultrapowers/references/plan-markers.md`
- Modify: `skills/ultraplan/SKILL.md`
- Test: `tests/test_ultraplan_skill.py`
- Test: `tests/test_marker_contract.py`

**Interfaces:**
- Consumes: the compiler's `**Review:**` marker semantics (valid values `adversarial`/`lean`, header-block placement, unmarked = lean) from the marker-parsing task
- Produces: the canonical marker contract documents `**Review:**`; the ultraplan skill mirrors it and carries the authoring rubric plus two new authoring-guidance notes (shrink-budget pattern, escalation-prone tiering)

- [ ] **Step 1: Extend the canonical contract**

In `skills/ultrapowers/references/plan-markers.md`, inside the `<!-- BAKE:MARKER_SYNTAX -->` block (~lines 26–34) where `**Type:**` and `**Depends-on:**` are listed, add one line in the same list style:

```markdown
- `**Review:**` — optional; one of `adversarial` or `lean`. Names the tasks that
  earn a second independent review pass. Unmarked tasks are `lean`. An invalid
  or duplicate value is a compile error.
```

Do not add a new BAKE block; extending `MARKER_SYNTAX` keeps the existing mirror pin authoritative.

- [ ] **Step 2: Mirror into ultraplan and add the rubric line**

In `skills/ultraplan/SKILL.md`:

(a) In the "Add markers to every task" section where `**Type:**` and `**Depends-on:**` are described, add the same `**Review:**` list line verbatim (the mirror pin `tests/test_ultraplan_skill.py::test_ultraplan_mirrors_the_canonical_contract` normalizes whitespace/formatting, so the wording must match the canonical block).

(b) Immediately after that list, add the authoring rubric paragraph:

```markdown
While marking the plan, decide review depth explicitly: mark
`**Review:** adversarial` on tasks whose failure is costly or hard to see —
auth, payments, migrations, data integrity, public API, or behavior that is
hard to verify by reading (the routing rubric's risk list). Everything else
stays lean. The engine derives nothing: unmarked means lean, by construction.
```

(c) In the authoring-rules section, add two short guidance notes:

```markdown
- **Shrink budgets are acceptance criteria.** When a task edits a
  complexity-ratcheted surface (SKILL.md, gate-spec docs), state the numeric
  ceiling in the task body ("skillWords < N, standingConcepts ≤ M") — agents
  treat a stated budget as a hard criterion, and it forces net simplification.
- **Tier escalation-prone tasks up front.** Large single-file refactors
  (one big UI component, one long module rewrite) are the tasks that blow the
  StructuredOutput retry cap at lower tiers and pay the task twice — mark
  them `most-capable` in the plan rather than letting the launch guess.
```

- [ ] **Step 3: Run the pins and reconcile**

Run: `python3 -m pytest tests/test_ultraplan_skill.py tests/test_marker_contract.py tests/test_sibling_by_role_rule.py -v`
Expected: PASS. If `test_marker_contract.py` enumerates the marker vocabulary against `compile_plan.py`, extend its expected set with `Review` — preserve each pin's semantics, never delete a pin to get green.

- [ ] **Step 4: Full suite, then commit**

Run: `python3 -m pytest` → green.

```bash
git add skills/ultrapowers/references/plan-markers.md skills/ultraplan/SKILL.md tests/test_ultraplan_skill.py tests/test_marker_contract.py
git commit -m "docs(ultraplan): Review: marker in the canonical contract + authoring rubric and guidance (#87)"
```

### Task 3: Delete the review-depth heuristics from the engine

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Modify: `tests/sim_workflow.mjs`
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`

**Interfaces:**
- Consumes: nothing
- Produces: `taskReviewProfile(task)` = force-up over the authored slot (`task.review === 'adversarial' || reviewProfile === 'adversarial'` → adversarial, else lean); `reviewerModelFor()` = uniformly `DEFAULT_TIER.mostCapable`; `RISK_PATH`, `isRiskSurface`, and the sonnet floor no longer exist

**Parallelization rationale:** seam split — the engine honors whatever `task.review` value arrives in args, so this task tests through the sim with hand-built args and never touches the compiler; it can build in parallel with the marker-parsing task.

- [ ] **Step 1: Rewrite the sim scenarios to pin the NEW behavior (failing first)**

In `tests/sim_workflow.mjs`:

(a) Scenario 7 ("per-task review depth — task.review overrides the run default", ~line 324) stays — retitle it to "per-task review depth — the authored review slot" and keep its assertion that `review: 'adversarial'` yields two independent passes.

(b) Scenario 7b ("ENGINE-derived review depth (risk-based)", ~line 359): replace it entirely with the deletion pin — a task whose files/title would have tripped the old lexicon (e.g. files `['src/auth/login.py']`, title "Payment migration") but with no `review` field gets exactly ONE review pass, and a task with `review: 'lean'` on a risk-looking path also gets one pass. Name it "no engine-derived depth — unmarked risk-looking task stays lean (#87)".

(c) The reviewer-floor scenarios ("reviewer floor — sonnet only for lean+cheap, opus everywhere else", ~line 2423, and "Reviewer floor is override-proof", ~line 2451): replace both with one scenario "reviewer model is uniformly most-capable and override-proof" — a `lean` + `cheap`-tier task's review call uses the DEFAULT most-capable model, and `tierOverrides` remapping `mostCapable` does not change the reviewer model.

(d) Force-up pin: add an assertion that a run with `reviewProfile: 'adversarial'` gives two passes even to a task whose slot says `review: 'lean'` (the hatch raises depth; it never lowers).

Run: `node tests/sim_workflow.mjs`
Expected: FAIL (old engine still derives risk depth and floors the reviewer) — confirm the failures are exactly the rewritten scenarios.

- [ ] **Step 2: Delete the heuristics in `waves.js`**

Replace the block at ~lines 626–668 (the `// Risk-surface detection …` comment, `RISK_PATH`, `isRiskSurface`, `taskReviewProfile`, `reviewerModelFor`, and the sonnet-floor comment) with:

```js
// Review depth per task — an AUTHORED plan property (ultraplan `**Review:**`),
// pre-emitted by compile_plan.py into every task's `review` slot ('lean' when
// unmarked). Force-up semantics: the run-wide reviewProfile:'adversarial'
// escape hatch can only raise depth, never lower an authored adversarial.
// (The heuristic era — RISK_PATH lexicon, isRiskSurface, contract-root
// detection — is deleted: #87. The render now reports a value the engine
// actually uses, by construction.)
const taskReviewProfile = (task) =>
  (task.review === 'adversarial' || reviewProfile === 'adversarial')
    ? 'adversarial' : 'lean'

// Per-task reviewer model: uniformly most-capable, built from DEFAULT_TIER so
// tierOverrides can never weaken the gate. (The lean+cheap sonnet floor is
// deleted with the heuristics — never economize on the checker.)
const reviewerModelFor = () => DEFAULT_TIER.mostCapable
```

Keep the typo guard at ~lines 732–740 (`unknown review="…" falling back to the run default`) — its message stays accurate under force-up semantics. Keep the run-wide `reviewProfile` parsing at ~line 180 unchanged.

- [ ] **Step 3: Update the reviewer-prompts source prose (outside the BAKE blocks)**

In `skills/ultrapowers/references/reviewer-prompts.md`:

(a) Replace the floor paragraph (~lines 112–113, "The reviewer runs at the most-capable tier (`opus`) wherever risk is real … Review *depth* is still set per task (see above).") with:

```markdown
The reviewer always runs at the most-capable tier (`opus`), built from
`DEFAULT_TIER` so `tierOverrides` cannot weaken it — a weak reviewer's failure
mode is the silent false `PASS`, worse than no reviewer. Review *depth* is a
plan-authored property: the ultraplan `**Review:**` marker, compiled into each
task's `review` slot; unmarked tasks are `lean`.
```

(b) In the Model tiers table, change the per-task reviewer row to:

```markdown
| per-task reviewer | `opus` — uniform, no floor | override-proof; `DEFAULT_TIER`-based |
```

and delete the "(floor: `sonnet` for `lean`+`cheap`)" wording anywhere else in the file.

These lines sit outside the `<!-- BAKE: -->` blocks, so `test_no_prompt_drift.py` needs no re-bake for this task — verify that stays true.

- [ ] **Step 4: Run the sim, the drift pin, and the suite**

Run: `node tests/sim_workflow.mjs` → `ALL SCENARIOS PASSED`.
Run: `node tests/wave_ancestry_sim.mjs` → `ALL SCENARIOS PASSED` (untouched, confirm no collateral).
Run: `python3 -m pytest` → green (includes `test_no_prompt_drift.py` and the sim wrappers).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/harnesses/waves.js tests/sim_workflow.mjs skills/ultrapowers/references/reviewer-prompts.md
git commit -m "feat(engine)!: delete review-depth heuristics; authored review slot with force-up semantics; uniform most-capable reviewer (#87)"
```

### Task 4: Byte-compare rule for committed generated artifacts (reviewer prompt)

**Type:** implementation
**Depends-on:** 3

**Files:**
- Modify: `skills/ultrapowers/references/reviewer-prompts.md`
- Modify: `skills/ultrapowers/harnesses/waves.js`

**Interfaces:**
- Consumes: the reviewer-prompt source layout left by the heuristic-deletion task (same two files — write-after-write ordering)
- Produces: the baked reviewer prompt instructs regenerate-and-byte-compare for committed generated artifacts

- [ ] **Step 1: Edit the canonical prompt source**

In `skills/ultrapowers/references/reviewer-prompts.md`, inside the `<!-- BAKE:REVIEWER_PROMPT -->` block (~lines 115–147), add one bullet in the checks list, matching the block's list style:

```markdown
- When the diff commits a generated artifact (a baked copy, a regenerated
  baseline, a build output), regenerate it with its generator and byte-compare
  against the committed copy — never eyeball equivalence. A hand-edited
  artifact that reads plausibly is exactly the false green this catches.
```

- [ ] **Step 2: Re-bake into the engine**

Copy the same wording into the `REVIEWER_PROMPT` const in `skills/ultrapowers/harnesses/waves.js` (formatting need not match; words must — the pin normalizes whitespace).

- [ ] **Step 3: Verify the pin and the sims**

Run: `python3 -m pytest tests/test_no_prompt_drift.py -v` → PASS (containment holds).
Run: `node tests/sim_workflow.mjs` → `ALL SCENARIOS PASSED`.
Run: `python3 -m pytest` → green.

- [ ] **Step 4: Commit**

```bash
git add skills/ultrapowers/references/reviewer-prompts.md skills/ultrapowers/harnesses/waves.js
git commit -m "feat(review): regenerate-and-byte-compare rule for committed generated artifacts"
```

### Task 5: Harvester precision — gate receipts as gateReport, no unknown roles

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultralearn/scripts/harvest_runs.py`
- Modify: `skills/ultrapowers/scripts/audit_run.py`
- Test: `tests/test_harvest_runs.py`
- Test: `tests/test_audit_run.py`

**Interfaces:**
- Consumes: nothing
- Produces: `_gate_report(records)` prefers a printed ultra_gate receipt (`mode == "gate"`, has `verdict`) over the legacy `integrationBranch` scan; `classify(text)` covers every engine agent role (no `"unknown"` for any baked prompt shape)

- [ ] **Step 1: Write the failing tests**

In `tests/test_harvest_runs.py`, following its existing fixture-transcript conventions:

```python
def test_gate_report_prefers_printed_ultra_gate_receipt(tmp_path):
    receipt = {"mode": "gate", "stamp": "20260703-000000",
               "gateCheckExit": 2, "verdict": "NEEDS_ACK",
               "acceptance": {"disposition": "suite", "exit": 0}}
    records = make_records_with_text(  # use the file's existing record builder
        "gate administered:\n" + json.dumps(receipt) + "\ndone")
    got = harvest_runs._gate_report(records)
    assert got is not None and got["verdict"] == "NEEDS_ACK"


def test_gate_report_takes_last_receipt_when_rerun(tmp_path):
    first = {"mode": "gate", "gateCheckExit": 1, "verdict": "BLOCKED"}
    second = {"mode": "gate", "gateCheckExit": 2, "verdict": "NEEDS_ACK"}
    records = make_records_with_text(
        json.dumps(first) + "\nre-ran after parking docs\n" + json.dumps(second))
    assert harvest_runs._gate_report(records)["verdict"] == "NEEDS_ACK"


def test_gate_report_falls_back_to_legacy_scan(tmp_path):
    # a transcript with a real report JSON (integrationBranch) but no printed
    # receipt must keep working exactly as before (pre-driver sessions).
    legacy = {"integrationBranch": "ultra/integration-20260701-000000",
              "tasks": [], "gitVerified": True}
    records = make_records_with_text("final report:\n" + json.dumps(legacy))
    got = harvest_runs._gate_report(records)
    assert got is not None
    assert got["integrationBranch"].startswith("ultra/integration-")
```

If `tests/test_harvest_runs.py` has no `make_records_with_text` helper, add a small local one that builds the record shape `_gate_report` walks — mirror how the file's existing `_gate_report` coverage constructs records; the three tests above are the pinned contract, the helper shape is free.

(Replace the third test's ellipsis with the concrete arrange copied from the file's existing `_gate_report` coverage — same fixture, same assertion; it pins that the fallback path is untouched.)

In `tests/test_audit_run.py`:

```python
# Every engine role prompt must classify; each marker string must exist
# verbatim in the baked source so classifier and engine cannot drift apart.
ENGINE_SOURCES = [
    Path("skills/ultrapowers/harnesses/waves.js").read_text(),
    Path("skills/ultrapowers/references/wave-merge.md").read_text(),
]

def test_every_role_marker_exists_in_baked_sources():
    from audit_run import ROLE_MARKERS
    for marker, _role in ROLE_MARKERS:
        assert any(marker in src for src in ENGINE_SOURCES), marker

def test_no_engine_prompt_classifies_unknown():
    from audit_run import classify, ROLE_MARKERS
    for marker, role in ROLE_MARKERS:
        assert classify("xxx " + marker + " yyy") != "unknown"
```

Then enumerate the engine harness's agent call sites (the labels are impl/review/fix/merge/reconcile/waves-file-check/setup/integration — see the fenced ENGINE_SOURCES above for the two source files to read) and add a marker for each currently-unclassified prompt: read each call site's prompt const, pick a distinctive literal sentence from it, and extend `ROLE_MARKERS`. The two roles observed as `unknown` in the 2026-07-03 bundles are the completeness critic (most-capable, dispatched with the completeness prompt baked in the wave-merge reference) and the waves-file check (cheap, label `waves-file-check`, prompt const near line 1028 of the harness) — cover at least those two plus `fix:` rounds if unclassified.

Run: `python3 -m pytest tests/test_harvest_runs.py tests/test_audit_run.py -v`
Expected: FAIL — receipt preference not implemented; new markers absent.

- [ ] **Step 2: Implement**

(a) `harvest_runs.py` `_gate_report` (~lines 165–184): add a first pass before the legacy scan. Reuse the module's existing text-walking and `_balanced_json` helpers:

```python
receipt = None
# Pass 1 (0.0.31+ driver era): ultra_gate.py prints its gate receipt —
# a JSON object with mode=="gate" and a verdict — on every administered
# gate. Prefer it; take the LAST one (a re-run supersedes a BLOCKED).
for text in texts:  # the same per-record text iteration the legacy scan uses
    i = text.find('"gateCheckExit"')
    while i != -1:
        obj = _balanced_json(text, i)
        if isinstance(obj, dict) and obj.get("mode") == "gate" and "verdict" in obj:
            receipt = obj
        i = text.find('"gateCheckExit"', i + 1)
if receipt is not None:
    return receipt
# Pass 2: legacy integrationBranch scan (pre-driver sessions) — unchanged.
```

Adapt the iteration shape to the function's current structure (it walks `records`; keep its record-to-text extraction exactly as-is). `_balanced_json` brace-matches from an index inside the object — if it expects the index of a `{`, scan back from the found key to the enclosing `{` the same way the legacy pass does.

(b) `audit_run.py`: extend `ROLE_MARKERS` (lines 32–39) with the tuples discovered in Step 1, e.g. (verify each literal against the actual const text before committing):

```python
("You are the completeness critic", "critic"),
("waves file check", "setup"),
```

plus any other call-site prompt that classified `unknown`. Keep the existing six tuples untouched.

- [ ] **Step 3: Run the tests, then the suite**

Run: `python3 -m pytest tests/test_harvest_runs.py tests/test_audit_run.py -v` → PASS.
Run: `python3 -m pytest` → green.

- [ ] **Step 4: Commit**

```bash
git add skills/ultralearn/scripts/harvest_runs.py skills/ultrapowers/scripts/audit_run.py tests/test_harvest_runs.py tests/test_audit_run.py
git commit -m "feat(ultralearn): harvest gate receipts as gateReport; classify every engine role"
```

### Task 6: deferredVerification as the post-merge checklist

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/finishing-notes.md`
- Modify: `skills/ultrapowers/references/report-format.md`
- Modify: `skills/ultraplan/references/seal-author-prompt.md`
- Test: `tests/test_finishing_notes.py`

**Interfaces:**
- Consumes: nothing
- Produces: finishing-notes defines the deferred-verification checklist contract (per-item closure statuses `closed` / `still-open` / `needs-human`); the seal-author prompt requires declared exam exclusions in the coverage summary

- [ ] **Step 1: Write the failing test**

Add to `tests/test_finishing_notes.py`, following its existing read-and-assert style:

```python
def test_finishing_notes_define_the_deferred_verification_checklist():
    text = FINISHING.read_text()  # the file's existing path constant
    assert "deferredVerification" in text
    for status in ("closed", "still-open", "needs-human"):
        assert status in text
    # tracking-only contract: the checklist must not authorize new actions
    assert "authorizes no new autonomous actions" in text
```

Run: `python3 -m pytest tests/test_finishing_notes.py -v`
Expected: the new test FAILS (finishing-notes.md never mentions deferredVerification today).

- [ ] **Step 2: Write the checklist contract**

(a) In `skills/ultrapowers/references/finishing-notes.md`, add a section after the cross-phase section (~line 59):

```markdown
## Deferred-verification checklist

The gate report's `deferredVerification` array is a post-merge obligation
list, not a footnote. After the merge lands, walk it item by item: attempt
closure where tooling exists (run the runtime path, drive the browser flow,
hit the deployed service), and report per-item status in the finishing
summary — `closed` (verified, say how), `still-open` (say what blocks it),
or `needs-human` (say exactly what the operator must do). The checklist
authorizes no new autonomous actions — anything beyond already-authorized
tooling stays `needs-human`. An item nobody closes survives in the summary
by name; it must never silently evaporate between the gate and the handoff.
```

(b) In `skills/ultrapowers/references/report-format.md`, in the deferred-verification presentation section (§9a, ~line 101), add one sentence:

```markdown
After merge, finishing consumes this array as a per-item checklist — see
finishing-notes.md §Deferred-verification checklist.
```

(c) In `skills/ultraplan/references/seal-author-prompt.md`, in the manifest/coverage step (step 4, ~line 36), add:

```markdown
The coverage summary MUST also list every spec section the suite deliberately
does not cover (browser-only, target-runtime-only, environment it cannot
execute) with a one-line reason each — exclusions are vouched by the operator
and flow into the gate's `deferredVerification` checklist.
```

- [ ] **Step 3: Run the pins, then the suite**

Run: `python3 -m pytest tests/test_finishing_notes.py -v` → PASS (including the pre-existing orphan-reference test).
Run: `python3 -m pytest` → green.

- [ ] **Step 4: Commit**

```bash
git add skills/ultrapowers/references/finishing-notes.md skills/ultrapowers/references/report-format.md skills/ultraplan/references/seal-author-prompt.md tests/test_finishing_notes.py
git commit -m "feat(finishing): deferredVerification is a per-item post-merge checklist; seal exclusions flow into it"
```

### Task 7: Knob pre-validation verb + SKILL.md reconciliation

**Type:** implementation
**Depends-on:** 3

**Files:**
- Modify: `skills/ultrapowers/scripts/ultra_run.py`
- Modify: `skills/ultrapowers/SKILL.md`
- Test: `tests/test_ultra_run.py`

**Interfaces:**
- Consumes: the engine's authored-review behavior (heuristics deleted) from the engine task — SKILL.md must describe the shipped behavior, so this task serializes after it
- Produces: `ultra_run.py --validate-knobs <argsFile>` (exit 0 = knobs safe; non-zero with output on a dirty/failing `bootstrapCmd`); SKILL.md describes plan-authored review depth and the knob-validation step

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_ultra_run.py`, following its existing throwaway-repo fixture style:

```python
def test_validate_knobs_passes_a_clean_noop_bootstrap(tmp_repo):
    args = {"bootstrapCmd": "true"}
    args_path = tmp_repo / "args.json"
    args_path.write_text(json.dumps(args))
    rc = run_ultra(tmp_repo, "--validate-knobs", str(args_path))  # existing runner helper
    assert rc == 0


def test_validate_knobs_blocks_a_failing_bootstrap(tmp_repo):
    args_path = tmp_repo / "args.json"
    args_path.write_text(json.dumps({"bootstrapCmd": "false"}))
    assert run_ultra(tmp_repo, "--validate-knobs", str(args_path)) != 0


def test_validate_knobs_blocks_a_tree_dirtying_bootstrap(tmp_repo):
    args_path = tmp_repo / "args.json"
    args_path.write_text(json.dumps({"bootstrapCmd": "touch dirt.txt"}))
    assert run_ultra(tmp_repo, "--validate-knobs", str(args_path)) != 0


def test_validate_knobs_is_a_noop_without_bootstrap(tmp_repo):
    args_path = tmp_repo / "args.json"
    args_path.write_text(json.dumps({"testCmd": "pytest"}))
    assert run_ultra(tmp_repo, "--validate-knobs", str(args_path)) == 0
```

Run: `python3 -m pytest tests/test_ultra_run.py -k validate_knobs -v`
Expected: FAIL — unknown flag.

- [ ] **Step 2: Implement the verb**

In `skills/ultrapowers/scripts/ultra_run.py`, add a `--validate-knobs ARGSFILE` mode alongside the existing verbs (mirror how the file dispatches its other modes; reuse its `stage`/receipt style so output is a JSON receipt with an authoritative exit code):

```python
def validate_knobs(args_path, root):
    """Pre-launch knob validation: a bootstrapCmd must be a clean no-op on the
    session checkout — a bad knob otherwise fails inside every worktree
    simultaneously. Exit 0 = safe (or no bootstrapCmd); non-zero shows why."""
    try:
        knobs = json.loads(Path(args_path).read_text())
    except (OSError, json.JSONDecodeError) as e:
        print(json.dumps({"ok": False, "stage": "knob-validate",
                          "detail": "unreadable args file: %s" % e}))
        return 1
    cmd = knobs.get("bootstrapCmd")
    if not (isinstance(cmd, str) and cmd.strip()):
        print(json.dumps({"ok": True, "stage": "knob-validate",
                          "detail": "no bootstrapCmd — nothing to validate"}))
        return 0
    porcelain = lambda: subprocess.run(
        ["git", "status", "--porcelain"], cwd=root,
        capture_output=True, text=True).stdout
    before = porcelain()
    proc = subprocess.run(cmd, shell=True, cwd=root,
                          capture_output=True, text=True)
    after = porcelain()
    ok = proc.returncode == 0 and before == after
    print(json.dumps({"ok": ok, "stage": "knob-validate",
                      "exit": proc.returncode,
                      "treeClean": before == after,
                      "output": (proc.stdout + proc.stderr)[-2000:]}))
    return 0 if ok else 1
```

Also update the `LLM_DERIVES` list (~line 41): replace `"review-depth overrides (task.review) only as deliberate exceptions"` with `"nothing for review depth — it is plan-authored (**Review:** marker), pre-emitted like tier slots"`, and append to the `bootstrapCmd` line (~line 40): `"; validate with --validate-knobs before launch"`.

- [ ] **Step 3: Reconcile SKILL.md**

In `skills/ultrapowers/SKILL.md`:

(a) Replace the "Review depth stays **engine-derived** …" paragraph (~lines 77–81) with:

```markdown
Review depth is **plan-authored**: the ultraplan `**Review:**` marker compiles
into each task's `review` slot (`lean` when unmarked) — the render shows
exactly what the engine will do. Do not set `task.review` yourself; the
run-wide `reviewProfile: adversarial` hatch can only raise depth.
```

(b) Update Step-3 render item 4 (~line 91): `engine-assigned review depth` → `plan-authored review depth`.

(c) In the knob-derivation step, after the `bootstrapCmd` bullet (~line 73), add: `Validate filled knobs before launch: python3 skills/ultrapowers/scripts/ultra_run.py --validate-knobs <argsFile> — a bootstrapCmd must no-op cleanly on the session checkout.`

Keep the edit word-neutral-or-negative: the replaced review paragraph is longer than its replacement, which buys the knob line.

- [ ] **Step 4: Run everything and reconcile pins**

Run: `python3 -m pytest tests/test_ultra_run.py -v` → PASS (stage-name membership pins unaffected).
Run: `python3 -m pytest` → green; if any SKILL.md word-pin test red, reconcile it preserving its pinned semantics (the pin should now assert the plan-authored wording).
Run: `python3 skills/ultralearn/scripts/complexity_metric.py --baseline skills/ultralearn/complexity-baseline.json` — expect skillWords ≤ 1785 and standingConcepts ≤ 55; if metrics changed, regenerate the baseline with the script and include it in the commit.

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/ultra_run.py skills/ultrapowers/SKILL.md tests/test_ultra_run.py skills/ultralearn/complexity-baseline.json
git commit -m "feat(driver): --validate-knobs pre-launch bootstrap check; SKILL.md describes plan-authored review depth"
```

### Task 8: Exemplar docs — README operator arc

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `README.md`
- Modify: `skills/ultrapowers/references/design-rationale.md`

**Interfaces:**
- Consumes: nothing
- Produces: README and design-rationale carry the field-validated operator-arc exemplar

- [ ] **Step 1: Add the exemplar**

(a) In `README.md`, in the "When to use it — and when not" section (~line 74), add one short paragraph:

```markdown
In field use the human surface compresses to exactly the designed touchpoints:
on a recent 7-task production run the operator's entire involvement was the
planning decisions, vouching for the sealed exam's coverage at launch, and one
physical-world check no tooling could reach (confirming an email landed in a
personal inbox) — everything between launch and the pre-merge gate ran
autonomously, and the operator's unrelated work-in-progress was restored
byte-for-byte.
```

(b) In `skills/ultrapowers/references/design-rationale.md`, add the same observation condensed to 2–3 sentences in whatever section discusses the attention-moving thesis, citing it as 2026-07-03 field evidence (foreign engine run, engine 0.0.30).

- [ ] **Step 2: Verify and commit**

Run: `python3 -m pytest` → green (README has no pins; confirm design-rationale pins, if any, stay green).

```bash
git add README.md skills/ultrapowers/references/design-rationale.md
git commit -m "docs: operator-arc field exemplar (2026-07-03 sense pass)"
```

### Task 9: Suite gate

**Type:** gate
**Depends-on:** 1, 2, 3, 4, 5, 6, 7, 8

**Files:**
- none

- [ ] **Step 1: Run the full gate**

Run from the repo root:

```bash
python3 -m pytest
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers
python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan
node tests/sim_workflow.mjs
node tests/wave_ancestry_sim.mjs
python3 skills/ultralearn/scripts/complexity_metric.py --baseline skills/ultralearn/complexity-baseline.json
```

Expected: pytest fully green; both validators OK; both sims print `ALL SCENARIOS PASSED`; the ratchet reports no over-baseline surface (review-depth concepts deleted should hold standingConcepts at or below 55).

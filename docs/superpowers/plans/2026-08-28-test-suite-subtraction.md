# Test-Suite Subtraction (#331) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drain issue #331 — delete the orphaned shadow-fold module and its tests (788 LOC), consolidate repeated test scaffolding with zero assertion loss, trim ballast pins, and fix the ride-along test defects, all behind the suite gate.

**Architecture:** Pure test-suite subtraction: no file under `fleet/` or `hooks/` changes, and the only `skills/` touch is repointing `harnesses/waves.harness.json`'s `fixtures` key from the deleted shim to `tests/test_js_specs.py` (run-discovered plan defect, Task 3); the non-test deletion is the orphaned `evals/frontier/shadow_fold.py` plus its three public aliases in `evals/frontier/run_eval.py`. Every task edits a disjoint set of files, so all implementation tasks form one wave.

**Tech Stack:** Python/pytest (`python3 -m pytest`, scoped to `tests/` by pytest.ini), node for the `.mjs` specs.

**Spec:** GitHub issue #331 (operator-accepted in full, 2026-08-27; docket `State: accepted`). The four-auditor sweep in that issue is the ranked source; this plan is its execution.

**Acceptance:** suite — the committed suite is the measurement (#331): green before and after, the collected-test-id diff reconciles exactly against the Deletion Manifest appendix, wall-clock not regressed.

## Global Constraints

- **FROZEN diagnostic vocabulary:** no asserted `compile_plan.py` stderr/stdout string may change. The frozen needles that must survive every fold verbatim: `"heading"` (lowercased haystack), `"1.5"`, `"## Task 1:"`, `"EXACTLY three hashes"`, `"did you mean"` (lowercased haystack), `"not recognized"`, `"unknown files label"`, `"violation(s)"`.
- **No edits to the frozen verification periphery:** `run_acceptance.sh`, `gate_check.py`, `ultra_gate.py`, `run_lock.sh`, `collect_seal.py`, `seal_hash.py`, and `tests/test_run_acceptance.py`'s marked-redundant set stay untouched (the only licensed `test_run_acceptance.py` change is the single test RENAME in Task 10).
- **Sentinels survive:** `ALL TESTS PASSED` and `ALL SCENARIOS PASSED` remain the exact success sentinels of every `.mjs` spec — `run_acceptance.sh --suite-gate` greps `ALL (SCENARIOS|TESTS) PASSED`.
- **No assertion lost in a consolidation:** every distinct assertion in a folded test must appear in the replacement; only tests named in the Deletion Manifest may disappear.
- **`.mjs` edits are not suite-covered for the two shimless specs:** `tests/frontier_merge.mjs` and `tests/sim_derived_heads.mjs` run only via the harness-JS suite-gate, which this plan never triggers — any task editing them must run them manually via `node`.
- Suite result after full merge: green, **1152 collected** (baseline 1185 − 33 manifest deletions; renames and parametrizations are count-neutral).

---

### Task 1: Delete the shadow-fold orphan (the clean cut, 788 LOC)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `evals/frontier/shadow_fold.py`
- Modify: `tests/test_shadow_fold.py`
- Modify: `tests/test_shadow_octopus.py`

**Interfaces:**
- Consumes: nothing
- Produces: nothing (pure deletion)

- [ ] **Step 1: Re-verify the orphan claim before deleting**

Run:
```bash
grep -rn "shadow_fold\|shadow_octopus" --include="*.py" --include="*.sh" --include="*.js" --include="*.mjs" --include="*.yml" . | grep -v ".git/" | grep -v "docs/" | grep -v ".claude/" | grep -v "^./tests/test_shadow"
```
Expected: zero hits outside the two test files themselves (verified 2026-08-28: only `tests/test_shadow_octopus.py:14` and `tests/test_shadow_fold.py:10`, both self-references). If any other hit appears, STOP and report instead of deleting.

- [ ] **Step 2: Delete the three files**

```bash
git rm evals/frontier/shadow_fold.py tests/test_shadow_fold.py tests/test_shadow_octopus.py
```

- [ ] **Step 3: Verify collection drops by exactly 11**

Run: `python3 -m pytest --co -q 2>/dev/null | tail -1`
Expected: 11 fewer than the pre-task count (8 tests in `test_shadow_fold.py` + 3 in `test_shadow_octopus.py`).

- [ ] **Step 4: Run the suite**

Run: `python3 -m pytest -q`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git commit -m "test: delete orphaned shadow_fold module + tests (788 LOC, #331 item 1)"
```

---

### Task 2: `test_harvest_runs.py` — extract the `_build` helper

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `tests/test_harvest_runs.py`

**Interfaces:**
- Consumes: nothing
- Produces: module-private `_build(recs, tmp_path, slug="-Users-x-proj", home="-Users-marcusestes-Websites-ultrapowers") -> (out, bundle)` in `tests/test_harvest_runs.py` (not used by any other file)

The file has 32 call sites (108 tests total) repeating: write `recs` to a jsonl session file → `h.build_bundle(session, slug, tmp_path / "cache", home)` → `json.loads((out / "bundle.json").read_text())`.

- [ ] **Step 1: Add the helper near the top of the file (after existing fixtures/constants)**

```python
def _build(recs, tmp_path, slug="-Users-x-proj",
           home="-Users-marcusestes-Websites-ultrapowers"):
    """write recs -> session jsonl -> build_bundle -> (out_dir, parsed bundle).

    bundle is None when build_bundle returns None (non-run sessions)."""
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, slug, tmp_path / "cache", home)
    if out is None:
        return None, None
    return out, json.loads((out / "bundle.json").read_text())
```

- [ ] **Step 2: Convert the call sites**

Convert each of the 32 sites (grep `h.build_bundle` — skip the two `h.harvest(...)` sites in `test_harvest_is_incremental_and_idempotent` and `test_harvest_targets_a_single_project`, which are a different pattern). Known variations to preserve exactly:
- slug values: `"-Users-x-proj"` (default), `"-Users-marcusestes-Documents-Legal-x"` (3 foreign-origin sites), `"-Users-x-foreign"` (1), `"any"` (1)
- home value `"-Users-x-home"` at 3 sites (`test_non_engine_workflow_session_is_not_an_engine_run`, `test_real_engine_session_is_kept_and_tagged`, `test_build_bundle_audits_repeated_transcript_dir_once`) — pass it explicitly
- sites asserting `out is None` use `out, _ = _build(...)` then `assert out is None`
- sites that use the `out` dir beyond `bundle.json` (slice files, paths) keep doing so via the returned `out`

No test function may be added, removed, or renamed; only bodies shrink.

- [ ] **Step 3: Verify count and green**

Run: `python3 -m pytest tests/test_harvest_runs.py -q`
Expected: same test count as before (108), all green.

- [ ] **Step 4: Commit**

```bash
git commit -am "test: extract _build helper in test_harvest_runs (#331 item 2)"
```

---

### Task 3: Consolidate the six node-runner shims into one parametrized runner

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `tests/test_js_specs.py`
- Modify: `tests/test_swarm_layout.py`
- Modify: `tests/test_swarm_meso.py`
- Modify: `tests/test_swarm_zoom.py`
- Modify: `tests/test_audit_project.py`
- Modify: `tests/test_wave_ancestry.py`
- Modify: `tests/test_workflow_sim.py`

**Interfaces:**
- Consumes: the six committed `.mjs` specs (unchanged by this task)
- Produces: `tests/test_js_specs.py::test_js_spec[<spec-file>]` — six parametrized cases replacing six shim tests (count-neutral)

Do NOT touch `tests/test_fleet_suite.py` (different root, npm-install step) or the shimless `frontier_merge.mjs`/`sim_derived_heads.mjs`.

- [ ] **Step 1: Create `tests/test_js_specs.py`**

```python
"""One parametrized runner for the committed node specs/sims (previously six
per-file shims). Requires node; skips without it.

wave_ancestry_sim and sim_workflow run here so the #70 ancestry contract and
the workflow simulation sit in the default `pytest` and CI, not only behind
the harness-JS suite-gate. Sentinels are load-bearing: run_acceptance.sh
--suite-gate greps `ALL (SCENARIOS|TESTS) PASSED`."""
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]

SPECS = [
    ("swarm_layout_spec.mjs", "ALL TESTS PASSED"),
    ("swarm_meso_spec.mjs", "ALL TESTS PASSED"),
    ("swarm_zoom_spec.mjs", "ALL TESTS PASSED"),
    ("audit_project_spec.mjs", "ALL TESTS PASSED"),
    ("wave_ancestry_sim.mjs", "ALL SCENARIOS PASSED"),
    ("sim_workflow.mjs", "ALL SCENARIOS PASSED"),
]


@pytest.mark.parametrize("spec,sentinel", SPECS, ids=[s for s, _ in SPECS])
def test_js_spec(spec, sentinel):
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not available")
    p = subprocess.run([node, str(ROOT / "tests" / spec)],
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stdout + p.stderr
    assert sentinel in p.stdout, p.stdout + p.stderr
```

- [ ] **Step 2: Delete the six shim files**

```bash
git rm tests/test_swarm_layout.py tests/test_swarm_meso.py tests/test_swarm_zoom.py tests/test_audit_project.py tests/test_wave_ancestry.py tests/test_workflow_sim.py
```

- [ ] **Step 3: Verify the runner is green and count-neutral**

Run: `python3 -m pytest tests/test_js_specs.py -v`
Expected: 6 passed (or 6 skipped where node is absent). Net collected delta for the task: 0.

- [ ] **Step 4: Commit**

```bash
git commit -m "test: fold six node-runner shims into parametrized test_js_specs (#331 item 2)"
```

---

### Task 4: `sim_workflow.mjs` contained-fault parameterization + `frontier_merge.mjs` stale comment

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `tests/sim_workflow.mjs`
- Modify: `tests/frontier_merge.mjs`

**Interfaces:**
- Consumes: nothing from other tasks
- Produces: nothing consumed elsewhere (scenario names and the `ALL SCENARIOS PASSED` sentinel are preserved byte-identical)

- [ ] **Step 1: Fold the four merge/reconcile contained-fault scenarios**

The five-member family: `scenarioMergeThrowContained` (line ~1791), `scenarioReconcileThrowContained` (~1809), `scenarioIntegrationThrowContained` (~1829), `scenarioMergeNullContained` (~3070), `scenarioReconcileNullContained` (~3091). The throw/null variants differ by ONE agent-handler line (`throw new Error(...)` vs `return null`), the assertion-message prefix, and (reconcile-null only) one extra `detail` regex assertion. Fold the two merge variants into one parameterized helper and the two reconcile variants into another (e.g. `makeMergeFaultScenario(faultFn, tag)` / `makeReconcileFaultScenario(faultFn, tag, extraAssert)`), keeping:
- every existing assertion, including reconcile-null's `/null reply/` detail check;
- the printed lines byte-identical: `scenario merge-throw-contained: OK`, `scenario reconcile-throw-contained: OK`, `scenario merge-null-contained: OK`, `scenario reconcile-null-contained: OK`;
- the call sites at both scenario-run blocks (~2092–2094, ~3280–3281) invoking the same four scenarios.

Leave `scenarioIntegrationThrowContained` untouched (its assertion surface is disjoint). Target ≈60 LOC net reduction.

- [ ] **Step 2: Fix the stale comment in `tests/frontier_merge.mjs` (lines 54–57)**

Replace:
```js
// A contended-shaped wave: two tasks whose declared `files` intersect. Under the
// shipped `--overlap serialize` default the compiler can never emit this, so
// every scenario here builds it by hand — exactly what a frontier-mode compile
// would produce.
```
with:
```js
// A contended-shaped wave: two tasks whose declared `files` intersect. The
// shipped `--overlap fold` default emits exactly this shape; every scenario
// here builds it by hand for determinism.
```

- [ ] **Step 3: Run both specs manually (the suite-gate will NOT cover them here)**

Run: `node tests/sim_workflow.mjs` — expected: ends `ALL SCENARIOS PASSED`, exit 0, and the four folded scenario lines print unchanged.
Run: `node tests/frontier_merge.mjs` — expected: ends `ALL SCENARIOS PASSED`, exit 0.

- [ ] **Step 4: Commit**

```bash
git commit -am "test: parameterize sim_workflow contained-fault family; fix stale frontier_merge comment (#331)"
```

---

### Task 5: `test_compile_plan.py` — fold the heading-diagnostics cluster (FROZEN vocabulary)

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `tests/test_compile_plan.py`

**Interfaces:**
- Consumes: the file's existing `compile_plan_raw` helper (unchanged)
- Produces: `test_bad_task_heading_diagnostics[...]` — 7 parametrized cases replacing 7 tests (count-neutral)

This task touches assertions against FROZEN compiler diagnostics. Pure de-dup: every needle survives verbatim, in the same raw-vs-lowercased haystack it is checked against today. The reviewer must diff needle-by-needle.

- [ ] **Step 1: Delete these seven tests**

`test_near_miss_task_heading_is_a_loud_error` (795–810), `test_four_hash_and_caps_headings_error_loudly` (848–860), `test_wrong_level_task_headings_error_loudly` (877–889), `test_no_space_wrong_level_heading_gets_three_hash_hint` (1276–1287), `test_wrong_level_heading_emits_three_hash_hint` (1294–1306), `test_caps_heading_does_not_get_level_hint` (1309–1323), `test_wrong_level_task_id_heading_still_refuses` (2004–2017).

Keep `test_all_wrong_level_plan_gets_the_heading_diagnostic` (1018–1027) untouched — it is the only 100%-malformed-plan fixture and pins the `"## Task 1:"` echo.

- [ ] **Step 2: Add the parametrized replacement (place it where the 848 cluster was)**

```python
# The malformed-heading net: every case routes to the single frozen heading
# diagnostic. must_raw is checked against stderr as-is, must_lower against
# stderr.lower(), absent_raw must NOT appear. FROZEN vocabulary — needles
# change only for an eval-measured regression.
HEADING_CASES = [
    pytest.param("### Task 1.5: dotted id folds away silently today",
                 ["1.5"], ["heading"], [], id="dotted-id"),
    pytest.param("#### Task 2: four hashes",
                 [], ["heading"], [], id="four-hashes"),
    pytest.param("##### Task 2: five hashes",
                 [], ["heading"], [], id="five-hashes"),
    pytest.param("####Task 2: four hashes no space",
                 ["EXACTLY three hashes"], [], [], id="no-space"),
    pytest.param("## Task 2: two hashes",
                 ["EXACTLY three hashes"], ["did you mean"], [],
                 id="two-hashes-hint"),
    # `### TASK 2:` is the right level (three hashes); the fault is the case,
    # so the three-hash hint must NOT fire (it would mislead).
    pytest.param("### TASK 2: all caps",
                 [], ["heading"], ["EXACTLY three hashes"], id="caps-no-hint"),
    # `## Task 2:` would fold its content into the previous task silently —
    # the net must keep refusing it, naming the heading "not recognized".
    pytest.param("## Task 2: mis-leveled",
                 ["not recognized"], [], [], id="mis-leveled-refuses"),
]


@pytest.mark.parametrize("bad,must_raw,must_lower,absent_raw", HEADING_CASES)
def test_bad_task_heading_diagnostics(tmp_path, bad, must_raw, must_lower,
                                      absent_raw):
    plan = tmp_path / "badhead.md"
    plan.write_text(
        "# Plan: Bad heading\n\n"
        "### Task 1: first\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `a.py`\n\n- [ ] **Step 1:** a\n\n"
        + bad + "\n\n**Type:** implementation\n\n"
        "**Files:**\n- Create: `b.py`\n\n- [ ] **Step 1:** b\n"
    )
    p = compile_plan_raw(plan)
    assert p.returncode == 1, bad
    for needle in must_raw:
        assert needle in p.stderr, (bad, needle, p.stderr)
    for needle in must_lower:
        assert needle in p.stderr.lower(), (bad, needle, p.stderr)
    for needle in absent_raw:
        assert needle not in p.stderr, (bad, needle, p.stderr)
```

(The mis-leveled case tightens `rc != 0` to `rc == 1` — the compiler exits 1 on this SystemExit today; verify the case passes before committing. The heading check runs before the acceptance-line check, so the marked fixture needs no waiver.)

- [ ] **Step 3: Verify count-neutral and green**

Run: `python3 -m pytest tests/test_compile_plan.py -q`
Expected: green; collected count for the file unchanged (7 tests → 7 parametrized cases; two of the deleted tests looped 2 inputs internally, and the two strictly-weaker loop halves — caps under `four_hash_and_caps`, `##` under `wrong_level_task_headings` — are covered by the `caps-no-hint` and `two-hashes-hint`/`mis-leveled-refuses` cases).

- [ ] **Step 4: Commit**

```bash
git commit -am "test: fold heading-diagnostics cluster into one case table, all frozen needles preserved (#331)"
```

---

### Task 6: Doc-prose pin ballast — `test_marker_compiler`, `test_ultraplan_skill`, `test_flawed_grammar`

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `tests/test_marker_compiler.py`
- Modify: `tests/test_ultraplan_skill.py`
- Modify: `tests/test_flawed_grammar.py`

**Interfaces:**
- Consumes: nothing
- Produces: nothing consumed elsewhere

- [ ] **Step 1: `test_marker_compiler.py` — delete 3 of 4 pins**

Delete `test_compiler_classifies_before_building_the_dag`, `test_compiler_consumes_depends_on_markers`, `test_compiler_collects_runbook_and_inlines_preamble`. Keep `test_compiler_reference_wires_the_executable_compiler` (its needles — `compile_plan.py`, `derived_knobs`, `"heuristic": true` — are code identifiers, not editorial prose).

- [ ] **Step 2: `test_ultraplan_skill.py` — delete the 4 sentence-literal pins**

Delete `test_ultraplan_shapes_decomposition_before_annotating` (75–84), `test_ultraplan_carries_the_review_authoring_rubric` (99–106), `test_ultraplan_carries_shrink_budget_and_escalation_guidance` (109–114), `test_ultraplan_relaxes_bodies_except_for_adversarial_review` (125–131).

KEEP: `test_ultraplan_mirrors_the_canonical_contract` (BAKE mirror), `test_ultraplan_does_not_cross_reference_other_skill_dirs`, `test_ultraplan_overrides_the_execution_header_and_handoff` (no-pause), `test_ultraplan_ends_authoring_with_the_check_step` (--check step), plus every test not named above (including `test_ultraplan_mirrors_the_review_marker_line` and `test_ultraplan_handoff_analyzes_before_recommending`).

- [ ] **Step 3: Defuse the fragile retired-construct needle in `test_contract_documents_the_files_grammar`**

In that test (lines ~143–156), delete the single line `assert "catch-all" in text` — it pins the RETIRED catch-all construct's doc mention, so a legitimate doc cleanup would false-fail it. Leave the rest of the test (including `"parenthetical note"`) unchanged.

- [ ] **Step 4: `test_flawed_grammar.py` — replace the self-fulfilling catch-all needle**

In the `EXPECT` table, change the `"double-catch-all.md"` entry's needle from `"catch-all"` (which only matches because the diagnostic echoes the fixture's own label back) to `"2 violation(s)"` — this actually pins the DOUBLE semantics (two catch-all bullets → two violations), is asserted against existing `--check` output (`{len} violation(s)` — no vocabulary change), and survives removal of the dead `catch-all` did-you-mean key. Note the haystack is lowercased in the loop, so write the needle as `"2 violation(s)"` (already lowercase).

- [ ] **Step 5: Verify and commit**

Run: `python3 -m pytest tests/test_marker_compiler.py tests/test_ultraplan_skill.py tests/test_flawed_grammar.py -q`
Expected: green; 7 fewer collected across the three files (−3, −4, 0).

```bash
git commit -am "test: trim doc-prose pins; defuse retired-construct needles (#331 item 3 + defect fixes)"
```

---

### Task 7: Viewer parse-test dupes — `test_viewer.py` / `test_swarm_wiring.py`

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `tests/test_viewer.py`
- Modify: `tests/test_swarm_wiring.py`

**Interfaces:**
- Consumes: nothing
- Produces: nothing consumed elsewhere

- [ ] **Step 1: Delete `tests/test_swarm_wiring.py::test_full_inlined_script_parses` (lines ~48–57)**

It duplicates `test_viewer.py::test_render_with_transcripts_full_inlined_script_parses` (same `--transcripts` render, same `<script>` regex, same `node --check`); the viewer copy is the keeper — it additionally asserts `globalThis.AuditProjection` is inlined. Keep `test_swarm_wiring.py`'s `_render`/`_run` helpers if its remaining tests use them; delete them only if now unused.

- [ ] **Step 2: Delete `tests/test_viewer.py::test_render_viewer_javascript_parses` (lines ~72–83)**

Subsumed by `test_viewer_boots_without_transcripts_under_dom_stub` (same inert render, same extraction, but actually EXECUTES the script under the DOM stub — node parses before it boots, so a syntax error still fails).

- [ ] **Step 3: Verify and commit**

Run: `python3 -m pytest tests/test_viewer.py tests/test_swarm_wiring.py -q`
Expected: green; 2 fewer collected.

```bash
git commit -am "test: drop duplicated/subsumed viewer parse checks (#331 item 2)"
```

---

### Task 8: `test_ultra_run.py` — prune-failure trio + validate-knobs near-dupes

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `tests/test_ultra_run.py`

**Interfaces:**
- Consumes: nothing
- Produces: nothing consumed elsewhere

- [ ] **Step 1: Prune-failure trio — keep only the selective-noop test**

Under the `# --- #95 item 2 ---` banner, delete `test_prune_reports_only_dirs_actually_removed` (626–634) and `test_prune_failure_is_named_in_the_scratch_hygiene_detail` (680–704, the chmod/root-skip variant). Keep `test_prune_failure_absent_from_removed_list_and_named_in_stage_detail` (637–677) — it asserts both the library surface (doomed dir absent from the removed list, still exists) and the driver surface (stage ok, `"; 1 removal failed: run-20260101-000000"` in detail), strictly subsuming the other two.

- [ ] **Step 2: Validate-knobs near-dupes — delete four**

Delete:
- `test_validate_knobs_passes_a_clean_noop_bootstrap` (182–187) — strict subset of `test_validate_knobs_no_testcmd_skips_baseline` (761–768)
- `test_validate_knobs_blocks_a_failing_bootstrap` (190–195) — strict subset of `test_validate_knobs_failed_bootstrap_short_circuits_baseline` (771–778)
- `test_validate_knobs_rejects_a_non_list_waves_value_with_a_verdict` (263–270) — generic `ok is False` contract already pinned by the malformed-wave-entry test's `"not an object"` detail assertion
- `test_validate_knobs_rejects_an_unhashable_tier_value_with_a_verdict` (273–281) — same generic dupe

Keep both detail-asserting reject tests (`…malformed_wave_entry…`, `…non_object_args_file…`) and the whole green/red baseline block at 739–813.

- [ ] **Step 3: Verify and commit**

Run: `python3 -m pytest tests/test_ultra_run.py -q`
Expected: green; 6 fewer collected (63 → 57).

```bash
git commit -am "test: trim prune-failure and validate-knobs near-dupes in test_ultra_run (#331 item 2)"
```

---

### Task 9: `test_finalize_wiring.py` meta-tests + sweep octal sub-case trim

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `tests/test_finalize_wiring.py`
- Modify: `tests/test_sweep_worktrees.py`

**Interfaces:**
- Consumes: nothing
- Produces: nothing consumed elsewhere

- [ ] **Step 1: Delete the two pin meta-tests**

Delete `test_pin_goes_red_if_finalize_call_is_reordered_after_gate` (63–87) and `test_pin_goes_red_if_finalize_call_is_dropped` (90–97) — they exercise only the private `_assert_finalize_precedes_gate` helper against synthetic strings, never SKILL.md. Keep the three real pins (`test_step_5_invokes_finalize_report`, `test_step_5_invokes_ultra_gate`, `test_finalize_report_precedes_ultra_gate_in_step_5`) and the helper itself.

- [ ] **Step 2: Trim one octal sub-case**

In `tests/test_sweep_worktrees.py::test_audit_age_hours_leading_zeros_are_decimal_not_octal` (547–594), delete the `08` sub-case block only. Keep `010` (the one case proving a valid-octal-prefix value reads as decimal 10), `09` (the historical regression value that used to abort past `exit 0` into the destructive sweep), `00` (boundary), and the report-only tail asserts (`wt.exists()`, branch survives). `08` pins the same invalid-octal-digit class as `09` with no distinct surviving claim.

- [ ] **Step 3: Verify and commit**

Run: `python3 -m pytest tests/test_finalize_wiring.py tests/test_sweep_worktrees.py -q`
Expected: green; 2 fewer collected.

```bash
git commit -am "test: drop finalize-pin meta-tests; trim duplicate octal sub-case (#331 items 2-3)"
```

---

### Task 10: `test_audit_run.py` ballast + `test_run_acceptance.py` rename

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `tests/test_audit_run.py`
- Modify: `tests/test_run_acceptance.py`

**Interfaces:**
- Consumes: nothing
- Produces: nothing consumed elsewhere

- [ ] **Step 1: Delete the misnamed classify test and the tautology pair**

In `tests/test_audit_run.py` delete:
- `test_no_engine_prompt_classifies_unknown` (101–104) — asserts the opposite of its name (every known ROLE_MARKER classifies to a known role) and is a near-twin of `test_every_role_marker_exists_in_baked_sources` (95–98, keep); the behavior its NAME describes is covered by `test_unrecognized_prompt_counts_as_unknown` (69–75, keep)
- `test_audit_missing_dir_totals_carry_empty_wall_sec_by_task` (176–179) and `test_audit_missing_dir_totals_carry_empty_live_wall_sec` (255–257) — tautologies over the same missing-dir early-return, covered by `test_missing_dir_is_advisory_exit_zero`

- [ ] **Step 2: Rename the mis-described acceptance test (RENAME ONLY — frozen periphery)**

In `tests/test_run_acceptance.py` (306–312), rename `test_missing_module_collection_red_keeps_status_ok` → `test_unimplemented_feature_assertion_red_keeps_status_ok` and rewrite its docstring to say: the `feature_built=False` fixture writes a PRESENT `mod.py` whose `add` raises `NotImplementedError`, so the red is an assertion/runtime red (`redKind == "assertion"`), not a collection red — the genuine collection-red cases are `test_collection_error_from_missing_module_is_honest_red` and `test_collection_red_is_labeled`. Change nothing else in the file: same body, same assertions, no behavior edit.

- [ ] **Step 3: Verify and commit**

Run: `python3 -m pytest tests/test_audit_run.py tests/test_run_acceptance.py -q`
Expected: green; 3 fewer collected in `test_audit_run.py` (20 → 17); `test_run_acceptance.py` count unchanged (55).

```bash
git commit -am "test: drop audit_run ballast; rename mis-described run_acceptance test (#331 item 3 + defect fixes)"
```

---

### Task 11: Single-test dupes — docket, redirect-args, overlap

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `tests/test_docket_lib.py`
- Modify: `tests/test_redirect_args.py`
- Modify: `tests/test_compile_overlap.py`

**Interfaces:**
- Consumes: nothing
- Produces: nothing consumed elsewhere

- [ ] **Step 1: Delete `tests/test_docket_lib.py::test_park_from_queued_round_trips_as_parked` (75–86)**

Its own docstring concedes it is the data-model half of `tests/test_compile_docket.py::test_parked_entry_is_excluded_from_a_subsequent_compile` (keep; do not edit `test_compile_docket.py` at all), which executes the same transition + serialize round-trip as its precondition. Keep `test_park_allowed_from_any_active_state`.

- [ ] **Step 2: De-dupe the `derive_files` legacy assertion in `tests/test_redirect_args.py`**

The final assert of `test_instruction_paths_and_derive_files_units` (335–349) — `ra.derive_files(["a.py"], "touch b.py and a.py", ["c.py", "b.py"]) == ["a.py", "b.py", "c.py"]` — is byte-identical to the entire body of `test_derive_files_declared_none_bypasses_guard` (390–393). Remove that one assert line from the units test; keep `test_derive_files_declared_none_bypasses_guard` (it names the `declared=None` legacy-caller contract). No test deleted here.

- [ ] **Step 3: Delete `tests/test_compile_overlap.py::test_all_overlapping_writers_no_longer_degrade_under_fold` (188–197)**

Every fact it asserts (`mode == "parallel"`, `degrade_reason is None` for SHAPE_A under fold) is already asserted by `test_overlapping_writers_share_one_wave_under_fold` (149–158, keep). Leave the CLI-vs-library unknown-mode pair alone (both seams argued for in their docstrings).

- [ ] **Step 4: Verify and commit**

Run: `python3 -m pytest tests/test_docket_lib.py tests/test_redirect_args.py tests/test_compile_overlap.py -q`
Expected: green; 2 fewer collected (docket_lib 23 → 22, overlap 13 → 12, redirect_args unchanged 35).

```bash
git commit -am "test: drop cross-file and in-file single-test dupes (#331 item 3)"
```

---

### Task 12: Suite gate — green, reconciled, not slower

**Type:** gate
**Depends-on:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11

**Files:**
- Test: `tests/`

Suite command: `python3 -m pytest`

Expectations:
- Suite green.
- Collected count is exactly **1152** (baseline 1185 − 33 manifest deletions).
- `python3 -m pytest --co -q` diffed against the pre-run baseline shows: disappeared ids = exactly the 33 Deletion Manifest entries plus the renamed/refactored ids (6 shim ids → 6 `test_js_specs` param ids; 7 heading-test ids → 7 `test_bad_task_heading_diagnostics` param ids; 1 `test_run_acceptance` rename). No other id disappears.
- Suite wall-clock within noise of the pre-run baseline — **1185 passed in 275.5s, measured 2026-08-28 on main `7ee8702`** (the deleted shims' specs still run via `test_js_specs`, so expect ≈flat; a regression >10% blocks).

---

## Deletion Manifest (the only test ids that may disappear, renames listed separately)

**Task 1 (11):** all 8 in `tests/test_shadow_fold.py`; all 3 in `tests/test_shadow_octopus.py`
**Task 6 (7):** `test_compiler_classifies_before_building_the_dag`, `test_compiler_consumes_depends_on_markers`, `test_compiler_collects_runbook_and_inlines_preamble`; `test_ultraplan_shapes_decomposition_before_annotating`, `test_ultraplan_carries_the_review_authoring_rubric`, `test_ultraplan_carries_shrink_budget_and_escalation_guidance`, `test_ultraplan_relaxes_bodies_except_for_adversarial_review`
**Task 7 (2):** `test_swarm_wiring.py::test_full_inlined_script_parses`, `test_viewer.py::test_render_viewer_javascript_parses`
**Task 8 (6):** `test_prune_reports_only_dirs_actually_removed`, `test_prune_failure_is_named_in_the_scratch_hygiene_detail`, `test_validate_knobs_passes_a_clean_noop_bootstrap`, `test_validate_knobs_blocks_a_failing_bootstrap`, `test_validate_knobs_rejects_a_non_list_waves_value_with_a_verdict`, `test_validate_knobs_rejects_an_unhashable_tier_value_with_a_verdict`
**Task 9 (2):** `test_pin_goes_red_if_finalize_call_is_reordered_after_gate`, `test_pin_goes_red_if_finalize_call_is_dropped`
**Task 10 (3):** `test_no_engine_prompt_classifies_unknown`, `test_audit_missing_dir_totals_carry_empty_wall_sec_by_task`, `test_audit_missing_dir_totals_carry_empty_live_wall_sec`
**Task 11 (2):** `test_park_from_queued_round_trips_as_parked`, `test_all_overlapping_writers_no_longer_degrade_under_fold`

**Renames / count-neutral refactors:** `test_missing_module_collection_red_keeps_status_ok` → `test_unimplemented_feature_assertion_red_keeps_status_ok`; 6 shim tests → `test_js_specs.py::test_js_spec[*]`; 7 heading tests → `test_bad_task_heading_diagnostics[*]`.

## Operator smoke

No observable surface — suite is the whole story.

# Fold-Native Program Phase 2 Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 2 of the fold-native authoring program (spec rev 7): compiler ordering-guess deletion, the `Commutes:` marker with its three consumers (contract header, composition rows, the assume-rung auto-union), the ultraplan rewrite with scoped body relaxation, and the waves-file preflight deletion — released as 0.2.17.

**Architecture:** The compiler keeps only existence edges (`marker`, `text`, `interface`, `write-after-create`); the fold path owns same-file writes. A new optional `**Commutes:**` marker flows compiler → launch object → engine → kernel CLI (`--commutes`), producing a `contract:` hunk header, engine-authored `composition-unpinned` judgment calls, and a fold-time deterministic auto-union whose safety ground is weave-inertness. Skill text moves the same direction: phantom-edge rules go, author-for-the-resolver guidance and scoped body relaxation arrive.

**Tech Stack:** Python 3 (compiler, kernel, pytest), Node (workflow harness `waves.js`, `.mjs` sims), markdown skill text with baked-prompt anti-drift pins.

**Spec:** `docs/superpowers/specs/2026-08-18-fold-native-authoring-program.md` (rev 7 — §2a–§2d + the rev-7 assume-rung amendment). Additive input (never build from it alone): `docs/superpowers/specs/2026-08-19-phase2-design-inputs.md`.

**Acceptance:** suite — operator's standing default. The committed suite plus per-task review is the verification; the T15-rig mechanics re-run (runbook Task 12, before release) is the multi-plan effort's integration-spanning acceptance per spec §2d.

## Global Constraints

- Frozen verification periphery untouched (`ultra_gate.py`, `gate_check.py`, `run_lock.sh`, sealing scripts, `run_acceptance.sh`). The compiler's diagnostic-vocabulary deletion is the one licensed exception — a measured-inert deletion adjudicated by the migration reading (Task 10) and the rig re-run (Task 12).
- Prompts are baked: edit the source blocks in `references/wave-merge.md` / `references/reviewer-prompts.md`, copy the wording into `waves.js`, and keep `tests/test_no_prompt_drift.py` green. Never edit only the baked copy.
- Harness JS changes carry the sim-sentinel obligation: every touched `tests/*.mjs` harness sim must exit 0 **and** print `ALL SCENARIOS PASSED`.
- Any harness change (baked-prompt or not) bumps `skills/ultrapowers/harnesses/waves.harness.json` `version` (done once, in Task 4).
- No `anthropic` SDK or `ANTHROPIC_API_KEY` anywhere in repo code.
- Word budgets (acceptance numbers, checked in-task): `skills/ultraplan/SKILL.md` ≤ 3,400 words; `skills/ultrapowers/SKILL.md` ≤ 2,920 words (`wc -w`).
- `--overlap serialize` remains the rollback knob = exactly the `write-after-write` tier; `Commutes:` is optional (its absence must change nothing).
- Kept edge `why` vocabulary after this plan: `marker`, `text`, `interface`, `write-after-create` (plus `write-after-write` under `serialize` only).
- The suite is `python3 -m pytest`; harness sims run manually via `node tests/<name>.mjs`.
- Release version: 0.2.17 in **both** `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`.

---

### Task 1: Compiler subtraction — delete the ordering-guess tiers, add the grammar refusals

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `skills/ultrapowers/scripts/ultra_run.py`
- Modify: `tests/test_compile_plan.py`
- Modify: `tests/test_compile_overlap.py`
- Modify: `tests/test_compile_prefilter.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `build_edges(impl, overlap_mode=OVERLAP_DEFAULT) -> (edges, conflicts)` — two-tuple, no `dropped_pairs`, no `repo_root` param; edge `why` values limited to `marker | text | interface | write-after-create` (+ `write-after-write` under `serialize`); two new compile/`--check` grammar refusal messages (exact strings in Step 3).

The spec section is §2a. All line anchors below are `main` at `abf5a04`; re-locate by the named identifiers if drifted.

- [ ] **Step 1: Write the failing tests (deletions pinned as removals, new refusals pinned as behavior)**

In `tests/test_compile_plan.py`, **delete** (not skip) every test pinning a deleted tier, using this inventory:

- `read-after-write`: `test_test_paths_generate_read_after_write_edge`, `test_backward_read_after_write_with_shared_write_compiles`.
- `write-after-write` under fold-default: `test_shared_test_path_serializes`, `test_line_ranged_paths_strip_to_overlap`, `test_uppercase_extension_paths_serialize_same_file_writers`, `test_a_5000_line_text_file_no_longer_keeps_the_write_after_write_edge` (the behavior moves to a serialize-mode pin in `test_compile_overlap.py`, Step 3 below). Keep the negative tests (`test_modify_function_names_and_routes_are_not_writes`, `test_dotted_attribute_ref_is_not_a_write`) — rewrite their assertions to check no edge of any kind is produced.
- `ambiguous-files`: `test_missing_files_block_is_conservatively_serialized`, `test_glob_paths_are_ambiguous`, `test_brace_glob_flags_ambiguous`, `test_glob_ambiguity_is_explained_in_conflicts`.
- `prose-reference` / `description-inferred`: `test_prose_reference_edge_orders_creator_before_referencer`, `test_prose_reference_matches_basename_and_full_path`, `test_prose_reference_dedupes_against_declared_marker`, `test_prose_reference_ignores_fenced_examples`, `test_prose_reference_short_stem_requires_exact_or_basename`, `test_description_inferred_edge_has_distinct_kind`, and the prose-reference assertions inside `test_conflicts_carry_kind_and_inferences_are_separated` and `test_blank_line_closes_the_files_block`.
- `catch-all`: `test_catch_all_parses_and_is_not_a_violation`, `test_catch_all_task_never_shares_a_wave`, `test_catch_all_conflict_edges_are_labeled`, `test_catch_all_surfaces_in_emitted_launch_task`, `test_catch_all_bullet_parses_into_task_dict`, `test_files_violations_allows_single_catch_all_bullet`. Rewrite `test_second_catch_all_bullet_is_a_violation` / `test_files_violations_flags_second_catch_all_bullet` into the single new label-refusal test below.
- degrade: `test_fully_overlapping_writes_degrade_and_reason`. Keep `test_small_plan_degrades_to_sequential` (single-task trigger stays) and both zero-impl tests.

Then **add** these tests (exact code; adjust helper names to the file's existing plan-builder helpers):

```python
def test_files_less_marked_implementation_task_is_refused(tmp_path):
    plan = tmp_path / "p.md"
    plan.write_text(PLAN_HEADER + """
### Task 1: A
**Type:** implementation
**Depends-on:** none

**Files:**
- none

- [ ] **Step 1: do it**
""")
    proc = run_compiler(plan)  # the file's existing subprocess helper
    assert proc.returncode != 0
    assert "declares no file paths under Files:" in proc.stderr

def test_files_less_heuristic_task_is_exempt(tmp_path):
    # No **Type:** marker: heuristic classification — corpus pin protection (spec §2a, B11).
    plan = tmp_path / "p.md"
    plan.write_text(PLAN_HEADER + """
### Task 1: A

**Files:**
- none

- [ ] **Step 1: implement the thing**
""")
    proc = run_compiler(plan)
    assert proc.returncode == 0

def test_test_only_files_block_satisfies_the_refusal(tmp_path):
    # Two archived marked plans carry Test-only implementation tasks — they stay OK.
    plan = tmp_path / "p.md"
    plan.write_text(PLAN_HEADER + """
### Task 1: A
**Type:** implementation
**Depends-on:** none

**Files:**
- Test: `tests/test_a.py`

- [ ] **Step 1: verify**
""")
    proc = run_compiler(plan)
    assert proc.returncode == 0

def test_brace_glob_is_a_hard_violation(tmp_path):
    plan = plan_with_files_line("- Modify: `src/{a,b}.py`")
    proc = run_compiler(plan)
    assert proc.returncode != 0
    assert "glob" in proc.stderr

def test_catch_all_label_is_a_violation_with_did_you_mean(tmp_path):
    plan = plan_with_files_line("- catch-all: `src/`")
    proc = run_compiler(plan)
    assert proc.returncode != 0
    assert "unknown Files label" in proc.stderr and "Modify" in proc.stderr

def test_undeclared_dependency_suppression_set_is_write_after_create_and_write_after_write():
    import compile_plan
    src = inspect.getsource(compile_plan)
    assert '"read-after-write"' not in src  # the label is gone from the module entirely
```

Rewrite `tests/test_compile_overlap.py` to the new mode contract (drop `dropped_pairs` / `fully_overlapping` / labeling-predicate tests; the file keeps its module fixtures):

```python
def test_serialize_mode_is_exactly_the_write_after_write_tier():
    edges, _ = build(SHAPE_A, overlap_mode="serialize")
    assert [e["why"] for e in edges if e["why"] == "write-after-write"]

def test_fold_mode_emits_no_write_after_write_edge_ever():
    edges, _ = build(SHAPE_A, overlap_mode="fold")
    assert not [e for e in edges if e["why"] == "write-after-write"]

def test_fold_and_serialize_agree_on_every_other_label():
    fold_rest = sorted((e["from"], e["to"], e["why"]) for e in build(SHAPE_A, "fold")[0])
    ser_rest = sorted((e["from"], e["to"], e["why"]) for e in build(SHAPE_A, "serialize")[0]
                      if e["why"] != "write-after-write")
    assert fold_rest == ser_rest

def test_overlap_default_constant_ships_fold():
    assert compile_plan.OVERLAP_DEFAULT == "fold"

def test_unknown_overlap_value_is_rejected():
    with pytest.raises(ValueError):
        build(SHAPE_A, overlap_mode="banana")

def test_single_implementation_task_still_degrades():
    # unchanged behavior — keep the existing test body from the old file
```

Delete `tests/test_compile_prefilter.py` entirely (`git rm`).

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `python3 -m pytest tests/test_compile_plan.py tests/test_compile_overlap.py -x -q`
Expected: new refusal tests FAIL (refusals don't exist yet); rewritten overlap tests FAIL.

- [ ] **Step 3: Implement in `compile_plan.py`**

All in `skills/ultrapowers/scripts/compile_plan.py`:

1. **Delete tiers in `build_edges`** (signature becomes `build_edges(impl, overlap_mode=OVERLAP_DEFAULT)` returning `(edges, conflicts)`):
   - `read-after-write` block (was lines 1129–1131).
   - `prose-reference` / `description-inferred` block (1189–1242), plus the module regex/helpers used only there (`_desc_field_label` if now unreferenced).
   - `write-after-write` (1244–1280): keep the loop but guard the whole tier with `if overlap_mode == "serialize":` — under `fold` the tier does not run and no `dropped_pairs` bookkeeping exists.
   - `ambiguous-files` (1282–1292) and the `files_ambiguous` soft-glob machinery (455–462, `GLOB_CHARS` uses that feed only it).
   - `catch-all` edge tier (1294–1312) and the catch-all parse machinery: `CATCH_ALL_LINE`, `catch_all_raw` capture, the second-catch-all violation, and the `catchAll` field in `launch_waves` / `--emit-launch` payloads.
   - Delete `_PathEligibility`, `_path_eligibility`, `fold_eligible`, and the `--repo-root` CLI flag (the pre-filter is gone; non-text/symlink same-file pairs fall back at merge, per the authoring sentence Task 6 keeps).
2. **Shrink the undeclared-dependency suppression set** (was 1165–1167) to exactly `("write-after-create", "write-after-write")`. The marker→`interface` promotion clause (1171) stays byte-untouched.
3. **Degrade**: delete `fully_overlapping` (1560–1583) and `dropped_pairs` end-to-end; keep `if impl and len(impl) == 1: mode = "sequential"` with reason `f"Sequential mode: 1 implementation task"`.
4. **Grammar refusals** in `_files_violations` / `collect_violations`:
   - `_FILES_GLOB_CHARS = "*?[{"` (add `{`; delete the 702–703 comment deferring braces to the soft path).
   - `_LABEL_SUGGEST["catch-all"] = "Modify"` so `- catch-all:` hits the existing unknown-label did-you-mean.
   - New refusal: a task whose **explicit** `marker_type == "implementation"` (never `classify()`'s heuristic result — reuse the `_files_grammar_exempt` pattern) with no parseable path in `creates ∪ modifies ∪ reads` → violation string:
     `"Task %s: implementation task declares no file paths under Files: — add Create/Modify/Test paths (a Files-less task is invisible to contention detection)"`. A `Files:` block containing only `- none` is the same refusal.
5. **Callers**: update the `build_edges(...)` call in `main()` (drop `repo_root=`, unpack two values); in `skills/ultrapowers/scripts/ultra_run.py` `compile_argv` (was 127–142) stop stamping `--repo-root`.

- [ ] **Step 4: Run the compiler tests and the corpus pin**

Run: `python3 -m pytest tests/test_compile_plan.py tests/test_compile_overlap.py tests/test_all_plans_compile.py -q`
Expected: PASS. The corpus pin (`test_every_marked_plan_compiles`) must stay green with the same OK set — if any archived plan now fails, that is a spec-contract break: stop and re-examine rather than editing archived plans.

- [ ] **Step 5: Full suite, then commit**

Run: `python3 -m pytest -q` — expected PASS.
```bash
git add skills/ultrapowers/scripts/compile_plan.py skills/ultrapowers/scripts/ultra_run.py tests/test_compile_plan.py tests/test_compile_overlap.py
git rm tests/test_compile_prefilter.py
git commit -m "feat(compiler): keep existence edges, delete ordering-guess tiers; Files-less + brace-glob + catch-all refusals (spec §2a)"
```

---

### Task 2: `Commutes:` marker — parse, validate, emit `writes`/`commutes`

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `tests/test_compile_plan.py`

**Interfaces:**
- Consumes: nothing from other tasks (same-file edits with the compiler-subtraction task fold at merge).
- Produces: launch-object task fields `writes: string[]` (sorted `creates ∪ modifies`) and `commutes: string[]` (sorted declared paths, `[]` when undeclared) on `launch_waves` entries, `--emit-launch` task dicts, and (via `launch_waves`) `--emit-args`; parsed task key `task["commutes"]`.

- [ ] **Step 1: Write the failing tests**

```python
def test_commutes_marker_parses_and_emits(tmp_path):
    plan = tmp_path / "p.md"
    plan.write_text(PLAN_HEADER + """
### Task 1: A
**Type:** implementation
**Depends-on:** none
**Commutes:** `app/registry.py`

**Files:**
- Modify: `app/registry.py`
- Test: `tests/test_a.py`

- [ ] **Step 1: do**
""")
    result = compile_json(plan)  # existing helper returning parsed stdout JSON
    task = result["launch_waves"][0][0]
    assert task["commutes"] == ["app/registry.py"]
    assert task["writes"] == ["app/registry.py"]  # creates ∪ modifies; Test paths excluded

def test_commutes_path_outside_own_files_is_a_rendered_conflict(tmp_path):
    # spec §2b: a marker conflict, not a compile error
    plan = plan_with_commutes("`other/file.py`", files="- Modify: `app/registry.py`")
    result = compile_json(plan)
    assert result["marker_conflicts"], "expected a rendered conflict"
    assert any("Commutes" in c.get("note", "") for c in result["marker_conflicts"])

def test_undeclared_task_emits_empty_commutes(tmp_path):
    result = compile_json(minimal_marked_plan(tmp_path))
    assert result["launch_waves"][0][0]["commutes"] == []

def test_commutes_is_marker_ish(tmp_path):
    # A near-miss `**Commutes**:` must not silently end the header block and demote Depends-on.
    import compile_plan
    assert compile_plan.MARKER_ISH.match("**Commutes**: `a.py`")
```

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m pytest tests/test_compile_plan.py -k commutes -q` — expected FAIL (marker unknown).

- [ ] **Step 3: Implement**

In `compile_plan.py`:

1. Beside `MARKER_REVIEW`: `MARKER_COMMUTES = re.compile(r"^\*\*Commutes:\*\*\s*(.+?)\s*$")`. Extend `MARKER_ISH` (line 42) to `type|depends[-\s]on|review|commutes`.
2. In `parse_task`'s header-block dispatch: on `MARKER_COMMUTES`, split the payload on commas, extract backticked paths via `PATH_RE` (fall back to the bare token, `_is_pathlike`-filtered), accumulate into `task["commutes"]` across repeated lines (the `MARKER_DEPS` accumulation pattern). Default `task["commutes"] = []`.
3. After the `Files:` block closes, validate: every commutes path must be in `set(creates) | set(modifies) | set(reads)`; each violation appends a **marker conflict** (kind `"conflict"`), note:
   `"Task %s: Commutes path `%s` is not in this task's own Files: block — declaration ignored for that path"`, and the path is dropped from `task["commutes"]`. Never a `SystemExit`.
4. Emission: `launch_waves` entries (the 1608–1622 dict) gain `"writes": sorted(set(t["creates"]) | set(t["modifies"]))` and `"commutes": sorted(t["commutes"])`; `--emit-launch` task dicts gain the same two keys. (`--emit-args` carries `launch_waves` and inherits them.)

- [ ] **Step 4: Run the compiler tests + corpus pin**

Run: `python3 -m pytest tests/test_compile_plan.py tests/test_all_plans_compile.py -q` — expected PASS (no archived plan carries `Commutes:`, so the corpus is unaffected by construction).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/compile_plan.py tests/test_compile_plan.py
git commit -m "feat(compiler): Commutes: marker — parse, own-Files validation, writes/commutes launch fields (spec §2b)"
```

---

### Task 3: Kernel — `--commutes`, the `contract:` hunk header, and the assume-rung auto-union

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/kernel/fold_wave.py`
- Modify: `skills/ultrapowers/kernel/hunks.py`
- Modify: `skills/ultrapowers/kernel/FOLD_LOG.md`
- Test: `tests/test_fold_wave.py`
- Test: `tests/test_hunks.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: CLI flag `--commutes <taskId>=<path1,path2,...>` (repeatable) on `fold` and `resolve`; `conflicts.json` entries may carry `"autoResolved": true` (with `dispatchable: true`); every `fold`/`resolve` stdout reply that carries `conflicts` also carries `"autoResolved": <int>` (count of conflicts auto-resolved during that CLI call; `0` when none); hunks-file headers may carry a `contract:` line; `hunks.derive(annotated, contract=None)` optional kwarg; `hunks.union_replies(annotated, blocks) -> dict | None`.

Spec: §2b consumer 2 (contract header) and consumer 3 (assume rung, rev 7). The safety ground is weave-inertness: the auto-union reply byte-equals the frontier's current visible lines, so `update_state` is the identity and the live fold sequence equals the raw one the completion self-checks gate. Any `deleted` segment anywhere in the conflict disqualifies auto-union (a deletion is not an additive registration).

- [ ] **Step 1: Write the failing tests**

In `tests/test_hunks.py`:

```python
def test_derive_contract_line_sits_under_each_hunk_header():
    text, blocks = hunks.derive(ANNOTATED_TWO_BLOCK,  # existing fixture
        contract="contract: both sides declared these edits commutative — union, "
                 "preserve each side's internal order, do not reorder existing lines")
    lines = text.splitlines()
    heads = [i for i, l in enumerate(lines) if l.startswith("HUNK ")]
    for i in heads:
        assert lines[i + 1].startswith("contract: both sides declared")

def test_union_replies_is_strip_markers_per_block():
    _, blocks = hunks.derive(ANNOTATED_TWO_BLOCK)
    replies = hunks.union_replies(ANNOTATED_TWO_BLOCK, blocks)
    spliced = hunks.splice(ANNOTATED_TWO_BLOCK, replies, blocks)
    assert spliced == hunks.strip_markers(ANNOTATED_TWO_BLOCK)  # the pinned round-trip form

def test_union_replies_refuses_deleted_segments():
    _, blocks = hunks.derive(ANNOTATED_WITH_DELETED_SEGMENT)
    assert hunks.union_replies(ANNOTATED_WITH_DELETED_SEGMENT, blocks) is None
```

In `tests/test_fold_wave.py` (use the file's existing two-writer git-repo builders; both writers append distinct lines to one path):

```python
def test_both_declared_all_added_conflict_auto_resolves(two_writer_repo):
    out = run_fold(two_writer_repo, extra=["--commutes", "t1=shared.py", "--commutes", "t2=shared.py"])
    reply = json.loads(out.stdout)
    assert reply["autoResolved"] == 1
    assert reply["open"] == [] and reply["complete"] is True
    entry = read_index(two_writer_repo)[0]
    assert entry["autoResolved"] is True and entry["dispatchable"] is True
    events = read_log(two_writer_repo)
    assert any(e["type"] == "resolve" for e in events)      # ordinary resolve event
    assert reply["selfChecks"] == "ok"                       # replay + shuffle green

def test_auto_union_is_weave_inert(two_writer_repo):
    # The inertness pin (spec rev 7): materialized content equals the kernel's own merged
    # content — the union the raw fold produces with markers stripped.
    run_fold(two_writer_repo, extra=["--commutes", "t1=shared.py", "--commutes", "t2=shared.py"])
    sha = run_materialize(two_writer_repo)
    assert file_at(two_writer_repo, sha, "shared.py") == expected_union_text()

def test_undeclared_writer_dispatches_normally(two_writer_repo):
    out = run_fold(two_writer_repo, extra=["--commutes", "t1=shared.py"])  # t2 undeclared
    reply = json.loads(out.stdout)
    assert reply["autoResolved"] == 0 and len(reply["open"]) == 1
    hunks_text = read_hunks_file(two_writer_repo, reply["open"][0])
    assert "contract:" not in hunks_text

def test_both_declared_dispatch_carries_contract_header(two_writer_deleting_repo):
    # One side deletes a line inside the block: contract header YES, auto-union NO.
    out = run_fold(two_writer_deleting_repo, extra=["--commutes", "t1=shared.py", "--commutes", "t2=shared.py"])
    reply = json.loads(out.stdout)
    assert reply["autoResolved"] == 0 and len(reply["open"]) == 1
    hunks_text = read_hunks_file(two_writer_deleting_repo, reply["open"][0])
    assert "contract: both sides declared these edits commutative" in hunks_text

def test_fold_whose_every_conflict_auto_resolves_does_not_stop(three_writer_repo):
    # writers 1..3 all declare; fold runs to complete in one call, autoResolved == 2
    out = run_fold(three_writer_repo, extra=[
        "--commutes", "t1=shared.py", "--commutes", "t2=shared.py", "--commutes", "t3=shared.py"])
    reply = json.loads(out.stdout)
    assert reply["complete"] is True and reply["autoResolved"] == 2

def test_no_commutes_flag_changes_nothing(two_writer_repo):
    out = run_fold(two_writer_repo)
    reply = json.loads(out.stdout)
    assert reply["autoResolved"] == 0 and len(reply["open"]) == 1
```

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m pytest tests/test_hunks.py tests/test_fold_wave.py -k "commut or contract or auto" -q` — expected FAIL.

- [ ] **Step 3: Implement `hunks.py`**

1. `derive(annotated, contract=None)`: when `contract` is a string, append it as its own line immediately after each `HUNK …` header line (line 119's `out.append`).
2. New function:

```python
def union_replies(annotated, blocks):
    """Kernel-merged block bodies, one reply per hunk — or None when any block
    carries a `deleted` segment (a deletion is not an additive registration;
    the declare-rung dispatch handles it)."""
    lines = split_lines(annotated)
    replies = {}
    for b in blocks:
        segs = _segments(lines, b["start"], b["end"])
        if any(kind == "deleted" for kind, _side, _content in segs):
            return None
        body = [ln for kind, _side, content in segs if kind == "added" for ln in content]
        replies[b["id"]] = body
    return replies
```

Note `splice` re-appends `b["eofTail"]` itself; `_segments` over `[start, end]` never includes the tail (it left the block in `derive`), so no double-count — assert this in the round-trip test above.

- [ ] **Step 4: Implement `fold_wave.py`**

1. **Args**: `_parse_commutes(spec)` → `(taskId, [paths])` from `<taskId>=<p1,p2,...>` (model on `_parse_task_head`, line 186); add `--commutes` (`action="append"`, `type=_parse_commutes`, `default=[]`) to the `fold` (843) and `resolve` (856) subparsers. Build `commutes_map = {tid: set(paths) for tid, paths in args.commutes}` in `cmd_fold` and `cmd_resolve`.
2. **Both-sides condition** (consumer 2's rule): the incoming task declared the path, and every already-folded task whose `diff_paths(repo, base, headSha)` touches the path declared it. In `cmd_fold`/`cmd_resolve`, when `commutes_map` is non-empty, lazily build `touched = {tid: set(repo_weave.diff_paths(repo, base_sha, head_sha))}` for the supplied triples (git cost only when declarations exist). Helper:

```python
def _contract_eligible(path, incoming, folded_ids, commutes_map, touched):
    if path not in commutes_map.get(incoming, ()):
        return False
    return all(path in commutes_map.get(t, ())
               for t in folded_ids if path in touched.get(t, ()))
```

`folded_ids` = tasks with a `fold` event before this conflict's fold (log prefix + the in-call loop position).
3. **Contract header**: thread eligibility into `_narrate`/`_verdict` so `hunks.derive` is called with `contract=CONTRACT_LINE` when eligible (constant: `CONTRACT_LINE = "contract: both sides declared these edits commutative — union, preserve each side's internal order, do not reorder existing lines"`).
4. **Auto-union** in `_fold_until_stop` (321–347): after `entries = [_narrate(...)]`, partition:

```python
open_entries = []
for entry in entries:
    if (entry["dispatchable"] and entry["kind"] in ("lines", "add-add")
            and _contract_eligible(entry["path"], task_id, folded_ids, commutes_map, touched)):
        annotated = (wave_dir / ("conflict-%d.txt" % entry["i"])).read_text()
        _text, blocks = hunks.derive(annotated)
        replies = hunks.union_replies(annotated, blocks)
        if replies is not None:
            lines = hunks.splice(annotated, replies, blocks)
            if eng.apply_resolution(entry["path"], entry["epoch"], lines):
                _append_event(log_path, eng.events[-1])
                entry["autoResolved"] = True          # dispatchable stays True
                auto_count += 1
                continue
    open_entries.append(entry)
```

`_write_index` persists the mutated entries. When `open_entries` is empty the loop **continues folding** (the fold no longer stops on auto-resolvable conflicts; dispatch stops and parks are unchanged). A falsy `apply_resolution` or a `union_replies` of `None` falls through to a normal open entry — no new refusal paths.
5. **Stdout**: every `cmd_fold` reply shape that carries `conflicts` (465–469, 479–482, 493–498, 507–512, 523–525) and the `cmd_resolve` continued-stop / completion shapes (617–622, 635–636) gain `"autoResolved": auto_count` (this call's count; `0` when none). `conflicts`/`dispatchable` keep counting **this stop's `open`** — auto-resolved entries never appear in `open` (`_open_view` unchanged; the stop filter excludes entries with a resolve event at their epoch, which auto-resolved entries now have, so `_current_stop`'s `waiting` already excludes them).
6. `FOLD_LOG.md`: document `autoResolved` on the index entry and the reply counts, and the one-line auto-union rule (kernel-merged body; `deleted` segment → dispatch), in the resolve section.

- [ ] **Step 5: Run kernel tests, then the full suite**

Run: `python3 -m pytest tests/test_hunks.py tests/test_fold_wave.py tests/test_fold_wave_materialize.py tests/test_frontier_fold.py -q` then `python3 -m pytest -q` — expected PASS.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/kernel/fold_wave.py skills/ultrapowers/kernel/hunks.py skills/ultrapowers/kernel/FOLD_LOG.md tests/test_fold_wave.py tests/test_hunks.py
git commit -m "feat(kernel): --commutes contract header + assume-rung auto-union on weave-inertness ground (spec §2b rev 7)"
```

---

### Task 4: Engine — commutes plumbing, composition rows, STEP re-bake, `autoResolved`

**Type:** implementation
**Depends-on:** 2, 3
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Modify: `skills/ultrapowers/harnesses/waves.harness.json`
- Modify: `skills/ultrapowers/references/wave-merge.md`
- Modify: `skills/ultrapowers/references/report-format.md`
- Test: `tests/frontier_merge.mjs`

**Interfaces:**
- Consumes: launch task fields `writes`/`commutes` (from the Commutes-compiler task); kernel CLI `--commutes` flag, `autoResolved` reply count, `autoResolved: true` index entries (from the kernel task).
- Produces: `FOLD_SCHEMA.autoResolved` (integer); `frontierEntry` field `autoResolved` (engine-summed across fold/resolve replies); `judgmentCalls` strings with the pinned prefix `composition-unpinned: wave <n> <path> — writers <A,B,...>; undeclared: <B,...>`.

- [ ] **Step 1: Write the failing sim scenarios**

In `tests/frontier_merge.mjs` (follow the existing scenario/fixture conventions; update the shared `FRONTIER_KEYS` list at ~139 to include `'autoResolved'` — every scenario asserts the frontier shape, so this is load-bearing):

```js
// 11a: an auto-resolved fold completes without a resolver dispatch
async function scenarioAutoResolvedFoldCompletes() { /* fold reply:
  { status:'FOLDED', clean:false, conflicts:0, dispatchable:0, parked:0,
    autoResolved:1, open:[], remaining:[], complete:true, selfChecks:'ok' }
  assert: no resolver agent dispatched; frontier entry autoResolved === 1; wave adopts */ }

// 11b: --commutes rides the fold and resolve commands for declaring tasks only
async function scenarioCommutesArgsOnCommands() { /* tasks: t1 commutes:['shared.py'], t2 commutes:[]
  assert fold command contains " --commutes t1=shared.py" and no "--commutes t2" */ }

// 11c: composition-unpinned row for an undeclared multi-writer path
async function scenarioCompositionUnpinnedRow() { /* tasks share writes:['shared.py'],
  t1 declares, t2 does not; assert report.judgmentCalls contains a string starting
  "composition-unpinned: wave 1 shared.py — writers t1,t2; undeclared: t2" */ }

// 11d: writes-field absent → no composition rows + one note
async function scenarioWritesAbsentSkipsCompositionRows() { /* tasks carry no writes field;
  assert no judgmentCalls entry starts with "composition-unpinned:" and exactly one
  entry notes composition rows were skipped for the wave */ }
```

Register all four in the await block and keep the `ALL SCENARIOS PASSED` sentinel print.

- [ ] **Step 2: Run to verify failure**

Run: `node tests/frontier_merge.mjs` — expected: fails (schema/fields/scenarios missing).

- [ ] **Step 3: Edit the baked-prompt SOURCE, then bake**

In `references/wave-merge.md` inside `<!-- BAKE:CONTENDED_MERGE_PROMPT -->` (lines 186–191): in the STEP fold sentence that derives `open` ("for each entry whose dispatchable is true add an open entry…"), change the condition to "whose dispatchable is true **and whose autoResolved is not true**", and append: "Copy the reply's autoResolved count into your reply (0 when absent)." Make the STEP resolve line's "exactly as in STEP fold" inherit the same exclusion. Then copy the changed wording into the baked `contendedMergePrompt` array in `waves.js` (573–594) and run the drift pin until green.

- [ ] **Step 4: Implement `waves.js`**

1. `FOLD_SCHEMA` (796–832): add `autoResolved: { type: 'integer' }`.
2. Command construction: beside `branchArgs` (1425–1426) build `commutesArgs` from the wave's launch tasks — `WAVES[waveIdx].filter(t => Array.isArray(t.commutes) && t.commutes.length).map(t => ' --commutes ' + t.id + '=' + t.commutes.join(','))` — appended to both the fold (1428–1431) and resolve (1577–1580) commands.
3. `frontierEntry` (1324–1332): add parameter/field `autoResolved` (sum of `fold.autoResolved || 0` across fold + resolve replies, accumulated beside `calls`); document the field in `references/report-format.md`'s frontier row (line 76).
4. Composition rows, in `mergeWave` after the merge path resolves (near the 1683 `contendedWave` call site, on **both** the contended and git-merge paths):

```js
function compositionRows(waveNumber, tasks, mergeable) {
  const withWrites = tasks.filter((t) => Array.isArray(t.writes));
  if (withWrites.length !== tasks.length) {
    judgmentCalls.push('wave ' + waveNumber + ': tasks carry no writes field — composition rows skipped');
    return;
  }
  const writers = new Map(); // path -> [taskId]
  for (const t of tasks) for (const p of t.writes) writers.set(p, [...(writers.get(p) || []), t.id]);
  for (const [p, ids] of writers) {
    if (ids.length < 2) continue;
    const undeclared = ids.filter((id) => !(tasks.find((t) => t.id === id).commutes || []).includes(p));
    if (undeclared.length) judgmentCalls.push('composition-unpinned: wave ' + waveNumber + ' ' + p
      + ' — writers ' + ids.join(',') + '; undeclared: ' + undeclared.join(','));
  }
}
```

(The residual manifest derives its row from any `judgmentCalls` string unchanged — zero change to `residual_manifest.py`.)
5. Bump `waves.harness.json` `version`.

- [ ] **Step 5: Run the sims and drift pins**

Run: `node tests/frontier_merge.mjs` (expect exit 0 + `ALL SCENARIOS PASSED`), `node tests/sim_workflow.mjs`, `node tests/sim_derived_heads.mjs`, `node tests/wave_ancestry_sim.mjs`, then `python3 -m pytest tests/test_no_prompt_drift.py tests/test_canary.py tests/test_report_runbook.py -q` — expected all PASS.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/harnesses/waves.js skills/ultrapowers/harnesses/waves.harness.json skills/ultrapowers/references/wave-merge.md skills/ultrapowers/references/report-format.md tests/frontier_merge.mjs
git commit -m "feat(engine): commutes plumbing, composition-unpinned rows, autoResolved STEP re-bake (spec §2b rev 7)"
```

---

### Task 5: Delete the agent-based waves-file preflight

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Modify: `skills/ultrapowers/scripts/audit_run.py`
- Modify: `skills/ultrapowers/references/workflow-template.md`
- Test: `tests/sim_workflow.mjs`
- Test: `tests/test_canary.py`

**Interfaces:**
- Consumes: nothing from other tasks (same-file `waves.js` edits with the engine task fold at merge).
- Produces: nothing consumed downstream — a pure deletion; the guarded defect is inexpressible (the deterministic driver stamps `wavesPath`; `redirect_args.py` composes relaunches).

- [ ] **Step 1: Update the tests first**

In `tests/sim_workflow.mjs`: delete `scenarioWavesPathPreflightMissingFile` (2296–2314) and `scenarioWavesPathPreflightMissingId` (2317–2335) plus their call lines; in `scenarioWavesPathFileBackedBodies` remove the `waves-file-check` handler (2227) and its ran-assertions (2232–2233); rewrite `scenarioRoadmapRegistersBeforePreflight` as `scenarioRoadmapRegistersBeforeSetup` — same roadmap assertions, first-agent anchor becomes the `agent:setup` label. Keep the `ALL SCENARIOS PASSED` sentinel.

In `tests/test_canary.py` (line 93–94): replace the two containment asserts with the negative pin:

```python
assert "waves-file-check" not in wf  # preflight deleted (spec §2c, design-inputs §2)
```

- [ ] **Step 2: Run to verify failure**

Run: `node tests/sim_workflow.mjs` and `python3 -m pytest tests/test_canary.py -q` — expected FAIL (the block still exists).

- [ ] **Step 3: Delete**

- `waves.js`: remove lines 1801–1852 (`bodylessIds`, `WAVES_FILE_PREFLIGHT`, `WAVES_FILE_SCHEMA`, `preflightWavesFile`) and the call at 1875. Keep the `#setup-at-bottom` ordering comment (it now documents the setup dispatch directly).
- `audit_run.py`: remove the `ROLE_MARKERS` entry `("You are a read-only preflight agent", "waves-file-check")` (line 45) and its comment.
- `workflow-template.md`: drop the "(including the wavesPath preflight)" clause (line 167).

- [ ] **Step 4: Validate the harness parses and the sims pass**

Run: the stripped `node --check` procedure from `workflow-template.md` §Syntax checking (or `python3 -m pytest tests/test_canary.py -q`, which includes the parse test); then `node tests/sim_workflow.mjs` (exit 0 + `ALL SCENARIOS PASSED`) and `python3 -m pytest tests/test_no_prompt_drift.py -q`.

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/harnesses/waves.js skills/ultrapowers/scripts/audit_run.py skills/ultrapowers/references/workflow-template.md tests/sim_workflow.mjs tests/test_canary.py
git commit -m "feat(engine): delete agent-based waves-file preflight — guarded defect inexpressible (spec §2c)"
```

---

### Task 6: ultraplan rewrite — Move 3, Commutes doctrine, body relaxation, rubric clause

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultraplan/SKILL.md`
- Modify: `skills/ultrapowers/references/plan-markers.md`
- Modify: `hooks/session_start.sh`
- Modify: `tests/test_ultraplan_skill.py`
- Modify: `tests/test_recommendation_rubric.py`
- Modify: `tests/test_marker_contract.py`

**Interfaces:**
- Consumes: the `Commutes:` grammar as the Commutes-compiler task defines it (doc must match: comma-separated paths, must appear in the task's own `Files:`).
- Produces: the rewritten authoring doctrine later plans compile against; the new BRANCH_CLAUSES[0] string (exact text in Step 3, byte-identical in both legs and the test constant).

**Word budget (acceptance criterion):** `wc -w skills/ultraplan/SKILL.md` ≤ 3,400 (currently 4,002 — a net cut while adding three new pieces).

- [ ] **Step 1: Update the pins first**

- `tests/test_recommendation_rubric.py`: replace `BRANCH_CLAUSES[0]` with the new clause (exact string):
  `"after treating non-text same-file edits between tasks as dependencies (text overlap folds at merge)"`.
- `tests/test_ultraplan_skill.py`: add token pins (same style as the existing shaping-tokens test) requiring `Commutes:`, `author for the resolver`, and `Review: adversarial` + `sketch` (the body-relaxation rule) in `skills/ultraplan/SKILL.md`; add a negative pin that `"Describe siblings by role"` no longer appears.
- `tests/test_marker_contract.py`: if the compiler-pattern disclosure test enumerates marker regexes, add `MARKER_COMMUTES` to the expected set.

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m pytest tests/test_ultraplan_skill.py tests/test_recommendation_rubric.py tests/test_marker_contract.py -q` — expected FAIL.

- [ ] **Step 3: Rewrite the two skill files (mirrored blocks stay in sync)**

`skills/ultraplan/SKILL.md`:

1. **Move 3 rewritten** (replaces lines 35–43): coupling is interfaces and existence, not files; the compiler no longer serializes same-file text writes in any form — the fold path owns them; declare `**Commutes:**` on shared registration surfaces so the engine can classify (and auto-union) the contention; the three contortions stay named as defects verbatim (unnatural split; chain-for-a-fan; overlap-only `Depends-on`). Keep "`**Files:**` blocks remain required — they are the compiler's contention-detection input."
2. **Delete the phantom-edge rules**: the "Describe siblings by role, not by filename" block (314–323) and the self-review bullet at 469. The `prose-reference`/`description-inferred` tiers they served are gone. Keep the test-import `Depends-on` rule (305–312), updating its justification: it is now the only thing that orders a `Test:` against a sibling's created file (`read-after-write` is deleted).
3. **`Commutes:` authoring doc**: add the marker to the Marker syntax section (this text is inside the mirrored `MARKER_SYNTAX` region — update `plan-markers.md`'s BAKE block and the SKILL.md mirror together): optional; comma-separated backticked paths that must appear in the task's own `Files:`; means "my edits to these files are order-insensitive additive registrations"; declare it only when true — review audits the claim the way it audits test contracts.
4. **Author for the resolver** (one paragraph, per spec rev 7 §2c): stable anchors, designated append zones, registration patterns — guidance, not a compiler input.
5. **Scoped body relaxation**, stated as an explicit ultraplan override of writing-plans' "complete code in every step": an `implementation` body must be interface- and test-complete; implementation steps may sketch routine glue — **except** tasks marked `Review: adversarial`, which keep exact code.
6. **Keep one sentence**: "chain non-text (binary/symlink) same-file pairs with `Depends-on` — they run in parallel otherwise and always fall back."
7. Update the parallel-width clause (line ~142) to the new BRANCH_CLAUSES[0] text.

`hooks/session_start.sh`: update the width clause (lines 65–66) to the same byte-identical string, keeping the clause before the decision tree.

`skills/ultrapowers/references/plan-markers.md`: mirror the Marker-syntax change (BAKE block); update Compile-time obligations and Files grammar sections to the kept tiers + new refusals (brace globs refused, `catch-all` label refused with did-you-mean, Files-less marked implementation refused).

- [ ] **Step 4: Verify budgets and pins**

Run: `wc -w skills/ultraplan/SKILL.md` (≤ 3,400) then `python3 -m pytest tests/test_ultraplan_skill.py tests/test_recommendation_rubric.py tests/test_marker_contract.py -q` — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/ultraplan/SKILL.md skills/ultrapowers/references/plan-markers.md hooks/session_start.sh tests/test_ultraplan_skill.py tests/test_recommendation_rubric.py tests/test_marker_contract.py
git commit -m "feat(ultraplan): Move-3 rewrite, Commutes doctrine, author-for-the-resolver, scoped body relaxation; phantom-edge rules deleted (spec §2c)"
```

---

### Task 7: ultrapowers SKILL.md — P6 line, Step-3 render classification, word budget

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`

**Interfaces:**
- Consumes: the render reads `launch_waves` task fields `writes`/`commutes` (the Commutes-compiler task defines them; prose here must name those exact fields).
- Produces: the operator-facing render contract for the three-way contention classification.

**Word budget (acceptance criterion):** `wc -w skills/ultrapowers/SKILL.md` ≤ 2,920 (currently 2,937 — the additions below require offsetting cuts).

- [ ] **Step 1: Edit**

1. **Step 1 (P6, carried prose)** — one line joining the Step-1 stage discussion: if the fresh-worktree baseline is red for reasons unrelated to the plan, repair base first and re-baseline rather than launching red.
2. **Step 3 item 3** — the fully-overlapping degrade is deleted; rewrite: mode is `sequential` only for single-task plans.
3. **Step 3 item 5 (or a new render item)** — expected contention, three-way (rev 7): from same-wave `writes` intersections × each task's `commutes`, render `declared-commutative` (every writer declared — expected to auto-union) vs `composition-unpinned` (≥1 writer undeclared); when tasks carry no `writes` field say so once instead of classifying.
4. Trim elsewhere in the file to land under 2,920 words.

- [ ] **Step 2: Verify budget + suite**

Run: `wc -w skills/ultrapowers/SKILL.md` (≤ 2,920); `python3 -m pytest tests/test_ultraplan_skill.py -q` (cross-file pins) — expected PASS.

- [ ] **Step 3: Commit**

```bash
git add skills/ultrapowers/SKILL.md
git commit -m "docs(ultrapowers): P6 red-baseline line, three-way contention render, degrade wording; budget 2920 (spec §2c/rev 7)"
```

---

### Task 8: ab_runner — kept-set edge check in the fold identity branch

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `evals/ab_runner.py`
- Test: `tests/test_ab_arm_identity.py`

**Interfaces:**
- Consumes: the kept edge vocabulary from Global Constraints (`marker`, `text`, `interface`, `write-after-create`).
- Produces: `assert_arm_identity`'s fold branch additionally fails on any `dag_edges` entry whose `why` is outside the kept set (a compiler-version check, not a new named predicate).

- [ ] **Step 1: Write the failing tests**

```python
def test_fold_fail_non_kept_edge_label_present():
    receipt = fold_receipt()  # existing builder
    receipt["compile"]["dag_edges"].append({"from": "1", "to": "2", "why": "prose-reference"})
    ok, detail = assert_arm_identity(receipt, "fold")
    assert not ok and "non-kept" in detail

def test_fold_pass_kept_labels_only():
    receipt = fold_receipt()
    receipt["compile"]["dag_edges"] = [{"from": "1", "to": "2", "why": "marker"},
                                       {"from": "1", "to": "3", "why": "interface"}]
    ok, _ = assert_arm_identity(receipt, "fold")
    assert ok
```

- [ ] **Step 2: Run to verify failure** — `python3 -m pytest tests/test_ab_arm_identity.py -q`.

- [ ] **Step 3: Implement**

In `assert_arm_identity`'s fold branch (after the `waw_edges` guard at ~210):

```python
KEPT_EDGE_WHYS = ("marker", "text", "interface", "write-after-create")
stray = [e for e in dag_edges if e.get("why") not in KEPT_EDGE_WHYS]
if stray:
    return False, "fold: %d non-kept edge label(s) present (%s) — compiler predates Phase 2?" % (
        len(stray), ",".join(sorted({e.get("why") or "?" for e in stray})))
```

- [ ] **Step 4: Run** — `python3 -m pytest tests/test_ab_arm_identity.py -q` — PASS.

- [ ] **Step 5: Commit**

```bash
git add evals/ab_runner.py tests/test_ab_arm_identity.py
git commit -m "feat(evals): kept-set edge check in fold arm identity (spec §2a)"
```

---

### Task 9: Sim coverage for the composition/auto-union seam in `sim_workflow.mjs`

**Type:** implementation
**Depends-on:** 4

**Files:**
- Test: `tests/sim_workflow.mjs`

**Interfaces:**
- Consumes: `writes`/`commutes` launch fields and the composition-row strings the engine task produces.
- Produces: end-to-end sim assertion that a full workflow run carries composition rows into the report (the frontier sims cover the merge unit; this covers the report seam).

- [ ] **Step 1: Add one scenario** to `tests/sim_workflow.mjs`: a two-task wave whose launch tasks carry intersecting `writes` with one undeclared writer; assert the final report's `judgmentCalls` contains one `composition-unpinned:`-prefixed string, and that a run whose tasks lack `writes` produces the skipped-note instead. Keep the sentinel.

- [ ] **Step 2: Run** — `node tests/sim_workflow.mjs` — exit 0 + `ALL SCENARIOS PASSED`.

- [ ] **Step 3: Commit**

```bash
git add tests/sim_workflow.mjs
git commit -m "test(sims): composition-unpinned rows reach the report (spec §2b)"
```

---

### Task 10: Migration reading — corpus edge diff against the pre-registered answer

**Type:** implementation
**Depends-on:** 1, 2

**Files:**
- Create: `evals/frontier/results/2026-08-20-phase2-migration.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: the final compiler (subtraction + Commutes) from its two tasks.
- Produces: the one-time migration reading (a recorded document, not a permanent test) adjudicating the measured-inert deletion.

- [ ] **Step 1: Run the reading**

For every marked plan under `docs/superpowers/plans/` (the `test_all_plans_compile.py` enumeration: `*.md` containing `Depends-on:`), compile twice (`--overlap fold` and `--overlap serialize`) and collect the `dag_edges` `why` multiset per plan plus each plan's `mode`. A short throwaway loop in the scratchpad is fine; the committed artifact is the results document.

- [ ] **Step 2: Compare against the pre-registered answer (spec §2a)**

Pre-registered (rev 3, re-verified round 3, 97 marked plans): marker 180, interface 17, write-after-create 2, prose-reference 3 (2 plans), read-after-write 0, ambiguous-files 0, catch-all 0; write-after-write 35 under `serialize`, 0 under `fold`; 20 plans `mode: sequential` under fold. **Expected diff: exactly "−3 prose-reference, plus any `sequential`-mode flips from the degrade deletion."** Also compile the seven fixture repos under `evals/fixtures/` and record their compiled shapes' diffs. Any other delta = the task fails: stop and investigate the compiler change; do not adjust the answer.

- [ ] **Step 3: Record**

Write `evals/frontier/results/2026-08-20-phase2-migration.md`: the per-label totals in both modes, the per-plan diff rows (only plans whose multiset changed), the fixture-shape diffs, and the verdict line against the pre-registered answer. In `CLAUDE.md`, extend the frozen-periphery bullet's compiler sentence with the measured-inert-deletion clause: the Phase-2 tier deletion was licensed by this recorded reading (name the file) plus the rig re-run.

- [ ] **Step 4: Commit**

```bash
git add evals/frontier/results/2026-08-20-phase2-migration.md CLAUDE.md
git commit -m "docs(evals): Phase-2 corpus migration reading vs pre-registered answer (spec §2a/§2d)"
```

---

### Task 11: Suite gate

**Type:** gate
**Depends-on:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10

**Files:**
- Test: `tests/`

Full verification: `python3 -m pytest -q` green (includes the corpus pin, drift pins, rubric pins, canary); each harness sim green with sentinel: `node tests/frontier_merge.mjs`, `node tests/sim_workflow.mjs`, `node tests/sim_derived_heads.mjs`, `node tests/wave_ancestry_sim.mjs`.

---

### Task 12: T15-rig mechanics re-run (integration acceptance) + planning-cost read

**Type:** manual

Operator-run eval cells (session-driven; not waved). Per spec §2d: run the T15 rig (`evals/ab_runner.py`) on `contend-prod` and `contend-big` with the Phase-2 compiler — arm identity now enforces 0 non-kept edges (Task 8). Hard gates verbatim from T15 (arm identity, both gates green, `selfChecks: ok`, zero fallbacks on the contended wave, every park named, zero silent divergence). This run is the multi-plan effort's **integration-spanning acceptance** (Phase-1 resolver + Phase-2 compiler on one tree). Record cells under `evals/frontier/results/`. Read planning cost (plan word count, planning-session turn count) against the Phase-1 baseline as an observation. Fold-canary note: the `composition-unpinned` rows and auto-union rate start reading at the next ≥2 sense passes — no pre-release read required.

---

### Task 13: Release 0.2.17

**Type:** release
**Depends-on:** 11

After Task 12's cells are recorded and read: bump `version` to `0.2.17` in **both** `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`; commit `chore(release): 0.2.17 — fold-native Phase 2: compiler subtraction, Commutes + assume rung, ultraplan rewrite, preflight deletion` to `main`; push; confirm CI green on `main` (`gh run list --branch main --limit 1`).

---

## Operator smoke

- do: `python3 skills/ultrapowers/scripts/compile_plan.py --check docs/superpowers/plans/2026-08-20-fold-native-phase2.md`
  see: `PLAN OK` — the new compiler accepts this very plan, including its own marker grammar.
- do: create a scratch plan file with one task whose Files block reads `- Modify: src/{a,b}.py`, then run the same `--check` on it.
  see: a refusal naming the glob and telling you to enumerate concrete paths (not a silent pass).
- do: create a scratch plan with a `**Type:** implementation` task whose Files block is only `- none`, run `--check`.
  see: the refusal "declares no file paths under Files:" with the fix wording.
- do: in a scratch task, add `**Commutes:** \`app/x.py\`` while Files only lists `- Modify: \`app/y.py\``, compile without `--check`.
  see: the plan still compiles; the output's marker conflicts name the ignored Commutes path — a warning, never a block.

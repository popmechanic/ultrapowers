# The compiler tier cut — the tests of a grammar the fleet refuses are gone, and the refusals it depends on stay

**Grammar:** claims-v1

**Claim:** do: cut the compiler test tier now; keep the parse refusals the launcher and sandbox depend on. see: the compile census is the instrument. (elicited)
**Summary:** This deletes the tests of a plan grammar the fleet no longer accepts, so the suite stops paying for rules nothing can break. It exists because sixteen runs and the catch counter showed these tests catch nothing, and a test that catches nothing is cost without a sensor. You get a faster suite and a census that says exactly which compiler behaviour is still pinned.

**Goal:** Operator decision 2 of 2026-09-10 (memory `test-estate-decisions-2026-09-10`): the legacy-grammar half of the compiler tier goes — `tests/test_plan_check.py` and `tests/test_compile_plan_acceptance_line.py` whole, and every test in `tests/test_compile_plan.py` whose subject is ordering or classification the claims-v1 grammar refuses outright (`**Depends-on:**`, `**Commutes:**`, prose text dependencies, marker placement and near-miss heuristics) — while every test of the machinery both grammars share (the Files block and its strict refusals, fences and headings, wave labels, `--emit-launch`/`--emit-args`, Interfaces placeholders, the `**Review:**` values, gate classification) stays where it is, and the compiler itself is not touched. The eleven claims-v1 files and `tests/test_compile_plan_check_output.py` (the compile census's own exam) are outside this cut; the ratchet takes them later if the counter's window reads zero.

**Tech Stack:** Python 3, pytest; Node 24 ESM sims under `fleet/tests/`.

**Spec:** memory `test-estate-decisions-2026-09-10` decision 2; #875 (the ratchet); every fact a worker needs is in the task's Context.

**Parallelization rationale:** one task. Two whole-file deletions and one file's subject cut share one Claim and one exam; splitting them buys no width worth a second review.

**Launch base:** main after v0.3.25 is tagged (run-101's merge), so the cut lands on a released tree.

## Global Constraints

- The compiler and the fixture corpus are not changed by this plan: the cut is tests only.
- Check: git diff --quiet $ULTRA_BASE -- skills/ultrapowers/scripts/compile_plan.py evals/
- A deletion is whole: no test, mention or bridge entry survives that names a deleted file, except history (a fixture plan under `tests/fixtures/`, a plan under `docs/`, a comment that says the line left the grammar).

### Task 1: The legacy-grammar tests are gone and the shared refusals stay

**Type:** implementation
**Review:** peer

**Files:**
- Delete: `tests/test_plan_check.py`
- Delete: `tests/test_compile_plan_acceptance_line.py`
- Modify: `tests/test_compile_plan.py`
- Modify: `tests/test_plan_level_claim.py`
- Modify: `tests/test_compile_plan_check_constraints.py`

**Claim:** The tests of the plan grammar the fleet refuses are gone, the tests of the refusals the launcher and sandbox depend on are still there and green, and no test of the compiler's own code was touched. (derived)
Machine: M1. `tests/test_plan_check.py` and `tests/test_compile_plan_acceptance_line.py` are absent. M2. No line of `tests/test_compile_plan.py` contains any of `Depends-on`, `depends_on`, `Commutes`, `commutes`, `text_dependency`, `text_edge`, `heuristic`, `near_miss`, and no other file under `tests/` names `test_plan_check.py` or `test_compile_plan_acceptance_line.py` outside `tests/fixtures/`. M3. Each of `test_glob_is_a_violation`, `test_unknown_label_is_a_violation_with_did_you_mean`, `test_annotated_files_line_is_a_violation_with_extract_fix`, `test_placeholder_token_set`, `test_placeholder_interfaces_produce_zero_edges`, `test_emit_launch_writes_verbatim_bodies`, `test_emit_args_writes_complete_launch_skeleton`, `test_invalid_review_value_is_a_compile_error`, `test_duplicate_task_ids_are_a_loud_error`, `test_files_less_marked_implementation_task_is_refused`, `test_empty_writes_buildqa_task_classifies_as_gate`, `test_global_constraints_stop_at_first_task_heading` is defined at top level in `tests/test_compile_plan.py`, and `python3 -m pytest -q tests/test_compile_plan.py tests/test_compile_plan_check_output.py` passes. M4. `tests/test_compile_plan.py` collects at least 35 and at most 70 test cases. M5. `node fleet/tests/test_referee_linker.mjs` and `node fleet/tests/test_sims_are_hermetic.mjs` each print `ALL TESTS PASSED`.

**Authorized-by:** operator decision 2 of 2026-09-10 (memory `test-estate-decisions-2026-09-10`); #875; CLAUDE.md §Wayfinding "deletion is owed per guard"

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Read at BASE `121c6cec` (2026-09-11). `tests/test_compile_plan.py` is 2364 lines and collects 121 cases; its module-level helpers (`_run_compiler`, `compile_plan`, `compile_plan_serialize`, `compile_plan_raw`, `compile_plan_raw_with`, `_with_plan_file`, `compile_plan_text`, `_serialize_text`, `compile_raw_text`, `sh`, `_emit_launch_payload`, `_emit_args_entries`, `_compile_raw`) serve both halves and stay. Every plan template in the file is legacy grammar (no `**Grammar:**` line), and the legacy parser is the compiler's rollback path, so the tests that stay keep exercising it — that is intended; only the SUBJECT decides: a test goes when what it grades is an edge or a classification the claims-v1 grammar refuses outright (`compile_plan.py:1105`: `**Depends-on:**`/`**Commutes:**` are refused), namely the marker-edge, `Depends-on`, text-dependency ("after Task 1" prose), cycle-from-markers, marker-placement, near-miss-marker and heuristic-classification tests of lines 46–1042 and the whole `Commutes:` section at lines 2181–2365; a test stays when what it grades is shared machinery — the Files block and its strict refusals (annotated line, unknown label, glob, brace glob, catch-all label, Files-less implementation task), fences and headings, wave labels, `--emit-launch`/`--emit-args` (the sandbox's `fleet/publish-fold-block.mjs:180` runs `--emit-launch`), Interfaces placeholders and token matching, the `**Review:**` values, gate classification, Global Constraints parsing. Survivors whose template carries `**Depends-on:** none` lose that line (the legacy parser treats an absent marker as none) so that M2's vocabulary sweep is clean; a survivor whose body still needs a `Depends-on` value to make its point is by that fact a legacy test and goes. A test that mentions `Commutes` only to assert the compiled payload carries an empty `commutes` key (e.g. `test_undeclared_task_emits_empty_commutes`) goes with the section; `test_compiled_edge_vocabulary_is_the_kept_set` stays if it survives the sweep, and is rewritten without the vocabulary if not. Expect roughly 45–60 survivors; M4's bounds are wide on purpose. Two comments outside the file name `tests/test_compile_plan_acceptance_line.py` as history — `tests/test_plan_level_claim.py:338` and `tests/test_compile_plan_check_constraints.py:101` — reword each to say the line left the grammar without naming the deleted file. `tests/fixtures/plans/*.md` name both deleted files in fixture plan texts read by no test as executable; they stay. `fleet/tests/test_referee_linker.mjs:985–1002` reads `test_placeholder_token_set`'s body from `tests/test_compile_plan.py` as text, and `fleet/tests/test_sims_are_hermetic.mjs:881–886` pins that it does; both keep working because that test stays — M5 is the check that the survivor list did not lose it. `tests/test_compile_plan_check_output.py` is run-88's exam of the compile census and stays untouched; it is in M3's command only as a reader of the same tree. No `evals/fixtures/` directory is deleted: the census compiles every one of them, and `contend-wide` and `flawed-routing` are named only by the deleted tests, which is not a reason to remove a census row. The counter's reading behind the cut: `tests/test_compile_plan.py`, `tests/test_plan_check.py` and `tests/test_compile_plan_acceptance_line.py` are at zero catches in the ledger at BASE.

**Proof:**
- Run: test ! -e tests/test_plan_check.py && test ! -e tests/test_compile_plan_acceptance_line.py
- Run: ! grep -n -E 'Depends-on|depends_on|Commutes|commutes|text_dependency|text_edge|heuristic|near_miss' tests/test_compile_plan.py && ! grep -rn --exclude-dir=fixtures -E 'test_plan_check\.py|test_compile_plan_acceptance_line\.py' tests/
- Run: for t in test_glob_is_a_violation test_unknown_label_is_a_violation_with_did_you_mean test_annotated_files_line_is_a_violation_with_extract_fix test_placeholder_token_set test_placeholder_interfaces_produce_zero_edges test_emit_launch_writes_verbatim_bodies test_emit_args_writes_complete_launch_skeleton test_invalid_review_value_is_a_compile_error test_duplicate_task_ids_are_a_loud_error test_files_less_marked_implementation_task_is_refused test_empty_writes_buildqa_task_classifies_as_gate test_global_constraints_stop_at_first_task_heading; do grep -q "^def $t(" tests/test_compile_plan.py || { echo "gone: $t"; exit 1; }; done && python3 -m pytest -q tests/test_compile_plan.py tests/test_compile_plan_check_output.py
- Run: n=$(python3 -m pytest --collect-only -q tests/test_compile_plan.py | grep -c '::'); echo "collected $n"; test "$n" -ge 35 && test "$n" -le 70
- Run: node fleet/tests/test_referee_linker.mjs | grep -q 'ALL TESTS PASSED' && node fleet/tests/test_sims_are_hermetic.mjs | grep -q 'ALL TESTS PASSED'
- Legs: (a) the first Run: fails if either deleted file survives [M1]; (b) the second Run: fails on any surviving legacy vocabulary line in the file, printing it with its line number, and fails on any file under `tests/` outside `tests/fixtures/`, whatever its extension, that names either deleted file [M2]; (c) the third Run: names the first survivor that is missing and fails, then runs the two files as pytest does [M3]; (d) the fourth Run: prints the collected count and fails below 35 or above 70 [M4]; (e) the fifth Run: runs both sims and fails unless each prints the sentinel [M5].

**Stale-if:**
- path-absent: `tests/test_compile_plan.py`
- path-absent: `tests/test_compile_plan_check_output.py`
- path-absent: `fleet/tests/test_referee_linker.mjs`

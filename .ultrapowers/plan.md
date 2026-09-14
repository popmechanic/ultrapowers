# The suite is the survivors — 259 zero-catch test files, the legacy grammar, ultralearn and ultradocket go; CLAUDE.md describes the plugin that exists today

**Grammar:** claims-v1

**Claim:** After this run, when I launch a plan, the suite it runs is the 15 tests that have ever caught something, the old plan grammar and the learning skills are gone, and CLAUDE.md reads like the plugin that exists today. (elicited)
**Summary:** This run deletes the parts of ultrapowers that have never caught anything: 194 of 211 test files, the pre-claims plan grammar, the learning and docket skills, and the history in CLAUDE.md. It exists because the record shows two-thirds of a run's wall going to verification that has never blocked a defect, so the clock pass starts by removing what the reading does not license. What you get is a suite that runs in about a minute instead of five, an engine that still refuses a plan without an executable proof, and a CLAUDE.md that describes the plugin that exists today.

**Goal:** The clock pass, move 1 (session 2026-09-13/14: metric = launch-to-verified-green on the run-67 replay; floor = driver-run proofs; deletions licensed per file by the catch counter over runs 40–123). The engine's own changes (the implementer's brief, the per-task loop, VM sizing) are the next plan and are untouched here.

**Tech Stack:** Python 3 (compiler, gate scripts, pytest), Node 20+ (`fleet/*.mjs`, sims), bash. Test command: `python3 -m pytest -n auto` from the repo root.

**Spec:** the session record — memory `record-reading-runs-40-116-2026-09-13.md` (the catch counter's reading is the licence for every Delete: below; regenerate it with `python3 skills/ultralearn/scripts/catch_counter.py --ledger <ledger> <record-tree>` then `catch_report.py --ledger <ledger> --tree . --n 40`).

**Parallelization rationale:** one wave, width 4. The four tasks partition the deletions by seam — Task 1 the engine and script tests, Task 2 the compiler's legacy grammar with its fixtures and the tests that read them, Task 3 the two skills with their tests, Task 4 the operator document — so no path appears in two Files blocks and nothing waits on anything: a deletion needs no sibling's runtime behaviour.

## Global Constraints

- The engine is not touched by this plan: `fleet/run-engine.mjs`, `fleet/run-worker.mjs`, `fleet/run-waves.mjs`, `fleet/sandbox-boot.sh` and every file under `fleet/roles/` are byte-identical to BASE.
- Check: git diff --quiet $ULTRA_BASE -- fleet/run-engine.mjs fleet/run-worker.mjs fleet/run-waves.mjs fleet/sandbox-boot.sh fleet/roles
- No file is deleted that a task's Files block does not name with a `Delete:` bullet. Of the 15 surviving test files, the 10 no task names with `Modify:` are byte-identical to BASE; the five a task does name (three pytest files under Task 2, two sims under Task 1) change only where their pins name a file this plan deletes.
- Check: git diff --quiet $ULTRA_BASE -- fleet/tests/test_janitor.mjs fleet/tests/test_run_engine_infra_retry.mjs fleet/tests/test_run_engine_joined_proofs.mjs fleet/tests/test_run_engine_review_economy.mjs fleet/tests/test_sandbox_boot_viz.mjs fleet/tests/test_worker_kata_env.mjs tests/test_deadline_slack.py tests/test_fleet_suite.py tests/test_ultra_run_exam_command.py tests/test_ultra_run_task_test_cmds.py
- The whole suite, `python3 -m pytest -n auto`, is green on the adopted tree; it is the run's reported sensor, and a red it inherits from a deletion that orphaned an import is this plan's defect, not the tree's.

### Task 1: The engine and script tests at zero catches are gone

**Type:** implementation

**Files:**
- Modify: `fleet/tests/test_sims_are_hermetic.mjs`
- Modify: `fleet/tests/test_run_engine_proof_runs.mjs`
- Delete: `fleet/tests/test_readiness_fold_order_exam.mjs`
- Delete: `fleet/tests/test_claims_grammar.mjs`
- Delete: `fleet/tests/test_claude_token.mjs`
- Delete: `fleet/tests/test_claude_token_install.mjs`
- Delete: `fleet/tests/test_confine_hook.mjs`
- Delete: `fleet/tests/test_deadline_slack.mjs`
- Delete: `fleet/tests/test_doctor.mjs`
- Delete: `fleet/tests/test_doctor_config_keys.mjs`
- Delete: `fleet/tests/test_doctor_render.mjs`
- Delete: `fleet/tests/test_exam_dispatch_role.mjs`
- Delete: `fleet/tests/test_exam_edited_patches.mjs`
- Delete: `fleet/tests/test_failing_block.mjs`
- Delete: `fleet/tests/test_fitness.mjs`
- Delete: `fleet/tests/test_fleet_bootstrap.mjs`
- Delete: `fleet/tests/test_janitor_hub.mjs`
- Delete: `fleet/tests/test_janitor_liveness.mjs`
- Delete: `fleet/tests/test_janitor_reap_only.mjs`
- Delete: `fleet/tests/test_janitor_state_key.mjs`
- Delete: `fleet/tests/test_kata_client.mjs`
- Delete: `fleet/tests/test_launch.mjs`
- Delete: `fleet/tests/test_launch_compile.mjs`
- Delete: `fleet/tests/test_launch_effort.mjs`
- Delete: `fleet/tests/test_launch_engine_source.mjs`
- Delete: `fleet/tests/test_launch_exam_command.mjs`
- Delete: `fleet/tests/test_launch_hold.mjs`
- Delete: `fleet/tests/test_launch_kata.mjs`
- Delete: `fleet/tests/test_launch_pins.mjs`
- Delete: `fleet/tests/test_launch_reaps.mjs`
- Delete: `fleet/tests/test_launch_render.mjs`
- Delete: `fleet/tests/test_launch_run_number.mjs`
- Delete: `fleet/tests/test_launch_test_command.mjs`
- Delete: `fleet/tests/test_lobby.mjs`
- Delete: `fleet/tests/test_no_binary_sources.mjs`
- Delete: `fleet/tests/test_publish_fold_block.mjs`
- Delete: `fleet/tests/test_readiness_fixtures.mjs`
- Delete: `fleet/tests/test_readiness_fold_order.mjs`
- Delete: `fleet/tests/test_retire.mjs`
- Delete: `fleet/tests/test_roles_examiner.mjs`
- Delete: `fleet/tests/test_roles_kata.mjs`
- Delete: `fleet/tests/test_roles_peer.mjs`
- Delete: `fleet/tests/test_run_engine_actor_routing.mjs`
- Delete: `fleet/tests/test_run_engine_attention.mjs`
- Delete: `fleet/tests/test_run_engine_blind_sensor.mjs`
- Delete: `fleet/tests/test_run_engine_candidate_bootstrap.mjs`
- Delete: `fleet/tests/test_run_engine_cap_width.mjs`
- Delete: `fleet/tests/test_run_engine_conflict.mjs`
- Delete: `fleet/tests/test_run_engine_critic_inputs.mjs`
- Delete: `fleet/tests/test_run_engine_early_baseline.mjs`
- Delete: `fleet/tests/test_run_engine_exam_concern.mjs`
- Delete: `fleet/tests/test_run_engine_exam_edits.mjs`
- Delete: `fleet/tests/test_run_engine_exam_fix_edit.mjs`
- Delete: `fleet/tests/test_run_engine_exam_together.mjs`
- Delete: `fleet/tests/test_run_engine_examiner.mjs`
- Delete: `fleet/tests/test_run_engine_fixloop.mjs`
- Delete: `fleet/tests/test_run_engine_fold_subject.mjs`
- Delete: `fleet/tests/test_run_engine_gate.mjs`
- Delete: `fleet/tests/test_run_engine_implementer_suite.mjs`
- Delete: `fleet/tests/test_run_engine_integrated_clean.mjs`
- Delete: `fleet/tests/test_run_engine_integrated_runs.mjs`
- Delete: `fleet/tests/test_run_engine_kata.mjs`
- Delete: `fleet/tests/test_run_engine_kata_close.mjs`
- Delete: `fleet/tests/test_run_engine_pre_review.mjs`
- Delete: `fleet/tests/test_run_engine_proposed_patch.mjs`
- Delete: `fleet/tests/test_run_engine_reconcile.mjs`
- Delete: `fleet/tests/test_run_engine_reconcile_subject.mjs`
- Delete: `fleet/tests/test_run_engine_red_suite_record.mjs`
- Delete: `fleet/tests/test_run_engine_reserved_exams.mjs`
- Delete: `fleet/tests/test_run_engine_review_pair.mjs`
- Delete: `fleet/tests/test_run_engine_review_peer.mjs`
- Delete: `fleet/tests/test_run_engine_state_exams.mjs`
- Delete: `fleet/tests/test_run_engine_suite_attribution.mjs`
- Delete: `fleet/tests/test_run_engine_wave_events.mjs`
- Delete: `fleet/tests/test_run_main_effort.mjs`
- Delete: `fleet/tests/test_run_main_engine_dir.mjs`
- Delete: `fleet/tests/test_run_record_keys.mjs`
- Delete: `fleet/tests/test_run_waves.mjs`
- Delete: `fleet/tests/test_run_worker.mjs`
- Delete: `fleet/tests/test_sandbox_boot.mjs`
- Delete: `fleet/tests/test_sandbox_boot_approved.mjs`
- Delete: `fleet/tests/test_sandbox_boot_bearer.mjs`
- Delete: `fleet/tests/test_sandbox_boot_card.mjs`
- Delete: `fleet/tests/test_sandbox_boot_edges.mjs`
- Delete: `fleet/tests/test_sandbox_boot_effort.mjs`
- Delete: `fleet/tests/test_sandbox_boot_exams.mjs`
- Delete: `fleet/tests/test_sandbox_boot_join.mjs`
- Delete: `fleet/tests/test_sandbox_boot_kata.mjs`
- Delete: `fleet/tests/test_sandbox_boot_park_state.mjs`
- Delete: `fleet/tests/test_sandbox_boot_publish_fold.mjs`
- Delete: `fleet/tests/test_sandbox_boot_record.mjs`
- Delete: `fleet/tests/test_sandbox_boot_render_env.mjs`
- Delete: `fleet/tests/test_sandbox_boot_residuals.mjs`
- Delete: `fleet/tests/test_sandbox_boot_selfmerge.mjs`
- Delete: `fleet/tests/test_sandbox_boot_state_exams.mjs`
- Delete: `fleet/tests/test_setup_script.mjs`
- Delete: `fleet/tests/test_setup_script_kata.mjs`
- Delete: `fleet/tests/test_setup_script_render_env.mjs`
- Delete: `fleet/tests/test_strip_exams.mjs`
- Delete: `fleet/tests/test_target.mjs`
- Delete: `fleet/tests/test_weave_emit.mjs`
- Delete: `fleet/tests/test_worker_kata_ref.mjs`
- Delete: `tests/test_ab_auth.py`
- Delete: `tests/test_ab_lib.py`
- Delete: `tests/test_ab_runner.py`
- Delete: `tests/test_all_plans_compile.py`
- Delete: `tests/test_audit_escalation.py`
- Delete: `tests/test_audit_run.py`
- Delete: `tests/test_barrier_slack.py`
- Delete: `tests/test_check_provenance.py`
- Delete: `tests/test_compile_docket.py`
- Delete: `tests/test_compile_plan_base_facts.py`
- Delete: `tests/test_compile_plan_clause_citation.py`
- Delete: `tests/test_compile_plan_exam_command.py`
- Delete: `tests/test_docket_lib.py`
- Delete: `tests/test_docs_agree_with_code.py`
- Delete: `tests/test_finalize_report.py`
- Delete: `tests/test_finalize_wiring.py`
- Delete: `tests/test_fleet_suite_collection.py`
- Delete: `tests/test_fold_wave.py`
- Delete: `tests/test_fold_wave_materialize.py`
- Delete: `tests/test_fold_wave_patch.py`
- Delete: `tests/test_fold_wave_subject.py`
- Delete: `tests/test_frontier_fold.py`
- Delete: `tests/test_frontier_kernel.py`
- Delete: `tests/test_frontier_run_eval.py`
- Delete: `tests/test_frontier_schedule.py`
- Delete: `tests/test_frontier_track_c.py`
- Delete: `tests/test_frontier_weave.py`
- Delete: `tests/test_gate_check.py`
- Delete: `tests/test_hunks.py`
- Delete: `tests/test_kernel_bijection.py`
- Delete: `tests/test_marker_contract.py`
- Delete: `tests/test_merge_entry.py`
- Delete: `tests/test_path_variables.py`
- Delete: `tests/test_plan_level_claim.py`
- Delete: `tests/test_proof_modes_documented.py`
- Delete: `tests/test_recommendation_rubric.py`
- Delete: `tests/test_rehydrate.py`
- Delete: `tests/test_repo_weave_report_determinism.py`
- Delete: `tests/test_report_runbook.py`
- Delete: `tests/test_roles_run_evidence.py`
- Delete: `tests/test_session_hook.py`
- Delete: `tests/test_skill_setup_section.py`
- Delete: `tests/test_ultra_gate.py`
- Delete: `tests/test_ultra_gate_record.py`
- Delete: `tests/test_ultra_run_overlap.py`
- Delete: `tests/test_ultrawrite_skill.py`
- Delete: `tests/test_ultrawrite_surface_rules_implementer_check.py`
- Delete: `tests/test_version_sync.py`
- Delete: `tests/test_weave_crosswave.py`
- Delete: `tests/test_weave_persistence.py`
- Delete: `tests/test_weave_shadow.py`

**Claim:** After this run the sims and script tests that never caught a defect are gone and only the survivors run. (derived)
Machine: M1. Each of the 150 files this task's Files block names with `Delete:` is absent from the tree. M2. Each of the 15 surviving test files named in Context is present, and the 10 of them no task names with `Modify:` are byte-identical to BASE. M3. `python3 -m pytest --collect-only -q tests/test_fleet_suite.py` collects exactly 8 `test_fleet_mjs` rows, one per surviving sim. M4. `fleet/tests/test_sims_are_hermetic.mjs` and `fleet/tests/test_run_engine_proof_runs.mjs` each print `ALL TESTS PASSED` on the patched tree, and neither still names any of the seven deleted sims they name at BASE: `test_run_engine_pre_review`, `test_run_engine_implementer_suite`, `test_run_engine_candidate_bootstrap`, `test_sandbox_boot_render_env`, `test_launch_render`, `test_setup_script_render_env`, `test_run_engine_state_exams`.

**Authorized-by:** the catch counter's reading over runs 40–123 (memory `record-reading-runs-40-116-2026-09-13.md`); operator decision 7 of 2026-09-10 (zero catches over the window, no second condition), reaffirmed 2026-09-14 for the 19 files under three days old.

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The 15 survivors: `fleet/tests/test_janitor.mjs`, `fleet/tests/test_run_engine_infra_retry.mjs`, `fleet/tests/test_run_engine_joined_proofs.mjs`, `fleet/tests/test_run_engine_proof_runs.mjs`, `fleet/tests/test_run_engine_review_economy.mjs`, `fleet/tests/test_sandbox_boot_viz.mjs`, `fleet/tests/test_sims_are_hermetic.mjs`, `fleet/tests/test_worker_kata_env.mjs`, `tests/test_deadline_slack.py`, `tests/test_fleet_suite.py`, `tests/test_review_peer.py`, `tests/test_ultra_run.py`, `tests/test_ultra_run_bootstrap_cmd.py`, `tests/test_ultra_run_exam_command.py`, `tests/test_ultra_run_task_test_cmds.py`. Two of them are this task's to edit because they pin deleted files, and one is deleted with the sim it examines. `fleet/tests/test_sims_are_hermetic.mjs` leg (b) asserts `SWEPT.length >= 50` (line ~772) — replace the floor with equality against the files the sweep is defined over, read from the directory at run time (the `test_*.mjs` and `_*.mjs` files under `fleet/tests/`), so the leg pins coverage, not a count; its `NESTED_AT_BASE` table (line ~873) names seven deleted sims and their siblings for leg (e) — make it empty and let leg (e) assert that no surviving sim reads a sibling list, or drop leg (e) with a comment saying the nested shape no longer exists in the tree; nothing else in that file changes. `fleet/tests/test_run_engine_proof_runs.mjs` builds probe copies of sibling sims in the loop at line ~948 — rows (f) `test_run_engine_pre_review.mjs` and (h) `test_run_engine_implementer_suite.mjs` name deleted sims; remove those two rows and their `pinName` legs, keep every other leg. `fleet/tests/test_readiness_fold_order_exam.mjs` is the wave-0 exam of `fleet/tests/test_readiness_fold_order.mjs`, which this task deletes, and its first assertion is that the sim exists — it goes with the sim. At BASE there is no `fleet/tests/exams/` directory; every deleted sim sits directly under `fleet/tests/`. The bridge `tests/test_fleet_suite.py` globs `fleet/tests/**/test_*.mjs` and filters its `SLOW_FIRST` list by presence, so it needs no edit when a named sim is gone. Helper modules (`fleet/tests/_helpers.mjs`, `_engine_helpers.mjs`, `_sandbox_boot_helpers.mjs`, `_lobby_helpers.mjs`, `_readiness_helpers.mjs`, `fleet/tests/deadline-slack.mjs`, `tests/deadline_slack.py`) are not test files, are imported by survivors, and stay. The six files under `fleet/tests/exams/run_69/` are guarded exams of the deleted referee and are in this task's list. Nothing else in the tree imports a file this task deletes; the survivors' imports were read at BASE and name only the helpers above. Sibling Task 2 owns the compiler tests and `tests/conftest.py`, Task 3 the ultralearn and ultradocket tests — do not touch a path outside this Files block.

**Proof:**
- Run: for f in fleet/tests/test_claims_grammar.mjs fleet/tests/test_claude_token.mjs fleet/tests/test_claude_token_install.mjs fleet/tests/test_confine_hook.mjs fleet/tests/test_deadline_slack.mjs fleet/tests/test_doctor.mjs fleet/tests/test_doctor_config_keys.mjs fleet/tests/test_doctor_render.mjs fleet/tests/test_exam_dispatch_role.mjs fleet/tests/test_exam_edited_patches.mjs fleet/tests/test_failing_block.mjs fleet/tests/test_fitness.mjs fleet/tests/test_fleet_bootstrap.mjs fleet/tests/test_janitor_hub.mjs fleet/tests/test_janitor_liveness.mjs fleet/tests/test_janitor_reap_only.mjs fleet/tests/test_janitor_state_key.mjs fleet/tests/test_kata_client.mjs fleet/tests/test_launch.mjs fleet/tests/test_launch_compile.mjs fleet/tests/test_launch_effort.mjs fleet/tests/test_launch_engine_source.mjs fleet/tests/test_launch_exam_command.mjs fleet/tests/test_launch_hold.mjs fleet/tests/test_launch_kata.mjs fleet/tests/test_launch_pins.mjs fleet/tests/test_launch_reaps.mjs fleet/tests/test_launch_render.mjs fleet/tests/test_launch_run_number.mjs fleet/tests/test_launch_test_command.mjs fleet/tests/test_lobby.mjs fleet/tests/test_no_binary_sources.mjs fleet/tests/test_publish_fold_block.mjs fleet/tests/test_readiness_fixtures.mjs fleet/tests/test_readiness_fold_order.mjs fleet/tests/test_retire.mjs fleet/tests/test_roles_examiner.mjs fleet/tests/test_roles_kata.mjs fleet/tests/test_roles_peer.mjs fleet/tests/test_run_engine_actor_routing.mjs fleet/tests/test_run_engine_attention.mjs fleet/tests/test_run_engine_blind_sensor.mjs fleet/tests/test_run_engine_candidate_bootstrap.mjs fleet/tests/test_run_engine_cap_width.mjs fleet/tests/test_run_engine_conflict.mjs fleet/tests/test_run_engine_critic_inputs.mjs fleet/tests/test_run_engine_early_baseline.mjs fleet/tests/test_run_engine_exam_concern.mjs fleet/tests/test_run_engine_exam_edits.mjs fleet/tests/test_run_engine_exam_fix_edit.mjs fleet/tests/test_run_engine_exam_together.mjs fleet/tests/test_run_engine_examiner.mjs fleet/tests/test_run_engine_fixloop.mjs fleet/tests/test_run_engine_fold_subject.mjs fleet/tests/test_run_engine_gate.mjs fleet/tests/test_run_engine_implementer_suite.mjs fleet/tests/test_run_engine_integrated_clean.mjs fleet/tests/test_run_engine_integrated_runs.mjs fleet/tests/test_run_engine_kata.mjs fleet/tests/test_run_engine_kata_close.mjs fleet/tests/test_run_engine_pre_review.mjs fleet/tests/test_run_engine_proposed_patch.mjs fleet/tests/test_run_engine_reconcile.mjs fleet/tests/test_run_engine_reconcile_subject.mjs fleet/tests/test_run_engine_red_suite_record.mjs fleet/tests/test_run_engine_reserved_exams.mjs fleet/tests/test_run_engine_review_pair.mjs fleet/tests/test_run_engine_review_peer.mjs fleet/tests/test_run_engine_state_exams.mjs fleet/tests/test_run_engine_suite_attribution.mjs fleet/tests/test_run_engine_wave_events.mjs fleet/tests/test_run_main_effort.mjs fleet/tests/test_run_main_engine_dir.mjs fleet/tests/test_run_record_keys.mjs fleet/tests/test_run_waves.mjs fleet/tests/test_run_worker.mjs fleet/tests/test_sandbox_boot.mjs fleet/tests/test_sandbox_boot_approved.mjs fleet/tests/test_sandbox_boot_bearer.mjs fleet/tests/test_sandbox_boot_card.mjs fleet/tests/test_sandbox_boot_edges.mjs fleet/tests/test_sandbox_boot_effort.mjs fleet/tests/test_sandbox_boot_exams.mjs fleet/tests/test_sandbox_boot_join.mjs fleet/tests/test_sandbox_boot_kata.mjs fleet/tests/test_sandbox_boot_park_state.mjs fleet/tests/test_sandbox_boot_publish_fold.mjs fleet/tests/test_sandbox_boot_record.mjs fleet/tests/test_sandbox_boot_render_env.mjs fleet/tests/test_sandbox_boot_residuals.mjs fleet/tests/test_sandbox_boot_selfmerge.mjs fleet/tests/test_sandbox_boot_state_exams.mjs fleet/tests/test_setup_script.mjs fleet/tests/test_setup_script_kata.mjs fleet/tests/test_setup_script_render_env.mjs fleet/tests/test_strip_exams.mjs fleet/tests/test_target.mjs fleet/tests/test_weave_emit.mjs fleet/tests/test_worker_kata_ref.mjs tests/test_ab_auth.py tests/test_ab_lib.py tests/test_ab_runner.py tests/test_all_plans_compile.py tests/test_audit_escalation.py tests/test_audit_run.py tests/test_barrier_slack.py tests/test_check_provenance.py tests/test_compile_docket.py tests/test_compile_plan_base_facts.py tests/test_compile_plan_clause_citation.py tests/test_compile_plan_exam_command.py tests/test_docket_lib.py tests/test_docs_agree_with_code.py tests/test_finalize_report.py tests/test_finalize_wiring.py tests/test_fleet_suite_collection.py tests/test_fold_wave.py tests/test_fold_wave_materialize.py tests/test_fold_wave_patch.py tests/test_fold_wave_subject.py tests/test_frontier_fold.py tests/test_frontier_kernel.py tests/test_frontier_run_eval.py tests/test_frontier_schedule.py tests/test_frontier_track_c.py tests/test_frontier_weave.py tests/test_gate_check.py tests/test_hunks.py tests/test_kernel_bijection.py tests/test_marker_contract.py tests/test_merge_entry.py tests/test_path_variables.py tests/test_plan_level_claim.py tests/test_proof_modes_documented.py tests/test_recommendation_rubric.py tests/test_rehydrate.py tests/test_repo_weave_report_determinism.py tests/test_report_runbook.py tests/test_roles_run_evidence.py tests/test_session_hook.py tests/test_skill_setup_section.py tests/test_ultra_gate.py tests/test_ultra_gate_record.py tests/test_ultra_run_overlap.py tests/test_ultrawrite_skill.py tests/test_ultrawrite_surface_rules_implementer_check.py tests/test_version_sync.py tests/test_weave_crosswave.py tests/test_weave_persistence.py tests/test_weave_shadow.py; do test ! -e "$f" || { echo "present: $f"; exit 1; }; done
- Run: for f in fleet/tests/test_janitor.mjs fleet/tests/test_run_engine_infra_retry.mjs fleet/tests/test_run_engine_joined_proofs.mjs fleet/tests/test_run_engine_proof_runs.mjs fleet/tests/test_run_engine_review_economy.mjs fleet/tests/test_sandbox_boot_viz.mjs fleet/tests/test_sims_are_hermetic.mjs fleet/tests/test_worker_kata_env.mjs tests/test_deadline_slack.py tests/test_fleet_suite.py tests/test_review_peer.py tests/test_ultra_run.py tests/test_ultra_run_bootstrap_cmd.py tests/test_ultra_run_exam_command.py tests/test_ultra_run_task_test_cmds.py; do test -e "$f" || { echo "missing: $f"; exit 1; }; done
- Run: git diff --quiet $ULTRA_BASE -- fleet/tests/test_janitor.mjs fleet/tests/test_run_engine_infra_retry.mjs fleet/tests/test_run_engine_joined_proofs.mjs fleet/tests/test_run_engine_review_economy.mjs fleet/tests/test_sandbox_boot_viz.mjs fleet/tests/test_worker_kata_env.mjs tests/test_deadline_slack.py tests/test_fleet_suite.py tests/test_ultra_run_exam_command.py tests/test_ultra_run_task_test_cmds.py
- Run: python3 -m pytest --collect-only -q tests/test_fleet_suite.py | grep -c 'test_fleet_mjs' | grep -qx 8
- Run: node fleet/tests/test_sims_are_hermetic.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_proof_runs.mjs | grep -q 'ALL TESTS PASSED'
- Run: test "$(grep -c -e test_run_engine_pre_review -e test_run_engine_implementer_suite -e test_run_engine_candidate_bootstrap -e test_sandbox_boot_render_env -e test_launch_render -e test_setup_script_render_env -e test_run_engine_state_exams fleet/tests/test_sims_are_hermetic.mjs fleet/tests/test_run_engine_proof_runs.mjs | awk -F: '{s+=$2} END {print s}')" = 0
- Legs: (a) the absence loop exits 0, naming any listed file still present [M1]; (b) the presence loop exits 0 for all 15 survivors and the BASE diff exits 0 for the 10 untouched ones [M2]; (c) the bridge collects exactly 8 `test_fleet_mjs` rows [M3]; (d) the two edited sims print their sentinel, and a grep over both for the seven names counts zero [M4].

**Stale-if:**
- path-absent: `tests/test_fleet_suite.py`

### Task 2: The compiler speaks only claims-v1 — the legacy grammar, its fixtures and their tests are gone

**Type:** implementation

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `tests/conftest.py`
- Modify: `fleet/launch.mjs`
- Modify: `fleet/run-main.mjs`
- Modify: `skills/ultrapowers/scripts/ultra_run.py`
- Modify: `tests/test_ultra_run.py`
- Modify: `tests/test_ultra_run_bootstrap_cmd.py`
- Modify: `tests/test_review_peer.py`
- Delete: `tests/test_arm_weave.py`
- Delete: `tests/test_bun_fixture.py`
- Delete: `tests/test_classify.py`
- Delete: `tests/test_compile_overlap.py`
- Delete: `tests/test_compile_plan.py`
- Delete: `tests/test_compile_plan_base_tree.py`
- Delete: `tests/test_compile_plan_check_constraints.py`
- Delete: `tests/test_compile_plan_check_output.py`
- Delete: `tests/test_compile_plan_claims.py`
- Delete: `tests/test_compile_plan_claims_edges.py`
- Delete: `tests/test_compile_plan_guard.py`
- Delete: `tests/test_compile_plan_proof_runs.py`
- Delete: `tests/test_compile_plan_proof_tests.py`
- Delete: `tests/test_compile_plan_task_test_cmd.py`
- Delete: `tests/test_corpus_extract.py`
- Delete: `tests/test_corpuslib.py`
- Delete: `tests/test_flawed_grammar.py`
- Delete: `tests/test_gate_verdicts.py`
- Delete: `tests/test_judge.py`
- Delete: `tests/test_pin_base_facts.py`
- Delete: `tests/test_replay_corpus.py`
- Delete: `tests/test_webapp_fixture.py`
- Delete: `evals/fixtures/bun-greenfield/plan.md`
- Delete: `evals/fixtures/bun-greenfield/project/.gitignore`
- Delete: `evals/fixtures/bun-greenfield/project/package.json`
- Delete: `evals/fixtures/bun-greenfield/project/src/registry.ts`
- Delete: `evals/fixtures/bun-greenfield/project/tests/registry.test.ts`
- Delete: `evals/fixtures/bun-greenfield/project/tsconfig.json`
- Delete: `evals/fixtures/chained/acceptance/test_acceptance_chained.py`
- Delete: `evals/fixtures/chained/plan.md`
- Delete: `evals/fixtures/chained/project/ledger/__init__.py`
- Delete: `evals/fixtures/chained/project/ledger/model.py`
- Delete: `evals/fixtures/chained/project/tests/test_model.py`
- Delete: `evals/fixtures/chained/reference/ledger/balance.py`
- Delete: `evals/fixtures/chained/reference/ledger/cli.py`
- Delete: `evals/fixtures/chained/reference/ledger/model.py`
- Delete: `evals/fixtures/chained/reference/ledger/parse.py`
- Delete: `evals/fixtures/chained/reference/ledger/report.py`
- Delete: `evals/fixtures/contend-big/acceptance/test_acceptance_contend_prod.py`
- Delete: `evals/fixtures/contend-big/plan.md`
- Delete: `evals/fixtures/contend-big/project/README.md`
- Delete: `evals/fixtures/contend-big/project/app/__init__.py`
- Delete: `evals/fixtures/contend-big/project/app/registry.py`
- Delete: `evals/fixtures/contend-big/project/app/report.py`
- Delete: `evals/fixtures/contend-big/project/app/router.py`
- Delete: `evals/fixtures/contend-big/project/app/storage.py`
- Delete: `evals/fixtures/contend-big/project/tests/test_registry.py`
- Delete: `evals/fixtures/contend-big/project/tests/test_report.py`
- Delete: `evals/fixtures/contend-big/project/tests/test_router.py`
- Delete: `evals/fixtures/contend-big/project/tests/test_storage.py`
- Delete: `evals/fixtures/contend-prod/acceptance/test_acceptance_contend_prod.py`
- Delete: `evals/fixtures/contend-prod/plan.md`
- Delete: `evals/fixtures/contend-prod/project/README.md`
- Delete: `evals/fixtures/contend-prod/project/app/__init__.py`
- Delete: `evals/fixtures/contend-prod/project/app/registry.py`
- Delete: `evals/fixtures/contend-prod/project/app/report.py`
- Delete: `evals/fixtures/contend-prod/project/app/router.py`
- Delete: `evals/fixtures/contend-prod/project/app/storage.py`
- Delete: `evals/fixtures/contend-prod/project/tests/test_registry.py`
- Delete: `evals/fixtures/contend-prod/project/tests/test_report.py`
- Delete: `evals/fixtures/contend-prod/project/tests/test_router.py`
- Delete: `evals/fixtures/contend-prod/project/tests/test_storage.py`
- Delete: `evals/fixtures/contend-wide/acceptance/test_acceptance_contend_wide.py`
- Delete: `evals/fixtures/contend-wide/plan.md`
- Delete: `evals/fixtures/contend-wide/project/clitool/__init__.py`
- Delete: `evals/fixtures/contend-wide/project/clitool/cli.py`
- Delete: `evals/fixtures/contend-wide/project/tests/test_smoke.py`
- Delete: `evals/fixtures/contend-wide/reference/clitool/cli.py`
- Delete: `evals/fixtures/contend/acceptance/test_acceptance_contend.py`
- Delete: `evals/fixtures/contend/plan.md`
- Delete: `evals/fixtures/contend/project/clitool/__init__.py`
- Delete: `evals/fixtures/contend/project/clitool/cli.py`
- Delete: `evals/fixtures/contend/project/tests/test_smoke.py`
- Delete: `evals/fixtures/contend/reference/clitool/cli.py`
- Delete: `evals/fixtures/contend/reference/clitool/textutil.py`
- Delete: `evals/fixtures/degrade/acceptance/test_acceptance_degrade.py`
- Delete: `evals/fixtures/degrade/plan.md`
- Delete: `evals/fixtures/degrade/project/confkit/__init__.py`
- Delete: `evals/fixtures/degrade/project/confkit/config.py`
- Delete: `evals/fixtures/degrade/project/tests/test_config.py`
- Delete: `evals/fixtures/degrade/reference/confkit/config.py`
- Delete: `evals/fixtures/flawed-routing/acceptance/test_acceptance_routing.py`
- Delete: `evals/fixtures/flawed-routing/plan.md`
- Delete: `evals/fixtures/flawed-routing/project/apistub/__init__.py`
- Delete: `evals/fixtures/flawed-routing/project/tests/test_smoke.py`
- Delete: `evals/fixtures/flawed-routing/version.txt`
- Delete: `evals/fixtures/flawed/acceptance/test_acceptance_mixed.py`
- Delete: `evals/fixtures/flawed/grammar/annotated-files.md`
- Delete: `evals/fixtures/flawed/grammar/double-catch-all.md`
- Delete: `evals/fixtures/flawed/grammar/glob.md`
- Delete: `evals/fixtures/flawed/grammar/unknown-label.md`
- Delete: `evals/fixtures/flawed/plan.md`
- Delete: `evals/fixtures/flawed/project/apistub/__init__.py`
- Delete: `evals/fixtures/flawed/project/tests/test_smoke.py`
- Delete: `evals/fixtures/flawed/reference/apistub/app.py`
- Delete: `evals/fixtures/flawed/reference/apistub/handlers.py`
- Delete: `evals/fixtures/flawed/reference/apistub/schema.py`
- Delete: `evals/fixtures/flawed/reference/apistub/serialize.py`
- Delete: `evals/fixtures/flawed/reference/apistub/store.py`
- Delete: `evals/fixtures/flawed/reference/apistub/validate.py`
- Delete: `evals/fixtures/flawed/version.txt`
- Delete: `evals/fixtures/jsdeps/project/.gitignore`
- Delete: `evals/fixtures/jsdeps/project/deps/fixture-dep/index.js`
- Delete: `evals/fixtures/jsdeps/project/deps/fixture-dep/package.json`
- Delete: `evals/fixtures/jsdeps/project/package.json`
- Delete: `evals/fixtures/jsdeps/project/test/dep.test.js`
- Delete: `evals/fixtures/mixed/acceptance/test_acceptance_mixed.py`
- Delete: `evals/fixtures/mixed/plan.md`
- Delete: `evals/fixtures/mixed/project/apistub/__init__.py`
- Delete: `evals/fixtures/mixed/project/tests/test_smoke.py`
- Delete: `evals/fixtures/mixed/reference/apistub/app.py`
- Delete: `evals/fixtures/mixed/reference/apistub/handlers.py`
- Delete: `evals/fixtures/mixed/reference/apistub/schema.py`
- Delete: `evals/fixtures/mixed/reference/apistub/serialize.py`
- Delete: `evals/fixtures/mixed/reference/apistub/store.py`
- Delete: `evals/fixtures/mixed/reference/apistub/validate.py`
- Delete: `evals/fixtures/mixed/version.txt`
- Delete: `evals/fixtures/webapp/plan.md`
- Delete: `evals/fixtures/webapp/project/README.md`
- Delete: `evals/fixtures/webapp/project/package.json`
- Delete: `evals/fixtures/wide/acceptance/test_acceptance_wide.py`
- Delete: `evals/fixtures/wide/plan.md`
- Delete: `evals/fixtures/wide/project/tests/test_slugify.py`
- Delete: `evals/fixtures/wide/project/textkit/__init__.py`
- Delete: `evals/fixtures/wide/project/textkit/slugify.py`
- Delete: `evals/fixtures/wide/reference/textkit/ngrams.py`
- Delete: `evals/fixtures/wide/reference/textkit/redact.py`
- Delete: `evals/fixtures/wide/reference/textkit/reverse_words.py`
- Delete: `evals/fixtures/wide/reference/textkit/titlecase.py`
- Delete: `evals/fixtures/wide/reference/textkit/truncate.py`
- Delete: `evals/fixtures/wide/reference/textkit/word_count.py`

**Claim:** After this run a plan without the claims-v1 header is refused before any VM, and nothing that only the old grammar used is left in the compiler or the tree. (derived)
Machine: M1. `compile_plan.py --check` on a plan whose header carries no `**Grammar:** claims-v1` line exits non-zero and prints a line beginning `grammar:` that contains the word `Grammar` (the missing header's own name), and never prints `PLAN OK`. M2. `compile_plan.py` accepts no `--overlap` flag: invoking it with `--overlap fold` exits 2 with a usage error, and the strings `--overlap`, `OVERLAP_MODES`, `OVERLAP_CHOICES` and `serialize` do not occur in `skills/ultrapowers/scripts/compile_plan.py`, `skills/ultrapowers/scripts/ultra_run.py`, `fleet/launch.mjs` or `fleet/run-main.mjs`. M3. The legacy-only functions `classify` and `_has_implementation_prose`, the `MARKER_DEPS` and `MARKER_COMMUTES` patterns, and the `LEGACY_GRAMMAR` constant are not defined in `compile_plan.py`, while `MARKER_TYPE` and `MARKER_REVIEW` are still defined and the claims fixture's three `**Type:** implementation` lines still compile to a `tasks` list of exactly three rows whose `disposition` is `implementation` and whose `heuristic` key is absent or false — read from the marker, never guessed. M4. Each file this task's Files block names with `Delete:` is absent. M5. `compile_plan.py evals/fixtures/claims/plan.md --check` prints `PLAN OK`, and `tests/conftest.py` no longer imports `corpuslib` or defines `fixture_corpus` while its collection-order hook remains. M6. `python3 -m pytest -q tests/test_ultra_run.py tests/test_ultra_run_bootstrap_cmd.py tests/test_review_peer.py` exits 0 on the patched tree, and `tests/test_review_peer.py` no longer reads `skills/ultradocket/SKILL.md`.

**Authorized-by:** session decision 4 of 2026-09-13 (the legacy grammar is dead on every live path: the driver refuses a legacy plan before any VM); the catch counter's reading for the 22 test files.

**Interfaces:**
- Consumes: none
- Produces: `plan_grammar(md_text) -> str` returns `claims-v1` for a plan carrying the header and raises `SystemExit` with a `grammar:` line for one that does not

**Context:** At BASE the compiler's default grammar is legacy: `plan_grammar` (compile_plan.py ~297) returns `LEGACY_GRAMMAR` when the `**Grammar:** claims-v1` header is absent, and every claims-v1 rule is gated on that value. The legacy-only surface, all inside `compile_plan.py`: the heuristic classifier `classify` (~1411) and `_has_implementation_prose` (~165) that guess a `Type:` from prose; the `MARKER_DEPS`/`MARKER_COMMUTES` regexes (~49, ~64) and the `Depends-on:`/`Commutes:` accumulation inside `parse_task` (~1169–1215, ~1349–1390) and the Commutes conflict rendering in `collect_violations` (~1772–1778); the TEXT edge tier and the `undeclared-dependency` cross-check in `build_edges` (~2195–2320), both already off under claims-v1; and the `--overlap serialize` knob (`OVERLAP_MODES`/`OVERLAP_DEFAULT` ~2125, the `write-after-write` tier). Keep `MARKER_TYPE`, `MARKER_REVIEW`, `MARKER_ISH` (it is what refuses a stray `Depends-on:` under claims-v1 — a refused marker is still a refusal, so the refusal text stays and only the legacy acceptance path goes). `fleet/launch.mjs` prints `[--overlap fold|serialize]` in its usage (~128), holds `OVERLAP_VALUES` (~136) and refuses a bad value (~650); `fleet/run-main.mjs` maps `'--overlap': 'overlap'` (~125), prints it in its usage (~135) and forwards it (~657); `skills/ultrapowers/scripts/ultra_run.py` holds `OVERLAP_CHOICES` (~175), appends `--overlap` to the compile argv when passed (~183–193) and declares the argparse flag (~487) — remove the flag from all four, and the `overlap` parameter of `build_compile_argv` with it. The word `serialize` is what M2 greps for, so a comment that keeps it is a red. `tests/conftest.py` imports `corpuslib` from `evals/frontier` and builds `fixture_corpus` once per session for the fold-corpus tests, all of which this task deletes; its `pytest_collection_modifyitems` hook (the bridge goes first) stays. `evals/ab_runner.py`, `evals/ab_lib.py`, `evals/compile_census.py`, `evals/judge.py`, `evals/frontier/split_fixture.py` and `evals/frontier/run_eval.py` read `evals/fixtures/` and are NOT deleted by this plan (out of scope, kept as the A/B harness; they lose their corpus and the operator was told). `pytest.ini` scopes collection to `tests/` and stays. The claims fixture `evals/fixtures/claims/` (plan + verdicts) stays and is M5's probe. Three surviving test files carry legacy plan fixtures inline and go red the moment the header is required: `tests/test_ultra_run.py` (`PLAN` at ~30–36: `**Depends-on:**` lines and `- [ ] **Step 1**` bullets, no Grammar line), `tests/test_ultra_run_bootstrap_cmd.py` (~34–37, the same shape) and `tests/test_review_peer.py` (`PLAN` at ~35–58, `**Review:** {value}` on a legacy body). Rewrite each fixture as a claims-v1 plan the driver's compile accepts — the compile the driver runs is `--emit-launch`/`--emit-args` without `--check`, so no gate verdicts are needed: `**Grammar:** claims-v1`, one plan `**Claim:** … (elicited)`, and per task `**Type:**` (and `**Review:** {value}` where the test varies it), a Files block, and the six slots with a `(derived)` Claim, a `Machine: M1.` line, and a Proof whose leg cites `[M1]`; no `**Depends-on:**`, no checkbox steps. Keep every assertion those tests make about the driver, the receipt and the `review` value; only the fixture text changes. In `tests/test_review_peer.py` delete `test_ultradocket_skill_marks_review_peer` (~176–178) and the `ULTRADOCKET_SKILL_MD` constant (~20), since sibling Task 3 deletes that skill. The `**Grammar:**` line stays required — this task makes its absence a refusal instead of a fallback. Report the compiler's line count before and after in the task summary; nothing gates it.

**Proof:**
- Run: P=$(mktemp -d)/legacy.md; printf '# Legacy plan\n\n### Task 1: A thing\n\n**Type:** implementation\n\n**Files:**\n- Create: thing.py\n\n**Claim:** A thing exists. (elicited)\nMachine: M1. thing.py exists.\n' > "$P"; python3 skills/ultrapowers/scripts/compile_plan.py "$P" --check > "$P.out" 2>&1; test $? -ne 0 && grep '^grammar:' "$P.out" | grep -q 'Grammar' && ! grep -q 'PLAN OK' "$P.out"
- Run: python3 skills/ultrapowers/scripts/compile_plan.py evals/fixtures/claims/plan.md --check --overlap fold > /dev/null 2>&1; test $? -eq 2
- Run: test "$(grep -c -e '--overlap' -e 'OVERLAP_MODES' -e 'OVERLAP_CHOICES' -e 'serialize' skills/ultrapowers/scripts/compile_plan.py skills/ultrapowers/scripts/ultra_run.py fleet/launch.mjs fleet/run-main.mjs | awk -F: '{s+=$2} END {print s}')" = 0
- Run: test "$(grep -c -e '^def classify' -e '^def _has_implementation_prose' -e '^MARKER_DEPS' -e '^MARKER_COMMUTES' -e '^LEGACY_GRAMMAR' skills/ultrapowers/scripts/compile_plan.py)" = 0
- Run: grep -q '^MARKER_TYPE' skills/ultrapowers/scripts/compile_plan.py && grep -q '^MARKER_REVIEW' skills/ultrapowers/scripts/compile_plan.py
- Run: for f in evals/fixtures/bun-greenfield/plan.md evals/fixtures/bun-greenfield/project/.gitignore evals/fixtures/bun-greenfield/project/package.json evals/fixtures/bun-greenfield/project/src/registry.ts evals/fixtures/bun-greenfield/project/tests/registry.test.ts evals/fixtures/bun-greenfield/project/tsconfig.json evals/fixtures/chained/acceptance/test_acceptance_chained.py evals/fixtures/chained/plan.md evals/fixtures/chained/project/ledger/__init__.py evals/fixtures/chained/project/ledger/model.py evals/fixtures/chained/project/tests/test_model.py evals/fixtures/chained/reference/ledger/balance.py evals/fixtures/chained/reference/ledger/cli.py evals/fixtures/chained/reference/ledger/model.py evals/fixtures/chained/reference/ledger/parse.py evals/fixtures/chained/reference/ledger/report.py evals/fixtures/contend-big/acceptance/test_acceptance_contend_prod.py evals/fixtures/contend-big/plan.md evals/fixtures/contend-big/project/README.md evals/fixtures/contend-big/project/app/__init__.py evals/fixtures/contend-big/project/app/registry.py evals/fixtures/contend-big/project/app/report.py evals/fixtures/contend-big/project/app/router.py evals/fixtures/contend-big/project/app/storage.py evals/fixtures/contend-big/project/tests/test_registry.py evals/fixtures/contend-big/project/tests/test_report.py evals/fixtures/contend-big/project/tests/test_router.py evals/fixtures/contend-big/project/tests/test_storage.py evals/fixtures/contend-prod/acceptance/test_acceptance_contend_prod.py evals/fixtures/contend-prod/plan.md evals/fixtures/contend-prod/project/README.md evals/fixtures/contend-prod/project/app/__init__.py evals/fixtures/contend-prod/project/app/registry.py evals/fixtures/contend-prod/project/app/report.py evals/fixtures/contend-prod/project/app/router.py evals/fixtures/contend-prod/project/app/storage.py evals/fixtures/contend-prod/project/tests/test_registry.py evals/fixtures/contend-prod/project/tests/test_report.py evals/fixtures/contend-prod/project/tests/test_router.py evals/fixtures/contend-prod/project/tests/test_storage.py evals/fixtures/contend-wide/acceptance/test_acceptance_contend_wide.py evals/fixtures/contend-wide/plan.md evals/fixtures/contend-wide/project/clitool/__init__.py evals/fixtures/contend-wide/project/clitool/cli.py evals/fixtures/contend-wide/project/tests/test_smoke.py evals/fixtures/contend-wide/reference/clitool/cli.py evals/fixtures/contend/acceptance/test_acceptance_contend.py evals/fixtures/contend/plan.md evals/fixtures/contend/project/clitool/__init__.py evals/fixtures/contend/project/clitool/cli.py evals/fixtures/contend/project/tests/test_smoke.py evals/fixtures/contend/reference/clitool/cli.py evals/fixtures/contend/reference/clitool/textutil.py evals/fixtures/degrade/acceptance/test_acceptance_degrade.py evals/fixtures/degrade/plan.md evals/fixtures/degrade/project/confkit/__init__.py evals/fixtures/degrade/project/confkit/config.py evals/fixtures/degrade/project/tests/test_config.py evals/fixtures/degrade/reference/confkit/config.py evals/fixtures/flawed-routing/acceptance/test_acceptance_routing.py evals/fixtures/flawed-routing/plan.md evals/fixtures/flawed-routing/project/apistub/__init__.py evals/fixtures/flawed-routing/project/tests/test_smoke.py evals/fixtures/flawed-routing/version.txt evals/fixtures/flawed/acceptance/test_acceptance_mixed.py evals/fixtures/flawed/grammar/annotated-files.md evals/fixtures/flawed/grammar/double-catch-all.md evals/fixtures/flawed/grammar/glob.md evals/fixtures/flawed/grammar/unknown-label.md evals/fixtures/flawed/plan.md evals/fixtures/flawed/project/apistub/__init__.py evals/fixtures/flawed/project/tests/test_smoke.py evals/fixtures/flawed/reference/apistub/app.py evals/fixtures/flawed/reference/apistub/handlers.py evals/fixtures/flawed/reference/apistub/schema.py evals/fixtures/flawed/reference/apistub/serialize.py evals/fixtures/flawed/reference/apistub/store.py evals/fixtures/flawed/reference/apistub/validate.py evals/fixtures/flawed/version.txt evals/fixtures/jsdeps/project/.gitignore evals/fixtures/jsdeps/project/deps/fixture-dep/index.js evals/fixtures/jsdeps/project/deps/fixture-dep/package.json evals/fixtures/jsdeps/project/package.json evals/fixtures/jsdeps/project/test/dep.test.js evals/fixtures/mixed/acceptance/test_acceptance_mixed.py evals/fixtures/mixed/plan.md evals/fixtures/mixed/project/apistub/__init__.py evals/fixtures/mixed/project/tests/test_smoke.py evals/fixtures/mixed/reference/apistub/app.py evals/fixtures/mixed/reference/apistub/handlers.py evals/fixtures/mixed/reference/apistub/schema.py evals/fixtures/mixed/reference/apistub/serialize.py evals/fixtures/mixed/reference/apistub/store.py evals/fixtures/mixed/reference/apistub/validate.py evals/fixtures/mixed/version.txt evals/fixtures/webapp/plan.md evals/fixtures/webapp/project/README.md evals/fixtures/webapp/project/package.json evals/fixtures/wide/acceptance/test_acceptance_wide.py evals/fixtures/wide/plan.md evals/fixtures/wide/project/tests/test_slugify.py evals/fixtures/wide/project/textkit/__init__.py evals/fixtures/wide/project/textkit/slugify.py evals/fixtures/wide/reference/textkit/ngrams.py evals/fixtures/wide/reference/textkit/redact.py evals/fixtures/wide/reference/textkit/reverse_words.py evals/fixtures/wide/reference/textkit/titlecase.py evals/fixtures/wide/reference/textkit/truncate.py evals/fixtures/wide/reference/textkit/word_count.py tests/test_arm_weave.py tests/test_bun_fixture.py tests/test_classify.py tests/test_compile_overlap.py tests/test_compile_plan.py tests/test_compile_plan_base_tree.py tests/test_compile_plan_check_constraints.py tests/test_compile_plan_check_output.py tests/test_compile_plan_claims.py tests/test_compile_plan_claims_edges.py tests/test_compile_plan_guard.py tests/test_compile_plan_proof_runs.py tests/test_compile_plan_proof_tests.py tests/test_compile_plan_task_test_cmd.py tests/test_corpus_extract.py tests/test_corpuslib.py tests/test_flawed_grammar.py tests/test_gate_verdicts.py tests/test_judge.py tests/test_pin_base_facts.py tests/test_replay_corpus.py tests/test_webapp_fixture.py; do test ! -e "$f" || { echo "present: $f"; exit 1; }; done
- Run: python3 skills/ultrapowers/scripts/compile_plan.py evals/fixtures/claims/plan.md --check 2>&1 | grep -q 'PLAN OK'
- Run: python3 skills/ultrapowers/scripts/compile_plan.py evals/fixtures/claims/plan.md | python3 -c "import json,sys; d=json.load(sys.stdin); ts=d['tasks']; assert isinstance(ts,list) and len(ts)==3 and all(t.get('disposition')=='implementation' and t.get('heuristic') in (None,False) for t in ts)"
- Run: test "$(grep -c -e 'corpuslib' -e 'fixture_corpus' tests/conftest.py)" = 0 && grep -q 'pytest_collection_modifyitems' tests/conftest.py
- Run: python3 -m pytest -q -p no:cacheprovider tests/test_ultra_run.py tests/test_ultra_run_bootstrap_cmd.py tests/test_review_peer.py
- Run: test "$(grep -c ultradocket tests/test_review_peer.py)" = 0
- Legs: (a) a header-less plan is refused with a `grammar:` line that names `Grammar`, and no `PLAN OK` [M1]; (b) `--overlap fold` is a usage error, exit 2, and the four files carry none of the four strings [M2]; (c) the five legacy definitions are absent, the two kept markers are still defined, and the claims fixture's `tasks` list holds exactly three rows at `disposition` `implementation` with `heuristic` absent or false [M3]; (d) the absence loop exits 0 over every deleted test and fixture file [M4]; (e) the claims fixture compiles `PLAN OK`, and conftest keeps its collection hook while losing the corpus fixture [M5]; (f) the three rewritten pytest files pass under pytest and the review-peer file no longer names ultradocket [M6].

**Stale-if:**
- path-absent: `evals/fixtures/claims/plan.gate-verdicts.json`

### Task 3: ultralearn and ultradocket are gone; the catch counter lives with the ultrapowers scripts

**Type:** implementation

**Files:**
- Create: `skills/ultrapowers/scripts/catch_counter.py`
- Create: `skills/ultrapowers/scripts/catch_report.py`
- Create: `skills/ultrapowers/scripts/_outcome.py`
- Create: `skills/ultrapowers/scripts/merge_ledger.py`
- Modify: `skills/ultrapowers/references/report-format.md`
- Modify: `fleet/CONTRACT.md`
- Modify: `skills/ultrawrite/scripts/extract_gate_input.py`
- Delete: `skills/ultrapowers/scripts/audit_run.py`
- Delete: `skills/ultradocket/SKILL.md`
- Delete: `skills/ultradocket/scripts/compile_docket.py`
- Delete: `skills/ultradocket/scripts/docket_lib.py`
- Delete: `skills/ultradocket/scripts/merge_entry.py`
- Delete: `skills/ultralearn/SKILL.md`
- Delete: `skills/ultralearn/references/distilling-proposals.md`
- Delete: `skills/ultralearn/references/reading-lenses.md`
- Delete: `skills/ultralearn/scripts/_outcome.py`
- Delete: `skills/ultralearn/scripts/_readers.py`
- Delete: `skills/ultralearn/scripts/catch_counter.py`
- Delete: `skills/ultralearn/scripts/catch_report.py`
- Delete: `skills/ultralearn/scripts/census_many.py`
- Delete: `skills/ultralearn/scripts/fleet_events.py`
- Delete: `skills/ultralearn/scripts/fleet_slice.py`
- Delete: `skills/ultralearn/scripts/harvest_fleet_runs.py`
- Delete: `skills/ultralearn/scripts/merge_ledger.py`
- Delete: `skills/ultralearn/scripts/residual_counter.py`
- Delete: `skills/ultralearn/scripts/residual_report.py`
- Delete: `tests/test_audit_refactor.py`
- Delete: `tests/test_catch_report_window.py`
- Delete: `tests/test_census_many.py`
- Delete: `tests/test_fleet_events.py`
- Delete: `tests/test_fleet_slice.py`
- Delete: `tests/test_harvest_evidence.py`
- Delete: `tests/test_harvest_fleet_runs.py`
- Delete: `tests/test_harvest_fleet_runs_cache_key.py`
- Delete: `tests/test_harvest_fleet_runs_confine_denials.py`
- Delete: `tests/test_harvest_fleet_runs_publish_fold.py`
- Delete: `tests/test_ledger_engine_stamp.py`
- Delete: `tests/test_merge_ledger.py`
- Delete: `tests/test_readers.py`
- Delete: `tests/test_spec_review_brief_selfcheck.py`
- Delete: `tests/test_ultralearn_catch_report.py`
- Delete: `tests/test_ultralearn_catches.py`
- Delete: `tests/test_ultralearn_docs.py`
- Delete: `tests/test_ultralearn_outcome.py`
- Delete: `tests/test_ultralearn_residuals.py`
- Delete: `tests/test_ultralearn_swallows.py`
- Delete: `tests/test_validate_skill.py`

**Claim:** After this run the two skills I never use are gone, and the one script that ever turned a reading into a deletion still runs from the ultrapowers scripts. (derived)
Machine: M1. No file exists under `skills/ultralearn/` or `skills/ultradocket/`: every path this task's Files block names there with `Delete:` is absent, and `git ls-files skills/ultralearn skills/ultradocket` prints nothing. M2. `skills/ultrapowers/scripts/catch_counter.py` and `skills/ultrapowers/scripts/catch_report.py` are byte-identical to `skills/ultralearn/scripts/catch_counter.py` and `catch_report.py` as they stand at BASE — moved, not edited — the two modules they import, `_outcome.py` and `merge_ledger.py`, sit beside them byte-identical to their BASE copies, and `python3 skills/ultrapowers/scripts/catch_counter.py --help` and `catch_report.py --help` exit 0. M3. `skills/ultrapowers/scripts/audit_run.py` is absent and the word `audit_run` does not occur in `skills/ultrapowers/references/report-format.md`. M4. The words `ultralearn` and `ultradocket` do not occur in `fleet/CONTRACT.md` or `skills/ultrawrite/scripts/extract_gate_input.py`, and every test file this task deletes is absent.

**Authorized-by:** session decision 5 of 2026-09-13 (delete both, keep the counter); the Experience Compiler map #414's own close condition.

**Interfaces:**
- Consumes: none
- Produces: `skills/ultrapowers/scripts/catch_counter.py` — the counter CLI, `catch_counter.py [--ledger FILE] PATH [PATH ...]`, unchanged
- Produces: `skills/ultrapowers/scripts/catch_report.py` — the report CLI, `catch_report.py --ledger PATH [--tree DIR] [--n N]`, unchanged

**Context:** The move is `git mv` semantics for four files: `catch_counter.py` does `sys.path.insert(0, <its own dir>)` then `from _outcome import …` (line ~41), and `catch_report.py` imports `merge_ledger._read_jsonl` and `_outcome.swallow` (~32–33); `merge_ledger.py` imports only `_outcome` (line 13) — that is the whole chain, four files, byte for byte, no more. `_readers.py`, `census_many.py`, `fleet_slice.py`, `harvest_fleet_runs.py`, `residual_counter.py` and `residual_report.py` are not on that chain and are deleted. The moved scripts run from the new directory unchanged, and the frozen shas above are their BASE blob shas (`git rev-parse a8a8b9eb:skills/ultralearn/scripts/catch_counter.py`). The 18 skill files and the 22 tests in this task's list are the whole of `git ls-files skills/ultralearn skills/ultradocket` at BASE plus every test named for the skills' scripts (`tests/test_validate_skill.py` validates the ultralearn skill directory and goes with it; `skills/ultrapowers/scripts/validate_skill.py` itself stays, its one comment naming ultradocket is prose and may stay). `fleet/CONTRACT.md:72` says the reduced transcript is "the reduced record ultralearn's slicer applies" — reword to say the reduced record, without the reader's name; `skills/ultrawrite/scripts/extract_gate_input.py:35` is a comment naming `ultralearn/scripts/_readers.py` as an idiom source — drop the reference. `skills/ultrapowers/references/report-format.md:148` is item 11, the optional effort audit from `audit_run.py` — delete that item. The comments in `fleet/run-waves.mjs`, `fleet/run-worker.mjs` and `fleet/sandbox-boot.sh` that mention ultralearn are inside files the Global Constraints freeze; leave them. `CLAUDE.md` is Task 4's.

**Proof:**
- Run: for f in skills/ultradocket/SKILL.md skills/ultradocket/scripts/compile_docket.py skills/ultradocket/scripts/docket_lib.py skills/ultradocket/scripts/merge_entry.py skills/ultralearn/SKILL.md skills/ultralearn/references/distilling-proposals.md skills/ultralearn/references/reading-lenses.md skills/ultralearn/scripts/_outcome.py skills/ultralearn/scripts/_readers.py skills/ultralearn/scripts/catch_counter.py skills/ultralearn/scripts/catch_report.py skills/ultralearn/scripts/census_many.py skills/ultralearn/scripts/fleet_events.py skills/ultralearn/scripts/fleet_slice.py skills/ultralearn/scripts/harvest_fleet_runs.py skills/ultralearn/scripts/merge_ledger.py skills/ultralearn/scripts/residual_counter.py skills/ultralearn/scripts/residual_report.py skills/ultrapowers/scripts/audit_run.py tests/test_audit_refactor.py tests/test_catch_report_window.py tests/test_census_many.py tests/test_fleet_events.py tests/test_fleet_slice.py tests/test_harvest_evidence.py tests/test_harvest_fleet_runs.py tests/test_harvest_fleet_runs_cache_key.py tests/test_harvest_fleet_runs_confine_denials.py tests/test_harvest_fleet_runs_publish_fold.py tests/test_ledger_engine_stamp.py tests/test_merge_ledger.py tests/test_readers.py tests/test_spec_review_brief_selfcheck.py tests/test_ultralearn_catch_report.py tests/test_ultralearn_catches.py tests/test_ultralearn_docs.py tests/test_ultralearn_outcome.py tests/test_ultralearn_residuals.py tests/test_ultralearn_swallows.py tests/test_validate_skill.py; do test ! -e "$f" || { echo "present: $f"; exit 1; }; done
- Run: test -z "$(git ls-files skills/ultralearn skills/ultradocket)"
- Run: for f in catch_counter.py catch_report.py _outcome.py merge_ledger.py; do git show $ULTRA_BASE:skills/ultralearn/scripts/$f | cmp -s - skills/ultrapowers/scripts/$f || { echo "differs: $f"; exit 1; }; done
- Run: python3 skills/ultrapowers/scripts/catch_counter.py --help > /dev/null && python3 skills/ultrapowers/scripts/catch_report.py --help > /dev/null
- Run: test "$(grep -c audit_run skills/ultrapowers/references/report-format.md)" = 0
- Run: test "$(grep -c -e ultralearn -e ultradocket fleet/CONTRACT.md skills/ultrawrite/scripts/extract_gate_input.py | awk -F: '{s+=$2} END {print s}')" = 0
- Legs: (a) the absence loop and the empty `git ls-files` establish that nothing survives under the two skill directories [M1]; (b) each of the four moved files is byte-identical to its BASE copy under the old path, read through `$ULTRA_BASE`, and both `--help` calls exit 0 [M2]; (c) `audit_run.py` is absent by the loop and the word count in report-format is zero [M3]; (d) the two remaining documents carry neither skill's name, and the test files are absent by the same loop [M4].

**Stale-if:**
- path-absent: `skills/ultralearn/scripts/catch_counter.py`
- path-absent: `skills/ultralearn/scripts/catch_report.py`

### Task 4: CLAUDE.md describes the plugin that exists today

**Type:** implementation

**Files:**
- Modify: `CLAUDE.md`

**Claim:** After this run CLAUDE.md reads like the plugin that exists today: what it is, how to run and test it, where things live, and the rules that still bind, with the retired maps and the deleted machinery gone. (derived)
Machine: M1. `CLAUDE.md` contains none of the words `ultralearn`, `ultradocket`, `audit_run`, `test_docs_agree_with_code`, `test_recommendation_rubric`, `Retired map`, `legacy grammar`, `legacy-grammar`, `referee`, `Wayfinding`, `Trim review`, `superpowers:brainstorming`, `compiler tests`. M2. `CLAUDE.md` names each of: `fleet/run-engine.mjs`, `fleet/launch.mjs`, `skills/ultrapowers/scripts/compile_plan.py`, `skills/ultrapowers/scripts/catch_counter.py`, `python3 -m pytest`, `fleet/CONTRACT.md`, `skills/ultrawrite/`, `ultra/evidence/run-`, and the version string `.claude-plugin/plugin.json` carries. M3. `CLAUDE.md` keeps these headings in this order: `## Purpose & vision`, `## Commands`, `## Layout`, `## Doctrine`, `## Conventions & gotchas`, and carries no other `## ` heading.

**Authorized-by:** session decision 9 of 2026-09-13 (CLAUDE.md rewritten to the post-cut shape); the operator's "prefer deleting over simplifying".

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The file today is 300 lines, most of it the history of every map and release since August. Rewrite it for an agent developing the plugin at 0.3.27 after this run's siblings land: Purpose & vision (the first two paragraphs stay, minus the superpowers-history sentences); Commands (pytest, validate_skill, compile_plan, doctor, launch, and the catch counter pair at their new path `skills/ultrapowers/scripts/`); Layout (the tree as it is after Tasks 1–3: `skills/ultrapowers/`, `skills/ultrawrite/`, `hooks/`, `.claude-plugin/`, `docs/superpowers/` untracked, `evals/` with `evals/fixtures/claims/` as the one sample plan left (say it is the compiler's probe fixture, not that compiler tests read it — Task 2 deletes those tests), `fleet/` in its target-owns-the-record shape with the record on the two tags, the sims that survive under `fleet/tests/`, and the bridge); Doctrine (keep, verbatim where possible: no small measures while broken; don't vendor the vendor; ask Shelley before any VM-side hack; run in parallel and fold at publish; handoffs are opt-in; author plans concurrently from the issues; no local scheduled process; every choice is an AskUserQuestion; one merge, one writer; test doctrine — the implementer never does TDD, the suite is a reported sensor, deletion is per file on the catch counter); Conventions & gotchas (versioning, naming today's version as `.claude-plugin/plugin.json` carries it — `0.3.27` at BASE; judgment prompts are data files in `fleet/roles/`; sims ride pytest through the bridge; never force-rotate the token while a run is live; kata seams; no direct Anthropic API calls; the installed plugin lags the repo; TinyApp is the name; superpowers is an optional companion). Every open and retired wayfinder map, the ticket ledgers, the amendment history, the 2026-09-10 CI decisions and the "How features are built here" section go; the "test doctrine" sentence moves under Doctrine. The plan-routing rule stays where it is, in `hooks/session_start.sh`, not here. Report `wc -w` before and after in the task summary; nothing gates the length, and a shorter file that keeps M2's literals is the goal. Do not name a script that does not exist after Tasks 1–3 (no `audit_run.py`, no `test_docs_agree_with_code.py`, no ultralearn path).

**Proof:**
- Run: test "$(grep -c -e ultralearn -e ultradocket -e audit_run -e test_docs_agree_with_code -e test_recommendation_rubric -e 'Retired map' -e 'legacy grammar' -e 'legacy-grammar' -e referee -e Wayfinding -e 'Trim review' -e 'superpowers:brainstorming' -e 'compiler tests' CLAUDE.md)" = 0
- Run: for w in fleet/run-engine.mjs fleet/launch.mjs skills/ultrapowers/scripts/compile_plan.py skills/ultrapowers/scripts/catch_counter.py 'python3 -m pytest' fleet/CONTRACT.md skills/ultrawrite/ ultra/evidence/run- "$(python3 -c 'import json; print(json.load(open(".claude-plugin/plugin.json"))["version"])')"; do grep -qF "$w" CLAUDE.md || { echo "missing: $w"; exit 1; }; done
- Run: test "$(grep '^## ' CLAUDE.md | tr '\n' '|')" = '## Purpose & vision|## Commands|## Layout|## Doctrine|## Conventions & gotchas|'
- Legs: (a) the retired-word grep counts zero occurrences across all thirteen words [M1]; (b) the presence loop finds every one of the eight named literals and the version string read from plugin.json at run time [M2]; (c) the heading list is exactly the five, in order, and nothing else [M3].

**Stale-if:**
- path-absent: `CLAUDE.md`

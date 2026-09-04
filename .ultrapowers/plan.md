# Test audit, layer 1: the `tests/` layer sheds deleted mechanisms, sentence pins and nested re-runs

**Grammar:** claims-v1

**Claim:** After this run the pytest suite carries no test of a deleted mechanism, no verbatim
sentence pin on a document and no nested re-run of another test file; the corpus is built once
per session; the fleet sims start first, slowest first; and CI prints the collected count
beside the prose sizes. (elicited)

**Goal:** #612, the audit adopted 2026-09-04 (both comments on the issue are the plan), layer 1
of three. Baseline at BASE (0.3.11): 1,472 tests collected, ~210 s wall under `-n auto`. This
layer deletes tests whose production code no longer exists (the `--suite-gate` harness leg,
inert since 0.3.0; the docket `sealed` branch, `BLOCKED` at the gate since One Driver row 7;
an eval fixture's own smoke test; a prose pin on the compiler reference), fixes a refusal
message that tells the user to launch a deleted script, deletes the two nested re-runs of
whole test files (31 s + 6.6 s of duplicate CPU), deletes the verbatim-sentence pins on
shipped documents (a string assertion proves presence, never behaviour — the referent pins
and register sweeps stay), and makes the suite wall-bound less by its stragglers: the fleet
bridge collects first, slowest first, and the frontier corpus is built once per session. Every
deletion carries a measurement: the collected count after each task is pinned below.

**Tech Stack:** pytest 8 + pytest-xdist (`tests/`, `pytest.ini` with `testpaths = tests`), Node
sims under `fleet/tests/` bridged by `tests/test_fleet_suite.py`, GitHub Actions
(`.github/workflows/ci.yml`).

**Spec:** #612 (the audit table and the adopted sequencing comment).

**Parallelization rationale:** One wave, width 4. The four tasks touch disjoint files: Task 1 the
deleted-mechanism tests and their two code sites, Task 2 the two deadline re-run legs, Task 3
the five sentence-pin files, Task 4 the ordering and scoping files plus CI. None consumes
another's behaviour; each task's count pin is measured in its own clone, so the pins are
per-task, not cumulative.

## Global Constraints

- The frozen periphery is untouched: `skills/ultrapowers/scripts/gate_check.py`, `ultra_gate.py`
  and `run_acceptance.sh` are byte-identical to BASE.
- No shipped document changes: every file under `skills/*/SKILL.md`, `skills/*/references/`,
  `fleet/roles/`, `fleet/CONTRACT.md`, `fleet/RUNBOOK.md`, `README.md` and `hooks/` is
  byte-identical to BASE — this layer edits tests, two code sites named below, and CI.
- The referent pins and register sweeps the audit keeps are untouched:
  `tests/test_docs_agree_with_code.py`, `tests/test_report_runbook.py`,
  `tests/test_ultralearn_docs.py`, `tests/test_validate_skill.py`,
  `tests/test_recommendation_rubric.py` are byte-identical to BASE.
- `python3 -m pytest tests/ -n auto` passes.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: Tests of deleted mechanisms go, with the two code sites they name

**Type:** implementation

**Files:**
- Modify: `tests/test_run_acceptance.py`
- Modify: `tests/test_compile_docket.py`
- Modify: `skills/ultradocket/scripts/compile_docket.py`
- Modify: `tests/drainprobe/conftest.py`
- Modify: `tests/drainprobe/test_drainprobe_smoke.py`
- Modify: `tests/test_marker_compiler.py`
- Modify: `tests/test_ultra_run.py`
- Modify: `skills/ultrapowers/scripts/ultra_run.py`

**Claim:** The pytest suite carries no test of a deleted mechanism. (derived)
Machine: M1. `tests/test_run_acceptance.py` no longer defines the five `--suite-gate` harness
sims — `test_suite_gate_runs_harness_sims_green`, `test_suite_gate_red_sim_parks`,
`test_suite_gate_sim_false_green_is_error`, `test_suite_gate_no_harness_diff_skips_sims`,
`test_suite_gate_harness_diff_no_sim_is_error` — nor their private helpers
`make_js_suite_repo`, `_branch_editing`, `GREEN_SIM`, `RED_SIM`, `SILENT_SIM`, `needs_node`,
`NODE`; its other 21 tests are unchanged and pass. M2. `tests/test_compile_docket.py` no
longer defines `test_sealed_entry_without_seal_fails_loud`,
`test_mixed_sealed_and_suite_queue_compiles`,
`test_sealed_cluster_member_missing_seal_raises_naming_member`, and
`skills/ultradocket/scripts/compile_docket.py` no longer carries the `no_seal` check nor the
cluster-Seal disagreement check (the string `sealed` occurs nowhere in it); its other 19 tests
pass. M3. The directory `tests/drainprobe/` does not exist. M4. `tests/test_marker_compiler.py`
does not exist. M5. `skills/ultrapowers/scripts/ultra_run.py`'s fleet-run refusal reads
`ULTRAPOWERS_FLEET_RUN is unset — \`/ultrapowers\` runs only inside a fleet sandbox — the
launcher sets it on the VM` and names neither `drive-one` nor `orchestrator`; the test
`test_unset_fleet_run_refuses_before_any_other_stage` asserts the new sentence. M6. `python3
-m pytest tests/ --collect-only -q` reports exactly `1461 tests collected` in this task's
tree (BASE's 1472 less the 11 deleted).

**Authorized-by:** #612 audit table, point 1 rows 3–7 (each with its missing referent: the
harness trigger path deleted at 0.3.0, One Driver Phase 0 row 7, the eval's own fixture, the
"no test pins a sentence" rule, the deleted `drive-one`).

**Interfaces:**
- Consumes: none
- Produces: nothing

**Context:** The five harness sims are the contiguous block at lines 119–196 of
`tests/test_run_acceptance.py` (banner `# ── Harness JS-behavioral sims (issue #79)`), all
decorated `@needs_node`; `needs_node` (line 18) and `NODE` (line 17) have no other use site;
`sh`, `make_repo`, `make_suite_repo`, `suite_gate`, `_suite_gate` are shared and stay. The
docket Seal branch is `compile_docket.py` lines 71–73 (`no_seal = [e.issue for e in entries
if facts[e.plan][1] == "sealed" and not e.seal]` + the raise) and lines 92–95 (`if
facts[plan][1] == "sealed" and len({m.seal for m in members}) > 1:` + the raise), with their
docstring sentences at 54–56 and 58–60; `test_suite_entry_without_seal_compiles` (176–182)
stays. `tests/drainprobe/` is a 7-line `conftest.py` that puts `evals/drainprobe` on
`sys.path` plus a 13-line smoke file with two tests over `evals/drainprobe/probecli` — the
#454 measurement payload, "not plugin machinery" by its own docstring; `evals/` stays. The
refusal is `ultra_run.py` lines 456–462 (`failure="ULTRAPOWERS_FLEET_RUN is unset — …
launch \`drive-one\` on the orchestrator"`) and the test's two assertions are
`tests/test_ultra_run.py` lines 739–740 (`"\`/ultrapowers\` runs only inside a fleet
sandbox" in detail` and `"launch \`drive-one\` on the orchestrator" in detail`) inside a
test parametrized over `[None, "", "   "]`. `tests/test_deadline_slack.py` leg (d) reads
`tests/test_ultra_run.py` as text and pins its SIGTERM test body — touch only lines 739–740.
Counting: `python3 -m pytest tests/ --collect-only -q | tail -n 1` prints `<N> tests
collected in …`; BASE prints 1472; the deletions here are 5 + 3 + 2 + 1 = 11.

**Proof:**
- Run: `test "$(python3 -m pytest tests/ --collect-only -q 2>/dev/null | tail -n 1 | cut -d' ' -f1)" = 1461`
- Run: `! grep -qE 'test_suite_gate_(runs_harness_sims_green|red_sim_parks|sim_false_green_is_error|no_harness_diff_skips_sims|harness_diff_no_sim_is_error)|make_js_suite_repo|_branch_editing|GREEN_SIM|RED_SIM|SILENT_SIM|needs_node|NODE = shutil' tests/test_run_acceptance.py && test "$(python3 -m pytest --collect-only -q tests/test_run_acceptance.py 2>/dev/null | grep -c '::')" = 21 && python3 -m pytest -q tests/test_run_acceptance.py`
- Run: `! grep -q 'sealed' skills/ultradocket/scripts/compile_docket.py && ! grep -qE 'test_sealed_entry_without_seal_fails_loud|test_mixed_sealed_and_suite_queue_compiles|test_sealed_cluster_member_missing_seal_raises_naming_member' tests/test_compile_docket.py && grep -q 'test_suite_entry_without_seal_compiles' tests/test_compile_docket.py && test "$(python3 -m pytest --collect-only -q tests/test_compile_docket.py 2>/dev/null | grep -c '::')" = 19 && python3 -m pytest -q tests/test_compile_docket.py`
- Run: `test ! -e tests/drainprobe && test ! -e tests/test_marker_compiler.py && test -e evals/drainprobe/probecli/cli.py`
- Run: `! grep -q 'drive-one' skills/ultrapowers/scripts/ultra_run.py && ! grep -q 'orchestrator' skills/ultrapowers/scripts/ultra_run.py && grep -q 'ULTRAPOWERS_FLEET_RUN is unset' skills/ultrapowers/scripts/ultra_run.py && grep -q 'runs only inside a fleet sandbox' skills/ultrapowers/scripts/ultra_run.py && grep -q 'the launcher sets it on the VM' skills/ultrapowers/scripts/ultra_run.py && ! grep -q 'drive-one' tests/test_ultra_run.py && grep -q 'def test_unset_fleet_run_refuses_before_any_other_stage' tests/test_ultra_run.py && grep -q 'the launcher sets it on the VM' tests/test_ultra_run.py && python3 -m pytest -q tests/test_ultra_run.py tests/test_deadline_slack.py`
- Legs: (a) the second Run: exits non-zero if any of the five test names or any of the seven
  private helpers (`make_js_suite_repo`, `_branch_editing`, `GREEN_SIM`, `RED_SIM`,
  `SILENT_SIM`, `needs_node`, `NODE`) survives, if the file collects other than exactly 21,
  or if the remaining acceptance tests fail [M1]; (b) the third exits
  non-zero if `sealed` survives in the docket compiler, if any of the three Seal tests
  survives, if the kept sibling test is gone, if the file collects other than exactly 19, or
  if it fails [M2]; (c) the fourth exits
  non-zero if either path still exists, or if the eval payload was deleted along with its
  test [M3, M4]; (d) the fifth exits non-zero if `drive-one` or `orchestrator` survives in
  the script, if any of the three fragments of the new sentence (`ULTRAPOWERS_FLEET_RUN is
  unset`, `runs only inside a fleet sandbox`, `the launcher sets it on the VM`) is absent from
  it, if the test still names `drive-one`, if the named test or its assertion of the new tail
  is gone, or if the ultra_run and deadline-slack files (the latter's `test_d_` legs read the
  former) fail [M5]; (e)
  the first Run: exits non-zero unless the collected count is exactly 1461 — one more or
  fewer deletion than the eleven named fails it [M6].

**Stale-if:**
- path-absent: `tests/test_run_acceptance.py`
- path-absent: `skills/ultradocket/scripts/compile_docket.py`
- issue-closed: #612

### Task 2: The two nested re-runs of whole test files go

**Type:** implementation

**Files:**
- Modify: `tests/test_deadline_slack.py`
- Modify: `fleet/tests/test_deadline_slack.mjs`

**Claim:** The two deadline-slack exams no longer re-run another test file, and the only
nested pytest invocations left under `tests/` are the three node-id re-runners the audit did
not mark. (derived)
Machine: M1. `tests/test_deadline_slack.py` no longer defines
`test_f_test_ultra_run_passes_with_slack_set_and_unset` nor the `_env` helper only it used,
and no longer spawns `pytest` as a subprocess (the strings `"-m", "pytest"` and
`sys.executable` absent); it still defines three `test_b_` and three `test_d_` functions,
collects exactly 10 and passes; and the literals `pytest.main(` and `"-m", "pytest"` occur
under `tests/` only in the three files that re-run a single test by its node id
(`tests/test_review_peer.py`, `tests/test_check_renders_pin_is_tree_independent.py`,
`tests/test_ultralearn_swallows.py`), none of which this task edits. M2. `fleet/tests/test_deadline_slack.mjs`
no longer carries leg (e) — no `spawnSync(process.execPath`, no `WORKER_SPEC`, no `runWorkerSpec`
— while it still carries leg (a)'s `deadlineBudget(300)` assertion, the seam-calls leg's header
`the three deadlines in test_run_worker.mjs are seam calls` and its `< 5000` assertion, and
the file still prints `ALL TESTS PASSED`. M3.
`python3 -m pytest tests/ --collect-only -q` reports exactly `1470 tests collected` in this
task's tree.

**Authorized-by:** #612 audit, "Merge / de-duplicate" rows 1–2 (16.5 s + 15.0 s, the 5th and 7th
slowest tests; 6.6 s; the spec already runs once in the same session and "slack unset" IS that
run).

**Interfaces:**
- Consumes: none
- Produces: nothing

**Context:** Three other files under `tests/` spawn `sys.executable -m pytest` on a single
test node id (`tests/test_review_peer.py:125`, `tests/test_check_renders_pin_is_tree_independent.py:111`,
`tests/test_ultralearn_swallows.py:224`); the audit did not mark them and they are excluded
by name from the suite-wide sweep — a re-run of one test is not a re-run of a file. In the
pytest file: leg (f) is the banner at line 138 and the parametrized test at
141–151 (`@pytest.mark.parametrize("value", [None, "1"])`, 2 collected) running
`[sys.executable, "-m", "pytest", "-q", "tests/test_ultra_run.py"]` under `_env(value)`;
`_env` (30–41) has no other caller; the `slack_env` fixture (44–52) is leg (b)'s and stays;
the module docstring names legs (b), (d), (f) — reword it to (b), (d). In the Node file: leg
(e) is lines 92–108 (`runWorkerSpec` + the `for (const value of [null, '1'])` loop);
`WORKER_SPEC` (line 66) is used only there; the header comment (1–11) names legs (a), (c),
(e) — reword to (a), (c). Both files' other legs pin `deadline-slack.mjs` /
`tests/deadline_slack.py` and the run-worker / ultra_run source text and stay verbatim. BASE
collects 1472; this task deletes 2.

**Proof:**
- Run: `test "$(python3 -m pytest tests/ --collect-only -q 2>/dev/null | tail -n 1 | cut -d' ' -f1)" = 1470`
- Run: `! grep -q 'test_f_' tests/test_deadline_slack.py && ! grep -q 'sys.executable' tests/test_deadline_slack.py && ! grep -q '"-m", "pytest"' tests/test_deadline_slack.py && ! grep -q 'def _env' tests/test_deadline_slack.py && test "$(grep -c 'def test_b_' tests/test_deadline_slack.py)" = 3 && test "$(grep -c 'def test_d_' tests/test_deadline_slack.py)" = 3 && test "$(python3 -m pytest --collect-only -q tests/test_deadline_slack.py 2>/dev/null | grep -c '::')" = 10 && ! grep -rnE 'pytest\.main\(|"-m", "pytest"' tests/ | grep -vE '^tests/(test_review_peer|test_check_renders_pin_is_tree_independent|test_ultralearn_swallows)\.py:' | grep -q . && python3 -m pytest -q tests/test_deadline_slack.py`
- Run: `! grep -q 'spawnSync(process.execPath' fleet/tests/test_deadline_slack.mjs && ! grep -q 'WORKER_SPEC' fleet/tests/test_deadline_slack.mjs && ! grep -q 'runWorkerSpec' fleet/tests/test_deadline_slack.mjs && grep -q 'deadlineBudget(300)' fleet/tests/test_deadline_slack.mjs && grep -q 'the three deadlines in test_run_worker.mjs are seam calls' fleet/tests/test_deadline_slack.mjs && grep -q '< 5000' fleet/tests/test_deadline_slack.mjs && node fleet/tests/test_deadline_slack.mjs | grep -q 'ALL TESTS PASSED'`
- Legs: (a) the second Run: exits non-zero if the `test_f_` function, `sys.executable`, the
  `"-m", "pytest"` literal or `_env` survives in the file, if it defines other than three
  `test_b_` and three `test_d_` functions or collects other than 10, if any file under
  `tests/` other than the three named node-id re-runners contains `pytest.main(` or `"-m",
  "pytest"` (the negated pipeline exits non-zero when any such line survives — a fourth
  nested invocation anywhere fails it), or if the file fails [M1]; (b) the third exits non-zero if the
  Node re-exec or its two names survive, if the budget assertion `deadlineBudget(300)`, the seam-calls header or
  the `< 5000` assertion is gone, or if the sim fails to print `ALL TESTS PASSED` [M2]; (c) the first exits non-zero unless exactly 1470 tests
  collect [M3].

**Stale-if:**
- path-absent: `tests/deadline_slack.py`
- path-absent: `fleet/tests/deadline-slack.mjs`
- issue-closed: #612

### Task 3: The verbatim sentence pins on documents go; referent pins and register sweeps stay

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `tests/test_proof_modes_documented.py`
- Modify: `tests/test_marker_contract.py`
- Modify: `tests/test_ultrawrite_skill.py`
- Modify: `tests/test_session_hook.py`
- Modify: `tests/test_review_peer.py`

**Claim:** The five files the audit named no longer define a verbatim sentence pin on a
document; their referent pins and register sweeps stay. (derived)
Machine: M1. `tests/test_proof_modes_documented.py` keeps exactly two tests —
`test_leg_e_m5_validate_skill_prints_skill_ok` and
`test_leg_e_m5_no_shouted_whole_word_is_added_to_the_three_files` — and no `M1_`/`M2_`/`M3_`/`M4_`
constant, no `git show` of a BASE blob, no `_ensure_base_present`. M2.
`tests/test_marker_contract.py` no longer defines `test_contract_states_the_invariants`; its
twelve other tests are unchanged. M3. `tests/test_ultrawrite_skill.py` no longer defines
`test_opens_by_naming_its_audience`, `test_pins_the_header_marker_layout_verbatim`,
`test_branch_clause_present`, `test_branch_clauses_in_canonical_order`,
`test_rubric_token_present`, nor the constants `PINNED_HEADER_SENTENCE`, `BRANCH_CLAUSES`,
`RUBRIC_TOKENS`; the six-slot, tooling, frontmatter, refused-marker, no-reflex and MIT tests
are unchanged. M4. `tests/test_session_hook.py` keeps all five tests but its three prose
tests no longer assert `"authorizes execution"`, `"no approval pause"`, `"ANY implementation
plan"`, `"do not default to ultrapowers"`, `"parallel width"`, `"t≥4"` or `"risk override"`,
while every referent (`ultrapowers:ultrawrite`, `/ultrapowers <plan-path>`,
`subagent-driven-development`, `executing-plans`, the `<ultrapowers-routing>` tags, the
`hooks.json` wrapper) and every absence sweep (`ultraplan`, `superpowers:writing-plans`,
`(recommended for marked plans)`) in them survives. M5. `tests/test_review_peer.py` no
longer defines `test_plan_markers_documents_the_peer_marker`, and
`test_skill_md_documents_the_peer_marker` asserts `**Review:** peer` and not the phrase
`` `peer` or `lean` ``; its fourteen other tests are unchanged. M6. `python3 -m pytest tests/
--collect-only -q` reports exactly `1443 tests collected` in this task's tree (BASE's 1472
less 12 + 1 + 15 + 1).

**Authorized-by:** #612, "Fourth layer: prose tests" — sentence pins (≈50) delete, referent
pins (≈55) and register sweeps (≈15) keep; the rule: a string assertion establishes that a
sentence is present, never that it produces the behaviour.

**Interfaces:**
- Consumes: none
- Produces: nothing

**Context:** Per file, what is what. `test_proof_modes_documented.py` (14 tests): the twelve
`test_leg_[abcd]_*` tests compare whitespace-collapsed sentences or mutations
(`M1_RUN_BULLET`, `M1_PROSE_TASK`, `M2_SELF_REVIEW`, `M3_EXAMINER`, `M4_MARKERS`, their
`*_MUTATED` twins) or whole sections against `git show 0a3559a:…` — delete them and every
helper only they use (`BASE`, `BASE_FULL`, `_ensure_base_present`, `base_text`, `flat`,
`sections`, `_heading_lines`, `section_starting`, `proof_bullet`, `paragraphs`, `LEVEL_2`,
`ANY_HEADING`); keep `read`, `SHOUT_WORDS`, `BASE_SHOUT_COUNTS`, the three `*_PATH`s and the
two `test_leg_e_m5_*` tests. `test_marker_contract.py`: `test_contract_states_the_invariants`
(line 98) asserts four phrases (`worktree-pure`, `post-merge runbook`, `additive`,
`fence-aware`) — delete; the sweeps (`test_contract_no_longer_*`) and heading/pattern pins
stay. `test_ultrawrite_skill.py` (32 collected): the sentence bucket is 15 collected —
`test_opens_by_naming_its_audience`, `test_pins_the_header_marker_layout_verbatim`,
`test_branch_clause_present[…]` ×5, `test_branch_clauses_in_canonical_order`,
`test_rubric_token_present[…]` ×7 — the rubric and branch-clause agreement between the hook
and the skill is kept by `tests/test_recommendation_rubric.py` (byte-identical to BASE, a
Global Constraint), so nothing is lost. `test_session_hook.py`: the sentence assertions sit
inside `test_session_start_script_emits_the_routing_rule` (lines 43–44),
`test_ultrawrite_description_triggers_on_every_plan` (`"ANY implementation plan"`) and
`test_session_start_recommends_by_analysis_not_reflex` (four phrases) — remove those
assertions only, and rename the third to what it still checks (the `(recommended for marked
plans)` absence). `test_review_peer.py`: `test_plan_markers_documents_the_peer_marker` (line
177, `` "one of `peer` or `lean`" ``) — delete; in `test_skill_md_documents_the_peer_marker`
(171) keep the `**Review:** peer` assertion. Counting: `python3 -m pytest tests/
--collect-only -q | tail -n 1`; BASE 1472; deletions 12 + 1 + 15 + 1 = 29.

**Proof:**
- Run: `test "$(python3 -m pytest tests/ --collect-only -q 2>/dev/null | tail -n 1 | cut -d' ' -f1)" = 1443`
- Run: `test "$(python3 -m pytest --collect-only -q tests/test_proof_modes_documented.py 2>/dev/null | grep -c '::')" = 2 && grep -q 'def test_leg_e_m5_validate_skill_prints_skill_ok' tests/test_proof_modes_documented.py && grep -q 'def test_leg_e_m5_no_shouted_whole_word_is_added_to_the_three_files' tests/test_proof_modes_documented.py && ! grep -qE 'M[1-4]_|git show|_ensure_base_present' tests/test_proof_modes_documented.py && python3 -m pytest -q tests/test_proof_modes_documented.py`
- Run: `! grep -q 'test_contract_states_the_invariants' tests/test_marker_contract.py && test "$(python3 -m pytest --collect-only -q tests/test_marker_contract.py 2>/dev/null | grep -c '::')" = 12 && python3 -m pytest -q tests/test_marker_contract.py`
- Run: `! grep -qE 'test_opens_by_naming_its_audience|test_pins_the_header_marker_layout_verbatim|test_branch_clause_present|test_branch_clauses_in_canonical_order|test_rubric_token_present|PINNED_HEADER_SENTENCE|BRANCH_CLAUSES|RUBRIC_TOKENS' tests/test_ultrawrite_skill.py && test "$(python3 -m pytest --collect-only -q tests/test_ultrawrite_skill.py 2>/dev/null | grep -c '::')" = 17 && python3 -m pytest -q tests/test_ultrawrite_skill.py tests/test_recommendation_rubric.py`
- Run: `test "$(python3 -m pytest --collect-only -q tests/test_session_hook.py 2>/dev/null | grep -c '::')" = 5 && ! grep -qE 'authorizes execution|no approval pause|ANY implementation plan|do not default to ultrapowers|parallel width|t≥4|risk override' tests/test_session_hook.py && grep -q '"ultrapowers:ultrawrite" in' tests/test_session_hook.py && grep -q '"/ultrapowers <plan-path>" in' tests/test_session_hook.py && grep -q '"subagent-driven-development" in' tests/test_session_hook.py && grep -q '"executing-plans" in' tests/test_session_hook.py && grep -q 'startswith("<ultrapowers-routing>")' tests/test_session_hook.py && grep -q 'hooks.json' tests/test_session_hook.py && grep -q '"ultraplan" not in' tests/test_session_hook.py && test "$(grep -c '"superpowers:writing-plans" not in' tests/test_session_hook.py)" = 2 && grep -q '"(recommended for marked plans)" not in' tests/test_session_hook.py && python3 -m pytest -q tests/test_session_hook.py`
- Run: `! grep -q 'test_plan_markers_documents_the_peer_marker' tests/test_review_peer.py && ! grep -q 'or .lean.' tests/test_review_peer.py && grep -q 'Review:\*\* peer' tests/test_review_peer.py && test "$(python3 -m pytest --collect-only -q tests/test_review_peer.py 2>/dev/null | grep -c '::')" = 15 && python3 -m pytest -q tests/test_review_peer.py`
- Legs: (a) the second Run: exits non-zero unless exactly two tests collect from the
  proof-modes file and they are the two named (`test_leg_e_m5_validate_skill_prints_skill_ok`,
  `test_leg_e_m5_no_shouted_whole_word_is_added_to_the_three_files`, each grepped by its
  `def`), no `M1_`…`M4_` constant, `git show` or BASE helper survives, and the file passes
  [M1]; (b) the third exits non-zero if the invariants test survives or the file does
  not collect exactly twelve and pass [M2]; (c) the fourth exits non-zero if any of the five
  test names or three constants survives, if the file does not collect exactly seventeen, or
  if it or the untouched rubric file fails [M3]; (d) the fifth exits non-zero if the hook
  file collects other than five, if any of the seven phrases survives, if any of the six
  referent assertions (`ultrapowers:ultrawrite`, `/ultrapowers <plan-path>`,
  `subagent-driven-development`, `executing-plans`, the `<ultrapowers-routing>` prefix,
  `hooks.json`) is gone, if the `ultraplan` sweep, both `superpowers:writing-plans` sweeps or
  the reflex sweep is gone, or if it fails [M4]; (e) the
  sixth exits non-zero if the plan-markers test or the `` `peer` or `lean` `` phrase
  survives, if the marker-form assertion is gone, or if the file does not collect exactly
  fifteen and pass [M5]; (f) the first exits non-zero unless exactly 1443 tests collect
  [M6].

**Stale-if:**
- path-absent: `tests/test_recommendation_rubric.py`
- path-absent: `skills/ultrawrite/SKILL.md`
- issue-closed: #612

### Task 4: The bridge collects first and slowest first, the corpus is built once, CI prints the count

**Type:** implementation

**Files:**
- Create: `tests/conftest.py`
- Modify: `tests/test_fleet_suite.py`
- Modify: `tests/test_corpuslib.py`
- Modify: `tests/test_arm_weave.py`
- Modify: `tests/test_classify.py`
- Modify: `tests/test_replay_corpus.py`
- Modify: `.github/workflows/ci.yml`

**Claim:** The corpus is built once per session; the fleet sims start first, slowest first; and
CI prints the collected count beside the prose sizes. (derived)
Machine: M1. `tests/conftest.py` defines one fixture `fixture_corpus` decorated
`@pytest.fixture(scope="session")` (the decorator within the three lines above the `def`) that calls
`corpuslib.make_fixture_corpus` exactly once per session and returns `(repo, corpus)`, and
none of `tests/test_corpuslib.py`, `tests/test_arm_weave.py`, `tests/test_classify.py`,
`tests/test_replay_corpus.py` defines its own `fixture_corpus`; each derives what it needs
(`by_wave`, `entries`, the replay results) from the session pair in a module-scoped fixture of
its own, so `make_fixture_corpus(` is called in those four files only by
`test_fixture_corpus_shape` and `test_builder_is_deterministic` in `test_corpuslib.py`; all
four files pass under `-n auto` and under a single process. M2. `tests/conftest.py`'s
`pytest_collection_modifyitems` moves every item of `tests/test_fleet_suite.py` to the front
of the collection, and `tests/test_fleet_suite.py` parametrizes its sims with the names in the
tuple `SLOW_FIRST = ('test_run_engine_examiner.mjs', 'test_sandbox_boot.mjs',
'test_exam_edited_patches.mjs', 'test_run_engine_integrated_runs.mjs',
'test_run_engine_proof_runs.mjs', 'test_deadline_slack.mjs')` first (in that order, each only
if present on disk) and the remaining sims alphabetically by basename, so `python3 -m pytest
tests/ --collect-only -q` prints, as its first N lines where N is the number of
`fleet/tests/test_*.mjs` files, exactly the N `tests/test_fleet_suite.py::test_fleet_mjs[…]`
ids in that order and nothing else among them. M3.
`.github/workflows/ci.yml`'s `Report skill prose sizes` step is followed by a step that runs
`python -m pytest tests/ --collect-only -q | tail -n 1`, and its `Run tests` step passes
`--durations=10`, so the CI log carries the collected count, the suite wall and the ten
slowest items — the count step's command sits within eight lines after the prose-sizes
step's name; the four `validate_skill.py` lines are unchanged. M4. `python3 -m pytest
tests/ --collect-only -q` still reports exactly `1472 tests collected` in this task's tree.

**Authorized-by:** #612, "xdist (adopted)" items 2–3 and the closing sentence ("Add the suite
wall and the longest item to CI's report step beside the prose sizes"); the audit's point 5
(`test_replay_corpus.py` setup ×3 at 13 s each).

**Interfaces:**
- Consumes: none
- Produces: `fixture_corpus`

**Context:** There is no `tests/conftest.py` at BASE (only `tests/drainprobe/conftest.py`, which
a sibling task deletes; do not create or edit it here). The four corpus files each carry a
`@pytest.fixture(scope="module")` — `test_corpuslib.py:28` `fixture_corpus` → `(repo,
corpus, by_wave)`, `test_arm_weave.py:27` `fixture_corpus` → `(repo, corpus, entries)`,
`test_classify.py:27` `fixture_corpus`, `test_replay_corpus.py:39` `replayed` → `(repo,
corpus, results)` (build + `replay_corpus.replay`) — every one calls
`corpuslib.make_fixture_corpus(tmp_path_factory.mktemp(…))`, so the real kernel CLI builds
the corpus 4 times at module scope + 3 in `test_corpuslib.py`'s two per-test builders. Keep
each file's fixture NAME so its tests are untouched: make the module fixtures thin wrappers
that take the session `fixture_corpus` and compute their third element. `test_arm_weave.py`'s
`_copy_corpus(fixture_corpus, tmp_path)` gives mutation tests a writable copy — unchanged.
`sys.path` gets `evals/frontier` inside each file; the conftest needs the same insertion
before importing `corpuslib`. `tests/test_fleet_suite.py` today: `TESTS =
sorted(glob.glob(…"test_*.mjs"))`, `@pytest.mark.parametrize("path", TESTS, ids=basename)`,
a 120 s timeout, `test_fleet_has_tests`. Measured on the laptop at BASE:
`test_run_engine_examiner.mjs` 83.5 s, `test_sandbox_boot.mjs` 40.9 s,
`test_exam_edited_patches.mjs` 27.0 s, `test_run_engine_integrated_runs.mjs` 9.8 s,
`test_run_engine_proof_runs.mjs` 8.1 s, `test_deadline_slack.mjs` 6.4 s — that order is
`SLOW_FIRST`. xdist's `--dist load` hands items out in collection order, so a file whose items
collect first starts at t=0 instead of becoming the straggler; a `pytest_collection_modifyitems(session,
config, items)` hook that stable-partitions `items` by `item.fspath.basename ==
"test_fleet_suite.py"` is enough. CI's `Run tests` step is `python -m pytest tests/ -n auto
-v`; the report step is `wc -w skills/*/SKILL.md fleet/roles/*.md 2>/dev/null || true`.
`tests/test_validate_skill.py::test_ci_validates_every_shipped_skill` reads `ci.yml` for the
four validate lines and the absence of `ultraplan` — keep both.

**Proof:**
- Run: `test "$(python3 -m pytest tests/ --collect-only -q 2>/dev/null | tail -n 1 | cut -d' ' -f1)" = 1472`
- Run: `grep -B3 'def fixture_corpus' tests/conftest.py | grep -q 'scope="session"' && ! grep -q 'def fixture_corpus' tests/test_corpuslib.py && ! grep -q 'def fixture_corpus' tests/test_arm_weave.py && ! grep -q 'def fixture_corpus' tests/test_classify.py && ! grep -q 'def fixture_corpus' tests/test_replay_corpus.py && test "$(grep -c 'make_fixture_corpus(' tests/test_replay_corpus.py tests/test_arm_weave.py tests/test_classify.py | awk -F: '{s+=$2} END{print s}')" = 0 && test "$(grep -c 'make_fixture_corpus(' tests/test_corpuslib.py)" = 3 && python3 -m pytest -q -p no:xdist tests/test_corpuslib.py tests/test_arm_weave.py tests/test_classify.py tests/test_replay_corpus.py && python3 -m pytest -q -n auto tests/test_corpuslib.py tests/test_arm_weave.py tests/test_classify.py tests/test_replay_corpus.py`
- Run: `python3 -c "import glob,os,subprocess,sys; slow=['test_run_engine_examiner.mjs','test_sandbox_boot.mjs','test_exam_edited_patches.mjs','test_run_engine_integrated_runs.mjs','test_run_engine_proof_runs.mjs','test_deadline_slack.mjs']; names=sorted(os.path.basename(p) for p in glob.glob('fleet/tests/test_*.mjs')); exp=[s for s in slow if s in names]+[n for n in names if n not in slow]; out=subprocess.run([sys.executable,'-m','pytest','tests/','--collect-only','-q'],capture_output=True,text=True).stdout.splitlines(); head=out[:len(names)]; assert all(l.startswith('tests/test_fleet_suite.py::test_fleet_mjs[') for l in head), head; got=[l.split('[',1)[1].rstrip(']') for l in head]; assert got==exp, (got, exp)" && grep -q 'SLOW_FIRST' tests/test_fleet_suite.py && grep -q 'pytest_collection_modifyitems' tests/conftest.py`
- Run: `grep -A8 'Report skill prose sizes' .github/workflows/ci.yml | grep -q -- '--collect-only -q | tail -n 1' && grep -q -- '--durations=10' .github/workflows/ci.yml && test "$(grep -c 'validate_skill.py skills/' .github/workflows/ci.yml)" = 4 && ! grep -q 'ultraplan' .github/workflows/ci.yml && python3 -m pytest -q tests/test_validate_skill.py`
- Legs: (a) the second Run: exits non-zero if the `fixture_corpus` definition in the conftest
  is not decorated `scope="session"` within the three lines above it, if any of the four
  sibling files still defines its own `fixture_corpus`, if a builder call survives outside
  `test_corpuslib.py` or that file has other than its three (the two per-test builders,
  one of which calls it twice), or if the four files fail in one process or under `-n auto`
  [M1]; (b) the third exits non-zero unless the first N collected ids (N = the number of sim files
  on disk) are all bridge items and equal, in order, the `SLOW_FIRST` names present on disk
  followed by the remaining sim basenames sorted — a hoist of only two sims, a non-bridge
  item among the first N, or an unsorted tail fails the equality — and both the ordering
  tuple and the collection hook exist [M2]; (c) the fourth exits non-zero if the count line is not within the eight lines after the
  prose-sizes step or `--durations=10` is absent, if the
  validate lines are not exactly four, if `ultraplan` appears, or if the CI pin test fails
  [M3]; (d) the first exits non-zero unless exactly 1472 tests still collect — this task
  deletes nothing [M4].

**Stale-if:**
- path-exists: `tests/conftest.py`
- path-absent: `evals/frontier/corpuslib.py`
- issue-closed: #612

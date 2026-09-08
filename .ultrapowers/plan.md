# The species pruning pass: cross-file BASE pins and pinned-elsewhere duplicates go, each proven by the guard that survives

**Grammar:** claims-v1

**Claim:** Every test that byte-pins BASE text of a file outside its subject's Files, and every duplicate assertion the readers marked pinned-elsewhere, is deleted, and each deletion is proven by a Run: that shows the surviving pin (a grep of the remaining test) still guards the behaviour; the plan lists each deleted test by file and name. (quoted from #779)

**Goal:** #779 under map #766, decision 6 of the #767 grilling: one species pass, from a
measured list. The list was measured at BASE `1c97ba44` (0.3.21) over `tests/*.py` (108
files) and `fleet/tests/test_*.mjs` (69 files): 29 deletion rows — 12 of species A (a test
byte-pins BASE text of a file its subject does not own: a sibling test's source, a role
file, a skill document, a contract) and 17 of species B (the same assertion, or the same
whole-file re-run, held in two files) — each with a surviving guard the plan names beside
it. The 33 species-A-shaped rows that have NO surviving guard (the `test_review_peer.py`
positive `peer` pins, the `report-format.md` rows, the `CONTRACT.md` sentence slices, the
critic's four deferral reasons, and the rest) are out of this plan's scope by the issue's
own rule — a deletion with no survivor cannot carry the Run: the Claim requires — and stay
untouched. Every row below was confirmed present at BASE by name (`grep -c '^def <name>('`
= 1 for each of the 37 test names the tables cite, deleted and surviving alike).

**Closes:** #779

**Tech Stack:** pytest 8 + pytest-xdist over `tests/` (`pytest.ini`: `testpaths = tests`);
Node sims under `fleet/tests/test_*.mjs`, each bridged into the suite as
`test_fleet_mjs[<file>]` in `tests/test_fleet_suite.py` (sentinel `ALL TESTS PASSED`, `curl`,
`git`, `gh`, `ssh`, `systemd-run`, `systemctl` stubbed on PATH).

**Spec:** #779 (the measured list `b7-measured-list.md`, reproduced task by task in each
Context below — the sandbox holds no copy of it).

**Parallelization rationale:** One wave, width 10. The 29 rows are partitioned by the test
FILE they delete from, and no two tasks touch one file: Tasks 1–6 each own a disjoint set
of `tests/*.py` files, Tasks 7–10 each own a disjoint set of `fleet/tests/*.mjs` files. No
task consumes another's behaviour, no task produces a symbol, and no two tasks insert at one
location — every edit is a deletion inside its own file. `fleet/tests/test_run_engine.mjs`
(Task 7) is also edited by two concurrent plans of this sitting; that same-file overlap folds
at the integration and is deliberate.

## Global Constraints

- The pass deletes tests and nothing else: no shipped document, role file, skill, engine
  module or workflow changes.
- Check: `git diff --quiet $ULTRA_BASE -- skills fleet/roles fleet/CONTRACT.md fleet/RUNBOOK.md README.md hooks .github pytest.ini`
- Check: `git diff --quiet $ULTRA_BASE -- fleet ':(exclude)fleet/tests'`
- The surviving guards the deletions lean on are untouched: `tests/test_docs_agree_with_code.py`
  and `tests/test_recommendation_rubric.py` (kept by design, CLAUDE.md), the subject-owning
  files each task names, and the fleet bridge.
- Check: `git diff --quiet $ULTRA_BASE -- tests/test_docs_agree_with_code.py tests/test_recommendation_rubric.py tests/test_compile_plan.py tests/test_ultralearn_docs.py tests/test_validate_skill.py tests/test_ultrawrite_skill.py tests/test_fleet_suite.py fleet/tests/test_roles_peer.mjs`
- A deletion is a whole test function, a whole assertion block, or a whole assertion line
  the task names — never an assertion loosened in place, and never a survivor's positive
  half. A helper, import or constant that served only a deleted test goes with it; one that
  a kept test still uses stays.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: test_review_peer.py stops reading a sibling's source and asserts adversarial's absence once

**Type:** implementation

**Files:**
- Modify: `tests/test_review_peer.py`

**Claim:** After this run `tests/test_review_peer.py` names no sibling test file and holds no handle on the skill validator, and it asserts the absence of `adversarial` exactly once — in its rglob over `skills/` — while the guards it dropped still hold in the files that own them: `tests/test_compile_plan.py` for the peer pin, `tests/test_validate_skill.py` for the validator. (derived)
Machine: M1. Each of `test_the_base_compile_plan_pin_now_expects_peer`, `test_authoring_docs_carry_no_adversarial` and `test_ultrawrite_skill_still_validates` is absent from `tests/test_review_peer.py`; the constants `COMPILE_PLAN_TESTS` and `VALIDATE_SKILL` and the path fragment `tests/test_` each occur zero times in the file (two, two and two at BASE); and the file collects exactly 12 tests (15 at BASE). M2. `hits == []` and `re.findall("adversarial"` each occur zero times in the file (four and two at BASE) and `re.search("adversarial"` occurs exactly once (its rglob test), while the positive assertions of `test_report_format_review_row_documents_lean_and_peer`, `test_dependency_analysis_review_knob_example_says_peer` and `test_ultradocket_skill_marks_review_peer` remain. M3. `test_review_marker_emits_adversarial_slot` in `tests/test_compile_plan.py` still carries `review"] == "peer"` and passes; `test_ultrawrite_skill_validates` is still defined in `tests/test_validate_skill.py`; and `test_only_the_two_code_sites_under_skills_say_adversarial` still sweeps `SKILLS_DIR.rglob`. M4. `tests/test_review_peer.py` passes.

**Authorized-by:** #779 (desired state); map #766 decision 6 (#767 grilling, 2026-09-08)

**Interfaces:**
- Consumes: none
- Produces: nothing

**Context:** The rows this task deletes, from the measured list (BASE `1c97ba44`):

| test (or line) | species | what it pins outside its subject | surviving guard |
|---|---|---|---|
| `test_the_base_compile_plan_pin_now_expects_peer` | A | reads `tests/test_compile_plan.py` source for `review"] == "peer"`, then re-runs that node id | `test_review_marker_emits_adversarial_slot` in `tests/test_compile_plan.py`, which the suite runs |
| `test_authoring_docs_carry_no_adversarial` | B | `skills/ultrawrite/SKILL.md`, `skills/ultrapowers/references/plan-markers.md`: `adversarial` absent | `test_only_the_two_code_sites_under_skills_say_adversarial` in this same file (rglob over all of `skills/`) |
| the `hits == []` line in each of `test_report_format_review_row_documents_lean_and_peer`, `test_dependency_analysis_review_knob_example_says_peer`, `test_ultradocket_skill_marks_review_peer` (three lines, with the `hits = _occurrences(...)` line that feeds each) | B | `report-format.md`, `dependency-analysis.md`, `skills/ultradocket/SKILL.md`: `adversarial` absent | the same rglob test |
| `test_ultrawrite_skill_still_validates` | B | runs `validate_skill.py skills/ultrawrite` | `test_ultrawrite_skill_validates` in `tests/test_validate_skill.py`, `test_validate_skill_accepts_it` in `tests/test_ultrawrite_skill.py`, and CI's validate-every-skill step |

The three tests that lose their `hits == []` line keep their positive halves — the `lean` (one pass) / `peer` (two) row assertions, the `review: { T1: peer, default: lean }` example, and the `**Review:** peer` marker — those are the only positive pins of those rows (KEEP rows of the list). `COMPILE_PLAN_TESTS` and `VALIDATE_SKILL` are each used by one deleted test only and go with it (each occurs twice at BASE: the assignment and the use); `_occurrences` is used only by the three deleted lines and goes too. At BASE the file collects 15 tests; `hits == []` occurs 4 times, `re.findall("adversarial"` twice (the deleted test and `_occurrences`), `re.search("adversarial"` once (the rglob test), and the path fragment `tests/test_` twice (the `COMPILE_PLAN_TESTS` assignment and the node id the deleted test re-ran).

**Proof:**
- Run: `! grep -q 'def test_the_base_compile_plan_pin_now_expects_peer' tests/test_review_peer.py && ! grep -q 'def test_authoring_docs_carry_no_adversarial' tests/test_review_peer.py && ! grep -q 'def test_ultrawrite_skill_still_validates' tests/test_review_peer.py && ! grep -q 'COMPILE_PLAN_TESTS' tests/test_review_peer.py && ! grep -q 'VALIDATE_SKILL' tests/test_review_peer.py && ! grep -q 'tests/test_' tests/test_review_peer.py && test "$(python3 -m pytest --collect-only -q -p no:cacheprovider tests/test_review_peer.py 2>/dev/null | grep -c '::')" = 12`
- Run: `! grep -q 'hits == \[\]' tests/test_review_peer.py && ! grep -q 're.findall("adversarial"' tests/test_review_peer.py && test "$(grep -c 're.search("adversarial"' tests/test_review_peer.py)" = 1 && grep -q 'def test_report_format_review_row_documents_lean_and_peer' tests/test_review_peer.py && grep -q '(one pass)' tests/test_review_peer.py && grep -q 'def test_dependency_analysis_review_knob_example_says_peer' tests/test_review_peer.py && grep -q 'review: { T1: peer, default: lean }' tests/test_review_peer.py && grep -q 'def test_ultradocket_skill_marks_review_peer' tests/test_review_peer.py && grep -q 'Review:\*\* peer' tests/test_review_peer.py`
- Run: `grep -q 'review"\] == "peer"' tests/test_compile_plan.py && python3 -m pytest -q -p no:cacheprovider tests/test_compile_plan.py::test_review_marker_emits_adversarial_slot && grep -q 'def test_ultrawrite_skill_validates' tests/test_validate_skill.py && grep -q 'def test_only_the_two_code_sites_under_skills_say_adversarial' tests/test_review_peer.py && grep -q 'SKILLS_DIR.rglob' tests/test_review_peer.py`
- Run: `python3 -m pytest -q -p no:cacheprovider tests/test_review_peer.py`
- Legs: (a) the first Run: exits non-zero if the def line of `test_the_base_compile_plan_pin_now_expects_peer` survives [M1]; (b) it exits non-zero if the def line of `test_authoring_docs_carry_no_adversarial` survives [M1]; (c) it exits non-zero if the def line of `test_ultrawrite_skill_still_validates` survives, if `COMPILE_PLAN_TESTS`, `VALIDATE_SKILL` or any `tests/test_` path survives anywhere in the file, or if the file collects other than exactly 12 [M1]; (d) the second Run: exits non-zero if any `hits == []` line or any `re.findall("adversarial"` survives, if `re.search("adversarial"` occurs other than exactly once, or if any of the three named tests or its positive literal is gone [M2]; (e) the third Run: exits non-zero if the compile_plan pin lost its `peer` literal or fails, if `test_ultrawrite_skill_validates` is gone from `tests/test_validate_skill.py`, or if the rglob test or its `SKILLS_DIR.rglob` sweep is gone [M3]; (f) the fourth Run: exits non-zero if the file fails [M4].

**Stale-if:**
- path-absent: `tests/test_review_peer.py`
- path-absent: `tests/test_compile_plan.py`

### Task 2: The harvest tests stop reading sibling test sources

**Type:** implementation

**Files:**
- Modify: `tests/test_harvest_evidence.py`
- Modify: `tests/test_harvest_fleet_runs_publish_fold.py`

**Claim:** After this run neither `tests/test_harvest_evidence.py` nor `tests/test_harvest_fleet_runs_publish_fold.py` reads another test file's source to prove a deletion or a key set; the absence of the ssh fetcher, the flag allowlist and the bundle key set are each guarded where they live. (derived)
Machine: M1. Each of `test_the_remote_harvest_test_and_the_swallow_quarantine_entry_are_gone` and `test_the_docs_flag_allowlist_names_evidence_and_not_remote` is absent from `tests/test_harvest_evidence.py`, which collects exactly 14 tests (16 at BASE); `test_base_bundle_keys_names_publish_fold` is absent from `tests/test_harvest_fleet_runs_publish_fold.py`, which collects exactly 8 (9 at BASE); and no `read_text()` of a `tests/test_*.py` path remains in either file (four at BASE). M2. `tests/test_harvest_evidence.py` still holds `test_the_ssh_fetcher_and_its_test_no_longer_exist` with its `"fleet_fetch" not in HARVEST.read_text()` assertion, `test_help_names_evidence_and_never_remote`, and the `assert set(b) == set(BASE_BUNDLE_KEYS)` assertion with `"publishFold"` in that key set; `tests/test_ultralearn_docs.py` still holds `test_every_flag_the_skill_advertises_exists` naming `"--evidence"`. M3. Both edited files pass.

**Authorized-by:** #779 (desired state); map #766 decision 6

**Interfaces:**
- Consumes: none
- Produces: nothing

**Context:** The rows this task deletes, from the measured list (BASE `1c97ba44`):

| file | test | species | what it pins outside its subject | surviving guard |
|---|---|---|---|---|
| `tests/test_harvest_evidence.py` | `test_the_remote_harvest_test_and_the_swallow_quarantine_entry_are_gone` | A | reads `tests/test_harvest_fleet_runs.py` source (absence of `test_remote_harvest_of_an_unreachable_host_fails_loud`) and `tests/test_ultralearn_swallows.py` source (absence of `fleet_fetch`) | `test_the_ssh_fetcher_and_its_test_no_longer_exist` in `tests/test_harvest_evidence.py` — `fleet_fetch.py` absent and the harvester imports none; any surviving reference would fail at import |
| `tests/test_harvest_evidence.py` | `test_the_docs_flag_allowlist_names_evidence_and_not_remote` | A | reads `tests/test_ultralearn_docs.py` source: `--evidence` in, `--remote` not in | `test_every_flag_the_skill_advertises_exists` in `tests/test_ultralearn_docs.py` (the allowlist is executed against `--help`) + `test_help_names_evidence_and_never_remote` in `tests/test_harvest_evidence.py` |
| `tests/test_harvest_fleet_runs_publish_fold.py` | `test_base_bundle_keys_names_publish_fold` | A | ast-reads `tests/test_harvest_evidence.py` for `BASE_BUNDLE_KEYS` containing `publishFold` | `test_a_local_run_dir_bundles_exactly_as_the_base_harvester_did` in `tests/test_harvest_evidence.py` (asserts `set(b) == set(BASE_BUNDLE_KEYS)` on a bundle that carries `publishFold`) |

`_base_bundle_keys()` in `test_harvest_fleet_runs_publish_fold.py` serves only the deleted test (three mentions at BASE: the def, its docstring, the call) and goes with it, as does any import only it used. The two survivors in `test_harvest_evidence.py` are not touched. At BASE the two files hold four `read_text()` calls on a `tests/test_*.py` path — `test_harvest_evidence.py` lines 529, 531 and 537, all inside the two deleted tests, and `test_harvest_fleet_runs_publish_fold.py` line 270, inside the deleted helper; the surviving `assert not (REPO / "tests/test_fleet_fetch.py").exists()` is an existence check, not a source read, and stays. At BASE `test_harvest_evidence.py` collects 16 and `test_harvest_fleet_runs_publish_fold.py` collects 9.

**Proof:**
- Run: `! grep -q 'def test_the_remote_harvest_test_and_the_swallow_quarantine_entry_are_gone' tests/test_harvest_evidence.py && ! grep -q 'def test_the_docs_flag_allowlist_names_evidence_and_not_remote' tests/test_harvest_evidence.py && test "$(python3 -m pytest --collect-only -q -p no:cacheprovider tests/test_harvest_evidence.py 2>/dev/null | grep -c '::')" = 14`
- Run: `! grep -q 'def test_base_bundle_keys_names_publish_fold' tests/test_harvest_fleet_runs_publish_fold.py && ! grep -q '_base_bundle_keys' tests/test_harvest_fleet_runs_publish_fold.py && test "$(python3 -m pytest --collect-only -q -p no:cacheprovider tests/test_harvest_fleet_runs_publish_fold.py 2>/dev/null | grep -c '::')" = 8`
- Run: `! grep -q 'tests/test_.*\.py").read_text()' tests/test_harvest_evidence.py tests/test_harvest_fleet_runs_publish_fold.py`
- Run: `grep -q 'def test_the_ssh_fetcher_and_its_test_no_longer_exist' tests/test_harvest_evidence.py && grep -q '"fleet_fetch" not in HARVEST.read_text()' tests/test_harvest_evidence.py && grep -q 'def test_help_names_evidence_and_never_remote' tests/test_harvest_evidence.py && grep -q 'assert set(b) == set(BASE_BUNDLE_KEYS)' tests/test_harvest_evidence.py && grep -q '"publishFold"' tests/test_harvest_evidence.py && grep -q 'def test_every_flag_the_skill_advertises_exists' tests/test_ultralearn_docs.py && grep -q '"--evidence"' tests/test_ultralearn_docs.py`
- Run: `python3 -m pytest -q -p no:cacheprovider tests/test_harvest_evidence.py tests/test_harvest_fleet_runs_publish_fold.py`
- Legs: (a) the first Run: exits non-zero if the def line of `test_the_remote_harvest_test_and_the_swallow_quarantine_entry_are_gone` survives [M1]; (b) it exits non-zero if the def line of `test_the_docs_flag_allowlist_names_evidence_and_not_remote` survives, or if the file collects other than exactly 14 [M1]; (c) the second Run: exits non-zero if the def line of `test_base_bundle_keys_names_publish_fold` or its `_base_bundle_keys` helper survives, or if the file collects other than exactly 8 [M1]; (d) the third Run: exits non-zero if any `read_text()` of a `tests/test_*.py` path survives in either file — the sweep that makes the sentence's negative hold beyond the three named tests [M1]; (e) the fourth Run: exits non-zero if any of the seven named survivor literals is gone from its file [M2]; (f) the fifth Run: exits non-zero if either file fails [M3].

**Stale-if:**
- path-absent: `tests/test_harvest_evidence.py`
- path-absent: `tests/test_harvest_fleet_runs_publish_fold.py`

### Task 3: test_roles_run_evidence.py stops sweeping the role files and re-running the role sims

**Type:** implementation

**Files:**
- Modify: `tests/test_roles_run_evidence.py`

**Claim:** After this run `tests/test_roles_run_evidence.py` neither greps the role files for shouted imperatives and `adversarial` nor spawns the peer and examiner role sims; the register sweep lives in the role-file exam and the sims run through the fleet bridge. (derived)
Machine: M1. Each of `test_the_two_role_files_keep_their_register` and `test_both_role_exams_still_pass_with_their_verbatim_pins` is absent from `tests/test_roles_run_evidence.py`, which collects exactly 7 tests (9 at BASE). M2. `fleet/tests/test_roles_peer.mjs` carries the `NEVER|ALWAYS|MUST` regex exactly once, over `roleFiles`, and the suite collects `test_fleet_mjs[test_roles_peer.mjs]` and `test_fleet_mjs[test_roles_examiner.mjs]`. M3. `tests/test_roles_run_evidence.py` passes.

**Authorized-by:** #779 (desired state); map #766 decision 6

**Interfaces:**
- Consumes: none
- Produces: nothing

**Context:** The rows this task deletes, from the measured list (BASE `1c97ba44`):

| test | species | what it pins outside its subject | surviving guard |
|---|---|---|---|
| `test_the_two_role_files_keep_their_register` | A/B | `fleet/roles/reviewer.md`, `fleet/roles/critic.md`: no shouted `NEVER`/`ALWAYS`/`MUST`, no `adversarial` | `fleet/tests/test_roles_peer.mjs` (a) M1 — the `adversarial` sweep over every role file — and (g) M7 — the shout sweep over `readdirSync(rolesDir)` |
| `test_both_role_exams_still_pass_with_their_verbatim_pins` | B | spawns `node fleet/tests/test_roles_peer.mjs` and `node fleet/tests/test_roles_examiner.mjs` | `test_fleet_mjs[test_roles_peer.mjs]` in `tests/test_fleet_suite.py` and `…[test_roles_examiner.mjs]` — the bridge runs every `fleet/tests/test_*.mjs` |

The `SHOUT` constant is used only by the first deleted test and goes with it. The file's other seven tests (the four deferral reasons, the `integratedRuns` rows, the RUN EVIDENCE paragraph pins and their `_is_live` twins) are KEEP rows of the list — their sentences have no other guard — and are not touched. At BASE the file collects 9.

**Proof:**
- Run: `! grep -q 'def test_the_two_role_files_keep_their_register' tests/test_roles_run_evidence.py && ! grep -q 'def test_both_role_exams_still_pass_with_their_verbatim_pins' tests/test_roles_run_evidence.py && ! grep -q 'ALL TESTS PASSED' tests/test_roles_run_evidence.py && test "$(python3 -m pytest --collect-only -q -p no:cacheprovider tests/test_roles_run_evidence.py 2>/dev/null | grep -c '::')" = 7`
- Run: `grep -c 'NEVER|ALWAYS|MUST' fleet/tests/test_roles_peer.mjs | grep -qx 1 && grep -q 'roleFiles' fleet/tests/test_roles_peer.mjs && python3 -m pytest --co -q -p no:cacheprovider tests/test_fleet_suite.py | grep -q 'test_fleet_mjs\[test_roles_peer.mjs\]' && python3 -m pytest --co -q -p no:cacheprovider tests/test_fleet_suite.py | grep -q 'test_fleet_mjs\[test_roles_examiner.mjs\]'`
- Run: `python3 -m pytest -q -p no:cacheprovider tests/test_roles_run_evidence.py`
- Legs: (a) the first Run: exits non-zero if the def line of `test_the_two_role_files_keep_their_register` survives [M1]; (b) it exits non-zero if the def line of `test_both_role_exams_still_pass_with_their_verbatim_pins` or its `ALL TESTS PASSED` sentinel check survives, or if the file collects other than exactly 7 [M1]; (c) the second Run: exits non-zero if the role-file exam holds the shout regex other than exactly once or lost its `roleFiles` sweep, or if the bridge collects either role sim under any other id [M2]; (d) the third Run: exits non-zero if the file fails [M3].

**Stale-if:**
- path-absent: `tests/test_roles_run_evidence.py`
- path-absent: `fleet/tests/test_roles_peer.mjs`

### Task 4: test_ultrawrite_surface_rules_implementer_check.py sheds its shout count, its eight-file re-run and its validator run

**Type:** implementation

**Files:**
- Modify: `tests/test_ultrawrite_surface_rules_implementer_check.py`

**Claim:** After this run `tests/test_ultrawrite_surface_rules_implementer_check.py` neither counts shouted words in the ultrawrite skill, nor spawns pytest over eight sibling test files, nor runs the skill validator; each of those is held by the files that own it — the proof-modes exam, the suite's own collection, and the validator's tests. (derived)
Machine: M1. Each of `test_m5_shouted_word_counts_stay_at_bases_zeros`, `test_m5_the_tests_that_read_the_skill_still_pass` and `test_m5_validate_skill_prints_skill_ok` is absent from `tests/test_ultrawrite_surface_rules_implementer_check.py`; no `"-m", "pytest"` argv and no `validate_skill.py` mention remain in it (one each at BASE); and it collects exactly 9 tests (12 at BASE). M2. `tests/test_proof_modes_documented.py` still holds `test_leg_e_m5_no_shouted_whole_word_is_added_to_the_three_files` with its `SKILL_PATH, EXAMINER_PATH, MARKERS_PATH` leg and `BASE_SHOUT_COUNTS`; `tests/test_validate_skill.py` still holds `test_ultrawrite_skill_validates` and `tests/test_ultrawrite_skill.py` still holds `test_validate_skill_accepts_it`; and each of the eight re-run files exists under `tests/`, which `pytest.ini` scopes the suite to. M3. `tests/test_ultrawrite_surface_rules_implementer_check.py` passes.

**Authorized-by:** #779 (desired state); map #766 decision 6

**Interfaces:**
- Consumes: none
- Produces: nothing

**Context:** The rows this task deletes, from the measured list (BASE `1c97ba44`):

| test | species | what it pins outside its subject | surviving guard |
|---|---|---|---|
| `test_m5_shouted_word_counts_stay_at_bases_zeros` | A/B | `skills/ultrawrite/SKILL.md`: shout counts `{0,0,0}` | `test_leg_e_m5_no_shouted_whole_word_is_added_to_the_three_files` in `tests/test_proof_modes_documented.py` — the same three words, the same zeros, on its `SKILL_PATH` leg |
| `test_m5_the_tests_that_read_the_skill_still_pass` | B | spawns pytest over `test_ultrawrite_skill.py`, `test_plan_level_claim.py`, `test_review_peer.py`, `test_proof_modes_documented.py`, `test_compile_plan_check_cost.py`, `test_compile_plan_prose_check.py`, `test_compile_plan_integration_hostile.py`, `test_marker_contract.py` | the suite collects all eight (`pytest.ini`: `testpaths = tests`) |
| `test_m5_validate_skill_prints_skill_ok` | B | runs `validate_skill.py skills/ultrawrite` | `test_ultrawrite_skill_validates` in `tests/test_validate_skill.py`, `test_validate_skill_accepts_it` in `tests/test_ultrawrite_skill.py`, and CI's validate-every-skill step |

The `SHOUT_WORDS` tuple (assembled from pieces so the file carries no shouted whole word) is used only by the first deleted test and goes with it. At BASE the file collects 12, holds one `"-m", "pytest"` spawn (the deleted eight-file re-run) and one `validate_skill.py` mention (the deleted validator run); its `run()` helper (`subprocess.run(["bash", "-c", command], ...)`) serves the kept `RUN_BULLETS` tests and stays. The validator has two surviving guards on purpose — the validator's own test file and the ultrawrite skill's — so the claim says "held by the files that own it", not "held once".

**Proof:**
- Run: `! grep -q 'def test_m5_shouted_word_counts_stay_at_bases_zeros' tests/test_ultrawrite_surface_rules_implementer_check.py && ! grep -q 'def test_m5_the_tests_that_read_the_skill_still_pass' tests/test_ultrawrite_surface_rules_implementer_check.py && ! grep -q 'def test_m5_validate_skill_prints_skill_ok' tests/test_ultrawrite_surface_rules_implementer_check.py && ! grep -q '"-m", "pytest"' tests/test_ultrawrite_surface_rules_implementer_check.py && ! grep -q 'validate_skill.py' tests/test_ultrawrite_surface_rules_implementer_check.py && test "$(python3 -m pytest --collect-only -q -p no:cacheprovider tests/test_ultrawrite_surface_rules_implementer_check.py 2>/dev/null | grep -c '::')" = 9`
- Run: `grep -q 'def test_leg_e_m5_no_shouted_whole_word_is_added_to_the_three_files' tests/test_proof_modes_documented.py && grep -q 'SKILL_PATH, EXAMINER_PATH, MARKERS_PATH' tests/test_proof_modes_documented.py && grep -q 'BASE_SHOUT_COUNTS' tests/test_proof_modes_documented.py && grep -q 'def test_ultrawrite_skill_validates' tests/test_validate_skill.py && grep -q 'def test_validate_skill_accepts_it' tests/test_ultrawrite_skill.py && test -f tests/test_ultrawrite_skill.py && test -f tests/test_plan_level_claim.py && test -f tests/test_review_peer.py && test -f tests/test_proof_modes_documented.py && test -f tests/test_compile_plan_check_cost.py && test -f tests/test_compile_plan_prose_check.py && test -f tests/test_compile_plan_integration_hostile.py && test -f tests/test_marker_contract.py && grep -q 'testpaths = tests' pytest.ini`
- Run: `python3 -m pytest -q -p no:cacheprovider tests/test_ultrawrite_surface_rules_implementer_check.py`
- Legs: (a) the first Run: exits non-zero if the def line of `test_m5_shouted_word_counts_stay_at_bases_zeros` survives [M1]; (b) it exits non-zero if the def line of `test_m5_the_tests_that_read_the_skill_still_pass` or any `"-m", "pytest"` spawn survives [M1]; (c) it exits non-zero if the def line of `test_m5_validate_skill_prints_skill_ok` or any `validate_skill.py` mention survives, or if the file collects other than exactly 9 [M1]; (d) the second Run: exits non-zero if the proof-modes shout test, its `SKILL_PATH, EXAMINER_PATH, MARKERS_PATH` leg or its `BASE_SHOUT_COUNTS` is gone [M2]; (e) the second Run: exits non-zero if `test_ultrawrite_skill_validates` is gone from `tests/test_validate_skill.py` [M2]; (f) the second Run: exits non-zero if `test_validate_skill_accepts_it` is gone from `tests/test_ultrawrite_skill.py` [M2]; (g) the second Run: exits non-zero if any one of the eight re-run files is missing from `tests/`, or if `pytest.ini` no longer scopes the suite to `tests` [M2]; (h) the third Run: exits non-zero if the file fails [M3].

**Stale-if:**
- path-absent: `tests/test_ultrawrite_surface_rules_implementer_check.py`
- path-absent: `tests/test_proof_modes_documented.py`

### Task 5: The compiler and ultralearn tests stop re-running sibling suites

**Type:** implementation

**Files:**
- Modify: `tests/test_compile_plan_engine_self_change.py`
- Modify: `tests/test_compile_plan_one_sided.py`
- Modify: `tests/test_compile_plan_sha_unguarded.py`
- Modify: `tests/test_compile_plan_wide_files.py`
- Modify: `tests/test_ultralearn_swallows.py`

**Claim:** After this run none of the four compiler-species test files nor the ultralearn swallows file spawns pytest over a sibling test file; the species exam, the check-cost exam and the three reader files run once each, as the suite's own members. (derived)
Machine: M1. `test_the_existing_species_exam_still_passes` is absent from `tests/test_compile_plan_engine_self_change.py` (collects exactly 15; 16 at BASE) and from `tests/test_compile_plan_one_sided.py` (exactly 31; 32 at BASE); `test_the_five_species_exam_still_passes` is absent from `tests/test_compile_plan_sha_unguarded.py` (exactly 36; 37 at BASE); both `test_the_five_species_exam_still_passes` and `test_666_the_species_vocabulary_and_five_species_exams_still_pass` are absent from `tests/test_compile_plan_wide_files.py` (exactly 26; 28 at BASE); `test_healthy_paths_unchanged` is absent from `tests/test_ultralearn_swallows.py` (exactly 8; 9 at BASE); and no `"-m", "pytest"` spawn remains in any of the five files. M2. `tests/test_compile_plan_proof_species.py`, `tests/test_compile_plan_check_cost.py`, `tests/test_readers.py`, `tests/test_fleet_slice.py` and `tests/test_merge_ledger.py` each exist under `tests/`, which `pytest.ini` scopes the suite to. M3. The five edited files pass.

**Authorized-by:** #779 (desired state); map #766 decision 6

**Interfaces:**
- Consumes: none
- Produces: nothing

**Context:** The rows this task deletes, from the measured list (BASE `1c97ba44`) — every one species B, a whole-file re-run of a sibling the suite already collects:

| file | test | re-runs | surviving guard |
|---|---|---|---|
| `tests/test_compile_plan_engine_self_change.py` | `test_the_existing_species_exam_still_passes` | `tests/test_compile_plan_proof_species.py` | the suite runs `tests/test_compile_plan_proof_species.py` |
| `tests/test_compile_plan_one_sided.py` | `test_the_existing_species_exam_still_passes` | same | same |
| `tests/test_compile_plan_sha_unguarded.py` | `test_the_five_species_exam_still_passes` | same | same |
| `tests/test_compile_plan_wide_files.py` | `test_the_five_species_exam_still_passes` | same | same |
| `tests/test_compile_plan_wide_files.py` | `test_666_the_species_vocabulary_and_five_species_exams_still_pass` | `tests/test_compile_plan_proof_species.py` + `tests/test_compile_plan_check_cost.py` | the suite runs both |
| `tests/test_ultralearn_swallows.py` | `test_healthy_paths_unchanged` | `tests/test_readers.py`, `tests/test_fleet_slice.py`, `tests/test_merge_ledger.py` | the suite runs all three |

At BASE each of the five files holds `"-m", "pytest"` exactly once, except `test_compile_plan_wide_files.py`, which holds it twice (one per deleted test). Collected counts at BASE: engine_self_change 16, one_sided 32, sha_unguarded 37, wide_files 28, ultralearn_swallows 9. The `subprocess` and `sys` imports stay wherever a kept test still uses them.

**Proof:**
- Run: `! grep -q 'def test_the_existing_species_exam_still_passes' tests/test_compile_plan_engine_self_change.py && test "$(python3 -m pytest --collect-only -q -p no:cacheprovider tests/test_compile_plan_engine_self_change.py 2>/dev/null | grep -c '::')" = 15`
- Run: `! grep -q 'def test_the_existing_species_exam_still_passes' tests/test_compile_plan_one_sided.py && test "$(python3 -m pytest --collect-only -q -p no:cacheprovider tests/test_compile_plan_one_sided.py 2>/dev/null | grep -c '::')" = 31`
- Run: `! grep -q 'def test_the_five_species_exam_still_passes' tests/test_compile_plan_sha_unguarded.py && test "$(python3 -m pytest --collect-only -q -p no:cacheprovider tests/test_compile_plan_sha_unguarded.py 2>/dev/null | grep -c '::')" = 36`
- Run: `! grep -q 'def test_the_five_species_exam_still_passes' tests/test_compile_plan_wide_files.py && ! grep -q 'def test_666_the_species_vocabulary_and_five_species_exams_still_pass' tests/test_compile_plan_wide_files.py && test "$(python3 -m pytest --collect-only -q -p no:cacheprovider tests/test_compile_plan_wide_files.py 2>/dev/null | grep -c '::')" = 26`
- Run: `! grep -q 'def test_healthy_paths_unchanged' tests/test_ultralearn_swallows.py && test "$(python3 -m pytest --collect-only -q -p no:cacheprovider tests/test_ultralearn_swallows.py 2>/dev/null | grep -c '::')" = 8`
- Run: `! grep -q '"-m", "pytest"' tests/test_compile_plan_engine_self_change.py tests/test_compile_plan_one_sided.py tests/test_compile_plan_sha_unguarded.py tests/test_compile_plan_wide_files.py tests/test_ultralearn_swallows.py`
- Run: `test -f tests/test_compile_plan_proof_species.py && test -f tests/test_compile_plan_check_cost.py && test -f tests/test_readers.py && test -f tests/test_fleet_slice.py && test -f tests/test_merge_ledger.py && grep -q 'testpaths = tests' pytest.ini`
- Run: `python3 -m pytest -q -p no:cacheprovider tests/test_compile_plan_engine_self_change.py tests/test_compile_plan_one_sided.py tests/test_compile_plan_sha_unguarded.py tests/test_compile_plan_wide_files.py tests/test_ultralearn_swallows.py`
- Legs: (a) the first Run: exits non-zero if the engine_self_change re-run survives or the file collects other than exactly 15 [M1]; (b) the second exits non-zero if the one_sided re-run survives or the file collects other than exactly 31 [M1]; (c) the third exits non-zero if the sha_unguarded re-run survives or the file collects other than exactly 36 [M1]; (d) the fourth exits non-zero if either wide_files re-run survives or the file collects other than exactly 26 [M1]; (e) the fifth exits non-zero if the swallows re-run survives or the file collects other than exactly 8 [M1]; (f) the sixth exits non-zero if any `"-m", "pytest"` spawn survives in any of the five files [M1]; (g) the seventh exits non-zero if any of the five re-run targets is missing from `tests/` or `pytest.ini` no longer scopes the suite to `tests` [M2]; (h) the eighth exits non-zero if any of the five files fails [M3].

**Stale-if:**
- path-absent: `tests/test_compile_plan_proof_species.py`
- path-absent: `tests/test_compile_plan_wide_files.py`

### Task 6: The header-Claim count and the validator runs are held once

**Type:** implementation

**Files:**
- Modify: `tests/test_plan_level_claim.py`
- Modify: `tests/test_proof_modes_documented.py`
- Modify: `tests/test_compile_plan_check_cost.py`
- Modify: `tests/test_skill_setup_section.py`

**Claim:** After this run the ultrawrite skill's header-Claim count is asserted once in `tests/test_plan_level_claim.py`, and no test in these four files runs the skill validator — `tests/test_validate_skill.py` and `tests/test_docs_agree_with_code.py` own that. (derived)
Machine: M1. `test_755_skill_the_document_names_the_header_claim_line_exactly_once` and `test_skill_still_validates` are absent from `tests/test_plan_level_claim.py` (collects exactly 33; 35 at BASE), and `para.count("**Claim:**") == 1` occurs exactly once there (twice at BASE), inside `test_skill_the_document_names_the_header_claim_line`. M2. `test_leg_e_m5_validate_skill_prints_skill_ok` is absent from `tests/test_proof_modes_documented.py` (collects exactly 1; 2 at BASE); `test_the_skill_still_validates` is absent from `tests/test_compile_plan_check_cost.py` (exactly 11; 12 at BASE); `test_validate_skill_accepts_the_ultrapowers_skill` is absent from `tests/test_skill_setup_section.py` (exactly 33; 34 at BASE). M3. `tests/test_validate_skill.py` still holds `test_ultrawrite_skill_validates`, `tests/test_ultrawrite_skill.py` still holds `test_validate_skill_accepts_it`, `tests/test_docs_agree_with_code.py` still holds `test_validate_skill_accepts_the_ultrapowers_skill`, and `.github/workflows/ci.yml` still validates every skill directory. M4. The four edited files pass.

**Authorized-by:** #779 (desired state); map #766 decision 6

**Interfaces:**
- Consumes: none
- Produces: nothing

**Context:** The rows this task deletes, from the measured list (BASE `1c97ba44`):

| file | test | species | what it duplicates | surviving guard |
|---|---|---|---|---|
| `tests/test_plan_level_claim.py` | `test_755_skill_the_document_names_the_header_claim_line_exactly_once` | B | byte-identical to the row's survivor: the "Above the first task:" paragraph of `skills/ultrawrite/SKILL.md` names `**Claim:**` once | `test_skill_the_document_names_the_header_claim_line` in `tests/test_plan_level_claim.py` (same file, same assertion, kept) |
| `tests/test_plan_level_claim.py` | `test_skill_still_validates` | B | runs `validate_skill.py skills/ultrawrite` | `test_ultrawrite_skill_validates` in `tests/test_validate_skill.py`, `test_validate_skill_accepts_it` in `tests/test_ultrawrite_skill.py`, CI's validate-every-skill step |
| `tests/test_proof_modes_documented.py` | `test_leg_e_m5_validate_skill_prints_skill_ok` | B | same validator run | same |
| `tests/test_compile_plan_check_cost.py` | `test_the_skill_still_validates` | B | same validator run | same |
| `tests/test_skill_setup_section.py` | `test_validate_skill_accepts_the_ultrapowers_skill` | B | runs `validate_skill.py skills/ultrapowers` | `test_validate_skill_accepts_the_ultrapowers_skill` in `tests/test_docs_agree_with_code.py` (same name, same command, kept by design) and `tests/test_validate_skill.py` |

`tests/test_proof_modes_documented.py` keeps `test_leg_e_m5_no_shouted_whole_word_is_added_to_the_three_files` — the sole guard of the `plan-markers.md` shout leg, and the guard this plan leaves for the SKILL.md leg once the duplicate count in `test_ultrawrite_surface_rules_implementer_check.py` is gone — so that file collects exactly one test afterwards. The other pins in `test_plan_level_claim.py` (`test_skill_self_review_names_derived_and_the_plan_level_claim`, the three `test_755_skill_*_tag` tests) are KEEP rows and are not touched. CI validates skills with `for s in skills/*/; do python skills/ultrapowers/scripts/validate_skill.py "${s%/}" || exit 1; done` (`.github/workflows/ci.yml`, step "Validate every skill"). At BASE `grep -c 'para.count("\*\*Claim:\*\*") == 1' tests/test_plan_level_claim.py` prints 2; collected counts: plan_level_claim 35, proof_modes_documented 2, check_cost 12, skill_setup_section 34.

**Proof:**
- Run: `! grep -q 'def test_755_skill_the_document_names_the_header_claim_line_exactly_once' tests/test_plan_level_claim.py && ! grep -q 'def test_skill_still_validates' tests/test_plan_level_claim.py && grep -c 'para.count("\*\*Claim:\*\*") == 1' tests/test_plan_level_claim.py | grep -qx 1 && grep -q 'def test_skill_the_document_names_the_header_claim_line' tests/test_plan_level_claim.py && test "$(python3 -m pytest --collect-only -q -p no:cacheprovider tests/test_plan_level_claim.py 2>/dev/null | grep -c '::')" = 33`
- Run: `! grep -q 'def test_leg_e_m5_validate_skill_prints_skill_ok' tests/test_proof_modes_documented.py && grep -q 'def test_leg_e_m5_no_shouted_whole_word_is_added_to_the_three_files' tests/test_proof_modes_documented.py && test "$(python3 -m pytest --collect-only -q -p no:cacheprovider tests/test_proof_modes_documented.py 2>/dev/null | grep -c '::')" = 1`
- Run: `! grep -q 'def test_the_skill_still_validates' tests/test_compile_plan_check_cost.py && test "$(python3 -m pytest --collect-only -q -p no:cacheprovider tests/test_compile_plan_check_cost.py 2>/dev/null | grep -c '::')" = 11`
- Run: `! grep -q 'def test_validate_skill_accepts_the_ultrapowers_skill' tests/test_skill_setup_section.py && test "$(python3 -m pytest --collect-only -q -p no:cacheprovider tests/test_skill_setup_section.py 2>/dev/null | grep -c '::')" = 33`
- Run: `grep -q 'def test_ultrawrite_skill_validates' tests/test_validate_skill.py && grep -q 'def test_validate_skill_accepts_it' tests/test_ultrawrite_skill.py && grep -q 'def test_validate_skill_accepts_the_ultrapowers_skill' tests/test_docs_agree_with_code.py && grep -q 'validate_skill.py "${s%/}"' .github/workflows/ci.yml`
- Run: `python3 -m pytest -q -p no:cacheprovider tests/test_plan_level_claim.py tests/test_proof_modes_documented.py tests/test_compile_plan_check_cost.py tests/test_skill_setup_section.py`
- Legs: (a) the first Run: exits non-zero if either deleted def survives in `test_plan_level_claim.py`, if the `para.count` assertion occurs other than exactly once, if its surviving host test is gone, or if the file collects other than exactly 33 [M1]; (b) the second exits non-zero if the proof-modes validator test survives, if its shout sibling is gone, or if the file collects other than exactly 1 [M2]; (c) the third exits non-zero if the check-cost validator test survives or the file collects other than exactly 11 [M2]; (d) the fourth exits non-zero if the setup-section validator test survives or the file collects other than exactly 33 [M2]; (e) the fifth exits non-zero if any of the three surviving validator tests is gone from its file or CI's per-directory validate loop is gone [M3]; (f) the sixth exits non-zero if any of the four files fails [M4].

**Stale-if:**
- path-absent: `tests/test_plan_level_claim.py`
- path-absent: `tests/test_validate_skill.py`

### Task 7: test_run_engine.mjs stops pinning reviewer.md's rules and the role files' register

**Type:** implementation

**Files:**
- Modify: `fleet/tests/test_run_engine.mjs`

**Claim:** After this run `fleet/tests/test_run_engine.mjs` no longer pins the two reviewer.md rule sentences nor asserts the role files free of shouted imperatives — both live in the role-file exam — while it still reports every role file's prose size on stderr. (derived)
Machine: M1. The "two reviewer rules the run-32 evidence bought" block is gone from `fleet/tests/test_run_engine.mjs`: `red-then-green`, `is not a finding` and `roles/reviewer.md` each occur zero times there. M2. The `NEVER|ALWAYS|MUST` assertion is gone from the roles loop while the loop's `role prose size` stderr report remains. M3. `fleet/tests/test_roles_peer.mjs` still carries the `plan-defect:`…`blocking` regex, the `/red-then-green/` regex and the `test(fix)` negative control, and carries the `NEVER|ALWAYS|MUST` regex exactly once over `roleFiles`. M4. The bridged sim `test_fleet_mjs[test_run_engine.mjs]` passes.

**Authorized-by:** #779 (desired state); map #766 decision 6

**Interfaces:**
- Consumes: none
- Produces: nothing

**Context:** The rows this task deletes, from the measured list (BASE `1c97ba44`):

| block | species | what it pins outside its subject | surviving guard |
|---|---|---|---|
| the block headed "The two reviewer rules the run-32 evidence bought" (BASE lines 147–166): two asserts over `fleet/roles/reviewer.md`, one matching `plan-defect:` within 80 chars of `blocking` and `FILES`, one matching `red-then-green` and `is not a finding` | A | `fleet/roles/reviewer.md` | `fleet/tests/test_roles_peer.mjs` (c) M3 `REVIEWER_RULE_PATTERNS` — the same two regexes plus `unverified:`, each also negative-tested against `fix.md`; its own comment says these are the expressions test_run_engine.mjs pins |
| the single line `assert.ok(!/\b(NEVER\|ALWAYS\|MUST)\b/.test(text), ...)` inside the roles loop (BASE line 143). The loop, its `readdirSync(rolesDir)` and its `console.error('role prose size: ' + f + ' = ' + words + ' words')` STAY — CLAUDE.md names that stderr report | A/B | every `fleet/roles/*.md` | `fleet/tests/test_roles_peer.mjs` (g) M7 — the same regex over `readdirSync(rolesDir)`; its comment: "Held here as well as in test_run_engine.mjs" |

At BASE this file holds `red-then-green` twice, `plan-defect:` twice, `is not a finding` once and `roles/reviewer.md` once — all inside the deleted block — and `NEVER|ALWAYS|MUST` once. Two concurrent plans of this sitting also edit this file in other regions; that overlap folds and is deliberate. The sim runs in the suite as `python3 -m pytest 'tests/test_fleet_suite.py::test_fleet_mjs[test_run_engine.mjs]'` with the bridge's PATH stubs.

**Proof:**
- Run: `! grep -q 'red-then-green' fleet/tests/test_run_engine.mjs && ! grep -q 'is not a finding' fleet/tests/test_run_engine.mjs && ! grep -q 'roles/reviewer.md' fleet/tests/test_run_engine.mjs`
- Run: `! grep -q 'NEVER|ALWAYS|MUST' fleet/tests/test_run_engine.mjs && grep -q 'role prose size' fleet/tests/test_run_engine.mjs && grep -q 'readdirSync(rolesDir)' fleet/tests/test_run_engine.mjs`
- Run: `grep -q 'plan-defect:' fleet/tests/test_roles_peer.mjs && grep -q '{0,80}blocking' fleet/tests/test_roles_peer.mjs && grep -q '/red-then-green/' fleet/tests/test_roles_peer.mjs && grep -q 'test(fix)' fleet/tests/test_roles_peer.mjs && grep -c 'NEVER|ALWAYS|MUST' fleet/tests/test_roles_peer.mjs | grep -qx 1 && grep -q 'roleFiles' fleet/tests/test_roles_peer.mjs`
- Run: `python3 -m pytest -q -p no:cacheprovider 'tests/test_fleet_suite.py::test_fleet_mjs[test_run_engine.mjs]'`
- Legs: (a) the first Run: exits non-zero if any of the deleted block's three literals survives in the file [M1]; (b) the second exits non-zero if the shout assertion survives, or if the loop's stderr report or its `readdirSync(rolesDir)` sweep is gone [M2]; (c) the third exits non-zero if the role-file exam lost either reviewer regex or its `fix.md` negative control, or holds the shout regex other than exactly once, or lost its `roleFiles` sweep [M3]; (d) the fourth exits non-zero if the bridged sim fails [M4].

**Stale-if:**
- path-absent: `fleet/tests/test_run_engine.mjs`
- path-absent: `fleet/tests/test_roles_peer.mjs`

### Task 8: test_run_engine_critic_inputs.mjs stops pinning critic.md's slot list

**Type:** implementation

**Files:**
- Modify: `fleet/tests/test_run_engine_critic_inputs.mjs`

**Claim:** After this run `fleet/tests/test_run_engine_critic_inputs.mjs` no longer loops over `Claim` and `Context` to assert critic.md names each slot; the role-file exam holds that pin once. (derived)
Machine: M1. The `for (const slot of ['Claim', 'Context'])` loop and its `slot + ':'` assertion are gone from `fleet/tests/test_run_engine_critic_inputs.mjs`, while its two `Stale-if and Authorized-by are not yours to judge` matches remain. M2. `fleet/tests/test_roles_peer.mjs` still checks `'1. Claim', '2. Context'` and rejects any `3.`–`5.` duty. M3. The bridged sim `test_fleet_mjs[test_run_engine_critic_inputs.mjs]` passes.

**Authorized-by:** #779 (desired state); map #766 decision 6

**Interfaces:**
- Consumes: none
- Produces: nothing

**Context:** The row this task deletes, from the measured list (BASE `1c97ba44`):

| block | species | what it pins outside its subject | surviving guard |
|---|---|---|---|
| the loop `for (const slot of ['Claim', 'Context']) { assert.ok(role.includes(slot + ':'), ...) }` (BASE lines 323–325) and the comment directly above it that explains the two duties. The `assert.match(role, /Stale-if and Authorized-by are not yours to judge/)` two lines above it STAYS — that sentence has no other pin (a KEEP row) | A | `fleet/roles/critic.md` | `fleet/tests/test_roles_peer.mjs` (f) M6 — `1. Claim` and `2. Context` exactly once each, no `3.`–`5.` duty (`assert.ok(!/^[345]\. /m.test(critic), ...)`) |

At BASE the file holds `'Claim', 'Context'` once, `slot + ':'` once, and `Stale-if and Authorized-by are not yours to judge` twice (line 286 over the rendered prompt, line 317 over the role file) — both stay.

**Proof:**
- Run: `! grep -q "'Claim', 'Context'" fleet/tests/test_run_engine_critic_inputs.mjs && ! grep -q "slot + ':'" fleet/tests/test_run_engine_critic_inputs.mjs && test "$(grep -c 'Stale-if and Authorized-by are not yours to judge' fleet/tests/test_run_engine_critic_inputs.mjs)" = 2`
- Run: `grep -q "'1. Claim', '2. Context'" fleet/tests/test_roles_peer.mjs && grep -q '\^\[345\]\\. ' fleet/tests/test_roles_peer.mjs`
- Run: `python3 -m pytest -q -p no:cacheprovider 'tests/test_fleet_suite.py::test_fleet_mjs[test_run_engine_critic_inputs.mjs]'`
- Legs: (a) the first Run: exits non-zero if the slot loop or its assertion survives, or if either `Stale-if and Authorized-by` match is gone [M1]; (b) the second exits non-zero if the role-file exam lost its `1. Claim`/`2. Context` check or its `[345].` negative [M2]; (c) the third exits non-zero if the bridged sim fails [M3].

**Stale-if:**
- path-absent: `fleet/tests/test_run_engine_critic_inputs.mjs`
- path-absent: `fleet/tests/test_roles_peer.mjs`

### Task 9: test_retire.mjs stops sweeping the two documents for ?ref= and re-running the docs pin

**Type:** implementation

**Files:**
- Modify: `fleet/tests/test_retire.mjs`

**Claim:** After this run `fleet/tests/test_retire.mjs` neither sweeps CONTRACT.md and RUNBOOK.md for an evidence-branch `?ref=` read nor spawns `tests/test_docs_agree_with_code.py`; the sweep is that suite's own test and the suite runs it. (derived)
Machine: M1. The `branchRefs` loop over `fleet/CONTRACT.md` and `fleet/RUNBOOK.md` — its `matchAll(/\?ref=` scan and its `startsWith('ultra/evidence-run-')` filter — is gone from `fleet/tests/test_retire.mjs`; no `spawnSync('python3'`, no `'-m', 'pytest'` argv and no mention of `test_docs_agree_with_code` remains in it (one, one and two at BASE); and its two `— skipped` asserts over `twoTagsBullet` and `rollbackSection` remain. M2. `tests/test_docs_agree_with_code.py` still holds `test_no_ref_reads_the_evidence_branch_instead_of_the_evidence_tag` sweeping `refs_named(RUNBOOK) + refs_named(CONTRACT)`, and exists under `tests/`, which `pytest.ini` scopes the suite to. M3. The bridged sim `test_fleet_mjs[test_retire.mjs]` passes.

**Authorized-by:** #779 (desired state); map #766 decision 6

**Interfaces:**
- Consumes: none
- Produces: nothing

**Context:** The rows this task deletes, from the measured list (BASE `1c97ba44`), both under the file's `(l)/M7` section:

| block | species | what it pins outside its subject | surviving guard |
|---|---|---|---|
| the `for (const [name, text] of [['fleet/CONTRACT.md', contractText], ['fleet/RUNBOOK.md', runbookText]])` loop whose `branchRefs` collects every `?ref=` value starting `ultra/evidence-run-` and asserts none (BASE lines 869–875) | A/B | `fleet/CONTRACT.md`, `fleet/RUNBOOK.md` | `test_no_ref_reads_the_evidence_branch_instead_of_the_evidence_tag` in `tests/test_docs_agree_with_code.py` — the same `?ref=` regex over the same two files |
| the block `spawnSync('python3', ['-m', 'pytest', 'tests/test_docs_agree_with_code.py', '-q', '-p', 'no:cacheprovider'], ...)` asserting status 0 (BASE lines 877–883), and the tail comment near BASE line 1558 that cites that spawn as "The third `Run:`" | B | re-runs a sibling suite | the suite runs `tests/test_docs_agree_with_code.py` |

The two `— skipped` asserts directly above the deleted loop — `twoTagsBullet(contractText).includes('— skipped')` and `rollbackSection(runbookText).includes('— skipped')` — are KEEP rows and stay, as do `contractText`/`runbookText` (they feed those asserts). The file's other `?ref=` mentions (BASE lines 187 and 376) are the sweep's own `gh api` read and a comment, not this pin — do not touch them. At BASE the file holds `branchRefs` three times, `matchAll(/\?ref=` once and `startsWith('ultra/evidence-run-')` once (all in the deleted loop), `spawnSync('python3'` once and `'-m', 'pytest'` once (the deleted spawn), and `test_docs_agree_with_code` twice (the spawn and the tail comment, both deleted).

**Proof:**
- Run: `! grep -q 'branchRefs' fleet/tests/test_retire.mjs && ! grep -q 'matchAll(/\\?ref=' fleet/tests/test_retire.mjs && ! grep -q "startsWith('ultra/evidence-run-')" fleet/tests/test_retire.mjs && ! grep -q "spawnSync('python3'" fleet/tests/test_retire.mjs && ! grep -q "'-m', 'pytest'" fleet/tests/test_retire.mjs && ! grep -q 'test_docs_agree_with_code' fleet/tests/test_retire.mjs && grep -q "twoTagsBullet(contractText).includes('— skipped')" fleet/tests/test_retire.mjs && grep -q "rollbackSection(runbookText).includes('— skipped')" fleet/tests/test_retire.mjs`
- Run: `grep -q 'def test_no_ref_reads_the_evidence_branch_instead_of_the_evidence_tag' tests/test_docs_agree_with_code.py && grep -q 'refs_named(RUNBOOK) + refs_named(CONTRACT)' tests/test_docs_agree_with_code.py && test -f tests/test_docs_agree_with_code.py && grep -q 'testpaths = tests' pytest.ini`
- Run: `python3 -m pytest -q -p no:cacheprovider 'tests/test_fleet_suite.py::test_fleet_mjs[test_retire.mjs]'`
- Legs: (a) the first Run: exits non-zero if the `branchRefs` loop, its `?ref=` scan or its evidence-branch filter survives, if any `spawnSync('python3'` or `'-m', 'pytest'` spawn survives, if `test_docs_agree_with_code` is still named anywhere in the file (the spawn or the tail comment that cites it), or if either `— skipped` assert is gone [M1]; (b) the second exits non-zero if the docs suite lost the `?ref=` test or its two-document sweep, or is not under `tests/`, or `pytest.ini` no longer scopes the suite there [M2]; (c) the third exits non-zero if the bridged sim fails [M3].

**Stale-if:**
- path-absent: `fleet/tests/test_retire.mjs`
- path-absent: `tests/test_docs_agree_with_code.py`

### Task 10: Four fleet sims stop re-running sibling suites and sims

**Type:** implementation

**Files:**
- Modify: `fleet/tests/test_publish_fold.mjs`
- Modify: `fleet/tests/test_run_engine_suite_passes.mjs`
- Modify: `fleet/tests/test_sandbox_boot.mjs`
- Modify: `fleet/tests/test_run_main.mjs`

**Claim:** After this run none of `test_publish_fold.mjs`, `test_run_engine_suite_passes.mjs`, `test_sandbox_boot.mjs` and `test_run_main.mjs` spawns `tests/test_docs_agree_with_code.py`, `tests/test_fleet_events.py` or the integrated-clean sim; each of those runs once, as the suite's own member. (derived)
Machine: M1. `test_docs_agree_with_code` occurs zero times in each of `fleet/tests/test_publish_fold.mjs`, `fleet/tests/test_run_engine_suite_passes.mjs` and `fleet/tests/test_sandbox_boot.mjs`, and `test_run_engine_integrated_clean` occurs zero times in `fleet/tests/test_run_engine_suite_passes.mjs`, and `test_fleet_events` occurs zero times in `fleet/tests/test_run_main.mjs`. M2. `test_sandbox_boot.mjs` still runs its two `sed -n ... fleet/CONTRACT.md` greps for `engine:phase`, and `test_run_main.mjs` still asserts the report-format line naming `deferred:manual` and `verbatim`. M3. `tests/test_docs_agree_with_code.py` and `tests/test_fleet_events.py` exist under `tests/`, which `pytest.ini` scopes the suite to, and the bridge collects `test_fleet_mjs[test_run_engine_integrated_clean.mjs]`. M4. The four bridged sims pass.

**Authorized-by:** #779 (desired state); map #766 decision 6

**Interfaces:**
- Consumes: none
- Produces: nothing

**Context:** The rows this task deletes, from the measured list (BASE `1c97ba44`) — every one species B, a re-run of a sibling the suite already collects:

| file | block | re-runs | surviving guard |
|---|---|---|---|
| `fleet/tests/test_publish_fold.mjs` | leg (h) [M4]: `const pin = runIn('python3', ['-m', 'pytest', '-q', 'tests/test_docs_agree_with_code.py'], REPO)` and its `assert.equal(pin.code, 0, ...)` (BASE lines 1673–1678, with the comment above them) | `tests/test_docs_agree_with_code.py` | the suite runs it |
| `fleet/tests/test_run_engine_suite_passes.mjs` | (f)/M6: `const cleanSim = spawnSync('node', ['fleet/tests/test_run_engine_integrated_clean.mjs'], ...)` and its sentinel assert (BASE lines 290–295) | the sibling sim | `test_fleet_mjs[test_run_engine_integrated_clean.mjs]` in `tests/test_fleet_suite.py` |
| `fleet/tests/test_run_engine_suite_passes.mjs` | (f)/M6: `const docPin = spawnSync('python3', ['-m', 'pytest', '-q', 'tests/test_docs_agree_with_code.py'], ...)` and its status assert (BASE lines 297–301), with the comment above both spawns | `tests/test_docs_agree_with_code.py` | the suite runs it |
| `fleet/tests/test_sandbox_boot.mjs` | #723 (h) [M5]: the third `runs[]` entry `'python3 -m pytest tests/test_docs_agree_with_code.py -q -p no:cacheprovider'` and its comment (BASE line 1055–1056). The two `sed -n ... fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'engine:phase'` entries STAY — KEEP rows, the only pins of those bullets | `tests/test_docs_agree_with_code.py` | the suite runs it |
| `fleet/tests/test_run_main.mjs` | leg (f) [M4]: `const events = sh('python3 -m pytest -q tests/test_fleet_events.py')` and its status assert (BASE lines 929–932). The `rfGrep` / `rfLines` pin on `report-format.md` naming `deferred:manual` and `verbatim` directly above it STAYS — a KEEP row | `tests/test_fleet_events.py` | the suite runs it |

At BASE: `test_docs_agree_with_code` occurs twice in `test_publish_fold.mjs`, twice in `test_run_engine_suite_passes.mjs` and once in `test_sandbox_boot.mjs` — every occurrence inside a deleted block; `test_run_engine_integrated_clean` occurs twice in `test_run_engine_suite_passes.mjs`, both in the deleted block; `test_fleet_events` occurs twice in `test_run_main.mjs`, both in the deleted block; `engine:phase'` occurs twice in `test_sandbox_boot.mjs` (the two kept `sed` entries) and `verbatim/.test` twice in `test_run_main.mjs` (the kept pin). Each sim runs in the suite as `python3 -m pytest 'tests/test_fleet_suite.py::test_fleet_mjs[<file>]'` with the bridge's PATH stubs; `test_sandbox_boot.mjs` is one of the slow-first sims.

**Proof:**
- Run: `! grep -q 'test_docs_agree_with_code' fleet/tests/test_publish_fold.mjs && ! grep -q 'test_docs_agree_with_code' fleet/tests/test_run_engine_suite_passes.mjs && ! grep -q 'test_docs_agree_with_code' fleet/tests/test_sandbox_boot.mjs && ! grep -q 'test_run_engine_integrated_clean' fleet/tests/test_run_engine_suite_passes.mjs && ! grep -q 'test_fleet_events' fleet/tests/test_run_main.mjs`
- Run: `test "$(grep -c "grep -q 'engine:phase'" fleet/tests/test_sandbox_boot.mjs)" = 2 && grep -q 'verbatim/.test(l)' fleet/tests/test_run_main.mjs`
- Run: `test -f tests/test_docs_agree_with_code.py && test -f tests/test_fleet_events.py && grep -q 'testpaths = tests' pytest.ini && python3 -m pytest --co -q -p no:cacheprovider tests/test_fleet_suite.py | grep -q 'test_fleet_mjs\[test_run_engine_integrated_clean.mjs\]'`
- Run: `python3 -m pytest -q -p no:cacheprovider 'tests/test_fleet_suite.py::test_fleet_mjs[test_publish_fold.mjs]' 'tests/test_fleet_suite.py::test_fleet_mjs[test_run_engine_suite_passes.mjs]' 'tests/test_fleet_suite.py::test_fleet_mjs[test_sandbox_boot.mjs]' 'tests/test_fleet_suite.py::test_fleet_mjs[test_run_main.mjs]'`
- Legs: (a) the first Run: exits non-zero if `test_docs_agree_with_code` survives in `test_publish_fold.mjs` [M1]; (b) it exits non-zero if `test_docs_agree_with_code` or `test_run_engine_integrated_clean` survives in `test_run_engine_suite_passes.mjs` [M1]; (c) it exits non-zero if `test_docs_agree_with_code` survives in `test_sandbox_boot.mjs` [M1]; (d) it exits non-zero if `test_fleet_events` survives in `test_run_main.mjs` [M1]; (e) the second exits non-zero if `test_sandbox_boot.mjs` holds other than exactly two `engine:phase` greps or `test_run_main.mjs` lost its `verbatim` line test [M2]; (f) the third exits non-zero if either re-run pytest target is missing from `tests/`, `pytest.ini` no longer scopes the suite there, or the bridge no longer collects the integrated-clean sim [M3]; (g) the fourth exits non-zero if any of the four bridged sims fails [M4].

**Stale-if:**
- path-absent: `fleet/tests/test_run_engine_suite_passes.mjs`
- path-absent: `fleet/tests/test_run_engine_integrated_clean.mjs`

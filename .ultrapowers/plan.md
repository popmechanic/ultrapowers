# The ceremony cut — the compiler shrinks, plans compile the same

**Grammar:** claims-v1

**Claim:** do: run compile_plan.py --check on a plan with no Acceptance line. see: PLAN OK and nothing else — no ADVISORY lines exist any more — and every fixture plan compiles to the same waves and edges it did before, with a third of the compiler gone. (elicited)

**Goal:** Decisions 5 and 6 of the #871 grilling (2026-09-10) plus #875 step 2: the `**Acceptance:**` line leaves the plan grammar, the compiler's advisory tier is deleted, `run_acceptance.sh` and the gate's own suite pass go (the gate reads the run's recorded suite result), the dead compiled-output keys go, and the 0.1.0 freeze on the verification periphery ends in the documents that taught it. The 299 ms timer pin of #892 is deleted with it.

**Tech Stack:** Python 3 (`compile_plan.py`, `ultra_gate.py`, `ultra_run.py`, pytest), Node 24 ESM (`fleet/*.mjs`, `fleet/tests/*.mjs` sims), bash (`fleet/sandbox-boot.sh`)

**Spec:** `docs/superpowers/observations/2026-09-10-ceremony-cut-audit.md` (the removal audit; untracked — every line number a worker needs is in its task's Context) and issue #871's decision table.

**Parallelization rationale:** one wave, six wide. Every task owns a distinct seam — the plan grammar (1), the advisory tier (2), the gate's suite pass (3), the engine's readers of the acceptance record (4), the documents (5), the timer pin (6) — and no task consumes another's runtime behaviour. Tasks 1 and 2 both edit `compile_plan.py` in disjoint regions; that is text overlap and folds. Task 2 lists 31 files because most of them are whole-file deletions, not edits — the width warning is read and accepted. No chain.

## Global Constraints

- A deletion is whole: no helper, regex, constant, fixture, stub or test survives with no reader once its only caller is gone, and no reader is left importing a name that is gone.
- Every document sentence that taught the deleted thing is rewritten or removed, never left describing machinery that no longer exists.
- Check: python3 -c "import sys; sys.path.insert(0, 'skills/ultrawrite/scripts'); import pin_base_facts"
- Check: python3 skills/ultrapowers/scripts/compile_plan.py --check evals/fixtures/claims/plan.md | head -1 | grep -q 'PLAN OK'

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The Acceptance line leaves the grammar

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `tests/test_compile_plan.py`
- Modify: `tests/test_plan_check.py`
- Modify: `tests/test_webapp_fixture.py`
- Modify: `tests/test_compile_plan_claims.py`
- Test: `tests/test_compile_plan_acceptance_line.py`

**Claim:** A plan with no Acceptance line compiles, and a plan that still carries one compiles the same way — the line is prose the compiler never reads. (derived)
Machine: M1. For each of a claims-v1 plan with no `**Acceptance:**` line, one with `**Acceptance:** suite — x`, one with `**Acceptance:** waived — x`, and one with `**Acceptance:** sealed deadbeef (sha256:<64 zeros>)`: `compile_plan.py --check <plan>` exits 0 and its first stdout line is `PLAN OK`, and the four plans' plain-compile `waves` are equal. M2. The plain-compile JSON of `evals/fixtures/claims/plan.md` carries none of the keys `acceptance`, `gates`, `post_merge_runbook`, `allHeuristic`, and still carries each of `waves`, `launch_waves`, `dag_edges`, `tasks`, `waveLabels`, `globalConstraints`, `constraintChecks`, `marker_conflicts`, `mode`, `degrade_reason`. M3. The source of `compile_plan.py` contains none of the identifiers `parse_acceptance`, `ACCEPT_SEALED`, `ACCEPT_WAIVED`, `ACCEPT_SUITE`, `ACCEPTANCE_MISSING_ERROR`, `allHeuristic`, `post_merge_runbook`, and no line mentions `sealed-acceptance-design`.

**Authorized-by:** #871 decision 5; #875 step 2

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** At BASE the compiler refuses a marked plan without the line (`ACCEPTANCE_MISSING_ERROR`, defined at `compile_plan.py:1852-1856`, raised inside the marked-plan violation loop at `:1937-1941` and at `main()` `:4326-4327`). The three regexes are `ACCEPT_SEALED`/`ACCEPT_WAIVED`/`ACCEPT_SUITE` at `:1542-1546`, their only caller `parse_acceptance()` at `:1549-1571`, the read at `:4318`, the `marker_conflicts` note for a missing line on an unmarked plan at `:4330`, and the `"acceptance": acceptance` entries in `result`, `launch_payload` and `args_payload` at `:4449`, `:4476`, `:4494`. Two comments cite `docs/superpowers/specs/2026-06-12-sealed-acceptance-design.md` (`:1556`, `:1855`). Delete all of it. A stray `**Acceptance:**` line in a plan is preamble prose after this task: nothing matches it, nothing refuses it, nothing notes it. The three dead output keys go in the same pass: `gates` (`:4440`), `post_merge_runbook` (`:4442`), `allHeuristic` (`:4448` and its banner note at `:4332-4338`) — zero readers under `fleet/` or `skills/*/scripts/`. What STAYS: the four-way task `Type` (`implementation`/`gate`/`release`/`manual`, `classify()` `:1518-1535`, `TYPES` `:143`) and `_files_grammar_exempt` (`:1765-1775`, load-bearing for gate/manual/release tasks), the `heuristic` per-task field at `:4299`, and `GATE_SECTION_HEAD` (`:216`), which treats a `## Acceptance` heading as a section boundary — that is grammar, not disposition. Downstream readers are tolerant and are other tasks' work: `ultra_run.py:573` reads the key with `.get(...) or {}`; `run-engine.mjs:998` reads `args.acceptance` and yields `null` when absent; `ultra_gate.py:116` reads it with `.get`. Tests to edit: `tests/test_compile_plan.py` cases at `:1116`, `:1123`, `:1130`, `:1136`, `:1173`, `:1180`, `:1185` (the line's parse and refusal) and `:1869` (`allHeuristic`); `tests/test_plan_check.py:237` (`test_check_refuses_marked_plan_with_no_acceptance_line`); `tests/test_webapp_fixture.py:25` (`result["acceptance"]["mode"]`); the two dict-shape fixtures in `tests/test_compile_plan_claims.py` (lines 382 and 396) that spell `allHeuristic`. Roughly 30 other test files carry `**Acceptance:** suite — …` inside fixture plan text; leave every one of them — the line is ignored, so they stay green untouched. The exam's fixture plans are written by the exam under its own tmp_path with three tasks in the claims-v1 shape (copy `evals/fixtures/claims/plan.md` and vary only the Acceptance line).

**Proof:**
- Test: `tests/test_compile_plan_acceptance_line.py`
- Guard: `tests/test_compile_plan_acceptance_line.py`
- Legs: (a) for each of the four plan variants — no line, `suite`, `waived`, `sealed` — `--check` exits 0 with `PLAN OK` as its first line, and the plain-compile `waves` of the four are pairwise equal; a variant that exits non-zero or whose `waves` differ names itself [M1]; (b) for each of `acceptance`, `gates`, `post_merge_runbook`, `allHeuristic`: the key is absent from the claims fixture's compiled JSON, the offending key named on failure [M2]; (c) for each of the ten surviving keys: present [M2]; (d) for each of the seven identifiers and the spec filename: `grep -c` over `compile_plan.py` is 0, the surviving identifier named on failure [M3].
- Run: python3 skills/ultrapowers/scripts/compile_plan.py evals/fixtures/claims/plan.md | python3 -c "import json,sys; d=json.load(sys.stdin); bad=[k for k in ('acceptance','gates','post_merge_runbook','allHeuristic') if k in d]; print('dead keys present:', bad); sys.exit(1 if bad else 0)"

**Stale-if:**
- path-absent: `skills/ultrapowers/scripts/compile_plan.py`
- path-absent: `evals/fixtures/claims/plan.md`

### Task 2: The advisory tier is deleted

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Create: `evals/compile_census.py`
- Modify: `evals/check_renders_ab.py`
- Modify: `evals/frontier/README.md`
- Modify: `tests/test_compile_plan_pinned_elsewhere.py`
- Modify: `tests/test_check_renders.py`
- Modify: `tests/test_compile_plan_base_sha_in_suite.py`
- Modify: `tests/test_compile_plan_wide_files.py`
- Modify: `tests/test_compile_plan_sha_unguarded.py`
- Modify: `tests/test_compile_plan_proof_species.py`
- Modify: `tests/test_compile_plan_one_sided.py`
- Modify: `tests/test_compile_plan_prose_check.py`
- Modify: `tests/test_compile_plan_engine_self_change.py`
- Modify: `tests/test_compile_plan_integration_hostile.py`
- Modify: `tests/test_compile_plan_check_cost.py`
- Modify: `tests/test_compile_plan_engine_self_change_impl.py`
- Modify: `tests/test_directory_quantifier_advisory.py`
- Modify: `tests/test_check_renders_pin_is_tree_independent.py`
- Modify: `tests/test_compile_plan_base_message.py`
- Modify: `tests/test_compile_plan_claims_edges.py`
- Modify: `tests/test_compile_plan_base_tree.py`
- Modify: `tests/test_compile_plan_guard.py`
- Modify: `tests/test_compile_plan_clause_citation.py`
- Modify: `tests/test_compile_plan_proof_tests.py`
- Modify: `tests/test_compile_plan_proof_runs.py`
- Modify: `tests/test_compile_plan_check_constraints.py`
- Modify: `tests/test_compile_plan.py`
- Modify: `tests/test_plan_level_claim.py`
- Modify: `tests/test_compile_plan_claims.py`
- Modify: `tests/test_compile_plan_exam_command.py`
- Modify: `tests/test_spec_review_brief_selfcheck.py`
- Test: `tests/test_compile_plan_check_output.py`

**Claim:** Running the checker on a plan prints PLAN OK and nothing else; there are no advisory lines any more, and every fixture plan compiles to the same waves and edges it did before. (derived)
Machine: M1. `compile_plan.py --check evals/fixtures/claims/plan.md` exits 0 and its whole stdout is exactly the line `PLAN OK`. M2. No line of `compile_plan.py` contains the string `ADVISORY`, and `compile_plan.py --check --renders <plan>` and `compile_plan.py --check --exclude x <plan>` each exit 2 with `unrecognized arguments` on stderr. M3. `import pin_base_facts` (with `skills/ultrawrite/scripts` on `sys.path`) succeeds, and `compile_plan.py` still defines each of `_path_referent`, `_referent_scan_lines`, `BaseTree`, `default_base`, `match_head`, `plan_grammar`, `split_tasks`, `_fence_aware_lines`, `_git`. M4. For each of the fifteen files `tests/test_compile_plan_pinned_elsewhere.py`, `tests/test_check_renders.py`, `tests/test_compile_plan_base_sha_in_suite.py`, `tests/test_compile_plan_wide_files.py`, `tests/test_compile_plan_sha_unguarded.py`, `tests/test_compile_plan_proof_species.py`, `tests/test_compile_plan_one_sided.py`, `tests/test_compile_plan_prose_check.py`, `tests/test_compile_plan_engine_self_change.py`, `tests/test_compile_plan_integration_hostile.py`, `tests/test_compile_plan_check_cost.py`, `tests/test_compile_plan_engine_self_change_impl.py`, `tests/test_directory_quantifier_advisory.py`, `tests/test_check_renders_pin_is_tree_independent.py`, `tests/test_compile_plan_base_message.py`, and for `evals/check_renders_ab.py`: the path is absent. M5. `evals/compile_census.py <compiler-path>` prints one line per path matching `evals/fixtures/*/plan.md`, sorted by directory name (thirteen at BASE: `bun-greenfield`, `chained`, `claims`, `contend`, `contend-big`, `contend-prod`, `contend-wide`, `degrade`, `flawed`, `flawed-routing`, `mixed`, `webapp`, `wide`), each line `<directory name> <64 hex>` where the hex is the sha256 of `json.dumps([waves, dag_edges, launch_waves], sort_keys=True)` over that fixture's plain compile with the compiler at `<compiler-path>`; it exits 1 with the fixture's directory name on stderr when that compile exits non-zero, and exits 1 the same way when the compile's JSON lacks any of the three keys; and the lines it prints for the compiler at BASE equal the lines it prints for this tree's compiler. M6. `compile_plan.py` is between 2000 and 3300 lines.

**Authorized-by:** #871 decision 6; #875 step 2; run-87's reading that advisories are read by nobody

**Interfaces:**
- Consumes: none
- Produces: `evals/compile_census.py`

**Context:** Advisories are stdout-only under `--check` (`main()` `:4174-4183` is the only call site of both channels); no compiled-output key carries them, and no driver reads one — `ultra_run.py`'s `compile_argv` (`:179-194`) never passes `--check`, `launch.mjs` never runs the compiler, `sandbox-boot.sh` has no compiler dependency. Two channels go. Channel A, `ADVISORY grammar:` — `collect_advisories` `:2134` → `claims_grammar_advisories` `:1972`, with the ordering-phrase advisory (`:1991-1995`, `ORDERING_PHRASE_RE` `:1953`, `_slot_prose` `:1960-1964`), the Consumes-without-Produces advisory (`:2010-2016`, `_INTERFACE_LEAD_RE` `:1957`, `_is_placeholder_interface` `:1966-1970`), the Context word count (`:2017-2019`), the unnumbered-Machine and falsifying-leg and enumerated-row advisories (`:714-733`, `UNIVERSAL_RE` `:574`, `NEGATION_RE` `:576`, `FALSIFIER_RE` `:579`, `ENUMERATED_RE` `:582`), the directory-quantifier advisory (`:744-806` whole block), and the same-file pair advisories (`:2058-2082`, `_reaches` `:2089-2105`, `_pair_ordering` `:2107-2132`). Channel B, the ten `ADVISORY_RENDERS` (`:2588`; `render_advisories` `:2838-2889`): `blast-radius` `:2891-2938`, `referent` `:2940-3079`, `unverifiable-from-sandbox` `:3079-3112`, `process-rule` `:3113-3176`, `prose-check` `:3177-3251`, `proof-species` and its thirteen sub-species `:3252-3824`, `check-cost` `:3825-3856`, `sha-unguarded` `:3857-3932`, `base-sha-in-suite` `:3933-4026`, `guard` `:4027-4077`; the git-grep helpers that only feed renders (`CODE_EXTS` `:2585`, `_exclude_pathspecs` `:2613`, `_strip_rev` `:2631`, `_rev_args` `:2625`, `_git_tracked` `:2639`, `_code_pathspecs` `:2649`, `_git_word_files` `:2653`, `_git_literal_in_code` `:2661`, `_git_substring_files` `:2667`, and the `BaseTree` methods `tracked`/`word_files`/`literal_in_code`/`substring_files` `:2761-2774`); the `--renders` and `--exclude` flags (`:4112-4117`, `:4132-4136`) and their guard exits (`:4145-4154`). What STAYS, because it has a reader outside the tier: `machine_restatement` `:586`, `parse_machine_clauses` `:597`, `parse_proof_legs` `:619`, `_short` `:675` (all feed `clause_citation_violations` `:680`, a refusal); `_interface_token` `:1708` and `PLACEHOLDER_TOKENS` `:1672` (the interface-edge tier); `BaseTree` itself with `from_flag`, `_peel`, `_show`, `_blob_mode`, `is_binary`, `_git`, `_git_run` (`build_edges` `:2482` orders non-text same-file pairs through `is_binary`) and therefore the `--base` flag (`:4118-4131`, reduced to that one use); `_path_referent` `:2966-2984`, `_referent_scan_lines` `:3004-3018`, `_REFERENT_EXTS` `:2948`, `_MIME_RE` `:2951`, `_FILES_BULLET_RE` `:2962` — `skills/ultrawrite/scripts/pin_base_facts.py:43-56` imports the first two; `proofGuards` (`:4283`) and `GUARD_LINE` (`:78`), a plain data key the engine reads (only the `guard` render line goes). The frozen-sha byte pin: `tests/test_compile_plan_proof_runs.py:404` (`test_every_run_less_fixture_plan_checks_byte_identically_to_base`, with `base_compiler` at `:356` and `test_the_base_blob_is_not_the_current_compiler` at `:420`) compares whole `--check` stdout against the compiler blob at sha `0a3559a`; deleting Channel A changes that stdout for every fixture, so delete the pin, its fixture, and its re-exporters — four sit in files this task deletes whole, and two in `tests/test_compile_plan_check_constraints.py` (`:52-56` and `:413-417`). Mixed files: `test_compile_plan_claims_edges.py` (~23 of 31 cases: the same-file-pair advisories and the `render_advisories` re-parse pin at `:636-646`), `test_compile_plan_base_tree.py` (~12 of 18: the grep methods; `is_binary`, `from_flag` and sha-resolution cases stay), `test_compile_plan_guard.py` (`:380`, `:393`, `:405`, `:426`, `:470`, `:481` are the `ADVISORY guard:` line; `:322-363` parse `proofGuards` and stay), `test_compile_plan_clause_citation.py` (`:99`, `:185`, `:198`, `:210`, `:223`; the refusal cases `:124-165` stay), `test_compile_plan_proof_tests.py` (~2 of 9, frozen `--check --renders` stdout), and one case each in `test_compile_plan.py`, `test_plan_level_claim.py`, `test_compile_plan_claims.py`, `test_compile_plan_exam_command.py`, `test_spec_review_brief_selfcheck.py`. `tests/test_harvest_fleet_runs*.py`, `test_fleet_slice.py`, `test_fleet_events.py`, `test_readers.py`, `test_audit_*.py`, `test_ultralearn_*.py` use "advisory" in the referee's sense (`run-engine.mjs:1929,2041,2253`, `fitness.mjs`) — untouched. `evals/check_renders_ab.py` (329 lines) exists only to A/B two renders and already cites a deleted test file at `:69,72`; delete it and drop its one mention at `evals/frontier/README.md:8`. `evals/fixtures/*` are the general A/B corpus of `ab_runner.py`/`ab_lib.py`: keep every fixture. The census: `evals/compile_census.py <path-to-compile_plan.py>` compiles every `evals/fixtures/*/plan.md` (thirteen carry a `plan.md`; `jsdeps` does not) with the compiler at that path and prints one line per fixture, `<fixture-dir-name> <sha256 of json.dumps([waves, dag_edges, launch_waves], sort_keys=True)>`, sorted by name, exit 0. The compiler resolves `PLUGIN_ROOT = Path(__file__).resolve().parents[3]` at import, so a copy of the BASE blob must sit at least four directories deep: the census script copies the file it is given into `<mktemp>/a/b/c/compile_plan.py` before running it, exactly as `tests/test_compile_plan_proof_runs.py:356-390`'s `base_compiler` fixture does. The compiler imports only the standard library plus `fnmatch`, so a copy at that depth runs with no sibling. Line count at BASE: 4515; the audit's deletion spans sum to about 1710 lines. The thirteen fixture names are the sorted directory names under `evals/fixtures/` that carry a `plan.md` at BASE (`jsdeps` carries only `project/`).

**Proof:**
- Test: `tests/test_compile_plan_check_output.py`
- Guard: `tests/test_compile_plan_check_output.py`
- Legs: (a) `--check` on the claims fixture exits 0 and its stdout, bytes, equals `PLAN OK` plus one newline; any extra line is printed on failure [M1]; (b) the lines of `compile_plan.py` containing `ADVISORY` are listed and that list is empty; `--renders` and `--exclude` each exit 2 with `unrecognized arguments` in stderr [M2]; (c) `pin_base_facts` imports, and for each of the nine named symbols `hasattr(compile_plan, name)` holds, the missing name reported [M3]; (d) for each of the fifteen test files and `evals/check_renders_ab.py`: `Path.exists()` is false, the survivor named [M4]; (e) `wc -l` of `compile_plan.py` is at least 2000 and at most 3300 [M6]; (f) the exam globs `evals/fixtures/*/plan.md` itself and the census's first fields equal that glob's sorted directory names, one line each, in order; for every one of those fixtures the exam recomputes the digest from its own plain compile with this tree's compiler and it equals the census's second field, which also matches `^[0-9a-f]{64}$`; a census run on a stub compiler that exits 1 (a two-line script the exam writes) exits 1 with the first fixture's directory name on stderr; and a census run on a stub compiler that prints `{"waves": []}` and exits 0 (a second stub the exam writes, lacking `dag_edges` and `launch_waves`) exits 1 with the first fixture's directory name on stderr — a listing that disagrees with the glob, a malformed or wrong digest on any fixture, or a stub that yields exit 0 fails the leg [M5]; (g) the census Run: below prints the BASE compiler's thirteen digests and this tree's and `diff` exits 0 with both listings thirteen lines long — a fixture whose `waves`, `dag_edges` or `launch_waves` changed names itself as a differing line [M5].
- Run: d=$(mktemp -d)/a/b/c && mkdir -p "$d" && git show $ULTRA_BASE:skills/ultrapowers/scripts/compile_plan.py > "$d/compile_plan.py" && python3 evals/compile_census.py "$d/compile_plan.py" > "$d/base.txt" && python3 evals/compile_census.py skills/ultrapowers/scripts/compile_plan.py > "$d/new.txt" && test "$(wc -l < "$d/base.txt")" -eq 13 && test "$(wc -l < "$d/new.txt")" -eq 13 && diff "$d/base.txt" "$d/new.txt"

**Stale-if:**
- path-absent: `skills/ultrapowers/scripts/compile_plan.py`
- path-absent: `skills/ultrawrite/scripts/pin_base_facts.py`

### Task 3: The gate reads the recorded suite result

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrapowers/scripts/ultra_gate.py`
- Modify: `skills/ultrapowers/scripts/run_acceptance.sh`
- Modify: `skills/ultrapowers/scripts/ultra_run.py`
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `tests/test_ultra_gate.py`
- Modify: `tests/test_run_acceptance.py`
- Modify: `tests/test_ultra_run.py`
- Test: `tests/test_ultra_gate_record.py`

**Claim:** The gate no longer runs the suite itself: it reads the suite result the run already recorded, and passes or blocks on that. (derived)
Machine: M1. `ultra_gate.py --result <report>` with a report whose `tests.passed` is `true` and a PASS `gate_check` writes a gate receipt with `verdict` `PASS` and `suite` equal to `{"passed": true, "output": <the report's tests.output>}`, and exits 0. M2. The same call with `tests.passed` `false` writes `verdict` `BLOCKED`, `suite.passed` `false`, and exits 1. M3. The gate receipt carries no `acceptance` key, and `ultra_gate.py` contains none of `run_acceptance`, `--suite-gate`, `sealed`, `waived`. M4. `skills/ultrapowers/scripts/run_acceptance.sh` and `tests/test_run_acceptance.py` are absent, and `run_acceptance` occurs in no file under `skills/`. M5. `ultra_run.py`'s compile stage summary is exactly `<N> task(s) in <M> wave(s)` with no `acceptance:` clause.

**Authorized-by:** #871 decisions 3 and 5

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `gate_check.py` never runs the suite (it is git-vs-report checks and stays whole). The gate's suite pass is `ultra_gate.py:111-145`: the disposition block reads `compile.acceptance.mode` from `receipt.json`, and its `else` arm at `:130-144` shells `run_acceptance.sh --suite-gate --branch … --run <testCmd> --base … [--bootstrap …]` and folds the exit into `acc_pass` at `:148`. `run_acceptance.sh` (186 lines) has exactly that one live caller; its `run_js_sims` leg (`:80-135`) is already dead (CLAUDE.md says so). Replace the whole block: `report` is already in scope (`:91`, unwrapped and saved at `:96-97`); read `report.get("tests") or {}` — the engine writes `tests` as `{command, passed, output}` (`run-engine.mjs:3089`; `report-format.md`'s `tests` row) — set `receipt["suite"] = {"passed": bool(tests.get("passed")), "output": tests.get("output", "")}` and `acc_pass = receipt["suite"]["passed"]`; a report with no `tests` key blocks with a message naming it, the same fail-closed shape the missing-`testCmd` branch had. Remove `sealed` and `waived` arms entirely. Delete `run_acceptance.sh` and `tests/test_run_acceptance.py` (17 cases, all end-to-end against the script). `tests/test_ultra_gate.py` builds a throwaway repo with a stubbed `run_acceptance.sh` (`make_repo` `:28-70`) and pins the dispatch at `:150` (sealed blocked), `:170` (suite dispatch), `:186` (failed forces blocked), `:314`, `:323`, `:331`, `:340` (argv from the receipt, #96); rewrite `make_repo` to write a report with a `tests` block and drop the stub, delete those seven cases, keep the envelope-unwrap, gate_check-propagation, approve-mode and checkout-position cases. `ultra_run.py:573-575` builds the summary `"%d task(s) in %d wave(s); acceptance: %s"`; drop the clause and the `mode` read; `tests/test_ultra_run.py:489` asserts the mode is in that detail — delete that assertion. `skills/ultrapowers/SKILL.md:209` lists `scripts/run_acceptance.sh` in the scripts inventory; `validate_skill.py` resolves every `scripts/<x>` reference against the skill directory, so the name must leave that line. The `MERGE`/PR card in `sandbox-boot.sh` prints the gate receipt as a JSON fence verbatim; a `suite` key there instead of `acceptance` needs no boot change.

**Proof:**
- Test: `tests/test_ultra_gate_record.py`
- Guard: `tests/test_ultra_gate_record.py`
- Legs: (a) a report with `tests.passed` true and a passing `gate_check` yields a receipt with `verdict` `PASS`, `suite.passed` true and `suite.output` equal to the report's `tests.output`, exit 0 [M1]; (b) the same with `tests.passed` false yields `BLOCKED`, `suite.passed` false, exit 1 [M2]; (c) a report with no `tests` key yields `BLOCKED` with a detail naming `tests` [M2]; (d) `acceptance` is not a key of either receipt, and for each of `run_acceptance`, `--suite-gate`, `sealed`, `waived`: zero occurrences in `ultra_gate.py`, the survivor named [M3]; (e) for each of `skills/ultrapowers/scripts/run_acceptance.sh` and `tests/test_run_acceptance.py`: absent; and a recursive grep of `skills/` for `run_acceptance` lists no file [M4]; (f) the compile stage's `detail` for a two-task plan matches `^\d+ task\(s\) in \d+ wave\(s\)$` [M5].
- Run: python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers

**Stale-if:**
- path-absent: `skills/ultrapowers/scripts/ultra_gate.py`
- path-absent: `skills/ultrapowers/scripts/gate_check.py`

### Task 4: The engine and the sandbox forget the acceptance record

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Modify: `fleet/run-main.mjs`
- Modify: `fleet/sandbox-boot.sh`
- Modify: `fleet/failing-block.mjs`
- Modify: `fleet/referee.mjs`
- Modify: `fleet/launch.mjs`
- Modify: `fleet/CONTRACT.md`
- Modify: `fleet/tests/test_run_engine.mjs`
- Modify: `fleet/tests/test_run_main.mjs`
- Modify: `fleet/tests/test_sandbox_boot_approval_evidence.mjs`
- Modify: `fleet/tests/test_sandbox_boot_parked_error.mjs`
- Test: `fleet/tests/test_run_record_keys.mjs`

**Claim:** The run's report and receipt carry no acceptance record: the engine writes none, the driver tees no acceptance log, and the sandbox looks for none. (derived)
Machine: M1. The engine's `report.json` for a one-task run has no `acceptance` key and still has `tests` with `command`, `passed`, `output`. M2. `run-main.mjs` exports neither `acceptanceWrap` nor `acceptanceLogPath`, writes no `acceptance-capture` stage, and leaves `receipt.json`'s `testCmd` byte-equal to the value `ultra_run.py` stamped (no `tee`, no `pipefail`) and its `acceptanceLog` key absent. M3. `sandbox-boot.sh` contains no `acceptance.log`, and its nothing-ahead park writes the error cell exactly `parked: <branch> has no commits ahead of base (verdict <v>)` with nothing appended. M4. For each of `fleet/referee.mjs`, `fleet/CONTRACT.md`, `fleet/failing-block.mjs`: the string `acceptance` does not occur; and `fleet/launch.mjs` does not contain the word `frozen`. M5. `fleet/tests/test_sandbox_boot_parked_error.mjs` is absent, and for each of `fleet/tests/test_run_engine.mjs`, `fleet/tests/test_run_main.mjs`, `fleet/tests/test_sandbox_boot_approval_evidence.mjs`: the sim prints `ALL TESTS PASSED`.

**Authorized-by:** #871 decisions 3 and 5

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `run-engine.mjs:998` reads `args.acceptance` into `ACCEPTANCE`; `:3048-3059` builds the `waived`/`suite`/`sealed` object; `:3112` writes it into the report — delete all three; the `suite` arm's `judgmentCalls.push('suite acceptance did not pass …')` goes with it, since the post-fold candidate suite already records its own red (the wave barrier, `:2440-2560`) and `tests.passed` is in the report. `run-main.mjs:218-246` is the #739 tee: `acceptanceLogPath`, `acceptanceWrap`, and the header comment; `:725-749` is the `acceptance-capture` stage that rewrites `receipt.json`'s `testCmd` into `set -o pipefail; { … } 2>&1 | tee <run dir>/acceptance.log` and adds `acceptanceLog` — delete both, and the receipt is then written once by `ultra_run.py` and never rewritten. `sandbox-boot.sh:798-803` copies `acceptance.log` in `collect_evidence`'s list; `:2193-2210` is the parked arm that cuts `failing_block "$acceptance_log"` into the error cell — delete both; `failing_block`/`has_failing_block` (`:1426-1455`) STAY, `:1500` (the publish fold's `suite-<n>.txt`) still calls them. `fleet/failing-block.mjs:5` names `<run dir>/acceptance.log` as one of two call sites in a comment — reword to the one that remains. `fleet/referee.mjs:33-45` (`INTEGRATED_SUITE`) says "the run's **Acceptance is `suite`**; the driver runs the integrated suite …" — keep the behaviour sentence, drop the disposition clause. `fleet/CONTRACT.md:49` and `:232` are the two `acceptance.log` bullets — delete. `fleet/launch.mjs:974` says the test-command ladder is copied from `ultra_run.py` "— the verification periphery is frozen, so its rules are copied here rather than imported"; the launcher spawns no python by design (the same comment says so), so the copy stays and the sentence becomes "the launcher spawns no python, so the ladder is mirrored here and `detect_test_cmd` in `ultra_run.py` stays the one the sandbox runs". Sims: `fleet/tests/test_run_engine.mjs:73-74` asserts `report.acceptance.mode === 'suite'` and `.passed === true` — replace with `assert.ok(!('acceptance' in report))` and keep the `tests` assertions beside it; `fleet/tests/test_run_main.mjs:22` imports `acceptanceWrap`, `:331` hands `acceptance: { mode: 'suite' }` in a stub args (drop the key), and `:602-748` are the two run-42 blocks proving the tee — delete them; `fleet/tests/test_sandbox_boot_parked_error.mjs` (3 cases) exists only for the `acceptance.log` arm — delete the file; `fleet/tests/test_sandbox_boot_approval_evidence.mjs:456`, `:497`, `:525`, `:545` seed or assert `acceptance.log` in the evidence listing — drop those four, keep the other eleven. Sims run under the bridge with `sim_env()`; run each by name, `node fleet/tests/<sim>.mjs | grep -q 'ALL TESTS PASSED'`, never through a glob. The exam is a node sim under `fleet/tests/` using `_engine_helpers.mjs` and `_sandbox_boot_helpers.mjs` the way `test_run_engine.mjs` and `test_sandbox_boot_parked_error.mjs` do at BASE; it drives one engine run to a report and one nothing-ahead park to its status cell.

**Proof:**
- Test: `fleet/tests/test_run_record_keys.mjs`
- Guard: `fleet/tests/test_run_record_keys.mjs`
- Legs: (a) a one-task engine run's `report.json` has no `acceptance` key and has `tests.command`, `tests.passed`, `tests.output` [M1]; (b) `import('../run-main.mjs')` exposes neither `acceptanceWrap` nor `acceptanceLogPath`, the run's `events.jsonl` has no `acceptance-capture` stage, and `receipt.json`'s `testCmd` equals the stamped value and has no `acceptanceLog` sibling; a `tee` or `pipefail` substring fails the leg [M2]; (c) `grep -c acceptance.log fleet/sandbox-boot.sh` is 0, and the nothing-ahead park's error cell equals the sentence with nothing after the closing parenthesis [M3]; (d) for each of the three files: zero occurrences of `acceptance`; and zero of `frozen` in `launch.mjs`, the survivor named [M4]; (e) `fleet/tests/test_sandbox_boot_parked_error.mjs` is absent [M5].
- Run: node fleet/tests/test_run_engine.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_main.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_sandbox_boot_approval_evidence.mjs | grep -q 'ALL TESTS PASSED'

**Stale-if:**
- path-absent: `fleet/run-main.mjs`
- path-absent: `fleet/tests/_sandbox_boot_helpers.mjs`

### Task 5: The documents stop teaching the ceremony

**Type:** implementation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `skills/ultrawrite/SKILL.md`
- Modify: `skills/ultrawrite/references/authoring-gotchas.md`
- Modify: `skills/ultrapowers/references/plan-markers.md`
- Modify: `skills/ultrapowers/references/design-rationale.md`
- Modify: `skills/ultrapowers/references/report-format.md`
- Modify: `skills/ultrapowers/references/finishing-notes.md`
- Modify: `skills/ultradocket/SKILL.md`

**Claim:** An agent authoring a plan is asked for no Acceptance line and told of no advisories, and the project's own instructions say the verification periphery is ordinary code, not frozen. (derived)
Machine: M1. `CLAUDE.md` contains neither `FROZEN` nor `**Acceptance:**` nor `run_acceptance`, and its Conventions section carries one bullet whose bold lead is `The verification periphery is ordinary code` and whose text names `#871` and `#872`. M2. `skills/ultrawrite/SKILL.md` contains none of `**Acceptance:**`, `ADVISORY`, `--renders`, `## Acceptance disposition`; its compile line reads `compile_plan.py --check --base <checkout-dir|sha> <plan.md>`; and the text of its Proof slot bullet (the lines from the one beginning `- **Proof:**` to the one beginning `- **Stale-if:**`) contains the word `one`, one space, a backticked `Run:`, one space, `names one probe`, and later in that same bullet the words `never a loop over a glob`. M3. For each of `skills/ultrawrite/references/authoring-gotchas.md`, `skills/ultrapowers/references/plan-markers.md`, `skills/ultrapowers/references/design-rationale.md`, `skills/ultrapowers/references/report-format.md`, `skills/ultrapowers/references/finishing-notes.md`, `skills/ultradocket/SKILL.md`: none of `ADVISORY`, `**Acceptance:**`, `run_acceptance`, `sealed`, `waived` occurs. M4. For each of `ultrapowers`, `ultrawrite`, `ultralearn`, `ultradocket`: `validate_skill.py skills/<name>` exits 0.

**Authorized-by:** #871 decisions 5 and 6

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `CLAUDE.md`: `:239-241` says plans default to the Acceptance line and that a bare `suite` fails to parse — delete the sentence; `:256-269` is the whole "The verification periphery is FROZEN (0.1.0)" bullet — replace it with one bullet, bold lead "The verification periphery is ordinary code (2026-09-10, #871)", saying the gate scripts and the compiler move on #872's pre-registered readings (critical-path minutes, suite verdicts at both sites, held PRs and their outcome, catches per release, regressions found later) and that the 0.1.0 freeze ended with the Acceptance line and the advisory tier; `:279-281` says the `run_acceptance.sh --suite-gate` harness leg is inert — delete the sentence (the script is gone). Leave the CI bullet (`:36-39`) and the release bullet (`:253-255`) alone: ripping out CI is another plan's. `skills/ultrawrite/SKILL.md`: `:25` "…and one `**Acceptance:**` line" — drop; `:85`, `:88`, `:90`, `:98` say a missing Produces, the Context word count, an ordering phrase and a missing falsifying leg "draw an ADVISORY" — keep each rule as authoring guidance and delete the claim that anything reports it; `:260` the compile command — drop `--renders`; `:264` "read its `ADVISORY` lines before handoff" — the plan is done when `PLAN OK` prints and the two checks pass; `:274-279` the proof-species paragraph — delete it whole, and in its place one sentence: the rejection species are listed in `skills/ultrawrite/references/authoring-gotchas.md` and read by the author, nothing prints them; `:341` the run-12 example names `ADVISORY_RENDERS.append((…))` — say "five tasks each appended one registration line to `compile_plan.py`"; `:401-407` `## Acceptance disposition` — delete the section; `:414` — the self-review reads the gotchas file, which "names the compiler advisories" — drop that clause; `:435` — drop "the plan carries an Acceptance line". Add, in the Proof slot's `Run:` paragraph, the rule of #871 decision 6 in exactly these operative words: "one `Run:` names one probe — a command the driver pays once, never a loop over a glob of sims (run-87 paid 175 s per boot sim, three passes, for two such lines)". `authoring-gotchas.md`: `:11-14` say two species are `ADVISORY proof-species:` lines and tell the reader to run the checker for them — say instead that the author checks them here; `:61-62` same; `:88-91` say the corpus byte-pins freeze advisory text — delete the clause, the byte pin is gone. `plan-markers.md:192-196` describe the advisory renders after the verdict — delete the paragraph. `design-rationale.md:19-20` names `run_acceptance.sh --suite-gate`, `:66` names the unmatched-Consumes `ADVISORY` — rewrite both sentences. `report-format.md:42-43` is the schema enum `["waived","sealed","suite"]` and `:108` the `acceptance` row — delete both. `finishing-notes.md:58` — delete the Acceptance mention. `skills/ultradocket/SKILL.md:36-38`, `:52-53`, `:86-87`, `:143-155`, `:205` teach the disposition and the `run_acceptance.sh --suite-gate` call in triage, sweep and drain — rewrite so a swept plan carries no Acceptance line and the drain gate is the recorded suite result. `hooks/session_start.sh` and `skills/ultrapowers/SKILL.md` have nothing to change (Task 3 owns the scripts inventory line). `tests/test_recommendation_rubric.py` pins the execution-handoff rubric shared by the hook and `ultrawrite/SKILL.md` — do not touch the `## Execution handoff` section; `tests/test_docs_agree_with_code.py` pins structure, not sentences.

**Proof:**
- Run: test "$(grep -c 'FROZEN' CLAUDE.md)" = 0 && test "$(grep -c 'Acceptance:\*\*' CLAUDE.md)" = 0 && test "$(grep -c 'run_acceptance' CLAUDE.md)" = 0 && test "$(grep -c '^- \*\*The verification periphery is ordinary code' CLAUDE.md)" = 1 && sed -n '/^## Conventions/,/^## /p' CLAUDE.md | sed -n '/^- \*\*The verification periphery is ordinary code/,/^- /p' | tr '\n' ' ' | grep -q '#871.*#872'
- Run: test "$(grep -c 'ADVISORY' skills/ultrawrite/SKILL.md)" = 0 && test "$(grep -c -- '--renders' skills/ultrawrite/SKILL.md)" = 0 && test "$(grep -c 'Acceptance' skills/ultrawrite/SKILL.md)" = 0 && grep -q 'compile_plan.py --check --base <checkout-dir|sha> <plan.md>' skills/ultrawrite/SKILL.md
- Run: sed -n '/^- \*\*Proof:\*\*/,/^- \*\*Stale-if:\*\*/p' skills/ultrawrite/SKILL.md | tr '\n' ' ' | grep -q 'one .Run:. names one probe.*never a loop over a glob'
- Run: for f in skills/ultrawrite/references/authoring-gotchas.md skills/ultrapowers/references/plan-markers.md skills/ultrapowers/references/design-rationale.md skills/ultrapowers/references/report-format.md skills/ultrapowers/references/finishing-notes.md skills/ultradocket/SKILL.md; do grep -Hn 'ADVISORY\|Acceptance:\*\*\|run_acceptance\|sealed\|waived' "$f"; done | tee /dev/stderr | test "$(wc -c)" -eq 0
- Run: python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers
- Run: python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite
- Run: python3 skills/ultrapowers/scripts/validate_skill.py skills/ultralearn
- Run: python3 skills/ultrapowers/scripts/validate_skill.py skills/ultradocket
- Legs: (a) the first Run: fails on any surviving `FROZEN`, `**Acceptance:**` or `run_acceptance` in CLAUDE.md, fails unless exactly one bullet opens with the bold lead, and scopes to the Conventions section and then to that bullet's own lines before requiring `#871` and then `#872` inside it — a lead dropped elsewhere, a bullet without the tickets, or the tickets only in the Open-maps line fails it [M1]; (b) the second Run: fails on any `ADVISORY`, `--renders` or `Acceptance` in the ultrawrite skill and on a compile line that still differs from the two-flag form [M2]; (c) the third Run: cuts exactly the Proof bullet's lines, joins them, and requires `one `, any single character, `Run:`, any single character, ` names one probe` — the backticked form — and then `never a loop over a glob` later in the same joined text; the fragment absent, unbackticked, split across bullets or reversed fails it [M2]; (d) the fourth Run: prints every surviving offending line with its file and line number to stderr and fails unless that listing is empty [M3]; (e) for each of the four skills, its validate Run: exits 0 [M4].

**Stale-if:**
- path-absent: `skills/ultrawrite/SKILL.md`
- path-absent: `skills/ultrapowers/scripts/validate_skill.py`

### Task 6: The timer pin goes

**Type:** implementation

**Files:**
- Modify: `fleet/tests/test_run_engine_infra_retry.mjs`

**Claim:** The infra-retry sim no longer fails on a one-millisecond timer miss: it checks that the second dispatch happens, not how many milliseconds later. (derived)
Machine: M1. `fleet/tests/test_run_engine_infra_retry.mjs` contains no assertion comparing `secondAt - nulledAt` to a number (the string `nulledAt >= 300` does not occur) and still asserts `countOf(labels, 'integration')` equals 2. M2. `node fleet/tests/test_run_engine_infra_retry.mjs` prints `ALL TESTS PASSED`.

**Authorized-by:** #892; #871 sitting decision 2026-09-10 (delete, not widen)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** At BASE the sim's leg (j)/M8 (`:515-523`) asserts both that the critic is dispatched twice (`countOf(labels, 'integration') === 2`) and that the second dispatch began at least 300 ms after the first returned null; CI on main failed on 2026-09-10 with `measured 299 ms`, a timer-granularity miss. Delete the `assert.ok(secondAt - nulledAt >= 300, …)` statement and nothing else; the `secondAt`/`nulledAt` captures may stay or go with it. The doc comment above the leg, if it names the 300 ms bound as what the leg proves, is reworded to name the dispatch count. `#870`'s rule: a timer pin that has caught nothing is ballast.

**Proof:**
- Run: test "$(grep -c 'nulledAt >= 300' fleet/tests/test_run_engine_infra_retry.mjs)" = 0 && grep -q "countOf(labels, 'integration'), 2" fleet/tests/test_run_engine_infra_retry.mjs
- Run: node fleet/tests/test_run_engine_infra_retry.mjs | grep -q 'ALL TESTS PASSED'
- Legs: (a) the first Run: fails if the millisecond comparison survives or the dispatch-count assertion is gone [M1]; (b) the second Run: fails unless the sim prints its sentinel [M2].

**Stale-if:**
- path-absent: `fleet/tests/test_run_engine_infra_retry.mjs`

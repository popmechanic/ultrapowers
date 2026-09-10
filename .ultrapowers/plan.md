# The gate reads the recorded suite result

**Grammar:** claims-v1

**Claim:** do: run compile_plan.py --check on a plan with no Acceptance line. see: PLAN OK and nothing else — no ADVISORY lines exist any more — and every fixture plan compiles to the same waves and edges it did before, with a third of the compiler gone. (elicited)

**Summary:** Run-88 landed five of the ceremony cut's six tasks; this is the sixth, alone, on top of them. The gate script today still runs the whole test suite a second time through a helper script before it will pass a run. After this run the gate reads the suite result the engine already recorded and passes or blocks on that, the helper script is gone, and the project's instructions no longer name it.

**Goal:** Task 3 of the ceremony cut (#871 decisions 3 and 5), re-driven alone after run-88 parked on it: `ultra_gate.py` reads `report.tests` instead of shelling `run_acceptance.sh`; the script and its tests go; the last mentions of the script under `skills/` go with it. The clause run-88's task could not reach (a whole-tree property over files its siblings owned) is now reachable, because every file that still names the script is in this task's Files.

**Tech Stack:** Python 3 (`ultra_gate.py`, `ultra_run.py`, pytest), Markdown

**Spec:** run-88's record (`ultra/evidence/run-88`, task 3's judgment calls: `suite-red-on-sibling-file`, `plan-defect: M4 states a whole-tree property that my declared FILES cannot reach`); every fact a worker needs is in the task's Context.

**Parallelization rationale:** one task. No wave shape; no chain.

**Launch base:** `22518b81` (the merge of run-88's PR #893) or later.

## Global Constraints

- A deletion is whole: no helper, stub or test survives with no reader once its only caller is gone.
- Check: python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The gate reads the recorded suite result

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrapowers/scripts/ultra_gate.py`
- Modify: `skills/ultrapowers/scripts/run_acceptance.sh`
- Modify: `skills/ultrapowers/scripts/ultra_run.py`
- Modify: `skills/ultrapowers/scripts/gate_check.py`
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `tests/test_ultra_gate.py`
- Modify: `tests/test_run_acceptance.py`
- Modify: `fleet/tests/test_run_record_keys.mjs`
- Test: `tests/test_ultra_gate_record.py`

**Claim:** The gate no longer runs the suite itself: it reads the suite result the run already recorded, and passes or blocks on that. (derived)
Machine: M1. `ultra_gate.py --result <report>` with a report whose `tests.passed` is `true` and a PASS `gate_check` writes a gate receipt with `verdict` `PASS` and `suite` equal to `{"passed": true, "output": <the report's tests.output>}`, and exits 0. M2. The same call with `tests.passed` `false` writes `verdict` `BLOCKED`, `suite.passed` `false`, and exits 1; a report with no `tests` key writes `BLOCKED` with a detail naming `tests`. M3. The gate receipt carries no `acceptance` key, and `ultra_gate.py` contains none of `run_acceptance`, `--suite-gate`, `sealed`, `waived`. M4. `skills/ultrapowers/scripts/run_acceptance.sh` and `tests/test_run_acceptance.py` are absent, and for each of `skills/ultrapowers/scripts/ultra_gate.py`, `skills/ultrapowers/scripts/gate_check.py`, `skills/ultrapowers/SKILL.md`, `fleet/tests/test_run_record_keys.mjs`: the string `run_acceptance` does not occur.

**Authorized-by:** #871 decisions 3 and 5; run-88's park (task 3, `proof-red` on a plan defect)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** At this base, `ultra_gate.py`'s acceptance block (from the comment `Acceptance, per the disposition ultra_run recorded at compile time.` to `receipt["acceptance"] = acceptance`) reads `compile.acceptance.mode` from `receipt.json` — a key run-88's compiler task deleted, so `mode` is always `None` and the `else` arm always runs: it requires `receipt.testCmd` (blocking without it), shells `run_acceptance.sh --suite-gate --branch … --run <testCmd> --base … [--bootstrap …]`, stores `{"disposition": "suite", "exit", "output"}` as `receipt["acceptance"]`, and folds the exit into `acc_pass`. Replace the whole block: `report` is already in scope (unwrapped from the payload and saved to `run_dir/report.json` above); read `tests = report.get("tests")`; when it is not a dict, `return blocked(receipt, "report carries no tests block — the engine records the integrated suite there")`; else `receipt["suite"] = {"passed": bool(tests.get("passed")), "output": str(tests.get("output", ""))[-4000:]}` and `acc_pass = receipt["suite"]["passed"]`; delete the `sealed`/`waived` arms, the `run_receipt`/`testCmd` read, and `receipt["acceptance"]`. `gate_check.py` stays whole except its module docstring line `This script does not administer acceptance (that is run_acceptance.sh, per disposition).` — reword to say the suite result is read by `ultra_gate.py` from the report's `tests` block. Delete `run_acceptance.sh` (its `run_js_sims` leg has been dead since 0.3.0) and `tests/test_run_acceptance.py` (17 cases, all end-to-end against the script). `tests/test_ultra_gate.py`: `make_repo` writes a stub `run_acceptance.sh` and a receipt with `compile.acceptance`; rewrite it to write a report whose `tests` is `{"command": "x", "passed": True, "output": "ok"}` (parameter `tests_passed`), drop the stub, delete the cases `test_sealed_disposition_is_blocked_without_administering`, `test_suite_acceptance_dispatch`, `test_failed_acceptance_forces_blocked` and the `#96` argv cases (`test_suite_gate_cmd_*`, `test_bootstrap_*`, the two `testCmd`-missing cases around `:314-340`), keep the envelope-unwrap, bare-report, no-snapshot, checkout-position, gate_check-propagation, unrecognizable-result, approve-mode and retired-flags cases. `ultra_run.py`: the compile summary already reads `%d task(s) in %d wave(s)` at this base (run-88 landed that) — leave it; the one edit here is the `--bootstrap-cmd` help text that says the value is stamped `so the gate provisions its acceptance worktree` (the gate provisions nothing now — say the engine's clones). `skills/ultrapowers/SKILL.md`'s scripts inventory line names `scripts/run_acceptance.sh` — remove the name (`validate_skill.py` resolves every `scripts/<x>` reference, which is why it is a `Check:`). `fleet/tests/test_run_record_keys.mjs:151` is a comment naming "the frozen `run_acceptance.sh`" — reword the comment; nothing else in that sim changes. The run-88 lesson, so the exam does not repeat it: every path M4 names is in this task's Files, and M4 names paths, not a directory sweep. The exam (guarded, a later run could re-add the script) drives `ultra_gate.py --result` through `python3` against a throwaway repo the way `tests/test_ultra_gate.py`'s `make_repo` does, with `gate_check.py` real.

**Proof:**
- Test: `tests/test_ultra_gate_record.py`
- Guard: `tests/test_ultra_gate_record.py`
- Legs (the driver runs the `Test:` file as this task's exam command): (a) a report with `tests.passed` true and a passing `gate_check` yields a receipt with `verdict` `PASS`, `suite.passed` true and `suite.output` equal to the report's `tests.output`, exit 0 [M1]; (b) the same with `tests.passed` false yields `BLOCKED`, `suite.passed` false, exit 1; a report with no `tests` key yields `BLOCKED` with a detail containing `tests` [M2]; (c) `acceptance` is not a key of either receipt, and for each of `run_acceptance`, `--suite-gate`, `sealed`, `waived`: zero occurrences in `ultra_gate.py`, the survivor named [M3]; (d) for each of the two deleted paths: absent; and for each of the four named files: zero occurrences of `run_acceptance`, the file named on failure [M4].
- Run: python3 -m pytest -q tests/test_ultra_gate.py
- Run: node fleet/tests/test_run_record_keys.mjs | grep -q 'ALL TESTS PASSED'

**Stale-if:**
- path-absent: `skills/ultrapowers/scripts/ultra_gate.py`
- path-absent: `skills/ultrapowers/scripts/run_acceptance.sh`

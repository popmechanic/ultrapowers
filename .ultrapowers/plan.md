# The suite reports; the PR is the gate

**Grammar:** claims-v1

**Claim:** do: launch two runs that touch the same file, with no CI workflow in the repository. see: each run's PR merges itself once its own gate is green and main has not moved under it; a run whose fold turned a test red that none of its tasks touched publishes a ready PR that says so and waits for me, and a run on a red base parks before spending a token, naming the failing test. (elicited)

**Goal:** Decisions 1, 2, 3, 4, 12, 13 and 15 of the #871 grilling (2026-09-10): an unattributed post-fold red is reported and the run continues; a red BASE still parks and names the failing test; GitHub CI is ripped out and the sandbox owns the join by checking main's tip before its merge PUT (measured 2026-09-10: `strict=true` with no required context refuses nothing); an unattributed red publishes a ready PR and withholds the self-merge, with the failing block, the merge command and a fix title on the card; the depth-1 guard retires with CI.

**Tech Stack:** Node 24 ESM (`fleet/run-engine.mjs`, `fleet/tests/*.mjs` sims), bash (`fleet/sandbox-boot.sh`, sims through `_sandbox_boot_helpers.mjs`), Python 3 (`ultra_gate.py`, pytest)

**Spec:** issue #871's decision table and memory `strict-is-inert-without-a-required-context` (the probe); every fact a worker needs is in its task's Context.

**Parallelization rationale:** one wave, four wide. Task 1 (the engine's attribution and the gate's reading), task 2 (the sandbox's join and hold), task 3 (CI and the documents), task 4 (the blind-sensor park message) each own a seam. Tasks 1 and 4 both edit `run-engine.mjs` in different functions — text overlap, folds. Tasks 2 and 3 both edit `fleet/RUNBOOK.md` in different paragraphs — folds. Task 2 reads a receipt shape task 1 writes; the shape is one literal carried in both Contexts, so no edge. No chain.

**Before launch (operator, not a task):** the `test` context is removed from `main`'s required status checks (`gh api -X PUT repos/popmechanic/ultrapowers/branches/main/protection` with `required_status_checks: {strict: true, contexts: []}`, `enforce_admins: true`), because after task 3 no run reports that check and a PR waiting on it would fold again for an hour and stay open. Base for the launch is the merge of run-88 (the ceremony cut), whose `ultra_gate.py` already reads `report.tests`.

## Global Constraints

- The sandbox never asks GitHub for check runs, and no document says it does.
- Every recorded refusal or hold is one `publish:merge` or `publish:hold` line with a `left`/`why` a reader can count without parsing prose.
- Check: bash -n fleet/sandbox-boot.sh
- Check: node --check fleet/run-engine.mjs

**Acceptance:** suite — the committed suite is the verification.

### Task 1: An unattributed red is reported, an attributed one is repaired

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Modify: `skills/ultrapowers/scripts/ultra_gate.py`
- Modify: `fleet/tests/test_run_engine_reconcile.mjs`
- Modify: `fleet/tests/test_run_engine_red_suite_record.mjs`
- Modify: `tests/test_ultra_gate_record.py`
- Modify: `skills/ultrapowers/references/report-format.md`
- Test: `fleet/tests/test_run_engine_suite_attribution.mjs`

**Claim:** When a wave's fold turns a test red that none of the wave's tasks touched, the run records that and keeps going; when the red is in something a task did touch, the run repairs it or parks as it does today. (derived)
Machine: M1. `failingTestPaths(output)` returns, in order and without duplicates, the paths of pytest `FAILED <path>::…` lines in a suite output, mapping the bridge's `tests/test_fleet_suite.py::test_fleet_mjs[<name>.mjs]` to `fleet/tests/<name>.mjs`; an output with no such line returns `[]`. M2. A red candidate whose failing paths are non-empty and none of which is in any wave task's `files` or `proofTests` is adopted: the wave's `waveMerges` row has `status` `MERGED` and `suite` `{passed: false, unattributed: [<paths>], output}`, no worker labelled `reconcile:` is dispatched, and `judgmentCalls` carries one line `unattributed red: <path> went red on wave <n>'s fold; no task names it`. M3. A red candidate whose failing paths include one that IS in some wave task's `files` or `proofTests`, or whose failing paths are `[]`, takes today's path: up to two `reconcile:` dispatches, then `TEST_FAILED` with the failing block. M4. The report's `tests` carries `unattributed` — the union of every wave's unattributed paths, `[]` when none — and a run whose only red was unattributed ends with `blockedWaves` empty. M5. `ultra_gate.py --result <report>` with `tests.passed` `false` and non-empty `tests.unattributed` writes verdict `PASS` and `suite` `{passed: false, unattributed: [<paths>], output}` and exits 0; with `tests.passed` `false` and `unattributed` `[]` it writes `BLOCKED` and exits 1, as it does at BASE.

**Authorized-by:** #871 decisions 1 and 4

**Interfaces:**
- Consumes: none
- Produces: `failingTestPaths(output: string): string[]`

**Context:** The wave barrier is the `materialize → candidate → suite → adopt` choreography in `run-engine.mjs` (the block that logs `candidate suite RED — reconcile attempt`): today a red candidate dispatches the reconcile judgment agent up to twice and then returns `{ status: 'TEST_FAILED', detail: 'candidate suite failed after reconcile attempts: ' + failingBlock(...) }`, which pushes a `blockedWaves` row and parks the run. The wave's tasks are `WAVES[w]`, each with `files` (an array of paths) and `proofTests` (an array of exam paths, possibly empty); the integration clone is `integ`; `failingBlock` (from `fleet/failing-block.mjs`) cuts the failing test's block and stays as it is. Add `failingTestPaths` beside it in `run-engine.mjs` and export it: pytest's short summary lines read `FAILED tests/x.py::test_y - AssertionError` and the bridge's read `FAILED tests/test_fleet_suite.py::test_fleet_mjs[test_run_engine_x.mjs] - …`; the path is the text between `FAILED ` and `::`, and when that path is `tests/test_fleet_suite.py` and the id carries `[<name>.mjs]`, the path is `fleet/tests/<name>.mjs`. Attribution: a path is attributed when it equals an entry of any wave task's `files` or `proofTests` (string equality on the path the record spelled — no globbing, no resolving). The unattributed branch adopts the candidate exactly as the green path does (`reset --hard` to the candidate head, the same `MERGED` row) but with `suite.passed` false and `suite.unattributed` set; nothing else changes in the row. The report already builds `tests` from `lastSuite` as `{command, passed, output}` — add `unattributed` there, and add the field to the `tests` row of `skills/ultrapowers/references/report-format.md` (run-88's documents task removed that file's `acceptance` row; this task touches only the `tests` row). Two sims at BASE drive a red candidate whose fixture task has `files: ['T1.txt']` while the fixture suite output fails `tests/test_fleet_suite.py::test_fleet_mjs[test_sim.mjs]`: under M3 those reds would be unattributed and the sims' `TEST_FAILED`/reconcile pins would stop holding. Keep their meaning by naming the failing path in the fixture: `fleet/tests/test_run_engine_reconcile.mjs` (task `T1` at `:13`, `files: ['T1.txt']`) and `fleet/tests/test_run_engine_red_suite_record.mjs` (task factory at `:105`, `files: [id + '.txt']`, fixture summary line at `:57`) — add `proofTests: ['fleet/tests/test_sim.mjs']` (or the path their fixture output names) to those fixture tasks so the red stays attributed there. The gate: after run-88, `ultra_gate.py` reads `report["tests"]` and sets `receipt["suite"] = {"passed": ..., "output": ...}`, blocking on `passed` false; extend that read so a non-empty `tests.unattributed` passes with the list copied into `receipt["suite"]["unattributed"]`; `tests/test_ultra_gate_record.py` (run-88's guarded exam) pins the false-→-BLOCKED case — extend it under a comment naming this task with the unattributed-→-PASS case, keeping the `[]` case as it was. Shared literal with task 2 (the receipt's `suite` object, byte for byte in shape): `{"passed": false, "unattributed": ["tests/test_x.py"], "output": "<tail>"}`; `unattributed` is always present after this task, `[]` when there is none. The exam is a node sim in the shape of `test_run_engine_reconcile.mjs` (`makeRepo` with a `check.sh` that fails a named test, the agent seam stubbed, everything below real) and it also imports `failingTestPaths` directly for M1.

**Proof:**
- Test: `fleet/tests/test_run_engine_suite_attribution.mjs`
- Guard: `fleet/tests/test_run_engine_suite_attribution.mjs`
- Legs (the driver runs the `Test:` sim as this task's exam command; the `Run:` lines are the sibling sims and the gate exam): (a) for each of a plain pytest `FAILED tests/x.py::t` line, a bridge line `FAILED tests/test_fleet_suite.py::test_fleet_mjs[test_y.mjs] - E`, two lines naming `tests/b.py` then `tests/a.py`, two lines naming one path twice, and an output with no `FAILED` line: `failingTestPaths` returns `['tests/x.py']`, `['fleet/tests/test_y.mjs']`, `['tests/b.py', 'tests/a.py']` in that order, one entry, and `[]` respectively; a wrong, reordered or duplicated entry fails the leg [M1]; (b) a one-task wave whose task has `files: ['T1.txt']` and no `proofTests` and whose candidate suite fails `tests/other.py::t` ends with a `waveMerges` row whose `status` is `MERGED` and whose `suite` deep-equals `{passed: false, unattributed: ['tests/other.py'], output: <the recorded tail>}` with `output` a non-empty string, the stream carries no `reconcile:` label, and exactly one judgment call equals `unattributed red: tests/other.py went red on wave 1's fold; no task names it` [M2]; (c) for each of the same wave with `files: ['tests/other.py']`, the same wave with `files: ['T1.txt']` and `proofTests: ['tests/other.py']`, and the same wave with a suite output carrying no `FAILED` line (a bare non-zero exit): `reconcile:wave1:1` is dispatched and, with the reconcile stub refusing twice, the row is `TEST_FAILED` whose detail carries the failing block — an adopted row in any of the three fails the leg [M3]; (d) a two-wave run whose wave-1 candidate fails `tests/other.py::t` and whose wave-2 candidate fails `tests/more.py::t`, neither named by any task, ends with `tests.unattributed` equal to `['tests/other.py', 'tests/more.py']` and `blockedWaves` equal to `[]`; a green run ends with `tests.unattributed` equal to `[]` [M4]; (e) `ultra_gate.py --result` with a report whose `tests` is `{passed: false, unattributed: ['tests/other.py'], output: 'x'}` and a PASS `gate_check` writes verdict `PASS` and `suite.unattributed` `['tests/other.py']`, exit 0; with `unattributed: []` it writes `BLOCKED`, exit 1 — driven by the exam through `python3` the way `tests/test_ultra_gate_record.py` drives it [M5].
- Run: node fleet/tests/test_run_engine_reconcile.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_red_suite_record.mjs | grep -q 'ALL TESTS PASSED'
- Run: python3 -m pytest -q tests/test_ultra_gate_record.py

**Stale-if:**
- path-absent: `fleet/failing-block.mjs`
- path-absent: `tests/test_ultra_gate_record.py`

### Task 2: The sandbox owns the join and the hold

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/sandbox-boot.sh`
- Modify: `fleet/CONTRACT.md`
- Modify: `fleet/RUNBOOK.md`
- Modify: `fleet/tests/test_sandbox_boot_merge.mjs`
- Modify: `fleet/tests/test_sandbox_boot_selfmerge.mjs`
- Modify: `fleet/tests/_sandbox_boot_helpers.mjs`
- Modify: `tests/test_docs_agree_with_code.py`
- Test: `fleet/tests/test_sandbox_boot_join.mjs`

**Claim:** A run's PR merges itself once its own gate is green and main has not moved under it, asks GitHub for no check runs, and a run whose gate passed on an unattributed red publishes a ready PR, says what went red, and waits. (derived)
Machine: M1. Before its merge PUT the script fetches the target's default branch and compares its tip to the fold receipt's `tip`; when they differ it issues no PUT, appends `publish:merge` with `sha` null, `left` `base moved` and `detail` `tip <old> → <new>`, and raises the fold-again signal; when they are equal it PUTs once. M2. The script contains none of `check-runs`, `check_runs_verdict`, `MERGE_CHECKS_GRACE`, `checks red`, `checks pending`; a gate-green run whose tip did not move merges with zero requests whose URL contains `check-runs`. M3. A gate receipt whose `suite.unattributed` is a non-empty list publishes a ready (`draft` false) PR, issues no PUT, sets `MERGE_NOTE` to `left open: suite red, unattributed: <first path>`, appends `publish:merge` with `sha` null, `left` `held` and `detail` the path list joined by `, `, ends `done` with `merged` null, and the PR body carries a `## Held` section with, in order, the failing block cut from `report.json`'s `tests.output`, the line `gh pr merge <number> --squash --match-head-commit <head>`, and one line `Fix: <first path> went red on the fold of run-<N>`. M4. `hold=1` still publishes and stops; a 405 whose body names a moved base still folds again. M5. `tests/test_docs_agree_with_code.py`'s publish-record literal list names `held` and `base moved` and neither `checks red` nor `checks pending`; `fleet/CONTRACT.md`'s publish bullet and `fleet/RUNBOOK.md`'s merge paragraph say the sandbox merges once its gate is green and the default branch's tip is the one it folded onto, and name no check run.

**Authorized-by:** #871 decisions 3, 4, 12 and 15; probe of 2026-09-10 (`strict` inert without a context)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `merge_pr()` in `sandbox-boot.sh` (the function beginning `merge_pr() {`) today: returns on no PR / already merged / `hold=1` / `FOLD_HOLD`; then polls `GET …/commits/<head>/check-runs` through `check_runs_verdict()` (the embedded python parser) for up to `MERGE_CHECK_WAIT` with a `MERGE_CHECKS_GRACE` (120 s) grace for "no runs", branching `green` / `none` / `red*` / pending; then `await_mergeable` when folding again; then one PUT whose 405 body (`not mergeable`, `base branch was modified`, `required status check`) raises `FOLD_AGAIN=1` under the `FOLD_AGAIN_WAIT` clock. Delete the check-runs poll, `check_runs_verdict`, `MERGE_CHECKS_GRACE`/`FLEET_MERGE_CHECKS_GRACE`, and the `checks red`/`checks pending` events; keep `MERGE_CHECK_WAIT` (`await_mergeable` uses it), `await_mergeable`, the PUT, and the 405 arms as the backstop. In their place, the tip check: `default_branch()` already reads the target's default branch from `refs/remotes/origin/HEAD`; `fleet_git -C "$TARGET_DIR" fetch origin <default>` then `rev-parse refs/remotes/origin/<default>` is the live tip; the fold's tip is `fold_field "$(fold_receipt top)" tip` (the folder records `tip` per attempt — `publish-fold.mjs` reads it at its `gitR(['fetch', 'origin', defaultBranch])` / `rev-parse refs/remotes/origin/<default>` step). Differ → no PUT, `append_event publish:merge sha=n: "left=s:base moved" "detail=s:tip <old> → <new>"`, `FOLD_AGAIN=1`, `MERGE_NOTE="left open: base moved"` — the same signal the 405 raises, so `do_boot`'s fold-again loop and the `FOLD_AGAIN_SINCE` clock apply unchanged. The hold: the gate receipt is `gate-receipt.json` in the run dir (`gate_receipt_path`, read with `json_field`); after run-88 and task 1 it carries `suite` as `{"passed": false, "unattributed": ["tests/test_x.py"], "output": "<tail>"}` (`unattributed` always present, `[]` when none — the literal shared with task 1). Read `suite.unattributed` with a small python read like `fold_receipt`'s; when non-empty, `publish` opens the PR as gate-green does (`draft=false` — the verdict IS `PASS`), and `merge_pr` returns before any tip read with the note and event M3 names. The card: `render_card` builds the body; `fold_section` already renders `## Publish fold` with a failing block from the fold's `suite-<n>.txt` when the disposition is `suite red`; add a `## Held` section (printed when `MERGE_NOTE` begins `left open: suite red`) that cuts the block with `failing_block` from `report.json`'s `tests.output` (write it to a temp file first, `failing_block` takes a path), then the merge command with the PR number (`pr_number`) and the PR head (`BRANCH_HEAD` or `rev-parse "$BRANCH"`), then the fix line — decision 12's three items, nothing else; `#871` decisions 9–11 restructure the rest of the card in a later plan. Sims: `fleet/tests/test_sandbox_boot_merge.mjs` (93 cases) is entirely the check-runs poll — delete the file, moving its hold-path legs (h) parked-reads-nothing, (i) `hold=1`, (k) `merged` on every page into `test_sandbox_boot_selfmerge.mjs` if they are not already there (they are: legs (h), (i), (k) at `:257`, `:266`, `:296`). `test_sandbox_boot_selfmerge.mjs` pins the check-runs GET in M1/M2 (`:84-234`) and `left=checks red`/`checks pending` in the #703 legs (`:594`, `:603`); rewrite those legs to the tip check (green path: zero `checkReads`, one `mergePuts`; moved tip: zero PUTs, `left=base moved`, then a fold-again) and keep the rest. `_sandbox_boot_helpers.mjs` stubs `check-runs` at `:212-223` (`STUB_CHECKS`, `STUB_CHECKS_PENDING`, `STUB_CHECKS_CODE`, `checkReads`) — delete those, and give the git stub a `STUB_TIP` knob so a sim can make `rev-parse refs/remotes/origin/<default>` answer a moved tip (the helpers already stub `fleet_git`; read how `FOLD_CANDIDATE`/`HEAD_SHA` are served and add the tip beside them). `tests/test_docs_agree_with_code.py:480-493` lists `PUBLISH_RECORD_LITERALS` including `checks red` and `checks pending` and asserts each appears in `CONTRACT.md`'s publish bullet — replace those two with `held` and `base moved` and update the bullet (`CONTRACT.md` `:255-268` the check-runs paragraph, `:318-330` the `left` vocabulary). `RUNBOOK.md:193-196` ("A ready PR merges itself: the sandbox polls its head's check runs…") — rewrite; task 3 owns `:270` and `:456`. `skills/ultralearn/scripts/fleet_events.py` renders `left`/`detail` generically (no `checks red` literal) — untouched. The events contract: one `publish:merge` line per decision, the LAST is what became of the PR — unchanged.

**Proof:**
- Test: `fleet/tests/test_sandbox_boot_join.mjs`
- Guard: `fleet/tests/test_sandbox_boot_join.mjs`
- Legs (the driver runs the `Test:` sim as this task's exam command; the `Run:` lines are the rewritten sibling sim and the doc pin): (a) a gate-green boot with the stubbed tip equal to the fold receipt's `tip` issues exactly one merge PUT, zero requests whose URL contains `check-runs`, and appends one `publish:merge` carrying the squash sha [M1] [M2]; (b) the same boot with the stubbed tip moved issues zero PUTs, appends `publish:merge` with `left=base moved` and a `detail` beginning `tip `, and the stream shows a second `publish fold (attempt 2)` [M1]; (c) `grep -c` over `sandbox-boot.sh` for each of `check-runs`, `check_runs_verdict`, `MERGE_CHECKS_GRACE`, `checks red`, `checks pending` is 0, the survivor named [M2]; (d) a boot whose gate receipt carries `suite.unattributed` `['tests/other.py']` posts a PR with `draft` false, issues zero PUTs, ends `done` with `merged` null, appends `publish:merge` with `left=held` and `detail=tests/other.py`, its `status.json` page carries no `merged` sha, its `pr-body.md` carries the line `- merge: left open: suite red, unattributed: tests/other.py` (the `MERGE_NOTE` as `fold_section` prints it) and `## Held` followed in order by the failing block's `___ ` header line, a line beginning `gh pr merge ` and containing `--squash --match-head-commit`, and a line beginning `Fix: tests/other.py went red on the fold of run-`; a body missing the merge line or any of the three, or in another order, fails [M3]; (e) `hold=1` still appends `publish:hold why=hold=1` and no PUT, and a PUT answered 405 `Base branch was modified` still appends `left=refused` and folds again [M4]; (f) `PUBLISH_RECORD_LITERALS` in `tests/test_docs_agree_with_code.py` contains `held` and `base moved` and neither retired literal, and `sed -n` over CONTRACT.md's publish bullet and RUNBOOK.md's merge paragraph finds `check run` in neither and `tip` in both [M5].
- Run: node fleet/tests/test_sandbox_boot_selfmerge.mjs | grep -q 'ALL TESTS PASSED'
- Run: python3 -m pytest -q tests/test_docs_agree_with_code.py

**Stale-if:**
- path-absent: `fleet/tests/_sandbox_boot_helpers.mjs`
- path-absent: `fleet/publish-fold.mjs`

### Task 3: CI leaves the repository

**Type:** implementation

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `tests/test_validate_skill.py`
- Modify: `CLAUDE.md`
- Modify: `fleet/RUNBOOK.md`

**Claim:** The repository runs no CI: the fleet's gate is the check, and the documents say so and say why the shallow-clone guard went with it. (derived)
Machine: M1. `.github/workflows/` contains no file. M2. `tests/test_validate_skill.py` reads no `ci.yml`, still carries the literal `["ultradocket", "ultralearn", "ultrapowers", "ultrawrite"]` in an equality assertion exactly once, and its cases pass. M3. `CLAUDE.md` contains none of `ci.yml`, `--auto --squash`, `gh run list`; its Commands section carries one bullet whose bold lead is `There is no CI` whose text contains, in order, `#871`, the phrase `the fleet run's gate is the check`, and the phrase `the confidence run`; and its Conventions section carries one bullet whose bold lead is `The depth-1 guard retired with CI` naming `#712` and `2026-09-10`. M4. `fleet/RUNBOOK.md` contains neither `--auto` nor `waits on the target's own checks`.

**Authorized-by:** #871 decisions 3 and 13

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `.github/workflows/ci.yml` (68 lines) is the only workflow: it validates the four skills, prints prose sizes, and runs `pytest tests/ -n auto`; its `:18-24` comment says the default-depth checkout "IS the guard" for history-coupled tests since #712 deleted the engine's depth-1 rehearsal — decision 13 retires that guard: since 0.3.5 every fleet clone is the sandbox's own full clone at BASE and no live path runs git against a shallow boundary. Delete the file (and the directory if empty). `tests/test_validate_skill.py:26-33` (`test_ci_validates_every_shipped_skill`) reads `ci.yml` and pins its `for s in skills/*/` loop — delete the loop pins, keep the shipped-skills equality, and make the case run `validate_skill.py` on each of the four (a subprocess per skill, exit 0). `CLAUDE.md:36-39` is the CI bullet in `## Commands` — replace with the `There is no CI` bullet (bold lead exactly `**There is no CI**`): the fleet run's gate (`ultra_gate.py` reading the recorded suite) is the check, PRs merge from the sandbox, and a release's check is the confidence run on the merged engine (`#871` decision 3, 2026-09-10); `:253-255` the release bullet says `gh pr merge --auto --squash so the required check runs in front of it (#680…)` and `confirm CI on main is green (gh run list …)` — rewrite to `gh pr merge --squash` after the confidence run, with no `gh run list`; add in `## Conventions & gotchas` one bullet with bold lead `**The depth-1 guard retired with CI**` (2026-09-10, #712's premise, the reason above). run-88's fifth task (the documents) already removed the freeze bullet and the Acceptance sentence from CLAUDE.md; do not re-add them. `fleet/RUNBOOK.md:270` ("not `gh pr merge <n> --auto`, which GitHub refuses…") — drop the `--auto` clause; `:456` ("a pull request whose merge waits on the target's own checks") — say "a pull request the sandbox merges only when its own gate is green and main has not moved". Task 2 owns `:193-196`. `tests/test_docs_agree_with_code.py` pins structure and names no `ci.yml`. The branch protection change is the operator's, before launch (plan preamble); nothing in this task touches GitHub settings.

**Proof:**
- Run: test "$(ls -A .github/workflows 2>/dev/null | wc -l)" -eq 0
- Run: test "$(grep -c 'ci.yml' tests/test_validate_skill.py)" = 0 && test "$(grep -c 'assert shipped == \["ultradocket", "ultralearn", "ultrapowers", "ultrawrite"\]' tests/test_validate_skill.py)" = 1 && python3 -m pytest -q tests/test_validate_skill.py
- Run: test "$(grep -c 'ci.yml' CLAUDE.md)" = 0 && test "$(grep -c -- '--auto --squash' CLAUDE.md)" = 0 && test "$(grep -c 'gh run list' CLAUDE.md)" = 0 && test "$(grep -c '^- \*\*There is no CI' CLAUDE.md)" = 1 && sed -n '/^## Commands/,/^## /p' CLAUDE.md | sed -n '/^- \*\*There is no CI/,/^- /p' | tr '\n' ' ' | grep -q "#871.*the fleet run's gate is the check.*the confidence run" && test "$(grep -c '^- \*\*The depth-1 guard retired with CI' CLAUDE.md)" = 1 && sed -n '/^## Conventions/,/^## /p' CLAUDE.md | sed -n '/^- \*\*The depth-1 guard retired with CI/,/^- /p' | tr '\n' ' ' | grep -q '#712.*2026-09-10'
- Run: test "$(grep -c -- '--auto' fleet/RUNBOOK.md)" = 0 && test "$(grep -c 'waits on the target' fleet/RUNBOOK.md)" = 0
- Legs: (a) the first Run: fails if any file survives under the workflows directory [M1]; (b) the second Run: fails on any `ci.yml` mention in the validate test, fails unless the four-skill equality assertion is present verbatim exactly once, and then runs the file's cases, which fail on any red [M2]; (c) the third Run: fails on any surviving literal, on a bullet count other than one for each lead, and scopes each new bullet to its section and its own lines before requiring `#871`, then `the fleet run's gate is the check`, then `the confidence run` in the first and `#712` then `2026-09-10` in the second [M3]; (d) the fourth Run: fails on either surviving RUNBOOK phrase [M4].

**Stale-if:**
- path-absent: `.github/workflows/ci.yml`
- path-absent: `skills/ultrapowers/scripts/validate_skill.py`

### Task 4: A red base names its failing test and says the sensor is blind

**Type:** implementation

**Files:**
- Modify: `fleet/run-engine.mjs`

**Claim:** A run that opens on a repository whose suite is already red parks before spending a token and tells me which test is red and that the suite cannot be read for this run. (derived)
Machine: M1. The red-baseline park's `blockedWaves` detail and its judgment call each begin `baseline: the suite is RED on BASE` and continue ` — the sensor is blind for this run; failing: <paths>` where `<paths>` is the comma-joined list of `FAILED <path>::…` paths read from the baseline output (or `unparsed` when there is none), followed by the failing block as today. M2. No implementer worker is dispatched on a run whose baseline is red and settles within the head start: the stream carries no `impl:` label and every task is listed in `unfinished` as `never dispatched`.

**Authorized-by:** #871 decision 2

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `parkOnRedBaseline` in `run-engine.mjs` builds `detail` as `'baseline: the suite is RED on BASE (' + baseline.output + ') — this run inherited that red: no candidate was tested and no reconcile was dispatched against it'`, and `settleBaseline` pushes the judgment call `'baseline: the suite is RED on BASE (' + output + …`; `baseline.output` is already `failingBlock(...)` of the suite output. Reword both to M1's shape, keeping the prefix `baseline: the suite is RED on BASE` byte for byte — `fleet/tests/test_run_engine_early_baseline.mjs` (lines 219 and 263) and `fleet/tests/test_run_engine_baseline.mjs` (lines 232 and 239) pin that prefix with `startsWith`, and `test_run_engine_baseline.mjs` (line 376) pins the literal in the source; none pins the tail, so no sim edit is needed. Read the failing paths with a local scan of `^FAILED (.+?)::` lines over the raw suite output (task 1 adds a shared parser in the same file; this task does not depend on it — a three-line local scan keeps the two tasks unordered, and a later tidy can fold them). The `BASELINE_HEAD_START_MS` head start (500 ms) is what M2 rides on; the sim shape is `test_run_engine_early_baseline.mjs`'s.

**Proof:**
- Test: `fleet/tests/test_run_engine_blind_sensor.mjs`
- Guard: `fleet/tests/test_run_engine_blind_sensor.mjs`
- Legs (the driver runs the `Test:` sim as this task's exam command; the `Run:` lines are the two sibling sims that pin the prefix): (a) a run whose `check.sh` fails `tests/test_z.py::t` and `tests/test_w.py::u` on BASE parks with `blockedWaves[0].detail` beginning `baseline: the suite is RED on BASE — the sensor is blind for this run; failing: tests/test_z.py, tests/test_w.py` and a judgment call beginning the same; a detail missing the phrase, either path or their order fails [M1]; (b) a run whose `check.sh` exits 1 printing no `FAILED` line parks with a detail beginning `baseline: the suite is RED on BASE — the sensor is blind for this run; failing: unparsed` [M1]; (c) the (a) run's stream carries no `impl:` label and `unfinished` lists the task with `never dispatched` [M2].
- Run: node fleet/tests/test_run_engine_early_baseline.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_baseline.mjs | grep -q 'ALL TESTS PASSED'

**Stale-if:**
- path-absent: `fleet/tests/test_run_engine_early_baseline.mjs`

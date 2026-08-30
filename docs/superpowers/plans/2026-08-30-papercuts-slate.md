# Papercuts Slate Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close five independent correctness papercuts — three false-green checks, one dead test seam, and one missing cost model — each in its own file, in a single wave.

**Architecture:** Five unrelated defects that share one shape: a check or a document that reports health it does not verify. `--check` passes a plan the full compile refuses (#440); `ab_runner`'s `--test-cmd` default silently overrides the detection ladder (#442); a test-factory option survives the code it configured (#413); `fleet/RUNBOOK.md` documents two checks that cannot fail and one that no longer exists; and `ultraplan` teaches four shaping moves without ever stating what a wave costs (#444 item 1). No task consumes another's output — there are no `Depends-on` edges in this plan, by construction rather than by omission.

**Tech Stack:** Python 3.12 (pytest, pytest-xdist), Node ESM (`fleet/tests/test_*.mjs`, bridged into pytest by `tests/test_fleet_suite.py`), Markdown.

**Spec:** No spec document — this slate is assembled from five filed issues (#440, #442, #413, #444, and the RUNBOOK defects found while executing `.claude/ultrapowers/handoffs/2026-08-30-golden-rebuild.md`). Each task body carries its own issue's argument in full.

**Acceptance:** suite — every change here is a check, a pin, or a document assertion; the committed suite plus per-task review is the whole verification.

## Global Constraints

- **The verification periphery is FROZEN (0.1.0).** The compiler's `--check` diagnostic vocabulary changes only for an eval-measured regression. Task 1 adds **no new diagnostic string**: it reuses the existing refusal wording verbatim. A task that invents new `--check` output has broken this constraint even if its tests pass.
- **`skills/ultraplan/SKILL.md` is complexity-ratcheted** at 3038 words (`tests/test_skill_budget.py`; the file is 3034 today). Task 4's diff must be **net delta ≤ 0 words**.
- **Fleet tests are Node ESM.** Files matching `fleet/tests/test_*.mjs` are executed by `tests/test_fleet_suite.py` with a 120 s per-file cap, and each must print the sentinel `ALL TESTS PASSED` as its final line or the bridge counts it as failed.
- **No new dependencies.** Nothing here adds a package to `fleet/package.json` or a Python requirement.
- **Every behavior change lands with a test that fails without it.** Tests are present and assert the new behavior, not merely that the code runs.

---

### Task 1: `--check` refuses a marked plan with no Acceptance line (#440)

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Test: `tests/test_plan_check.py`

**Interfaces:**
- Consumes: nothing
- Produces: `collect_violations(plan_path) -> list[str]` — unchanged signature; gains one additional violation string for marked, Acceptance-less plans.

`--check`'s whole promise is "green here means it launches." It does not hold. The full compile refuses a marked plan with no `**Acceptance:**` line at `skills/ultrapowers/scripts/compile_plan.py:1668`:

```
error: marked plan has no **Acceptance:** line (sealed or waived). Seal the exam (ultraplan sealing step) or record an explicit waiver. See docs/superpowers/specs/2026-06-12-sealed-acceptance-design.md
```

`collect_violations` — the `--check` path — never evaluates acceptance at all, so such a plan prints `PLAN OK` and then dies at launch, when a fix costs a session instead of seconds.

**This is a reachability fix, not a vocabulary change.** The refusal string already exists and is reused byte-for-byte. Do not write a new message, do not reword this one, and do not add a `did-you-mean` tail.

**The one way to get this wrong: scope.** The gate must fire only on **marked** plans, exactly as the full compile does. Four committed plans carry no Acceptance line — `docs/superpowers/plans/2026-06-02-ultrapowers-implementation.md`, `2026-06-05-ultrapowers-improvement-plan.md`, `2026-06-09-review-findings-fixes.md`, and `plans/README.md`. All four are unmarked, and `tests/test_all_plans_compile.py` only guards marked plans, so an unscoped fix would start failing a committed plan with nothing in the suite to catch it before CI.

"Marked" is the same predicate the full compile uses at `compile_plan.py:1666` — `any(not t.get("heuristic") for t in tasks)`, where the `heuristic` flag comes from `classify(t)` (`compile_plan.py:521`, returning `(disposition, heuristic)`; explicit `**Type:**` marker wins, heuristics otherwise). In `collect_violations` the tasks are already parsed with `parse_task(t, raise_on_marker_error=False)` but are **not** yet stamped with `disposition`/`heuristic` — the stamping happens in `main()` at `compile_plan.py:1628`. So call `classify()` yourself over the parsed tasks rather than reading a key that is not there.

- [ ] **Step 1: Write the two failing tests**

Add to `tests/test_plan_check.py`. The module already defines `CANONICAL` (a marked plan whose second line is `**Acceptance:** suite — test`) and runs the script as a subprocess, which is the pinned operator-facing surface — keep that shape.

```python
MARKED_NO_ACCEPTANCE = CANONICAL.replace("**Acceptance:** suite — test\n", "")

UNMARKED_NO_ACCEPTANCE = """# P

### Task 1: A

**Files:**
- Modify: `src/a.py`

- [ ] **Step 1: do it**
"""


def test_check_refuses_marked_plan_with_no_acceptance_line(tmp_path):
    """#440: the full compile refuses this at compile_plan.py:1668; --check
    said PLAN OK, so the plan died at launch instead of at authoring time."""
    plan = tmp_path / "p.md"
    plan.write_text(MARKED_NO_ACCEPTANCE)
    r = subprocess.run([sys.executable, str(SCRIPT), "--check", str(plan)],
                       capture_output=True, text=True)
    assert r.returncode == 2
    assert "no **Acceptance:** line" in r.stdout
    assert "1 violation(s)" in r.stdout


def test_check_leaves_unmarked_plans_alone(tmp_path):
    """Scope guard: four committed plans carry no Acceptance line and no
    markers. An unscoped gate would start failing them, and
    test_all_plans_compile.py only covers marked plans."""
    plan = tmp_path / "p.md"
    plan.write_text(UNMARKED_NO_ACCEPTANCE)
    r = subprocess.run([sys.executable, str(SCRIPT), "--check", str(plan)],
                       capture_output=True, text=True)
    assert r.returncode == 0
    assert "PLAN OK" in r.stdout
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_plan_check.py -k acceptance -v`
Expected: `test_check_refuses_marked_plan_with_no_acceptance_line` FAILS — it gets returncode 0 and `PLAN OK`. `test_check_leaves_unmarked_plans_alone` PASSES already (it pins behavior that must not change).

- [ ] **Step 3: Add the scoped check to `collect_violations`**

In `skills/ultrapowers/scripts/compile_plan.py`, inside `collect_violations`, after the `Files` grammar loop and before `return violations`. Extract the refusal message into a module-level constant so the two call sites cannot drift, and have `main()`'s `sys.exit` at line 1668 use the same constant:

```python
# The refusal main() raises at compile time (#440). One constant, two call
# sites: --check must refuse exactly what the full compile refuses, or its
# "green here means it launches" promise is false.
ACCEPTANCE_MISSING_ERROR = (
    "marked plan has no **Acceptance:** line (sealed or waived). "
    "Seal the exam (ultraplan sealing step) or record an explicit waiver. "
    "See docs/superpowers/specs/2026-06-12-sealed-acceptance-design.md")
```

Then in `collect_violations`:

```python
    # #440: scoped to MARKED plans, exactly as main() is — four committed
    # plans are unmarked and Acceptance-less, and must keep passing.
    if any(not classify(t)[1] for t in tasks) and \
            parse_acceptance(plan_text)["mode"] == "missing":
        violations.append(ACCEPTANCE_MISSING_ERROR)
```

Update `main()`'s existing `sys.exit(...)` at `compile_plan.py:1668` to `sys.exit("error: " + ACCEPTANCE_MISSING_ERROR)` so the compile-path wording is unchanged byte-for-byte.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_plan_check.py tests/test_all_plans_compile.py tests/test_compile_plan.py tests/test_check_renders.py tests/test_flawed_grammar.py -v`
Expected: all PASS. `test_all_plans_compile.py` passing is the scope guard doing its job.

- [ ] **Step 5: Verify every committed plan still checks clean**

Run: `for f in docs/superpowers/plans/*.md evals/fixtures/*/plan.md; do python3 skills/ultrapowers/scripts/compile_plan.py --check "$f" >/dev/null || echo "REFUSED: $f"; done`
Expected: the only lines printed are for plans that were already refused before this change. No new refusals — in particular none of the four named above.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/scripts/compile_plan.py tests/test_plan_check.py
git commit -m "fix(#440): --check refuses a marked plan with no Acceptance line, as the full compile does"
```

---

### Task 2: `ab_runner` stops overriding the test-command detection ladder (#442)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `evals/ab_runner.py`
- Test: `tests/test_ab_runner.py`

**Interfaces:**
- Consumes: nothing
- Produces: `main(argv, run=subprocess.run) -> int` — unchanged signature. The `--test-cmd` argparse default becomes `None`, and the `node run-main.mjs` command omits `--test-cmd` entirely when the flag is not passed.

**Blast radius, already checked:** `tests/test_bun_fixture.py:127` and `:143` pin the `--test-cmd` threading, and both pass the flag explicitly, so both keep passing unchanged — this task does not need to touch that file. `evals/ab_auth.py` and `evals/judge.py` mention the module but not this flag.

`evals/ab_runner.py:87` sets `--test-cmd` to a hardcoded default:

```python
parser.add_argument("--test-cmd", default="python3 -m pytest", ...)
```

and `evals/ab_runner.py:168-169` threads it unconditionally into the engine command. Because the default is a real string rather than `None`, **every cell runs `python3 -m pytest` no matter what the fixture is**, and `ultra_run.detect_test_cmd` never gets a chance to speak. Two consequences:

1. A fixture with a non-Python suite can never be an A/B cell without the operator remembering the flag — `webapp` is the filed example.
2. The ladder's `-n auto` upgrade is silently discarded. `skills/ultrapowers/scripts/ultra_run.py:51` returns `"python3 -m pytest -n auto"` when xdist is importable and plain `"python3 -m pytest"` otherwise, so on a host with xdist the runner was pinning cells to serial pytest while believing it had changed nothing.

The fix is to default to `None` and only append the flag when it was actually given — the same shape `--bootstrap-cmd` already uses at `evals/ab_runner.py:97` and `169`.

**Keep the original comment's fact, which is still true:** fixture projects carry no pytest config, so `detect_test_cmd` finds nothing for them and `run-engine` refuses (testCmd is mandatory, #96). That is why every documented A/B invocation passes `--test-cmd` explicitly. The defect is not that the runner threads the flag — it is that it fabricates one when the operator did not.

- [ ] **Step 1: Write the two failing tests**

Add to `tests/test_ab_runner.py`. The module already has `_fixture_tree` and `_stub_run`, which record every subprocess command in a list — assert against the recorded `node` command.

```python
def test_no_test_cmd_flag_when_operator_passes_none(tmp_path):
    """#442: the default was a real string, so every cell ran
    `python3 -m pytest` and ultra_run's detection ladder never spoke — which
    also discarded the ladder's `-n auto` upgrade on every cell."""
    record = []
    rc = main(["mini", "--overlap", "fold", "--run-id", "ab-t442a",
               "--results-dir", str(tmp_path / "results"),
               "--fixtures-root", str(_fixture_tree(tmp_path)),
               "--workspace", str(tmp_path / "ws")],
              run=_stub_run(record))
    assert rc == 0
    node_cmd = next(c for c, _ in record if c[0] == "node")
    assert "--test-cmd" not in node_cmd


def test_explicit_test_cmd_is_still_threaded(tmp_path):
    record = []
    rc = main(["mini", "--overlap", "fold", "--run-id", "ab-t442b",
               "--results-dir", str(tmp_path / "results"),
               "--fixtures-root", str(_fixture_tree(tmp_path)),
               "--workspace", str(tmp_path / "ws"),
               "--test-cmd", "bunx tsc --noEmit && bun test"],
              run=_stub_run(record))
    assert rc == 0
    node_cmd = next(c for c, _ in record if c[0] == "node")
    assert node_cmd[node_cmd.index("--test-cmd") + 1] == "bunx tsc --noEmit && bun test"
```

Two conventions of this module that the code above already follows, and that must not be changed: `main` takes the stub as its `run=` keyword (there is no module-level `run` to monkeypatch), and `_stub_run` records `(cmd, kwargs)` tuples — hence `for c, _ in record`.

- [ ] **Step 2: Run the tests to verify the first fails**

Run: `python3 -m pytest tests/test_ab_runner.py -k test_cmd -v`
Expected: `test_no_test_cmd_flag_when_operator_passes_none` FAILS (`--test-cmd` is present with `python3 -m pytest`). `test_explicit_test_cmd_is_still_threaded` PASSES.

- [ ] **Step 3: Default to None and append conditionally**

At `evals/ab_runner.py:87`, replace the argument definition and rewrite the comment above it so it states the current fact rather than the deleted behavior:

```python
    # run-28 critic finding 1: fixture projects deliberately carry no pytest
    # config (fixtures are read-only baselines), so ultra_run's detection
    # ladder finds nothing for them and run-engine refuses (testCmd is
    # mandatory, #96) — which is why every documented A/B invocation passes
    # this explicitly. Omitted (None) => not passed, so the ladder decides
    # (#442). A hardcoded default silently discarded the ladder's `-n auto`
    # upgrade on every cell.
    parser.add_argument("--test-cmd", default=None,
                        help="suite command the engine runs in the cell "
                             "(default: ultra_run's detection ladder decides)")
```

At `evals/ab_runner.py:167-170`, drop `--test-cmd` from the base command and append it the way `--bootstrap-cmd` is appended:

```python
    command = ["node", str(REPO_ROOT / ENGINE), "plan.md", run_id,
               "--repo", str(cell), "--overlap", args.overlap]
    if args.test_cmd:
        command += ["--test-cmd", args.test_cmd]
    if args.bootstrap_cmd:
        command += ["--bootstrap-cmd", args.bootstrap_cmd]
```

Update the usage line at `evals/ab_runner.py:6` if it asserts a default.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_ab_runner.py tests/test_ab_lib.py tests/test_bun_fixture.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add evals/ab_runner.py tests/test_ab_runner.py
git commit -m "fix(#442): ab_runner defaults --test-cmd to None so ultra_run's detection ladder decides"
```

---

### Task 3: Remove the orphaned `installedPluginVersion` test seam (#413)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `fleet/tests/_drive_helpers.mjs`
- Create: `fleet/tests/test_helpers_hygiene.mjs`

**Interfaces:**
- Consumes: nothing
- Produces: `startStubSandbox` no longer accepts an `installedPluginVersion` option; `fleet/tests/test_helpers_hygiene.mjs` is a new sentinel-style test file.

**Blast radius, already checked:** `fleet/tests/test_drive.mjs`, `test_drive_lifecycle.mjs` and `test_drive_pr.mjs` all call `startStubSandbox`, and **none of them passes `installedPluginVersion`** — verified by grep at BASE. Removing the option changes no call site, so this task does not need to touch those files. Step 4 runs all three anyway.

#413 filed a flake: a fleet test named test_shim_main_plugin (a file that no longer exists at BASE — do not look for it) read `installedPluginVersion` off the orchestrator's store before the ws sync landed. **The flake is not reachable any more** — that test file was deleted in `44e0d15` ("the Workflow path and waves.js are deleted", #434), along with the whole stamping path it exercised. `drive.mjs:1123-1127` states the outcome in its own comment: *"The installed-plugin cross-check died at 0.3.0 with the install it checked… versionStamp now attests the checkout stamp alone."*

What survives is an orphan. `fleet/tests/_drive_helpers.mjs:245` still destructures an `installedPluginVersion` option, and line 258 still spreads it into the stamp:

```javascript
      // #282 image side (distill P5): the version the sandbox reports as
      // INSTALLED. Null = the stub stamps none (an older shim).
      installedPluginVersion: installedOverride = null,
```

No test in `fleet/tests/` passes it, and nothing in `fleet/` reads the cell. It is a test seam that configures nothing — a reader who finds it reasonably concludes the drive still cross-checks the installed plugin, and it would let a future test "exercise" a check that does not exist.

Delete it, and pin the factory's option set so the next cutover leaves a failing test instead of a silent orphan.

**Do not add unknown-key rejection.** The factory ignores unknown keys today; making it throw would fail any caller passing an extra key across `test_drive.mjs`, `test_drive_lifecycle.mjs` and `test_drive_pr.mjs`, which are outside this task's files. Pin the destructured set instead — it catches the same class and touches nothing else.

- [ ] **Step 1: Write the failing test**

Create `fleet/tests/test_helpers_hygiene.mjs`:

```javascript
// fleet/tests/test_helpers_hygiene.mjs — the shared drive fixture's option set
// is a pinned list. #413's residue was an option (`installedPluginVersion`)
// that outlived the code it configured by a whole cutover (44e0d15): no test
// passed it, nothing read the cell, and a reader could reasonably conclude the
// drive still cross-checked the installed plugin. A dead option is worse than
// a missing one — it reads as a live seam.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SOURCE = fs.readFileSync(path.join(HERE, '_drive_helpers.mjs'), 'utf8')

// Every option `startStubSandbox` destructures, in source order.
const EXPECTED_OPTIONS = [
  'assignment',
  'runId',
  'receiptSha',
  'exec',
  'branch',
  'receiptPath',
  'rawBranch',
  'publish',
  'gateGreen',
  'clock',
  'invokeRun',
  'stamp',
]

const block = SOURCE.split('const startStubSandbox = ({')[1]
assert.ok(block, 'startStubSandbox factory not found in _drive_helpers.mjs')
const params = block.split('}) =>')[0]
const actual = params
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, '').trim())
  .filter((line) => line && line !== ',')
  .map((line) => line.split(/[:=,]/)[0].trim())
  .filter(Boolean)

assert.deepEqual(
  actual,
  EXPECTED_OPTIONS,
  'startStubSandbox options changed — add or remove the name in EXPECTED_OPTIONS ' +
    'deliberately. An option no caller passes and no source reads is an orphan: ' +
    'delete it rather than pinning it.',
)

// The specific orphan #413 leaves behind, pinned by name so it cannot return.
// Source of truth: drive.mjs:1123-1127 — the installed-plugin cross-check died
// at 0.3.0 with the install it checked.
assert.ok(
  !SOURCE.includes('installedPluginVersion'),
  '_drive_helpers.mjs still carries the installedPluginVersion seam (#413); ' +
    'nothing in fleet/ reads that cell since 44e0d15',
)

console.log('ALL TESTS PASSED')
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node fleet/tests/test_helpers_hygiene.mjs`
Expected: FAIL on the `deepEqual` — `actual` still contains `installedPluginVersion` after `stamp`.

- [ ] **Step 3: Delete the orphan**

In `fleet/tests/_drive_helpers.mjs`, delete the two-line comment and the destructured option at lines 244-245:

```javascript
      // #282 image side (distill P5): the version the sandbox reports as
      // INSTALLED. Null = the stub stamps none (an older shim).
      installedPluginVersion: installedOverride = null,
```

and at line 258 collapse the stamp spread to just the stamp:

```javascript
        const stamp = { ...(stampOverride ?? (await readStamp({ repoDir, exec }))) }
```

- [ ] **Step 4: Run the fleet suite to verify nothing depended on it**

Run: `node fleet/tests/test_helpers_hygiene.mjs && node fleet/tests/test_drive.mjs && node fleet/tests/test_drive_lifecycle.mjs && node fleet/tests/test_drive_pr.mjs`
Expected: each prints `ALL TESTS PASSED`.

- [ ] **Step 5: Commit**

```bash
git add fleet/tests/_drive_helpers.mjs fleet/tests/test_helpers_hygiene.mjs
git commit -m "fix(#413): delete the orphaned installedPluginVersion test seam, pin the factory's option set"
```

---

### Task 4: State the wave cost model in ultraplan (#444 item 1)

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultraplan/SKILL.md`
- Test: `tests/test_ultraplan_skill.py`

**Interfaces:**
- Consumes: nothing
- Produces: nothing consumed by another task.

**Shrink budget: net delta ≤ 0 words** over this task's own diff, verified as word-count(after) − word-count(before) with `wc -w skills/ultraplan/SKILL.md`. The file is 3034 words against a pinned ceiling of 3038 (`tests/test_skill_budget.py`); this task must not spend that headroom.

#443 measured that 54% of the waves we actually run are decomposition shape rather than dependency floor. The four moves that would flatten them are already written in `skills/ultraplan/SKILL.md` §Shape the decomposition — *interrogate every dependency*, *front-load contracts*, *let same-file edits stand*. **The missing piece is the reason.** The skill mentions "overhead" twice and never says what a wave costs, so "interrogate every dependency" reads as tidiness advice when it is worth roughly 90 s of wall clock per edge dropped (≈270 s before #426 put pytest-xdist in the image).

Scope: **item 1 of #444 only.** Do not touch `compile_plan.py` — #444 item 2 (rendering `depth D · dependency floor ceil(T/WIDTH)=F`) belongs to #446 and would land in Task 1's file.

The net-zero is paid by compressing the §Authoring rules "Shrink budgets" bullet, which restates its own derivation at length. Both replacement blocks are given exactly; the arithmetic is item 5: 26 → 64 words (+38), Shrink budgets: 99 → 60 words (−39), net −1.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_ultraplan_skill.py`:

```python
def test_shaping_moves_state_the_wave_cost_model():
    """#444 item 1: the four shaping moves are doctrine without a reason.
    An author who does not know the tail is serial and paid per wave has no
    reason to fight for an edge removal — #443 measured 54% of waves are
    decomposition shape, not dependency floor."""
    text = (ROOT / "skills/ultraplan/SKILL.md").read_text()
    assert "paid once per wave" in text
    assert "billed dimension" in text
    # width is the cheap axis and the skill must say so
    assert "nearly free up to `WIDTH`" in text
```

If `tests/test_ultraplan_skill.py` names its repo root differently, match the module's existing convention.

- [ ] **Step 2: Run it to verify it fails**

Run: `python3 -m pytest tests/test_ultraplan_skill.py -k cost_model -v`
Expected: FAIL on the first assertion.

- [ ] **Step 3: Record the before-count**

Run: `wc -w skills/ultraplan/SKILL.md`
Expected: `3034`. Write it down — Step 6 subtracts from it.

- [ ] **Step 4: Replace move 5 with the cost model**

In `skills/ultraplan/SKILL.md` §Shape the decomposition, replace this line:

```
5. **Right-size against overhead.** Never split below a real unit of work to
   inflate width — worktree overhead and the recommender reward only genuine
   independent mass.
```

with:

```
5. **Right-size against overhead — depth is the billed dimension.** A wave's
   tasks run concurrently, but its tail — fold, full suite pass, adopt — is
   serial and paid once per wave regardless of width. Width is nearly free up
   to `WIDTH`; a dropped `Depends-on` that removes a wave is worth ~90 s. Never
   split below a real unit of work to inflate width.
```

- [ ] **Step 5: Pay for it in the Shrink budgets bullet**

In §Authoring rules, replace this bullet:

```
- **Shrink budgets are acceptance criteria — stated as deltas.** When a
  task edits a complexity-ratcheted surface (SKILL.md, gate-spec docs),
  state the net word delta its own diff implies (`net delta ≤ +N words`,
  or `≤ −N`) — computable from the task's fenced replacement blocks minus
  the text they replace, and verified at task end as word-count(file
  after) − word-count(file before) over the task's own diff. Never state
  an absolute ceiling: it needs the file's current size plus every
  sibling task's delta, and a plan-authored number is a second, unpinned
  copy that drifts — the absolute lives in `tests/test_skill_budget.py`.
```

with:

```
- **Shrink budgets are acceptance criteria — stated as deltas.** When a task
  edits a complexity-ratcheted surface (SKILL.md, gate-spec docs), state the
  net word delta its diff implies (`net delta ≤ +N words`, or `≤ −N`),
  verified at task end as word-count(after) − word-count(before). Never state
  an absolute ceiling — it drifts against sibling deltas; the absolute lives
  in `tests/test_skill_budget.py`.
```

- [ ] **Step 6: Verify the budget and the tests**

Run: `wc -w skills/ultraplan/SKILL.md && python3 -m pytest tests/test_ultraplan_skill.py tests/test_skill_budget.py tests/test_marker_contract.py tests/test_recommendation_rubric.py -v`
Expected: the word count is **≤ 3034** (net delta ≤ 0), and all tests PASS. If the count came out above 3034, trim further inside the two blocks above — do not raise the ceiling in `tests/test_skill_budget.py`, which is a release-only act.

- [ ] **Step 7: Commit**

```bash
git add skills/ultraplan/SKILL.md tests/test_ultraplan_skill.py
git commit -m "docs(#444): state the wave cost model in ultraplan's shaping moves, net-zero"
```

---

### Task 5: Four RUNBOOK corrections found by executing it

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `fleet/RUNBOOK.md`
- Test: `tests/test_runbook_bun.py`

**Interfaces:**
- Consumes: nothing
- Produces: nothing consumed by another task.

`fleet/RUNBOOK.md` is the executable record for the golden VM — it is followed by hand against a live image, so a wrong line there produces a golden that looks healthy and is not. Rebuilding the golden on 2026-08-30 (runs 26–29's image, first rebuild since 2026-08-22) surfaced four defects. Three are checks that cannot fail; the fourth documents a gate leg that no longer exists.

**Correction 1 — the pytest install refuses (line 39).** `python3 -m pip install --user pytest pytest-xdist` now exits non-zero on exeuntu: python3.12 is PEP 668 externally-managed (*"This environment is externally managed"*). pytest itself is already present from `/usr/local/lib/python3.12/dist-packages`, so `python3 -m pytest --version` still answers — an operator following the RUNBOOK gets a golden with no xdist and no signal that anything failed.

**Correction 2 — the cache check measures the wrong thing (line 64).** `du -sh $(bun pm cache)` is run outside a project directory, where `bun pm cache` exits non-zero with *"No package.json was found for directory /home/exedev"*. The command substitution collapses to empty, `du -sh` falls back to `.`, and the step prints a healthy-looking **535M** — the size of `$HOME` — on an image whose Bun cache is cold. A check that cannot fail is not a check.

**Correction 3 — the rebuild collides with the live image.** Step 1 creates a VM named `fleet-golden`, but that VM already exists and every run clones it (`fleet/drive-one.mjs` `DEFAULTS.golden`). Deleting it to make room means a rebuild that fails partway leaves no golden at all. Worse, the from-scratch path never recreates `~/.claude/settings.json` (`permissions.defaultMode: bypassPermissions`, `enabledPlugins`, `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`), so a from-scratch golden silently comes up without them.

**Correction 4 — the versionStamp row documents a dead check (line 485, and the paragraph at line 112).** The §W1d table says versionStamp asks *"does the plugin the sandbox reports as INSTALLED (`claude plugin list --json`, stamped as `installedPluginVersion`) match the pushed manifest?"*. It does not. `drive.mjs:1123-1127`: *"The installed-plugin cross-check died at 0.3.0 with the install it checked: no plugin participates in the run… versionStamp now attests the checkout stamp alone."* This is the same cutover-orphan class as Task 3 and the more damaging half — stale prose tells an operator a gate verifies something it demonstrably does not.

- [ ] **Step 1: Write the four failing tests**

Add to `tests/test_runbook_bun.py`, and update the existing `test_runbook_warms_the_bun_cache_in_the_image` to stop asserting the broken form:

```python
def test_runbook_installs_xdist_past_pep668():
    """exeuntu's python3.12 is externally managed: a plain `pip install --user`
    refuses outright while `pytest --version` still answers from
    dist-packages — a golden with no xdist and no signal. Verified 2026-08-30."""
    assert "--break-system-packages" in RUNBOOK


def test_runbook_proves_xdist_by_import():
    """The install's exit code is not the check; the import is."""
    assert "import xdist" in RUNBOOK


def test_runbook_measures_the_bun_cache_by_path():
    """`du -sh $(bun pm cache)` outside a project dir prints $HOME's size
    (535M measured) instead of failing — a check that cannot fail."""
    assert "du -sh ~/.bun/install/cache" in RUNBOOK
    assert "du -sh \\$(bun pm cache)" not in RUNBOOK
    assert "du -sh $(bun pm cache)" not in RUNBOOK


def test_runbook_documents_build_then_swap():
    """fleet-golden already exists and every run clones it; and the
    from-scratch path never recreates ~/.claude/settings.json."""
    assert "fleet-golden-next" in RUNBOOK
    assert "settings.json" in RUNBOOK


def test_runbook_versionstamp_row_drops_the_dead_installed_check():
    """The installed-plugin cross-check died at 0.3.0 with the install it
    checked (44e0d15); drive.mjs:1123-1127 is the source of truth. Stale prose
    here tells an operator the gate verifies something it does not."""
    assert "installedPluginVersion" not in RUNBOOK
```

Replace the body of the existing `test_runbook_warms_the_bun_cache_in_the_image` with:

```python
def test_runbook_warms_the_bun_cache_in_the_image():
    """#425 item 3: the cache clones with the sandbox, so a target's
    `bun install` is a hardlink operation rather than a registry fetch on
    every run (17 ms offline on the golden, 2026-08-30). `--offline`
    succeeding IS the proof — it cannot pass by silently reaching the
    registry."""
    assert "bun install --offline" in RUNBOOK
```

- [ ] **Step 2: Run them to verify they fail**

Run: `python3 -m pytest tests/test_runbook_bun.py -v`
Expected: the five new/changed tests FAIL; `test_runbook_installs_bun_in_the_golden_build`, `test_runbook_verifies_the_install` and `test_runbook_says_bun_is_for_targets_not_the_driver` still PASS.

- [ ] **Step 3: Fix the pytest install (§Golden VM build)**

Replace the line at `fleet/RUNBOOK.md:39` with:

```
#    `--break-system-packages` is REQUIRED, not optional: exeuntu's python3.12
#    is PEP 668 externally-managed, so a plain `pip install --user` refuses
#    outright ("This environment is externally managed") and the golden comes
#    up without xdist while pytest itself still answers `--version` from
#    /usr/local/lib/python3.12/dist-packages. Verified 2026-08-30.
ssh fleet-golden.exe.xyz 'python3 -m pip install --user --break-system-packages pytest pytest-xdist && python3 -m pytest --version'
ssh fleet-golden.exe.xyz 'python3 -c "import xdist; print(xdist.__version__)"'   # the import is the check, not the install's exit code
```

- [ ] **Step 4: Fix the cache measurement**

Replace the line at `fleet/RUNBOOK.md:64` with:

```
#    Measure the cache by PATH, never by `du -sh $(bun pm cache)`: outside a
#    project dir `bun pm cache` exits non-zero with "No package.json was found",
#    the substitution collapses to empty, and `du -sh` silently measures `.`
#    instead — printing a healthy-looking 535M for $HOME on a golden whose
#    cache is cold. A check that cannot fail is not a check (2026-08-30).
ssh fleet-golden.exe.xyz 'bash -lc "du -sh ~/.bun/install/cache"'   # tens of MB: the cache survives
ssh fleet-golden.exe.xyz 'bash -lc "cd /home/exedev/repo/evals/fixtures/bun-greenfield/project && bun install --offline && rm -rf node_modules bun.lock"'
```

In the comment two lines above it, replace `measured 574 ms, offline` with `measured 574 ms laptop-side and 17 ms on the golden with `--offline` (2026-08-30)`, and add: `` `bun install --offline` succeeding IS the proof the cache is real — it cannot pass by silently reaching the registry. ``

- [ ] **Step 5: Document build-then-swap**

Immediately after the `## Golden VM build` heading, before the existing "One hand-maintained golden VM:" paragraph, insert:

```
**Rebuilding an existing golden: build the replacement, then swap.** Step 1
below creates `fleet-golden` by name, but that VM already exists and every run
clones it (`fleet/drive-one.mjs` `DEFAULTS.golden`). Do NOT `rm` it to make
room — a rebuild that fails partway then leaves no golden and no run can be
provisioned until it is repaired. Instead:

1. `ssh exe.dev "cp fleet-golden fleet-golden-next --json"` and apply the
   deltas to the clone. Prefer this to a from-scratch build: the steps below
   never recreate `~/.claude/settings.json` (`permissions.defaultMode`,
   `enabledPlugins`, `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`), so a from-scratch
   golden silently comes up without them. The clone inherits the `fleet` tag,
   which the orchestrator's tag-scoped key needs in order to `cp` it.
2. Verify: every check in this section, run against `fleet-golden-next`.
3. Prove it with a real run: `node fleet/drive-one.mjs … --golden fleet-golden-next`.
4. Only then `ssh exe.dev "rm fleet-golden"` and
   `ssh exe.dev "rename fleet-golden-next fleet-golden"`. Renaming keeps the
   `drive-one` default correct with no code change.
```

- [ ] **Step 6: Correct the versionStamp row and the §W1e paragraph**

In the §W1d field table (`fleet/RUNBOOK.md:485`), replace the `versionStamp` cell's question with:

```
| `versionStamp` | Is the run row stamped with `pluginVersion` + `engineSha` read from the pushed base ref inside the sandbox, and do they match what the driver pushed (#282)? The installed-plugin half died at 0.3.0 with the install it checked (`drive.mjs:1123-1127`): no plugin participates in the run, and comparing the golden's bootstrap plugin to the pushed manifest would go permanently red at the first release bump. versionStamp attests the checkout stamp alone. |
```

In the paragraph at `fleet/RUNBOOK.md:112`, replace the sentence *"The `installedPluginVersion` cell the drive's `versionStamp` leg reads is stamped from the post-install `claude plugin list`, so it names the pushed manifest by construction."* with:

```
The per-run re-install means the engine under test is the pushed base by
construction; the drive's `versionStamp` leg attests the checkout stamp
(`pluginVersion` + `engineSha`), not the installed plugin — that half died at
0.3.0 (`drive.mjs:1123-1127`). Consequences:
```

Leave the following bullet list unchanged.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_runbook_bun.py tests/test_report_runbook.py tests/test_fleet_readme.py -v`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add fleet/RUNBOOK.md tests/test_runbook_bun.py
git commit -m "fix(fleet): four RUNBOOK corrections found by executing it — PEP 668, the cache check that cannot fail, build-then-swap, the dead installed-plugin leg"
```

---

### Task 6: Suite gate

**Type:** gate
**Depends-on:** 1, 2, 3, 4, 5

**Files:**
- none

- [ ] **Step 1: Run the full suite**

Run: `python3 -m pytest`
Expected: all tests pass, including `tests/test_fleet_suite.py` (which bridges every `fleet/tests/test_*.mjs`, the new `test_helpers_hygiene.mjs` included) and `tests/test_skill_budget.py`.

- [ ] **Step 2: Validate the skills still pass their own validator**

Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan`
Expected: both print their OK line.

## Operator smoke

- **do:** `python3 skills/ultrapowers/scripts/compile_plan.py --check docs/superpowers/plans/2026-08-30-papercuts-slate.md`
  **see:** `PLAN OK` — this plan still checks clean under its own new rule.

- **do:** Make a scratch copy of any marked plan and delete its `**Acceptance:**` line, then run `--check` on the copy.
  **see:** exit 2 and `1 violation(s)`, with a message naming the missing `**Acceptance:**` line — instead of the `PLAN OK` it printed before.

- **do:** `python3 evals/ab_runner.py --help`
  **see:** the `--test-cmd` help says the detection ladder decides by default — not `python3 -m pytest`.

- **do:** `grep -n "installedPluginVersion" fleet/RUNBOOK.md fleet/tests/_drive_helpers.mjs`
  **see:** no matches in either file.

- **do:** Open `fleet/RUNBOOK.md` to §Golden VM build and read the first paragraph.
  **see:** it tells you to build `fleet-golden-next` and swap, and warns that a from-scratch build drops `~/.claude/settings.json` — the two things that would have cost a golden on 2026-08-30.

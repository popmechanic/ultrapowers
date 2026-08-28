# One Driver Phase 0 — P0a Subtraction Implementation Plan (#371)

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the shared-laptop guards, the sealing subsystem and the viewer from the current engine — exactly the spec's "P0a — subtraction" half of One Driver Phase 0 (ledger rows 1, 2, 3, 4, 5, 7, 8, 9, 11) — and swap the one guard the phase adds (`ultra_run.py`'s fail-closed `fleet-run` stage) for the #129 `launch-checkout` guard it replaces. Refs #371 (this plan does NOT close #371 — P0b and run C do).

**Architecture:** Three `implementation` tasks in one wave, file-disjoint except for one file the spec names as shared (`skills/ultrapowers/scripts/ultra_gate.py` — disjoint hunks, `Commutes:` declared per the spec) and one it did not (`tests/test_ultra_gate.py` — T1 and T2 edit regions more than twenty lines apart, so git's three-way merge composes them without a conflict; no `Commutes:`). The spec's other shared file, `evals/ab_runner.py`, is Task 1's alone: its seal-import block (row 7) sits on the line directly above the harness-manifest import (row 5), so one task owns both lines rather than handing the kernel an adjacent-hunk conflict. Task 1 is the engine-script subtraction: `run_lock.sh` / `sweep_worktrees.sh` / `hygiene_check.sh` / `residual_manifest.py` / `salvage_args.py` / `redirect_args.py` / `check_engine_skew.sh` / `harness_manifest.py` / `probe.js` + its manifest / ultradocket's `record_wf_run.py` go, with their tests; `ultra_run.py` loses `launch-checkout`, `engine-skew`, `scratch-hygiene`'s prune, `disk-headroom`, `lock`, `worktree-audit` and the `PROBE` payload and gains `fleet-run` as its first stage; `ultra_gate.py` loses the lock release, `--teardown`, the approve sweep and the `wf-runs.json` record; `gate_check.py` loses its `lock` check and lock-path context (the one periphery edit); `hooks/session_start.sh` copies `waves.js` by name; `ab_runner.py` loses the probe, the manifest reader and (row 7, pulled in for hunk adjacency) its `seal_hash` import, which becomes a literal `suite_hash = None`. Task 2 is the sealing cut: `collect_seal.py`, `seal_hash.py`, `agents/seal-author.md`, `run_acceptance.sh`'s `sealed` + `--baseline` modes (the `--suite-gate` half stays byte-identical in behavior), `ultra_gate.py`'s sealed dispatch becomes `BLOCKED`. Task 3 is the viewer cut: `skills/ultrapowers/viewer/`, `render_viewer.py`, `serve_viewer.py`, `swarm_watch.py`, the four viewer `.mjs` specs and their pytest shims, and `test_js_specs.py` trimmed to the three engine sims. Every deletion cites its spec ledger row; nothing else changes.

**Tech Stack:** Python 3 scripts under `skills/ultrapowers/scripts/` (stdlib only), bash (`hooks/session_start.sh`, `run_acceptance.sh`), pytest under `tests/`, node ESM sims under `tests/*.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-28-one-driver-phase-0.md` (§Deletion ledger rows 1–11, §The one mechanism, §Delivery shape "P0a"), read against the frozen inputs file `docs/superpowers/specs/2026-08-28-one-driver-design-inputs.md` §Deletion ledger and map #366 §Rules. Line numbers below are at `main` `42734e8`.

**Acceptance:** suite — the committed pytest suite plus per-task review is the verification; every task carries a `Test:` entry naming the surviving test files it must keep green. No sealed exam (this plan deletes the machinery that would administer one).

## Rules for implementers (off-spec = stop and report, never improvise)

- **Never edit** `skills/ultrapowers/harnesses/waves.js`, `skills/ultrapowers/kernel/**`, `skills/ultrapowers/references/wave-merge.md`, `skills/ultrapowers/references/reviewer-prompts.md`, or `skills/ultrapowers/scripts/compile_plan.py`. They still name `sweep_worktrees.sh`, `RUN_LOCK`, `wf-runs`, `ultrapowers-probe` in comments and one error string — that stale prose is licensed until the port (spec §Not trimmed this phase). A task that "needs" to touch them is off-spec.
- **Never add a guard.** Phase 0 swaps one (`fleet-run` for `launch-checkout`) and adds none. No new check, no new refusal path beyond the ones this plan names, no new test that pins behavior the plan did not prescribe.
- **P0b's files are out of bounds:** `skills/ultrapowers/SKILL.md`, `skills/ultraplan/**`, `skills/ultradocket/SKILL.md`, `README.md`, `CLAUDE.md`, `fleet/**`, `skills/ultrapowers/references/*.md`, `.claude-plugin/*.json`, `tests/test_skill_budget.py`, `tests/test_recommendation_rubric.py`. Do not touch them even where they name a script this plan deletes.
- **Deletions are `git rm`** of the whole file (and, for `skills/ultrapowers/viewer/`, the whole directory). Every deleted path appears under `**Files:**` as a `Modify:` line (the compiler's grammar has no `Delete:` label); the task body says which are deletions.
- **Frozen periphery:** `gate_check.py` changes ONLY by deleting its `lock` check and the `lock` context key (row 1). `run_acceptance.sh --suite-gate` behavior is byte-identical after Task 2 (same flags, same JSON, same exit codes, same stderr warning).

## Ordering: this plan runs AFTER P0b, on P0b's merged base

`skills/ultrapowers/scripts/validate_skill.py` resolves every `scripts/<file>` and `skills/<name>/scripts/<file>` token in a `SKILL.md` body against disk (lines 31–38), and today's `skills/ultrapowers/SKILL.md` / `skills/ultradocket/SKILL.md` name scripts this plan deletes. So this plan is driven **after** P0b (`docs/superpowers/plans/2026-08-28-one-driver-phase-0b-texts.md`) has merged, with `--base-ref` on that merged base: P0b's SKILL.md and ultradocket text name only the surviving script set, and P0b's T4 deletes the two SKILL.md-prose pins (`tests/test_terminal_teardown.py`, `tests/test_skill_wf_run_record.py`) that this plan's deletions would otherwise strand. On that base `validate_skill.py` and the whole suite are green here; line numbers in the task bodies are still the ones at `42734e8` — P0b touches none of the files this plan edits, so they hold.

## Global Constraints

- Trust core untouched: receipts at shas, exit-code authority, the standing directive, park-by-default, human merge on the PR. No PR that weakens a receipt (map #366 §Rules).
- No new guard without a deletion in the same PR; this plan's one swap is `ultra_run.py` `fleet-run` replacing `launch-checkout` (rows 9 and §The one mechanism).
- `waves.js`, `kernel/`, `wave-merge.md`, `reviewer-prompts.md`, `compile_plan.py` are not edited — a task that needs to is off-spec.
- `run_acceptance.sh`'s `--suite-gate` half and every `gate_check.py` check except the `lock` check are not edited by this phase.
- No direct Anthropic API calls, no `anthropic` SDK, no `ANTHROPIC_API_KEY` anywhere in repo code.
- `skills/ultrapowers/scripts/` ends this plan at exactly 13 entries (26 today − 13 deletions: `run_lock.sh`, `sweep_worktrees.sh`, `hygiene_check.sh`, `residual_manifest.py`, `salvage_args.py`, `redirect_args.py`, `check_engine_skew.sh`, `harness_manifest.py`, `collect_seal.py`, `seal_hash.py`, `render_viewer.py`, `serve_viewer.py`, `swarm_watch.py`); the spec's bar is ≤ 16.
- The `fleet-run` refusal text is exactly: ``ULTRAPOWERS_FLEET_RUN is unset — `/ultrapowers` runs only inside a fleet sandbox — launch `drive-one` on the orchestrator``. The sealed-gate refusal text is exactly: `sealed acceptance is not administered — Phase 0 row 7`.
- Every deleted file's tests go with it; every surviving test module named in a task's `Test:` line is green at task end.

---

### Task 1: Engine-script subtraction (rows 1, 2, 3, 4, 5, 9, 11) + the `fleet-run` stage

**Type:** implementation
**Depends-on:** none
**Review:** adversarial
**Commutes:** `skills/ultrapowers/scripts/ultra_gate.py`

**Files:**
- Modify: `skills/ultrapowers/scripts/run_lock.sh`
- Modify: `skills/ultrapowers/scripts/sweep_worktrees.sh`
- Modify: `skills/ultrapowers/scripts/hygiene_check.sh`
- Modify: `skills/ultrapowers/scripts/residual_manifest.py`
- Modify: `skills/ultrapowers/scripts/salvage_args.py`
- Modify: `skills/ultrapowers/scripts/redirect_args.py`
- Modify: `skills/ultrapowers/scripts/check_engine_skew.sh`
- Modify: `skills/ultrapowers/scripts/harness_manifest.py`
- Modify: `skills/ultrapowers/harnesses/probe.js`
- Modify: `skills/ultrapowers/harnesses/probe.harness.json`
- Modify: `skills/ultradocket/scripts/record_wf_run.py`
- Modify: `skills/ultrapowers/scripts/ultra_run.py`
- Modify: `skills/ultrapowers/scripts/ultra_gate.py`
- Modify: `skills/ultrapowers/scripts/gate_check.py`
- Modify: `hooks/session_start.sh`
- Modify: `evals/ab_runner.py`
- Test: `tests/test_run_lock.py`
- Test: `tests/test_sweep_worktrees.py`
- Test: `tests/test_hygiene_check.py`
- Test: `tests/test_residual_manifest.py`
- Test: `tests/test_salvage_args.py`
- Test: `tests/test_redirect_args.py`
- Test: `tests/test_engine_skew.py`
- Test: `tests/test_harness_manifest.py`
- Test: `tests/test_probe.py`
- Test: `tests/test_record_wf_run.py`
- Test: `tests/test_ultra_run.py`
- Test: `tests/test_ultra_gate.py`
- Test: `tests/test_gate_check.py`
- Test: `tests/test_session_hook.py`
- Test: `tests/test_harness_registry.py`
- Test: `tests/test_ab_runner.py`
- Test: `tests/test_ab_runner_isolation.py`
- Test: `tests/test_harvest_runs.py`

**Interfaces:**
- Consumes: nothing from a sibling task — everything this task edits exists at BASE.
- Produces: `ultra_run.py` stage `fleet-run` (first stage; reads `os.environ["ULTRAPOWERS_FLEET_RUN"]`, stripped; success detail `"fleet run <value>"`; failure detail the Global Constraints refusal text); the surviving stage order `fleet-run, git-repo, worktree-probe, superpowers-compat, compile, test-command, install, dirty-baseline, base-branch`; the run receipt without `lockId` and `probe`; `ultra_gate.py --approve --stamp S [--branch B]` → stdout JSON exactly `{"mode": "approve", "stamp": S, "branch": B}` exit 0 (checkout only); `ultra_gate.py` gate receipt without `wfRuns`; `gate_check.py` verdict JSON without the `lock` check and without the `lock` context key (`--run-id` is still accepted so `ultra_gate.py`'s call is unchanged); `hooks/session_start.sh` installs `waves.js` by name; `ab_runner.seed_workflows(engine_wt, workdir)` copies `skills/ultrapowers/harnesses/waves.js` by name and `sys.exit`s naming the path when it is absent; `ab_runner.drive_run(workdir, plan, env)` no longer probes; the seal-hash module attribute in `evals/ab_runner.py` is the literal None (row 7 — flat-suite seal entries carry no seal id and the installer skips them).

**Parallelization rationale:** the three tasks are independent subtractions of disjoint subsystems (shared-checkout guards / sealing / viewer); each is green on its own tests without the others, so they run as one wave. One file (`ultra_gate.py`) is shared with Task 2 by the spec's own delivery shape, at named disjoint regions; `evals/ab_runner.py` is this task's alone.

**Commutes body note (audited by review):** this task's edits to `skills/ultrapowers/scripts/ultra_gate.py` are lines 1–19 (docstring), 24 (`import re`), 31–68, 100–104, 112–168, 186–190. Task 2's are lines 211–217 only — more than twenty lines from the nearest edit here, so git composes the two sides without a conflict; the declaration is belt for the kernel (order-insensitive disjoint deletions; the assume rung in `skills/ultrapowers/kernel/hunks.py` `union_replies` unions only all-`added` conflicts, so if a conflict ever did open it would reach a resolver with the contract line — keep both sides' deletions). `evals/ab_runner.py` is NOT shared: Task 2 does not touch it.

**Deletions (whole files, `git rm`):**

- row 1: `skills/ultrapowers/scripts/run_lock.sh`, `tests/test_run_lock.py`. (`tests/test_terminal_teardown.py` pins SKILL.md prose and is deleted by P0b-T4 with the SKILL.md rewrite — already gone on this plan's base.)
- row 2: `skills/ultrapowers/scripts/sweep_worktrees.sh`, `tests/test_sweep_worktrees.py`, `skills/ultradocket/scripts/record_wf_run.py` (it imports `ultra_gate.load_wf_runs`, which dies in this task), `tests/test_record_wf_run.py`. (`tests/test_skill_wf_run_record.py` pins SKILL.md prose and is deleted by P0b-T4 — already gone on this plan's base.)
- row 3: `skills/ultrapowers/scripts/hygiene_check.sh`, `tests/test_hygiene_check.py`, `skills/ultrapowers/scripts/residual_manifest.py`, `tests/test_residual_manifest.py`.
- row 4: `skills/ultrapowers/scripts/salvage_args.py`, `tests/test_salvage_args.py`, `skills/ultrapowers/scripts/redirect_args.py`, `tests/test_redirect_args.py`.
- row 5: `skills/ultrapowers/harnesses/probe.js`, `skills/ultrapowers/harnesses/probe.harness.json`, `tests/test_probe.py`, `skills/ultrapowers/scripts/check_engine_skew.sh`, `tests/test_engine_skew.py`, `skills/ultrapowers/scripts/harness_manifest.py`, `tests/test_harness_manifest.py`.
- row 7 (one edit, not a file): `evals/ab_runner.py`'s `seal_hash` import block (lines 42–50) — owned here because it is the line directly above the row-5 `harness_manifest` import (line 51); Task 2 deletes `seal_hash.py` itself.

Not deleted (stated so the reviewer does not flag the omission): `skills/ultrapowers/harnesses/waves.harness.json` stays — the spec's ledger does not name it, `ultra_run.py`'s `install` stage still installs from the manifest glob (unchanged), and `tests/test_harness_registry.py`'s manifest test still reads it. `tests/fixtures/args-probe.js` stays — it is a `waves.js` args-shape fixture (`meta.name` `args-probe`), not the `ultrapowers-probe` harness.

- [ ] **Step 1: Delete the files listed above**

```bash
git rm skills/ultrapowers/scripts/run_lock.sh tests/test_run_lock.py \
       skills/ultrapowers/scripts/sweep_worktrees.sh tests/test_sweep_worktrees.py \
       skills/ultradocket/scripts/record_wf_run.py tests/test_record_wf_run.py \
       skills/ultrapowers/scripts/hygiene_check.sh tests/test_hygiene_check.py \
       skills/ultrapowers/scripts/residual_manifest.py tests/test_residual_manifest.py \
       skills/ultrapowers/scripts/salvage_args.py tests/test_salvage_args.py \
       skills/ultrapowers/scripts/redirect_args.py tests/test_redirect_args.py \
       skills/ultrapowers/harnesses/probe.js skills/ultrapowers/harnesses/probe.harness.json tests/test_probe.py \
       skills/ultrapowers/scripts/check_engine_skew.sh tests/test_engine_skew.py \
       skills/ultrapowers/scripts/harness_manifest.py tests/test_harness_manifest.py
```

- [ ] **Step 2: Write the failing `ultra_run.py` tests (rows 1, 5, 9, 11 + the `fleet-run` stage)**

Edit `tests/test_ultra_run.py`:

1. Line 17: delete `from ultra_run import prune_run_dirs  # noqa: E402` (`prune_run_dirs` dies with the prune, row 11). Keep `detect_test_cmd`.
2. After `RUN = SCRIPTS / "ultra_run.py"` (line 15) add the fleet environment every launch-pipeline invocation must carry, and let `sh` forward an env:

```python
# One Driver Phase 0: the launch pipeline refuses unless the shim's env var is
# set. Every driver invocation in this file runs as the engine session.
FLEET_ENV = dict(os.environ, ULTRAPOWERS_FLEET_RUN="run-test")


def sh(cmd, cwd=None, check=True, env=None):
    return subprocess.run(cmd, cwd=cwd, check=check, capture_output=True,
                          text=True, env=env)


def run_driver(repo, *extra):
    return sh([sys.executable, str(RUN), "plan.md", "--stamp", "t1", *extra],
              cwd=repo, check=False, env=FLEET_ENV)
```

   (This replaces the existing `sh` at lines 29–30 and `run_driver` at lines 47–49.) `--validate-knobs` invocations (`run_validate_knobs`, the SIGTERM test) stay env-less: that mode returns before the stage pipeline and is unchanged.

3. Replace `test_happy_path_receipt` (lines 52–87) with:

```python
def test_happy_path_receipt(tmp_path):
    repo = make_repo(tmp_path)
    r = run_driver(repo)
    assert r.returncode == 0, r.stdout + r.stderr
    receipt = json.loads(r.stdout)
    assert receipt["ok"] is True
    assert all(s["ok"] for s in receipt["stages"])
    # The surviving stages, in the order spec §Engine lists them (Phase 0).
    assert [s["stage"] for s in receipt["stages"]] == [
        "fleet-run", "git-repo", "worktree-probe", "superpowers-compat",
        "compile", "test-command", "install", "dirty-baseline", "base-branch"]
    assert receipt["stages"][0]["detail"] == "fleet run run-test"
    run_dir = repo / ".claude/ultrapowers/run-t1"
    assert (run_dir / "receipt.json").is_file()
    assert (run_dir / "launch.json").is_file()
    assert (run_dir / "args.json").is_file()
    # Knob contract (#89): slots ride the args wave entries the engine reads;
    # the launch file carries bodies + context only.
    launch = json.loads((run_dir / "launch.json").read_text())
    assert all("tier" not in t and "review" not in t for t in launch["tasks"])
    skel = json.loads((run_dir / "args.json").read_text())
    entries = [t for wave in skel["waves"] for t in wave]
    assert entries and all(t["tier"] is None for t in entries)
    assert all(t["review"] in ("lean", "adversarial") for t in entries)
    assert any("waves[][].tier" in d for d in receipt["llmDerives"])
    assert (repo / ".claude/ultrapowers/DIRTY_SNAPSHOT").is_file()
    # the state dir still self-ignores (structural, not the deleted prune)
    assert (repo / ".claude/ultrapowers/.gitignore").read_text() == "*\n"
    # Phase 0 rows 1 and 5: no lock, no probe contract.
    assert not (repo / ".claude/ultrapowers/RUN_LOCK").exists()
    assert "lockId" not in receipt and "probe" not in receipt
    assert receipt["workflowName"] == "ultrapowers-run"
    assert receipt["testCmd"] == "python3 -m pytest"
```

4. In `test_not_a_git_repo_fails_first_stage` (line 123) and `test_failure_details_survive_not_a_repo` (line 481), add `env=FLEET_ENV` to the `sh([...])` call so the refusal they pin is still the git-repo one. Rename the first to `test_not_a_git_repo_fails_the_git_repo_stage` and add `assert receipt["stages"][0]["stage"] == "fleet-run"` before its existing `stages[-1] == "git-repo"` assertion (`fleet-run` passes first; git-repo is still the LAST, failing stage).
5. Delete these tests wholesale: `test_worktree_isolated_launch_fails_closed` (131–148, row 9), `test_primary_checkout_launch_passes_launch_checkout_stage` (150–155, row 9), `test_held_lock_fails_lock_stage` (158–165, row 1), `test_state_dir_self_ignores_and_prunes_old_runs` (275–299, row 11), `test_prune_run_dirs_keeps_newest_including_a_live_run` (312–341, row 11), `test_prune_failure_absent_from_removed_list_and_named_in_stage_detail` (589–629, row 11), `test_preflight_surfaces_worktree_audit_without_blocking` (634–651, row 2), `test_preflight_audit_is_clean_on_a_clean_repo` (654–661, row 2), and the whole `#151` disk-headroom section from the comment at line 757 through `test_disk_headroom_stage_runs_right_after_compile` (879), including `GIB`, `WIDE_PLAN`, `make_wide_repo`, `run_main_with_free`, `headroom_stage` (row 11).
6. Append the refusal case:

```python
# --- One Driver Phase 0 §The one mechanism: fleet-run is the first stage ---

@pytest.mark.parametrize("value", [None, "", "   "])
def test_unset_fleet_run_refuses_before_any_other_stage(tmp_path, value):
    """ULTRAPOWERS_FLEET_RUN unset (or blank) means a laptop session is trying
    to run the engine locally. The first stage refuses; nothing else runs and
    no run dir is minted (replaces the #129 launch-checkout guard, row 9)."""
    repo = make_repo(tmp_path)
    env = {k: v for k, v in os.environ.items() if k != "ULTRAPOWERS_FLEET_RUN"}
    if value is not None:
        env["ULTRAPOWERS_FLEET_RUN"] = value
    r = sh([sys.executable, str(RUN), "plan.md", "--stamp", "t1"],
           cwd=repo, check=False, env=env)
    assert r.returncode != 0
    receipt = json.loads(r.stdout)
    assert receipt["ok"] is False
    assert [s["stage"] for s in receipt["stages"]] == ["fleet-run"]
    assert receipt["stages"][0]["ok"] is False
    detail = receipt["stages"][0]["detail"]
    assert "`/ultrapowers` runs only inside a fleet sandbox" in detail
    assert "launch `drive-one` on the orchestrator" in detail
    assert not (repo / ".claude/ultrapowers/run-t1").exists()
```

- [ ] **Step 3: Run the ultra_run tests to verify they fail**

Run: `python3 -m pytest tests/test_ultra_run.py -q`
Expected: FAIL — `test_happy_path_receipt` (stage list contains `launch-checkout`, `engine-skew`, …; `lockId` present), `test_unset_fleet_run_refuses_before_any_other_stage` (no `fleet-run` stage).

- [ ] **Step 4: Cut `ultra_run.py`**

Edit `skills/ultrapowers/scripts/ultra_run.py`:

1. Replace the module docstring (lines 1–17) with:

```python
"""Deterministic pre-launch driver for /ultrapowers (SKILL.md §Engine).

One invocation runs every deterministic pre-launch stage in order, fail-closed:
fleet-run (the sandbox env contract), git-repo check, worktree-capability
probe, superpowers compatibility, plan compile, test-command derivation,
committed-workflow install, dirty baseline, and baseBranch from the launched
checkout.

The receipt (stdout + .claude/ultrapowers/run-<stamp>/receipt.json) is the
contract: the orchestrator reads it instead of re-deriving the choreography
from prose. Exit 0 iff every stage passed; otherwise the last receipt stage
names what failed. The driver never launches the workflow — only the
orchestrator can call tools; `llmDerives` names exactly what it still owns.
"""
```

2. Delete line 33 (`PLUGIN_ROOT = HERE.parents[2]`, row 5), lines 35–71 (`RUN_DIR_RE`, `KEEP_RUNS`, the `#151` headroom constants `GIB`/`HEADROOM_PER_TASK`/`HEADROOM_FLOOR`, `_run_dirs`, `_doomed`, `prune_run_dirs` — rows 11), and lines 104–107 (`PROBE`, row 5). Keep `HARNESSES`, `re` (used by `detect_test_cmd`), `shutil`, `signal`, `os`.
3. In `validate_knobs`, replace the comment at lines 239–240 (`SIGKILL cannot be caught — sweep_worktrees.sh reaps a probe whose pid is gone.`) with `SIGKILL cannot be caught — the sandbox is disposable (Phase 0 row 2).`
4. In `main()`, immediately after the `bail()` definition (line 331) and BEFORE the `git rev-parse --show-toplevel` call (line 333), insert the new first stage:

```python
    # One Driver Phase 0 (#371): every /ultrapowers run is a fleet run. The
    # shim sets ULTRAPOWERS_FLEET_RUN=<runId> in the engine process's env; an
    # unset or blank value means a laptop session is trying to run the engine
    # locally — refuse before any cost. Replaces the #129 launch-checkout
    # guard (row 9), which protected a long-lived laptop checkout.
    fleet_run = os.environ.get("ULTRAPOWERS_FLEET_RUN", "").strip()
    if not stage("fleet-run", bool(fleet_run),
                 success="fleet run " + fleet_run,
                 failure="ULTRAPOWERS_FLEET_RUN is unset — `/ultrapowers` runs "
                         "only inside a fleet sandbox — launch `drive-one` on "
                         "the orchestrator"):
        return bail()
```

5. Delete the `#129` launch-checkout block, lines 340–355 (comment through `return bail()`, row 9).
6. Delete the engine-skew block, lines 372–388 (`# Self-host skew` through `stage("engine-skew", True, success="skipped — not self-hosting")`, row 5).
7. Replace the scratch-hygiene block, lines 398–416, with just the structural self-ignore (the keep-10 prune dies, row 11; no stage entry):

```python
    # The state dir self-ignores (content `*`) so every run dir is structurally
    # invisible to git in any repo — gate_check's clean-tree check depends on
    # it. Nothing is pruned: one sandbox per run, rm'd (Phase 0 rows 2, 11).
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / ".gitignore").write_text("*\n")
```

8. Delete the disk-headroom block, lines 435–464 (`# Disk headroom (#151)` comment through the `else: stage("disk-headroom", True, success="ok: " + headroom)`, row 11).
9. Delete the lock stage, lines 505–509 (`r = sh(["bash", str(HERE / "run_lock.sh"), "acquire", stamp], cwd=root)` through its `return bail()`, row 1).
10. Delete the janitor advisory, lines 519–526 (comment through `stage("worktree-audit", …)`, row 2).
11. Replace the receipt update at lines 544–548 with:

```python
    receipt.update({"ok": True, "baseBranch": base,
                    "launchFile": str(launch), "argsFile": str(args_file),
                    "workflowName": "ultrapowers-run",
                    "llmDerives": LLM_DERIVES,
                    "testCmd": test_cmd, "testCmdSource": test_src})
```

   (`lockId` gone with row 1, `probe` with row 5.) The `install` stage (lines 493–503) is unchanged: it still installs from `HARNESSES.glob("*.harness.json")`, which now yields only `waves.harness.json`.

- [ ] **Step 5: Run the ultra_run tests to verify they pass**

Run: `python3 -m pytest tests/test_ultra_run.py -q`
Expected: PASS (all remaining tests, including the three refusal parametrizations).

- [ ] **Step 6: Write the failing `gate_check.py` / `ultra_gate.py` tests (rows 1, 2)**

Edit `tests/test_gate_check.py`:

1. Replace the comment at lines 32–33 with `# .claude/ is the driver's state dir (untracked); ignore it or the clean-tree check sees the run dir as dirt — mirrors the real repo's .gitignore.` and delete line 44 (`sh(["bash", str(SCRIPTS / "run_lock.sh"), "acquire", "wf_test"], cwd=repo)`).
2. Delete `test_lock_mismatch_blocks` (lines 82–86).
3. Replace `test_verdict_echoes_repo_and_lock_context` (lines 215–226) with:

```python
def test_verdict_echoes_repo_context_and_no_lock(tmp_path):
    """A wrong-cwd invocation must be self-diagnosing (2026-07-03 distill:
    mislocated gate_check produced a spurious BLOCKED). The lock context key
    died with RUN_LOCK (One Driver Phase 0, row 1)."""
    repo, head = make_repo(tmp_path)
    report = tmp_path / "report.json"
    report.write_text(json.dumps(good_report(head)))
    r = sh([sys.executable, str(GATE), "--run-id", "wf_test",
            "--branch", "ultra/int", "--report", str(report),
            "--repo", str(repo)], check=False)
    out = json.loads(r.stdout)
    assert out["repo"] == str(repo.resolve())
    assert "lock" not in out
    assert [c["name"] for c in out["checks"]] == [
        "report-parse", "clean-tree", "wave-merges", "head-match",
        "git-verified", "ancestry", "deliverables"]
```

Edit `tests/test_ultra_gate.py` (this task's regions: lines 1–10, 52–62, 212–232, 335–531; Task 2 owns lines 152–189 and must not be touched here):

1. Replace the docstring's second sentence (lines 2–4) with `Runs against a throwaway git repo with a stubbed run_acceptance.sh so acceptance DISPATCH is tested without a real vault. gate_check.py and the envelope unwrap are exercised for real.`
2. In `make_repo`, replace lines 54–56 (the copy loop) with `for f in ("ultra_gate.py", "gate_check.py"): shutil.copy2(SCRIPTS / f, scripts / f)` and delete lines 61–62 (the `# the pre-launch state …` comment and the `run_lock.sh acquire` call).
3. Delete `test_teardown_releases_lock_keeps_worktrees` (lines 212–220, row 1).
4. Replace `test_approve_checks_out_branch_and_releases` (lines 223–231) with:

```python
def test_approve_checks_out_branch_and_prints_the_approve_receipt(tmp_path):
    """Approve = checkout only (Phase 0 rows 1–2: no lock, no sweep). The
    printed JSON is what the orchestrator saves verbatim to
    run-<stamp>/approve-receipt.json; the shim greens only on a matching stamp."""
    repo, scripts, _ = make_repo(tmp_path)
    r = sh([sys.executable, str(scripts / "ultra_gate.py"),
            "--stamp", "t1", "--approve", "--branch", "ultra/int"],
           cwd=repo, check=False)
    assert r.returncode == 0, r.stdout + r.stderr
    cur = sh(["git", "branch", "--show-current"], cwd=repo).stdout.strip()
    assert cur == "ultra/int"
    assert json.loads(r.stdout) == {"mode": "approve", "stamp": "t1",
                                    "branch": "ultra/int"}
    assert not (repo / ".claude/ultrapowers/RUN_LOCK").exists()


def test_teardown_and_wf_run_flags_are_gone(tmp_path):
    """Rows 1–2: --teardown (lock release) and --wf-run (sweep belt) died
    with the lock and the sweep; argparse refuses them."""
    repo, scripts, _ = make_repo(tmp_path)
    for flag in (["--teardown"], ["--approve", "--branch", "ultra/int",
                                  "--wf-run", "wf_x"]):
        r = sh([sys.executable, str(scripts / "ultra_gate.py"),
                "--stamp", "t1", *flag], cwd=repo, check=False)
        assert r.returncode == 2, flag
        assert "unrecognized arguments" in r.stderr
```

5. Delete the whole `requirement 1` section from the comment at line 335 through the end of `test_gate_surfaces_and_rebuilds_unreadable_wf_runs_record` (line 531): `add_worktree`, `test_gate_records_every_launch_wf_run_id`, `test_gate_skips_unparseable_branches_without_failing`, `test_approve_sweeps_every_recorded_run_id_plus_stamp`, `test_approve_without_records_still_sweeps_the_stamp`, `test_approve_wf_run_flag_is_still_honored_as_belt`, `test_record_wf_runs_accepts_an_odd_shaped_runtime_id`, `test_record_wf_runs_never_records_the_integration_stamp_id`, `test_approve_reports_a_failed_sweep_and_exits_nonzero`, `test_teardown_names_the_recorded_run_ids`, `test_approve_fails_loud_on_unreadable_wf_runs_record`, `test_gate_surfaces_and_rebuilds_unreadable_wf_runs_record` (row 2). In `test_envelope_unwrap_and_pass` (line 108) add `assert "wfRuns" not in out`.
6. Leave `_run_gate`'s `fake_sh` (lines 264–278) and `test_gate_issues_no_run_lock_restore` (290–298) as they are: the `run_lock.sh` branch in the fake is now dead but harmless, and the `#104` pin (no subprocess names `restore`) still holds.

- [ ] **Step 7: Run the gate tests to verify they fail**

Run: `python3 -m pytest tests/test_gate_check.py tests/test_ultra_gate.py -q`
Expected: FAIL — `test_verdict_echoes_repo_context_and_no_lock` (`lock` key present, `lock` check present), `test_approve_checks_out_branch_and_prints_the_approve_receipt` (approve JSON carries `swept`/`lockReleased`), `test_teardown_and_wf_run_flags_are_gone` (flags accepted), plus `make_repo` now copies no `run_lock.sh` so approve's lock release subprocess fails.

- [ ] **Step 8: Cut `gate_check.py` (the one periphery edit, row 1) and `ultra_gate.py` (rows 1, 2)**

`skills/ultrapowers/scripts/gate_check.py`:

1. Lines 11–13 of the docstring: replace `and does not release locks or sweep worktrees (explicit orchestrator actions on this verdict).` with `.` (end the sentence after `per disposition)`).
2. Replace lines 50–51 with `context = {"repo": str(a.repo.resolve())}`.
3. Delete lines 68–72 (the `run_lock.sh check` call and the `lock` check). `--run-id` stays a required argument (unused after this deletion) so `ultra_gate.py`'s call contract is byte-identical. Nothing else in the file changes.

`skills/ultrapowers/scripts/ultra_gate.py`:

1. Replace the docstring (lines 1–19) with:

```python
"""Deterministic gate driver for /ultrapowers (SKILL.md §Engine).

Gate mode (--result): unwrap the Workflow tool envelope (gate fields live
under result.* — report-format.md), save the report verbatim, run
gate_check.py, then administer acceptance per the disposition recorded in the
ultra_run receipt. Exit 0 PASS / 2 NEEDS_ACK / 1 BLOCKED; a failed acceptance
always forces 1. The driver never decides — the orchestrator renders the
receipt and applies the two-move rule. Gate mode moves no checkout: the
verdict is checkout-position-independent (#104).

--approve: checkout the integration branch and print the approve receipt
({mode, stamp, branch}); the orchestrator saves that JSON verbatim to
run-<stamp>/approve-receipt.json. No lock release, no sweep — the sandbox is
disposable (One Driver Phase 0, rows 1–2).
"""
```

2. Delete line 24 (`import re`) and lines 31–68 (`WF_RUN_RE`, `load_wf_runs`, `record_wf_runs` — row 2).
3. Delete lines 100–104 (`--teardown`, `--wf-run` arguments — rows 1, 2) and line 112 (`lock = ["bash", str(HERE / "run_lock.sh")]` — row 1).
4. Delete the teardown block, lines 114–124 (row 1).
5. Replace the approve block, lines 126–168, with:

```python
    if a.approve:
        branch = a.branch
        report_file = run_dir / "report.json"
        if not branch and report_file.is_file():
            branch = json.loads(report_file.read_text()).get("integrationBranch")
        if not branch:
            return blocked({"mode": "approve", "stamp": a.stamp},
                           "no integration branch (--branch or saved report)")
        r = sh(["git", "checkout", branch], cwd=root)
        if r.returncode != 0:
            return blocked({"mode": "approve", "stamp": a.stamp}, r.stderr)
        print(json.dumps({"mode": "approve", "stamp": a.stamp, "branch": branch},
                         indent=2))
        return 0
```

6. Delete lines 186–190 (the `# Record before gate_check runs` comment, the `record_wf_runs` call and the `wfRunsUnreadable` branch — row 2). Lines 211–217 (the sealed dispatch) are Task 2's — do not touch them.

- [ ] **Step 9: Run the gate tests to verify they pass**

Run: `python3 -m pytest tests/test_gate_check.py tests/test_ultra_gate.py -q`
Expected: PASS for every test this task kept or added. `test_sealed_acceptance_dispatch` and `test_failed_acceptance_forces_blocked` (Task 2's region) still pass at this point because the sealed dispatch is untouched here.

- [ ] **Step 10: Write the failing hook / registry / eval-kit / harvester tests (rows 2, 5)**

`tests/test_session_hook.py`:

1. Replace `test_session_start_installs_saved_workflows_before_registry_snapshot` (lines 44–65) with:

```python
def test_session_start_installs_waves_js_before_registry_snapshot():
    # The engine snapshots its saved-workflow registry at session start, so the
    # hook installs the harness THEN (CLAUDE_PROJECT_DIR/.claude/workflows).
    # The set is fixed — waves.js, copied by name; the manifest reader died with
    # the registry probe (One Driver Phase 0, row 5).
    with tempfile.TemporaryDirectory() as proj:
        p = subprocess.run(["bash", str(ROOT / "hooks/session_start.sh")],
                           capture_output=True, text=True,
                           env={"CLAUDE_PROJECT_DIR": proj, "PATH": _path()})
        assert p.returncode == 0, p.stderr
        installed = pathlib.Path(proj) / ".claude" / "workflows" / "waves.js"
        assert installed.exists(), "hook did not install waves.js"
        # meta.name must survive the copy — that is what the engine resolves by.
        name = re.search(r"meta\s*=\s*\{.*?name:\s*'([^']+)'",
                         installed.read_text(), re.S)
        assert name and name.group(1) == "ultrapowers-run"
```

2. Replace `test_session_start_install_is_idempotent` (lines 124–136) with:

```python
def test_session_start_install_is_idempotent():
    with tempfile.TemporaryDirectory() as proj:
        for _ in range(2):
            p = subprocess.run(["bash", str(ROOT / "hooks/session_start.sh")],
                               capture_output=True, text=True,
                               env={"CLAUDE_PROJECT_DIR": proj, "PATH": _path()})
            assert p.returncode == 0, p.stderr
        installed = pathlib.Path(proj) / ".claude" / "workflows" / "waves.js"
        assert installed.read_text() == (
            ROOT / "skills/ultrapowers/harnesses/waves.js").read_text()
```

3. Delete `test_session_start_gc_noops_on_reader_failure` (lines 139–159): there is no reader any more. `test_session_start_gcs_stale_workflow` (110–121) stays as the GC pin (fixed set `{waves.js}`); the `json` import (line 7) becomes unused only if nothing else in the file uses it — `test_hooks_json_uses_plugin_wrapper_format_and_plugin_root` does, so keep it.

`tests/test_harness_registry.py`:

1. After `HARNESSES = …` (line 9) add `WAVES = HARNESSES / "waves.js"`.
2. Replace `test_at_least_the_two_core_harnesses_registered` (lines 22–24) with:

```python
def test_the_engine_harness_is_ultrapowers_run():
    """Read from waves.js's meta.name directly — the manifest reader died with
    the registry probe (One Driver Phase 0, row 5); the harness file is the
    authority. `ultrapowers-run` alone: the probe harness is gone."""
    assert meta_name(WAVES) == "ultrapowers-run"
    assert sorted(p.name for p in HARNESSES.glob("*.js")) == ["waves.js"]
```

3. In `test_no_writeside_harness_shadows_the_ultrapowers_command`, add as its first statement (before the `for m in manifests():` loop) `assert meta_name(WAVES) != "ultrapowers"` so the collision pin no longer depends on a manifest existing. `test_every_manifest_points_to_a_matching_harness` stays unchanged (it now iterates the one surviving manifest).

`tests/test_ab_runner.py`: replace `test_seed_workflows_refuses_problem_manifests_before_copying` (lines 112–129) with (add `import subprocess` and `import pytest` beside the existing imports at lines 3–5):

```python
def test_seed_workflows_copies_waves_js_by_name(tmp_path):
    # Phase 0 row 5: the harness set is fixed; waves.js is copied by name and
    # nothing else under harnesses/ is seeded.
    engine = tmp_path / "engine"
    h = engine / "skills/ultrapowers/harnesses"
    h.mkdir(parents=True)
    (h / "waves.js").write_text("// harness\n")
    (h / "stray.js").write_text("// not a harness\n")
    workdir = tmp_path / "run"
    workdir.mkdir()
    subprocess.run(["git", "init", "-q", str(workdir)], check=True)
    ab_runner.seed_workflows(engine, workdir)
    assert (workdir / ".claude/workflows/waves.js").read_text() == "// harness\n"
    assert not (workdir / ".claude/workflows/stray.js").exists()


def test_seed_workflows_refuses_a_missing_waves_js(tmp_path):
    # The old "no manifests → refuse an unprobeable cell" guard, narrowed to
    # the one file: a silent zero-seed would make the cell compare execution
    # modes, not engines.
    engine = tmp_path / "engine"
    (engine / "skills/ultrapowers/harnesses").mkdir(parents=True)
    workdir = tmp_path / "run"
    workdir.mkdir()
    with pytest.raises(SystemExit) as e:
        ab_runner.seed_workflows(engine, workdir)
    assert "waves.js" in str(e.value)
    assert not (workdir / ".claude/workflows").exists() or \
        not list((workdir / ".claude/workflows").iterdir())
```

`tests/test_ab_runner_isolation.py`: replace `test_probe_and_drive_carry_the_isolated_env` (lines 50–62) with:

```python
def test_drive_carries_the_isolated_env(tmp_path, monkeypatch):
    # The probe died with the registry snapshot (Phase 0 row 5); the drive is
    # the only claude spawn left and must carry the cell's isolated env.
    cap = Capture()
    monkeypatch.setattr(ab.subprocess, "run", cap)
    env = {"CLAUDE_CONFIG_DIR": str(tmp_path / "cell/claude-config"), "PATH": "/usr/bin"}
    (tmp_path / ".headless-result.json").write_text("{}")
    ab.drive_run(tmp_path, {"planPath": "docs/plans/plan.md"}, env)
    calls = claude_calls(cap)
    assert calls, "drive spawned no claude at all — wiring broke"
    for cmd, kw in calls:
        got = kw.get("env", {}).get("CLAUDE_CONFIG_DIR", "")
        assert got == env["CLAUDE_CONFIG_DIR"]
```

`tests/test_harvest_runs.py`: the `#150 mode (c)` fixtures at lines 1167–1183 are generated by invoking `record_wf_run.py stamp`, which this task deletes (row 2). The READER (`_drain_stamp_receipts` in `skills/ultralearn/scripts/harvest_runs.py`, lines 563-575) stays and its seven call sites keep their signature. Replace lines 1167–1183 (the comment block, `RECORD_WF_RUN`, and `_write_stamp_record`) with:

```python
# --- #150 mode (c), reader side: drain-administered gate terminus via the
# stamp mirror. The writer (ultradocket's record_wf_run.py) died with the
# drain's wf-run choreography (One Driver Phase 0, row 2); the reader stays,
# so these fixtures spell the record schema out literally — the last shape
# the writer produced. `_drain_stamp_receipts` keys on `stamp`/`entry`/
# `verdict`; the ancestry join reads `headSha` (when the branch resolved),
# `branch` and `base`.

def _write_stamp_record(repo, stamp, entry, verdict, exit_code, branch, base):
    head = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "--verify", branch + "^{commit}"],
        capture_output=True, text=True)
    record = {"mode": "drain-stamp", "stamp": stamp, "entry": entry,
              "verdict": verdict, "gateExit": exit_code,
              "branch": branch, "base": base,
              "recordedAt": "2026-08-28T00:00:00+00:00"}
    if head.returncode == 0:
        record["headSha"] = head.stdout.strip()
    receipts = repo / ".claude/ultrapowers/receipts"
    receipts.mkdir(parents=True, exist_ok=True)
    (receipts / ("%s-%s.json" % (stamp, entry))).write_text(
        json.dumps(record, indent=2))
```

(`json` and `subprocess` are already imported at the top of the file.)

- [ ] **Step 11: Run those tests to verify they fail**

Run: `python3 -m pytest tests/test_session_hook.py tests/test_harness_registry.py tests/test_ab_runner.py tests/test_ab_runner_isolation.py tests/test_harvest_runs.py -q`
Expected: FAIL — the hook tests (the hook still calls the deleted `harness_manifest.py`, so nothing installs), `test_the_engine_harness_is_ultrapowers_run` (passes already — `probe.js` is gone since Step 1; that is fine), `test_seed_workflows_*` (`ab_runner` fails to import: `harness_manifest` is gone), `test_drive_carries_the_isolated_env` (same import error). `test_harvest_runs.py` passes already (the inline writer replaced the deleted script) — that is the intended green.

- [ ] **Step 12: Rewrite the hook's install block and cut the eval kit's probe (row 5)**

`hooks/session_start.sh`: replace lines 9–51 (the comment block and the whole `( … ) >/dev/null 2>&1 || true` subshell) with:

```bash
# Install the committed harness as a project saved workflow NOW, at session
# start, so the Workflow engine picks it up when it snapshots its saved-
# workflow registry (built once per session; a mid-session copy registers
# only NEXT session). The harness set is fixed — waves.js (`ultrapowers-run`),
# copied by name; the manifest reader died with the registry probe (One
# Driver Phase 0, row 5). Guarded so it can NEVER break the hook's real
# contract — emitting the routing rule below; all output is swallowed.
(
  set +eu
  plugin_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  harnesses="$plugin_root/skills/ultrapowers/harnesses"
  dest="${CLAUDE_PROJECT_DIR:-$PWD}/.claude/workflows"
  mkdir -p "$dest"
  f=waves.js
  if [ -e "$harnesses/$f" ]; then
    # Skip the copy when the installed copy is byte-identical (the common
    # no-change session) — avoids an unconditional 74KB write every start.
    cmp -s "$harnesses/$f" "$dest/$f" 2>/dev/null || cp "$harnesses/$f" "$dest/$f"
    # GC only once the install landed: remove any other .js in the workflows
    # dir — stale orphans from older plugin versions (workflow.js from 0.0.6,
    # probe.js from before Phase 0) would otherwise shadow the harness.
    if [ -e "$dest/$f" ]; then
      for existing in "$dest"/*.js; do
        [ -e "$existing" ] || continue
        [ "$(basename "$existing")" = "$f" ] || rm -f "$existing"
      done
    fi
  fi
) >/dev/null 2>&1 || true
```

The routing-rule heredoc (lines 53–77) is untouched.

`evals/ab_runner.py` (this task's regions only — see the Commutes note):

1. Line 5: replace `the headless `claude -p` drive + workflow probe` with `the headless `claude -p` drive`.
2. Replace lines 42–51 (the `# seal_hash is the ONE canonical …` comment, `_SCRIPTS`, the `sys.path` insertion, the `try: from seal_hash import suite_hash … except ImportError: suite_hash = None` block, and the `harness_manifest` import) with:

```python
# seal_hash died with the sealing subsystem (One Driver Phase 0, row 7): the
# fixtures keep their `sealed` lines as inert data, discover_seals records no
# hash (sealId None → install_seals skips the entry), and nothing here ever
# administers an exam. The eval kit's execution half is deferred to the port.
# harness_manifest died with the registry probe (row 5): seed_workflows copies
# waves.js by name.
suite_hash = None
```

   (`_SCRIPTS` and the `sys.path` insertion go too — no engine module is imported here any more. `Path` and `sys` stay imported; other code uses them.)
3. Delete lines 289–295 (the `# The probe payload …` comment and `PROBE_PROMPT`).
4. Replace `seed_workflows` (lines 466–502) with:

```python
def seed_workflows(engine_wt, workdir):
    """Pre-seed the pinned engine's saved workflow into the run repo BEFORE
    any claude process starts (2026-08-09 A/B): headless print mode races the
    SessionStart hook — the Workflow engine's saved-workflow registry snapshots
    before the hook's harness copy lands. Files already on disk always make
    the snapshot. The harness set is fixed — waves.js (`ultrapowers-run`),
    copied by name (One Driver Phase 0, row 5). Also excludes `.claude/` via
    git's info/exclude so dirt measurements stay scoped to the repo's own
    files — a deliberate SUPERSET of the production four-subdir gitignore
    contract, since fixture repos ship no .gitignore of their own."""
    wf = Path(workdir) / ".claude/workflows"
    harness = Path(engine_wt) / "skills/ultrapowers/harnesses/waves.js"
    if not harness.is_file():
        # A silent zero-seed would make the cell compare execution modes, not
        # engines — the old no-manifests refusal, narrowed to the one file.
        sys.exit("seed_workflows: %s absent — refusing an unlaunchable cell"
                 % harness)
    wf.mkdir(parents=True, exist_ok=True)
    shutil.copy2(harness, wf / "waves.js")
    # Resolve info/exclude through git (worktree-style .git files are not dirs).
    gp = subprocess.run(["git", "rev-parse", "--git-path", "info/exclude"],
                        cwd=str(workdir), capture_output=True, text=True,
                        check=True, env=_git_env())
    exclude = Path(workdir) / gp.stdout.strip()
    exclude.parent.mkdir(parents=True, exist_ok=True)
    with open(exclude, "a") as x:
        x.write(".claude/\n")
```

5. Delete `probe_workflow` (lines 504–518).
6. In `drive_run` (line 521 on): replace the docstring (522–527) with `"""Drive one headless /ultrapowers run to the pre-merge gate and return (transcript_path, gate_report, mode). `env` is the cell's isolated mapping (#107)."""` and delete the probe block, lines 529–535 (`if not probe_workflow(workdir, env): sys.exit(…)`). Keep `arm_overlap = …` (line 528) and everything from `result_path = …` (line 536) on.

- [ ] **Step 13: Run those tests to verify they pass**

Run: `python3 -m pytest tests/test_session_hook.py tests/test_harness_registry.py tests/test_ab_runner.py tests/test_ab_runner_isolation.py tests/test_ab_arm_identity.py tests/test_harvest_runs.py -q`
Expected: PASS.

- [ ] **Step 14: Full task verification**

Run: `python3 -m pytest tests/test_ultra_run.py tests/test_ultra_gate.py tests/test_gate_check.py tests/test_session_hook.py tests/test_harness_registry.py tests/test_ab_runner.py tests/test_ab_runner_isolation.py tests/test_ab_arm_identity.py tests/test_harvest_runs.py tests/test_ultra_run_overlap.py tests/test_finalize_wiring.py tests/test_canary.py -q`
Expected: PASS. Then `ls skills/ultrapowers/scripts | wc -l` → 18 at task end (26 − 8 from this task; Task 2 and Task 3 remove 5 more), and `grep -rn "run_lock\|sweep_worktrees\|harness_manifest\|check_engine_skew\|record_wf_run\|ultrapowers-probe\|PROBE_PROMPT" skills/ultrapowers/scripts hooks evals/ab_runner.py` prints nothing (the only surviving mentions are in `waves.js`, `references/*.md` and the SKILL.md files, all off-limits).

- [ ] **Step 15: Commit**

```bash
git add -A skills/ultrapowers/scripts skills/ultrapowers/harnesses skills/ultradocket/scripts hooks/session_start.sh evals/ab_runner.py tests
git commit -m "phase0(P0a) T1: delete the shared-checkout guards (rows 1-5, 9, 11); fleet-run replaces launch-checkout (#371)"
```

---

### Task 2: Sealing cut (row 7)

**Type:** implementation
**Depends-on:** none
**Commutes:** `skills/ultrapowers/scripts/ultra_gate.py`

**Files:**
- Modify: `skills/ultrapowers/scripts/collect_seal.py`
- Modify: `skills/ultrapowers/scripts/seal_hash.py`
- Modify: `agents/seal-author.md`
- Modify: `skills/ultrapowers/scripts/run_acceptance.sh`
- Modify: `skills/ultrapowers/scripts/ultra_gate.py`
- Test: `tests/test_collect_seal.py`
- Test: `tests/test_async_sealing.py`
- Test: `tests/test_fixture_seals.py`
- Test: `tests/test_run_acceptance.py`
- Test: `tests/test_ultra_gate.py`

**Interfaces:**
- Consumes: nothing from a sibling task — everything this task edits exists at BASE.
- Produces: `run_acceptance.sh` accepts ONLY `--suite-gate …` (any other first argument prints `usage: run_acceptance.sh --suite-gate --branch BRANCH [--run CMD] [--bootstrap CMD] [--base REF] [--repo DIR]` to stderr and exits 2, printing nothing on stdout); `ultra_gate.py` gate mode on a receipt whose `compile.acceptance.mode == "sealed"` writes `run-<stamp>/gate-receipt.json` with `verdict: "BLOCKED"` and `acceptance: {"disposition": "sealed", "exit": null, "reason": "sealed acceptance is not administered — Phase 0 row 7"}`, exit 1, without invoking `run_acceptance.sh`.

**Commutes body note (audited by review):** this task's edit to `skills/ultrapowers/scripts/ultra_gate.py` is lines 211–217 only (the sealed dispatch); Task 1's are lines 1–19, 24, 31–68, 100–104, 112–168, 186–190 — more than twenty lines away, so git composes the two sides without a conflict and the declaration is belt. Its edits to `tests/test_ultra_gate.py` are lines 152–161 and 180–189 only; Task 1's regions there are 1–10, 52–62, 212–232, 335–531 — likewise far apart, no `Commutes:` needed on that file. This task does NOT touch `evals/ab_runner.py` (its `seal_hash` import block is Task 1's, for hunk adjacency); deleting `seal_hash.py` alone is safe because that block's `except ImportError` already falls back to `suite_hash = None`.

**Deletions (whole files, `git rm`) — all row 7:** `skills/ultrapowers/scripts/collect_seal.py`, `skills/ultrapowers/scripts/seal_hash.py`, `agents/seal-author.md` (no `agents` key in `plugin.json`; auto-discovered, so deleting the file suffices), `tests/test_collect_seal.py`, `tests/test_async_sealing.py`, `tests/test_fixture_seals.py`. NOT touched: `skills/ultraplan/**` (ultraplan's sealing step and `references/seal-author-prompt.md` are P0b's), the fixtures' `**Acceptance:** sealed …` lines under `evals/fixtures/*/plan.md` (inert data; the compiler's vocabulary is frozen), `evals/ab_runner.py` (Task 1 owns its `seal_hash` import block; `install_seals` / `discover_seals` stay and, with `suite_hash = None`, install nothing).

- [ ] **Step 1: Delete the files**

```bash
git rm skills/ultrapowers/scripts/collect_seal.py skills/ultrapowers/scripts/seal_hash.py agents/seal-author.md \
       tests/test_collect_seal.py tests/test_async_sealing.py tests/test_fixture_seals.py
```

- [ ] **Step 2: Write the failing tests**

`tests/test_run_acceptance.py` — keep the `--suite-gate` tests exactly as they are; delete every sealed/baseline test and helper; add the refusal pin:

1. Delete line 15 (`HASH = SCRIPTS / "seal_hash.py"`).
2. Delete `make_vault` (39–64), `administer` (67–70), and every test from `test_hash_is_stable_and_content_sensitive` (73) through `test_baseline_mode_surfaces_bootstrap_error` (357) inclusive — that is the sealed exam tests, `_set_run_cmd`, `_write_manifest`, `baseline`, `_bare_suite` and the three baseline tests.
3. Delete `run_acceptance` (362–366), `test_non_pytest_green_suite_certifies` (369–378), `test_non_pytest_red_suite_is_assertion` (381–388) — they administer sealed exams.
4. Delete the `baseline --manifest` section from the comment at line 573 through `test_manifest_first_nonpytest_seal_certifies_at_gate` (701): `write_draft`, `make_pytest_suite`, `SH_RUNNER`, `make_sh_suite`, `baseline_manifest` and the six tests. Delete the legacy-seal section (703–716).
5. Delete `test_sealed_exam_survives_symlinked_tmpdir` (833–846) and `test_baseline_survives_symlinked_tmpdir` (849–871). Keep `test_suite_gate_survives_symlinked_tmpdir`, `test_uncreatable_temp_parent_errors_instead_of_using_cwd`, the `#105` whitespace tests, `make_repo`, `make_suite_repo`, `suite_gate`, `make_js_suite_repo`, `_branch_editing`, the three sim bodies, `_suite_gate`, `PATH_IDENTITY_TEST`, `_mk_path_identity_repo`, `_symlinked_tmpdir_env`. Update the module docstring (lines 1–2) to `"""The committed-suite gate (run_acceptance.sh --suite-gate), e2e against a throwaway git repo. The sealed exam and --baseline modes died with the sealing subsystem (One Driver Phase 0, row 7)."""`.
6. Append, after `test_suite_gate_worktree_cleaned_up`:

```python
# ── One Driver Phase 0, row 7: the sealed and --baseline modes are gone ──────

@pytest.mark.parametrize("argv", [
    ["abc123def456", "main", "d" * 64],                      # old sealed form
    ["--baseline", "--suite", "s", "--branch", "main", "--run", "true"],
])
def test_deleted_modes_are_refused_with_usage(tmp_path, argv):
    """Any invocation that is not --suite-gate is a usage error: exit 2, the
    usage line on stderr, NOTHING on stdout (no JSON receipt a caller could
    mistake for a verdict)."""
    repo = make_repo(tmp_path, feature_built=True)
    r = sh(["bash", str(RUN), *argv, "--repo", str(repo)], check=False)
    assert r.returncode == 2
    assert "usage: run_acceptance.sh --suite-gate" in r.stderr
    assert r.stdout == ""
```

`tests/test_ultra_gate.py` (this task's regions only: lines 152–161 and 180–189):

1. Replace `test_sealed_acceptance_dispatch` (152–161) with:

```python
def test_sealed_disposition_is_blocked_without_administering(tmp_path):
    """Phase 0 row 7: sealed acceptance is no longer administered. The gate
    BLOCKS with the gate receipt as the terminal artifact and never invokes
    run_acceptance.sh (the stub would have echoed STUB into the output)."""
    repo, scripts, head = make_repo(tmp_path, acceptance_mode="sealed")
    result = tmp_path / "result.json"
    result.write_text(json.dumps(good_report(head)))
    r = run_gate(repo, scripts, result)
    out = json.loads(r.stdout)
    assert r.returncode == 1
    assert out["verdict"] == "BLOCKED"
    assert out["acceptance"] == {
        "disposition": "sealed", "exit": None,
        "reason": "sealed acceptance is not administered — Phase 0 row 7"}
    assert "STUB" not in r.stdout
    saved = json.loads((repo / ".claude/ultrapowers/run-t1/gate-receipt.json")
                       .read_text())
    assert saved["verdict"] == "BLOCKED"
```

2. Replace `test_failed_acceptance_forces_blocked` (180–189) with the same test on the suite disposition (the sealed one no longer dispatches anything to fail):

```python
def test_failed_acceptance_forces_blocked(tmp_path):
    repo, scripts, head = make_repo(tmp_path, acceptance_mode="suite",
                                    receipt_extra={"testCmd": "make check"})
    (scripts / "run_acceptance.sh").write_text(
        "#!/usr/bin/env bash\necho RED\nexit 1\n")
    (scripts / "run_acceptance.sh").chmod(0o755)
    result = tmp_path / "result.json"
    result.write_text(json.dumps(good_report(head)))
    r = run_gate(repo, scripts, result)
    assert r.returncode == 1
    assert json.loads(r.stdout)["verdict"] == "BLOCKED"
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_run_acceptance.py tests/test_ultra_gate.py -q`
Expected: FAIL — `test_deleted_modes_are_refused_with_usage[argv0]` (the sealed form still runs and emits `SEAL_MISSING` JSON on stdout), `[argv1]` (baseline still parses), `test_sealed_disposition_is_blocked_without_administering` (verdict PASS via the stub). `python3 -m pytest tests/test_ab_runner.py -q` stays green throughout: the deleted `seal_hash` trips the existing `except ImportError` fallback (Task 1 replaces that block with the literal).

- [ ] **Step 4: Cut `run_acceptance.sh` to its `--suite-gate` half**

`skills/ultrapowers/scripts/run_acceptance.sh`:

1. Replace lines 1–13 (header comment) with:

```bash
#!/usr/bin/env bash
# Administer the committed-suite gate for a suite-disposition plan.
# Deterministic: no agents, no interpretation. Emits exactly one JSON object on
# stdout. Exit 0 iff the suite passed (and, when --base is given and harness JS
# changed, the harness sims passed too).
#
# Usage: run_acceptance.sh --suite-gate --branch BRANCH [--run CMD]
#                          [--bootstrap CMD] [--base REF] [--repo DIR]
# The sealed-exam and --baseline modes died with the sealing subsystem
# (One Driver Phase 0, row 7); any other invocation is a usage error (exit 2).
```

2. Replace lines 16–74 (the variable defaults and the three-way argument parse) with:

```bash
SEAL_ID="(suite)"; BRANCH=""
REPO="$(pwd)"
SG_RUN="python3 -m pytest"
SG_BASE=""; SG_BOOT=""
MODE="suite-gate"
if [ "${1:-}" = "--suite-gate" ]; then
  shift
  while [ $# -gt 0 ]; do
    case "$1" in
      --branch)    BRANCH="$2";  shift 2 ;;
      --run)       SG_RUN="$2";  shift 2 ;;
      --base)      SG_BASE="$2"; shift 2 ;;
      --bootstrap) SG_BOOT="$2"; shift 2 ;;
      --repo)      REPO="$2";    shift 2 ;;
      *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
  done
  : "${BRANCH:?--suite-gate requires --branch}"
  if [ -z "$SG_BASE" ]; then
    echo "run_acceptance: warning — --suite-gate without --base: harness-JS sim guard disarmed (a branch that changed harnesses/*.js rides a Python-only green; pass --base <ref> to arm it)" >&2
  fi
else
  echo "usage: run_acceptance.sh --suite-gate --branch BRANCH [--run CMD] [--bootstrap CMD] [--base REF] [--repo DIR]" >&2
  exit 2
fi
```

   (`set -uo pipefail` at line 14 stays where it is, above this block. The `--suite-gate` arm's case list and warning text are byte-identical to today's lines 48–61.)

3. Delete line 75 (`HERE="$(cd "$(dirname "$0")" && pwd)"` — its only use was the `seal_hash.py` call).
4. Keep `emit` (77–93) byte-identical. Replace the comment at lines 95–98 with `# Suite-gate worktree bookkeeping: cleanup removes the detached worktree and its temp parent on every exit.`; keep `EXAM_WT=""`, `cleanup`, `trap cleanup EXIT` (99–106) and `provision_worktree` (108–119) byte-identical.
5. Delete `run_exam` (lines 121–195) and `read_manifest` (197–212): their only callers were the sealed path and `--baseline`.
6. Keep `run_js_sims` (214–268) and the `--suite-gate` block (270–320) byte-identical, including the `if [ "$MODE" = "suite-gate" ]; then … fi` wrapper (MODE is now always `suite-gate`; leaving the wrapper keeps the block's diff empty).
7. Delete the baseline block (322–362) and the sealed gate path (364–401) — everything after the suite-gate block's closing `fi`. The file ends at that `fi`.

- [ ] **Step 5: Make `ultra_gate.py` BLOCK a sealed disposition**

`skills/ultrapowers/scripts/ultra_gate.py`: replace lines 211–217 (`if mode == "sealed":` through `acc_pass = r.returncode == 0`) with:

```python
    if mode == "sealed":
        # One Driver Phase 0, row 7: sealed acceptance is not administered.
        # run_acceptance.sh's sealed mode is gone, so nothing is dispatched;
        # the gate receipt below is the terminal artifact (BLOCKED).
        acceptance = {"disposition": "sealed", "exit": None,
                      "reason": "sealed acceptance is not administered — "
                                "Phase 0 row 7"}
        acc_pass = False
```

The `elif mode == "waived":` / `else:` arms and everything after are untouched (the existing `not acc_pass` branch at line 240 yields `verdict: BLOCKED`, exit 1, and writes `gate-receipt.json`). Nothing else in this file changes; lines 1–190 are Task 1's.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_run_acceptance.py tests/test_ultra_gate.py tests/test_ab_runner.py tests/test_ab_runner_isolation.py tests/test_ab_arm_identity.py -q`
Expected: PASS. Also `bash skills/ultrapowers/scripts/run_acceptance.sh --suite-gate --branch main --run "python3 -m pytest tests/test_run_acceptance.py -q" --base main` from the repo root prints one JSON object with `"passed": true` (the suite-gate half is intact end-to-end).

- [ ] **Step 7: Commit**

```bash
git add -A skills/ultrapowers/scripts agents tests
git commit -m "phase0(P0a) T2: delete the sealing subsystem; sealed disposition is BLOCKED at the gate (row 7, #371)"
```

---

### Task 3: Viewer cut (row 8)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/viewer/README.md`
- Modify: `skills/ultrapowers/viewer/audit_project.js`
- Modify: `skills/ultrapowers/viewer/swarm_layout.js`
- Modify: `skills/ultrapowers/viewer/swarm_template.html`
- Modify: `skills/ultrapowers/viewer/swarm_zoom.js`
- Modify: `skills/ultrapowers/viewer/vendor/README.md`
- Modify: `skills/ultrapowers/viewer/vendor/d3-dag.cjs.min.js`
- Modify: `skills/ultrapowers/viewer/vendor/d3-dag.iife.min.js`
- Modify: `skills/ultrapowers/viewer/vendor/d3-zoom.cjs.min.js`
- Modify: `skills/ultrapowers/viewer/vendor/d3-zoom.iife.min.js`
- Modify: `skills/ultrapowers/scripts/render_viewer.py`
- Modify: `skills/ultrapowers/scripts/serve_viewer.py`
- Modify: `skills/ultrapowers/scripts/swarm_watch.py`
- Test: `tests/swarm_layout_spec.mjs`
- Test: `tests/swarm_meso_spec.mjs`
- Test: `tests/swarm_zoom_spec.mjs`
- Test: `tests/audit_project_spec.mjs`
- Test: `tests/test_viewer.py`
- Test: `tests/test_serve_viewer.py`
- Test: `tests/test_swarm_agents.py`
- Test: `tests/test_swarm_wiring.py`
- Test: `tests/test_js_specs.py`

**Interfaces:**
- Consumes: nothing from a sibling task — everything this task edits exists at BASE.
- Produces: the `SPECS` list in `tests/test_js_specs.py` names only the three engine sims (`wave_ancestry_sim.mjs`, `sim_workflow.mjs`, `sim_base_ancestry.mjs`, each gated on the sentinel ALL SCENARIOS PASSED); no `skills/ultrapowers/viewer/` directory.

**Deletions (whole files, `git rm`) — all row 8:** the entire `skills/ultrapowers/viewer/` directory (ten tracked files listed above, vendored d3 included), `skills/ultrapowers/scripts/render_viewer.py`, `skills/ultrapowers/scripts/serve_viewer.py`, `skills/ultrapowers/scripts/swarm_watch.py`, `tests/swarm_layout_spec.mjs`, `tests/swarm_meso_spec.mjs`, `tests/swarm_zoom_spec.mjs`, `tests/audit_project_spec.mjs`, `tests/test_viewer.py`, `tests/test_serve_viewer.py`, `tests/test_swarm_agents.py`, `tests/test_swarm_wiring.py`. Checked and NOT touched: `tests/test_skill_budget.py` and `validate_skill.py` do not reference the viewer; `run_acceptance.sh`'s comment `Excludes the viewer specs (which reference viewer/)` at line 238 is prose in Task 2's file and stays (its sim-discovery grep on `harnesses/` is unaffected); the SKILL.md Step 4 viewer offer and `report-format.md` item 12 are P0b's; `tests/test_residual_manifest.py`, which named `viewer/`, is deleted by Task 1.

- [ ] **Step 1: Write the failing test — trim `tests/test_js_specs.py` to the engine sims**

Replace the file's docstring and `SPECS` (lines 1–24) with:

```python
"""One parametrized runner for the committed node engine sims. Requires node;
skips without it.

wave_ancestry_sim and sim_workflow run here so the #70 ancestry contract and
the workflow simulation sit in the default `pytest` and CI, not only behind
the harness-JS suite-gate. Sentinels are load-bearing: run_acceptance.sh
--suite-gate greps `ALL (SCENARIOS|TESTS) PASSED`. The four viewer specs died
with the viewer (One Driver Phase 0, row 8)."""
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]

SPECS = [
    ("wave_ancestry_sim.mjs", "ALL SCENARIOS PASSED"),
    ("sim_workflow.mjs", "ALL SCENARIOS PASSED"),
    ("sim_base_ancestry.mjs", "ALL SCENARIOS PASSED"),
]
```

The `test_js_spec` function (lines 27–35) is unchanged. Also append one structural pin so a viewer file cannot quietly return:

```python
def test_no_viewer_left_behind():
    """Phase 0 row 8: the viewer directory, its three scripts and its four
    specs are gone; nothing under tests/ references `viewer/` any more."""
    assert not (ROOT / "skills/ultrapowers/viewer").exists()
    for name in ("render_viewer.py", "serve_viewer.py", "swarm_watch.py"):
        assert not (ROOT / "skills/ultrapowers/scripts" / name).exists(), name
    for spec in ("swarm_layout_spec.mjs", "swarm_meso_spec.mjs",
                 "swarm_zoom_spec.mjs", "audit_project_spec.mjs"):
        assert not (ROOT / "tests" / spec).exists(), spec
    assert not [p for p in (ROOT / "tests").glob("*.py")
                if "viewer/" in p.read_text()]
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python3 -m pytest tests/test_js_specs.py -q`
Expected: FAIL on `test_no_viewer_left_behind` (the viewer still exists); the three sims pass.

- [ ] **Step 3: Delete the viewer**

```bash
git rm -r skills/ultrapowers/viewer
git rm skills/ultrapowers/scripts/render_viewer.py skills/ultrapowers/scripts/serve_viewer.py skills/ultrapowers/scripts/swarm_watch.py \
       tests/swarm_layout_spec.mjs tests/swarm_meso_spec.mjs tests/swarm_zoom_spec.mjs tests/audit_project_spec.mjs \
       tests/test_viewer.py tests/test_serve_viewer.py tests/test_swarm_agents.py tests/test_swarm_wiring.py
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 -m pytest tests/test_js_specs.py tests/test_no_prompt_drift.py tests/test_compile_plan.py -q`
Expected: PASS (`test_no_prompt_drift` and `test_compile_plan` mention "reviewer"/"viewer" only in prose and are unaffected — run them to prove it). Then `grep -rln "viewer/\|render_viewer\|serve_viewer\|swarm_watch" skills/ultrapowers/scripts tests hooks evals/ab_runner.py` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add -A skills/ultrapowers tests
git commit -m "phase0(P0a) T3: delete the viewer (row 8, #371)"
```

---

## Self-review (author)

- Spec coverage, row by row: 1 (T1: `run_lock.sh`, `RUN_LOCK`, `lock` stage, gate lock release, `gate_check.py` lock check + context, `test_run_lock`; `test_terminal_teardown`, the shim's `RUN_LOCK` read and CLAUDE.md are P0b's), 2 (T1: `sweep_worktrees.sh`, `wf-runs.json`, `record_wf_run.py` + `test_record_wf_run`, `--teardown` + sweep, `worktree-audit`, `wf_<stamp>`/`--wf-run`; `test_skill_wf_run_record` is P0b's; the harvester's read is now an empty glob — its reader tests write the record inline), 3 (T1: `hygiene_check.sh`, `residual_manifest.py` + tests; the SKILL.md manifest step and `finishing-notes.md` are P0b's), 4 (T1: `salvage_args.py`, `redirect_args.py` + tests; the SKILL.md lanes and `report-format.md` are P0b's), 5 (T1: `probe.js`, `probe.harness.json`, `PROBE`, `engine-skew`, `check_engine_skew.sh`, `harness_manifest.py` + tests, hook by-name copy, `seed_workflows` by-name copy, registry test reads `meta.name`, `probe_workflow`), 7 (T2, plus the `ab_runner.py` seal-import line in T1), 8 (T3), 9 (T1: `launch-checkout` → `fleet-run`), 11 (T1: `disk-headroom`, the prune). §The one mechanism consumer 1 is T1; consumer 2 (SKILL.md) and the shim's env are P0b's.
- Placeholder scan: every code step shows the exact replacement or the exact line range at `42734e8`; no "similar to", no "add appropriate".
- Type consistency: the `fleet-run` refusal text, the sealed `reason` text, the approve JSON shape and the stage order appear identically in Global Constraints, Interfaces, the implementation snippet and the test that pins each.
- Commutes claims: the one declared path (`ultra_gate.py`) sits in both declaring tasks' own `**Files:**`; the regions are named line-exact and non-adjacent; `evals/ab_runner.py` was made Task 1-only so no adjacent deletion hunks ever reach the kernel.
- No task shape exists to dodge a collision: the three-way split is the spec's own.

## Operator smoke

Post-merge, on the laptop (no `ULTRAPOWERS_FLEET_RUN` in the environment):

- do: `python3 skills/ultrapowers/scripts/ultra_run.py docs/superpowers/plans/2026-08-28-one-driver-phase-0a-subtraction.md --stamp smoke`
- see: a JSON receipt with `"ok": false`, a single stage `fleet-run` whose detail says ``ULTRAPOWERS_FLEET_RUN is unset — `/ultrapowers` runs only inside a fleet sandbox — launch `drive-one` on the orchestrator``, and no `.claude/ultrapowers/run-smoke/` directory created.

- do: `ULTRAPOWERS_FLEET_RUN=smoke python3 skills/ultrapowers/scripts/ultra_run.py docs/superpowers/plans/2026-08-28-one-driver-phase-0a-subtraction.md --stamp smoke`
- see: `"ok": true`, the stages read `fleet-run, git-repo, worktree-probe, superpowers-compat, compile, test-command, install, dirty-baseline, base-branch` in that order, no `lockId` or `probe` key, and `ls .claude/ultrapowers/` shows no `RUN_LOCK`.

- do: `bash skills/ultrapowers/scripts/run_acceptance.sh deadbeef0000 main 0000000000000000000000000000000000000000000000000000000000000000`
- see: stderr `usage: run_acceptance.sh --suite-gate --branch BRANCH …`, exit code 2, nothing on stdout.

- do: `ls skills/ultrapowers/scripts | wc -l` and `ls skills/ultrapowers/harnesses`
- see: `13`, and `waves.harness.json  waves.js` (no `probe.*`).

- do: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers`
- see: `skill ok` (P0b's SKILL.md, already merged underneath this plan, names only surviving scripts).

## Execution handoff

3 implementation tasks, one wave of width 3, risk: the gate's approve path, `gate_check.py` (frozen periphery) and the engine's fail-closed entry stage are touched — the risk override applies → **Ultrapowers (recommended)**; under Phase 0's own §Client this is fleet run A (`node fleet/drive-one.mjs <plan> run-<N>` on the orchestrator), driven AFTER P0b's run B has merged, with `--base-ref` on that merged base (see "Ordering").

1. **Ultrapowers (recommended)** — `/ultrapowers docs/superpowers/plans/2026-08-28-one-driver-phase-0a-subtraction.md`: parallel waves, worktree isolation, per-task review, one pre-merge human gate. Selecting it authorizes execution.
2. **Subagent-Driven** — superpowers:subagent-driven-development, sequential, review between tasks.
3. **Inline** — superpowers:executing-plans, continuous inline execution.

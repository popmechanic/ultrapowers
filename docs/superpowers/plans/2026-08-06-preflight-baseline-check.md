# Preflight Baseline Check Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `--validate-knobs` runs the args file's stamped `testCmd` once in its throwaway worktree and exits 3 on a red baseline, making red-on-main a pre-launch operator decision — per spec `docs/superpowers/specs/2026-08-06-preflight-baseline-check-design.md` (issue #116, the cycle's one budgeted additive guard).

**Architecture:** Extension of `validate_knobs` in `ultra_run.py` only — no new stage, flag, or worktree machinery. The stage reads `knobs["testCmd"]` like it reads `knobs["bootstrapCmd"]`, runs it after the bootstrap rehearsal (porcelain dirt check captured in between, so `treeClean` stays bootstrap-only), and reports `baseline: {ok, exit, output}` in the existing JSON vocabulary. Exit contract: 1 = invalid knobs or failed bootstrap (baseline never attempted), 3 = valid + green bootstrap + red baseline, 0 = all green or baseline skipped.

**Tech Stack:** Python 3 (stdlib), pytest (existing `make_repo`/`run_validate_knobs` fixtures).

**Acceptance:** suite.

## Global Constraints

- Only `skills/ultrapowers/scripts/ultra_run.py`, `tests/test_ultra_run.py`, and `skills/ultrapowers/SKILL.md` change. No gate scripts, no receipt schema, no main-driver (launch-pipeline) changes.
- The baseline subprocess runs with a 1800s timeout; timeout counts as red with a timeout note in `output`.
- SKILL.md stays within the complexity-ratchet budget.
- Suite gate: `python3 -m pytest` green.

---

### Task 1: Baseline check inside `validate_knobs` + the Step-2 decision text

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/ultra_run.py`
- Modify: `skills/ultrapowers/SKILL.md`
- Test: `tests/test_ultra_run.py`

**Interfaces:**
- Consumes: existing `validate_knobs(args_path, root)`, the `make_repo`/`run_validate_knobs` test fixtures, the args file's `testCmd` key (stamped by the driver at ultra_run.py:337).
- Produces: exit-code contract 0/1/3 as above; `baseline: {"ok": bool, "exit": int, "output": str}` in the knob-validate JSON.

Tier: standard.

- [ ] **Step 1: Write the failing tests**

```python
# append to tests/test_ultra_run.py

def test_validate_knobs_green_baseline_exits_0(tmp_path):
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"bootstrapCmd": "true", "testCmd": "true"}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode == 0, r.stdout + r.stderr
    out = json.loads(r.stdout)
    assert out["baseline"]["ok"] is True


def test_validate_knobs_red_baseline_exits_3(tmp_path):
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"bootstrapCmd": "true",
                                     "testCmd": "echo FAILING-SUITE; false"}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode == 3
    out = json.loads(r.stdout)
    assert out["baseline"]["ok"] is False
    assert "FAILING-SUITE" in out["baseline"]["output"]


def test_validate_knobs_no_testcmd_skips_baseline(tmp_path):
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"bootstrapCmd": "true"}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode == 0
    out = json.loads(r.stdout)
    assert "baseline" not in out or out.get("baseline") is None


def test_validate_knobs_failed_bootstrap_short_circuits_baseline(tmp_path):
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"bootstrapCmd": "false",
                                     "testCmd": "echo NEVER-RAN"}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode == 1                       # not 3: bootstrap red wins
    assert "NEVER-RAN" not in r.stdout


def test_validate_knobs_test_dirt_does_not_pollute_treeclean(tmp_path):
    # the suite writes a cache file; treeClean is a bootstrap-only verdict
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"bootstrapCmd": "true",
                                     "testCmd": "touch .test-cache && true"}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode == 0, r.stdout + r.stderr
    out = json.loads(r.stdout)
    assert out["treeClean"] is True
    assert out["baseline"]["ok"] is True


def test_validate_knobs_baseline_runs_without_bootstrapcmd(tmp_path):
    # named behavior change: testCmd alone now cuts the worktree
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({"testCmd": "echo RED; false"}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode == 3
    assert json.loads(r.stdout)["baseline"]["ok"] is False


def test_validate_knobs_neither_cmd_keeps_early_return(tmp_path):
    repo = make_repo(tmp_path)
    args_path = repo / "args.json"
    args_path.write_text(json.dumps({}))
    r = run_validate_knobs(repo, args_path)
    assert r.returncode == 0
    assert "nothing to validate" in r.stdout
```

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m pytest tests/test_ultra_run.py -v -k baseline`
Expected: the new tests FAIL (no `baseline` key, exit codes wrong); pre-existing validate-knobs tests still pass.

- [ ] **Step 3: Implement in `validate_knobs`**

Restructure the tail of `validate_knobs` (after the tier/review checks):

```python
    cmd = knobs.get("bootstrapCmd")
    test_cmd = knobs.get("testCmd")
    has_bootstrap = isinstance(cmd, str) and bool(cmd.strip())
    has_test = isinstance(test_cmd, str) and bool(test_cmd.strip())
    if not has_bootstrap and not has_test:
        print(json.dumps({"ok": True, "stage": "knob-validate",
                          "detail": "no bootstrapCmd — nothing to validate"}))
        return 0
    probe_wt = root / ".claude/ultrapowers" / ("wt-knob-%d" % os.getpid())
    r = sh(["git", "worktree", "add", "--detach", str(probe_wt), "HEAD"], cwd=root)
    if r.returncode != 0:
        print(json.dumps({"ok": False, "stage": "knob-validate",
                          "detail": "cannot cut probe worktree: %s"
                                    % (r.stderr or r.stdout).strip()}))
        return 1
    try:
        result = {"ok": True, "stage": "knob-validate"}
        if has_bootstrap:
            proc = subprocess.run(cmd, shell=True, cwd=probe_wt,
                                  capture_output=True, text=True)
            # porcelain captured BEFORE the baseline: treeClean is bootstrap-only
            dirt = sh(["git", "status", "--porcelain"], cwd=probe_wt).stdout
            result.update({"exit": proc.returncode, "treeClean": not dirt,
                           "output": (proc.stdout + proc.stderr)[-2000:]})
            if proc.returncode != 0 or dirt:
                result["ok"] = False
                print(json.dumps(result))
                return 1          # bootstrap red short-circuits: no baseline
        baseline_red = False
        if has_test:
            try:
                bl = subprocess.run(test_cmd, shell=True, cwd=probe_wt,
                                    capture_output=True, text=True, timeout=1800)
                result["baseline"] = {"ok": bl.returncode == 0, "exit": bl.returncode,
                                      "output": (bl.stdout + bl.stderr)[-2000:]}
            except subprocess.TimeoutExpired:
                result["baseline"] = {"ok": False, "exit": -1,
                                      "output": "[baseline timed out after 1800s]"}
            baseline_red = not result["baseline"]["ok"]
    finally:
        rm = sh(["git", "worktree", "remove", "--force", str(probe_wt)], cwd=root)
        if rm.returncode != 0:
            result.setdefault("output", "")
            result["output"] += "\n[probe worktree removal failed: %s]" % rm.stderr.strip()
    print(json.dumps(result))
    return 3 if baseline_red else 0
```

Adapt the existing tree-dirtying/failing-bootstrap tests only if their asserted JSON shape changed (the `ok`/`exit`/`treeClean`/`output` keys and exit codes for bootstrap cases are preserved above — the pre-existing tests should pass unmodified).

- [ ] **Step 4: Run the full test file, then the suite**

Run: `python3 -m pytest tests/test_ultra_run.py -v && python3 -m pytest`
Expected: green.

- [ ] **Step 5: Add the Step-2 decision text to SKILL.md**

In Step 2, where `--validate-knobs` is invoked, add:

> Exit 3 = the baseline is red on the base ref before any work (`baseline` in the JSON carries the failing output). Present the decision before launching: **fix drift first** (repair the base, re-run preflight) or **launch anyway** (the red is inherited; optionally add an explicit plan note authorizing any repair the run will need, so the reconcile agent never improvises one). The acknowledgment is context-only — the in-run setup baseline remains the durable record.

Keep the ratchet test green (trim adjacent Step-2 prose in the same edit if needed).

- [ ] **Step 6: Run the suite one more time, then commit**

Run: `python3 -m pytest`
Expected: green, including the SKILL.md ratchet test.

```bash
git add skills/ultrapowers/scripts/ultra_run.py tests/test_ultra_run.py skills/ultrapowers/SKILL.md
git commit -m "feat(#116): validate-knobs runs the stamped testCmd — red baseline exits 3, a pre-launch operator decision"
```

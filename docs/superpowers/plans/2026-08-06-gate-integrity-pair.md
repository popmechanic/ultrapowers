# Gate Integrity Pair Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kill two gate wrong-verdict classes — the macOS symlink false-red (canonical worktree paths) and the whitespace-command false-green (`[[:space:]]`-proof guards) — per spec `docs/superpowers/specs/2026-08-06-gate-path-and-empty-cmd-integrity-design.md` (issues #117 + #105; **frozen periphery, conditional unfreeze recorded in the spec**).

**Architecture:** Minimal edits to `run_acceptance.sh` (guarded two-step canonicalization at both mktemp sites; whitespace-class strip on the suite-gate `--run` guard) plus a loud empty-knob failure in `ultra_run.py`. Every fix ships with a differential pin: the test is run RED against BASE once (recorded with the exact BASE sha in the commit message — the unfreeze evidence), then committed GREEN at HEAD.

**Tech Stack:** bash (BSD/GNU portable), Python 3, pytest.

**Acceptance:** suite — plus the unfreeze conditions: RED-at-BASE recordings with shas, and the existing suite-gate/exam tests passing untouched (the no-collateral check).

## Global Constraints

- Only `skills/ultrapowers/scripts/run_acceptance.sh`, `skills/ultrapowers/scripts/ultra_run.py`, `tests/test_run_acceptance.py`, `tests/test_ultra_run.py` change. No gate_check.py, no ultra_gate.py (its `testCmd` pass-through is a recorded exclusion — spec §Not built), no waves.js, no seal machinery.
- `run_acceptance.sh` edits are the spec's exact shapes and nothing more: the two-step canonicalization (never the composed one-liner — its failure path feeds `dirname → /` into the cleanup trap) and the `[[:space:]]`-class strip (never the space-only `${VAR// /}` idiom).
- All shell must remain BSD/GNU portable (macOS is the primary host).
- Each task's Step 2 records the RED-at-BASE run: the failing output and `git rev-parse HEAD` go into the task's commit message verbatim.
- New repro fixtures are tmp_path-built inside the tests; `evals/fixtures/` does not grow.
- Suite gate: `python3 -m pytest` green after every task, with pre-existing suite-gate/exam tests untouched.

---

### Task 1: Canonical worktree paths (#117) + the symlink differential pin

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/run_acceptance.sh`
- Test: `tests/test_run_acceptance.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: canonical `EXAM_WT` at both provisioning sites (`:124` exam, `:266` suite-gate); the symlinked-TMPDIR pin test.

Tier: most-capable — a frozen-periphery shell edit whose failure modes the trim review already showed to be subtle.

- [ ] **Step 1: Write the failing pin**

```python
# append to tests/test_run_acceptance.py
import json, os, subprocess, sys
from pathlib import Path

RA = Path(__file__).resolve().parents[1] / "skills/ultrapowers/scripts/run_acceptance.sh"


def _mk_path_identity_repo(tmp_path):
    """A repo whose one-test suite fails iff the worktree path traverses a
    symlink — the stand-in for every path-identity-sensitive toolchain."""
    repo = tmp_path / "repo"
    (repo / "tests").mkdir(parents=True)
    (repo / "tests/test_path_identity.py").write_text(
        "import os\n\n"
        "def test_cwd_is_canonical():\n"
        "    assert os.getcwd() == os.path.realpath(os.getcwd())\n")
    def git(*a):
        subprocess.run(["git", "-C", str(repo), *a], check=True, capture_output=True)
    git("init", "-q", "-b", "main")
    git("-c", "user.email=t@t", "-c", "user.name=t", "add", "-A")
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture")
    git("branch", "work")
    return repo


def test_suite_gate_survives_symlinked_tmpdir(tmp_path):
    # #117 differential pin (GREEN at HEAD; RED at BASE recorded in the commit).
    repo = _mk_path_identity_repo(tmp_path)
    real = tmp_path / "realtmp"
    real.mkdir()
    link = tmp_path / "lnk"
    link.symlink_to(real)
    env = dict(os.environ, TMPDIR=str(link))
    r = subprocess.run(
        ["bash", str(RA), "--suite-gate", "--branch", "work",
         "--run", sys.executable + " -m pytest -q tests/", "--repo", str(repo)],
        capture_output=True, text=True, env=env)
    out = json.loads(r.stdout)
    assert out["passed"] is True, r.stdout + r.stderr
    assert r.returncode == 0
```

If the suite-gate invocation shape in this test needs an adjustment to match the runner's actual required flags, adjust the test — never the assertion: green verdict under a symlinked TMPDIR is the pin.

- [ ] **Step 2: Run against BASE — record the RED**

Run: `python3 -m pytest tests/test_run_acceptance.py -v -k symlinked`
Expected: FAIL — the gate reports the fixture red under the symlinked path (the manufactured false-red, reproduced). Record the failing assertion output and `git rev-parse HEAD` — both go verbatim into Step 5's commit message as the unfreeze evidence.

- [ ] **Step 3: Implement the guarded canonicalization at BOTH sites**

At `run_acceptance.sh:124` (exam) and `:266` (suite-gate), replace `EXAM_WT="$(mktemp -d)/exam"` (and `/suite-gate`) with the spec's exact two-step shape — reusing each site's existing ERROR emission style for the guard failure:

```bash
TMP="$(mktemp -d)"
TMP="$(cd "$TMP" && pwd -P)"
[ -n "$TMP" ] || { <the site's existing ERROR emission>; exit 1; }
EXAM_WT="$TMP/exam"
```

- [ ] **Step 4: Run the pin, then the whole file, then the suite**

Run: `python3 -m pytest tests/test_run_acceptance.py -v && python3 -m pytest`
Expected: the pin passes; every pre-existing suite-gate/exam test passes untouched (the no-collateral condition).

- [ ] **Step 5: Commit (carrying the differential evidence)**

```bash
git add skills/ultrapowers/scripts/run_acceptance.sh tests/test_run_acceptance.py
git commit -m "fix(#117): canonicalize acceptance worktree paths (guarded two-step pwd -P at both mktemp sites)

Unfreeze differential: pin RED at BASE <rev-parse output from Step 2> —
<one-line failing output> — GREEN at this commit."
```

---

### Task 2: Whitespace-proof command guards (#105) + pins

**Type:** implementation
**Depends-on:** 1
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/scripts/run_acceptance.sh`
- Modify: `skills/ultrapowers/scripts/ultra_run.py`
- Test: `tests/test_run_acceptance.py`
- Test: `tests/test_ultra_run.py`

**Interfaces:**
- Consumes: Task 1's canonicalized provisioning (same file — the dependency is the file seam, not a symbol).
- Produces: whitespace-empty `--run` refusal (suite-gate); loud empty `--test-cmd` stage failure (driver).

Tier: most-capable.

- [ ] **Step 1: Write the failing pins**

```python
# append to tests/test_run_acceptance.py
import pytest


@pytest.mark.parametrize("cmd", ["   ", "\t", "\n"])
def test_suite_gate_refuses_whitespace_only_run(tmp_path, cmd):
    # #105 differential pin: BASE returns {"passed": true} for these (the
    # false green); HEAD refuses loudly.
    repo = _mk_path_identity_repo(tmp_path)
    r = subprocess.run(
        ["bash", str(RA), "--suite-gate", "--branch", "work",
         "--run", cmd, "--repo", str(repo)],
        capture_output=True, text=True)
    assert r.returncode != 0
    assert '"passed": true' not in r.stdout
```

```python
# append to tests/test_ultra_run.py
@pytest.mark.parametrize("cmd", ["   ", ""])
def test_explicit_empty_test_cmd_fails_the_stage(tmp_path, cmd):
    repo = make_repo(tmp_path)
    r = sh([sys.executable, str(RUN), str(repo / "plan.md"), "--repo", str(repo),
            "--test-cmd", cmd], cwd=repo, check=False)
    assert r.returncode != 0
    receipt = json.loads(r.stdout)
    assert receipt["stages"][-1]["stage"] == "test-command"
    assert receipt["stages"][-1]["ok"] is False
```

(Adjust the driver invocation to match `run_driver`'s existing argument shape in the file; the assertions are the pin: an explicitly-passed empty/whitespace knob fails the test-command stage — it must not stamp verbatim and must not fall through to detection.)

- [ ] **Step 2: Run against the Task-1 tree — record the RED**

Run: `python3 -m pytest tests/test_run_acceptance.py -k whitespace -v && python3 -m pytest tests/test_ultra_run.py -k empty_test_cmd -v`
Expected: FAIL — suite-gate returns `passed: true` on whitespace commands; the driver stamps/falls-through. Record outputs + `git rev-parse HEAD` for Step 5's commit message.

- [ ] **Step 3: Implement both sides**

`run_acceptance.sh` (suite-gate section, the `[ -z "${SG_RUN:-}" ]` guard): strip the full whitespace class before the emptiness check — portable form:

```bash
SG_RUN_STRIPPED="$(printf '%s' "${SG_RUN:-}" | tr -d '[:space:]')"
if [ -z "$SG_RUN_STRIPPED" ]; then
  <the existing usage-error/refusal path, naming --run as empty>
fi
```

(`SG_RUN` itself stays unmodified for execution — only the emptiness check uses the stripped copy.)

`ultra_run.py` (the `--test-cmd` handling at ~line 326): strip at the parse; when the knob was explicitly passed and strips to empty, the test-command stage fails loudly naming the empty knob:

```python
    if a.test_cmd is not None:
        knob = a.test_cmd.strip()
        if not knob:
            stage("test-command", False,
                  failure="--test-cmd was passed but is empty/whitespace — "
                          "refusing the silent knob-drop; pass a real command "
                          "or omit the flag for detection")
            return bail()
        test_cmd, test_src = knob, "knob"
    else:
        test_cmd, rule = detect_test_cmd(root)
        test_src = ("detected:" + rule) if test_cmd else None
```

- [ ] **Step 4: Run the pins, both files, then the suite**

Run: `python3 -m pytest tests/test_run_acceptance.py tests/test_ultra_run.py -v && python3 -m pytest`
Expected: green, pre-existing tests untouched.

- [ ] **Step 5: Commit (carrying the differential evidence)**

```bash
git add skills/ultrapowers/scripts/run_acceptance.sh skills/ultrapowers/scripts/ultra_run.py tests/test_run_acceptance.py tests/test_ultra_run.py
git commit -m "fix(#105): whitespace-empty command guards — [[:space:]]-proof --run refusal; explicit empty --test-cmd fails the stage

Unfreeze differential: pins RED at <rev-parse output from Step 2> —
<one-line failing outputs> — GREEN at this commit. #105 rides #117's
unfreeze per its own bundling instruction."
```

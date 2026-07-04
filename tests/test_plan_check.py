"""--check: authoring-time grammar validation (issue #85).
Runs compile_plan.py as a subprocess — --check is an operator-facing CLI
contract, so the exit codes and stdout shape are the pinned surface."""
import json
import subprocess
import sys
from pathlib import Path

SCRIPT = Path("skills/ultrapowers/scripts/compile_plan.py")

CANONICAL = """# P

**Acceptance:** suite — test

### Task 1: A

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `src/a.py`

**Interfaces:**
- Consumes: nothing
- Produces: `helper() -> str`

- [ ] **Step 1: do it**

### Task 2: Gate

**Type:** gate
**Depends-on:** 1

**Files:**
- none

- [ ] **Step 1: run the suite**
"""

VIOLATING = CANONICAL.replace(
    "- Modify: `src/a.py`",
    "- Modify: `src/a.py` (only the top half)\n- Delete: `old/b.py`")


def run_check(tmp_path, text):
    plan = tmp_path / "plan.md"
    plan.write_text(text)
    return subprocess.run([sys.executable, str(SCRIPT), "--check", str(plan)],
                          capture_output=True, text=True)


def test_check_passes_a_canonical_plan(tmp_path):
    # includes a gate task with the canonical empty-Files form `- none`,
    # which must never count as a violation
    proc = run_check(tmp_path, CANONICAL)
    assert proc.returncode == 0
    assert "PLAN OK" in proc.stdout


def test_check_reports_every_violation_with_fixes(tmp_path):
    proc = run_check(tmp_path, VIOLATING)
    assert proc.returncode == 2
    out = proc.stdout + proc.stderr
    assert "annotation" in out.lower()      # the annotated Modify line
    assert "unknown files label" in out.lower()  # the Delete: line
    assert "src/a.py" in out                # extracted path shown as the fix


def test_check_validates_review_marker_values(tmp_path):
    bad = CANONICAL.replace("**Review:** adversarial", "**Review:** paranoid")
    proc = run_check(tmp_path, bad)
    assert proc.returncode == 2
    assert "adversarial" in (proc.stdout + proc.stderr)


def test_check_is_exclusive_with_emit(tmp_path):
    plan = tmp_path / "plan.md"
    plan.write_text(CANONICAL)
    proc = subprocess.run(
        [sys.executable, str(SCRIPT), "--check", str(plan),
         "--emit-launch", str(tmp_path / "launch.json")],
        capture_output=True, text=True)
    assert proc.returncode != 0


# Prose Interfaces values are valid plan grammar (#85 redirect): they are
# documentation, and after the tokenizer hardening they are structurally inert.
PROSE_INTERFACES = """# P

**Acceptance:** suite — test

### Task 1: A

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `src/a.py`

**Interfaces:**
- Consumes: nothing
- Produces: the module gains a helper the next task calls later

- [ ] **Step 1: do it**

### Task 2: B

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `src/b.py`

**Interfaces:**
- Consumes: the helper the earlier module now exposes
- Produces: nothing

- [ ] **Step 1: do it**
"""


def test_pure_prose_interfaces_pass_check_and_pair_no_edge(tmp_path):
    # A plan whose Interfaces are pure prose passes --check AND compiles with
    # zero interface edges (the leading bare word never tokens, so prose can
    # never pair). The violation class 'interface value is not a symbol list'
    # no longer exists.
    proc = run_check(tmp_path, PROSE_INTERFACES)
    assert proc.returncode == 0, (proc.stdout, proc.stderr)
    assert "PLAN OK" in proc.stdout
    plan = tmp_path / "compile.md"
    plan.write_text(PROSE_INTERFACES)
    comp = subprocess.run([sys.executable, str(SCRIPT), str(plan)],
                          capture_output=True, text=True)
    assert comp.returncode == 0, comp.stderr
    out = json.loads(comp.stdout)
    assert [e for e in out["dag_edges"] if e.get("why") == "interface"] == []


def test_cycle_plans_pass_check_self_application():
    # THE HEADLINE PIN (#85 redirect): this cycle's own plan docs are machine-
    # checked from now on. Both use prose Interfaces (the repo's house style),
    # which formerly false-positived --check with 11 symbol-list violations each.
    for name in ("2026-07-03-plan-grammar-check.md",
                 "2026-07-03-authored-review-depth.md"):
        plan = Path("docs/superpowers/plans") / name
        proc = subprocess.run([sys.executable, str(SCRIPT), "--check", str(plan)],
                              capture_output=True, text=True)
        assert proc.returncode == 0, (name, proc.stdout, proc.stderr)

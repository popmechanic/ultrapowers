"""--check: authoring-time grammar validation (issue #85).
Runs compile_plan.py as a subprocess — --check is an operator-facing CLI
contract, so the exit codes and stdout shape are the pinned surface."""
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

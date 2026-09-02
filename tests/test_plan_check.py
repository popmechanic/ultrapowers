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


def test_check_is_exclusive_with_run_dir(tmp_path):
    # The runtime rejects --check with --run-dir; only the emit arm was
    # tested. This pins the third arm (#95 item 1).
    plan = tmp_path / "plan.md"
    plan.write_text(CANONICAL)
    proc = subprocess.run(
        [sys.executable, str(SCRIPT), "--check", str(plan),
         "--run-dir", str(tmp_path / "rd")],
        capture_output=True, text=True)
    assert proc.returncode != 0
    assert "--run-dir" in (proc.stdout + proc.stderr)


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
        plan = Path("tests/fixtures/plans") / name  # frozen copies (#544)
        proc = subprocess.run([sys.executable, str(SCRIPT), "--check", str(plan)],
                              capture_output=True, text=True)
        assert proc.returncode == 0, (name, proc.stdout, proc.stderr)


def test_check_ignores_files_grammar_on_gate_tasks(tmp_path):
    # A gate task's Files block never enters overlap inference; its
    # placeholder values must not warn (#91 item 3).
    plan = CANONICAL.replace("**Files:**\n- none",
                             "**Files:**\n- Verify: `(none)`")
    proc = run_check(tmp_path, plan)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "PLAN OK" in proc.stdout


def test_check_still_flags_files_grammar_on_implementation_tasks(tmp_path):
    plan = CANONICAL.replace("- Modify: `src/a.py`", "- Tweak: `src/a.py`")
    proc = run_check(tmp_path, plan)
    assert proc.returncode == 2
    assert "unknown files label" in (proc.stdout + proc.stderr).lower()


def test_check_still_flags_files_grammar_on_markerless_tasks(tmp_path):
    # Marker-less task: the unknown label empties `writes`, which alone would
    # make classify() call it a heuristic gate. The exemption is explicit-marker
    # only, so --check must still flag it (a broken Files block never exempts
    # itself).
    plan = CANONICAL + (
        "\n### Task 3: C\n\n"
        "**Files:**\n- Tweak: `src/c.py`\n\n"
        "- [ ] **Step 1: wire it up, then run pytest**\n")
    proc = run_check(tmp_path, plan)
    assert proc.returncode == 2
    assert "unknown files label" in (proc.stdout + proc.stderr).lower()


# #332: a **Commutes:** placed after the Files: block is silently discarded by
# the runtime compile (surfaced only as a render conflict the author never
# sees). --check refuses it with the SAME late-marker note the render uses —
# no new diagnostic vocabulary.
LATE_COMMUTES = CANONICAL.replace(
    "- Modify: `src/a.py`\n",
    "- Modify: `src/a.py`\n\n**Commutes:** `src/a.py`\n")

HEADER_COMMUTES = CANONICAL.replace(
    "**Review:** adversarial\n",
    "**Review:** adversarial\n**Commutes:** `src/a.py`\n")


def test_check_refuses_a_commutes_marker_placed_after_files(tmp_path):
    proc = run_check(tmp_path, LATE_COMMUTES)
    assert proc.returncode == 2, proc.stdout + proc.stderr
    assert "Task 1: marker line(s) outside the header block ignored" in proc.stdout
    assert "**Commutes:**" in proc.stdout
    assert "markers go immediately after the task heading" in proc.stdout
    assert "1 violation(s)" in proc.stdout


def test_check_accepts_a_commutes_marker_in_the_header(tmp_path):
    proc = run_check(tmp_path, HEADER_COMMUTES)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "PLAN OK" in proc.stdout


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

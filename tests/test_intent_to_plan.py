"""The intent -> marked-plan bridge (tools/intent_to_plan.py).

Throwaway machinery, but it is what the one-driver port is built through, so the
two behaviours that actually bit during its authoring are pinned here.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "intent_to_plan.py"

INTENT = """# Intent — sample

Prose that mentions `## Acceptance` and `## Cadence` before either heading exists.

## Scope
s
## Tasks

### T1 — first
- **Depends-on:** —
- **Interfaces:** `f() -> x`
- **Produces:** a thing
- **Files:** `fleet/drive.mjs`, `fleet/tests/test_new.mjs`
- **tier:** most-capable
- **Acceptance:** `see:` it works.

### T2 — second
- **Depends-on:** T1
- **Interfaces:** `g()`
- **Produces:** another
- **Files:** `fleet/brand-new-module.mjs`
- **tier:** standard
- **Acceptance:** `see:` it also works.

## Global Constraints
g
## Standing decisions
1. one
## Cadence
c
## Acceptance
The run is green when the suite is green.
## Out of scope
o
"""


def run(tmp_path, text=INTENT):
    src = tmp_path / "intent.md"
    src.write_text(text)
    out = subprocess.run(
        [sys.executable, str(SCRIPT), str(src), "--repo", str(ROOT)],
        capture_output=True, text=True,
    )
    assert out.returncode == 0, out.stderr
    return out.stdout


def test_acceptance_comes_from_the_slot_not_a_prose_mention(tmp_path):
    """Slot boundaries anchor at line start. A hand-written validator once sliced
    on the first textual occurrence of `## Cadence`, hit the preamble, and
    reported a false green."""
    plan = run(tmp_path)
    assert "**Acceptance:** suite — The run is green when the suite is green." in plan
    assert "Prose that mentions" not in plan


def test_task_ids_and_deps_are_renumbered(tmp_path):
    plan = run(tmp_path)
    assert "### Task 1: first" in plan
    assert "### Task 2: second" in plan
    assert "**Depends-on:** none" in plan   # T1
    assert "**Depends-on:** 1" in plan      # T2 -> 1, not "T1"


def test_files_are_typed_without_judgment(tmp_path):
    """Existing path -> Modify, absent -> Create, tests -> Test."""
    plan = run(tmp_path)
    assert "- Modify: `fleet/drive.mjs`" in plan
    assert "- Test: `fleet/tests/test_new.mjs`" in plan
    assert "- Create: `fleet/brand-new-module.mjs`" in plan


def test_no_implementation_detail_is_invented(tmp_path):
    """The body is the intent's own contract and acceptance, verbatim. If this
    ever fails, the bridge has started authoring — which is the thing #243
    abolished."""
    plan = run(tmp_path)
    assert "`f() -> x`" in plan and "`see:` it works." in plan
    for task_block in plan.split("### Task ")[1:]:
        # [0] is the remainder of the heading line itself ("1: first"), not body.
        for line in task_block.splitlines()[1:]:
            stripped = line.strip()
            if stripped.startswith(("**", "- ", "_", "#")) or not stripped:
                continue
            raise AssertionError("bridge emitted unstructured prose: %r" % line)


def test_missing_acceptance_slot_refuses(tmp_path):
    src = tmp_path / "bad.md"
    src.write_text(INTENT.replace("## Acceptance\nThe run is green when the suite is green.\n", ""))
    out = subprocess.run(
        [sys.executable, str(SCRIPT), str(src), "--repo", str(ROOT)],
        capture_output=True, text=True,
    )
    assert out.returncode != 0
    assert "Acceptance" in out.stderr

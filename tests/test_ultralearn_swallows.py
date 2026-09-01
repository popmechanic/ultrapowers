"""AST pin (#489): every `except` handler under `skills/ultralearn/scripts/`
either fails loud or marks its silence.

Which swallows are correct is a judgment made once, per handler, in the sweep
that landed the marks — some silences are right and stay. This walk is what
keeps an *unmarked* one from coming back: a handler is compliant when its body
raises (a bare re-raise or a typed error — both fail loud) or calls
`swallow(...)` with a non-empty string-literal reason. Anything else — a bare
`pass`, a quiet `return None`, a `swallow()` with no reason at all — is a
failure naming file and line.

The walk globs the whole directory so a new script cannot escape by not being
enumerated. Two scripts are owned by concurrent sibling tasks and so are not
swept yet; they are audited all the same and their handlers quarantined into
`NOT_YET_SWEPT`, which is pinned as an upper bound rather than a blind skip.
"""
import ast
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = REPO / "skills/ultralearn/scripts"


def script_paths():
    """Every script in the directory — a glob, not a hand-written list, so a
    sixth script cannot escape the walk by not being enumerated."""
    return sorted(SCRIPTS_DIR.glob("*.py"))


def _callee_name(func):
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return None


def _swallow_calls(node):
    return [n for n in ast.walk(node)
            if isinstance(n, ast.Call) and _callee_name(n.func) == "swallow"]


def _has_literal_reason(call):
    """A reason must be a non-empty string literal: an f-string or a variable
    is a reason only at runtime, and the point of the mark is that it is
    readable in the source."""
    if not call.args:
        return False
    first = call.args[0]
    return (isinstance(first, ast.Constant) and isinstance(first.value, str)
            and first.value.strip() != "")


def audit(source, label):
    """Walk one module: `(violations, marked_swallow_count)`.

    Violations are `"<label>:<line>: <why>"` strings — file and line, so a
    failure points at the handler that regressed."""
    tree = ast.parse(source)
    violations = []
    marked = 0
    for call in _swallow_calls(tree):
        if _has_literal_reason(call):
            marked += 1
        else:
            violations.append(
                f"{label}:{call.lineno}: swallow() without a non-empty literal reason")
    for handler in [n for n in ast.walk(tree) if isinstance(n, ast.ExceptHandler)]:
        raises = any(isinstance(n, ast.Raise) for n in ast.walk(handler))
        marks = [c for c in _swallow_calls(handler) if _has_literal_reason(c)]
        if not raises and not marks:
            violations.append(
                f"{label}:{handler.lineno}: except handler discards its "
                f"exception without raising or swallow(<reason>)")
    return violations, marked


# Two of the seven scripts in this directory are owned by concurrent sibling
# tasks under #489 — `fleet_fetch.py` and `harvest_fleet_runs.py` — and those
# tasks rewrite the very handlers a sweep would mark. Marking them from here
# would be a lost update on their work, so their eight handlers are not swept
# yet. They are not *excluded from the walk*: the glob still parses and audits
# them, and their violations are quarantined into this named set, asserted
# below to be an upper bound. Once those tasks mark their own handlers the set
# costs nothing and can be deleted outright.
NOT_YET_SWEPT = frozenset({"fleet_fetch.py", "harvest_fleet_runs.py"})


def audit_scripts():
    """`(violations_by_script_name, marked_swallow_count)` over the glob."""
    by_script, marked = {}, 0
    for path in script_paths():
        v, m = audit(path.read_text(), str(path.relative_to(REPO)))
        by_script[path.name] = v
        marked += m
    return by_script, marked


def swept_violations():
    """Violations in the scripts this sweep owns — the quarantined pair aside."""
    by_script, _ = audit_scripts()
    return [v for name in sorted(by_script)
            if name not in NOT_YET_SWEPT for v in by_script[name]]


def test_the_walk_enumerates_every_script_by_glob():
    """Independent enumeration of the directory — every `.py` on disk is
    audited, so adding a script cannot quietly add unmarked handlers."""
    on_disk = {n for n in os.listdir(SCRIPTS_DIR) if n.endswith(".py")}
    walked = {p.name for p in script_paths()}
    assert walked == on_disk
    assert len(walked) >= 5


def test_no_unmarked_except_handler_in_any_script():
    violations = swept_violations()
    assert violations == [], "unmarked swallows:\n" + "\n".join(violations)


def test_the_quarantine_is_an_upper_bound_and_names_real_files():
    """The quarantine cannot grow and cannot go stale: any *other* script with
    an unmarked handler fails here (a newly added script is not in the set), and
    a name that no longer exists on disk fails too, so the exclusion cannot
    outlive the files it was written for."""
    by_script, _ = audit_scripts()
    offenders = {name for name, v in by_script.items() if v}
    assert offenders <= set(NOT_YET_SWEPT), (
        "unmarked swallows outside the quarantine: "
        + ", ".join(sorted(offenders - set(NOT_YET_SWEPT))))
    assert set(NOT_YET_SWEPT) <= set(by_script), (
        "quarantined script no longer on disk: "
        + ", ".join(sorted(set(NOT_YET_SWEPT) - set(by_script))))


def test_the_legitimate_swallows_stayed_and_are_marked():
    """The existential half of the claim: the sweep marked silence, it did not
    delete it — at least one compliant `swallow(...)` remains."""
    _, marked = audit_scripts()
    assert swept_violations() == []
    assert marked >= 1


# --- the walk tests itself -------------------------------------------------

BARE_EXCEPT_PASS = """
def f():
    try:
        g()
    except OSError:
        pass
"""

REASONLESS_SWALLOW = """
def f():
    try:
        g()
    except OSError:
        swallow()
"""

NON_LITERAL_REASON = """
def f():
    try:
        g()
    except OSError as exc:
        swallow(f"cannot g: {exc}")
"""

COMPLIANT = """
def f():
    try:
        g()
    except OSError as exc:
        swallow("cannot g, staying advisory", exc)
    try:
        g()
    except ValueError:
        raise
    try:
        g()
    except KeyError as exc:
        raise FailedLookup("could not look") from exc
"""


def test_walk_fails_a_bare_except_pass():
    violations, marked = audit(BARE_EXCEPT_PASS, "fixture.py")
    assert violations == [
        "fixture.py:5: except handler discards its exception without raising "
        "or swallow(<reason>)"]
    assert marked == 0


def test_walk_fails_a_reasonless_swallow():
    violations, marked = audit(REASONLESS_SWALLOW, "fixture.py")
    assert violations == [
        "fixture.py:6: swallow() without a non-empty literal reason",
        "fixture.py:5: except handler discards its exception without raising "
        "or swallow(<reason>)"]
    assert marked == 0


def test_walk_fails_a_non_literal_reason():
    violations, marked = audit(NON_LITERAL_REASON, "fixture.py")
    assert violations == [
        "fixture.py:6: swallow() without a non-empty literal reason",
        "fixture.py:5: except handler discards its exception without raising "
        "or swallow(<reason>)"]
    assert marked == 0


def test_walk_passes_raise_reraise_and_marked_swallow():
    violations, marked = audit(COMPLIANT, "fixture.py")
    assert violations == []
    assert marked == 1


def test_healthy_paths_unchanged():
    """The regression pin: re-labelling silence did not redesign a flow."""
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", "-p", "no:xdist", "-q",
         "tests/test_harvest_runs.py", "tests/test_fleet_slice.py",
         "tests/test_merge_ledger.py"],
        cwd=REPO, capture_output=True, text=True)
    assert proc.returncode == 0, proc.stdout + proc.stderr

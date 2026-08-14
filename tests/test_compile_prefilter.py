"""`--repo-root` eligibility pre-filter for `--overlap fold` (frontier mode,
spec docs/superpowers/specs/2026-08-12-frontier-mode-in-engine-design.md §1).

Task 5 built the `fold` knob with an unconditional `fold_eligible()` hook
(every pair eligible). This task makes the hook real: a pair KEEPS its
serializing `write-after-write` edge when any path in its overlap set
(`writes ∪ reads`, both sides), resolved against `--repo-root` and existing
there, is non-text, over `RESOLVER_LINE_CAP` lines (counted via the kernel's
`split_lines` — never `str.splitlines()`, which disagrees by one on every
trailing-newline file), or a symlink. Without `--repo-root` the pre-filter is
inert and every pair is eligible (documented property) — the compiler stays
subprocess-free; gitlinks are left to the runtime guard.

Every test compiles a plan written inline here (marker grammar per
`references/plan-markers.md`) under its own `tmp_path`, so nothing is shared
on disk between tests. Helper pattern copied from `test_compile_overlap.py`
(Task 5) rather than imported across test files.
"""
import json
import pathlib
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"

sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
from compile_plan import RESOLVER_LINE_CAP  # noqa: E402


def _run(plan_path, *extra):
    p = subprocess.run([sys.executable, str(COMPILER), *extra, str(plan_path)],
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    return p


def compile_plan(plan_path, *extra):
    return json.loads(_run(plan_path, *extra).stdout)


def _write(tmp_path, name, text):
    p = tmp_path / name
    p.write_text(text)
    return p


def _edges(out, why):
    return sorted((e["from"], e["to"]) for e in out["dag_edges"] if e["why"] == why)


def _task(tid, title, files, deps=None):
    head = "### Task %s: %s\n\n**Type:** implementation\n" % (tid, title)
    if deps:
        head += "**Depends-on:** %s\n" % ", ".join(deps)
    return (head + "\n**Files:**\n" + "".join("- %s\n" % f for f in files)
            + "\n- [ ] **Step 1:** do the work\n\n")


_HEADER = "# Plan: repo-root pre-filter\n\n**Acceptance:** waived — inline test plan\n\n"


def _inference_conflicts(out):
    return [c for c in out["marker_conflicts"] if c["kind"] == "inference"]


# --------------------------------------------------------------- fixtures ---
def _big_py_plan(tmp_path, root):
    """t1,t2 both Modify big.py (over cap); t3,t4 both Modify ok.py (small)."""
    (root / "big.py").write_text(
        "\n".join("line %d" % i for i in range(RESOLVER_LINE_CAP + 50)))
    (root / "ok.py").write_text("\n".join("line %d" % i for i in range(10)))
    return _write(tmp_path, "plan.md", _HEADER + (
        _task("A", "writer A", ["Modify: `big.py`"])
        + _task("B", "writer B", ["Modify: `big.py`"])
        + _task("C", "writer C", ["Modify: `ok.py`"])
        + _task("D", "writer D", ["Modify: `ok.py`"])))


# ----------------------------------------------------------------- tests ---
def test_prefilter_keeps_edges_for_ineligible_paths_with_inference_records(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    plan = _big_py_plan(tmp_path, root)

    out = compile_plan(plan, "--overlap", "fold", "--repo-root", str(root))
    # t1-t2 (big.py, over cap) keeps its serializing edge.
    assert _edges(out, "write-after-write") == [("A", "B")]
    # t3-t4 (ok.py, small) drops and shares a wave.
    assert ("C", "D") not in _edges(out, "write-after-write")
    waves_flat = {tid: i for i, w in enumerate(out["waves"]) for tid in w}
    assert waves_flat["C"] == waves_flat["D"]

    # Exactly one inference record for the one ineligible path, memoised
    # per path (task "", edge "big.py" — the type_conflicts task:"" precedent).
    inference = _inference_conflicts(out)
    assert len(inference) == 1
    assert inference[0]["task"] == ""
    assert inference[0]["edge"] == "big.py"
    assert "pairs kept serialized" in inference[0]["note"]


def test_prefilter_covers_reads_paths(tmp_path):
    root = tmp_path / "repo"
    (root / "tests").mkdir(parents=True)
    (root / "tests" / "big_test.py").write_text(
        "\n".join("line %d" % i for i in range(RESOLVER_LINE_CAP + 50)))

    plan = _write(tmp_path, "plan.md", _HEADER + (
        _task("A", "alpha", ["Modify: `src/a.py`", "Test: `tests/big_test.py`"])
        + _task("B", "beta", ["Modify: `src/b.py`", "Test: `tests/big_test.py`"])))

    out = compile_plan(plan, "--overlap", "fold", "--repo-root", str(root))
    # Disjoint writes (src/a.py vs src/b.py) — only the shared, over-cap
    # `Test:` path forces the pair to stay serialized: the full overlap set
    # is `writes ∪ reads`, not `writes ∩ writes`.
    assert _edges(out, "write-after-write") == [("A", "B")]
    inference = _inference_conflicts(out)
    assert len(inference) == 1
    assert inference[0]["edge"] == "tests/big_test.py"


def test_binary_and_symlink_paths_keep_edges(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    (root / "bin.dat").write_bytes(b"\x00\x01\x02binary")
    (root / "target.py").write_text("hello\n")
    (root / "link.py").symlink_to(root / "target.py")

    plan = _write(tmp_path, "plan.md", _HEADER + (
        _task("A", "writer A", ["Modify: `bin.dat`"])
        + _task("B", "writer B", ["Modify: `bin.dat`"])
        + _task("C", "writer C", ["Modify: `link.py`"])
        + _task("D", "writer D", ["Modify: `link.py`"])))

    out = compile_plan(plan, "--overlap", "fold", "--repo-root", str(root))
    assert _edges(out, "write-after-write") == [("A", "B"), ("C", "D")]
    edges = {c["edge"] for c in _inference_conflicts(out)}
    assert edges == {"bin.dat", "link.py"}


def test_exact_cap_boundary_counts_via_split_lines(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    # Exactly RESOLVER_LINE_CAP lines via split_lines (no trailing newline —
    # split_lines and str.splitlines() agree here): ELIGIBLE.
    (root / "at_cap.py").write_text(
        "\n".join("x" for _ in range(RESOLVER_LINE_CAP)))
    # The same content PLUS a trailing newline: split_lines (content.split("\n"))
    # counts one more line (RESOLVER_LINE_CAP + 1, over cap — INELIGIBLE),
    # while str.splitlines() would silently drop the trailing empty entry and
    # report exactly RESOLVER_LINE_CAP (still eligible) — the split disagrees
    # by one, which is exactly the bug this pins.
    (root / "over_by_newline.py").write_text(
        "\n".join("x" for _ in range(RESOLVER_LINE_CAP)) + "\n")

    plan = _write(tmp_path, "plan.md", _HEADER + (
        _task("A", "writer A", ["Modify: `at_cap.py`"])
        + _task("B", "writer B", ["Modify: `at_cap.py`"])
        + _task("C", "writer C", ["Modify: `over_by_newline.py`"])
        + _task("D", "writer D", ["Modify: `over_by_newline.py`"])))

    out = compile_plan(plan, "--overlap", "fold", "--repo-root", str(root))
    # at_cap.py: exactly at the cap -> eligible -> edge drops.
    assert ("A", "B") not in _edges(out, "write-after-write")
    # over_by_newline.py: one line over via split_lines -> ineligible -> kept.
    assert ("C", "D") in _edges(out, "write-after-write")
    edges = {c["edge"] for c in _inference_conflicts(out)}
    assert edges == {"over_by_newline.py"}


def test_without_repo_root_prefilter_is_inert(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    plan = _big_py_plan(tmp_path, root)

    # Same plan, same on-disk files, compiled WITHOUT --repo-root: every pair
    # is eligible (documented property — the runtime predicate is
    # authoritative there), so BOTH overlapping pairs drop.
    out = compile_plan(plan, "--overlap", "fold")
    assert _edges(out, "write-after-write") == []
    assert _inference_conflicts(out) == []


def test_serialize_mode_untouched_by_prefilter_flags(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    plan = _big_py_plan(tmp_path, root)

    # The pre-filter only ever runs in fold mode: --overlap serialize with a
    # --repo-root supplied is byte-identical to serialize with no root.
    # (The flagless invocation is fold since the spec-§5 default flip, so it
    # no longer participates in this serialize-side identity.)
    explicit = _run(plan, "--overlap", "serialize")
    with_root = _run(plan, "--overlap", "serialize", "--repo-root", str(root))
    assert with_root.stdout == explicit.stdout

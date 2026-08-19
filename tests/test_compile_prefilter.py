"""`--repo-root` eligibility pre-filter for `--overlap fold` (frontier mode,
spec docs/superpowers/specs/2026-08-12-frontier-mode-in-engine-design.md §1,
size term retired per spec 2026-08-18 §1d).

Task 5 built the `fold` knob with an unconditional `fold_eligible()` hook
(every pair eligible). This task makes the hook real: a pair KEEPS its
serializing `write-after-write` edge when any path in its overlap set
(`writes ∪ reads`, both sides), resolved against `--repo-root` and existing
there, is non-text or a symlink. Size is NOT a term any more — the kernel
folds on a 1 GiB-stack thread, so a big file is no reason to serialize a pair.
Without `--repo-root` the pre-filter is inert and every pair is eligible
(documented property) — the compiler stays subprocess-free; gitlinks are left
to the runtime guard.

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
import compile_plan  # noqa: E402,F401  (import-ability is itself the pin)

# 12.5x the retired 400-line resolver cap: what used to be the canonical
# "too big to fold" file is now an ordinary eligible text file.
BIG_LINES = 5000


def _run(plan_path, *extra):
    p = subprocess.run([sys.executable, str(COMPILER), *extra, str(plan_path)],
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    return p


def compile_plan_out(plan_path, *extra):
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
def _mixed_plan(tmp_path, root):
    """A,B both Modify bin.dat (non-text — ineligible); C,D both Modify ok.py."""
    (root / "bin.dat").write_bytes(b"\x00\x01\x02binary")
    (root / "ok.py").write_text("\n".join("line %d" % i for i in range(10)))
    return _write(tmp_path, "plan.md", _HEADER + (
        _task("A", "writer A", ["Modify: `bin.dat`"])
        + _task("B", "writer B", ["Modify: `bin.dat`"])
        + _task("C", "writer C", ["Modify: `ok.py`"])
        + _task("D", "writer D", ["Modify: `ok.py`"])))


# ----------------------------------------------------------------- tests ---
def test_prefilter_keeps_edges_for_ineligible_paths_with_inference_records(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    plan = _mixed_plan(tmp_path, root)

    out = compile_plan_out(plan, "--overlap", "fold", "--repo-root", str(root))
    # A-B (bin.dat, non-text) keeps its serializing edge.
    assert _edges(out, "write-after-write") == [("A", "B")]
    # C-D (ok.py, text) drops and shares a wave.
    assert ("C", "D") not in _edges(out, "write-after-write")
    waves_flat = {tid: i for i, w in enumerate(out["waves"]) for tid in w}
    assert waves_flat["C"] == waves_flat["D"]

    # Exactly one inference record for the one ineligible path, memoised
    # per path (task "", edge "bin.dat" — the type_conflicts task:"" precedent).
    inference = _inference_conflicts(out)
    assert len(inference) == 1
    assert inference[0]["task"] == ""
    assert inference[0]["edge"] == "bin.dat"
    assert "pairs kept serialized" in inference[0]["note"]


def test_prefilter_covers_reads_paths(tmp_path):
    root = tmp_path / "repo"
    (root / "tests").mkdir(parents=True)
    (root / "tests" / "fixture_test.bin").write_bytes(b"\x00fixture bytes")

    plan = _write(tmp_path, "plan.md", _HEADER + (
        _task("A", "alpha", ["Modify: `src/a.py`", "Test: `tests/fixture_test.bin`"])
        + _task("B", "beta", ["Modify: `src/b.py`", "Test: `tests/fixture_test.bin`"])))

    out = compile_plan_out(plan, "--overlap", "fold", "--repo-root", str(root))
    # Disjoint writes (src/a.py vs src/b.py) — only the shared, non-text
    # `Test:` path forces the pair to stay serialized: the full overlap set
    # is `writes ∪ reads`, not `writes ∩ writes`.
    assert _edges(out, "write-after-write") == [("A", "B")]
    inference = _inference_conflicts(out)
    assert len(inference) == 1
    assert inference[0]["edge"] == "tests/fixture_test.bin"


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

    out = compile_plan_out(plan, "--overlap", "fold", "--repo-root", str(root))
    assert _edges(out, "write-after-write") == [("A", "B"), ("C", "D")]
    edges = {c["edge"] for c in _inference_conflicts(out)}
    assert edges == {"bin.dat", "link.py"}


@pytest.mark.parametrize("trailing_newline", [False, True])
def test_large_text_files_are_eligible_now_that_the_cap_is_retired(tmp_path,
                                                                  trailing_newline):
    """The size term is gone (spec 2026-08-18 §1d).

    This shape used to be the pre-filter's whole point: a file over
    the resolver line cap kept its pair serialized, and the line count had to be
    taken with the kernel's `split_lines` because `str.splitlines()` disagrees
    by one on a trailing-newline file — the off-by-one that decided the
    boundary. Neither spelling routes anything now: both are eligible, share a
    wave, and record nothing.
    """
    root = tmp_path / "repo"
    root.mkdir()
    body = "\n".join("x" for _ in range(BIG_LINES))
    (root / "big.py").write_text(body + "\n" if trailing_newline else body)

    plan = _write(tmp_path, "plan.md", _HEADER + (
        _task("A", "writer A", ["Modify: `big.py`"])
        + _task("B", "writer B", ["Modify: `big.py`"])))

    out = compile_plan_out(plan, "--overlap", "fold", "--repo-root", str(root))
    assert _edges(out, "write-after-write") == []
    assert _inference_conflicts(out) == []
    waves_flat = {tid: i for i, w in enumerate(out["waves"]) for tid in w}
    assert waves_flat["A"] == waves_flat["B"]


def test_without_repo_root_prefilter_is_inert(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    plan = _mixed_plan(tmp_path, root)

    # Same plan, same on-disk files, compiled WITHOUT --repo-root: every pair
    # is eligible (documented property — the runtime predicate is
    # authoritative there), so BOTH overlapping pairs drop.
    out = compile_plan_out(plan, "--overlap", "fold")
    assert _edges(out, "write-after-write") == []
    assert _inference_conflicts(out) == []


def test_serialize_mode_untouched_by_prefilter_flags(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    plan = _mixed_plan(tmp_path, root)

    # The pre-filter only ever runs in fold mode: --overlap serialize with a
    # --repo-root supplied is byte-identical to serialize with no root.
    # (The flagless invocation is fold since the spec-§5 default flip, so it
    # no longer participates in this serialize-side identity.)
    explicit = _run(plan, "--overlap", "serialize")
    with_root = _run(plan, "--overlap", "serialize", "--repo-root", str(root))
    assert with_root.stdout == explicit.stdout

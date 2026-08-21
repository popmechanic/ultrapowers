"""`--overlap {serialize,fold}`: the rollback knob, and nothing more.

`fold` is the shipped default (`OVERLAP_DEFAULT`): two tasks whose declared
paths merely overlap are not ordered at all — they share a wave and the kernel
folds their same-file edits at merge time. `serialize` re-enables EXACTLY the
document-order `write-after-write` tier; every other edge label is identical
between the two modes.

Every test compiles a plan written inline here (marker grammar per
`references/plan-markers.md`) under a `tmp_path`, so nothing is shared on
disk between tests.
"""
import json
import pathlib
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
FIXTURES = ROOT / "evals/fixtures"

sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
import compile_plan  # noqa: E402
from compile_plan import OVERLAP_DEFAULT  # noqa: E402


def _run(plan_path, *extra):
    p = subprocess.run([sys.executable, str(COMPILER), *extra, str(plan_path)],
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    return p


def compile_plan_json(plan_path, *extra):
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


_HEADER = "# Plan: overlap knob\n\n**Acceptance:** waived — inline test plan\n\n"


# ---------------------------------------------------------------- shapes ----
# (a) three tasks, all `Modify: src/x.py`, no Depends-on. Overlap-only: the
# single shape that separates the two modes.
SHAPE_A = _HEADER + "".join(
    _task(i, "writer " + i, ["Modify: `src/x.py`"]) for i in ("A", "B", "C"))

# (b) a creator, an editor of the created file, and a task whose `Test:` path
# is that same file — one write-after-create edge plus overlap-only pairs.
SHAPE_B = _HEADER + (
    _task("A", "creator", ["Create: `src/x.py`"])
    + _task("B", "editor", ["Modify: `src/x.py`"])
    + _task("C", "tester", ["Modify: `src/c.py`", "Test: `src/x.py`"]))

# (c) three writers pinned pairwise by explicit `**Depends-on:**` markers (the
# transitive closure, not a bare chain): every pair is already in `seen`, so
# tier 3 proposes nothing and the two modes must agree exactly.
SHAPE_C = _HEADER + (
    _task("A", "writer A", ["Modify: `src/x.py`"])
    + _task("B", "writer B", ["Modify: `src/x.py`"], deps=["A"])
    + _task("C", "writer C", ["Modify: `src/x.py`"], deps=["A", "B"]))


def _build(tmp_path, plan_text, overlap_mode, name="shape.md"):
    """Compile `plan_text` under `overlap_mode` and return its dag_edges."""
    return compile_plan_json(
        _write(tmp_path, name, plan_text), "--overlap", overlap_mode)["dag_edges"]


# -------------------------------------------------------- the mode contract --
def test_overlap_default_constant_ships_fold():
    assert compile_plan.OVERLAP_DEFAULT == "fold"
    assert OVERLAP_DEFAULT == "fold"


def test_serialize_mode_is_exactly_the_write_after_write_tier(tmp_path):
    edges = _build(tmp_path, SHAPE_A, "serialize")
    assert [e["why"] for e in edges if e["why"] == "write-after-write"]


def test_fold_mode_emits_no_write_after_write_edge_ever(tmp_path):
    for name, shape in (("a", SHAPE_A), ("b", SHAPE_B), ("c", SHAPE_C)):
        edges = _build(tmp_path, shape, "fold", name="shape_%s.md" % name)
        assert not [e for e in edges if e["why"] == "write-after-write"], name


def test_fold_and_serialize_agree_on_every_other_label(tmp_path):
    for name, shape in (("a", SHAPE_A), ("b", SHAPE_B), ("c", SHAPE_C)):
        fold_rest = sorted((e["from"], e["to"], e["why"])
                           for e in _build(tmp_path, shape, "fold",
                                           name="fold_%s.md" % name))
        ser_rest = sorted((e["from"], e["to"], e["why"])
                          for e in _build(tmp_path, shape, "serialize",
                                          name="ser_%s.md" % name)
                          if e["why"] != "write-after-write")
        assert fold_rest == ser_rest, name


def test_fold_mode_is_byte_identical_to_default_invocation(tmp_path):
    """`--overlap fold` == the flagless invocation, byte for byte, on every
    shape: the three inline shapes plus every committed eval fixture."""
    plans = [_write(tmp_path, "shape_%s.md" % n, t)
             for n, t in (("a", SHAPE_A), ("b", SHAPE_B), ("c", SHAPE_C))]
    plans += sorted(FIXTURES.glob("*/plan.md"))
    assert len(plans) > 3, "eval fixture plans must be part of the pin"
    for plan in plans:
        default = _run(plan)
        explicit = _run(plan, "--overlap", "fold")
        assert explicit.stdout == default.stdout, plan


def test_unknown_overlap_value_is_rejected_by_the_cli(tmp_path):
    plan = _write(tmp_path, "shape_a.md", SHAPE_A)
    p = subprocess.run(
        [sys.executable, str(COMPILER), "--overlap", "banana", str(plan)],
        capture_output=True, text=True)
    assert p.returncode != 0
    assert "invalid choice" in p.stderr


def test_unknown_overlap_value_is_rejected(tmp_path):
    """The library seam refuses too — the CLI `choices=` list is not the only
    guard, so a direct build_edges caller cannot smuggle an unknown mode in."""
    impl = []
    with pytest.raises(ValueError):
        compile_plan.build_edges(impl, overlap_mode="banana")


# --------------------------------------------------------------- the waves --
def test_overlapping_writers_share_one_wave_under_fold(tmp_path):
    out = compile_plan_json(_write(tmp_path, "a.md", SHAPE_A), "--overlap", "fold")
    assert out["waves"] == [["A", "B", "C"]]
    assert out["mode"] == "parallel"
    assert out["degrade_reason"] is None

    ser = compile_plan_json(_write(tmp_path, "a2.md", SHAPE_A),
                            "--overlap", "serialize")
    assert _edges(ser, "write-after-write") == [("A", "B"), ("A", "C"), ("B", "C")]
    assert ser["waves"] == [["A"], ["B"], ["C"]]


def test_write_after_create_survives_fold(tmp_path):
    """The one existence edge is not an overlap guess: it orders the pair in
    BOTH modes, and the `Test:`-path reader is freed only under fold."""
    out = compile_plan_json(_write(tmp_path, "b.md", SHAPE_B), "--overlap", "fold")
    assert _edges(out, "write-after-create") == [("A", "B")]
    assert _edges(out, "write-after-write") == []
    assert out["waves"] == [["A", "C"], ["B"]]


def test_explicit_markers_are_untouched_by_either_mode(tmp_path):
    for mode in ("fold", "serialize"):
        out = compile_plan_json(_write(tmp_path, "c_%s.md" % mode, SHAPE_C),
                                "--overlap", mode)
        assert _edges(out, "marker") == [("A", "B"), ("A", "C"), ("B", "C")], mode
        assert out["waves"] == [["A"], ["B"], ["C"]], mode


def test_single_implementation_task_still_degrades(tmp_path):
    plan = _write(tmp_path, "one.md", _HEADER
                  + _task("A", "only", ["Modify: `src/x.py`"]))
    for mode in ("fold", "serialize"):
        out = compile_plan_json(plan, "--overlap", mode)
        assert out["mode"] == "sequential", mode
        assert out["degrade_reason"] == "Sequential mode: 1 implementation tasks", mode
        assert out["waves"] == [["A"]], mode


def test_all_overlapping_writers_no_longer_degrade_under_fold(tmp_path):
    """The `fully overlapping writes` degrade retired with the ordering-guess
    tiers: under fold, overlapping writes are exactly what SHARES a wave."""
    out = compile_plan_json(_write(tmp_path, "a.md", SHAPE_A), "--overlap", "fold")
    assert out["mode"] == "parallel"
    assert out["degrade_reason"] is None
    ser = compile_plan_json(_write(tmp_path, "a2.md", SHAPE_A),
                            "--overlap", "serialize")
    assert ser["mode"] == "parallel"
    assert ser["degrade_reason"] is None


# ------------------------------------------------------- fixture regression --
@pytest.mark.parametrize("name", ["contend", "wide", "chained", "mixed", "degrade"])
def test_fold_never_adds_a_write_after_write_edge_on_the_fixtures(name):
    plan = FIXTURES / name / "plan.md"
    if not plan.exists():                       # fixture set is task-owned
        pytest.skip("fixture %s absent" % name)
    fold = compile_plan_json(plan, "--overlap", "fold")
    ser = compile_plan_json(plan, "--overlap", "serialize")
    assert _edges(fold, "write-after-write") == []
    assert set(_edges(fold, "write-after-create")) == set(
        _edges(ser, "write-after-create"))
    assert set(_edges(fold, "marker")) == set(_edges(ser, "marker"))

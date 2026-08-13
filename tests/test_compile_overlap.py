"""`--overlap {serialize,fold}`: the frontier-mode compile knob.

Spec: docs/superpowers/specs/2026-08-12-frontier-mode-in-engine-design.md §1.

`serialize` (the shipped default, `OVERLAP_DEFAULT`) reproduces today's
output byte-identically. `fold` drops the `write-after-write` edge for every
*droppable* pair AT CONSTRUCTION and records the pair in `dropped_pairs`
(both orderings), which the `mode`/`degrade_reason` labeling predicate then
consults. In THIS task there is no eligibility pre-filter yet, so every pair
that would receive a NEW `write-after-write` edge is droppable; Task 6
narrows eligibility with the `--repo-root` pre-filter.

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
from compile_plan import OVERLAP_DEFAULT  # noqa: E402


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


_HEADER = "# Plan: overlap knob\n\n**Acceptance:** waived — inline test plan\n\n"


# ---------------------------------------------------------------- shapes ----
# (a) three tasks, all `Modify: src/x.py`, no Depends-on.
SHAPE_A = _HEADER + "".join(
    _task(i, "writer " + i, ["Modify: `src/x.py`"]) for i in ("A", "B", "C"))

# (b) the same three writers, but every ordered pair is pinned by an EXPLICIT
# `**Depends-on:**` marker (the transitive closure, not just a chain). The
# eligibility pre-filter arrives in Task 6; here "ineligible" is expressed
# structurally: a pair already carrying an explicit edge sits in `seen`, so
# tier 3 never proposes a new edge for it and it is neither dropped nor
# freed. The closure — not a bare A->B->C chain — is what makes EVERY pair
# undroppable, which is what the spec's all-overlapping-*ineligible* pin
# requires (a bare chain leaves the (A, C) pair edge-free and hence
# droppable).
SHAPE_B = _HEADER + (
    _task("A", "writer A", ["Modify: `src/x.py`"])
    + _task("B", "writer B", ["Modify: `src/x.py`"], deps=["A"])
    + _task("C", "writer C", ["Modify: `src/x.py`"], deps=["A", "B"]))

# (c) disjoint writes, one shared `Test:` path — the overlap set for the
# write-after-write tier is `writes ∪ reads`, so the shared test file alone
# serializes the pair today.
SHAPE_C = _HEADER + (
    _task("A", "alpha", ["Modify: `src/a.py`", "Test: `tests/shared.py`"])
    + _task("B", "beta", ["Modify: `src/b.py`", "Test: `tests/shared.py`"]))

# (d) two tasks overlapping on `src/x.py` plus a third with disjoint files.
SHAPE_D = _HEADER + (
    _task("A", "writer A", ["Modify: `src/x.py`"])
    + _task("B", "writer B", ["Modify: `src/x.py`"])
    + _task("C", "unrelated", ["Modify: `src/z.py`"]))


# ------------------------------------------------------------ byte-identity --
def test_overlap_default_constant_ships_serialize():
    assert OVERLAP_DEFAULT == "serialize"


def test_serialize_mode_is_byte_identical_to_default_invocation(tmp_path):
    """`--overlap serialize` == today's flagless invocation, byte for byte, on
    every shape: the four inline shapes plus every committed eval fixture."""
    plans = [_write(tmp_path, "shape_%s.md" % n, t)
             for n, t in (("a", SHAPE_A), ("b", SHAPE_B),
                          ("c", SHAPE_C), ("d", SHAPE_D))]
    plans += sorted(FIXTURES.glob("*/plan.md"))
    assert len(plans) > 4, "eval fixture plans must be part of the pin"
    for plan in plans:
        default = _run(plan)
        explicit = _run(plan, "--overlap", "serialize")
        assert explicit.stdout == default.stdout, plan


def test_unknown_overlap_value_is_rejected(tmp_path):
    plan = _write(tmp_path, "shape_a.md", SHAPE_A)
    p = subprocess.run(
        [sys.executable, str(COMPILER), "--overlap", "merge", str(plan)],
        capture_output=True, text=True)
    assert p.returncode != 0
    assert "invalid choice" in p.stderr


# ------------------------------------------------------------- the drop -----
def test_fold_drops_only_new_write_after_write_edges(tmp_path):
    # (a) under fold: zero write-after-write edges; one wave of 3.
    a = _write(tmp_path, "shape_a.md", SHAPE_A)
    out = compile_plan(a, "--overlap", "fold")
    assert _edges(out, "write-after-write") == []
    assert out["waves"] == [["A", "B", "C"]]
    # today's behavior is untouched under serialize
    ser = compile_plan(a, "--overlap", "serialize")
    assert _edges(ser, "write-after-write") == [("A", "B"), ("A", "C"), ("B", "C")]
    assert ser["waves"] == [["A"], ["B"], ["C"]]

    # (b) under fold: marker edges survive; pairs already in `seen` are
    # neither dropped nor freed — the declared chain is preserved exactly.
    b = _write(tmp_path, "shape_b.md", SHAPE_B)
    out = compile_plan(b, "--overlap", "fold")
    assert _edges(out, "marker") == [("A", "B"), ("A", "C"), ("B", "C")]
    assert _edges(out, "write-after-write") == []
    assert out["waves"] == [["A"], ["B"], ["C"]]
    assert compile_plan(b, "--overlap", "serialize")["waves"] == [["A"], ["B"], ["C"]]

    # (c) under fold: the reads-driven write-after-write edge drops and both
    # tasks share a wave; under serialize it survives and they do not.
    c = _write(tmp_path, "shape_c.md", SHAPE_C)
    out = compile_plan(c, "--overlap", "fold")
    assert _edges(out, "write-after-write") == []
    assert out["waves"] == [["A", "B"]]
    ser = compile_plan(c, "--overlap", "serialize")
    assert _edges(ser, "write-after-write") == [("A", "B")]
    assert ser["waves"] == [["A"], ["B"]]


def test_fold_leaves_every_other_edge_label_untouched(tmp_path):
    """Spec §1c: `write-after-create` and `read-after-write` survive fold —
    only the document-order `write-after-write` tier drops."""
    plan = _write(tmp_path, "labels.md", _HEADER + (
        _task("A", "creator", ["Create: `src/x.py`"])
        + _task("B", "editor", ["Modify: `src/x.py`"])
        + _task("C", "tester", ["Modify: `src/c.py`", "Test: `src/x.py`"])))
    out = compile_plan(plan, "--overlap", "fold")
    assert _edges(out, "write-after-create") == [("A", "B")]
    assert _edges(out, "read-after-write") == [("A", "C"), ("B", "C")]
    assert _edges(out, "write-after-write") == []
    assert out["waves"] == [["A"], ["B"], ["C"]]


# ------------------------------------------------------- labeling predicate --
def test_labeling_predicate_full_iteration_four_shapes(tmp_path):
    """The `mode`/`degrade_reason` predicate iterates EVERY ordered pair (never
    only the kept-edge pairs, which would delete the `False` terms disjoint
    pairs contribute and flip ordinary plans to `sequential`)."""
    a = _write(tmp_path, "shape_a.md", SHAPE_A)
    b = _write(tmp_path, "shape_b.md", SHAPE_B)
    c = _write(tmp_path, "shape_c.md", SHAPE_C)
    d = _write(tmp_path, "shape_d.md", SHAPE_D)

    # (a) fold -> one contended wave, parallel, no degrade_reason.
    fold_a = compile_plan(a, "--overlap", "fold")
    assert fold_a["mode"] == "parallel"
    assert fold_a["degrade_reason"] is None
    assert fold_a["waves"] == [["A", "B", "C"]]
    # (a) serialize -> today's output exactly.
    ser_a = compile_plan(a, "--overlap", "serialize")
    assert ser_a["mode"] == "sequential"
    assert ser_a["degrade_reason"] == (
        "Sequential mode: 3 implementation tasks, fully overlapping writes")
    assert "fully overlapping writes" in ser_a["degrade_reason"]
    assert ser_a["waves"] == [["A"], ["B"], ["C"]]

    # (b) all-overlapping but no droppable pair -> sequential in BOTH modes.
    for mode in ("fold", "serialize"):
        out = compile_plan(b, "--overlap", mode)
        assert out["mode"] == "sequential", mode
        assert out["degrade_reason"] == (
            "Sequential mode: 3 implementation tasks, fully overlapping writes"), mode
        assert out["waves"] == [["A"], ["B"], ["C"]], mode

    # (c) shared `Test:` only -> parallel in both modes (the predicate is
    # writes-only; a `Test:` path lives in `reads`).
    for mode in ("fold", "serialize"):
        out = compile_plan(c, "--overlap", mode)
        assert out["mode"] == "parallel", mode
        assert out["degrade_reason"] is None, mode
    assert compile_plan(c, "--overlap", "fold")["waves"] == [["A", "B"]]
    assert compile_plan(c, "--overlap", "serialize")["waves"] == [["A"], ["B"]]

    # (d) two overlapping + one disjoint -> parallel in both modes. The
    # disjoint third task contributes the `False` terms; a kept-pairs reading
    # of the predicate would flip this to sequential under fold.
    for mode in ("fold", "serialize"):
        out = compile_plan(d, "--overlap", mode)
        assert out["mode"] == "parallel", mode
        assert out["degrade_reason"] is None, mode
    assert compile_plan(d, "--overlap", "fold")["waves"] == [["A", "B", "C"]]
    assert compile_plan(d, "--overlap", "serialize")["waves"] == [["A", "C"], ["B"]]


def test_single_implementation_task_still_degrades_after_flatten_deletion(tmp_path):
    """The deleted flatten was dead for the `len(impl) == 1` trigger too —
    Kahn already returns the one singleton wave."""
    plan = _write(tmp_path, "one.md", _HEADER
                  + _task("A", "only", ["Modify: `src/x.py`"]))
    for mode in ("fold", "serialize"):
        out = compile_plan(plan, "--overlap", mode)
        assert out["mode"] == "sequential", mode
        assert out["degrade_reason"] == "Sequential mode: 1 implementation tasks", mode
        assert out["waves"] == [["A"]], mode


# --------------------------------------------- construction-time drop proof --
def test_ambiguous_task_still_serializes_against_drop_affected_peers(tmp_path):
    """The drop happens at CONSTRUCTION, so later tiers (`ambiguous-files`,
    catch-all) still see a truthful adjacency: a task with an empty Files
    block added to shape (a) receives its `ambiguous-files` edges from all
    three writers even though every writer pair was dropped."""
    plan = _write(tmp_path, "ambig.md", SHAPE_A
                  + "### Task D: unscoped cleanup\n\n**Type:** implementation\n\n"
                    "**Files:**\n- none\n\n- [ ] **Step 1:** tidy up\n")
    out = compile_plan(plan, "--overlap", "fold")
    assert _edges(out, "write-after-write") == []
    assert _edges(out, "ambiguous-files") == [("A", "D"), ("B", "D"), ("C", "D")]
    assert out["waves"] == [["A", "B", "C"], ["D"]]

    ser = compile_plan(plan, "--overlap", "serialize")
    assert _edges(ser, "ambiguous-files") == [("A", "D"), ("B", "D"), ("C", "D")]
    assert ser["waves"] == [["A"], ["B"], ["C"], ["D"]]


def test_catch_all_task_still_integrates_last_under_fold(tmp_path):
    """Same construction-time guarantee for the catch-all tier."""
    plan = _write(tmp_path, "catchall.md", SHAPE_A
                  + "### Task D: open-ended sweep\n\n**Type:** implementation\n\n"
                    "**Files:**\n- catch-all: everything the sweep touches\n\n"
                    "- [ ] **Step 1:** sweep\n")
    out = compile_plan(plan, "--overlap", "fold")
    # A catch-all bullet parses no concrete path, so the ambiguous-files tier
    # claims the three edges first and the catch-all tier finds them already
    # in `seen` — either way every writer is ordered before the sweep.
    incoming = sorted(e["from"] for e in out["dag_edges"] if e["to"] == "D")
    assert incoming == ["A", "B", "C"]
    assert out["waves"] == [["A", "B", "C"], ["D"]]
    assert out["launch_waves"][1][0]["catchAll"] == "everything the sweep touches"


# ------------------------------------------------- disclosed direction flip --
def test_reachability_direction_flip_is_pinned(tmp_path):
    """Spec §1a's one disclosed behavioral difference, with a witness.

    Dropping edges shrinks the adjacency later `would_cycle` calls read, so a
    later-tier edge that reachability blocks TODAY can appear under fold — and
    the affected pair then serializes in the opposite direction.

    Shape: `A` is an ambiguous (empty-Files) task at document position 0 that
    declares `**Depends-on:** C`; `B` and `C` both write `src/x.py`.

      serialize — tier 3 adds B -> C, so C reaches A (C -> A marker) and A
        reaches nothing; both ambiguous-files candidates A -> B and A -> C are
        blocked by reachability. Order: B, C, A.
      fold — the B/C pair is dropped, so C no longer reaches B; the
        ambiguous-files tier now adds A -> B, an edge that does not exist
        today, and A runs BEFORE B instead of after it. Order: C, A, B.
    """
    plan = _write(tmp_path, "flip.md", _HEADER
                  + "### Task A: unscoped\n\n**Type:** implementation\n"
                    "**Depends-on:** C\n\n**Files:**\n- none\n\n"
                    "- [ ] **Step 1:** tidy up\n\n"
                  + _task("B", "writer B", ["Modify: `src/x.py`"])
                  + _task("C", "writer C", ["Modify: `src/x.py`"]))

    ser = compile_plan(plan, "--overlap", "serialize")
    assert _edges(ser, "marker") == [("C", "A")]
    assert _edges(ser, "write-after-write") == [("B", "C")]
    assert _edges(ser, "ambiguous-files") == []
    assert ser["waves"] == [["B"], ["C"], ["A"]]

    fold = compile_plan(plan, "--overlap", "fold")
    assert _edges(fold, "marker") == [("C", "A")]
    assert _edges(fold, "write-after-write") == []
    # The flip: an ambiguous-files edge A -> B that serialize does not have,
    # reversing A and B relative to today.
    assert _edges(fold, "ambiguous-files") == [("A", "B")]
    assert fold["waves"] == [["C"], ["A"], ["B"]]


# ------------------------------------------------------- fixture regression --
@pytest.mark.parametrize("name", ["contend", "wide", "chained", "mixed", "degrade"])
def test_fold_never_adds_a_write_after_write_edge_on_the_fixtures(name):
    plan = FIXTURES / name / "plan.md"
    if not plan.exists():                       # fixture set is task-owned
        pytest.skip("fixture %s absent" % name)
    fold = compile_plan(plan, "--overlap", "fold")
    ser = compile_plan(plan, "--overlap", "serialize")
    assert _edges(fold, "write-after-write") == []
    assert set(_edges(fold, "write-after-create")) == set(
        _edges(ser, "write-after-create"))
    assert set(_edges(fold, "marker")) == set(_edges(ser, "marker"))

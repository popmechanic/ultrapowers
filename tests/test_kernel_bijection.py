"""The kernel's line convention is a bijection over files that EXIST:
`split_lines`/`join_lines` invert each other, the empty file is `[""]`, and
`[]` is reserved for absence (deletion mark / never-existed) so an emptied
file and a deleted one stop colliding. Every line count rides `split_lines`.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KERNEL = ROOT / "skills" / "ultrapowers" / "kernel"
sys.path.insert(0, str(KERNEL))
sys.path.insert(0, str(KERNEL / "vendor"))
import manyana
import repo_weave as rw
import frontier_fold as ff


def test_split_join_is_a_bijection_on_trailing_and_no_trailing_newline():
    assert rw.split_lines("a\nb\n") == ["a", "b", ""]
    assert rw.split_lines("a\nb") == ["a", "b"]
    assert rw.join_lines(["a", "b", ""]) == "a\nb\n"
    assert rw.join_lines(["a", "b"]) == "a\nb"


def test_empty_file_is_single_empty_line_and_join_inverts():
    assert rw.split_lines("") == [""]
    assert rw.join_lines([""]) == ""


def test_split_lines_never_yields_empty_list():
    # [] denotes absence; split_lines can never produce it.
    for content in ("", "\n", "x", "x\n", "\n\n"):
        assert rw.split_lines(content) != []


def test_round_trip_is_byte_identical_on_every_spelling():
    for content in ("", "\n", "x", "x\n", "x\n\n", "a\nb", "a\nb\n", "\na"):
        assert rw.join_lines(rw.split_lines(content)) == content


def test_deleted_path_stays_omitted_and_emptied_file_materializes_empty():
    # deletion mark ([]) and truncation-to-empty ([""]) no longer collide:
    # a state whose visible lines are [] and is marked deleted is omitted;
    # a state whose visible lines are [""] survives as the empty file.
    files = {"gone.txt": manyana.update_state(manyana.initial_state(["x"]), []),
             "empty.txt": manyana.update_state(manyana.initial_state(["x"]), [""])}
    state = rw.RepoState(files=files, deleted_marks=frozenset({"gone.txt"}),
                         raw={}, raw_candidates={})
    m = rw.manifest(state)
    assert "gone.txt" not in m
    assert m["empty.txt"] == ""


def test_a_folded_file_with_no_final_newline_materializes_byte_identical():
    """The blind spot the bijection closes: the old convention rewrote a
    final-newline-less file by appending one, and both self-checks compared
    manifests built through that same normalization."""
    base = rw.RepoState(
        files={"cli.py": manyana.initial_state(rw.split_lines("a = 1\nb = 2"))},
        deleted_marks=frozenset(), raw={})
    task = rw.task_state_from_contents(base, "t1", {"cli.py": "a = 9\nb = 2"})
    frontier, conflicts = rw.fold(base, base, task)
    assert conflicts == []
    assert rw.manifest(frontier)["cli.py"] == "a = 9\nb = 2"


def test_dispatchable_counts_via_split_lines_exact_cap_boundary():
    # a body of exactly RESOLVER_LINE_CAP visible lines (per split_lines) is
    # dispatchable; one more is not. splitlines() would disagree by one on
    # the trailing-newline spelling — the kernel's own convention decides.
    cap = ff.RESOLVER_LINE_CAP
    body_at_cap = "\n".join("l%d" % i for i in range(cap - 1)) + "\n"
    assert len(rw.split_lines(body_at_cap)) == cap
    body_over = body_at_cap + "x\n"
    assert len(rw.split_lines(body_over)) == cap + 1
    assert len(body_at_cap.splitlines()) == cap - 1      # the disagreement

    narration = rw.MARKERS[0] + " frontier\nadded x\n" + rw.MARKERS[2] + " t1\n"
    ok, _ = ff.dispatchable(rw.Conflict("f.py", "lines", "t1", narration),
                            {"f.py": body_at_cap})
    assert ok
    ok, reason = ff.dispatchable(rw.Conflict("f.py", "lines", "t1", narration),
                                 {"f.py": body_over})
    assert not ok and "visible lines" in reason

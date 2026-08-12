"""#132 regressions. The merge itself was always order-independent (manifests
and conflict SETS: 0/400 fuzz divergence); only the reporting shape flipped:
the multiset at 3+ writers x 2+ regions (12/400) and, pre-`_text_kind`, the
delete/modify kind label (29/500). Fix = the issue's recorded candidates:
set-based comparison + presentation nits. Seed sets are the contract.
"""
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "evals" / "frontier"))
sys.path.insert(0, str(ROOT / "tests"))
import repo_weave as rw
from test_frontier_weave import (make_base, fold_in_order, conflict_keys,
                                 assert_order_independent)


def _region_fn(name, body_note):
    return ["def %s(x):" % name, "    # %s" % body_note, "    return x", ""]


def _multiset_case(seed):
    """3 text writers, each editing 2 distinct regions of one path."""
    rng = random.Random(seed)
    regions = [_region_fn("fn_%d" % i, "base") for i in range(6)]
    base = make_base({"hot.py": "\n".join(sum(regions, []))})
    tasks = []
    for t in range(3):
        picks = rng.sample(range(6), 2)
        edited = [list(r) for r in regions]
        for i in picks:
            edited[i] = _region_fn("fn_%d" % i, "edit by t%d" % t)
        tasks.append(rw.task_state_from_contents(
            base, "t%d" % t, {"hot.py": "\n".join(sum(edited, []))}))
    return base, tasks


def test_multiset_seed_set_is_order_independent_under_set_comparison():
    # The 12/400 class: any seed must yield ONE outcome under set comparison.
    for seed in range(400):
        base, tasks = _multiset_case(seed)
        assert_order_independent(base, tasks)


def test_delete_modify_kind_labels_are_order_independent():
    # The 29/500 class: {delete, editA, editB} on one path. Expected to pass
    # against the committed base-derived _text_kind; a failure here means a
    # frontier-derived relabel crept back in (the order-sensitive move the
    # repo_weave docstring warns against).
    lines = ["def keep(x):", "    return x", "", "def gone(y):", "    return y", ""]
    for seed in range(500):
        rng = random.Random(seed)
        base = make_base({"mix.py": "\n".join(lines)})
        edit_a = list(lines); edit_a[1] = "    return x + %d" % rng.randrange(9)
        edit_b = list(lines); edit_b[4] = "    return y * %d" % rng.randrange(9)
        tasks = [rw.task_state_from_contents(base, "del", {"mix.py": None}),
                 rw.task_state_from_contents(base, "ta", {"mix.py": "\n".join(edit_a)}),
                 rw.task_state_from_contents(base, "tb", {"mix.py": "\n".join(edit_b)})]
        assert_order_independent(base, tasks)


def test_lone_type_change_reports_no_conflict():
    # Presentation nit 1: a single task rewriting a base TEXT file as binary is
    # a type change by one writer — git reports no conflict, neither do we.
    base = make_base({"doc.txt": "hello\n"})
    t = rw.task_state_from_contents(base, "t1", {"doc.txt": b"\x00\x01"})
    frontier, conflicts = rw.fold(base, base, t)
    assert conflicts == []
    assert rw.manifest(frontier)["doc.txt"] == b"\x00\x01"


def test_concurrent_text_edit_and_binary_write_still_conflicts():
    # The genuine two-writer collision keeps its conflict.
    base = make_base({"doc.txt": "hello\n"})
    t_text = rw.task_state_from_contents(base, "t1", {"doc.txt": "hello world\n"})
    t_bin = rw.task_state_from_contents(base, "t2", {"doc.txt": b"\x00\x01"})
    _, keys = assert_order_independent(base, [t_text, t_bin])
    assert ("doc.txt", "binary") in keys


# ---------------------------------------------------------------------------
# plan-defect regressions (see the module's commit body): the plan's Step 5
# shipped `files.get(p) is not base.files.get(p)` as the authorship test and
# `"text wins" if visible` as the narration. Both are wrong; these pin the
# corrected contracts.
# ---------------------------------------------------------------------------

# A text write whose lines equal the base's is a NO-OP at the weave level:
# `manyana.update_state` returns its input state object unchanged when the new
# lines equal the current ones (vendor/manyana.py), so such a task carries the
# base's own state object. Authorship inferred from object identity therefore
# reads these as "task-authored" in one fold order and "still base's" in
# another — the exact K1 break this module exists to measure. Content decides.
NOOP_TEXT_WRITES = {
    "byte-identical rewrite": "l1\nl2\n",   # e.g. a mode-only commit
    "trailing-newline-only": "l1\nl2",      # split_lines drops the newline
}


def test_noop_text_write_beside_binary_write_is_a_lone_type_change():
    # Required fix 1. A write that changes no line is not a text writer: the
    # pair is one writer changing the file's type, so bytes win with NO
    # conflict — and that outcome must hold in BOTH fold orders (manifest AND
    # conflict set), which the identity idiom did not give.
    for label, text in NOOP_TEXT_WRITES.items():
        base = make_base({"p.txt": "l1\nl2\n"})
        t_text = rw.task_state_from_contents(base, "t-text", {"p.txt": text})
        t_bin = rw.task_state_from_contents(base, "t-bin", {"p.txt": b"\x00\x01"})
        manifest, keys = assert_order_independent(base, [t_text, t_bin])
        assert manifest == {"p.txt": b"\x00\x01"}, label
        assert keys == [], label


def test_noop_text_write_does_not_mask_a_real_concurrent_text_writer():
    # The no-op writer must not suppress a genuine collision: a second task
    # that really edits the text keeps the binary conflict, in every order.
    base = make_base({"p.txt": "l1\nl2\n"})
    tasks = [rw.task_state_from_contents(base, "t-noop", {"p.txt": "l1\nl2"}),
             rw.task_state_from_contents(base, "t-edit", {"p.txt": "l1\nl2-x\n"}),
             rw.task_state_from_contents(base, "t-bin", {"p.txt": b"\x00\x01"})]
    manifest, keys = assert_order_independent(base, tasks)
    assert keys == [("p.txt", "binary")]
    assert manifest == {"p.txt": "l1\nl2-x\n"}   # text wins, as narrated


def _binary_winner_claimed(conflicts):
    """(path -> "text"/"bytes") as claimed by each text/bytes pairing narration.

    Only `_fold_presence`'s text-vs-bytes pairing names a manifest winner;
    `_fold_binary`'s divergent-bytes report makes no such claim, so it is
    skipped rather than mis-read.
    """
    claims = {}
    for c in conflicts:
        if c.kind != "binary":
            continue
        if "text wins the manifest" in c.narration:
            claims[c.path] = "text"
        elif "bytes win the manifest" in c.narration:
            claims[c.path] = "bytes"
    return claims


def test_binary_narration_names_the_actual_manifest_winner_text_direction():
    # Required fix 2, direction A. `manifest` keeps the text record when its
    # lines are visible OR the path carries no delete mark, so an EMPTY but
    # undeleted weave is still a text win — the case the `visible` predicate
    # mis-narrated.
    for text, expected in (("hello world\n", "hello world\n"), ("", "")):
        base = make_base({"doc.txt": "hello\n"})
        t_text = rw.task_state_from_contents(base, "t1", {"doc.txt": text})
        t_bin = rw.task_state_from_contents(base, "t2", {"doc.txt": b"\x00\x01"})
        for order in ([0, 1], [1, 0]):
            frontier, conflicts = fold_in_order(base, [t_text, t_bin], order)
            assert _binary_winner_claimed(conflicts) == {"doc.txt": "text"}
            assert rw.manifest(frontier) == {"doc.txt": expected}


def test_binary_narration_names_the_actual_manifest_winner_bytes_direction():
    # Required fix 2, direction B. When the text side is a folded whole-file
    # delete, bytes win the manifest — the narration must say so.
    base = make_base({"doc.txt": "hello\n"})
    t_del = rw.task_state_from_contents(base, "t1", {"doc.txt": None})
    t_bin = rw.task_state_from_contents(base, "t2", {"doc.txt": b"\x00\x01"})
    for order in ([0, 1], [1, 0]):
        frontier, conflicts = fold_in_order(base, [t_del, t_bin], order)
        assert _binary_winner_claimed(conflicts) == {"doc.txt": "bytes"}
        assert rw.manifest(frontier) == {"doc.txt": b"\x00\x01"}


def _mixed_case(seed):
    """2-3 tasks writing text / empty text / bytes / deletes over three paths."""
    rng = random.Random(seed)
    base = make_base({"t.txt": "l1\nl2\n", "b.bin": b"\x00\x01"})
    paths = ["t.txt", "b.bin", "new.txt"]
    tasks = []
    for i in range(rng.choice((2, 3))):
        contents = {}
        for p in paths:
            choice = rng.choice(("skip", "text", "empty", "bytes", "delete", "noop"))
            if choice == "text":
                contents[p] = "l1\nx%d\n" % i
            elif choice == "empty":
                contents[p] = ""
            elif choice == "bytes":
                contents[p] = b"\x00\x02" if i % 2 else b"\x00\x03"
            elif choice == "delete":
                contents[p] = None
            elif choice == "noop":
                contents[p] = "l1\nl2\n"
        tasks.append(rw.task_state_from_contents(base, "t%d" % i, contents))
    return base, tasks


def test_every_binary_narration_matches_the_manifest_of_its_own_fold():
    # Required fix 2 as a property, over the mixes the hand-written cases
    # sample: a fold that CLAIMS a winner must return a manifest agreeing with
    # the claim. (`visible` alone contradicted itself on thousands of folds.)
    for seed in range(400):
        base, tasks = _mixed_case(seed)
        for order in (list(range(len(tasks))), list(reversed(range(len(tasks))))):
            frontier = base
            for i in order:
                frontier, conflicts = rw.fold(base, frontier, tasks[i])
                manifest = rw.manifest(frontier)
                for path, claim in _binary_winner_claimed(conflicts).items():
                    actual = "text" if isinstance(manifest.get(path), str) else "bytes"
                    assert claim == actual, (
                        "seed %d: narration claims %s wins for %s but manifest holds %r"
                        % (seed, claim, path, manifest.get(path)))


def test_mixed_seed_set_is_order_independent():
    # K1 over the same mixes — manifest AND conflict set, every permutation.
    for seed in range(400):
        base, tasks = _mixed_case(seed)
        assert_order_independent(base, tasks)

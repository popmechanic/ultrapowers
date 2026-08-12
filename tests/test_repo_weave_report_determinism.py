"""#132 regressions. The merge itself was always order-independent (manifests
and conflict SETS: 0/400 fuzz divergence); only the reporting shape flipped:
the multiset at 3+ writers x 2+ regions (12/400) and, pre-`_text_kind`, the
delete/modify kind label (29/500). Fix = the issue's recorded candidates:
set-based comparison + presentation nits. Seed sets are the contract."""
import random
import sys
from itertools import permutations
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


def test_binary_narration_names_the_actual_manifest_winner():
    # Presentation nit 2: when the text side is a folded whole-file delete,
    # bytes win the manifest — the narration must not claim text wins.
    base = make_base({"doc.txt": "hello\n"})
    t_del = rw.task_state_from_contents(base, "t1", {"doc.txt": None})
    t_bin = rw.task_state_from_contents(base, "t2", {"doc.txt": b"\x00\x01"})
    for order in ([0, 1], [1, 0]):
        frontier, conflicts = fold_in_order(base, [t_del, t_bin], order)
        manifest = rw.manifest(frontier)
        for c in conflicts:
            if c.kind == "binary" and "text wins" in c.narration:
                assert isinstance(manifest.get("doc.txt"), str), \
                    "narration claims text wins but bytes won: %r" % c.narration


# --- the two fixes the prior attempt's review demanded ---------------------
#
# 1. Authorship is recorded, never inferred from the weave object: a task whose
#    text write normalizes to the base's own lines (a trailing-newline-only or
#    edit-then-revert commit) carries the base's weave object unchanged
#    (`manyana.update_state` returns its input when the lines already match).
# 2. The binary narration names the actual manifest winner in BOTH directions:
#    `manifest` keeps a text record when `lines or p not in deleted_marks`, so
#    an empty-but-not-deleted weave still wins.


def _noop_write_tasks(base):
    """A no-op text write (trailing newline only) racing a byte write."""
    return [rw.task_state_from_contents(base, "t-text", {"p.txt": "l1\nl2"}),
            rw.task_state_from_contents(base, "t-bin", {"p.txt": b"\x00\x01"})]


def test_noop_text_write_is_recorded_as_authorship():
    """The weave object itself is indistinguishable from the base's."""
    base = make_base({"p.txt": "l1\nl2\n"})
    t_text, _ = _noop_write_tasks(base)
    assert t_text.weaves["p.txt"] == base.files["p.txt"]      # no content change
    assert "p.txt" in t_text.weaves                           # still an authorship
    frontier, _ = rw.fold(base, base, t_text)
    assert "p.txt" in frontier.text_authored
    assert "p.txt" not in base.text_authored


def test_noop_text_write_racing_a_binary_write_is_order_independent():
    """K1 over both legs: the manifest AND the conflict set.

    Inferring authorship from `files[p] is base.files.get(p)` diverges here —
    [text, bin] keeps the text and reports ('p.txt', 'binary'); [bin, text]
    drops the text record and reports nothing.
    """
    base = make_base({"p.txt": "l1\nl2\n"})
    manifest, keys = assert_order_independent(
        base, _noop_write_tasks(base),
        expected_manifest={"p.txt": "l1\nl2\n"},
        expected_conflicts=[("p.txt", "binary")])
    assert isinstance(manifest["p.txt"], str)


def _assert_narration_matches_its_own_fold(base, tasks):
    """Every binary narration's winner claim, checked against the manifest of
    the very fold that emitted it, in every order. Both directions: a
    "text wins" claim must find text, a "bytes win" claim must find bytes."""
    for order in permutations(range(len(tasks))):
        frontier = base
        for i in order:
            frontier, cs = rw.fold(base, frontier, tasks[i])
            manifest = rw.manifest(frontier)
            for c in cs:
                # The presence pairing is the one that names a winner;
                # `_fold_binary`'s byte-vs-byte narrations name none.
                if "written as text and as binary" not in c.narration:
                    continue
                got = manifest.get(c.path)
                if "text wins" in c.narration:
                    assert isinstance(got, str), \
                        "claims text wins, manifest has %r: %r" % (got, c.narration)
                elif "bytes win" in c.narration:
                    assert isinstance(got, bytes), \
                        "claims bytes win, manifest has %r: %r" % (got, c.narration)
                else:
                    raise AssertionError("narration names no winner: %r" % c.narration)


def test_binary_narration_bytes_win_direction():
    """Folded whole-file delete + byte write: bytes win, and it must say so."""
    base = make_base({"doc.txt": "hello\n"})
    tasks = [rw.task_state_from_contents(base, "t-del", {"doc.txt": None}),
             rw.task_state_from_contents(base, "t-bin", {"doc.txt": b"\x00\x01"})]
    manifest, keys = assert_order_independent(
        base, tasks, expected_manifest={"doc.txt": b"\x00\x01"},
        expected_conflicts=[("doc.txt", "binary")])
    _assert_narration_matches_its_own_fold(base, tasks)


def test_binary_narration_text_wins_on_an_emptied_but_undeleted_path():
    """The mirror the prior regression left half-verified: an EMPTY weave that
    was never deleted still wins the manifest (`lines or p not in
    deleted_marks`), so the narration may not hand it to the bytes."""
    base = make_base({"t.txt": "l1\nl2\n"})
    tasks = [rw.task_state_from_contents(base, "t1", {"t.txt": ""}),
             rw.task_state_from_contents(base, "t2", {"t.txt": b"\x00\x01"})]
    manifest, keys = assert_order_independent(
        base, tasks, expected_manifest={"t.txt": ""},
        expected_conflicts=[("t.txt", "binary")])
    _assert_narration_matches_its_own_fold(base, tasks)


def _mixed_tasks(rng, base, ntasks):
    """Text edits, NO-OP text writes, byte writes and deletes over a base-text,
    a base-binary and a new path."""
    per_task = []
    for i in range(ntasks):
        contents = {}
        for p in ("p.txt", "b.bin", "c.new"):
            r = rng.random()
            if r < 0.2:
                continue
            if r < 0.4:
                contents[p] = None
            elif r < 0.6:
                contents[p] = bytes([0, rng.randint(1, 3)])
            elif r < 0.8:
                contents[p] = "l1\nX%d\nl2\n" % rng.randint(1, 3)
            else:
                contents[p] = "l1\nl2"           # no-op on p.txt, an add elsewhere
        per_task.append(contents)
    return [rw.task_state_from_contents(base, "t%d" % i, c)
            for i, c in enumerate(per_task)]


def test_randomized_mixes_including_noop_text_writes_are_order_independent():
    """The hole the committed fuzz never reached: it always writes content that
    differs from the base, so no task ever carries the base's own weave."""
    rng = random.Random(132)
    base = make_base({"p.txt": "l1\nl2\n", "b.bin": b"\x00\x01"})
    seen = set()
    for _ in range(300):
        tasks = _mixed_tasks(rng, base, rng.randint(2, 3))
        _, keys = assert_order_independent(base, tasks)
        seen.update(k for _, k in keys)
    assert {"binary", "delete/modify", "lines", "add/add"} <= seen


def test_randomized_mixes_narrate_the_winner_they_actually_produce():
    """The reviewer's sweep, kept: no fold may claim a winner its own manifest
    contradicts."""
    rng = random.Random(1320)
    base = make_base({"p.txt": "l1\nl2\n", "b.bin": b"\x00\x01"})
    for _ in range(300):
        tasks = _mixed_tasks(rng, base, rng.randint(2, 3))
        _assert_narration_matches_its_own_fold(base, tasks)

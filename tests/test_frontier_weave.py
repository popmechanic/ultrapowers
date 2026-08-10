"""Repo-level weave layer: fold semantics, order-independence, idempotency."""
import random
import sys
from itertools import permutations
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "evals" / "frontier"))
import repo_weave as rw

sys.path.insert(0, str(ROOT / "evals" / "frontier" / "vendor"))
import manyana


def make_base(contents):
    files, raw = {}, {}
    for p, c in contents.items():
        if isinstance(c, bytes):
            raw[p] = c
        else:
            files[p] = manyana.initial_state(rw.split_lines(c))
    return rw.RepoState(files=files, deleted_marks=frozenset(), raw=raw)


BASE = make_base({
    "calc.py": "def calculate(x):\n    a = x * 2\n    b = a + 1\n    return b\n",
    "other.py": "VALUE = 1\n",
})


def fold_in_order(base, tasks, order):
    frontier, conflicts = base, []
    for i in order:
        frontier, cs = rw.fold(base, frontier, tasks[i])
        conflicts.extend(cs)
    return frontier, conflicts


def conflict_keys(conflicts):
    return sorted((c.path, c.kind) for c in conflicts)


def assert_order_independent(base, tasks, expected_manifest=None, expected_conflicts=None):
    """Fold `tasks` in EVERY order; manifest and conflict multiset must agree.

    Returns the single (manifest, conflict-keys) outcome so callers can assert
    further on it. This is the K1 gate the module exists to measure: a rule that
    is merely deterministic per order is not good enough.
    """
    outcomes = set()
    for order in permutations(range(len(tasks))):
        frontier, conflicts = fold_in_order(base, tasks, list(order))
        outcomes.add((tuple(sorted(rw.manifest(frontier).items())),
                      tuple(conflict_keys(conflicts))))
    assert len(outcomes) == 1, "fold outcome depends on order: %r" % (outcomes,)
    (items, keys), = outcomes
    manifest, keys = dict(items), list(keys)
    if expected_manifest is not None:
        assert manifest == expected_manifest
    if expected_conflicts is not None:
        assert keys == sorted(expected_conflicts)
    return manifest, keys


def test_disjoint_files_fold_clean_any_order():
    t1 = rw.task_state_from_contents(BASE, "t1", {"calc.py": "def calculate(x):\n    return x * 2\n"})
    t2 = rw.task_state_from_contents(BASE, "t2", {"other.py": "VALUE = 2\n"})
    tasks = [t1, t2]
    results = [fold_in_order(BASE, tasks, list(o)) for o in permutations(range(2))]
    manifests = [rw.manifest(f) for f, _ in results]
    assert manifests[0] == manifests[1]
    assert all(cs == [] for _, cs in results)
    assert manifests[0]["other.py"] == "VALUE = 2\n"


def test_same_file_distant_edits_fold_clean():
    body = "\n".join(f"line{i}" for i in range(20)) + "\n"
    base = make_base({"big.py": body})
    t1 = rw.task_state_from_contents(base, "t1", {"big.py": body.replace("line1\n", "line1-edited\n")})
    t2 = rw.task_state_from_contents(base, "t2", {"big.py": body.replace("line18\n", "line18-edited\n")})
    frontier, conflicts = fold_in_order(base, [t1, t2], [0, 1])
    assert conflicts == []
    m = rw.manifest(frontier)
    assert "line1-edited" in m["big.py"] and "line18-edited" in m["big.py"]


def test_delete_modify_conflicts_and_is_order_independent():
    t_del = rw.task_state_from_contents(BASE, "t-del", {"calc.py": None})
    t_mod = rw.task_state_from_contents(
        BASE, "t-mod",
        {"calc.py": "def calculate(x):\n    a = x * 2\n    logger.debug(a)\n    b = a + 1\n    return b\n"})
    tasks = [t_del, t_mod]
    results = [fold_in_order(BASE, tasks, list(o)) for o in permutations(range(2))]
    m0, m1 = (rw.manifest(f) for f, _ in results)
    assert m0 == m1
    k0, k1 = (conflict_keys(cs) for _, cs in results)
    assert k0 == k1
    assert ("calc.py", "delete/modify") in k0
    narrations = [c.narration for _, cs in results for c in cs]
    assert any("frontier" in n or "t-del" in n or "t-mod" in n for n in narrations)


def test_add_add_identical_clean_divergent_conflicts():
    ta = rw.task_state_from_contents(BASE, "ta", {"new.py": "x = 1\n"})
    tb_same = rw.task_state_from_contents(BASE, "tb", {"new.py": "x = 1\n"})
    tb_diff = rw.task_state_from_contents(BASE, "tb", {"new.py": "x = 2\n"})
    f, cs = fold_in_order(BASE, [ta, tb_same], [0, 1])
    assert conflict_keys(cs) == []
    assert rw.manifest(f)["new.py"] == "x = 1\n"
    _, cs2 = fold_in_order(BASE, [ta, tb_diff], [0, 1])
    assert ("new.py", "add/add") in conflict_keys(cs2)


def test_fold_idempotent():
    t1 = rw.task_state_from_contents(BASE, "t1", {"calc.py": "def calculate(x):\n    return x\n"})
    f1, c1 = rw.fold(BASE, BASE, t1)
    f2, c2 = rw.fold(BASE, f1, t1)
    assert rw.manifest(f1) == rw.manifest(f2)
    assert conflict_keys(c2) == []


def test_three_task_permutations_identical():
    base = make_base({"a.py": "a1\na2\na3\n", "b.py": "b1\nb2\n"})
    tasks = [
        rw.task_state_from_contents(base, "t1", {"a.py": "a1\na2-x\na3\n"}),
        rw.task_state_from_contents(base, "t2", {"b.py": None}),
        rw.task_state_from_contents(base, "t3", {"c.py": "c1\n"}),
    ]
    outcomes = set()
    for order in permutations(range(3)):
        frontier, conflicts = fold_in_order(base, tasks, list(order))
        outcomes.add((tuple(sorted(rw.manifest(frontier).items())),
                      tuple(conflict_keys(conflicts))))
    assert len(outcomes) == 1


def test_binary_both_touch_conflicts():
    base = make_base({"img.bin": b"\x00\x01"})
    t1 = rw.task_state_from_contents(base, "t1", {"img.bin": b"\x00\x02"})
    t2 = rw.task_state_from_contents(base, "t2", {"img.bin": b"\x00\x03"})
    _, cs = fold_in_order(base, [t1, t2], [0, 1])
    assert ("img.bin", "binary") in conflict_keys(cs)
    # Both orders agree on the whole outcome, not just on containment.
    assert_order_independent(base, [t1, t2],
                             expected_manifest={"img.bin": b"\x00\x02"},
                             expected_conflicts=[("img.bin", "binary")])


def test_snapshot_publish_roundtrip(tmp_path):
    import subprocess
    repo = tmp_path / "r"
    repo.mkdir()

    def git(*args):
        subprocess.run(["git", "-C", str(repo), *args], check=True,
                       capture_output=True, text=True)

    git("init", "-q", "-b", "main")
    git("config", "user.email", "t@t")
    git("config", "user.name", "t")
    (repo / "f.py").write_text("one\ntwo\n")
    git("add", "."); git("commit", "-qm", "base")
    base_sha = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"],
                              capture_output=True, text=True, check=True).stdout.strip()
    (repo / "f.py").write_text("one\ntwo\nthree\n")
    (repo / "g.py").write_text("g\n")
    git("add", "."); git("commit", "-qm", "task")
    base = rw.snapshot(repo, base_sha)
    task = rw.publish(base, repo, base_sha, "HEAD", "t1")
    frontier, conflicts = rw.fold(base, base, task)
    assert conflicts == []
    m = rw.manifest(frontier)
    assert m["f.py"] == "one\ntwo\nthree\n" and m["g.py"] == "g\n"


def test_materialize_writes_tree(tmp_path):
    t1 = rw.task_state_from_contents(BASE, "t1", {"new.py": "x = 1\n"})
    frontier, _ = rw.fold(BASE, BASE, t1)
    rw.materialize(frontier, tmp_path / "out")
    assert (tmp_path / "out" / "new.py").read_text() == "x = 1\n"
    assert (tmp_path / "out" / "calc.py").exists()


# --- stated semantics the cases above do not reach -------------------------


def test_conflict_identity_is_path_and_kind():
    a = rw.Conflict("p.py", "lines", "t1", "narration-A")
    b = rw.Conflict("p.py", "lines", "t2", "narration-B")
    assert a == b
    assert len({a, b}) == 1
    assert a != rw.Conflict("p.py", "add/add", "t1", "narration-A")
    assert a != rw.Conflict("q.py", "lines", "t1", "narration-A")


def test_lone_binary_modifier_of_base_binary_folds_clean():
    base = make_base({"img.bin": b"\x00\x01"})
    t1 = rw.task_state_from_contents(base, "t1", {"img.bin": b"\x00\x09"})
    frontier, conflicts = rw.fold(base, base, t1)
    assert conflicts == []
    assert rw.manifest(frontier) == {"img.bin": b"\x00\x09"}


def test_binary_conflict_tiebreak_is_order_independent():
    base = make_base({"img.bin": b"\x00\x01"})
    t1 = rw.task_state_from_contents(base, "t1", {"img.bin": b"\x00\x03"})
    t2 = rw.task_state_from_contents(base, "t2", {"img.bin": b"\x00\x02"})
    tasks = [t1, t2]
    results = [fold_in_order(base, tasks, list(o)) for o in permutations(range(2))]
    manifests = [rw.manifest(f) for f, _ in results]
    assert manifests[0] == manifests[1] == {"img.bin": b"\x00\x02"}
    assert all(conflict_keys(cs) == [("img.bin", "binary")] for _, cs in results)


def test_same_line_edits_are_kind_lines_with_relabelled_narration():
    base = make_base({"c.py": "a\nb\nc\n"})
    tx = rw.task_state_from_contents(base, "tx", {"c.py": "a\nX\nc\n"})
    ty = rw.task_state_from_contents(base, "ty", {"c.py": "a\nY\nc\n"})
    _, conflicts = fold_in_order(base, [tx, ty], [0, 1])
    assert conflict_keys(conflicts) == [("c.py", "lines")]
    narration = conflicts[0].narration
    assert "<<<<<<< begin added frontier" in narration
    assert "======= begin added ty" in narration
    assert ">>>>>>> end conflict" in narration
    assert "left" not in narration and "right" not in narration


def test_manifest_presence_rules():
    # An empty, never-deleted file is present and empty.
    assert rw.manifest(make_base({"e.txt": ""})) == {"e.txt": ""}
    # A cleanly deleted file is absent.
    t_del = rw.task_state_from_contents(BASE, "t-del", {"calc.py": None})
    deleted_frontier, conflicts = rw.fold(BASE, BASE, t_del)
    assert conflicts == []
    assert sorted(rw.manifest(deleted_frontier)) == ["other.py"]
    # A delete/modify survivor is present with the merged lines.
    t_mod = rw.task_state_from_contents(BASE, "t-mod",
                                        {"calc.py": "def calculate(x):\n    logged = 1\n"
                                                    "    a = x * 2\n    b = a + 1\n    return b\n"})
    survivor, cs2 = rw.fold(BASE, deleted_frontier, t_mod)
    assert conflict_keys(cs2) == [("calc.py", "delete/modify")]
    assert rw.manifest(survivor)["calc.py"] == "    logged = 1\n"


def test_text_normalization_and_binary_detection():
    assert rw.split_lines("") == []
    assert rw.split_lines("\n") == [""]
    assert rw.split_lines("a") == ["a"]
    assert rw.split_lines("a\n") == ["a"]
    assert rw.split_lines("a\n\n") == ["a", ""]
    assert rw.join_lines([]) == ""
    assert rw.join_lines([""]) == "\n"
    assert rw.join_lines(["a", "b"]) == "a\nb\n"
    assert rw.is_binary(b"") is False
    assert rw.is_binary("héllo".encode("utf-8")) is False
    assert rw.is_binary(b"a\x00b") is True
    assert rw.is_binary(b"\xff\xfe") is True


def test_snapshot_classifies_binary_and_publish_records_delete(tmp_path):
    import subprocess
    repo = tmp_path / "r"
    repo.mkdir()

    def git(*args):
        subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)

    git("init", "-q", "-b", "main")
    git("config", "user.email", "t@t")
    git("config", "user.name", "t")
    (repo / "img.bin").write_bytes(b"\x00\x01\x02")
    (repo / "keep.txt").write_text("k\n")
    (repo / "gone.txt").write_text("g\n")
    git("add", ".")
    git("commit", "-qm", "base")
    base_sha = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"],
                              capture_output=True, text=True, check=True).stdout.strip()
    (repo / "gone.txt").unlink()
    (repo / "img.bin").write_bytes(b"\x00\x09")
    git("add", "-A")
    git("commit", "-qm", "task")

    base = rw.snapshot(repo, base_sha)
    assert sorted(base.files) == ["gone.txt", "keep.txt"]
    assert base.raw == {"img.bin": b"\x00\x01\x02"}
    assert base.deleted_marks == frozenset()

    task = rw.publish(base, repo, base_sha, "HEAD", "t1")
    assert task.deleted == frozenset({"gone.txt"})
    assert task.raw == {"img.bin": b"\x00\x09"}

    frontier, conflicts = rw.fold(base, base, task)
    assert conflicts == []
    assert rw.manifest(frontier) == {"keep.txt": "k\n", "img.bin": b"\x00\x09"}


# --- binary folding is a commutative candidate-set union (K1) --------------


def test_three_tasks_one_binary_two_identical_bytes_one_divergent():
    base = make_base({"img.bin": b"\x00\x01"})
    tasks = [rw.task_state_from_contents(base, "t1", {"img.bin": b"\x00\x05"}),
             rw.task_state_from_contents(base, "t2", {"img.bin": b"\x00\x05"}),
             rw.task_state_from_contents(base, "t3", {"img.bin": b"\x00\x07"})]
    # Two distinct candidates -> exactly one conflict, in all six orders.
    assert_order_independent(base, tasks,
                             expected_manifest={"img.bin": b"\x00\x05"},
                             expected_conflicts=[("img.bin", "binary")])


def test_binary_conflict_count_is_distinct_candidates_minus_one():
    base = make_base({"img.bin": b"\x00\x01"})
    tasks = [rw.task_state_from_contents(base, "t%d" % i, {"img.bin": b})
             for i, b in enumerate((b"\x00\x09", b"\x00\x08", b"\x00\x07"))]
    assert_order_independent(base, tasks,
                             expected_manifest={"img.bin": b"\x00\x07"},
                             expected_conflicts=[("img.bin", "binary")] * 2)


def test_base_binary_bytes_persist_until_a_task_writes_the_path():
    base = make_base({"img.bin": b"\x00\x01", "other.py": "V = 1\n"})
    t = rw.task_state_from_contents(base, "t1", {"other.py": "V = 2\n"})
    frontier, conflicts = rw.fold(base, base, t)
    assert conflicts == []
    assert rw.manifest(frontier) == {"img.bin": b"\x00\x01", "other.py": "V = 2\n"}


def test_text_add_vs_binary_add_same_path_text_wins():
    t_text = rw.task_state_from_contents(BASE, "t-text", {"new.dat": "hello\n"})
    t_bin = rw.task_state_from_contents(BASE, "t-bin", {"new.dat": b"\x00\xff"})
    manifest, _ = assert_order_independent(
        BASE, [t_text, t_bin], expected_conflicts=[("new.dat", "binary")])
    assert manifest["new.dat"] == "hello\n"      # text side wins the manifest
    assert "calc.py" in manifest                # untouched files still present


def test_text_and_binary_on_a_base_binary_path_pair_once():
    base = make_base({"img.bin": b"\x00\x01"})
    t_text = rw.task_state_from_contents(base, "t-text", {"img.bin": "now text\n"})
    t_bin = rw.task_state_from_contents(base, "t-bin", {"img.bin": b"\x00\x02"})
    manifest, _ = assert_order_independent(
        base, [t_text, t_bin], expected_conflicts=[("img.bin", "binary")])
    assert manifest["img.bin"] == "now text\n"


def test_two_text_writers_and_one_binary_writer_pair_once():
    t_a = rw.task_state_from_contents(BASE, "ta", {"mix.dat": "a\n"})
    t_b = rw.task_state_from_contents(BASE, "tb", {"mix.dat": "b\n"})
    t_bin = rw.task_state_from_contents(BASE, "tbin", {"mix.dat": b"\x00\x01"})
    # One text/binary pairing + one text add/add, whatever the order.
    assert_order_independent(BASE, [t_a, t_b, t_bin],
                             expected_conflicts=[("mix.dat", "add/add"),
                                                 ("mix.dat", "binary")])


def test_binary_delete_vs_binary_rewrite_bytes_win():
    base = make_base({"img.bin": b"\x00\x01"})
    t_del = rw.task_state_from_contents(base, "t-del", {"img.bin": None})
    t_mod = rw.task_state_from_contents(base, "t-mod", {"img.bin": b"\x00\x02"})
    assert_order_independent(base, [t_del, t_mod],
                             expected_manifest={"img.bin": b"\x00\x02"},
                             expected_conflicts=[("img.bin", "delete/modify")])


def test_binary_delete_plus_two_divergent_rewrites():
    base = make_base({"img.bin": b"\x00\x01"})
    tasks = [rw.task_state_from_contents(base, "t-del", {"img.bin": None}),
             rw.task_state_from_contents(base, "t1", {"img.bin": b"\x00\x04"}),
             rw.task_state_from_contents(base, "t2", {"img.bin": b"\x00\x03"})]
    assert_order_independent(base, tasks,
                             expected_manifest={"img.bin": b"\x00\x03"},
                             expected_conflicts=[("img.bin", "binary"),
                                                 ("img.bin", "delete/modify")])


def test_lone_binary_delete_leaves_the_path_absent():
    base = make_base({"img.bin": b"\x00\x01", "keep.py": "k\n"})
    t_del = rw.task_state_from_contents(base, "t-del", {"img.bin": None})
    frontier, conflicts = rw.fold(base, base, t_del)
    assert conflicts == []
    assert rw.manifest(frontier) == {"keep.py": "k\n"}
    assert base.raw == {"img.bin": b"\x00\x01"}   # inputs untouched


def test_fold_does_not_mutate_its_inputs():
    base_files = dict(BASE.files)
    base_raw = dict(BASE.raw)
    t1 = rw.task_state_from_contents(BASE, "t1", {"calc.py": None, "new.bin": b"\x00\x07"})
    frontier, _ = rw.fold(BASE, BASE, t1)
    assert BASE.files == base_files
    assert BASE.raw == base_raw
    assert BASE.deleted_marks == frozenset()
    assert BASE.raw_touched == frozenset()
    assert frontier.deleted_marks == frozenset({"calc.py"})
    assert frontier.raw_touched == frozenset({"new.bin"})


def test_fold_does_not_mutate_frontier_binary_candidates():
    base = make_base({"img.bin": b"\x00\x01"})
    t1 = rw.task_state_from_contents(base, "t1", {"img.bin": b"\x00\x02"})
    t2 = rw.task_state_from_contents(base, "t2", {"img.bin": b"\x00\x03"})
    f1, _ = rw.fold(base, base, t1)
    before = {p: set(c) for p, c in f1.raw_candidates.items()}
    f2, _ = rw.fold(base, f1, t2)
    assert {p: set(c) for p, c in f1.raw_candidates.items()} == before
    assert base.raw_candidates == {}
    assert f1.raw_candidates["img.bin"] < f2.raw_candidates["img.bin"]


def test_binary_fold_is_idempotent():
    base = make_base({"img.bin": b"\x00\x01"})
    t1 = rw.task_state_from_contents(base, "t1", {"img.bin": b"\x00\x02"})
    f1, c1 = rw.fold(base, base, t1)
    f2, c2 = rw.fold(base, f1, t1)
    assert c1 == [] and c2 == []
    assert rw.manifest(f1) == rw.manifest(f2) == {"img.bin": b"\x00\x02"}


def test_randomized_binary_mixes_are_order_independent():
    """Seeded sweep over delete/bytes/text mixes on base-text, base-binary and
    new paths. Every case is folded in every order; manifest and conflict
    multiset must agree. At most one text writer per path, so the sweep stays
    inside the binary/presence rules it is guarding (concurrent text writers on
    a deleted path are covered by the hand-written cases above).
    """
    rng = random.Random(42)
    base = make_base({"a.txt": "l1\nl2\nl3\n", "b.bin": b"\x00\x01"})
    seen_kinds = set()
    for _ in range(200):
        text_writer, per_task = {}, []
        for i in range(rng.randint(2, 3)):
            contents = {}
            for p in ("a.txt", "b.bin", "c.new"):
                r = rng.random()
                if r < 0.25:
                    continue
                if r < 0.5:
                    contents[p] = None
                elif r < 0.75:
                    contents[p] = bytes([0, rng.randint(1, 4)])
                elif p not in text_writer:
                    text_writer[p] = i
                    contents[p] = "l1\nX%d\nl3\n" % rng.randint(1, 3)
            per_task.append(contents)
        tasks = [rw.task_state_from_contents(base, "t%d" % i, c)
                 for i, c in enumerate(per_task)]
        _, keys = assert_order_independent(base, tasks)
        seen_kinds.update(k for _, k in keys)
    # The sweep must actually exercise the rules, not just fold clean.
    assert {"binary", "delete/modify"} <= seen_kinds


def test_materialize_round_trips_non_ascii_and_binary(tmp_path):
    base = make_base({"note.txt": "héllo wörld — ok\n"})
    t1 = rw.task_state_from_contents(
        base, "t1", {"note.txt": "héllo wörld — édité\n", "blob.bin": b"\x00\xfe\xff"})
    frontier, conflicts = rw.fold(base, base, t1)
    assert conflicts == []
    out = tmp_path / "out"
    rw.materialize(frontier, out)
    assert (out / "note.txt").read_text(encoding="utf-8") == "héllo wörld — édité\n"
    assert (out / "blob.bin").read_bytes() == b"\x00\xfe\xff"

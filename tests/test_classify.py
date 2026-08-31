"""The verdict core: Arm G, the five-class comparator, and the ride-alongs.

Everything here is over `evals/frontier/classify.py` and
`evals/frontier/arm_git.py` (spec
`docs/superpowers/specs/2026-08-31-fold-corpus-validation.md`, Deliverable C).
The comparator is a pure function of two `ArmResult`s, so the class table is
pinned against hand-built arms — no fold, no git, no ambiguity about which arm
said what. The rest runs against `make_fixture_corpus`'s four seeded waves,
which carry one known instance of each thing the ride-alongs look for.

Offline and deterministic: the only subprocess is git, over a scratch clone of
the fixture repo built under the test's own `tmp_path`.
"""
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "evals" / "frontier"))
import arm_git  # noqa: E402
import classify  # noqa: E402
import corpuslib  # noqa: E402


@pytest.fixture(scope="module")
def fixture_corpus(tmp_path_factory):
    """One build of the fixture corpus, shared read-only by the wave tests."""
    dest = tmp_path_factory.mktemp("classify-corpus")
    repo, corpus = corpuslib.make_fixture_corpus(dest)
    entries = corpuslib.load_corpus_index(corpus)
    return repo, corpus, {e.wave: e for e in entries}


def _patch_texts(entry):
    return [text for _, text in classify.task_patches(entry)]


# --------------------------------------------------------------------------
# The five classes — the table the spec's GO/NO verdict is read off
# --------------------------------------------------------------------------

def test_five_classes_from_handbuilt_arms():
    W = lambda s, c=None: corpuslib.PathAnswer(s, c)
    weave = corpuslib.ArmResult({"one": W("clean", b"x\ny\n"), "two": W("clean", b"y\nx\n"),
                                 "thr": W("clean", b"a\n"), "fou": W("contended"), "fiv": W("contended"),
                                 "bin": W("binary")}, True)
    git = corpuslib.ArmResult({"one": W("clean", b"x\ny\n"), "two": W("clean", b"x\ny\n"),
                               "thr": W("contended"), "fou": W("clean", b"b\n"), "fiv": W("contended"),
                               "bin": W("binary")}, True)
    got = {v["path"]: v["cls"] for v in classify.classify(weave, git)}
    assert got == {"one": 1, "two": 2, "thr": 3, "fou": 4, "fiv": 5, "bin": "binary"}
    two = [v for v in classify.classify(weave, git) if v["path"] == "two"][0]
    assert two["mechanically_explained"] is True     # same line multiset, reordered


def test_class2_unexplained_when_content_differs():
    W = lambda s, c=None: corpuslib.PathAnswer(s, c)
    weave = corpuslib.ArmResult({"p": W("clean", b"x\n")}, True)
    git = corpuslib.ArmResult({"p": W("clean", b"z\n")}, True)
    assert classify.classify(weave, git)[0]["mechanically_explained"] is False


def test_kept_vs_deleted_is_unexplained_class2():
    """The delete-vs-keep divergence — a clean answer whose content is None.

    `arm_git._read_tree` reports `PathAnswer("clean", None)` for a path the wave
    touched and the merge result does not carry, so this pair reaches the
    comparator whenever one arm keeps a file the other deletes. It is the
    highest-signal class-2 row there is; it must land in the table rather than
    raise out of it.
    """
    W = lambda s, c=None: corpuslib.PathAnswer(s, c)
    weave = corpuslib.ArmResult({"p": W("clean", b"line\n")}, True)
    git = corpuslib.ArmResult({"p": W("clean", None)}, True)
    assert classify.classify(weave, git) == [
        {"path": "p", "cls": 2, "mechanically_explained": False, "xaxbx": False},
    ]
    # and symmetrically, with the arms the other way round
    assert classify.classify(git, weave) == [
        {"path": "p", "cls": 2, "mechanically_explained": False, "xaxbx": False},
    ]


def test_deleted_on_both_arms_is_class_one():
    W = lambda s, c=None: corpuslib.PathAnswer(s, c)
    both = lambda: corpuslib.ArmResult({"p": W("clean", None)}, True)
    v = classify.classify(both(), both())[0]
    assert v["cls"] == 1 and v["mechanically_explained"] is None


def test_deleted_is_not_explained_by_an_empty_file():
    """Absence is not a reordering of emptiness — never `mechanically_explained`."""
    W = lambda s, c=None: corpuslib.PathAnswer(s, c)
    weave = corpuslib.ArmResult({"p": W("clean", None)}, True)
    git = corpuslib.ArmResult({"p": W("clean", b"")}, True)
    v = classify.classify(weave, git)[0]
    assert v["cls"] == 2 and v["mechanically_explained"] is False


def test_path_in_one_arm_only_is_unexplained_class2():
    weave = corpuslib.ArmResult({"p": corpuslib.PathAnswer("clean", b"x\n")}, True)
    git = corpuslib.ArmResult({}, True)
    v = classify.classify(weave, git)[0]
    assert v["cls"] == 2 and v["mechanically_explained"] is False


def test_row_shape_is_the_four_declared_keys_sorted_by_path():
    W = lambda s, c=None: corpuslib.PathAnswer(s, c)
    weave = corpuslib.ArmResult({"z": W("clean", b"q\n"), "a": W("binary")}, True)
    git = corpuslib.ArmResult({"z": W("clean", b"q\n"), "a": W("binary")}, True)
    assert classify.classify(weave, git) == [
        {"path": "a", "cls": "binary", "mechanically_explained": None, "xaxbx": False},
        {"path": "z", "cls": 1, "mechanically_explained": None, "xaxbx": False},
    ]


# --------------------------------------------------------------------------
# Arm G over the fixture waves
# --------------------------------------------------------------------------

W1_A = corpuslib.A_TXT.replace("a four\n", "a four (task 1a)\n").encode()
W1_B = corpuslib.B_TXT.replace("b two\n", "b two (task 1b)\n").encode()
# Wave 2's weave answer is the kernel's own auto-union, as its `resolve` event
# recorded it: both appends kept, left before right.
W2_UNION = b"c one\nc two\nc anchor\nc left addition\nc right addition\nc three\nc four\n"


def test_git_answer_disjoint_wave_is_class_one_everywhere(fixture_corpus, tmp_path):
    repo, _, entries = fixture_corpus
    weave = corpuslib.ArmResult({"a.txt": corpuslib.PathAnswer("clean", W1_A),
                                 "b.txt": corpuslib.PathAnswer("clean", W1_B)}, True)
    git = arm_git.git_answer(repo, entries[1], weave, work=tmp_path)
    assert git.complete is True
    assert {p: a.status for p, a in git.per_path.items()} == {"a.txt": "clean", "b.txt": "clean"}
    assert git.per_path["a.txt"].content == W1_A
    assert git.per_path["b.txt"].content == W1_B
    assert [(v["path"], v["cls"]) for v in classify.classify(weave, git)] == [("a.txt", 1), ("b.txt", 1)]


def test_git_answer_same_anchor_wave_conflicts_where_the_weave_unioned(fixture_corpus, tmp_path):
    repo, _, entries = fixture_corpus
    weave = corpuslib.ArmResult({"c.txt": corpuslib.PathAnswer("clean", W2_UNION)}, True)
    git = arm_git.git_answer(repo, entries[2], weave, work=tmp_path)
    assert git.complete is True
    assert git.per_path["c.txt"].status == "contended"
    assert [(v["path"], v["cls"]) for v in classify.classify(weave, git)] == [("c.txt", 3)]
    # the conflict was completed with the weave's own content, so the arm still
    # finishes the wave rather than stopping at the first conflict
    assert git.per_path["c.txt"].content == W2_UNION


def test_git_answer_binary_path_is_reported_binary(fixture_corpus, tmp_path):
    repo, _, entries = fixture_corpus
    weave = corpuslib.ArmResult({}, True)
    git = arm_git.git_answer(repo, entries[4], weave, work=tmp_path)
    assert git.complete is True
    assert git.per_path["bin.dat"].status == "binary"
    assert git.per_path["b.txt"].status == "clean"


def test_git_answer_class_five_wave_is_contended_on_both_arms(fixture_corpus, tmp_path):
    repo, _, entries = fixture_corpus
    weave = corpuslib.ArmResult({"d.txt": corpuslib.PathAnswer("contended")}, True)
    git = arm_git.git_answer(repo, entries[3], weave, work=tmp_path)
    assert git.per_path["d.txt"].status == "contended"
    assert [(v["path"], v["cls"]) for v in classify.classify(weave, git)] == [("d.txt", 5)]


# --------------------------------------------------------------------------
# The ride-along predicates
# --------------------------------------------------------------------------

def test_xaxbx_true_on_the_class_five_seed(fixture_corpus):
    _, _, entries = fixture_corpus
    assert classify.xaxbx_flag(corpuslib.D_TXT, _patch_texts(entries[3]), "d.txt") is True


def test_xaxbx_false_on_the_disjoint_wave(fixture_corpus):
    _, _, entries = fixture_corpus
    texts = _patch_texts(entries[1])
    assert classify.xaxbx_flag(corpuslib.A_TXT, texts, "a.txt") is False
    assert classify.xaxbx_flag(corpuslib.B_TXT, texts, "b.txt") is False


def test_deletion_adjacency_names_the_pair_and_the_file(fixture_corpus):
    _, _, entries = fixture_corpus
    assert classify.deletion_adjacency(entries[4]) == [
        {"path": "b.txt", "task_del": "4a", "task_near": "4b", "deleted_line": 5},
    ]


def test_deletion_adjacency_empty_on_the_disjoint_wave(fixture_corpus):
    _, _, entries = fixture_corpus
    assert classify.deletion_adjacency(entries[1]) == []


def test_deletion_adjacency_reports_the_lowest_line_in_the_window(fixture_corpus):
    _, _, entries = fixture_corpus
    # 4a deletes base lines 5 and 6; 4b's hunk spans base lines 6..10. At k=0
    # only line 6 is inside the span, so widening the window is what pulls the
    # reported line down to 5.
    assert classify.deletion_adjacency(entries[4], k=0) == [
        {"path": "b.txt", "task_del": "4a", "task_near": "4b", "deleted_line": 6},
    ]
    assert classify.deletion_adjacency(entries[4], k=1) == [
        {"path": "b.txt", "task_del": "4a", "task_near": "4b", "deleted_line": 5},
    ]


def _hand_wave(tmp_path, patches):
    """A one-wave corpus entry written by hand — patch text, nothing folded."""
    wave = tmp_path / "hand" / "wave-1"
    wave.mkdir(parents=True)
    log = ['{"type": "base", "sha": "%s"}' % ("0" * 40)]
    for task_id, text in patches:
        (wave / ("task-%s.patch" % task_id)).write_text(text)
        log.append('{"type": "fold", "task": "%s", "headSha": "%s", "patch": "task-%s.patch"}'
                   % (task_id, "1" * 40, task_id))
    (wave / "fold_log.jsonl").write_text("".join(line + "\n" for line in log))
    return corpuslib.CorpusEntry("hand", 1, "0" * 40, "patch", wave,
                                 tasks=[t for t, _ in patches])


def test_deletion_adjacency_window_excludes_a_distant_deletion(tmp_path):
    # `x` deletes base line 2; `y`'s hunk spans base lines 20..22. Nothing is
    # adjacent at k=3, and the row only appears once k reaches the gap.
    far = _hand_wave(tmp_path, [
        ("x", "--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,2 @@\n a\n-b\n c\n"),
        ("y", "--- a/f.txt\n+++ b/f.txt\n@@ -20,3 +20,4 @@\n t\n+new\n u\n v\n"),
    ])
    assert classify.deletion_adjacency(far) == []
    assert classify.deletion_adjacency(far, k=18) == [
        {"path": "f.txt", "task_del": "x", "task_near": "y", "deleted_line": 2},
    ]

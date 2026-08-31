"""Arm W: the weave's answer read off the record, and the two re-checks.

Every assertion is over `evals/frontier/arm_weave.py` against the fixture
corpus `corpuslib.make_fixture_corpus` builds with the REAL kernel CLI (spec
`docs/superpowers/specs/2026-08-31-fold-corpus-validation.md`), so what is
pinned here is the replayer's reading of the kernel's own output — never an
imitation of it.

The four fixture waves are one known instance each of the shapes the arm has
to answer for: a clean disjoint fold, an auto-unioned fold whose answer exists
ONLY in the recorded resolve event, an unresolved contended fold, and a fold
carrying a binary path.
"""
import json
import shutil
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "evals" / "frontier"))
import arm_weave  # noqa: E402
import corpuslib  # noqa: E402


@pytest.fixture(scope="module")
def fixture_corpus(tmp_path_factory):
    """One build of the fixture corpus, shared read-only by the tests below.

    Under a pytest tmp dir, like every other byte this suite writes; the tests
    that need to damage a corpus copy their own.
    """
    dest = tmp_path_factory.mktemp("arm-weave-corpus")
    repo, corpus = corpuslib.make_fixture_corpus(dest)
    entries = corpuslib.load_corpus_index(corpus)
    return repo, corpus, {e.wave: e for e in entries}


def _copy_corpus(fixture_corpus, tmp_path):
    """A private copy of the corpus, with its index loaded against the copy."""
    _repo, corpus, _entries = fixture_corpus
    dest = tmp_path / "corpus"
    shutil.copytree(corpus, dest)
    return dest, {e.wave: e for e in corpuslib.load_corpus_index(dest)}


# --------------------------------------------------------------------------
# weave_answer
# --------------------------------------------------------------------------

def test_disjoint_wave_answers_clean(fixture_corpus):
    repo, _corpus, entries = fixture_corpus
    disjoint_entry = entries[1]

    w = arm_weave.weave_answer(repo, disjoint_entry)
    assert w.complete and w.per_path["a.txt"].status == "clean"
    assert arm_weave.integrity_check(repo, disjoint_entry) == []
    assert arm_weave.determinism_check(repo, disjoint_entry)["matches"] is True

    # Both files, and each one's content is exactly its own patch over base.
    assert sorted(w.per_path) == ["a.txt", "b.txt"]
    assert w.per_path["b.txt"].status == "clean"
    assert w.per_path["a.txt"].content == corpuslib.SCENARIOS[1]["1a"]["a.txt"].encode()
    assert w.per_path["b.txt"].content == corpuslib.SCENARIOS[1]["1b"]["b.txt"].encode()


def test_auto_unioned_wave_is_answered_from_the_recorded_resolve(fixture_corpus):
    """The recorded log — resolve events included — IS the answer."""
    repo, _corpus, entries = fixture_corpus
    w = arm_weave.weave_answer(repo, entries[2])

    assert w.complete is True
    assert sorted(w.per_path) == ["c.txt"]
    assert w.per_path["c.txt"].status == "clean"
    assert w.per_path["c.txt"].content == (
        b"c one\nc two\nc anchor\nc left addition\nc right addition\n"
        b"c three\nc four\n")


def test_contending_wave_answers_contended(fixture_corpus):
    """A narrated conflict with no resolution at-or-after its epoch."""
    repo, _corpus, entries = fixture_corpus
    w = arm_weave.weave_answer(repo, entries[3])

    assert sorted(w.per_path) == ["d.txt"]
    assert w.per_path["d.txt"].status == "contended"
    assert w.per_path["d.txt"].content is None
    assert w.complete is False


def test_deleted_path_is_answered_clean_none(fixture_corpus):
    """A whole-file deletion is absent from the weave manifest by design;
    the arm must still answer it — as `("clean", None)`, Arm G's shape for
    the same event — or an agreed deletion reads as an unexplained class 2
    (run-34 critic, blocking)."""
    repo, _corpus, entries = fixture_corpus
    w = arm_weave.weave_answer(repo, entries[5])

    assert w.complete is True
    assert sorted(w.per_path) == ["a.txt", "b.txt"]
    assert w.per_path["a.txt"].status == "clean"
    assert w.per_path["a.txt"].content is None
    assert w.per_path["b.txt"].content == corpuslib.SCENARIOS[5]["5b"]["b.txt"].encode()


def test_binary_path_is_answered_binary(fixture_corpus):
    repo, _corpus, entries = fixture_corpus
    w = arm_weave.weave_answer(repo, entries[4])

    assert w.complete is True
    assert {p: a.status for p, a in w.per_path.items()} == {
        "b.txt": "clean", "bin.dat": "binary"}
    assert w.per_path["bin.dat"].content is None
    # The deletion-adjacency fold: 4a's removal and 4b's insertion both land.
    assert w.per_path["b.txt"].content == (
        corpuslib.B_TXT.replace("b five\nb six\n", "")
        .replace("b eight\n", "b eight\nb eight and a half\n").encode())


# --------------------------------------------------------------------------
# integrity_check
# --------------------------------------------------------------------------

def test_integrity_check_clean_on_every_entry(fixture_corpus):
    repo, _corpus, entries = fixture_corpus
    assert {w: arm_weave.integrity_check(repo, e) for w, e in entries.items()} == {
        1: [], 2: [], 3: [], 4: [], 5: []}


def test_integrity_check_flags_a_mutated_patch(fixture_corpus, tmp_path):
    """One mutated byte in a patch copy is one named failure — the patch still
    applies, so only the recorded tree sha can catch it."""
    repo, _corpus, _entries = fixture_corpus
    corpus, entries = _copy_corpus(fixture_corpus, tmp_path)
    patch = entries[1].wave_dir / "task-1a.patch"
    body = patch.read_bytes()
    assert b"a four (task 1a)" in body
    patch.write_bytes(body.replace(b"a four (task 1a)", b"a four (task 1A)"))

    failures = arm_weave.integrity_check(repo, entries[1])
    assert len(failures) == 1, failures
    assert "1a" in failures[0]
    # Every other wave in the same copy is untouched.
    assert arm_weave.integrity_check(repo, entries[2]) == []


def test_integrity_check_reports_an_unappliable_patch(fixture_corpus, tmp_path):
    """A corrupt patch is a reported failure, not a raised PatchError."""
    repo, _corpus, _entries = fixture_corpus
    _corpus_copy, entries = _copy_corpus(fixture_corpus, tmp_path)
    (entries[1].wave_dir / "task-1b.patch").write_bytes(b"not a patch at all\n")

    failures = arm_weave.integrity_check(repo, entries[1])
    assert len(failures) == 1, failures
    assert "1b" in failures[0]


# --------------------------------------------------------------------------
# determinism_check
# --------------------------------------------------------------------------

def test_determinism_check_matches_every_entry(fixture_corpus):
    repo, _corpus, entries = fixture_corpus
    assert {w: arm_weave.determinism_check(repo, e) for w, e in entries.items()} == {
        1: {"matches": True, "divergence": None},
        2: {"matches": True, "divergence": None},
        3: {"matches": True, "divergence": None},
        4: {"matches": True, "divergence": None},
        5: {"matches": True, "divergence": None}}


def test_determinism_check_reports_a_conflict_set_mismatch(fixture_corpus, tmp_path):
    """A record claiming no conflict where a fresh fold opens one is reported."""
    repo, _corpus, _entries = fixture_corpus
    _corpus_copy, entries = _copy_corpus(fixture_corpus, tmp_path)
    (entries[3].wave_dir / "conflicts.json").write_text("[]\n")

    result = arm_weave.determinism_check(repo, entries[3])
    assert result["matches"] is False
    assert "d.txt" in result["divergence"]


def test_determinism_check_never_raises(fixture_corpus, tmp_path):
    """A wave directory that is not there is reported, not raised."""
    repo, _corpus, entries = fixture_corpus
    missing = corpuslib.CorpusEntry(
        run_id="gone", wave=9, base_sha=entries[1].base_sha, mode="patch",
        wave_dir=tmp_path / "nowhere" / "wave-9", tasks=["9a"])

    result = arm_weave.determinism_check(repo, missing)
    assert result["matches"] is False
    assert isinstance(result["divergence"], str) and result["divergence"]


def test_determinism_check_reports_a_manifest_mismatch(fixture_corpus, tmp_path):
    """Both folds complete and agree on the conflicts, and still disagree on
    the content: the manifest leg is what catches an edited resolution."""
    repo, _corpus, _entries = fixture_corpus
    _corpus_copy, entries = _copy_corpus(fixture_corpus, tmp_path)
    log = entries[2].wave_dir / "fold_log.jsonl"
    events = [json.loads(line) for line in log.read_text().splitlines()]
    for event in events:
        if event["type"] == "resolve":
            event["lines"] = [line.replace("c left addition", "c tampered")
                              for line in event["lines"]]
    log.write_text("".join(json.dumps(e) + "\n" for e in events))

    result = arm_weave.determinism_check(repo, entries[2])
    assert result == {"matches": False, "divergence": "manifest diverges at c.txt"}

"""The corpus contract: layout, index I/O, and the fixture corpus builder.

Every assertion here is over `evals/frontier/corpuslib.py` — the shared data
model Tasks 2-5 of the fold-corpus replayer build against (spec
`docs/superpowers/specs/2026-08-31-fold-corpus-validation.md`, Deliverable A).
The fixture builder drives the REAL kernel CLI, so the fold logs it produces
are the kernel's own output, not a hand-written imitation; the tests below pin
both the corpus layout and the four scenario seeds later tasks assert on.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "evals" / "frontier"))
import corpuslib  # noqa: E402


def _git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True,
                          capture_output=True, text=True).stdout


@pytest.fixture(scope="module")
def fixture_corpus(tmp_path_factory):
    """One build of the fixture corpus, shared read-only by the shape tests.

    Scoped to a pytest tmp dir (never a checked-in fixture directory) so the
    suite still owns every byte it writes.
    """
    dest = tmp_path_factory.mktemp("fold-corpus")
    repo, corpus = corpuslib.make_fixture_corpus(dest)
    entries = corpuslib.load_corpus_index(corpus)
    return repo, corpus, {e.wave: e for e in entries}


# --------------------------------------------------------------------------
# Index I/O — the three assertions the plan fixes verbatim
# --------------------------------------------------------------------------

def test_index_roundtrip(tmp_path):
    entries = [corpuslib.CorpusEntry("run-9", 1, "a" * 40, "patch", tmp_path / "run-9" / "wave-1")]
    corpuslib.write_corpus_index(tmp_path, entries)
    loaded = corpuslib.load_corpus_index(tmp_path)
    assert [(e.run_id, e.wave, e.base_sha, e.mode) for e in loaded] == [("run-9", 1, "a" * 40, "patch")]


def test_load_refuses_missing_index(tmp_path):
    with pytest.raises(FileNotFoundError, match="corpus-index.json"):
        corpuslib.load_corpus_index(tmp_path)


def test_fixture_corpus_shape(tmp_path):
    repo, corpus = corpuslib.make_fixture_corpus(tmp_path)
    entries = corpuslib.load_corpus_index(corpus)
    assert len(entries) == 4 and all(e.mode == "patch" for e in entries)
    for e in entries:
        log = (e.wave_dir / "fold_log.jsonl").read_text().splitlines()
        first = json.loads(log[0])
        assert first == {"type": "base", "sha": e.base_sha}
        # every fold event's patch path is corpus-relative and exists
        for line in log[1:]:
            ev = json.loads(line)
            if ev.get("type") == "fold" and "patch" in ev:
                assert not ev["patch"].startswith("/")
                assert (e.wave_dir / ev["patch"]).is_file()


# --------------------------------------------------------------------------
# Index file shape — the spec's `[{runId, wave, baseSha, mode, tasks, skipped}]`
# --------------------------------------------------------------------------

def test_index_file_is_the_specified_json(tmp_path):
    entries = [corpuslib.CorpusEntry("run-9", 2, "b" * 40, "branch",
                                     tmp_path / "run-9" / "wave-2",
                                     tasks=["t1", "t2"], skipped="unresolvable base")]
    corpuslib.write_corpus_index(tmp_path, entries)
    assert json.loads((tmp_path / "corpus-index.json").read_text()) == [
        {"runId": "run-9", "wave": 2, "baseSha": "b" * 40, "mode": "branch",
         "tasks": ["t1", "t2"], "skipped": "unresolvable base", "commutes": {}}
    ]


def test_load_derives_wave_dir_from_the_root(tmp_path):
    corpuslib.write_corpus_index(
        tmp_path, [corpuslib.CorpusEntry("run-9", 3, "c" * 40, "patch", Path("ignored"))])
    (entry,) = corpuslib.load_corpus_index(tmp_path)
    assert entry.wave_dir == tmp_path / "run-9" / "wave-3"


def test_answer_shapes_are_plain_dataclasses():
    answer = corpuslib.PathAnswer("clean", b"x\n")
    assert (answer.status, answer.content) == ("clean", b"x\n")
    assert corpuslib.PathAnswer("contended").content is None
    result = corpuslib.ArmResult({"a.txt": answer}, True)
    assert result.per_path["a.txt"] is answer and result.complete is True


# --------------------------------------------------------------------------
# The fixture corpus — layout, and the four scenario seeds
# --------------------------------------------------------------------------

def test_fixture_layout_and_index(fixture_corpus):
    repo, corpus, by_wave = fixture_corpus
    assert sorted(by_wave) == [1, 2, 3, 4]
    base_sha = by_wave[1].base_sha
    for wave, entry in sorted(by_wave.items()):
        assert entry.run_id == corpuslib.FIXTURE_RUN_ID
        assert entry.base_sha == base_sha and entry.skipped is None
        assert entry.wave_dir == corpus / corpuslib.FIXTURE_RUN_ID / ("wave-%d" % wave)
        assert entry.tasks == ["%d%s" % (wave, s) for s in ("a", "b")]
        for task_id in entry.tasks:
            assert (entry.wave_dir / ("task-%s.patch" % task_id)).is_file()


def test_fixture_base_commit_contents(fixture_corpus):
    repo, corpus, by_wave = fixture_corpus
    names = _git(repo, "ls-tree", "-r", "--name-only", by_wave[1].base_sha).split()
    assert names == ["a.txt", "b.txt", "bin.dat", "c.txt", "d.txt"]
    blob = subprocess.run(["git", "-C", str(repo), "show",
                           "%s:bin.dat" % by_wave[1].base_sha],
                          check=True, capture_output=True).stdout
    assert b"\x00" in blob and len(blob) < 256      # small, and binary to the kernel


def test_wave1_disjoint_files_fold_clean(fixture_corpus):
    _repo, _corpus, by_wave = fixture_corpus
    entry = by_wave[1]
    events = _events(entry)
    assert [(e["type"], e.get("task")) for e in events] == [
        ("base", None), ("fold", "1a"), ("fold", "1b")]
    assert json.loads((entry.wave_dir / "conflicts.json").read_text()) == []
    assert _patch_paths(entry, "1a") == ["a.txt"]
    assert _patch_paths(entry, "1b") == ["b.txt"]


def test_wave2_same_anchor_appends_auto_union(fixture_corpus):
    _repo, _corpus, by_wave = fixture_corpus
    entry = by_wave[2]
    events = _events(entry)
    assert [e["type"] for e in events] == ["base", "fold", "fold", "resolve"]
    # both tasks append a different line at the same anchor of one file:
    # the commuting-appends shape, auto-unioned by the kernel (class-3 material).
    assert _patch_paths(entry, "2a") == _patch_paths(entry, "2b") == ["c.txt"]
    assert entry.commutes == {"2a": ["c.txt"], "2b": ["c.txt"]}
    (conflict,) = json.loads((entry.wave_dir / "conflicts.json").read_text())
    assert conflict["path"] == "c.txt" and conflict["autoResolved"] is True
    assert events[-1]["path"] == "c.txt"
    assert "c left addition" in events[-1]["lines"]
    assert "c right addition" in events[-1]["lines"]


def test_wave3_overlapping_region_contends_with_xaxbx_context(fixture_corpus):
    repo, _corpus, by_wave = fixture_corpus
    entry = by_wave[3]
    assert [e["type"] for e in _events(entry)] == ["base", "fold", "fold"]
    (conflict,) = json.loads((entry.wave_dir / "conflicts.json").read_text())
    assert conflict["path"] == "d.txt" and conflict["dispatchable"] is True
    assert _patch_paths(entry, "3a") == _patch_paths(entry, "3b") == ["d.txt"]
    # the XaXbX seed: a line occurring twice in the base, inside the contended region
    base = _git(repo, "show", "%s:d.txt" % entry.base_sha).splitlines()
    repeated = [line for line in set(base) if base.count(line) >= 2]
    assert repeated == ["--"]
    for task_id in entry.tasks:
        patch = (entry.wave_dir / ("task-%s.patch" % task_id)).read_text()
        assert any(line[1:] == "--" for line in patch.splitlines()
                   if line.startswith(" ") or line.startswith("+"))


def test_wave4_deletion_adjacency_and_binary_seeds(fixture_corpus):
    repo, _corpus, by_wave = fixture_corpus
    entry = by_wave[4]
    assert [e["type"] for e in _events(entry)] == ["base", "fold", "fold"]
    assert _patch_paths(entry, "4a") == ["b.txt"]
    assert _patch_paths(entry, "4b") == ["b.txt", "bin.dat"]
    deleter = (entry.wave_dir / "task-4a.patch").read_text()
    near = (entry.wave_dir / "task-4b.patch").read_text()
    # 4a deletes base lines; 4b's edit to the same file is a pure addition, so
    # exactly one ordered (deleter, neighbour) pair exists on b.txt.
    assert [line for line in deleter.splitlines() if line.startswith("-")
            and not line.startswith("---")] == ["-b five", "-b six"]
    assert [line for line in near.splitlines() if line.startswith("-")
            and not line.startswith("---")] == []
    assert "+b eight and a half" in near.splitlines()
    # the deleted base lines (5, 6) fall within k=3 of 4b's b.txt hunk span
    assert _deleted_base_lines(deleter, "b.txt") == [5, 6]
    near_start, near_len = _hunk_span(near, "b.txt")
    near_end = near_start + near_len - 1
    assert (near_start, near_end) == (6, 10)
    assert any(near_start - 3 <= line <= near_end + 3
               for line in _deleted_base_lines(deleter, "b.txt"))
    # binary exclusion seed: 4b rewrites the binary path, as a real binary patch
    assert "GIT binary patch" in near


def test_fixture_patches_apply_over_the_base(fixture_corpus, tmp_path):
    """Every corpus patch is a real `git apply`-able diff against the base."""
    repo, _corpus, by_wave = fixture_corpus
    env = dict(os.environ, GIT_INDEX_FILE=str(tmp_path / "probe-index"))
    for entry in sorted(by_wave.values(), key=lambda e: e.wave):
        for task_id in entry.tasks:
            subprocess.run(["git", "-C", str(repo), "read-tree", entry.base_sha],
                           check=True, capture_output=True, env=env)
            patch = entry.wave_dir / ("task-%s.patch" % task_id)
            check = subprocess.run(
                ["git", "-C", str(repo), "apply", "--check", "--binary", "--cached",
                 str(patch)], capture_output=True, text=True, env=env)
            assert check.returncode == 0, check.stderr


def test_builder_is_deterministic(tmp_path):
    first_repo, first = corpuslib.make_fixture_corpus(tmp_path / "one")
    second_repo, second = corpuslib.make_fixture_corpus(tmp_path / "two")
    assert _git(first_repo, "rev-parse", "HEAD") == _git(second_repo, "rev-parse", "HEAD")
    for a, b in zip(corpuslib.load_corpus_index(first),
                    corpuslib.load_corpus_index(second)):
        assert (a.run_id, a.wave, a.base_sha, a.mode, a.tasks) == \
               (b.run_id, b.wave, b.base_sha, b.mode, b.tasks)
        for name in sorted(p.name for p in a.wave_dir.iterdir()):
            assert (a.wave_dir / name).read_bytes() == (b.wave_dir / name).read_bytes(), name


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def _events(entry):
    return [json.loads(line) for line
            in (entry.wave_dir / "fold_log.jsonl").read_text().splitlines()]


def _patch_paths(entry, task_id):
    """The paths a task's corpus patch touches, from its diff headers."""
    text = (entry.wave_dir / ("task-%s.patch" % task_id)).read_text(errors="replace")
    return sorted(line.split(" b/")[-1] for line in text.splitlines()
                  if line.startswith("diff --git "))


def _hunk_span(patch_text, path):
    """`(start, len)` of the first `@@ -s,n +…` hunk targeting `path`."""
    current = None
    for line in patch_text.splitlines():
        if line.startswith("diff --git "):
            current = line.split(" b/")[-1]
        elif line.startswith("@@") and current == path:
            old = line.split()[1]           # e.g. "-5,2"
            start, _, count = old[1:].partition(",")
            return int(start), int(count or 1)
    raise AssertionError("no hunk for %s" % path)


def _deleted_base_lines(patch_text, path):
    """The 1-based base line numbers a patch deletes on `path`."""
    current, line_no, deleted = None, 0, []
    for line in patch_text.splitlines():
        if line.startswith("diff --git "):
            current = line.split(" b/")[-1]
        elif line.startswith("@@") and current == path:
            line_no = int(line.split()[1][1:].partition(",")[0])
        elif current == path and line_no:
            if line.startswith("-") and not line.startswith("---"):
                deleted.append(line_no)
                line_no += 1
            elif line.startswith(" "):
                line_no += 1
    return deleted

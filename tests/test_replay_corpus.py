"""The replayer: corpus in, class census and pre-registered readings out.

Everything here is over `evals/frontier/replay_corpus.py` (spec
`docs/superpowers/specs/2026-08-31-fold-corpus-validation.md`, Deliverable B
and its Pre-registered readings). The replay runs against
`corpuslib.make_fixture_corpus`'s four seeded waves, which carry one known
instance of each thing the census reports; the verdict rule and the renderer
are pinned against hand-built results dicts, so the GO/NO/INSUFFICIENT-CORPUS
line is asserted without needing 50 real folds on disk.

Offline and deterministic: no network, no model calls, and every byte written
under the test's own `tmp_path`.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "evals" / "frontier"))
import classify  # noqa: E402
import corpuslib  # noqa: E402
import replay_corpus  # noqa: E402

REPLAYER = ROOT / "evals" / "frontier" / "replay_corpus.py"

# The fixture corpus's whole class table: wave 1 puts two disjoint files in
# class 1, wave 2's declared-commutative same-anchor appends land class 3,
# wave 3's rewrite-inside-a-rewrite lands class 5, wave 4 adds one more
# class-1 path plus the binary exclusion, and wave 5's agreed whole-file
# deletion plus its sibling edit land two more class 1. No class 2 anywhere:
# the fixture corpus is the agreeing case.
FIXTURE_COUNTS = {1: 5, 2: 0, 3: 1, 4: 0, 5: 1, "binary": 1}


@pytest.fixture(scope="module")
def replayed(tmp_path_factory):
    """One build + one replay of the fixture corpus, shared read-only."""
    dest = tmp_path_factory.mktemp("replay-corpus")
    repo, corpus = corpuslib.make_fixture_corpus(dest)
    return repo, corpus, replay_corpus.replay(repo, corpus)


def _class2(path="x.txt", explained=False, weave="a\nb\n", git="b\na\n"):
    return {"run": "run-99", "wave": 1, "path": path,
            "mechanically_explained": explained, "weave": weave, "git": git}


# --------------------------------------------------------------------------
# replay over the fixture corpus
# --------------------------------------------------------------------------

def test_replay_over_fixture_corpus(replayed):
    _repo, _corpus, results = replayed
    assert results["verdict"] == "INSUFFICIENT-CORPUS"
    assert results["counts"][1] >= 1 and results["counts"][5] >= 1
    assert results["skipped"] == []
    md = replay_corpus.render_results(results)
    assert "INSUFFICIENT-CORPUS" in md and "class 2" in md.lower()


def test_class_table_is_exact(replayed):
    _repo, _corpus, results = replayed
    assert results["counts"] == FIXTURE_COUNTS
    assert results["replayed"] == 5
    assert results["class2"] == []
    assert results["unexplained_class2"] == 0


def test_per_run_and_per_entry_breakdown(replayed):
    _repo, _corpus, results = replayed
    assert results["per_run"] == {corpuslib.FIXTURE_RUN_ID: FIXTURE_COUNTS}
    assert [(e["run"], e["wave"]) for e in results["entries"]] == [
        (corpuslib.FIXTURE_RUN_ID, w) for w in (1, 2, 3, 4, 5)]
    assert results["entries"][0]["counts"] == {1: 2, 2: 0, 3: 0, 4: 0, 5: 0,
                                               "binary": 0}
    assert results["entries"][3]["counts"] == {1: 1, 2: 0, 3: 0, 4: 0, 5: 0,
                                               "binary": 1}
    assert results["entries"][4]["counts"] == {1: 2, 2: 0, 3: 0, 4: 0, 5: 0,
                                               "binary": 0}


def test_ride_alongs_ride_along(replayed):
    _repo, _corpus, results = replayed
    # d.txt is the XaXbX seed: its hunks lean on the `--` line, which occurs
    # twice in the base. Nothing else in the fixture repeats a line.
    assert [(r["run"], r["wave"], r["path"]) for r in results["xaxbx"]["flagged"]] \
        == [(corpuslib.FIXTURE_RUN_ID, 3, "d.txt")]
    assert results["xaxbx"]["count"] == 1
    assert results["deletion_adjacency"] == [
        {"run": corpuslib.FIXTURE_RUN_ID, "wave": 3, "path": "d.txt",
         "task_del": "3a", "task_near": "3b", "deleted_line": 3},
        {"run": corpuslib.FIXTURE_RUN_ID, "wave": 3, "path": "d.txt",
         "task_del": "3b", "task_near": "3a", "deleted_line": 3},
        {"run": corpuslib.FIXTURE_RUN_ID, "wave": 4, "path": "b.txt",
         "task_del": "4a", "task_near": "4b", "deleted_line": 5},
    ]


def test_determinism_recheck_reported_per_fold(replayed):
    _repo, _corpus, results = replayed
    assert results["determinism"] == {"checked": 5, "divergences": []}


# --------------------------------------------------------------------------
# skips are counted by name, never silent
# --------------------------------------------------------------------------

def test_unresolvable_base_sha_is_a_named_skip(replayed, tmp_path):
    repo, corpus, _results = replayed
    entries = corpuslib.load_corpus_index(corpus)
    entries[1].base_sha = "0" * 40
    corpuslib.write_corpus_index(tmp_path, entries)
    for entry in entries:                       # re-point the waves, same bytes
        (tmp_path / entry.run_id).mkdir(exist_ok=True)
        if not (tmp_path / entry.run_id / ("wave-%d" % entry.wave)).exists():
            (tmp_path / entry.run_id / ("wave-%d" % entry.wave)).symlink_to(
                entry.wave_dir, target_is_directory=True)

    results = replay_corpus.replay(repo, tmp_path)
    assert results["replayed"] == 4
    assert len(results["skipped"]) == 1
    skip = results["skipped"][0]
    assert (skip["run"], skip["wave"]) == (corpuslib.FIXTURE_RUN_ID, 2)
    assert "0000000" in skip["reason"]
    assert results["skipped_count"] == 1


def test_index_skip_reason_is_carried_through(replayed, tmp_path):
    repo, corpus, _results = replayed
    entries = corpuslib.load_corpus_index(corpus)
    entries[0].skipped = "no fold logs"
    corpuslib.write_corpus_index(tmp_path, entries)
    results = replay_corpus.replay(repo, tmp_path)
    assert results["skipped"][0] == {"run": corpuslib.FIXTURE_RUN_ID, "wave": 1,
                                     "reason": "no fold logs"}


# --------------------------------------------------------------------------
# a path only one arm answered for: the defect signal must survive the replay
# --------------------------------------------------------------------------

def test_class2_instance_carries_a_missing_arm_as_none():
    """`classify` calls a one-arm-only path an unexplained class 2 on purpose;
    dumping it must not need the arm that never answered."""
    weave = corpuslib.ArmResult({"only.txt": corpuslib.PathAnswer("clean", b"weave only\n")}, True)
    git = corpuslib.ArmResult({}, False)
    rows = classify.classify(weave, git)
    assert rows == [{"path": "only.txt", "cls": 2,
                     "mechanically_explained": False, "xaxbx": False}]
    entry = corpuslib.CorpusEntry(run_id="run-99", wave=1, base_sha="0" * 40,
                                  mode="patch", wave_dir=Path("/nonexistent"))
    instance = replay_corpus.class2_instance(entry, rows[0], weave, git)
    assert instance["weave"] == "weave only\n"
    assert instance["git"] is None
    assert replay_corpus.render_results(
        {"replayed": 1, "counts": {2: 1}, "per_run": {}, "entries": [],
         "class2": [instance], "unexplained_class2": 1,
         "skipped": [], "skipped_count": 0,
         "xaxbx": {"flagged": [], "count": 0, "by_class": {}},
         "deletion_adjacency": [], "determinism": {"checked": 1, "divergences": []},
         "verdict": "NO"}).count("<path absent>") == 1


def test_replay_survives_a_path_the_weave_never_reached(replayed, monkeypatch):
    """A fold that stopped at a conflict leaves the git arm naming a path the
    weave arm has no answer for. That is the signal the verdict turns on, so
    it lands in `class2` — it never aborts the replay."""
    repo, corpus, _results = replayed
    real_git_answer = replay_corpus.arm_git.git_answer

    def stopped_short(repo_arg, entry, weave, **kwargs):
        result = real_git_answer(repo_arg, entry, weave, **kwargs)
        if entry.wave == 1:
            result.per_path["never-reached.txt"] = corpuslib.PathAnswer(
                "clean", b"git reached it\n")
        return result

    monkeypatch.setattr(replay_corpus.arm_git, "git_answer", stopped_short)
    results = replay_corpus.replay(repo, corpus)

    assert results["skipped"] == []
    assert results["replayed"] == 5
    orphans = [row for row in results["class2"] if row["path"] == "never-reached.txt"]
    assert len(orphans) == 1
    assert orphans[0] == {"run": corpuslib.FIXTURE_RUN_ID, "wave": 1,
                          "path": "never-reached.txt",
                          "mechanically_explained": False,
                          "weave": None, "git": "git reached it\n"}
    assert results["unexplained_class2"] == 1
    assert results["verdict"] == "NO"
    md = replay_corpus.render_results(results)
    assert "never-reached.txt" in md and "<path absent>" in md


# --------------------------------------------------------------------------
# the verdict rule, exactly as pre-registered
# --------------------------------------------------------------------------

def test_replay_accepts_relative_paths(replayed, monkeypatch):
    """The plan's own Task-8 command passes `--repo . --corpus <rel>`; both
    must resolve before Arm W chdirs and Arm G clones from a temp dir, or
    every entry skips and the run reports 0 replayed (run-34 critic,
    blocking)."""
    repo, corpus, absolute_results = replayed
    monkeypatch.chdir(Path(repo).parent)
    results = replay_corpus.replay(Path(repo).name,
                                   os.path.relpath(corpus, Path(repo).parent))
    assert results["skipped"] == []
    assert results["replayed"] == absolute_results["replayed"]
    assert results["counts"] == absolute_results["counts"]


def test_verdict_rule():
    assert replay_corpus.verdict(50, []) == "GO"
    assert replay_corpus.verdict(51, [_class2(explained=True)]) == "GO"
    assert replay_corpus.verdict(49, []) == "INSUFFICIENT-CORPUS"
    assert replay_corpus.verdict(0, []) == "INSUFFICIENT-CORPUS"
    # An unexplained class 2 is a NO at any replayed count.
    assert replay_corpus.verdict(4, [_class2()]) == "NO"
    assert replay_corpus.verdict(500, [_class2(explained=True), _class2()]) == "NO"


def test_unexplained_class2_renders_no():
    row = _class2(path="d.txt", weave="d header\nd alpha\n", git="d alpha\nd gamma\n")
    results = {"replayed": 60, "counts": {1: 10, 2: 1, 3: 0, 4: 0, 5: 0, "binary": 0},
               "per_run": {"run-99": {1: 10, 2: 1, 3: 0, 4: 0, 5: 0, "binary": 0}},
               "entries": [{"run": "run-99", "wave": 1,
                            "counts": {1: 10, 2: 1, 3: 0, 4: 0, 5: 0, "binary": 0}}],
               "class2": [row], "unexplained_class2": 1,
               "skipped": [], "skipped_count": 0,
               "xaxbx": {"flagged": [], "count": 0, "by_class": {}},
               "deletion_adjacency": [],
               "determinism": {"checked": 60, "divergences": []},
               "verdict": replay_corpus.verdict(60, [row])}
    assert results["verdict"] == "NO"
    md = replay_corpus.render_results(results)
    assert "**Verdict:** NO" in md
    # Both contents verbatim, so the instance can be hand-read off the doc.
    assert "d header\nd alpha\n" in md and "d alpha\nd gamma\n" in md
    assert "run-99" in md and "d.txt" in md


def test_render_follows_the_pre_registered_order(replayed):
    _repo, _corpus, results = replayed
    md = replay_corpus.render_results(results)
    headings = [line for line in md.splitlines() if line.startswith("## ")]
    assert headings == [
        "## GO on the Tier-1 gate",
        "## Corpus padding",
        "## Class 3 (value) and class 4 (cost), per run",
        "## Skips",
        "## Determinism re-check",
        "## XaXbX census and deletion-flag counts",
    ]
    assert md.startswith("# Fold corpus validation — replay results\n")
    assert "**Verdict:** INSUFFICIENT-CORPUS" in md


def test_render_survives_a_json_round_trip(replayed):
    """The CLI's own `--out` file is what a reader renders from."""
    _repo, _corpus, results = replayed
    reloaded = json.loads(json.dumps(results))
    assert replay_corpus.render_results(reloaded) == replay_corpus.render_results(results)


# --------------------------------------------------------------------------
# the CLI
# --------------------------------------------------------------------------

def _cli(*args):
    return subprocess.run([sys.executable, str(REPLAYER), *args],
                          capture_output=True, text=True)


def test_cli_writes_results_json(replayed, tmp_path):
    repo, corpus, expected = replayed
    out = tmp_path / "results.json"
    done = _cli("--repo", str(repo), "--corpus", str(corpus), "--out", str(out))
    assert done.returncode == 0, done.stderr
    written = json.loads(out.read_text())
    assert written == json.loads(json.dumps(expected))
    assert "**Verdict:** INSUFFICIENT-CORPUS" in done.stdout


def test_cli_refuses_a_corpus_with_no_index(tmp_path):
    out = tmp_path / "results.json"
    done = _cli("--repo", str(tmp_path), "--corpus", str(tmp_path), "--out", str(out))
    assert done.returncode == 2
    assert "corpus-index.json" in done.stderr
    assert "Traceback" not in done.stderr
    assert len(done.stderr.strip().splitlines()) == 1
    assert not out.exists()

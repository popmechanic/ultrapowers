"""The extractor: rescued `sandbox-logs.tgz` evidence -> a committed corpus.

Every assertion here is over `evals/frontier/corpus_extract.py` (spec
`docs/superpowers/specs/2026-08-31-fold-corpus-validation.md`, Deliverable A,
step 2). The extractor's whole job is to pull the *corpus subset* out of a
fleet evidence tarball — fold logs, their sibling conflict/resolve artifacts,
and the patch files those logs name — into the Task-1 corpus layout, with the
recorded absolute sandbox paths rewritten to wave-relative names so the wave
directory is the whole record.

The tarballs are synthesized here rather than checked in: every byte written
by these tests lives under pytest's `tmp_path`.
"""
import json
import subprocess
import sys
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "evals" / "frontier"))
import corpus_extract  # noqa: E402
import corpuslib  # noqa: E402

BASE_SHA = "a" * 40
HEAD_SHA = "b" * 40
SANDBOX_PATCH = "/home/exedev/absolute/task-1.patch"
PATCH_BODY = (
    "diff --git a/a.txt b/a.txt\n"
    "--- a/a.txt\n"
    "+++ b/a.txt\n"
    "@@ -1 +1,2 @@\n"
    " a one\n"
    "+a two\n"
)


def _tarball(dest: Path, files: dict) -> Path:
    """Pack `files` ({in-tarball path: text|bytes}) as `dest/sandbox-logs.tgz`,
    the name every fleet evidence bundle uses."""
    dest.mkdir(parents=True, exist_ok=True)
    stage = dest / "stage"
    for name, body in files.items():
        path = stage / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body if isinstance(body, bytes) else body.encode())
    tgz = dest / "sandbox-logs.tgz"
    with tarfile.open(tgz, "w:gz") as tf:
        for path in sorted(stage.rglob("*")):
            if path.is_file():
                tf.add(path, arcname=str(path.relative_to(stage)))
    return tgz


def _jsonl(*events):
    return "".join(json.dumps(e) + "\n" for e in events)


RUN = "repo/.claude/ultrapowers/run-run-99"
WAVE = RUN + "/frontier/wave-1"

FOLD_EVENTS = (
    {"type": "base", "sha": BASE_SHA},
    {"type": "fold", "task": "1", "headSha": HEAD_SHA, "patch": SANDBOX_PATCH},
    {"type": "fold", "task": "2", "headSha": "c" * 40,
     "patch": "/home/exedev/absolute/task-2.patch"},
    {"type": "resolve", "path": "a.txt", "epoch": 3, "lines": ["a one", ""]},
)

CONFLICTS = [{"i": 1, "path": "a.txt", "kind": "content", "epoch": 2,
              "hunksFile": "/home/exedev/sandbox/wave-1/conflict-1.hunks.txt",
              "hunkCount": 1}]

PATCH_RUN = {
    WAVE + "/fold_log.jsonl": _jsonl(*FOLD_EVENTS),
    WAVE + "/conflicts.json": json.dumps(CONFLICTS, indent=2) + "\n",
    WAVE + "/conflict-1.txt": "<<<<<<< base\n=======\n>>>>>>> task 1\n",
    WAVE + "/conflict-1.hunks.txt": "hunk 1\n",
    WAVE + "/fold_stats.json": '{"maxLines": 400}\n',
    RUN + "/patches/task-1.patch": PATCH_BODY,
    RUN + "/patches/task-2.patch": PATCH_BODY.replace("a two", "a three"),
    # Noise the extractor must NOT pull: the corpus subset is fold logs,
    # their wave-dir siblings, and the patches those logs name — nothing else.
    RUN + "/events.jsonl": '{"type": "run"}\n',
    RUN + "/workers/worker-1.json": "{}\n",
    "repo/.claude/projects/transcript.jsonl": '{"secret": true}\n',
    "shim.log": "noise\n",
}


def test_extract_rewrites_patch_paths_and_lands_the_wave(tmp_path):
    tgz = _tarball(tmp_path / "fleet-run-99-20260830", PATCH_RUN)
    out = tmp_path / "corpus"

    entries = corpus_extract.extract_tarball(tgz, out)

    assert len(entries) == 1
    assert entries[0].run_id == "run-99" and entries[0].mode == "patch"
    assert entries[0].wave == 1
    assert entries[0].base_sha == BASE_SHA
    assert entries[0].tasks == ["1", "2"]
    assert entries[0].skipped is None
    assert entries[0].wave_dir == out / "run-99" / "wave-1"

    ev = [json.loads(l) for l in
          (entries[0].wave_dir / "fold_log.jsonl").read_text().splitlines()]
    folds = [e for e in ev if e["type"] == "fold"]
    assert folds[0]["patch"] == "task-1.patch"
    assert (entries[0].wave_dir / "task-1.patch").is_file()

    # The rewrite touches the `patch` field and nothing else — every other
    # event, and every other field, is the kernel's own bytes.
    assert ev == [
        {"type": "base", "sha": BASE_SHA},
        {"type": "fold", "task": "1", "headSha": HEAD_SHA, "patch": "task-1.patch"},
        {"type": "fold", "task": "2", "headSha": "c" * 40, "patch": "task-2.patch"},
        {"type": "resolve", "path": "a.txt", "epoch": 3, "lines": ["a one", ""]},
    ]
    assert (entries[0].wave_dir / "task-1.patch").read_text() == PATCH_BODY
    assert (entries[0].wave_dir / "task-2.patch").read_text() == \
        PATCH_BODY.replace("a two", "a three")


def test_extract_takes_the_wave_siblings_and_nothing_else(tmp_path):
    tgz = _tarball(tmp_path / "fleet-run-99-20260830", PATCH_RUN)
    out = tmp_path / "corpus"

    entries = corpus_extract.extract_tarball(tgz, out)

    assert sorted(p.name for p in entries[0].wave_dir.iterdir()) == [
        "conflict-1.hunks.txt", "conflict-1.txt", "conflicts.json",
        "fold_log.jsonl", "fold_stats.json", "task-1.patch", "task-2.patch",
    ]
    # `hunksFile` is the second absolute sandbox path the kernel records; a
    # corpus that moved machines would name a file that is not there.
    assert json.loads((entries[0].wave_dir / "conflicts.json").read_text()) == [
        {"i": 1, "path": "a.txt", "kind": "content", "epoch": 2,
         "hunksFile": "conflict-1.hunks.txt", "hunkCount": 1},
    ]
    assert sorted(p.name for p in (out / "run-99").iterdir()) == ["wave-1"]


def test_branch_mode_is_detected_from_the_absence_of_patch_fields(tmp_path):
    tgz = _tarball(tmp_path / "fleet-run-14-20260801", {
        "repo/.claude/ultrapowers/run-run-14/frontier/wave-2/fold_log.jsonl":
            _jsonl({"type": "base", "sha": BASE_SHA},
                   {"type": "fold", "task": "7", "headSha": HEAD_SHA}),
    })
    out = tmp_path / "corpus"

    entries = corpus_extract.extract_tarball(tgz, out)

    assert [(e.run_id, e.wave, e.mode, e.tasks, e.skipped) for e in entries] == \
        [("run-14", 2, "branch", ["7"], None)]
    assert entries[0].wave_dir == out / "run-14" / "wave-2"


def test_no_fold_logs_is_an_index_row_not_silence(tmp_path):
    tgz = _tarball(tmp_path / "fleet-run-77-20260829", {
        "repo/.claude/ultrapowers/run-run-77/events.jsonl": '{"type": "run"}\n',
        "shim.log": "noise\n",
    })
    out = tmp_path / "corpus"

    entries = corpus_extract.extract_tarball(tgz, out)

    assert len(entries) == 1
    assert entries[0].skipped == "no fold logs"
    assert (entries[0].run_id, entries[0].wave, entries[0].base_sha,
            entries[0].mode) == ("run-77", 0, "", "")


def test_a_log_without_a_base_line_is_skipped_by_name(tmp_path):
    tgz = _tarball(tmp_path / "fleet-run-31-20260828", {
        "repo/.claude/ultrapowers/run-run-31/frontier/wave-1/fold_log.jsonl":
            _jsonl({"type": "fold", "task": "1", "headSha": HEAD_SHA}),
    })
    out = tmp_path / "corpus"

    entries = corpus_extract.extract_tarball(tgz, out)

    assert [(e.run_id, e.wave, e.skipped) for e in entries] == \
        [("run-31", 1, "log does not open with a base event")]


def test_a_missing_patch_file_is_skipped_by_name(tmp_path):
    files = dict(PATCH_RUN)
    del files[RUN + "/patches/task-2.patch"]
    tgz = _tarball(tmp_path / "fleet-run-99-20260830", files)
    out = tmp_path / "corpus"

    entries = corpus_extract.extract_tarball(tgz, out)

    assert entries[0].skipped == "missing patches: task-2.patch"
    # What IS there still lands: a partial record is readable evidence.
    assert (entries[0].wave_dir / "task-1.patch").is_file()
    assert not (entries[0].wave_dir / "task-2.patch").exists()


def test_cli_writes_one_index_over_every_bundle(tmp_path):
    evidence = tmp_path / "evidence"
    _tarball(evidence / "fleet-run-99-20260830", PATCH_RUN)
    _tarball(evidence / "fleet-run-77-20260829", {
        "repo/.claude/ultrapowers/run-run-77/events.jsonl": '{"type": "run"}\n',
    })
    out = tmp_path / "corpus"

    proc = subprocess.run(
        [sys.executable, str(ROOT / "evals" / "frontier" / "corpus_extract.py"),
         "--evidence", str(evidence), "--out", str(out)],
        capture_output=True, text=True)
    assert proc.returncode == 0, proc.stdout + proc.stderr

    assert json.loads((out / "corpus-index.json").read_text()) == [
        {"runId": "run-77", "wave": 0, "baseSha": "", "mode": "",
         "tasks": [], "skipped": "no fold logs", "commutes": {}},
        {"runId": "run-99", "wave": 1, "baseSha": BASE_SHA, "mode": "patch",
         "tasks": ["1", "2"], "skipped": None, "commutes": {}},
    ]
    loaded = corpuslib.load_corpus_index(out)
    assert [(e.run_id, e.wave, e.skipped) for e in loaded] == \
        [("run-77", 0, "no fold logs"), ("run-99", 1, None)]

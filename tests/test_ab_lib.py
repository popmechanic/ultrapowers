# tests/test_ab_lib.py
import json, pathlib, subprocess, sys
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "evals"))
from ab_lib import build_cell, harvest_row, ENGINE_REPO_PARTS


def _make_fixture(tmp_path):
    fx = tmp_path / "fixtures" / "mini"
    (fx / "project").mkdir(parents=True)
    (fx / "project" / "app.py").write_text("x = 1\n")
    (fx / "plan.md").write_text("# P\n\n### Task 1: A\n")
    return tmp_path / "fixtures"


def test_build_cell_assembles_a_committed_repo(tmp_path):
    fixtures = _make_fixture(tmp_path)
    cell = build_cell("mini", repo_root=ROOT, workspace=tmp_path / "ws",
                      fixtures_root=fixtures)
    assert (cell / "app.py").read_text() == "x = 1\n"
    assert (cell / "plan.md").is_file()
    # Engine-required repo-relative parts travel with the cell:
    assert (cell / "skills/ultrapowers/scripts/ultra_run.py").is_file()
    assert (cell / "fleet/confine-hook.mjs").is_file()
    # git repo, clean, on a branch, everything committed:
    st = subprocess.run(["git", "status", "--porcelain"], cwd=cell,
                        capture_output=True, text=True)
    assert st.stdout == ""
    log = subprocess.run(["git", "log", "--oneline"], cwd=cell,
                         capture_output=True, text=True)
    assert len(log.stdout.strip().splitlines()) == 1


def test_build_cell_never_writes_into_the_fixture(tmp_path):
    fixtures = _make_fixture(tmp_path)
    before = sorted(p.relative_to(fixtures) for p in fixtures.rglob("*"))
    build_cell("mini", repo_root=ROOT, workspace=tmp_path / "ws",
               fixtures_root=fixtures)
    after = sorted(p.relative_to(fixtures) for p in fixtures.rglob("*"))
    assert before == after


def _write_run_dir(tmp_path):
    rd = tmp_path / "run-ab1"
    rd.mkdir()
    events = [
        {"ts": "2026-08-30T10:00:00.000Z", "kind": "driver:stage", "stage": "preflight"},
        {"ts": "2026-08-30T10:00:05.000Z", "kind": "worker:start", "label": "impl:1", "role": "implementer"},
        {"ts": "2026-08-30T10:05:00.000Z", "kind": "worker:end", "label": "impl:1", "role": "implementer",
         "meter": {"input": 10, "output": 1000, "cacheRead": 50, "cacheCreation": 5, "costUsd": 0.1, "models": ["m"]}},
        {"ts": "2026-08-30T10:06:00.000Z", "kind": "worker:end", "label": "rev:1", "role": "reviewer",
         "meter": {"input": 5, "output": 200, "cacheRead": 20, "cacheCreation": 2, "costUsd": 0.02, "models": ["m"]}},
        {"ts": "2026-08-30T10:10:00.000Z", "kind": "driver:stage", "stage": "approved"},
    ]
    with open(rd / "events.jsonl", "w") as f:
        for e in events:
            f.write(json.dumps(e) + "\n")
    (rd / "args.json").write_text(json.dumps(
        {"waves": [[{"id": "1"}, {"id": "2"}], [{"id": "3"}]]}))
    return rd


def test_harvest_row_sums_meters_and_reads_shape(tmp_path):
    rd = _write_run_dir(tmp_path)
    row = harvest_row(rd, {"fixture": "mini", "armOverlap": "fold",
                           "runId": "ab1", "engineRef": "abc123",
                           "exitCode": 0, "cellDir": "/tmp/cell"})
    assert row["fixture"] == "mini"
    assert row["armOverlap"] == "fold"
    assert row["engine"] == "one-driver"
    assert row["verdict"] == "approved"
    assert row["wallClockSec"] == 600.0          # first ts -> last ts
    assert row["outputTokens"] == 1200           # summed worker:end meters
    assert row["tokens"] == {"input": 15, "output": 1200, "cacheRead": 70,
                             "cacheCreation": 7, "costUsd": 0.12}
    assert row["waveShape"] == [["1", "2"], ["3"]]
    assert row["invalid"] is None


def test_harvest_row_nonzero_exit_records_failure_verdict(tmp_path):
    rd = _write_run_dir(tmp_path)
    with open(rd / "events.jsonl", "a") as f:
        f.write(json.dumps({"ts": "2026-08-30T10:11:00.000Z",
                            "kind": "driver:fail", "verdict": "gate-red",
                            "detail": "suite failed"}) + "\n")
    row = harvest_row(rd, {"fixture": "mini", "armOverlap": "serialize",
                           "runId": "ab2", "engineRef": "abc123",
                           "exitCode": 1, "cellDir": "/tmp/cell"})
    assert row["verdict"] == "gate-red"
    assert row["invalid"] is None


def test_harvest_row_missing_events_is_invalid(tmp_path):
    rd = tmp_path / "empty-run"
    rd.mkdir()
    row = harvest_row(rd, {"fixture": "mini", "armOverlap": "fold",
                           "runId": "ab3", "engineRef": "abc123",
                           "exitCode": 1, "cellDir": "/tmp/cell"})
    assert row["invalid"] == "no-events"


def test_engine_repo_parts_exist_at_head():
    for part in ENGINE_REPO_PARTS:
        assert (ROOT / part).exists(), part


ROW_KEYS = ["armOverlap", "cellDir", "engine", "engineRef", "fixture",
            "invalid", "mode", "outputTokens", "runId", "startedAt",
            "tokens", "verdict", "wallClockSec", "waveShape"]


def test_harvest_row_carries_exactly_the_documented_schema(tmp_path):
    """Task 3 appends this row verbatim to runs.jsonl — the key set is the
    contract, not an implementation detail."""
    rd = _write_run_dir(tmp_path)
    row = harvest_row(rd, {"fixture": "mini", "armOverlap": "fold",
                           "runId": "ab1", "engineRef": "abc123",
                           "exitCode": 0, "cellDir": "/tmp/cell"})
    assert sorted(row) == ROW_KEYS
    assert row["startedAt"] == "2026-08-30T10:00:00.000Z"
    assert row["mode"] == "local"
    assert row["engineRef"] == "abc123"
    assert row["runId"] == "ab1"
    assert row["cellDir"] == "/tmp/cell"
    # the row survives a jsonl round trip (runs.jsonl is one object per line):
    assert json.loads(json.dumps(row)) == row


def test_harvest_row_invalid_run_keeps_the_same_schema(tmp_path):
    rd = tmp_path / "empty-run"
    rd.mkdir()
    (rd / "events.jsonl").write_text("")
    row = harvest_row(rd, {"fixture": "mini", "armOverlap": "serialize",
                           "runId": "ab4", "engineRef": "abc123",
                           "exitCode": 1, "cellDir": "/tmp/cell"})
    assert sorted(row) == ROW_KEYS
    assert row["invalid"] == "no-events"
    assert row["startedAt"] is None
    assert row["wallClockSec"] is None
    assert row["outputTokens"] == 0
    assert row["tokens"] == {"input": 0, "output": 0, "cacheRead": 0,
                             "cacheCreation": 0, "costUsd": 0.0}
    assert row["verdict"] == "failed"
    assert row["waveShape"] == []


# The engine stamps `ts` as epoch milliseconds (`Date.now()` in makeEventLog,
# fleet/run-waves.mjs) — never an ISO string. The hand-written run dir above
# uses the ISO form, so these cases cover the shape a real harvest sees.
EPOCH_MS_START = 1788079101931          # 2026-08-30T08:38:21.931Z


def _write_epoch_run_dir(tmp_path, name="run-epoch"):
    rd = tmp_path / name
    rd.mkdir()
    events = [
        {"kind": "run:open", "runId": "ab5", "ts": EPOCH_MS_START},
        {"kind": "worker:start", "label": "impl:1", "ts": EPOCH_MS_START + 5000},
        {"kind": "worker:end", "label": "impl:1", "ts": EPOCH_MS_START + 300_000,
         "meter": {"input": 10, "output": 1000, "cacheRead": 50,
                   "cacheCreation": 5, "costUsd": 0.1, "models": ["m"]}},
        {"kind": "driver:stage", "stage": "approved",
         "ts": EPOCH_MS_START + 600_000},
    ]
    with open(rd / "events.jsonl", "w") as f:
        for e in events:
            f.write(json.dumps(e) + "\n")
    (rd / "args.json").write_text(json.dumps({"waves": [[{"id": "1"}]]}))
    return rd


def _epoch_meta(**over):
    meta = {"fixture": "mini", "armOverlap": "fold", "runId": "ab5",
            "engineRef": "abc123", "exitCode": 0, "cellDir": "/tmp/cell"}
    meta.update(over)
    return meta


def test_harvest_row_reads_the_engines_epoch_ms_stamps(tmp_path):
    """wallClockSec is the headline fold-vs-serialize metric; a numeric ts
    must not silently harvest as null."""
    row = harvest_row(_write_epoch_run_dir(tmp_path), _epoch_meta())
    assert row["wallClockSec"] == 600.0
    assert row["startedAt"] == "2026-08-30T08:38:21.931Z"
    assert row["invalid"] is None
    assert row["outputTokens"] == 1000
    assert row["waveShape"] == [["1"]]
    assert json.loads(json.dumps(row)) == row


def test_harvest_row_epoch_startedat_is_a_comparable_iso_string(tmp_path):
    """The 0.1.0 rows in evals/results/runs.jsonl carry startedAt as an ISO
    string and wallClockSec as a float — new rows must match those types."""
    row = harvest_row(_write_epoch_run_dir(tmp_path), _epoch_meta())
    assert isinstance(row["startedAt"], str)
    assert isinstance(row["wallClockSec"], float)


def test_harvest_row_mixes_epoch_and_iso_stamps(tmp_path):
    """Both forms sort against each other rather than raising."""
    rd = tmp_path / "run-mixed"
    rd.mkdir()
    with open(rd / "events.jsonl", "w") as f:
        f.write(json.dumps({"kind": "run:open", "ts": EPOCH_MS_START}) + "\n")
        f.write(json.dumps({"kind": "driver:stage", "stage": "approved",
                            "ts": "2026-08-30T08:39:21.931Z"}) + "\n")
    row = harvest_row(rd, _epoch_meta(runId="ab6"))
    assert row["wallClockSec"] == 60.0
    assert row["startedAt"] == "2026-08-30T08:38:21.931Z"


def test_harvest_row_ignores_unusable_stamps(tmp_path):
    """A bool is an int in Python, and a stray null/garbage ts must not become
    a clock reading — such events just do not bound the window."""
    rd = tmp_path / "run-junk"
    rd.mkdir()
    with open(rd / "events.jsonl", "w") as f:
        for ts in (True, None, "not-a-date", {"ts": 1}):
            f.write(json.dumps({"kind": "driver:stage", "ts": ts}) + "\n")
    row = harvest_row(rd, _epoch_meta(runId="ab7", exitCode=1))
    assert row["startedAt"] is None
    assert row["wallClockSec"] is None
    assert row["invalid"] is None      # events were read; only stamps were bad
    assert sorted(row) == ROW_KEYS

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/ultralearn/scripts"))
import fleet_events  # noqa: E402

T0 = 1788130000000


def _ev(i, ts_offset_ms, **fields):
    """One event record: id is the sort key, ts is the wall clock."""
    return dict(fields, id=f"01AAA{i:03d}", ts=T0 + ts_offset_ms)


EVENTS = [
    _ev(1, 0, kind="run:open", runId="run-30", base="", source="fleet/run-main.mjs"),
    _ev(2, 1000, kind="driver:stage", stage="provision", detail="BASE 3fa4936"),
    _ev(3, 1500, kind="driver:auth", authMethod="oauth_token",
        apiKeySource=None, subscriptionType=None),
    _ev(4, 2000, kind="engine:phase", phase="Setup"),
    _ev(5, 2500, kind="engine:log", line="setup: baseline green"),
    _ev(6, 3000, kind="engine:phase", phase="Wave 1"),
    _ev(7, 3000, kind="worker:start", label="impl:1", role="implementer",
        sessionId="sess-1", cwd="/clones/task-1", model="opus"),
    _ev(8, 3000, kind="worker:start", label="impl:2", role="implementer",
        sessionId="sess-2", cwd="/clones/task-2", model="opus"),
    _ev(9, 63000, kind="worker:end", label="impl:1", role="implementer",
        sessionId="sess-1", exitCode=0, timedOut=False, outcome="ok",
        class_="success", status=None,
        meter={"input": 30, "output": 6463, "cacheRead": 452825,
               "cacheCreation": 20113, "costUsd": 0.5913, "models": ["claude-opus-5"]}),
    _ev(10, 70000, kind="worker:refused", label="impl:3", why="budget-already-tripped"),
    _ev(11, 80000, kind="driver:ack-decision", approve=False,
        reason="non-pre-authorized ack(s): deferred:manual"),
    _ev(12, 80000, kind="driver:fail", verdict="needs-ack",
        detail="non-pre-authorized ack(s): deferred:manual"),
]
# `class` is a Python keyword; the engine emits it as a plain JSON key.
for e in EVENTS:
    if "class_" in e:
        e["class"] = e.pop("class_")


def _write_log(run_dir, events=None):
    run_dir.mkdir(parents=True, exist_ok=True)
    lines = [json.dumps(e) for e in (EVENTS if events is None else events)]
    (run_dir / "events.jsonl").write_text("\n".join(lines) + "\n")
    return run_dir


def test_read_events_sorts_by_id_not_ts(tmp_path):
    run_dir = _write_log(tmp_path / "run-run-30", list(reversed(EVENTS)))
    got = fleet_events.read_events(run_dir)
    assert [e["id"] for e in got] == [e["id"] for e in EVENTS]


def test_read_events_skips_unparseable_lines(tmp_path):
    run_dir = tmp_path / "run-run-30"
    run_dir.mkdir(parents=True)
    (run_dir / "events.jsonl").write_text(
        json.dumps(EVENTS[0]) + "\n{ this is not json\n\n" + json.dumps(EVENTS[1]) + "\n")
    got = fleet_events.read_events(run_dir)
    assert [e["id"] for e in got] == ["01AAA001", "01AAA002"]


def test_read_events_missing_file_returns_empty(tmp_path):
    assert fleet_events.read_events(tmp_path / "nope") == []


def test_summarize_top_level(tmp_path):
    s = fleet_events.summarize_events(fleet_events.read_events(
        _write_log(tmp_path / "run-run-30")))
    assert s["runId"] == "run-30"
    assert s["openedAt"] == T0
    assert s["endedAt"] == T0 + 80000
    assert s["wallSec"] == 80.0
    assert s["authMethod"] == "oauth_token"
    assert s["counts"]["worker:start"] == 2
    assert s["counts"]["worker:end"] == 1
    assert s["eventCount"] == 12


def test_summarize_phases_and_stages(tmp_path):
    s = fleet_events.summarize_events(fleet_events.read_events(
        _write_log(tmp_path / "run-run-30")))
    assert [p["phase"] for p in s["phases"]] == ["Setup", "Wave 1"]
    assert s["phases"][0]["id"] == "01AAA004"
    assert [g["stage"] for g in s["stages"]] == ["provision"]
    assert s["stages"][0]["detail"] == "BASE 3fa4936"


def test_summarize_pairs_workers_and_carries_the_meter(tmp_path):
    s = fleet_events.summarize_events(fleet_events.read_events(
        _write_log(tmp_path / "run-run-30")))
    by_label = {w["label"]: w for w in s["workers"]}
    assert set(by_label) == {"impl:1", "impl:2", "impl:3"}
    done = by_label["impl:1"]
    assert done["role"] == "implementer"
    assert done["sessionId"] == "sess-1"
    assert done["startId"] == "01AAA007"
    assert done["endId"] == "01AAA009"
    assert done["wallSec"] == 60.0
    assert done["class"] == "success"
    assert done["exitCode"] == 0
    assert done["meter"]["output"] == 6463
    assert done["meter"]["costUsd"] == 0.5913


def test_summarize_marks_unpaired_and_refused_workers(tmp_path):
    s = fleet_events.summarize_events(fleet_events.read_events(
        _write_log(tmp_path / "run-run-30")))
    by_label = {w["label"]: w for w in s["workers"]}
    # started, never ended — the run was cut off mid-wave
    assert by_label["impl:2"]["endId"] is None
    assert by_label["impl:2"]["wallSec"] is None
    assert s["unpaired"] == ["impl:2"]
    # refused before it ever started
    assert by_label["impl:3"]["refused"] == "budget-already-tripped"
    assert by_label["impl:3"]["startId"] is None


def test_summarize_terminal_and_ack_decision(tmp_path):
    s = fleet_events.summarize_events(fleet_events.read_events(
        _write_log(tmp_path / "run-run-30")))
    assert s["ackDecision"]["approve"] is False
    assert s["ackDecision"]["reason"] == "non-pre-authorized ack(s): deferred:manual"
    assert s["terminal"]["kind"] == "driver:fail"
    assert s["terminal"]["verdict"] == "needs-ack"


def test_summarize_terminal_on_an_approved_run(tmp_path):
    events = EVENTS[:9] + [
        _ev(20, 90000, kind="driver:approved", stamp="run-30",
            integrationBranch="ultra/integration-run-30")]
    s = fleet_events.summarize_events(fleet_events.read_events(
        _write_log(tmp_path / "run-run-30", events)))
    assert s["terminal"]["kind"] == "driver:approved"
    assert s["terminal"]["integrationBranch"] == "ultra/integration-run-30"
    assert s["ackDecision"] is None


def test_summarize_empty_log_is_advisory_not_fatal():
    s = fleet_events.summarize_events([])
    assert s["runId"] is None
    assert s["workers"] == []
    assert s["wallSec"] is None
    assert s["terminal"] is None


def test_render_timeline_line_shape(tmp_path):
    md = fleet_events.render_timeline(fleet_events.read_events(
        _write_log(tmp_path / "run-run-30")))
    lines = md.splitlines()
    assert lines[0] == "01AAA001  +0.0s  run:open  runId=run-30"
    assert lines[3] == "01AAA004  +2.0s  engine:phase  Setup"
    assert "01AAA007  +3.0s  worker:start  impl:1 role=implementer model=opus" in md
    assert "01AAA012  +80.0s  driver:fail  needs-ack — non-pre-authorized" in md
    assert len(lines) == 12


def test_render_timeline_caps_a_long_summary(tmp_path):
    long_line = "x" * 500
    run_dir = _write_log(tmp_path / "run-run-30",
                         [EVENTS[0], _ev(9, 10, kind="engine:log", line=long_line)])
    md = fleet_events.render_timeline(fleet_events.read_events(run_dir))
    tail = md.splitlines()[1]
    assert tail.endswith("…")
    assert len(tail) < 260


def test_render_timeline_renders_an_unknown_kind(tmp_path):
    run_dir = _write_log(tmp_path / "run-run-30",
                         [EVENTS[0], _ev(9, 10, kind="worker:teleported", label="x")])
    md = fleet_events.render_timeline(fleet_events.read_events(run_dir))
    assert "worker:teleported" in md
    assert '"label": "x"' in md or "label=x" in md


def test_event_kinds_matches_the_engine_vocabulary():
    assert fleet_events.EVENT_KINDS == frozenset({
        "run:open", "engine:log", "engine:phase", "worker:start", "worker:end",
        "worker:refused", "run:fatal", "capture:error", "driver:stage",
        "driver:fail", "driver:auth", "driver:ack-decision", "driver:approved"})

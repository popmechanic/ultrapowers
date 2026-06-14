# evals/scripts/tests/test_report.py
import json
import pathlib
import sys

SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import report  # noqa: E402


def test_engine_key_unknown_when_missing():
    assert report.engine_key({}) == "unknown"
    assert report.engine_key(
        {"engine": {"plugin_version": "0.0.9", "sha": "abcdef1234"}}
    ) == "0.0.9@abcdef1"


def test_coverage_none_when_unplanned():
    assert report.coverage({}) is None
    assert report.coverage({"tasks_planned": 6, "tasks_merged": 3}) == 0.5


def test_green_but_incomplete_flag():
    green_incomplete = {"suite": {"failed": 0, "errors": 0},
                        "tasks_planned": 6, "tasks_merged": 3}
    green_complete = {"suite": {"failed": 0, "errors": 0},
                      "tasks_planned": 6, "tasks_merged": 6}
    red_incomplete = {"suite": {"failed": 2, "errors": 0},
                      "tasks_planned": 6, "tasks_merged": 3}
    assert report.green_but_incomplete([green_complete, green_incomplete]) is True
    assert report.green_but_incomplete([green_complete]) is False
    assert report.green_but_incomplete([red_incomplete]) is False


def _row(**kw):
    base = {"run_id": "x", "fixture": "mixed", "condition": "B", "rep": 1,
            "cost_usd": 7.0, "weekly_pct": None, "wall_clock_s": 600.0,
            "suite": {"passed": 58, "failed": 0, "errors": 0, "total": 58},
            "acceptance": {"passed": 7, "failed": 0, "errors": 0, "total": 7},
            "fix_rounds": 0, "blocked_tasks": 0,
            "tasks_planned": 6, "tasks_merged": 6,
            "engine": {"plugin_version": "0.0.10", "sha": "b" * 40}}
    base.update(kw)
    return base


def test_main_adds_coverage_flags_and_splits_engines(tmp_path, monkeypatch, capsys):
    rows = [
        _row(run_id="mixed-B-1", rep=1, tasks_merged=3, blocked_tasks=3,
             acceptance={"passed": 3, "failed": 4, "errors": 0, "total": 7},
             engine={"plugin_version": "0.0.9", "sha": "a" * 40}),
        _row(run_id="mixed-B-2", rep=2, tasks_merged=6,
             engine={"plugin_version": "0.0.10", "sha": "b" * 40}),
    ]
    (tmp_path / "runs.jsonl").write_text(
        "".join(json.dumps(r) + "\n" for r in rows))
    monkeypatch.setattr(report, "RESULTS", tmp_path)
    report.main()
    out = capsys.readouterr().out
    assert "coverage (med)" in out
    assert "⚠" in out                       # green-but-incomplete 0.0.9 row
    assert "0.0.9@aaaaaaa" in out                # two engines, not pooled
    assert "0.0.10@bbbbbbb" in out

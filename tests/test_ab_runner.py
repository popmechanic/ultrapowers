# tests/test_ab_runner.py
"""ab_runner: run-plan assembly and harvest logic. Never invokes claude."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "evals"))
import ab_runner


def test_build_run_plan_shape():
    plan = ab_runner.build_run_plan("8a030f4", "A", "wide", ROOT)
    assert plan["fixture"] == "wide"
    assert plan["engine"] == "A"
    assert plan["engineRef"] == "8a030f4"
    assert plan["planPath"].endswith("plan.md")
    assert plan["diffPath"].endswith("evals/results/diffs/wide-A.diff")
    # The wide fixture ships sealed exams — the plan must include vault installs.
    assert plan["sealInstalls"], "wide fixture acceptance/ dirs must be installed"


def test_build_run_plan_unknown_fixture():
    try:
        ab_runner.build_run_plan("8a030f4", "A", "nope", ROOT)
        assert False, "should raise"
    except SystemExit:
        pass


def test_harvest_row(tmp_path):
    t = tmp_path / "transcript.jsonl"
    t.write_text(
        json.dumps({"type": "assistant", "usage": {"output_tokens": 120}}) + "\n" +
        json.dumps({"type": "assistant", "usage": {"output_tokens": 30}}) + "\n")
    row = ab_runner.harvest_row(t, "2026-07-10T00:00:00Z", 61.5)
    assert row["outputTokens"] == 150
    assert row["wallClockSec"] == 61.5
    assert row["rerunOf"] is None


def test_dry_run_writes_nothing(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv",
        ["ab_runner.py", "--engine-ref", "8a030f4", "--engine-label", "A",
         "--fixture", "wide", "--dry-run"])
    ab_runner.main()
    out = capsys.readouterr().out
    plan = json.loads(out)          # dry-run prints the run plan JSON and exits
    assert plan["fixture"] == "wide" and plan["engineRef"] == "8a030f4"
    assert "startedAt" not in plan  # a plan, not an executed-run row

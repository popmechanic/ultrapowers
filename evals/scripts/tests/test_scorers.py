# evals/scripts/tests/test_scorers.py
import pathlib
import sys

SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import autoscore  # noqa: E402
import score_run  # noqa: E402


def test_parse_counters_extracts_planned_merged_blocked_fixes():
    flat = ('prefix "fixIterations": 2 noise "integrationBranch": "x" '
            '"status": "MERGED" "status": "done" "status": "blocked"')
    c = autoscore.parse_counters(flat)
    assert c["planned"] == 3
    assert c["merged"] == 2
    assert c["blocked"] == 1
    assert c["fixes"] == 2


def test_parse_counters_returns_none_on_echo_without_tasks():
    assert autoscore.parse_counters("no task entries here") is None


def test_assemble_row_carries_engine_and_coverage_fields():
    row = score_run.assemble_row(
        run_id="mixed-B-9", fixture="mixed", condition="B", rep=9,
        head="f" * 40, cost_usd=7.0,
        weekly_pct_before=None, weekly_pct_after=None, wall=600.0,
        suite={"passed": 58, "failed": 0, "errors": 0, "total": 58},
        acceptance={"passed": 3, "failed": 4, "errors": 0, "total": 7},
        fix_rounds=0, blocked_tasks=3, redirects=0, notes="t",
        engine={"plugin_version": "0.0.10", "sha": "a" * 40},
        tasks_planned=6, tasks_merged=3, scored_epoch=123.0)
    assert row["engine"] == {"plugin_version": "0.0.10", "sha": "a" * 40}
    assert row["tasks_planned"] == 6 and row["tasks_merged"] == 3
    assert row["weekly_pct"] is None


def test_assemble_row_computes_weekly_pct_delta():
    row = score_run.assemble_row(
        run_id="x", fixture="wide", condition="B", rep=1, head="0" * 40,
        cost_usd=1.0, weekly_pct_before=2.0, weekly_pct_after=3.5, wall=1.0,
        suite={"passed": 1, "failed": 0, "errors": 0, "total": 1},
        acceptance={"passed": 1, "failed": 0, "errors": 0, "total": 1},
        fix_rounds=0, blocked_tasks=0, redirects=0, notes="",
        engine={"plugin_version": "0.0.10", "sha": "a" * 40},
        tasks_planned=6, tasks_merged=6, scored_epoch=1.0)
    assert row["weekly_pct"] == 1.5


def test_reliability_counters_reads_a_fixture_transcript(tmp_path):
    projects = tmp_path / "projects"
    proj = projects / "myproj-eval-runs-wide-B-1"
    proj.mkdir(parents=True)
    # a workflow-result line as it appears in a real transcript: JSON-in-JSON,
    # so the inner quotes are backslash-escaped (reliability_counters de-escapes).
    line = ('prefix fixIterations\\": 1 integrationBranch\\": \\"ultra\\" '
            '\\"status\\": \\"MERGED\\" \\"status\\": \\"done\\" '
            '\\"status\\": \\"blocked\\"')
    (proj / "transcript.jsonl").write_text(line + "\n")
    counters, note = autoscore.reliability_counters(
        tmp_path / "wide-B-1", projects_dir=projects)
    assert note == ""
    assert counters == {"fixes": 1, "blocked": 1, "planned": 3, "merged": 2}


def test_reliability_counters_missing_transcript_returns_none(tmp_path):
    projects = tmp_path / "projects"
    projects.mkdir()
    counters, note = autoscore.reliability_counters(
        tmp_path / "wide-B-1", projects_dir=projects)
    assert counters is None and "not found" in note

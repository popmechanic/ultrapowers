"""Eval runner: fixture + synthetic tracks, JSON cases, roll-up report."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "evals" / "frontier"))
import run_eval


def test_fixture_cases_cover_all_plan_fixtures():
    cases = run_eval.fixture_cases(seed=42)
    names = {c["name"] for c in cases}
    assert names == {"wide", "chained", "mixed", "flawed", "degrade", "webapp"}


def test_synthetic_cases_shape():
    cases = run_eval.synthetic_cases()
    names = [c["name"] for c in cases]
    assert "delete-vs-modify" in names and "four-way-fanin" in names
    for c in cases:
        assert c["base"] is not None and len(c["tasks"]) >= 2


def test_run_tracks_a_b_writes_cases_and_rollup(tmp_path):
    summary = run_eval.run_tracks(["a", "b"], tmp_path, seed=42)
    files = sorted(p.name for p in tmp_path.glob("*.json"))
    assert any(f.startswith("a-wide") for f in files)
    assert any(f.startswith("b-delete-vs-modify") for f in files)
    rollup = (tmp_path / "rollup.md").read_text()
    assert "## Makespans (track a)" in rollup
    assert "## K-gate summary" in rollup
    assert "not evaluated (track c not run)" in rollup
    assert "## Track (b) narrations (S3" in rollup
    assert "## Exclusions" in rollup
    # b-track expectations enforced
    dvm = json.loads((tmp_path / "b-delete-vs-modify.json").read_text())
    assert any(c["kind"] == "delete/modify" for c in dvm["conflicts"])
    assert summary["k_gates"]["K1"] is True
    assert summary["k_gates"]["K4_no_interleaving"] is True


def test_track_a_case_records_makespans_and_k1(tmp_path):
    run_eval.run_tracks(["a"], tmp_path, seed=42)
    wide = json.loads((tmp_path / "a-wide.json").read_text())
    ms = wide["makespans"]
    assert ms["durations_modeled"] is True
    assert ms["frontier"] <= ms["waves"]
    assert ms["frontier_no_same_file"] <= ms["frontier"] + 1e-9
    assert wide["folds"]["k1_identical"] is True
    assert wide["folds"]["orders_sampled"] >= 2


def test_disjoint_functions_clean_adjacent_conflicts(tmp_path):
    run_eval.run_tracks(["b"], tmp_path, seed=42)
    clean = json.loads((tmp_path / "b-disjoint-functions.json").read_text())
    assert clean["conflicts"] == []
    adj = json.loads((tmp_path / "b-adjacent-lines.json").read_text())
    assert len(adj["conflicts"]) >= 1

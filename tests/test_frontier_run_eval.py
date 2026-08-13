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
    assert names == {"wide", "chained", "mixed", "flawed", "degrade", "webapp",
                     "contend"}


def test_contend_fixture_carries_genuine_same_file_contention():
    """The contend fixture exists to populate S1's same-file column: three
    tasks genuinely write one file, serialized only by inferred
    write-after-write edges (no Depends-on markers), and the plan still
    compiles parallel. Serializing it with markers would defeat the fixture."""
    compiled = run_eval.compile_fixture("contend")
    assert compiled["mode"] == "parallel"
    waw = [e for e in compiled["dag_edges"] if e["why"] == "write-after-write"]
    assert len(waw) >= 2
    case = run_eval.build_fixture_case("contend", compiled, seed=42)
    assert case["contiguity_paths"] == ["clitool/cli.py"]
    writers = [t for t in case["tasks"] if "clitool/cli.py" in t.weaves]
    assert len(writers) == 3


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


def test_k4_not_evaluated_when_no_contiguity_checks(tmp_path, monkeypatch):
    # Every track (b) scenario except four-way-fanin carries an empty
    # contiguity_paths, so dropping that one case produces zero non-None
    # no_interleaving records — the exact "no contiguity checks in this run"
    # condition the K4 false-green guard exists for.
    real_synthetic_cases = run_eval.synthetic_cases

    def no_fanin_cases():
        return [c for c in real_synthetic_cases() if c["name"] != "four-way-fanin"]

    monkeypatch.setattr(run_eval, "synthetic_cases", no_fanin_cases)
    summary = run_eval.run_tracks(["b"], tmp_path, seed=42)
    assert summary["k_gates"]["K4_no_interleaving"] is None
    assert summary["k_gates"]["K4_no_interleaving"] is not True
    rollup = (tmp_path / "rollup.md").read_text()
    k4_line = next(line for line in rollup.splitlines() if line.startswith("- K4"))
    assert "not evaluated" in k4_line
    assert "PASS" not in k4_line


def _some_wave_has_two_tasks_with_intersecting_files(waves):
    """True if any wave holds two tasks whose declared `files` intersect —
    the shape `--overlap fold` is supposed to produce: a same-file pair
    keeps no serializing edge and instead shares a wave."""
    for wave in waves:
        for i, t1 in enumerate(wave):
            for t2 in wave[i + 1:]:
                if set(t1["files"]) & set(t2["files"]):
                    return True
    return False


def test_contend_fixture_contention_under_both_compiles():
    ser = run_eval.compile_fixture("contend")                       # now --overlap serialize
    waw = [e for e in ser["dag_edges"] if e["why"] == "write-after-write"]
    assert ser["mode"] == "parallel" and len(waw) >= 2
    fold = run_eval.compile_fixture("contend", overlap="fold")      # new kwarg
    assert not [e for e in fold["dag_edges"] if e["why"] == "write-after-write"]
    assert _some_wave_has_two_tasks_with_intersecting_files(fold["launch_waves"])


def test_k3_line_labels_real_run_fidelity_not_bisection(tmp_path):
    run_eval.run_tracks(["a", "b"], tmp_path, seed=42)
    rollup = (tmp_path / "rollup.md").read_text()
    k3_line = next(line for line in rollup.splitlines() if line.startswith("- K3"))
    assert "real-run fidelity" in k3_line
    assert "bisection" not in k3_line

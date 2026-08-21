# tests/test_ab_arm_identity.py
"""ab_runner: frontier-mode arm dimension (Task 12).

`assert_arm_identity` is a pure function over a hand-built receipt dict (the
shape ultra_run.py's receipt.json takes, carrying the full `compile` object)
plus a run dir on disk for the fold arm's route-away check — never invokes
claude, never touches a real compile_plan.py run."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "evals"))
import ab_runner


def _receipt(run_dir, dag_edges, launch_waves):
    return {"launchFile": str(run_dir / "launch.json"),
            "compile": {"dag_edges": dag_edges, "launch_waves": launch_waves}}


CONTENDED_WAVE = [
    {"id": "t1", "files": ["a.py"]},
    {"id": "t2", "files": ["a.py", "b.py"]},
]
DISJOINT_WAVES = [
    [{"id": "t1", "files": ["a.py"]}],
    [{"id": "t2", "files": ["b.py"]}],
]
WAW_EDGES = [
    {"from": "t1", "to": "t2", "why": "write-after-write"},
    {"from": "t1", "to": "t3", "why": "write-after-write"},
]


# --------------------------------------------------------------------------- #
# serialize arm                                                               #
# --------------------------------------------------------------------------- #
def test_serialize_pass_two_or_more_write_after_write_edges(tmp_path):
    receipt = _receipt(tmp_path / "run-1", WAW_EDGES, DISJOINT_WAVES)
    ok, detail = ab_runner.assert_arm_identity(receipt, "serialize")
    assert ok is True
    assert "2 write-after-write" in detail


def test_serialize_fail_edges_dropped(tmp_path):
    # fold-shaped compile output fed to the serialize check: the tier-3 loop
    # dropped the write-after-write edges instead of creating them.
    receipt = _receipt(tmp_path / "run-2", [], [CONTENDED_WAVE])
    ok, detail = ab_runner.assert_arm_identity(receipt, "serialize")
    assert ok is False
    assert detail == "serialize: expected >=2 write-after-write dag_edges, found 0"


def test_serialize_fail_only_one_edge(tmp_path):
    receipt = _receipt(tmp_path / "run-2b", WAW_EDGES[:1], DISJOINT_WAVES)
    ok, detail = ab_runner.assert_arm_identity(receipt, "serialize")
    assert ok is False
    assert "found 1" in detail


# --------------------------------------------------------------------------- #
# fold arm                                                                     #
# --------------------------------------------------------------------------- #
def test_fold_pass_zero_edges_contended_wave_and_frontier_dir_present(tmp_path):
    run_dir = tmp_path / "run-3"
    (run_dir / "frontier" / "wave-1").mkdir(parents=True)
    receipt = _receipt(run_dir, [], [CONTENDED_WAVE])
    ok, detail = ab_runner.assert_arm_identity(receipt, "fold")
    assert ok is True
    assert "1 contended" in detail


def test_fold_fail_write_after_write_edges_present(tmp_path):
    run_dir = tmp_path / "run-4"
    (run_dir / "frontier" / "wave-1").mkdir(parents=True)
    receipt = _receipt(run_dir, WAW_EDGES, [CONTENDED_WAVE])
    ok, detail = ab_runner.assert_arm_identity(receipt, "fold")
    assert ok is False
    assert "2 write-after-write dag_edges present" in detail


def test_fold_fail_route_away_missing_frontier_dir(tmp_path):
    # zero write-after-write edges, a genuinely contended-shaped wave — but
    # the run-dir side never materialized frontier/wave-1/.
    run_dir = tmp_path / "run-5"  # deliberately NOT created
    receipt = _receipt(run_dir, [], [CONTENDED_WAVE])
    ok, detail = ab_runner.assert_arm_identity(receipt, "fold")
    assert ok is False
    assert "frontier/wave-<n>/ missing" in detail
    assert "1" in detail


def test_fold_fail_no_contended_wave(tmp_path):
    run_dir = tmp_path / "run-6"
    receipt = _receipt(run_dir, [], DISJOINT_WAVES)
    ok, detail = ab_runner.assert_arm_identity(receipt, "fold")
    assert ok is False
    assert "no launch_waves wave" in detail


def test_fold_route_away_checks_every_contended_wave(tmp_path):
    # two contended-shaped waves; only wave-1's frontier dir materializes.
    run_dir = tmp_path / "run-7"
    (run_dir / "frontier" / "wave-1").mkdir(parents=True)
    receipt = _receipt(run_dir, [], [CONTENDED_WAVE, CONTENDED_WAVE])
    ok, detail = ab_runner.assert_arm_identity(receipt, "fold")
    assert ok is False
    assert "wave(s) 2" in detail


def test_fold_fail_non_kept_edge_label_present(tmp_path):
    # zero write-after-write edges, a genuinely contended-shaped wave, the
    # route-away dir present — but a dag_edges entry carries a `why` outside
    # the kept vocabulary (marker/text/interface/write-after-create).
    run_dir = tmp_path / "run-11"
    (run_dir / "frontier" / "wave-1").mkdir(parents=True)
    dag_edges = [{"from": "t1", "to": "t2", "why": "prose-reference"}]
    receipt = _receipt(run_dir, dag_edges, [CONTENDED_WAVE])
    ok, detail = ab_runner.assert_arm_identity(receipt, "fold")
    assert ok is False
    assert "non-kept" in detail


def test_fold_pass_kept_labels_only(tmp_path):
    run_dir = tmp_path / "run-12"
    (run_dir / "frontier" / "wave-1").mkdir(parents=True)
    dag_edges = [{"from": "t1", "to": "t2", "why": "marker"},
                 {"from": "t1", "to": "t3", "why": "interface"}]
    receipt = _receipt(run_dir, dag_edges, [CONTENDED_WAVE])
    ok, detail = ab_runner.assert_arm_identity(receipt, "fold")
    assert ok is True


def test_unknown_arm_overlap_fails_closed(tmp_path):
    receipt = _receipt(tmp_path / "run-8", [], [])
    ok, detail = ab_runner.assert_arm_identity(receipt, "bogus")
    assert ok is False
    assert "unknown arm_overlap" in detail


# --------------------------------------------------------------------------- #
# row tagging — a failed identity still appends its row (never dropped)       #
# --------------------------------------------------------------------------- #
def test_tag_identity_keeps_the_row_on_failure_and_marks_invalid(tmp_path):
    row = {"fixture": "contend"}
    receipt = _receipt(tmp_path / "run-9", [], [])  # no waves -> fold fails
    out = ab_runner._tag_identity(row, receipt, "fold")
    assert out is row  # in-place, never replaced/dropped
    assert out["armOverlap"] == "fold"
    assert "identity" in out
    assert out["invalid"] == "arm-identity: %s" % out["identity"]


def test_tag_identity_no_invalid_key_on_success(tmp_path):
    run_dir = tmp_path / "run-10"
    receipt = _receipt(run_dir, WAW_EDGES, DISJOINT_WAVES)
    out = ab_runner._tag_identity({}, receipt, "serialize")
    assert out["armOverlap"] == "serialize"
    assert "invalid" not in out


def test_read_run_receipt_finds_launch_receipt_under_run_dir(tmp_path):
    run_dir = tmp_path / ".claude/ultrapowers/run-abc"
    run_dir.mkdir(parents=True)
    payload = {"compile": {"dag_edges": []}, "launchFile": str(run_dir / "launch.json")}
    (run_dir / "receipt.json").write_text(json.dumps(payload))
    got = ab_runner._read_run_receipt(tmp_path)
    assert got == payload


def test_read_run_receipt_missing_returns_empty_dict(tmp_path):
    assert ab_runner._read_run_receipt(tmp_path) == {}


# --------------------------------------------------------------------------- #
# flag threading — build_run_plan / DRIVE_PROMPT / CLI                        #
# --------------------------------------------------------------------------- #
def test_build_run_plan_default_arm_overlap_is_serialize():
    plan = ab_runner.build_run_plan("8a030f4", "A", "wide", ROOT)
    assert plan["armOverlap"] == "serialize"


def test_build_run_plan_carries_explicit_arm_overlap():
    plan = ab_runner.build_run_plan("8a030f4", "A", "wide", ROOT, "fold")
    assert plan["armOverlap"] == "fold"


def test_drive_prompt_launch_line_gains_overlap_token():
    rendered = ab_runner.DRIVE_PROMPT.format(plan="docs/plans/plan.md", overlap="fold")
    first_line = rendered.splitlines()[0]
    assert first_line == "/ultrapowers docs/plans/plan.md overlap=fold"


def test_dry_run_plan_carries_arm_overlap_flag(monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv",
        ["ab_runner.py", "--engine-ref", "8a030f4", "--engine-label", "A",
         "--fixture", "wide", "--arm-overlap", "fold", "--dry-run"])
    ab_runner.main()
    out = capsys.readouterr().out
    plan = json.loads(out)
    assert plan["armOverlap"] == "fold"


def test_dry_run_plan_defaults_arm_overlap_when_flag_omitted(monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv",
        ["ab_runner.py", "--engine-ref", "8a030f4", "--engine-label", "A",
         "--fixture", "wide", "--dry-run"])
    ab_runner.main()
    out = capsys.readouterr().out
    plan = json.loads(out)
    assert plan["armOverlap"] == "serialize"

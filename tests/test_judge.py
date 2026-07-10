"""judge: blind assembly and key handling. Never invokes claude."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "evals"))
import judge


def _fake_results(tmp_path):
    d = tmp_path / "evals/results/diffs"; d.mkdir(parents=True)
    (d / "wide-A.diff").write_text("diff A content")
    (d / "wide-B.diff").write_text("diff B content")
    f = tmp_path / "evals/fixtures/wide"; f.mkdir(parents=True)
    (f / "plan.md").write_text("# plan")
    return tmp_path


def test_blinding_key_is_random_but_recorded(tmp_path):
    root = _fake_results(tmp_path)
    seen = {judge.assemble_blind_input("wide", root, seed)["key"]["X"]
            for seed in range(20)}
    assert seen == {"A", "B"}  # both assignments occur across seeds


def test_prompt_carries_both_diffs_unlabeled(tmp_path):
    root = _fake_results(tmp_path)
    out = judge.assemble_blind_input("wide", root, seed=1)
    assert "diff A content" in out["prompt"] and "diff B content" in out["prompt"]
    # The engine labels must not leak into the prompt:
    assert "wide-A.diff" not in out["prompt"] and "wide-B.diff" not in out["prompt"]
    assert "engine" not in out["prompt"].lower()


def test_key_round_trip(tmp_path):
    root = _fake_results(tmp_path)
    out = judge.assemble_blind_input("wide", root, seed=7)
    x, y = out["key"]["X"], out["key"]["Y"]
    assert {x, y} == {"A", "B"}

"""Validates the planning-eval fixtures and their wiring to the wave scorers.
No model calls: the scorers are pure, so we run them on recorded example
outputs to prove the fixture + scorer contract holds."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "evals" / "planning-fixtures"

_SPEC = importlib.util.spec_from_file_location(
    "run_micro", ROOT / "evals" / "scripts" / "run-micro.py")
run_micro = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(run_micro)

REGIMES = {"latent", "contract", "linear"}


def test_samples_have_spec_regime_and_positive_ground_truth():
    samples = json.loads((FIX / "samples.json").read_text())
    assert samples, "no samples"
    for s in samples:
        assert isinstance(s.get("spec"), str) and s["spec"].strip()
        assert s.get("_regime") in REGIMES
        assert isinstance(s.get("_ground_truth_width"), int) and s["_ground_truth_width"] >= 1


def test_linear_traps_have_ground_truth_width_one():
    samples = json.loads((FIX / "samples.json").read_text())
    linear = [s for s in samples if s["_regime"] == "linear"]
    assert linear, "need at least one linear trap"
    assert all(s["_ground_truth_width"] == 1 for s in linear)


def test_variants_define_current_and_shaped():
    variants = json.loads((FIX / "variants.json").read_text())
    names = {v["name"] for v in variants}
    assert {"ultraplan-current", "ultraplan-shaped"} <= names
    for v in variants:
        assert v["instruction"].strip()
    fmt = "`Task <id>: deps=<comma-separated task ids, or none>`. No prose."
    inst = {v["name"]: v["instruction"] for v in variants}
    assert inst["ultraplan-current"].endswith(fmt)
    assert inst["ultraplan-shaped"].endswith(fmt)


def test_scorers_reward_revelation_and_flag_manufacturing():
    # A latent spec with ground-truth width 3.
    sample = {"spec": "x", "_regime": "latent", "_ground_truth_width": 3}
    narrow = "Task 1: deps=none\nTask 2: deps=1\nTask 3: deps=2"       # width 1
    revealed = "Task 1: deps=none\nTask 2: deps=none\nTask 3: deps=none"  # width 3
    manufactured = ("Task 1: deps=none\nTask 2: deps=none\n"
                    "Task 3: deps=none\nTask 4: deps=none")            # width 4
    ww = run_micro.SCORERS["wave_width"]
    wo = run_micro.SCORERS["wave_overshoot"]
    assert ww(revealed, sample) > ww(narrow, sample)        # shaping widens
    assert wo(revealed, sample) == 0.0                      # honest revelation
    assert wo(manufactured, sample) == 1.0                  # over-shoot is caught

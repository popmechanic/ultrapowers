"""Offline unit tests for the micro-test loop (evals/scripts/run-micro.py).

The live model call is injected, so these tests never touch the network or an
API key: we drive run_variant with a fake call_model and assert on the pure
scorer registry and the mean/variance aggregation."""
import importlib.util
from pathlib import Path

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "run_micro",
    Path(__file__).resolve().parents[1] / "evals" / "scripts" / "run-micro.py",
)
run_micro = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(run_micro)


def test_scorer_registry_contains_known_scorers():
    assert "json_object" in run_micro.SCORERS
    assert "nonempty" in run_micro.SCORERS


def test_json_object_scorer_scores_shape_not_content():
    score = run_micro.SCORERS["json_object"]
    assert score('{"ok": true}', sample={}) == 1.0
    assert score("here is your json: {}", sample={}) == 0.0
    assert score("", sample={}) == 0.0


def test_nonempty_scorer():
    score = run_micro.SCORERS["nonempty"]
    assert score("x", sample={}) == 1.0
    assert score("   ", sample={}) == 0.0


def test_aggregate_reports_mean_and_variance():
    agg = run_micro.aggregate([1.0, 1.0, 1.0])
    assert agg["mean"] == 1.0
    assert agg["variance"] == 0.0
    assert agg["n"] == 3
    agg = run_micro.aggregate([0.0, 1.0])
    assert agg["mean"] == 0.5
    assert agg["variance"] == pytest.approx(0.25)


def test_aggregate_empty_is_safe():
    agg = run_micro.aggregate([])
    assert agg["n"] == 0
    assert agg["mean"] == 0.0
    assert agg["variance"] == 0.0


def test_run_variant_uses_injected_call_model_offline():
    calls = []

    def fake_call_model(prompt):
        calls.append(prompt)
        return '{"answer": 42}'

    result = run_micro.run_variant(
        name="recipe",
        instruction="Return a JSON object.",
        samples=[{"task": "a"}, {"task": "b"}, {"task": "c"}],
        scorer="json_object",
        call_model=fake_call_model,
    )
    assert len(calls) == 3
    assert result["name"] == "recipe"
    assert result["n"] == 3
    assert result["mean"] == 1.0
    assert result["variance"] == 0.0


def test_run_suite_always_includes_no_guidance_control():
    def fake_call_model(prompt):
        return '{}'

    report = run_micro.run_suite(
        variants=[{"name": "recipe", "instruction": "Return a JSON object."}],
        samples=[{"task": "a"}],
        scorer="json_object",
        call_model=fake_call_model,
    )
    names = [v["name"] for v in report["variants"]]
    assert run_micro.CONTROL_NAME in names
    assert "recipe" in names


def test_parse_markers_reads_task_dependency_lines():
    text = "Task 1: deps=none\nTask 2: deps=1\nTask 3: deps=1, 2\nnoise line\n"
    dag = run_micro._parse_markers(text)
    assert dag == {"1": [], "2": ["1"], "3": ["1", "2"]}


def test_max_wave_width_linear_chain_is_one():
    dag = {"1": [], "2": ["1"], "3": ["2"]}
    assert run_micro._max_wave_width(dag) == 1


def test_max_wave_width_all_independent_is_n():
    dag = {"1": [], "2": [], "3": [], "4": []}
    assert run_micro._max_wave_width(dag) == 4


def test_max_wave_width_diamond():
    # 1 -> {2,3} -> 4 : widest wave is {2,3} = 2
    dag = {"1": [], "2": ["1"], "3": ["1"], "4": ["2", "3"]}
    assert run_micro._max_wave_width(dag) == 2


def test_wave_width_scorer_returns_width():
    out = "Task 1: deps=none\nTask 2: deps=none\nTask 3: deps=1"
    assert run_micro.SCORERS["wave_width"](out, sample={}) == 2.0


def test_wave_overshoot_is_zero_when_within_ground_truth():
    out = "Task 1: deps=none\nTask 2: deps=none"  # width 2
    assert run_micro.SCORERS["wave_overshoot"](out, {"_ground_truth_width": 2}) == 0.0
    assert run_micro.SCORERS["wave_overshoot"](out, {"_ground_truth_width": 4}) == 0.0


def test_wave_overshoot_flags_manufactured_width():
    out = "Task 1: deps=none\nTask 2: deps=none\nTask 3: deps=none"  # width 3
    # linear-trap ground truth is 1 → 2 units of manufactured breadth
    assert run_micro.SCORERS["wave_overshoot"](out, {"_ground_truth_width": 1}) == 2.0


def test_compose_prompt_hides_underscore_metadata_from_model():
    prompt = run_micro.compose_prompt("Decompose:", {"spec": "do X", "_ground_truth_width": 3})
    assert "do X" in prompt
    assert "_ground_truth_width" not in prompt
    assert "3" not in prompt

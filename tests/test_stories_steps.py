"""A story's recorded steps: the one-line-per-step text export and its checks."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills/ultrawrite/stories"))
import steps  # noqa: E402

E = [{}, {}]
ONE = [{"todos": {"0": {"text": "Buy \"milk\" ☕"}}}, {}]


def row(step, before, after, **kw):
    r = {"story": "S1", "step": step, "piece": "todo", "tool": "addTodo",
         "args": {"text": "Buy \"milk\" ☕"}, "layer": "store", "ui": None,
         "before": before, "after": after}
    r.update(kw)
    return r


def test_round_trip_keeps_quotes_and_unicode(tmp_path):  # Review Focus 2
    p = tmp_path / "steps.jsonl"
    rows = [row(1, E, ONE)]
    steps.dump_steps(rows, p)
    assert steps.load_steps(p) == rows
    assert "☕" in p.read_text(encoding="utf-8")


def test_a_chained_story_validates():
    rows = [row(1, E, ONE), row(2, ONE, ONE, tool="addTodo", args={"text": ""})]
    assert steps.validate_story(rows) == []


def test_a_restart_mid_story_is_refused_in_plain_words():  # Review Focus 1
    rows = [row(1, E, ONE), row(2, E, ONE)]
    assert steps.validate_story(rows) == [
        "story S1: step 2 does not start where step 1 ended"]


def test_step_one_starts_from_the_empty_app():
    assert steps.validate_story([row(1, ONE, ONE)]) == [
        "story S1: step 1 must start from the empty app"]


def test_gaps_in_numbering_are_refused():
    errs = steps.validate_story([row(1, E, ONE), row(3, ONE, ONE)])
    assert errs == ["story S1: steps must be numbered 1..2 without gaps"]


def test_ui_steps_carry_a_list_of_gestures_and_store_steps_none():
    ok = row(1, E, ONE, layer="ui", ui=[{"type": {"role": "textbox", "name": "New todo", "text": "x"}},
                                        {"click": {"role": "button", "name": "Add"}}])
    assert steps.validate_step(ok) == []
    bad = row(1, E, ONE, layer="ui", ui={"click": {}})
    assert "step S1.1: a ui step needs ui = a list of click/type/key gestures" in steps.validate_step(bad)
    stray = row(1, E, ONE, ui=[{"click": {"role": "button", "name": "Add"}}])
    assert "step S1.1: only a ui step carries ui" in steps.validate_step(stray)


def test_content_must_be_tables_and_values():
    assert "step S1.1: after must be [tables, values]" in steps.validate_step(row(1, E, {"todos": {}}))


def test_stories_of_groups_and_sorts():
    rows = [row(2, ONE, ONE), row(1, E, ONE), dict(row(1, E, ONE), story="S2")]
    got = steps.stories_of(rows)
    assert list(got) == ["S1", "S2"] and [r["step"] for r in got["S1"]] == [1, 2]

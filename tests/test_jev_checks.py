"""Jev's authoring checks, with Jev faked: flags come from answers and policy."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills/ultrawrite/stories"))
import bundle  # noqa: E402
import jev_checks as jc  # noqa: E402

TODO = bundle.load_bundle(ROOT / "skills/ultrawrite/catalog/todo")


def fake(answers):
    calls = []

    def ask(state, questions):
        calls.append((state, sorted(questions)))
        return {k: {"noul": answers.get(k, 0.1)} for k in questions}
    return ask, calls


def test_a_clean_bundle_raises_no_flags():
    ask, calls = fake({"one_need": 0.9, "same_people": 0.9})
    flags, reads = jc.run_jev_checks(TODO, ask)
    assert flags == []
    assert reads == len(calls) == 1 + 1 + 3  # coherence, near-miss, one per action


def test_flags_name_the_piece_and_the_problem():
    ask, _ = fake({"one_need": 0.2, "same_people": 0.9, "story_passes_near_miss": 0.8, "branches_on_text": 0.7})
    flags, _ = jc.run_jev_checks(TODO, ask)
    assert "JEV flag: piece todo: its purpose reads as more than one need (one_need 0.20)" in flags
    assert ("JEV flag: piece todo: main story S2 does not rule out its near-miss "
            "(story_passes_near_miss 0.80)") in flags
    assert "JEV flag: piece todo: addTodo may act on the wording of typed text (branches_on_text 0.70)" in flags


def test_ambiguous_sentences_in_the_ask_are_flagged():
    ask, calls = fake({"two_apps": 0.7, "one_need": 0.9, "same_people": 0.9})
    flags, _ = jc.run_jev_checks(TODO, ask, ask_text="I want a todo list. Make it smart.")
    assert 'JEV flag: ambiguous: "Make it smart." (two_apps 0.70) — show both readings side by side' in flags
    assert calls[0][0] == {"ask": "I want a todo list. Make it smart.", "sentence": "I want a todo list."}


def test_an_unanswered_call_is_unread_not_a_flag():
    flags, reads = jc.run_jev_checks(TODO, lambda s, q: None)
    assert flags[0].startswith("JEV unread: piece todo coherence")
    assert reads == 5


def test_sentences_split_on_end_punctuation():
    assert jc.sentences("One. Two? Three!  Four") == ["One.", "Two?", "Three!", "Four"]


def test_default_ask_returns_none_on_missing_key(tmp_path, monkeypatch):
    monkeypatch.setenv("ULTRAPOWERS_HOME", str(tmp_path))
    result = jc.default_ask({"x": 1}, {})
    assert result is None

"""A signed page's bundle: loading it, and the code checks run before compile."""
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills/ultrawrite/stories"))
import bundle  # noqa: E402
import checks  # noqa: E402

TODO = ROOT / "skills/ultrawrite/catalog/todo"


def copy_todo(tmp_path):
    d = tmp_path / "b"
    shutil.copytree(TODO, d)
    return d


def edit_json(path, fn):
    data = json.loads(path.read_text())
    fn(data)
    path.write_text(json.dumps(data))


def test_the_catalog_todo_is_a_clean_bundle():
    b = bundle.load_bundle(TODO)
    assert len(b["store_sha256"]) == 64 and len(b["steps"]) == 6
    refusals, facts = checks.run_checks(b)
    assert refusals == []
    assert facts == [
        'CODE fact: piece todo: completeTodo refuses "a todo that does not exist" but no recorded step shows it',
        'CODE fact: piece todo: deleteTodo refuses "a todo that does not exist" but no recorded step shows it',
    ]


def test_a_behaviour_page_with_no_stories_is_refused(tmp_path):  # Review Focus 5
    d = copy_todo(tmp_path)
    edit_json(d / "page.json", lambda p: p.update(stories=[]))
    refusals, _ = checks.run_checks(bundle.load_bundle(d))
    assert "page: a behaviour plan needs at least one story" in refusals


def test_a_preserve_page_with_no_numbers_is_refused(tmp_path):  # Review Focus 5
    d = copy_todo(tmp_path)
    edit_json(d / "page.json", lambda p: p.update(kind="preserve"))
    refusals, _ = checks.run_checks(bundle.load_bundle(d))
    assert "page: a preserve plan needs at least one number" in refusals


def test_unknown_tool_story_without_steps_and_link_without_steps(tmp_path):
    d = copy_todo(tmp_path)
    edit_json(d / "page.json", lambda p: (p["stories"].append({"id": "S9", "sentence": "x"}),
                                          p["links"].append({"id": "L1", "sentence": "y", "pieces": ["todo"]})))
    lines = (d / "steps.jsonl").read_text().splitlines()
    lines[0] = lines[0].replace('"tool": "addTodo"', '"tool": "addThing"')
    (d / "steps.jsonl").write_text("\n".join(lines) + "\n")
    refusals, _ = checks.run_checks(bundle.load_bundle(d))
    assert "story S9 has no recorded steps" in refusals
    assert "link L1 has no recorded step" in refusals
    assert "step S1.1: tool addThing is no piece's action" in refusals


def test_a_main_story_not_on_the_page_is_refused(tmp_path):
    d = copy_todo(tmp_path)
    edit_json(d / "cards.json", lambda cs: cs[0].update(main_story="S7"))
    refusals, _ = checks.run_checks(bundle.load_bundle(d))
    assert "piece todo: its main story S7 is not on the page" in refusals


def test_a_cell_named_once_in_the_store_is_a_fact(tmp_path):
    d = copy_todo(tmp_path)
    edit_json(d / "cards.json", lambda cs: cs[0]["state"]["tables"]["todos"].append("dueDate"))
    _, facts = checks.run_checks(bundle.load_bundle(d))
    assert ("CODE fact: piece todo: todos.dueDate is named fewer than twice in the store "
            "module; no action may use it") in facts

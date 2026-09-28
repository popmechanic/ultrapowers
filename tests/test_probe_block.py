"""The stories-v1 probe grammar: one JSON object per ```probe fence, closed checks."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
import probe_block as pb  # noqa: E402

EMPTY = [{}, {}]
ONE = [{"todos": {"0": {"text": "buy milk"}}}, {}]
DONE = [{"todos": {"0": {"text": "buy milk", "completed": True}}}, {}]


def good():
    return {"clause": "S1.1", "layer": "store", "given": [],
            "do": [{"tool": "addTodo", "args": {"text": "buy milk"}}],
            "expect": [{"table": "todos", "row": "0", "cell": "text", "eq": "buy milk"}],
            "see": [], "judge": None, "holds_before": False}


def test_a_good_probe_validates():
    assert pb.validate_probe(good()) == []


def test_unknown_keys_and_bad_layer_are_named():
    p = good(); p["mutant"] = []; p["layer"] = "db"
    errs = pb.validate_probe(p)
    assert any("unknown keys mutant" in e for e in errs)
    assert any("layer must be store, ui or saved" in e for e in errs)


def test_a_ui_probe_does_click_type_key_and_a_store_probe_one_tool_call():
    p = good(); p["layer"] = "ui"
    assert any("click/type/key" in e for e in pb.validate_probe(p))
    p["do"] = [{"type": {"role": "textbox", "name": "New todo", "text": "x"}},
               {"click": {"role": "button", "name": "Add"}}]
    assert pb.validate_probe(p) == []
    q = good(); q["do"] = [{"click": {"role": "button", "name": "Add"}}]
    assert any("one {tool, args} call" in e for e in pb.validate_probe(q))


def test_an_open_check_is_refused():
    p = good(); p["expect"] = [{"table": "todos", "where": {"text": "x"}}]
    assert any("closed checks" in e for e in pb.validate_probe(p))


def test_parse_probe_text_reports_bad_json():
    p, errs = pb.parse_probe_text("{not json")
    assert p is None and errs and errs[0].startswith("probe: not JSON")






def test_tools_of_reads_given_and_tool_do():
    p = good(); p["given"] = [{"tool": "addTodo", "args": {"text": "a"}},
                              {"tool": "completeTodo", "args": {"id": "0"}}]
    assert pb.tools_of(p) == {"addTodo", "completeTodo"}

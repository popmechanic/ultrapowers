import json
import os
import shutil
import subprocess

import pytest

pytestmark = pytest.mark.skipif(shutil.which("bun") is None, reason="bun is not installed")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOL = os.path.join(ROOT, "skills/ultrawrite/stories/walk.ts")

BEFORE = """### Experience walk

a, r1. A report for the operator; it gates nothing.

| Question | Answer | Evidence |
|---|---|---|
| Is it obvious what to do first? | yes | e |
| Can everything the Claim names be done from the page? | yes | e |
| After each action, is what was saved visible on the page? | yes | e |
| Can a mistake be undone? | yes | e |
| Does the page show what to do next or what is missing? | yes | e |
| Does it look finished, not bare? | yes | e |"""


def run_walk(*args):
    r = subprocess.run(["bun", TOOL, *args], capture_output=True, text=True, timeout=30)
    return r.returncode, r.stdout.strip()


def walk(tmp_path, **extra):
    ids = [l.split(":")[0] for l in run_walk("questions")[1].splitlines()]
    w = {"app": "a", "run": "r1", "answers": {i: {"answer": "yes", "evidence": "e"} for i in ids}, **extra}
    path = str(tmp_path / "w.walk.json")
    with open(path, "w") as f:
        json.dump(w, f)
    return path


def render(path):
    code, out = run_walk("render", path)
    assert code == 0
    return out


def test_render_without_the_new_fields_is_unchanged(tmp_path):
    assert render(walk(tmp_path)) == BEFORE


def test_render_prints_the_two_lines(tmp_path):
    out = render(walk(tmp_path, script_bytes=528123, slots=["select-item", "button"]))
    assert out == BEFORE + "\n\nScript the page loads: 528,123 bytes.\nUI SDK slots on the page: 2 (button, select-item)."


def test_no_slots_reads_none(tmp_path):
    assert render(walk(tmp_path, slots=[])).splitlines()[-1] == "UI SDK slots on the page: none."


def test_a_bad_field_is_named(tmp_path):
    assert run_walk("render", walk(tmp_path, slots="button", script_bytes="big")) == (
        2, "walk: script_bytes must be a number of bytes\nwalk: slots must be a list of slot names")


@pytest.mark.parametrize("value", [-1, 1.5])
def test_script_bytes_must_be_a_whole_number_of_bytes(tmp_path, value):
    assert run_walk("render", walk(tmp_path, script_bytes=value)) == (2, "walk: script_bytes must be a number of bytes")


def test_slots_are_deduplicated_and_sorted(tmp_path):
    out = render(walk(tmp_path, slots=["tabs", "button", "tabs"]))
    assert out.splitlines()[-1] == "UI SDK slots on the page: 2 (button, tabs)."


@pytest.mark.parametrize("name", ["two words", "button\nselect-item", ""])
def test_a_slot_name_with_whitespace_is_a_problem(tmp_path, name):
    assert run_walk("render", walk(tmp_path, slots=["button", name])) == (2, "walk: slots must be a list of slot names")

"""Which piece a linked story's check goes to (skills/ultrawrite/stories/compile.ts, #1525).
Drives bun on the tracked todo-tags bundle with a fake store module."""
import json
import os
import shutil
import subprocess

import pytest

pytestmark = pytest.mark.skipif(shutil.which("bun") is None, reason="bun is not installed")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SCRIPT = """
import {loadBundle} from './skills/ultrawrite/stories/bundle';
import {probesOf} from './skills/ultrawrite/stories/compile';
import {runChecks} from './skills/ultrawrite/stories/checks';
const b = loadBundle('skills/ultrawrite/catalog/todo-tags');
b.page.stories = b.page.stories.filter((s) => ['S1', 'S4'].includes(s.id));
const card = (p) => b.cards.find((c) => c.piece === p);
EDIT;
let n = 0;
const run = () => { n += 1; return true; };
const mod = {
  TOOLS: ['addTodo', 'addTag', 'deleteTodo'].map((name) => ({name, run})),
  makeStore: () => ({getContent: () => [{t: {r: {n}}}, {}]}),
};
OUTPUT;
"""


def _bun(edit, output):
    script = SCRIPT.replace("EDIT", edit or "void 0").replace("OUTPUT", output)
    r = subprocess.run(["bun", "-e", script], cwd=ROOT, capture_output=True, text=True, timeout=20)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def pieces(edit=""):
    return _bun(edit, "console.log(JSON.stringify(Object.fromEntries(probesOf(b, mod).map(d => [d.probe.clause, d.piece]))))")


def checks(edit):
    return _bun(edit, "console.log(JSON.stringify(runChecks(b).refusals))")


def test_a_link_of_parallel_pieces_goes_to_the_tools_owner():
    assert pieces() == {"S1.1": "todo", "S4.3": "todo"}


def test_a_link_goes_to_the_piece_that_depends_on_the_other():
    assert pieces("card('tag').depends_on = ['todo']")["S4.3"] == "tag"


def test_a_link_goes_to_the_piece_that_depends_on_both_others():  # potluck's shape
    assert pieces("b.cards.push({piece: 'board', depends_on: ['todo', 'tag'], actions: []}); "
                  "b.page.links[0].pieces = ['todo', 'tag', 'board']")["S4.3"] == "board"


def test_a_link_goes_to_a_piece_that_depends_on_the_others_transitively():
    assert pieces("card('tag').depends_on = ['todo']; "
                  "b.cards.push({piece: 'board', depends_on: ['tag'], actions: []}); "
                  "b.page.links[0].pieces = ['todo', 'board']")["S4.3"] == "board"


def test_the_tools_owner_counts_as_a_link_piece():
    assert pieces("b.page.links[0].pieces = ['tag']")["S4.3"] == "todo"


def test_a_link_naming_no_piece_is_refused():
    # the two kept stories leave other pieces unproven, so look only at the link's refusals
    found = [r for r in checks("b.page.links[0].pieces = ['todo', 'tags']") if r.startswith("link ")]
    assert found == ["link L1: names piece tags, which is no piece"]


def test_a_dependency_cycle_does_not_hang_probesOf():
    pieces("card('tag').depends_on = ['todo']; card('todo').depends_on = ['tag']")

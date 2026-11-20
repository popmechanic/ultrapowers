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


def checks(edit, kind="refusals"):
    return _bun(edit, "console.log(JSON.stringify(runChecks(b).%s))" % kind)


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


def test_a_link_no_piece_of_which_depends_on_the_others_is_a_fact():
    found = [f for f in checks("", "facts") if "link L1" in f]
    assert found == ["CODE fact: step S4.3: link L1 joins todo, tag, but none of them depends on all the others, "
                     "so its check goes to todo, the tool's owner, and may run before the others are built; "
                     "make one depend on the rest"]
    assert not [f for f in checks("card('tag').depends_on = ['todo']", "facts") if "link L1" in f]


def test_a_string_concepts_is_refused_once():
    found = [r for r in checks("card('todo').concepts = 'todo'") if r.startswith("piece todo") and "concept" in r]
    assert found == ['piece todo: concepts must be a list of concept ids, not "todo"']


# What the screen parts draw (#1491): a story expecting a role no part draws is a fact for the
# author, and the compiled task that needs it is told to add the part and may touch the parts files.
DRAWS = """
import {readDraws, TEMPLATE_DRAWS} from './skills/ultrawrite/stories/parts';
import {compilePlan} from './skills/ultrawrite/stories/compile';
const draws = readDraws(TEMPLATE_DRAWS);
delete draws.ActionCheckbox;
"""


def test_a_role_no_part_draws_is_a_fact():
    got = _bun(DRAWS, "console.log(JSON.stringify(runChecks(b, draws).facts.filter((f) => f.startsWith('PARTS'))))")
    assert got == ['PARTS fact: story S1 expects a checkbox (such as "buy milk"), and no screen part draws one yet; '
                   'the tasks that need it are told to add one']
    assert not [f for f in checks("", "facts") if f.startswith("PARTS")]


def test_the_task_needing_a_part_is_told_to_add_it():
    got = _bun(DRAWS, "const t = compilePlan(b, 'p1', probesOf(b, mod), [], true, draws);"
                      "console.log(JSON.stringify(t.split('\\n### Task ').slice(1)))")
    todo, tag = got
    assert todo.startswith("1: The todo piece")
    assert "No part draws a checkbox yet, and this task's stories expect one: add it." in todo
    assert "- Modify: `client/src/screens/draws.json`" in todo
    assert "No part draws" not in tag and "- Modify:" not in tag
    for t in (todo, tag):
        assert "When a story needs something no part draws, add a part" in t


# The one page (client/src/screen.json): every piece's task modifies it, and none names a piece's own screen.
def test_with_one_page_every_task_modifies_it():
    got = _bun(DRAWS, "const t = compilePlan(b, 'p1', probesOf(b, mod), [], true, null, true);"
                      "console.log(JSON.stringify(t.split('\\n### Task ').slice(1)))")
    assert len(got) == 2
    for t in got:
        assert "- Modify: `client/src/screen.json`" in t
        assert "client/src/pieces/" not in t
        assert "one json-render spec, `client/src/screen.json`, shared by every piece's builder" in t


def test_without_one_page_each_piece_creates_its_own_screen():
    got = _bun(DRAWS, "const t = compilePlan(b, 'p1', probesOf(b, mod), [], true, null);"
                      "console.log(JSON.stringify(t.split('\\n### Task ').slice(1)))")
    assert "- Create: `client/src/pieces/todo.json`" in got[0]
    assert "- Create: `client/src/pieces/tag.json`" in got[1]
    assert not [t for t in got if "client/src/screen.json" in t]

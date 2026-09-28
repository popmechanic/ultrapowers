"""The stories-v1 parser, reached through plan_parse.py as the sandbox runs it."""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills/ultrawrite/stories"))
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
import bundle  # noqa: E402
import compile as comp  # noqa: E402
import stacks  # noqa: E402
import plan_parse  # noqa: E402

PARSER = ROOT / "skills/ultrapowers/scripts/plan_parse.py"
TODO = ROOT / "skills/ultrawrite/catalog/todo"


def parse(tmp_path, text):
    p = tmp_path / "plan.md"
    p.write_text(text, encoding="utf-8")
    return subprocess.run([sys.executable, str(PARSER), str(p)], capture_output=True, text=True)


def plan_text():
    return comp.compile_plan(bundle.load_bundle(TODO), "p1", [])


def test_plan_parse_dispatches_a_stories_plan(tmp_path):
    res = parse(tmp_path, plan_text())
    assert res.returncode == 0, res.stderr
    got = json.loads(res.stdout)
    assert (got["grammar"], got["stack"], got["plan_id"], got["kind"]) == ("stories-v1", "tinyapp", "p1", "behaviour")
    assert [s["id"] for s in got["stories"]] == ["S1", "S2", "S3", "S4"]
    t = got["tasks"][0]
    assert t["piece"] == "todo" and t["actions"] == ["addTodo", "completeTodo", "deleteTodo"]
    assert len(t["probes"]) == 4 and t["proofRuns"] == []
    assert t["files"] == ["client/src/pieces/todo.ts"]
    assert got["launch_waves"][0][0]["id"] == "1" and got["bootstrapCmd"] == "bun install"


def test_depends_on_pieces_becomes_edges(tmp_path):
    text = plan_text() + ("\n### Task 2: The tag piece\n\n**Piece:** tag\n**Depends-on-pieces:** todo\n"
                          "**Files:**\n- Create: `client/src/pieces/tag.tsx`\n**Purpose:** x\n"
                          "**Actions:**\n**Stories:**\n**Proof:**\n")
    got = json.loads(parse(tmp_path, text).stdout)
    assert got["dag_edges"] == [{"from": "1", "to": "2", "why": "piece tag depends on todo"}]
    assert [[t["id"] for t in w] for w in got["launch_waves"]] == [["1"], ["2"]]
    assert got["tasks"][1]["depends_on"] == ["1"]


def test_a_malformed_probe_is_refused(tmp_path):
    text = plan_text().replace('"layer": "ui"', '"layer": "db"', 1)
    res = parse(tmp_path, text)
    assert res.returncode == 2 and "layer must be store, ui or saved" in res.stderr


def test_an_unknown_stack_is_refused(tmp_path):
    res = parse(tmp_path, plan_text().replace("**Stack:** tinyapp", "**Stack:** rails"))
    assert res.returncode == 2 and "grammar: Stack rails is not one this plugin knows" in res.stderr


def test_claims_plans_still_parse_as_before():
    assert plan_parse.plan_grammar("**Grammar:** claims-v1\n") == "claims-v1"
    assert plan_parse.plan_grammar("**Grammar:** stories-v1\n") == "stories-v1"
    assert plan_parse.plan_grammar("# nothing\n") is None


def test_the_stack_registry():
    s = stacks.stack_for("tinyapp")
    assert (s.name, s.grammar, s.bootstrap) == ("tinyapp", "stories-v1", "bun install")
    assert s.detect(["package.json", "server/wrangler.jsonc"]) is True
    assert s.detect(["package.json"]) is False
    assert stacks.stack_for("rails") is None
    try:
        s.state_of("/tmp")
    except NotImplementedError as exc:
        assert "sub-project 2" in str(exc)
    else:
        raise AssertionError("state_of must not be implemented yet")


def test_plan_parse_alone_in_a_temp_dir_still_parses_a_claims_plan(tmp_path):
    # fleet/compiler.mjs fetches plan_parse.py alone into a temp dir; it must not need stories_parse there.
    import shutil
    shutil.copy(PARSER, tmp_path / "plan_parse.py")
    res = subprocess.run([sys.executable, str(tmp_path / "plan_parse.py"),
                          str(ROOT / "evals/fixtures/claims/plan.md")], capture_output=True, text=True)
    assert res.returncode == 0, res.stderr
    assert "launch_waves" in json.loads(res.stdout)

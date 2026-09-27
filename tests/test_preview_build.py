"""The preview page is built from a bundle; a session's db rows become steps."""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills/ultrawrite/preview"))
sys.path.insert(0, str(ROOT / "skills/ultrawrite/stories"))
import build_preview as bp  # noqa: E402
import steps_from_rows as sfr  # noqa: E402

TODO = ROOT / "skills/ultrawrite/catalog/todo"
E = [{}, {}]
ONE = [{"todos": {"0": {"text": "a"}}}, {}]


def copy_todo(tmp_path):
    d = tmp_path / "b"
    shutil.copytree(TODO, d)
    return d


def edit_json(path, fn):
    data = json.loads(path.read_text())
    fn(data)
    path.write_text(json.dumps(data))


def test_build_inlines_both_modules_and_pins_tinybase(tmp_path):
    out = tmp_path / "preview.html"
    res = subprocess.run([sys.executable, str(ROOT / "skills/ultrawrite/preview/build_preview.py"),
                          str(TODO), str(out)], capture_output=True, text=True)
    assert res.returncode == 0, res.stderr
    html = out.read_text(encoding="utf-8")
    assert "https://cdn.jsdelivr.net/npm/tinybase@10.0.0/+esm" in html
    assert "const { createStore } = TB;" in html
    assert "return { TOOLS, makeStore };" in html and "return { render };" in html
    assert not re.search(r"^export\s", html, re.M)
    assert "__PAGE_JSON__" not in html and '"id": "S1"' in html
    assert "__SEE_MODULE__" not in html
    assert "return { seeOf, findAll };" in html
    assert html.startswith("<title>Todos</title>")
    assert "Not saved:" in html


def test_build_is_a_guided_walk_not_the_old_dropdown(tmp_path):
    out = tmp_path / "preview.html"
    res = subprocess.run([sys.executable, str(ROOT / "skills/ultrawrite/preview/build_preview.py"),
                          str(TODO), str(out)], capture_output=True, text=True)
    assert res.returncode == 0, res.stderr
    html = out.read_text(encoding="utf-8")
    assert "Yes, it works like this" in html
    assert "Not quite" in html
    assert "Tap the part that's off" in html
    assert "stories checked" in html
    assert "Not saved:" in html
    assert "Cancel" in html
    assert "You said:" in html
    assert "on the right" not in html
    assert "Start this story from empty" not in html
    assert 'id="story-pick"' not in html


def test_build_carries_a_storys_setup_and_shows_it(tmp_path):
    out = tmp_path / "preview.html"
    res = subprocess.run([sys.executable, str(ROOT / "skills/ultrawrite/preview/build_preview.py"),
                          str(TODO), str(out)], capture_output=True, text=True)
    assert res.returncode == 0, res.stderr
    html = out.read_text(encoding="utf-8")
    assert "Already done for you:" in html
    assert '"setup":' in html
    assert "This story's starting point couldn't be set up" in html


def test_build_refuses_a_bundle_whose_setup_names_an_unknown_tool(tmp_path):
    d = copy_todo(tmp_path)
    edit_json(d / "page.json", lambda p: p["stories"][1].update(
        setup=[{"tool": "addThing", "args": {"text": "buy milk"}}]))
    out = tmp_path / "preview.html"
    res = subprocess.run([sys.executable, str(ROOT / "skills/ultrawrite/preview/build_preview.py"),
                          str(d), str(out)], capture_output=True, text=True)
    assert res.returncode == 2, res.stdout + res.stderr
    assert "story S2: setup names tool addThing, which is no piece's action" in res.stderr
    assert not out.exists()
    # the unmodified catalog still builds clean
    out2 = tmp_path / "preview2.html"
    res2 = subprocess.run([sys.executable, str(ROOT / "skills/ultrawrite/preview/build_preview.py"),
                           str(TODO), str(out2)], capture_output=True, text=True)
    assert res2.returncode == 0, res2.stderr


def test_a_module_with_another_import_is_refused():
    with pytest.raises(bp.BuildError, match=re.escape("only `import {…} from 'tinybase'`")):
        bp.module_body("import x from 'lodash'\nexport const TOOLS = []\n", ["TOOLS"])


def test_a_missing_export_is_refused():
    with pytest.raises(bp.BuildError, match="does not export makeStore"):
        bp.module_body("export const TOOLS = []\n", ["TOOLS", "makeStore"])


def test_module_body_escapes_closing_script_tags():  # M6
    src = 'export const TOOLS = []\nconst x = "</script>"\n'
    body = bp.module_body(src, ["TOOLS"])
    assert "</script>" not in body
    assert '<\\/script>' in body


def db_row(session, at, story, step, before, after):
    return {"id": "%s-%s-%d" % (session, story, step), "session": session, "at": at, "story": story,
            "step": step, "piece": "todo", "tool": "addTodo", "args": {"text": "a"},
            "layer": "store", "ui": None, "before": before, "after": after, "see": []}


def test_rows_to_steps_keeps_the_latest_session_per_story():
    rows = [db_row("s1", 100, "S1", 1, E, ONE),
            db_row("s2", 200, "S1", 1, E, E),
            db_row("s2", 201, "S1", 2, E, ONE),
            db_row("s1", 150, "S2", 1, E, ONE)]
    got = sfr.rows_to_steps(rows)
    assert [(r["story"], r["step"]) for r in got] == [("S1", 1), ("S1", 2), ("S2", 1)]
    assert got[0]["after"] == E
    assert all("session" not in r and "at" not in r and "id" not in r for r in got)


def test_merge_steps_keeps_other_stories_and_replaces_the_recorded_one():  # I2
    existing = [dict(sfr.rows_to_steps([db_row("s0", 1, "S1", 1, E, ONE)])[0]),
                dict(sfr.rows_to_steps([db_row("s0", 1, "S2", 1, E, ONE)])[0])]
    new_rows = sfr.rows_to_steps([db_row("s9", 999, "S2", 1, E, ONE),
                                   db_row("s9", 1000, "S2", 2, ONE, E)])
    merged = sfr.merge_steps(existing, new_rows)
    assert [(r["story"], r["step"]) for r in merged] == [("S1", 1), ("S2", 1), ("S2", 2)]
    s1 = next(r for r in merged if r["story"] == "S1")
    assert s1 == existing[0]
    s2_steps = [r for r in merged if r["story"] == "S2"]
    assert s2_steps == new_rows


def test_load_rows_on_bad_json_file_exits_2_without_a_traceback(tmp_path, capsys):
    bad = tmp_path / "rows.json"
    bad.write_text("not json", encoding="utf-8")
    with pytest.raises(SystemExit) as exc:
        sfr.load_rows(str(bad))
    assert exc.value.code == 2
    err = capsys.readouterr().err
    assert err.startswith("steps_from_rows: unrecognized rows input %s: " % bad)
    assert "Traceback" not in err


def test_load_rows_on_bad_json_inside_a_directory_exits_2_without_a_traceback(tmp_path, capsys):
    d = tmp_path / "rows"
    d.mkdir()
    (d / "0001.json").write_text("not json", encoding="utf-8")
    with pytest.raises(SystemExit) as exc:
        sfr.load_rows(str(d))
    assert exc.value.code == 2
    err = capsys.readouterr().err
    assert err.startswith("steps_from_rows: unrecognized rows input %s: " % (d / "0001.json"))
    assert "Traceback" not in err

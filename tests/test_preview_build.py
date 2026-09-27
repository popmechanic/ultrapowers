"""The preview page is built from a bundle; a session's db rows become steps."""
import re
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
    assert html.startswith("<title>Todos</title>")


def test_a_module_with_another_import_is_refused():
    with pytest.raises(bp.BuildError, match=re.escape("only `import {…} from 'tinybase'`")):
        bp.module_body("import x from 'lodash'\nexport const TOOLS = []\n", ["TOOLS"])


def test_a_missing_export_is_refused():
    with pytest.raises(bp.BuildError, match="does not export makeStore"):
        bp.module_body("export const TOOLS = []\n", ["TOOLS", "makeStore"])


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

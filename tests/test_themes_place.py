import json
import os
import shutil
import subprocess

import pytest

from conftest import ROOT, THEMES, synthetic

pytestmark = pytest.mark.skipif(shutil.which("bun") is None, reason="bun is not installed")

PLACE = os.path.join(THEMES, "place.ts")
STRUCTURE = os.path.join(THEMES, "structure.css")
HEAD_SHA = subprocess.run(["git", "-C", ROOT, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()


def themes_dir(tmp_path):
    d = tmp_path / "themes"
    d.mkdir()
    return d


def place(*args):
    r = subprocess.run(["bun", PLACE, *args], capture_output=True, text=True, timeout=120)
    return r.returncode, r.stdout


def test_pouf_is_placed_with_its_three_paths(tmp_path):
    code, out = place("--theme", "pouf", "--app", str(tmp_path))
    t = tmp_path / "client/src/theme"
    assert code == 0 and out.splitlines()[0] == "PLACED pouf: client/src/theme"
    assert (t / "structure.css").read_text() == open(STRUCTURE).read()
    assert sorted(p.name for p in (t / "pouf").iterdir()) == ["LICENSE", "OFL.txt", "README.md", "font.css", "kit.tsx", "theme.css"]
    assert json.loads((t / "theme.json").read_text()) == {"theme": "pouf", "source": HEAD_SHA, "sdk": "0.1.0-beta.17"}


def test_it_prints_the_files_lines_without_the_font(tmp_path):
    lines = place("--theme", "pouf", "--app", str(tmp_path))[1].splitlines()[1:]
    assert "- Modify: client/src/theme/pouf/theme.css" in lines and "- Modify: client/src/theme/theme.json" in lines
    assert not any("font.css" in l for l in lines) and lines == sorted(lines)


def test_a_theme_that_fails_the_check_is_refused_and_nothing_is_written(tmp_path):
    broken = synthetic(themes_dir(tmp_path), drop_slot="button")
    app = tmp_path / "app"
    app.mkdir()
    code, out = place("--theme", broken, "--app", str(app))
    assert code == 1 and 'no rule styles [data-slot="button"]' in out and list(app.iterdir()) == []


def test_a_path_with_a_trailing_slash_places_under_its_folder_name(tmp_path):
    d = synthetic(themes_dir(tmp_path), name="mine")
    app = tmp_path / "app"
    app.mkdir()
    code, out = place("--theme", d + "/", "--app", str(app))
    assert code == 0 and (app / "client/src/theme/mine/theme.css").is_file()


def test_an_app_that_already_has_a_theme_is_refused(tmp_path):
    assert place("--theme", "pouf", "--app", str(tmp_path))[0] == 0
    before = (tmp_path / "client/src/theme/theme.json").read_text()
    code, out = place("--theme", "pouf", "--app", str(tmp_path))
    assert code == 1 and f"place: {tmp_path}/client/src/theme already exists" in out
    assert (tmp_path / "client/src/theme/theme.json").read_text() == before


def test_a_theme_subfolder_is_not_copied(tmp_path):
    d = synthetic(themes_dir(tmp_path), name="nested")
    os.makedirs(os.path.join(d, "extra"))
    open(os.path.join(d, "extra", "x.txt"), "w").write("x")
    app = tmp_path / "app"
    app.mkdir()
    code, out = place("--theme", d, "--app", str(app))
    assert code == 0 and not (app / "client/src/theme/nested/extra").exists()


def test_an_app_that_is_not_a_folder_exits_2(tmp_path):
    code, out = place("--theme", "pouf", "--app", str(tmp_path / "nope"))
    assert code == 2 and "is not a folder" in out

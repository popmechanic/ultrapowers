import json
import os
import re
import shutil
import subprocess
import sys

import pytest

from conftest import ROOT, THEMES, needs_install, synthetic

pytestmark = pytest.mark.skipif(shutil.which("bun") is None, reason="bun is not installed")

PLACE = os.path.join(THEMES, "place.ts")
STRUCTURE = os.path.join(THEMES, "structure.css")
PARSER = os.path.join(ROOT, "skills/ultrapowers/scripts/plan_parse.py")


def expected_source():
    if os.path.exists(os.path.join(ROOT, ".git")):
        r = subprocess.run(["git", "-C", ROOT, "rev-parse", "HEAD"], capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip()
    return json.load(open(os.path.join(ROOT, ".claude-plugin/plugin.json")))["version"]


def themes_dir(tmp_path):
    d = tmp_path / "themes"
    d.mkdir()
    return d


def place(*args, cwd=None):
    r = subprocess.run(["bun", PLACE, *args], capture_output=True, text=True, timeout=120, cwd=cwd)
    return r.returncode, r.stdout


@needs_install
def test_pouf_is_placed_with_its_three_paths(tmp_path):
    code, out = place("--theme", "pouf", "--app", str(tmp_path))
    t = tmp_path / "client/src/theme"
    assert code == 0 and out.splitlines()[0] == "PLACED pouf: client/src/theme"
    assert (t / "structure.css").read_text() == open(STRUCTURE).read()
    assert sorted(p.name for p in (t / "pouf").iterdir()) == ["LICENSE", "OFL.txt", "README.md", "font.css", "kit.tsx", "theme.css"]
    assert json.loads((t / "theme.json").read_text()) == {"theme": "pouf", "source": expected_source(), "sdk": "0.1.0-beta.17"}


def one_task_plan(files_lines):
    return "\n".join([
        "# Placed theme plan", "", "**Grammar:** claims-v1", "",
        "**Claim:** An operator sees the page. (elicited)", "",
        "**Summary:** One task.", "", "**Goal:** One task.", "", "**Tech Stack:** Bun.", "",
        "## Global Constraints", "", "- None.", "",
        "### Task 1: The page", "", "**Files:**", "- Create: `client/src/app.tsx`", *files_lines, "",
        "**Claim:** The page is served. (elicited)", "Machine: the page is served.", "",
        "**Authorized-by:** #1", "",
        "**Interfaces:**", "- Consumes: none", "- Produces: none", "",
        "**Context:** One page.", "",
        "**Proof:**", "Proved by the run-wide Check.", "",
        "**Stale-if:**", "- path-exists: `unused/1.marker`", ""])


@needs_install
def test_the_printed_lines_are_the_task_files_plan_parse_reads(tmp_path):
    app = tmp_path / "app"
    app.mkdir()
    lines = place("--theme", "pouf", "--app", str(app))[1].splitlines()[1:]
    assert lines == sorted(lines) and not any("font.css" in l for l in lines)
    plan = tmp_path / "plan.md"
    plan.write_text(one_task_plan(lines))
    r = subprocess.run([sys.executable, PARSER, str(plan)], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
    files = json.loads(r.stdout)["tasks"][0]["files"]
    placed = [l[len("- Modify: "):].strip("`") for l in lines]
    assert "client/src/theme/pouf/theme.css" in placed and "client/src/theme/theme.json" in placed
    assert set(placed) <= set(files)


@needs_install
def test_a_dotfile_is_neither_placed_nor_printed(tmp_path):
    d = synthetic(themes_dir(tmp_path), name="dotted")
    open(os.path.join(d, ".DS_Store"), "w").write("x")
    app = tmp_path / "app"
    app.mkdir()
    code, out = place("--theme", d, "--app", str(app))
    assert code == 0 and ".DS_Store" not in out
    assert not (app / "client/src/theme/dotted/.DS_Store").exists()


@needs_install
def test_a_bundled_name_with_a_trailing_slash_is_placed_from_the_repo_root(tmp_path):
    code, out = place("--theme", "pouf/", "--app", str(tmp_path), cwd=ROOT)
    assert code == 0 and out.splitlines()[0] == "PLACED pouf: client/src/theme"


@needs_install
def test_a_write_that_fails_midway_leaves_no_theme_folder(tmp_path):
    d = synthetic(themes_dir(tmp_path), name="locked")
    locked = os.path.join(d, "zz-notes.txt")
    open(locked, "w").write("x")
    os.chmod(locked, 0)
    app = tmp_path / "app"
    app.mkdir()
    try:
        code, out = place("--theme", d, "--app", str(app))
    finally:
        os.chmod(locked, 0o644)
    assert code == 2 and out.startswith("could not run:")
    assert not (app / "client/src/theme").exists()
    assert os.listdir(app / "client/src") == []


@needs_install
def test_a_theme_that_fails_the_check_is_refused_and_nothing_is_written(tmp_path):
    broken = synthetic(themes_dir(tmp_path), drop_slot="button")
    app = tmp_path / "app"
    app.mkdir()
    code, out = place("--theme", broken, "--app", str(app))
    assert code == 1 and 'no rule styles [data-slot="button"]' in out and list(app.iterdir()) == []


@needs_install
def test_a_path_with_a_trailing_slash_places_under_its_folder_name(tmp_path):
    d = synthetic(themes_dir(tmp_path), name="mine")
    app = tmp_path / "app"
    app.mkdir()
    code, out = place("--theme", d + "/", "--app", str(app))
    assert code == 0 and out.splitlines()[0] == "PLACED mine: client/src/theme"
    assert (app / "client/src/theme/mine/theme.css").is_file()


@needs_install
def test_an_app_that_already_has_a_theme_is_refused(tmp_path):
    other = synthetic(themes_dir(tmp_path), name="other")
    app = tmp_path / "app"
    app.mkdir()
    assert place("--theme", "pouf", "--app", str(app))[0] == 0
    before = {p.relative_to(app).as_posix(): p.read_bytes() for p in app.rglob("*") if p.is_file()}
    code, out = place("--theme", other, "--app", str(app))
    assert code == 1 and f"place: {app}/client/src/theme already exists" in out
    assert {p.relative_to(app).as_posix(): p.read_bytes() for p in app.rglob("*") if p.is_file()} == before


@needs_install
def test_a_theme_subfolder_is_not_copied(tmp_path):
    d = synthetic(themes_dir(tmp_path), name="nested")
    os.makedirs(os.path.join(d, "extra"))
    open(os.path.join(d, "extra", "x.txt"), "w").write("x")
    app = tmp_path / "app"
    app.mkdir()
    code, out = place("--theme", d, "--app", str(app))
    assert code == 0 and not (app / "client/src/theme/nested/extra").exists()


@needs_install
def test_an_app_that_is_not_a_folder_exits_2(tmp_path):
    code, out = place("--theme", "pouf", "--app", str(tmp_path / "nope"))
    assert code == 2 and "is not a folder" in out


def probe_from_first_build():
    text = open(os.path.join(ROOT, "skills/ultrawrite/references/first-build.md")).read()
    lines = [l for l in text.splitlines() if l.startswith("- Run: ") and "@ui-sdk/react" in l]
    assert len(lines) == 1
    return re.sub(r" \[[A-Z][0-9.]+\]$", "", lines[0][len("- Run: "):])


def stub(d, dependencies):
    d.mkdir()
    (d / "package.json").write_text(json.dumps({"name": "stub", "dependencies": dependencies}))
    return d


def run_in(d, cmd):
    return subprocess.run(["bash", "-c", cmd], cwd=d, capture_output=True, text=True, timeout=60).returncode


def test_the_version_probe_fails_without_the_pin_and_passes_with_it(tmp_path):
    cmd = probe_from_first_build()
    v = json.load(open(os.path.join(ROOT, "skills/ultrawrite/stories/policy.json")))["ui"]["sdk"]
    assert v in cmd
    assert run_in(stub(tmp_path / "a", {"react": "19.1.0"}), cmd) != 0
    assert run_in(stub(tmp_path / "b", {"@ui-sdk/react": "^" + v, "@ui-sdk/core": v}), cmd) != 0
    assert run_in(stub(tmp_path / "c", {"@ui-sdk/react": v, "@ui-sdk/core": v}), cmd) == 0

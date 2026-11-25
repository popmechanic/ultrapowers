import json
import os
import shutil
import subprocess

import pytest

pytestmark = pytest.mark.skipif(shutil.which("bun") is None, reason="bun is not installed")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOL = os.path.join(ROOT, "skills/ultrawrite/stories/product.ts")
TODO = os.path.join(ROOT, "evals/fixtures/product/product.json")


def run(*args):
    r = subprocess.run(["bun", TOOL, *args], capture_output=True, text=True, timeout=30)
    return r.returncode, r.stdout.strip()


def run_err(*args):
    r = subprocess.run(["bun", TOOL, *args], capture_output=True, text=True, timeout=30)
    return r.returncode, r.stderr.strip()


def record(tmp_path, **sub):
    with open(TODO) as f:
        p = json.load(f)
    p["subprojects"][0].update(sub)
    path = str(tmp_path / "product.json")
    with open(path, "w") as f:
        json.dump(p, f)
    return path


def test_nothing_built_is_a_first_build():
    assert run("route", TODO) == (0, "ROUTE fact: first build, one author")


def test_a_stories_built_app_routes_later_plans_to_claims(tmp_path):
    path = record(tmp_path, status="built", plan="p1", by="stories")
    assert run("check", path)[0] == 0
    assert run("route", path) == (0, "ROUTE fact: later plan, claims")


def test_render_refuses_a_bundle(tmp_path):
    (tmp_path / "page.json").write_text("{}")
    code, err = run_err("render", TODO, "--bundle", str(tmp_path), "--out", str(tmp_path / "p.md"))
    assert code == 2
    assert any(l.startswith("usage:") for l in err.splitlines())
    assert "bundle" in err
    assert not (tmp_path / "p.md").exists()


def test_built_marks_the_next_plan_and_routes_later_plans_to_claims(tmp_path):
    path = record(tmp_path)
    assert run("built", path, "--plan", "p1") == (0, "BUILT p1: one author")
    with open(path) as f:
        sub = json.load(f)["subprojects"][0]
    assert (sub["status"], sub["plan"], sub["by"]) == ("built", "p1", "solo")
    assert run("route", path) == (0, "ROUTE fact: later plan, claims")
    assert run("check", path)[0] == 0


def test_a_first_build_planned_again_is_marked_again(tmp_path):
    path = record(tmp_path)
    assert run("built", path, "--plan", "p1")[0] == 0
    assert run("built", path, "--plan", "p2") == (0, "BUILT p2: one author")
    with open(path) as f:
        sub = json.load(f)["subprojects"][0]
    assert (sub["plan"], sub["history"], sub["by"]) == ("p2", ["p1"], "solo")


def test_built_with_no_next_plan_is_refused(tmp_path):
    assert run("built", record(tmp_path, status="built", plan="p1"), "--plan", "p2") == (2, "product: no plan is next")


def test_an_unknown_by_is_refused(tmp_path):
    code, out = run("check", record(tmp_path, by="team"))
    assert code == 2 and "by must be solo or stories" in out

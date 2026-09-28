"""The Flock on a stories-v1 plan with a scripted builder and a fake checker:
done runs the facts, a red task is given back and parks, an environment the
checker cannot run in stops the run before any builder, and a task with no
probes is refused at load."""
import json
import os
import shutil
import subprocess
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAKE = os.path.join(ROOT, "tests/fixtures/flock-stories/fake_check.sh")
sys.path.insert(0, os.path.join(ROOT, "skills/ultrawrite/stories"))
sys.path.insert(0, os.path.join(ROOT, "skills/ultrapowers/scripts"))

pytestmark = pytest.mark.skipif(shutil.which("bun") is None, reason="bun is not on PATH (setup runs bun install)")


def plan_text():
    import bundle
    import compile as comp
    return comp.compile_plan(bundle.load_bundle(os.path.join(ROOT, "skills/ultrawrite/catalog/todo")), "p1", [])


def run(tmp_path, script, base_files=None, text=None, checker=None):
    base = tmp_path / "base"
    base.mkdir()
    (base / "package.json").write_text(json.dumps({"name": "t", "private": True, "scripts": {"typecheck": "true"}}))
    for name, body in (base_files or {}).items():
        (base / name).write_text(body)
    g = lambda *a: subprocess.run(["git", "-C", str(base), *a], check=True, capture_output=True, text=True).stdout
    g("init", "-q"); g("add", "-A"); g("-c", "user.name=t", "-c", "user.email=t@t.invalid", "commit", "-qm", "base")
    sha = g("rev-parse", "HEAD").strip()
    plan = tmp_path / "plan.md"
    plan.write_text(text or plan_text())
    sfile = tmp_path / "script.json"
    sfile.write_text(json.dumps(script))
    r = subprocess.run(["node", os.path.join(ROOT, "factory/flock/engine.mjs"), "--plan", str(plan), "--target", str(base),
                        "--base", sha, "--run-dir", str(tmp_path / "run"), "--builder", "scripted:" + str(sfile)],
                       capture_output=True, text=True, timeout=280, env={**os.environ, "FLOCK_CHECKER": checker or FAKE})
    events = [json.loads(l) for l in (tmp_path / "run" / "events.jsonl").read_text().splitlines()] \
        if (tmp_path / "run" / "events.jsonl").exists() else []
    return r, events, base, sha


def kinds(events, kind):
    return [e for e in events if e["kind"] == kind]


def test_green_facts_land(tmp_path):
    r, events, base, sha = run(tmp_path, {"1": {"ok": "1"}})
    assert r.returncode == 0, r.stdout + r.stderr
    assert not kinds(events, "facts:red")
    assert [e["task"] for e in kinds(events, "landing")] == ["1"]


def test_red_facts_are_given_back_until_the_task_parks(tmp_path):
    r, events, _, _ = run(tmp_path, {"1": {"nope": "1"}})
    assert r.returncode == 1
    assert {e["at"] for e in kinds(events, "facts:red")} == {"scripted"}
    parked = kinds(events, "task:parked")
    assert parked and parked[0]["releases"] == 3


def test_a_checker_that_cannot_run_stops_the_run_before_any_builder(tmp_path):
    r, events, _, _ = run(tmp_path, {"1": {"ok": "1"}}, base_files={"env-broken": "1"})
    assert r.returncode == 1
    assert kinds(events, "checker:start")[0]["exit"] == 2
    # ev('stall', {kind, evidence}) spreads its payload last, so a stall row's kind is the stall's own
    stalls = kinds(events, "checker")
    assert stalls and "the environment is broken" in stalls[0]["evidence"]["tail"]
    assert not kinds(events, "session:start")


def test_a_missing_checker_stops_the_run_before_any_builder(tmp_path):
    missing = os.path.join(str(tmp_path), "no-such-checker")
    r, events, _, _ = run(tmp_path, {"1": {"ok": "1"}}, checker=missing)
    assert r.returncode == 1
    exit_code = kinds(events, "checker:start")[0]["exit"]
    assert exit_code not in (0, 1), exit_code
    stalls = kinds(events, "checker")
    assert stalls
    assert not kinds(events, "session:start")


def test_a_task_with_no_probes_is_refused_at_load(tmp_path):
    text = "\n".join(l for l in plan_text().splitlines()
                     if not l.startswith("{") and l not in ("```probe", "```"))
    r, _, _, _ = run(tmp_path, {"1": {"ok": "1"}}, text=text)
    assert r.returncode != 0
    assert "has no probes" in r.stderr

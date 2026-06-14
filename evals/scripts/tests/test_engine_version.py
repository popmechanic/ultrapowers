# evals/scripts/tests/test_engine_version.py
import json
import pathlib
import subprocess
import sys
import time

SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import engine_version as ev  # noqa: E402

ROOT = ev.repo_root()


def _head():
    return subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT,
                          capture_output=True, text=True).stdout.strip()


def test_repo_root_points_at_plugin_manifest():
    assert (ROOT / ".claude-plugin" / "plugin.json").exists()


def test_current_engine_matches_head_and_plugin_json():
    eng = ev.current_engine()
    assert eng["sha"] == _head()
    assert len(eng["sha"]) == 40
    expected = json.loads((ROOT / ".claude-plugin" / "plugin.json").read_text())["version"]
    assert eng["plugin_version"] == expected


def test_engine_at_epoch_now_resolves_to_head():
    eng = ev.engine_at_epoch(time.time())
    assert eng["sha"] == _head()
    assert isinstance(eng["plugin_version"], str) and eng["plugin_version"]


def test_engine_at_epoch_far_past_returns_a_real_commit():
    eng = ev.engine_at_epoch(1)  # 1970, predates the repo
    assert len(eng["sha"]) == 40

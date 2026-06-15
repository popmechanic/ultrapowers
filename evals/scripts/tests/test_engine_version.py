# evals/scripts/tests/test_engine_version.py
import calendar
import json
import os
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


def test_version_from_text_parses_or_returns_unknown():
    assert ev._version_from_text('{"version": "1.2.3"}') == "1.2.3"
    assert ev._version_from_text("") == "unknown"
    assert ev._version_from_text("   ") == "unknown"


# --- hermetic repo: exercise engine_at_epoch's real job (resolve the version at
#     a past epoch / on a named branch) against a controlled history ---

def _git_run(cmd, cwd, env):
    subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True, env=env)


def _env():
    e = dict(os.environ)
    e.update({"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
              "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"})
    return e


def _commit_version(repo, version, date, env):
    pj = repo / ".claude-plugin" / "plugin.json"
    pj.parent.mkdir(parents=True, exist_ok=True)
    pj.write_text(json.dumps({"name": "x", "version": version}))
    e = dict(env, GIT_AUTHOR_DATE=date, GIT_COMMITTER_DATE=date)
    _git_run(["git", "add", "-A"], repo, e)
    _git_run(["git", "commit", "-m", "v" + version], repo, e)
    return subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo,
                          capture_output=True, text=True).stdout.strip()


def _temp_repo(tmp_path):
    repo = tmp_path / "engine"
    repo.mkdir()
    env = _env()
    _git_run(["git", "init", "-q"], repo, env)
    shas = {
        "0.0.1": _commit_version(repo, "0.0.1", "2020-01-01T00:00:00 +0000", env),
        "0.0.2": _commit_version(repo, "0.0.2", "2021-01-01T00:00:00 +0000", env),
        "0.0.3": _commit_version(repo, "0.0.3", "2022-01-01T00:00:00 +0000", env),
    }
    default_branch = subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=repo,
        capture_output=True, text=True).stdout.strip()
    return repo, shas, default_branch, env


def _epoch(iso_date):
    return calendar.timegm(time.strptime(iso_date, "%Y-%m-%d"))


def test_engine_at_epoch_resolves_version_at_a_mid_history_epoch(tmp_path):
    repo, shas, _, _ = _temp_repo(tmp_path)
    mid = ev.engine_at_epoch(_epoch("2020-06-01"), root=repo)
    assert mid["sha"] == shas["0.0.1"] and mid["plugin_version"] == "0.0.1"
    later = ev.engine_at_epoch(_epoch("2021-06-01"), root=repo)
    assert later["sha"] == shas["0.0.2"] and later["plugin_version"] == "0.0.2"
    now = ev.engine_at_epoch(time.time(), root=repo)
    assert now["sha"] == shas["0.0.3"] and now["plugin_version"] == "0.0.3"


def test_engine_at_epoch_predating_history_falls_back_to_root_commit(tmp_path):
    repo, shas, _, _ = _temp_repo(tmp_path)
    early = ev.engine_at_epoch(_epoch("2000-01-01"), root=repo)
    assert early["sha"] == shas["0.0.1"] and early["plugin_version"] == "0.0.1"


def test_engine_at_epoch_honors_the_branch_argument(tmp_path):
    repo, shas, default_branch, env = _temp_repo(tmp_path)
    _git_run(["git", "checkout", "-q", "-b", "feature", shas["0.0.2"]], repo, env)
    feat = _commit_version(repo, "0.0.9", "2023-01-01T00:00:00 +0000", env)
    on_default = ev.engine_at_epoch(time.time(), branch=default_branch, root=repo)
    assert on_default["plugin_version"] == "0.0.3"
    on_feature = ev.engine_at_epoch(time.time(), branch="feature", root=repo)
    assert on_feature["sha"] == feat and on_feature["plugin_version"] == "0.0.9"


def test_current_engine_accepts_root_override(tmp_path):
    repo, shas, _, _ = _temp_repo(tmp_path)
    eng = ev.current_engine(root=repo)
    assert eng["sha"] == shas["0.0.3"] and eng["plugin_version"] == "0.0.3"

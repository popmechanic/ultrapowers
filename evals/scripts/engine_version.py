# evals/scripts/engine_version.py
#!/usr/bin/env python3
"""Resolve the ultrapowers *engine* version for an eval run.

The engine version is the plugin version (.claude-plugin/plugin.json) plus the
ultrapowers repo HEAD sha — distinct from a run row's `head`, which is the
*fixture* repo HEAD. score_run.py stamps the live engine; migrate_runs.py
backfills historical rows from each row's scored_epoch.
"""
import json
import pathlib
import subprocess
import time


def repo_root():
    # engine_version.py -> scripts -> evals -> repo root
    return pathlib.Path(__file__).resolve().parents[2]


def _git(args, root):
    return subprocess.run(["git", *args], cwd=root,
                          capture_output=True, text=True).stdout.strip()


def _version_from_text(text):
    return json.loads(text)["version"] if text.strip() else "unknown"


def current_engine():
    """The engine version at HEAD right now (for live scoring)."""
    root = repo_root()
    sha = _git(["rev-parse", "HEAD"], root)
    version = json.loads(
        (root / ".claude-plugin" / "plugin.json").read_text())["version"]
    return {"plugin_version": version, "sha": sha}


def engine_at_epoch(epoch, branch="HEAD"):
    """The engine version that was HEAD at unix `epoch` (for backfill).

    Resolution walks the ancestry of `branch` (default HEAD, the actual checkout)
    rather than a fixed `main`: the engine that produced a run is the commit in
    the *current* line of history, so `engine_at_epoch(now)` returns HEAD from
    any branch — feature branches included — not just after a merge to main.
    """
    root = repo_root()
    iso = time.strftime("%Y-%m-%d %H:%M:%S +0000", time.gmtime(epoch))
    sha = _git(["rev-list", "-1", f"--before={iso}", branch], root)
    if not sha:  # epoch predates the branch — use its first commit
        sha = _git(["rev-list", "--max-parents=0", branch], root).splitlines()[0]
    text = _git(["show", f"{sha}:.claude-plugin/plugin.json"], root)
    return {"plugin_version": _version_from_text(text), "sha": sha}

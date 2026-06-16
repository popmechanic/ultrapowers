"""serve_viewer.py: render + serve the swarm viewer on a free port, --stop tears
it down. Subprocess-driven (same pattern as test_viewer.py); each test binds its
own free port via the helper and uses tmp_path, so same-wave runs stay safe."""
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
SERVE = ROOT / "skills/ultrapowers/scripts/serve_viewer.py"
PLAN = ROOT / "tests/fixtures/marked-plan.md"


def _serve(args):
    return subprocess.run([sys.executable, str(SERVE), *args],
                          check=True, capture_output=True, text=True)


def _poll(url, tries=60):
    for _ in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=0.5) as r:
                return r.status
        except Exception:
            time.sleep(0.1)
    return None


def test_serves_then_stops(tmp_path):
    out = tmp_path / "v"
    p = _serve([str(PLAN), "--out", str(out)])
    m = re.search(r"http://localhost:(\d+)/swarm\.html", p.stdout)
    assert m, p.stdout
    url = m.group(0)
    try:
        assert _poll(url) == 200, "server never served swarm.html"
        assert (out / "swarm.html").exists()
        assert (out / ".viewer-pids").exists()
    finally:
        _serve(["--stop", str(out)])
    assert _poll(url, tries=10) is None, "server still up after --stop"
    assert not (out / ".viewer-pids").exists()


def test_stop_idempotent(tmp_path):
    out = tmp_path / "empty"
    out.mkdir()
    p = _serve(["--stop", str(out)])
    assert "no viewer" in p.stdout.lower()


def test_transcripts_read_only(tmp_path):
    run_dir = tmp_path / "wf"
    run_dir.mkdir()
    (run_dir / "agent-a1.jsonl").write_text(
        json.dumps({"type": "user", "version": "2.1.177",
                    "message": {"content": [{"type": "text",
                        "text": "You are an implementer subagent operating inside a dedicated git worktree.\n"}]}}) + "\n")
    (run_dir / "agent-a1.meta.json").write_text(
        json.dumps({"agentType": "workflow-subagent", "worktreePath": "/wt"}))
    before = hashlib.md5((run_dir / "agent-a1.jsonl").read_bytes()).hexdigest()
    out = tmp_path / "v"
    _serve([str(PLAN), "--transcripts", str(run_dir), "--out", str(out)])
    try:
        after = hashlib.md5((run_dir / "agent-a1.jsonl").read_bytes()).hexdigest()
        assert after == before, "transcript was mutated"
        assert (out / "agent-a1.jsonl").is_symlink(), "live mode must symlink, not copy"
    finally:
        _serve(["--stop", str(out)])


def test_build_watch_cmd_threads_transcripts():
    import importlib.util
    spec = importlib.util.spec_from_file_location("serve_viewer", SERVE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    cmd = mod.build_watch_cmd("python3", "/w/swarm_watch.py", "/repo",
                              "ultra/integration-x", "/out", "/run/transcripts")
    assert "--transcripts" in cmd
    assert cmd[cmd.index("--transcripts") + 1] == "/run/transcripts"
    assert "--integration" in cmd and "ultra/integration-x" in cmd
    # no transcripts -> no flag (back-compat with --watch-only callers)
    cmd2 = mod.build_watch_cmd("python3", "/w/swarm_watch.py", "/repo",
                               "ultra/integration-x", "/out", None)
    assert "--transcripts" not in cmd2


def test_watch_writes_status(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()

    def git(*a):
        subprocess.run(["git", "-C", str(repo), *a], check=True, capture_output=True)

    git("init", "-q")
    git("config", "user.name", "t")
    git("config", "user.email", "t@t")
    (repo / "f.txt").write_text("x\n")
    git("add", "-A")
    git("commit", "-qm", "base")
    git("checkout", "-qb", "ultra/integration-test")
    out = tmp_path / "v"
    _serve([str(PLAN), "--watch", str(repo), "ultra/integration-test", "--out", str(out)])
    try:
        for _ in range(60):
            if (out / "status.json").exists():
                break
            time.sleep(0.1)
        assert (out / "status.json").exists(), "--watch did not start swarm_watch"
    finally:
        _serve(["--stop", str(out)])

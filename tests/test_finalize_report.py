import json, subprocess, sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "skills/ultrapowers/scripts/finalize_report.py"


def make_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    def git(*a):
        return subprocess.run(["git", "-C", str(repo), *a], check=True,
                              capture_output=True, text=True).stdout.strip()
    git("init", "-q")
    git("-c", "user.email=t@t", "-c", "user.name=t",
        "commit", "--allow-empty", "-q", "-m", "c1")
    return repo, git("rev-parse", "HEAD")


def write_sidecars(tmp_path, mapping):
    heads = tmp_path / "heads"
    heads.mkdir(exist_ok=True)
    for slot, value in mapping.items():
        (heads / slot).write_text(value + "\n")
    return heads


def write_report(tmp_path, wave_status="MERGED", token_sha="f" * 40):
    report = {
        "waveMerges": [{"wave": 1, "status": wave_status,
                        "headSha": token_sha, "branches": ["1"]}],
        "tasks": [{"task": "1", "status": "done", "headSha": token_sha}],
    }
    p = tmp_path / "report.json"
    p.write_text(json.dumps(report))
    return p


def run(report, heads, repo):
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--report", str(report),
         "--heads", str(heads), "--repo", str(repo)],
        capture_output=True, text=True)


def test_overwrites_headshas_from_sidecars(tmp_path):
    repo, sha = make_repo(tmp_path)
    heads = write_sidecars(tmp_path, {"task-1": sha, "wave-1": sha})
    report = write_report(tmp_path)          # token value is f*40, NOT sha
    r = run(report, heads, repo)
    assert r.returncode == 0, r.stderr
    data = json.loads(report.read_text())
    assert data["waveMerges"][0]["headSha"] == sha
    assert data["tasks"][0]["headSha"] == sha


def test_missing_task_sidecar_fails_naming_slot_and_leaves_report(tmp_path):
    repo, sha = make_repo(tmp_path)
    heads = write_sidecars(tmp_path, {"wave-1": sha})   # task-1 absent
    report = write_report(tmp_path)
    before = report.read_text()
    r = run(report, heads, repo)
    assert r.returncode == 1
    assert "task-1" in r.stderr
    assert report.read_text() == before


def test_malformed_sidecar_fails_naming_slot(tmp_path):
    repo, sha = make_repo(tmp_path)
    heads = write_sidecars(tmp_path, {"task-1": "deadbeef", "wave-1": sha})
    report = write_report(tmp_path)
    r = run(report, heads, repo)
    assert r.returncode == 1
    assert "task-1" in r.stderr


def test_nonresolving_sidecar_fails_naming_slot(tmp_path):
    repo, sha = make_repo(tmp_path)
    heads = write_sidecars(tmp_path, {"task-1": "1" * 40, "wave-1": sha})
    report = write_report(tmp_path)
    r = run(report, heads, repo)
    assert r.returncode == 1
    assert "task-1" in r.stderr and "resolv" in r.stderr


def test_unmerged_waves_and_failed_tasks_tolerated_absent(tmp_path):
    repo, _ = make_repo(tmp_path)
    heads = write_sidecars(tmp_path, {})     # empty heads dir
    report = write_report(tmp_path, wave_status="SKIPPED")
    r = run(report, heads, repo)
    assert r.returncode == 0, r.stderr

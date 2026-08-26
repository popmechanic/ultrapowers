import json, subprocess, sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "skills/ultrapowers/scripts/finalize_report.py"


def _git(repo, *a):
    return subprocess.run(["git", "-C", str(repo), *a], check=True,
                          capture_output=True, text=True).stdout.strip()


def _commit(repo, msg):
    subprocess.run(["git", "-C", str(repo), "-c", "user.email=t@t",
                    "-c", "user.name=t", "commit", "--allow-empty", "-q",
                    "-m", msg], check=True)


def _merge(repo, branch):
    subprocess.run(["git", "-C", str(repo), "-c", "user.email=t@t",
                    "-c", "user.name=t", "merge", "-q", "--no-ff",
                    "-m", "merge " + branch, branch], check=True)


def make_run(tmp_path):
    """Real repo shaped like a two-wave run: base -> merge b1, b2 (wave 1)
    -> merge b3 (wave 2) -> plain reconcile-fixup commit on the tip."""
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    _commit(repo, "base")
    base = _git(repo, "rev-parse", "HEAD")
    _git(repo, "checkout", "-q", "-b", "ultra/integration-t")
    tips = {}
    for n in ("1", "2"):
        _git(repo, "checkout", "-q", "-b", "worktree-wf_t-" + n, base)
        _commit(repo, "task " + n)
        tips[n] = _git(repo, "rev-parse", "HEAD")
    _git(repo, "checkout", "-q", "ultra/integration-t")
    _merge(repo, "worktree-wf_t-1")
    _merge(repo, "worktree-wf_t-2")
    _git(repo, "checkout", "-q", "-b", "worktree-wf_t-3")  # wave 2 forks from the wave-1 tip
    _commit(repo, "task 3")
    tips["3"] = _git(repo, "rev-parse", "HEAD")
    _git(repo, "checkout", "-q", "ultra/integration-t")
    _merge(repo, "worktree-wf_t-3")
    _commit(repo, "reconcile fixup")
    tip = _git(repo, "rev-parse", "HEAD")
    return repo, tips, tip


def make_report(tmp_path, tips, envelope=False, last_status="MERGED",
                final_recorded="f" * 40):
    body = {
        "waveMerges": [
            {"wave": 1, "status": "MERGED", "headSha": "a" * 40,
             "branches": ["1", "2"]},
            {"wave": 2, "status": last_status, "headSha": final_recorded,
             "branches": ["3"] if last_status == "MERGED" else []},
        ],
        "tasks": [
            {"task": "1", "status": "done", "branch": "worktree-wf_t-1",
             "headSha": "b" * 40},
            {"task": "2", "status": "done", "branch": "worktree-wf_t-2",
             "headSha": tips["2"]},
            {"task": "3", "status": "done", "branch": "worktree-wf_t-3",
             "headSha": "c" * 40},
        ],
    }
    p = tmp_path / "report.json"
    p.write_text(json.dumps({"result": body} if envelope else body))
    return p


def run(report, repo, branch="ultra/integration-t"):
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--report", str(report),
         "--repo", str(repo), "--branch", branch],
        capture_output=True, text=True)


def test_derives_task_heads_and_final_tip(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    report = make_report(tmp_path, tips)
    r = run(report, repo)
    assert r.returncode == 0, r.stderr
    data = json.loads(report.read_text())
    by_id = {t["task"]: t for t in data["tasks"]}
    for n in ("1", "2", "3"):
        assert by_id[n]["headSha"] == tips[n]
    # final MERGED entry gets the branch tip (reconcile fixup included)
    assert data["waveMerges"][1]["headSha"] == tip


def test_intermediate_wave_headsha_left_untouched(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    report = make_report(tmp_path, tips)
    run(report, repo)
    data = json.loads(report.read_text())
    assert data["waveMerges"][0]["headSha"] == "a" * 40  # model-recorded context


def test_recorded_vs_derived_warning_never_blocks(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    report = make_report(tmp_path, tips)   # task 1 recorded b*40 != real tip
    r = run(report, repo)
    assert r.returncode == 0
    assert "warning" in r.stderr and "b" * 40 in r.stderr


def test_envelope_shaped_report(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    report = make_report(tmp_path, tips, envelope=True)
    r = run(report, repo)
    assert r.returncode == 0, r.stderr
    data = json.loads(report.read_text())["result"]
    assert data["waveMerges"][1]["headSha"] == tip


def test_dropped_task_fails_loudly(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    # a branch that exists but never merged into the integration branch
    _git(repo, "checkout", "-q", "-b", "worktree-wf_t-9", tips["1"] + "^")
    _commit(repo, "orphan")
    _git(repo, "checkout", "-q", "ultra/integration-t")
    report = make_report(tmp_path, tips)
    data = json.loads(report.read_text())
    data["waveMerges"][1]["branches"].append("9")
    data["tasks"].append({"task": "9", "status": "done",
                          "branch": "worktree-wf_t-9", "headSha": "d" * 40})
    report.write_text(json.dumps(data))
    before = report.read_text()
    r = run(report, repo)
    assert r.returncode == 1
    assert "not an ancestor" in r.stderr and "worktree-wf_t-9" in r.stderr
    assert report.read_text() == before


def test_unresolvable_branch_fails(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    report = make_report(tmp_path, tips)
    data = json.loads(report.read_text())
    data["tasks"][0]["branch"] = "no-such-branch"
    report.write_text(json.dumps(data))
    r = run(report, repo)
    assert r.returncode == 1
    assert "no-such-branch" in r.stderr


def test_missing_tasks_entry_and_missing_branch_fail(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    report = make_report(tmp_path, tips)
    data = json.loads(report.read_text())
    del data["tasks"][0]["branch"]
    data["waveMerges"][0]["branches"].append("7")   # no tasks[] entry
    report.write_text(json.dumps(data))
    r = run(report, repo)
    assert r.returncode == 1
    assert "task 1" in r.stderr and "7" in r.stderr


def test_non_merged_last_entry_untouched_but_task_heads_derived(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    report = make_report(tmp_path, tips, last_status="SKIPPED",
                         final_recorded="")
    r = run(report, repo)
    assert r.returncode == 0, r.stderr
    data = json.loads(report.read_text())
    assert data["waveMerges"][1].get("headSha") == ""      # untouched
    by_id = {t["task"]: t for t in data["tasks"]}
    assert by_id["1"]["headSha"] == tips["1"]              # wave-1 still derived


def test_merged_final_entry_without_recorded_sha_gets_tip(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    report = make_report(tmp_path, tips, final_recorded="")
    r = run(report, repo)
    assert r.returncode == 0, r.stderr
    assert json.loads(report.read_text())["waveMerges"][1]["headSha"] == tip


def test_unresolvable_integration_branch_fails(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    report = make_report(tmp_path, tips)
    r = run(report, repo, branch="ultra/no-such")
    assert r.returncode == 1
    assert "ultra/no-such" in r.stderr


def test_wrong_shape_report_fails(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    p = tmp_path / "report.json"
    p.write_text(json.dumps({"tasks": []}))
    r = run(p, repo)
    assert r.returncode == 1
    assert "waveMerges" in r.stderr


def test_resume_round_report_only_lists_new_tasks(tmp_path):
    # round-2 style: the report names only task 3; tasks 1/2 landed in a
    # prior round and are absent from this report — must not error.
    repo, tips, tip = make_run(tmp_path)
    body = {
        "waveMerges": [{"wave": 1, "status": "MERGED", "headSha": "e" * 40,
                        "branches": ["3"]}],
        "tasks": [{"task": "3", "status": "done",
                   "branch": "worktree-wf_t-3", "headSha": "c" * 40}],
    }
    p = tmp_path / "report.json"
    p.write_text(json.dumps(body))
    r = run(p, repo)
    assert r.returncode == 0, r.stderr
    data = json.loads(p.read_text())
    assert data["tasks"][0]["headSha"] == tips["3"]
    assert data["waveMerges"][0]["headSha"] == tip

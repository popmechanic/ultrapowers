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
                final_recorded="f" * 40, base_sha=None):
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
    if base_sha:
        body["baseSha"] = base_sha
    p = tmp_path / "report.json"
    # The envelope carries sibling keys the rewrite must preserve (#275).
    p.write_text(json.dumps({"summary": "ok", "result": body} if envelope else body))
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
    r = run(report, repo)
    assert r.returncode == 0, r.stderr
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
    full = json.loads(report.read_text())
    assert full["summary"] == "ok"   # the rewrite preserves envelope siblings
    data = full["result"]
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
    # full messages: a substring like "7" is satisfied by accident from the
    # SHAs in the non-blocking warnings this fixture also emits.
    assert "tasks[] entry for merged task 1 has no branch" in r.stderr
    assert "no tasks[] entry for merged task 7" in r.stderr


def _patchify_task_1(tmp_path, report, patch_bytes):
    """Reshape task 1 into a patch-input entry; patch_bytes None = no file."""
    data = json.loads(report.read_text())
    p = tmp_path / "patches" / "task-1.patch"
    if patch_bytes is not None:
        p.parent.mkdir(exist_ok=True)
        p.write_bytes(patch_bytes)
    data["tasks"][0]["branch"] = ""
    data["tasks"][0]["patch"] = str(p)
    data["tasks"][0]["headSha"] = "d" * 40
    report.write_text(json.dumps(data))


def test_patch_input_task_without_branch_is_skipped_not_an_error(tmp_path):
    """Amendment 9: a patch-input task has no branch and no task commit BY
    DESIGN — its provenance is the fold log. finalize must skip the branch
    assertions (leaving its recorded headSha untouched), not block the run."""
    repo, tips, tip = make_run(tmp_path)
    report = make_report(tmp_path, tips)
    _patchify_task_1(tmp_path, report, b"diff --git a/x b/x\n")
    r = run(report, repo)
    assert r.returncode == 0, r.stderr
    out = json.loads(report.read_text())
    by_id = {t["task"]: t for t in out["tasks"]}
    assert by_id["1"]["headSha"] == "d" * 40      # left as recorded, not derived
    assert by_id["2"]["headSha"] == tips["2"]     # branch tasks still derived
    assert "has no branch" not in r.stderr


def test_patch_task_with_missing_or_empty_patch_file_fails_the_gate(tmp_path):
    """The gate leg must not be blind for patch tasks: a vanished patch file
    is a merged task with no provenance artifact; an empty one is the
    vacuous-merge claim (#275) in patch shape."""
    repo, tips, tip = make_run(tmp_path)
    report = make_report(tmp_path, tips)
    _patchify_task_1(tmp_path, report, None)      # no file at the named path
    r = run(report, repo)
    assert r.returncode == 1
    assert "patch file for merged task 1 is missing" in r.stderr

    report2 = make_report(tmp_path, tips)
    _patchify_task_1(tmp_path, report2, b"")      # zero bytes
    r2 = run(report2, repo)
    assert r2.returncode == 1
    assert "patch file for merged task 1 is empty" in r2.stderr
    assert "carries no changes" in r2.stderr


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


def _root_commit(repo):
    return _git(repo, "rev-list", "--max-parents=0", "HEAD")


def test_vacuous_merged_branch_fails_when_base_known(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    base = _root_commit(repo)
    _git(repo, "branch", "worktree-wf_t-4", base)   # zero commits past the run base
    report = make_report(tmp_path, tips, base_sha=base)
    data = json.loads(report.read_text())
    data["waveMerges"][0]["branches"].append("4")
    data["tasks"].append({"task": "4", "status": "done",
                          "branch": "worktree-wf_t-4", "headSha": "e" * 40})
    report.write_text(json.dumps(data))
    before = report.read_text()
    r = run(report, repo)
    assert r.returncode == 1
    assert "already an ancestor of the run base" in r.stderr
    assert "worktree-wf_t-4" in r.stderr
    assert report.read_text() == before


def test_missing_base_sha_skips_guard_with_named_warning(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    _git(repo, "branch", "worktree-wf_t-4", _root_commit(repo))
    report = make_report(tmp_path, tips)   # no baseSha
    data = json.loads(report.read_text())
    data["waveMerges"][0]["branches"].append("4")
    data["tasks"].append({"task": "4", "status": "done",
                          "branch": "worktree-wf_t-4", "headSha": "e" * 40})
    report.write_text(json.dumps(data))
    r = run(report, repo)
    assert r.returncode == 0, r.stderr
    assert "vacuous-merge guard skipped" in r.stderr


def test_genuine_branches_pass_with_base_present(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    report = make_report(tmp_path, tips, base_sha=_root_commit(repo))
    r = run(report, repo)
    assert r.returncode == 0, r.stderr


def test_missing_report_file_names_the_fact(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    r = run(tmp_path / "nope.json", repo)
    assert r.returncode == 1
    assert "finalize_report: cannot read --report" in r.stderr
    assert "Traceback" not in r.stderr


def test_malformed_report_names_the_fact(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    p = tmp_path / "report.json"
    p.write_text("{not json")
    r = run(p, repo)
    assert r.returncode == 1
    assert "not valid JSON" in r.stderr
    assert "Traceback" not in r.stderr


def test_non_object_report_names_the_fact(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    p = tmp_path / "report.json"
    p.write_text("[]")   # valid JSON, wrong shape
    r = run(p, repo)
    assert r.returncode == 1
    assert "not a JSON object" in r.stderr
    assert "Traceback" not in r.stderr


def test_symbolic_base_sha_is_ignored_not_resolved(tmp_path):
    # "HEAD" would resolve to the integration tip and false-block every
    # genuine merged task — the guard is shape-gated to hex shas.
    repo, tips, tip = make_run(tmp_path)
    report = make_report(tmp_path, tips, base_sha="HEAD")
    r = run(report, repo)
    assert r.returncode == 0, r.stderr
    assert "vacuous-merge guard skipped" in r.stderr

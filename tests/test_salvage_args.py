# tests/test_salvage_args.py
import json, subprocess, sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "skills/ultrapowers/scripts"
SALVAGE = SCRIPTS / "salvage_args.py"
REDIRECT = SCRIPTS / "redirect_args.py"
SHA_B = "b" * 40

sys.path.insert(0, str(SCRIPTS))
import salvage_args as sa  # noqa: E402 — unit tests below exercise it directly


def make_run(tmp_path):
    run = tmp_path / "run-20260825-1"
    run.mkdir()
    launch = {"tasks": [{"id": "1", "body": "### Task 1\n\nfirst", "files": ["a.py"]},
                        {"id": "2", "body": "### Task 2\n\nsecond", "files": ["b.py"]},
                        {"id": "3", "body": "### Task 3\n\nthird", "files": ["c.py"]}],
              "waves": [["1", "2"], ["3"]]}
    launch_p = run / "launch.json"
    launch_p.write_text(json.dumps(launch))
    args = {"planPath": "docs/p.md", "pluginRoot": "/pr", "runDir": str(run),
            "wavesPath": str(launch_p), "integrationBranch": "ultra/int-1",
            "edges": [["1", "3"], ["2", "3"]],
            "waves": [[{"id": "1", "files": ["a.py"], "tier": None, "review": "lean"},
                       {"id": "2", "files": ["b.py"], "tier": None, "review": "lean"}],
                      [{"id": "3", "files": ["c.py"], "tier": None, "review": "lean"}]]}
    args_p = run / "args.json"
    args_p.write_text(json.dumps(args))
    (run / "receipt.json").write_text(json.dumps({"argsFile": str(args_p), "runDir": str(run)}))
    return run


def report_obj(**over):
    result = {"integrationBranch": "ultra/int-1", "waves": [["1", "2"], ["3"]],
              "tasks": [{"task": "1", "status": "done", "branch": "wt-1", "headSha": "a" * 40},
                        {"task": "2", "status": "failed", "branch": "wt-2", "headSha": SHA_B,
                         "reviewVerdict": "fix-loop-exhausted",
                         "notes": "blocking: guard still missing"}],
              "tests": {"passed": True},
              "unfinished": ["3: blocked — depends on a failed task",
                             "9: deferred (budget exhausted)"],
              "completenessFindings": ["Task 2 left the guard untested",
                                       "task 3 never ran", "unrelated finding"]}
    result.update(over)
    return result


def write_report(run, obj, name="report.json"):
    p = run / name
    p.write_text(json.dumps(obj))
    return p


def run_salvage(run, report_path, *extra):
    return subprocess.run([sys.executable, str(SALVAGE), "--receipt", str(run / "receipt.json"),
                           "--report", str(report_path), *extra],
                          capture_output=True, text=True)


def test_salvage_set_is_failed_plus_blocked_in_step2_order(tmp_path):
    run = make_run(tmp_path)
    rp = write_report(run, report_obj())
    r = run_salvage(run, rp)
    assert r.returncode == 0, r.stderr
    out_args = json.loads(Path(r.stdout.strip()).read_text())
    assert [[e["id"] for e in w] for w in out_args["waves"]] == [["2"], ["3"]]
    assert out_args["edges"] == [["2", "3"]]           # narrowed to the salvage set
    assert out_args["resume"] is True
    assert out_args["integrationBranch"] == "ultra/int-1"
    assert out_args["pluginRoot"] == "/pr" and out_args["runDir"]  # receipt spread carried
    assert Path(r.stdout.strip()).name == "salvage-args.json"
    assert "9: deferred (budget exhausted)" in r.stderr   # listed, not salvaged


def test_prior_attempt_block_carries_branch_sha_notes_findings(tmp_path):
    run = make_run(tmp_path)
    rp = write_report(run, report_obj())
    r = run_salvage(run, rp)
    assert r.returncode == 0, r.stderr
    out_args = json.loads(Path(r.stdout.strip()).read_text())
    launch = json.loads(Path(out_args["wavesPath"]).read_text())
    by_id = {t["id"]: t for t in launch["tasks"]}
    body2 = by_id["2"]["body"]
    assert body2.startswith("### Task 2\n\nsecond")
    assert "PRIOR ATTEMPT" in body2
    assert "wt-2" in body2 and SHA_B in body2
    assert "git checkout " + SHA_B + " -- <path>" in body2
    assert "fix-loop-exhausted" in body2
    assert "blocking: guard still missing" in body2
    assert "Task 2 left the guard untested" in body2
    assert "task 3 never ran" not in body2 and "unrelated finding" not in body2
    body3 = by_id["3"]["body"]
    assert "PRIOR ATTEMPT" in body3 and "not attempted" in body3
    assert "3: blocked — depends on a failed task" in body3
    assert "task 3 never ran" in body3
    assert by_id["1"]["body"] == "### Task 1\n\nfirst"    # untouched sibling
    assert "PRIOR ATTEMPT" not in (run / "launch.json").read_text()  # original untouched


def test_envelope_shaped_result_is_accepted(tmp_path):
    run = make_run(tmp_path)
    rp = write_report(run, {"summary": "envelope", "result": report_obj()}, "saved-result.json")
    r = run_salvage(run, rp)
    assert r.returncode == 0, r.stderr


def test_nothing_to_salvage_exits_1(tmp_path):
    run = make_run(tmp_path)
    rp = write_report(run, report_obj(
        tasks=[{"task": "1", "status": "done"}, {"task": "2", "status": "done"}],
        unfinished=["9: deferred (budget exhausted)"]))
    r = run_salvage(run, rp)
    assert r.returncode == 1
    assert r.stderr.startswith("salvage_args:")
    assert "nothing to salvage" in r.stderr


def test_failed_task_unknown_to_launch_exits_1(tmp_path):
    run = make_run(tmp_path)
    rp = write_report(run, report_obj(tasks=[{"task": "7", "status": "failed"}]))
    r = run_salvage(run, rp)
    assert r.returncode == 1
    assert r.stderr.startswith("salvage_args:")
    assert "failed task '7' is unknown" in r.stderr


def test_not_a_report_exits_1(tmp_path):
    run = make_run(tmp_path)
    rp = write_report(run, {"grantedAt": "x", "instruction": "y", "ackList": []})
    r = run_salvage(run, rp)
    assert r.returncode == 1
    assert r.stderr.startswith("salvage_args:")
    assert "not a report" in r.stderr


def test_cascade_blocked_with_no_failed_tasks_is_salvaged(tmp_path):
    run = make_run(tmp_path)
    rp = write_report(run, report_obj(
        tasks=[{"task": "1", "status": "done"}, {"task": "2", "status": "done"}],
        unfinished=["3: cascade-blocked by wave 1"]))
    r = run_salvage(run, rp)
    assert r.returncode == 0, r.stderr
    out_args = json.loads(Path(r.stdout.strip()).read_text())
    assert [[e["id"] for e in w] for w in out_args["waves"]] == [["3"]]
    launch = json.loads(Path(out_args["wavesPath"]).read_text())
    by_id = {t["id"]: t for t in launch["tasks"]}
    body3 = by_id["3"]["body"]
    assert "PRIOR ATTEMPT" in body3 and "not attempted" in body3
    assert "3: cascade-blocked by wave 1" in body3


def test_integration_branch_flag_overrides_args(tmp_path):
    run = make_run(tmp_path)
    rp = write_report(run, report_obj())
    r = run_salvage(run, rp, "--integration-branch", "ultra/other")
    assert r.returncode == 0, r.stderr
    out_args = json.loads(Path(r.stdout.strip()).read_text())
    assert out_args["integrationBranch"] == "ultra/other"


def test_findings_naming_matches_multiple_ids_in_one_sentence():
    report = {"completenessFindings": ["tasks 2 and 3 left the guard untested"]}
    assert sa.findings_naming(report, "2") == ["tasks 2 and 3 left the guard untested"]
    assert sa.findings_naming(report, "3") == ["tasks 2 and 3 left the guard untested"]


def test_findings_naming_does_not_match_id_as_substring():
    report = {"completenessFindings": ["task 22 needs another look"]}
    assert sa.findings_naming(report, "2") == []


def test_rotates_round_artifacts_after_emit(tmp_path):
    run = make_run(tmp_path)
    rp = write_report(run, report_obj())
    heads = run / "heads"; heads.mkdir()
    (heads / "wave-2").write_text("c" * 40 + "\n")
    r = run_salvage(run, rp)
    assert r.returncode == 0, r.stderr
    assert not heads.exists() and (run / "heads-1" / "wave-2").is_file()
    assert json.loads((run / "report-1.json").read_text())["tasks"][1]["status"] == "failed"
    assert (run / "report.json").is_file()


def test_validation_failure_leaves_artifacts_untouched(tmp_path):
    run = make_run(tmp_path)
    rp = write_report(run, report_obj(tasks=[{"task": "7", "status": "failed"}]))
    heads = run / "heads"; heads.mkdir()
    r = run_salvage(run, rp)
    assert r.returncode == 1
    assert r.stderr.startswith("salvage_args:")
    assert heads.exists() and not (run / "report-1.json").exists()


def test_salvage_chains_on_a_prior_redirect_round(tmp_path):
    # one chain file (relaunch-launch.json): a redirect's amendment survives
    # into a later salvage instead of being resurrected from the pristine launch
    run = make_run(tmp_path)
    findings = run / "findings.json"
    findings.write_text(json.dumps([{"task": "1", "instruction": "round1 fix"}]))
    (run / "gate-receipt.json").write_text(json.dumps({"branch": "ultra/int-1"}))
    r1 = subprocess.run([sys.executable, str(REDIRECT), "--receipt", str(run / "receipt.json"),
                         "--findings", str(findings)], capture_output=True, text=True)
    assert r1.returncode == 0, r1.stderr
    rp = write_report(run, report_obj())
    r2 = run_salvage(run, rp)
    assert r2.returncode == 0, r2.stderr
    out_args = json.loads(Path(r2.stdout.strip()).read_text())
    launch = json.loads(Path(out_args["wavesPath"]).read_text())
    by_id = {t["id"]: t for t in launch["tasks"]}
    assert "REDIRECT: round1 fix" in by_id["1"]["body"]
    assert "PRIOR ATTEMPT" in by_id["2"]["body"]
    assert (run / "heads-1").exists() is False        # no heads/ existed to rotate
    # the redirect had nothing to rotate (no report.json, no heads/), so it left
    # no round artifact — the counter is by artifacts present, and the salvage's
    # snapshot is round 1
    assert (run / "report-1.json").is_file()

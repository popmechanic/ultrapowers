# tests/test_redirect_args.py
import json, subprocess, sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "skills/ultrapowers/scripts/redirect_args.py"


def make_run(tmp_path):
    run = tmp_path / "run-20260806-1"
    run.mkdir()
    launch = {"tasks": {"1": {"id": "1", "body": "### Task 1\n\ndo the thing", "files": ["a.py"]},
                        "2": {"id": "2", "body": "### Task 2\n\nother thing", "files": ["b.py"]}},
              "waves": [["1", "2"]]}
    launch_p = run / "launch.json"
    launch_p.write_text(json.dumps(launch))
    args = {"planPath": "docs/p.md", "pluginRoot": "/pr", "runDir": str(run),
            "wavesPath": str(launch_p),
            "waves": [[{"id": "1", "files": ["a.py"], "tier": None, "review": "lean"},
                       {"id": "2", "files": ["b.py"], "tier": None, "review": "lean"}]]}
    args_p = run / "args.json"
    args_p.write_text(json.dumps(args))
    (run / "receipt.json").write_text(json.dumps({"argsFile": str(args_p), "runDir": str(run)}))
    (run / "gate-receipt.json").write_text(json.dumps(
        {"mode": "gate", "verdict": "BLOCKED", "integrationBranch": "ultra/int-1"}))
    return run


def run_helper(run, findings, *extra):
    f = run / "findings.json"
    f.write_text(json.dumps(findings))
    return subprocess.run([sys.executable, str(SCRIPT), "--receipt", str(run / "receipt.json"),
                           "--findings", str(f), *extra], capture_output=True, text=True)


def test_amend_appends_redirect_narrows_files_sets_tier_keeps_siblings(tmp_path):
    run = make_run(tmp_path)
    r = run_helper(run, [{"task": "1", "instruction": "fix the guard",
                          "files": ["a.py", "c.py"], "tier": "standard"}])
    assert r.returncode == 0, r.stderr
    out_args = json.loads(Path(r.stdout.strip()).read_text())
    assert out_args["resume"] is True
    assert out_args["integrationBranch"] == "ultra/int-1"      # from gate-receipt.json
    assert out_args["pluginRoot"] == "/pr" and out_args["runDir"]  # receipt spread carried
    new_launch = json.loads(Path(out_args["wavesPath"]).read_text())
    assert "REDIRECT: fix the guard" in new_launch["tasks"]["1"]["body"]
    assert new_launch["tasks"]["1"]["files"] == ["a.py", "c.py"]
    assert new_launch["tasks"]["2"] == json.loads((run / "launch.json").read_text())["tasks"]["2"]
    entry1 = out_args["waves"][0][0]
    assert entry1["tier"] == "standard" and entry1["files"] == ["a.py", "c.py"]
    # originals untouched
    assert "REDIRECT" not in (run / "launch.json").read_text()
    assert "resume" not in json.loads((run / "args.json").read_text())


def test_unknown_task_id_exits_1(tmp_path):
    run = make_run(tmp_path)
    r = run_helper(run, [{"task": "9", "instruction": "x"}])
    assert r.returncode == 1 and "9" in r.stderr


def test_missing_instruction_exits_1(tmp_path):
    run = make_run(tmp_path)
    r = run_helper(run, [{"task": "1"}])
    assert r.returncode == 1 and "instruction" in r.stderr


def test_missing_argsfile_exits_1(tmp_path):
    run = make_run(tmp_path)
    (run / "receipt.json").write_text(json.dumps({"argsFile": str(run / "gone.json")}))
    r = run_helper(run, [{"task": "1", "instruction": "x"}])
    assert r.returncode == 1 and "argsFile" in r.stderr


def test_no_branch_source_exits_1(tmp_path):
    run = make_run(tmp_path)
    (run / "gate-receipt.json").unlink()
    r = run_helper(run, [{"task": "1", "instruction": "x"}])
    assert r.returncode == 1 and "integration" in r.stderr.lower()


def test_explicit_branch_flag_overrides(tmp_path):
    run = make_run(tmp_path)
    r = run_helper(run, [{"task": "1", "instruction": "x"}],
                   "--integration-branch", "ultra/other")
    assert r.returncode == 0, r.stderr
    assert json.loads(Path(r.stdout.strip()).read_text())["integrationBranch"] == "ultra/other"


def test_list_shaped_launch_tasks_are_accepted(tmp_path):
    # compile_plan.py --emit-launch emits tasks as a LIST of {id,...} objects;
    # the dict-keyed shape in make_run is the unit-fixture simplification.
    # Caught live during the 2026-08-07 drain: the helper must accept both.
    run = make_run(tmp_path)
    launch_p = run / "launch.json"
    launch = json.loads(launch_p.read_text())
    launch["tasks"] = list(launch["tasks"].values())
    launch_p.write_text(json.dumps(launch))
    r = run_helper(run, [{"task": "1", "instruction": "fix the guard",
                          "files": ["a.py"], "tier": "cheap"}])
    assert r.returncode == 0, r.stderr
    out_args = json.loads(Path(r.stdout.strip()).read_text())
    new_launch = json.loads(Path(out_args["wavesPath"]).read_text())
    assert isinstance(new_launch["tasks"], list)          # shape preserved
    amended = [t for t in new_launch["tasks"] if t["id"] == "1"][0]
    assert "REDIRECT: fix the guard" in amended["body"]
    untouched = [t for t in new_launch["tasks"] if t["id"] == "2"][0]
    assert untouched == launch["tasks"][1]                # sibling byte-identical


def test_emitted_waves_contain_only_amended_tasks(tmp_path):
    # the honest cost contract: a one-task fix relaunches one task, so the
    # emitted waves carry ONLY the amended entries (empty waves dropped)
    run = make_run(tmp_path)
    r = run_helper(run, [{"task": "1", "instruction": "fix"}])
    assert r.returncode == 0, r.stderr
    out_args = json.loads(Path(r.stdout.strip()).read_text())
    ids = [e["id"] for w in out_args["waves"] for e in w]
    assert ids == ["1"]
    # the launch copy still carries every task body (engine reads by id)
    new_launch = json.loads(Path(out_args["wavesPath"]).read_text())
    assert set(new_launch["tasks"]) == {"1", "2"}


def test_second_round_chains_on_first_rounds_output(tmp_path):
    # round 2 must not resurrect pristine bodies: it reads the prior
    # redirect-args.json/redirect-launch.json when they exist
    run = make_run(tmp_path)
    r1 = run_helper(run, [{"task": "1", "instruction": "round1 fix"}])
    assert r1.returncode == 0, r1.stderr
    r2 = run_helper(run, [{"task": "2", "instruction": "round2 fix"}])
    assert r2.returncode == 0, r2.stderr
    launch2 = json.loads(
        Path(json.loads(Path(r2.stdout.strip()).read_text())["wavesPath"]).read_text())
    assert "REDIRECT: round1 fix" in launch2["tasks"]["1"]["body"]   # preserved
    assert "REDIRECT: round2 fix" in launch2["tasks"]["2"]["body"]


def test_argsfile_branch_derived_without_flag_or_gate_receipt(tmp_path):
    # #127: the argsFile the helper already reads carries integrationBranch —
    # the common case needs zero extra inputs.
    run = make_run(tmp_path)
    args_p = run / "args.json"
    args = json.loads(args_p.read_text())
    args["integrationBranch"] = "ultra/int-args"
    args_p.write_text(json.dumps(args))
    (run / "gate-receipt.json").unlink()
    r = run_helper(run, [{"task": "1", "instruction": "x"}])
    assert r.returncode == 0, r.stderr
    out_args = json.loads(Path(r.stdout.strip()).read_text())
    assert out_args["integrationBranch"] == "ultra/int-args"


def test_flag_wins_over_argsfile_value(tmp_path):
    # bare flag-wins: an explicit operator flag outranks the recorded value.
    run = make_run(tmp_path)
    args_p = run / "args.json"
    args = json.loads(args_p.read_text())
    args["integrationBranch"] = "ultra/int-args"
    args_p.write_text(json.dumps(args))
    r = run_helper(run, [{"task": "1", "instruction": "x"}],
                   "--integration-branch", "ultra/int-flag")
    assert r.returncode == 0, r.stderr
    assert json.loads(Path(r.stdout.strip()).read_text())["integrationBranch"] == "ultra/int-flag"


def make_heads(run):
    heads = run / "heads"
    heads.mkdir()
    (heads / "task-1").write_text("a" * 40 + "\n")
    (heads / "wave-4").write_text("b" * 40 + "\n")
    return heads


def test_heads_cleared_after_successful_emit(tmp_path):
    # #131: a stale wave-4 slot from the prior launch must not survive into
    # the relaunch, where the critic's highest-numbered-slot rule reads it.
    run = make_run(tmp_path)
    heads = make_heads(run)
    r = run_helper(run, [{"task": "1", "instruction": "fix"}])
    assert r.returncode == 0, r.stderr
    assert not heads.exists()
    assert (run / "redirect-args.json").is_file()  # emit happened first


def test_heads_beside_receipt_cleared_even_with_out_dir(tmp_path):
    # the deletion target is pinned to dirname(receipt), never --out-dir
    run = make_run(tmp_path)
    heads = make_heads(run)
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    r = run_helper(run, [{"task": "1", "instruction": "fix"}],
                   "--out-dir", str(elsewhere))
    assert r.returncode == 0, r.stderr
    assert not heads.exists()


def test_heads_untouched_on_validation_failure(tmp_path):
    # a validation death must not strip a healthy run's sidecars
    run = make_run(tmp_path)
    heads = make_heads(run)
    r = run_helper(run, [{"task": "9", "instruction": "x"}])  # unknown task id
    assert r.returncode == 1
    assert heads.exists() and (heads / "wave-4").is_file()


def test_no_heads_dir_is_a_noop(tmp_path):
    run = make_run(tmp_path)
    r = run_helper(run, [{"task": "1", "instruction": "fix"}])
    assert r.returncode == 0, r.stderr
    assert not (run / "heads").exists()  # nothing spuriously created

# tests/test_redirect_args.py
import json, os, subprocess, sys
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


def test_amend_appends_redirect_unions_files_sets_tier_keeps_siblings(tmp_path):
    # #223: `files` is DERIVED — task FILES ∪ instruction paths ∪ finding
    # files — and never narrows; a finding naming only c.py still keeps a.py.
    run = make_run(tmp_path)
    r = run_helper(run, [{"task": "1", "instruction": "fix the guard",
                          "files": ["c.py"], "tier": "standard"}])
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
                          "files": ["a.py"], "tier": "standard"}])
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


def make_report(run, marker="round-one"):
    (run / "report.json").write_text(json.dumps(
        {"integrationBranch": "ultra/int-1", "waves": [["1", "2"]],
         "tasks": [{"task": "1", "status": "done"}], "tests": {"passed": True},
         "unfinished": [], "completenessFindings": [marker]}))


def test_heads_rotated_after_successful_emit(tmp_path):
    # #222 (supersedes the #131 rmtree): a stale wave-4 slot from the prior
    # launch must not survive into the relaunch's heads/, but nothing is
    # deleted — the prior round's slots move to heads-1/.
    run = make_run(tmp_path)
    heads = make_heads(run)
    r = run_helper(run, [{"task": "1", "instruction": "fix"}])
    assert r.returncode == 0, r.stderr
    assert not heads.exists()
    assert (run / "heads-1" / "wave-4").read_text() == "b" * 40 + "\n"
    assert (run / "heads-1" / "task-1").is_file()
    assert (run / "redirect-args.json").is_file()  # emit happened first
    assert "round 1" in r.stderr


def test_report_snapshotted_to_round_file_after_successful_emit(tmp_path):
    run = make_run(tmp_path)
    make_report(run)
    r = run_helper(run, [{"task": "1", "instruction": "fix"}])
    assert r.returncode == 0, r.stderr
    snap = json.loads((run / "report-1.json").read_text())
    assert snap["completenessFindings"] == ["round-one"]
    # the live report.json is a COPY source, never removed — the next gate
    # overwrites it; the snapshot is the durable record
    assert (run / "report.json").is_file()


def test_rotation_beside_receipt_even_with_out_dir(tmp_path):
    # the rotation target is pinned to dirname(receipt), never --out-dir
    run = make_run(tmp_path)
    make_heads(run)
    make_report(run)
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    r = run_helper(run, [{"task": "1", "instruction": "fix"}],
                   "--out-dir", str(elsewhere))
    assert r.returncode == 0, r.stderr
    assert not (run / "heads").exists()
    assert (run / "heads-1").is_dir() and (run / "report-1.json").is_file()
    assert not (elsewhere / "heads-1").exists()
    assert (elsewhere / "redirect-args.json").is_file()


def test_round_counter_increments_across_rounds(tmp_path):
    run = make_run(tmp_path)
    make_heads(run)
    make_report(run, "round-one")
    r1 = run_helper(run, [{"task": "1", "instruction": "one"}])
    assert r1.returncode == 0, r1.stderr
    # the next gate rewrites report.json and the next merge rewrites heads/
    make_heads(run)
    make_report(run, "round-two")
    r2 = run_helper(run, [{"task": "2", "instruction": "two"}])
    assert r2.returncode == 0, r2.stderr
    assert json.loads((run / "report-1.json").read_text())["completenessFindings"] == ["round-one"]
    assert json.loads((run / "report-2.json").read_text())["completenessFindings"] == ["round-two"]
    assert (run / "heads-1").is_dir() and (run / "heads-2").is_dir()
    assert not (run / "heads").exists()


def test_round_counter_continues_from_existing_artifacts(tmp_path):
    # an orchestrator that already has report-3.json / heads-3 on disk (e.g.
    # a salvage round) gets round 4 — never a clobbered earlier snapshot
    run = make_run(tmp_path)
    (run / "report-3.json").write_text("{}")
    make_heads(run)
    r = run_helper(run, [{"task": "1", "instruction": "fix"}])
    assert r.returncode == 0, r.stderr
    assert (run / "heads-4").is_dir() and not (run / "heads").exists()
    assert (run / "report-3.json").read_text() == "{}"


def test_heads_only_rotation_when_report_absent(tmp_path):
    run = make_run(tmp_path)
    make_heads(run)
    r = run_helper(run, [{"task": "1", "instruction": "fix"}])
    assert r.returncode == 0, r.stderr
    assert (run / "heads-1").is_dir()
    assert not (run / "report-1.json").exists()


def test_chain_file_is_relaunch_launch_json(tmp_path):
    # #222: one chain file shared with salvage_args.py
    run = make_run(tmp_path)
    r = run_helper(run, [{"task": "1", "instruction": "fix"}])
    assert r.returncode == 0, r.stderr
    out_args = json.loads(Path(r.stdout.strip()).read_text())
    assert Path(out_args["wavesPath"]).name == "relaunch-launch.json"
    assert not (run / "redirect-launch.json").exists()


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


def test_real_shaped_gate_receipt_branch_key_derived(tmp_path):
    # #153: real receipts (written by ultra_gate.py) store the integration
    # branch under "branch"; the fallback must accept it. The default
    # make_run fixture's "integrationBranch" key is the legacy/hand-built
    # shape and stays covered by the tests above.
    run = make_run(tmp_path)
    (run / "gate-receipt.json").write_text(json.dumps(
        {"mode": "gate", "verdict": "BLOCKED", "branch": "ultra/int-real"}))
    r = run_helper(run, [{"task": "1", "instruction": "x"}])
    assert r.returncode == 0, r.stderr
    out_args = json.loads(Path(r.stdout.strip()).read_text())
    assert out_args["integrationBranch"] == "ultra/int-real"


def test_legacy_integrationbranch_key_wins_over_branch(tmp_path):
    # Precedence inside the receipt fallback: legacy integrationBranch first,
    # then branch — hand-built fixtures keep working unchanged.
    run = make_run(tmp_path)
    (run / "gate-receipt.json").write_text(json.dumps(
        {"branch": "ultra/int-real", "integrationBranch": "ultra/int-legacy"}))
    r = run_helper(run, [{"task": "1", "instruction": "x"}])
    assert r.returncode == 0, r.stderr
    out_args = json.loads(Path(r.stdout.strip()).read_text())
    assert out_args["integrationBranch"] == "ultra/int-legacy"


def test_files_never_narrow_below_task_files(tmp_path):
    # a hand-narrowed finding cannot exclude the task's own FILES
    run = make_run(tmp_path)
    r = run_helper(run, [{"task": "1", "instruction": "trim it", "files": ["z.py"]}])
    assert r.returncode == 0, r.stderr
    out_args = json.loads(Path(r.stdout.strip()).read_text())
    assert out_args["waves"][0][0]["files"] == ["a.py", "z.py"]


def test_files_unchanged_when_nothing_names_a_path(tmp_path):
    run = make_run(tmp_path)
    r = run_helper(run, [{"task": "1", "instruction": "rename the helper and rerun"}])
    assert r.returncode == 0, r.stderr
    out_args = json.loads(Path(r.stdout.strip()).read_text())
    new_launch = json.loads(Path(out_args["wavesPath"]).read_text())
    assert new_launch["tasks"]["1"]["files"] == ["a.py"]
    assert out_args["waves"][0][0]["files"] == ["a.py"]


def test_instruction_paths_and_derive_files_units():
    sys.path.insert(0, str(SCRIPT.parent))
    import redirect_args as ra
    assert ra.instruction_paths("edit `a/b.py`, (c.md) and d.py; then tests/t.py::test_k.") == \
        ["a/b.py", "c.md", "d.py", "tests/t.py"]
    # plan-defect (review of #223): the compiler's rule accepts Capitalized bare
    # words and digit-only extensions; free prose needs the narrower rule.
    assert ra.instruction_paths("no paths here, just Foo.Bar and v1.2") == []
    assert ra.instruction_paths("Restore the deleted test in tests/test_x.py; keep .gitignore. Then rerun pytest.") == \
        ["tests/test_x.py", ".gitignore"]
    assert ra.instruction_paths("Fix the off-by-one in src/a.py:12-14 (see the PASS verdict). It must return JSON, e.g. {}") == \
        ["src/a.py"]
    assert ra.instruction_paths("update `Makefile` and README") == ["Makefile"]
    assert ra.derive_files(["a.py"], "", []) == ["a.py"]


def test_non_list_files_in_a_finding_exits_1(tmp_path):
    run = make_run(tmp_path)
    r = run_helper(run, [{"task": "1", "instruction": "x", "files": "c.py"}])
    assert r.returncode == 1 and "files must be a list" in r.stderr


def _ra():
    sys.path.insert(0, str(SCRIPT.parent))
    import redirect_args as ra
    return ra


def test_derive_files_guard_drops_fake_paths(capsys):
    # tokens that leak today (#261): glob mask, code fragment, quoted ext list
    ra = _ra()
    out = ra.derive_files(["a.py"], 'set the mask to "src/**/*.py" and rename foo(bar).py; exts ".py, .js"',
                          [], declared={"a.py"})
    assert out == ["a.py"]
    err = capsys.readouterr().err
    assert "dropped" in err and "src/**/*.py" in err


def test_derive_files_guard_keeps_real_and_declared(capsys):
    # exists-on-tree leg (pytest.ini at repo root) + declared-FILES leg
    ra = _ra()
    out = ra.derive_files(["a.py"], "edit pytest.ini then wire lib/util.py",
                          [], declared={"a.py", "lib/util.py"})
    assert out == ["a.py", "pytest.ini", "lib/util.py"]
    assert capsys.readouterr().err == ""


def test_derive_files_finding_files_bypass_guard():
    # orchestrator-authored files are trusted even when absent everywhere
    ra = _ra()
    out = ra.derive_files(["a.py"], "", ["brand/new.py"], declared={"a.py"})
    assert out == ["a.py", "brand/new.py"]


def test_derive_files_declared_none_bypasses_guard():
    # legacy/direct callers without a launch keep #223 behavior
    ra = _ra()
    assert ra.derive_files(["a.py"], "touch b.py and a.py", ["c.py", "b.py"]) == ["a.py", "b.py", "c.py"]


def test_cli_drops_undeclared_instruction_tokens(tmp_path):
    # end-to-end negative pin for the guard: none of the instruction's paths
    # exist on the tree or in the launch's declared FILES
    run = make_run(tmp_path)
    r = run_helper(run, [{"task": "1", "instruction":
                          "add the guard in `src/guard.py`, cover it in tests/test_guard.py::test_x, "
                          "and leave Foo.Bar alone (see `README`)."}])
    assert r.returncode == 0, r.stderr
    out_args = json.loads(Path(r.stdout.strip()).read_text())
    new_launch = json.loads(Path(out_args["wavesPath"]).read_text())
    assert new_launch["tasks"]["1"]["files"] == ["a.py"]
    assert out_args["waves"][0][0]["files"] == ["a.py"]
    assert "dropped" in r.stderr
    for tok in ("src/guard.py", "tests/test_guard.py", "README"):
        assert tok in r.stderr


def test_cli_keeps_declared_sibling_file(tmp_path):
    # declared-FILES leg end-to-end: b.py is declared by task 2's launch entry
    run = make_run(tmp_path)
    r = run_helper(run, [{"task": "1", "instruction": "mirror the change in b.py"}])
    assert r.returncode == 0, r.stderr
    out_args = json.loads(Path(r.stdout.strip()).read_text())
    assert out_args["waves"][0][0]["files"] == ["a.py", "b.py"]


def test_legacy_chain_file_fallback(tmp_path):
    # residual 1: a pre-#222 round left redirect-launch.json; bodies chain
    # from it (with a stderr warning) instead of re-deriving pristine
    run = make_run(tmp_path)
    launch = json.loads((run / "launch.json").read_text())
    launch["tasks"]["1"]["body"] += "\n\nREDIRECT: prior round amendment\n"
    (run / "redirect-launch.json").write_text(json.dumps(launch))
    r = run_helper(run, [{"task": "1", "instruction": "next amendment"}])
    assert r.returncode == 0, r.stderr
    assert "redirect-launch.json" in r.stderr
    out_args = json.loads(Path(r.stdout.strip()).read_text())
    body = json.loads(Path(out_args["wavesPath"]).read_text())["tasks"]["1"]["body"]
    assert "prior round amendment" in body and "next amendment" in body


def test_out_dir_mixing_finds_receipt_side_chain(tmp_path):
    # residual 7: chain file beside the receipt is found even when --out-dir
    # points elsewhere
    run = make_run(tmp_path)
    launch = json.loads((run / "launch.json").read_text())
    launch["tasks"]["1"]["body"] += "\n\nREDIRECT: receipt-side amendment\n"
    (run / "relaunch-launch.json").write_text(json.dumps(launch))
    out_dir = tmp_path / "elsewhere"
    out_dir.mkdir()
    r = run_helper(run, [{"task": "1", "instruction": "another"}],
                   "--out-dir", str(out_dir))
    assert r.returncode == 0, r.stderr
    out_args = json.loads(Path(r.stdout.strip()).read_text())
    body = json.loads(Path(out_args["wavesPath"]).read_text())["tasks"]["1"]["body"]
    assert "receipt-side amendment" in body


def test_rotation_skips_byte_identical_snapshot(tmp_path):
    ra = _ra()
    run = tmp_path
    (run / "report.json").write_text('{"r": 1}')
    first = ra.rotate_round_artifacts(str(run))
    assert first["report"] and (run / "report-1.json").is_file()
    second = ra.rotate_round_artifacts(str(run))          # unchanged live report
    assert second["report"] is None
    assert sorted(p.name for p in run.glob("report-*.json")) == ["report-1.json"]
    # #304: rewrite SAME-SIZE content and pin (size, mtime) to what a stale
    # filecmp cache entry would key on — the comparison must read bytes, not
    # trust stat signatures (red on coarse-mtime filesystems otherwise)
    st = (run / "report.json").stat()
    (run / "report.json").write_text('{"r": 2}')
    os.utime(run / "report.json", (st.st_atime, st.st_mtime))
    third = ra.rotate_round_artifacts(str(run))           # changed -> snapshots again
    assert third["report"] and (run / "report-2.json").is_file()

"""fold_wave.py `--patch` — the patch-input kernel (One Driver Amendment 9).

The claim under test is a BIJECTION: a wave supplied as patches against BASE
folds, resolves and materializes to exactly what the same wave supplied as
branches did — same stop, same narration, same candidate TREE — with the one
designed difference that a patch task contributes no commit parent. Every
patch here is produced the way the driver produces it (`git diff --binary
--full-index --no-renames <BASE>`), and every refusal is pinned against a
real git object store, never the CLI's own bookkeeping.

Scenario repos are imported from the branch-input suites so the two shapes
are tested over IDENTICAL content; every scenario is its own tmp_path repo.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KERNEL = ROOT / "skills" / "ultrapowers" / "kernel"
CLI = str(KERNEL / "fold_wave.py")
sys.path.insert(0, str(KERNEL))
sys.path.insert(0, str(KERNEL / "vendor"))
sys.path.insert(0, str(ROOT / "tests"))
import repo_weave as rw  # noqa: E402
import frontier_fold as ff  # noqa: E402
import test_fold_wave as branch_suite  # noqa: E402
import test_fold_wave_materialize as mat_suite  # noqa: E402


def _git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True,
                          capture_output=True, text=True).stdout.strip()


def _git_bytes(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True,
                          capture_output=True).stdout


def run_cli(*args):
    return subprocess.run([sys.executable, CLI, *args],
                          capture_output=True, text=True)


def last_json(result):
    return json.loads(result.stdout.strip().splitlines()[-1])


def write_patch(repo, base_sha, ref, dest):
    """The driver's capture, from a committed ref: the diff BASE..ref, binary,
    full-index, no renames — a task's whole contribution as content."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(_git_bytes(repo, "diff", "--binary", "--full-index",
                                "--no-renames", base_sha, ref))
    return dest


def patch_specs(repo, base_sha, tmp_path, heads):
    """[(taskId, patchFile)] in the given order."""
    return [(tid, write_patch(repo, base_sha, sha,
                              tmp_path / "patches" / ("task-%s.patch" % tid)))
            for tid, sha in heads]


def do_fold(repo, run_dir, wave, base_sha, specs, extra=()):
    args = ["fold", "--repo", str(repo), "--run-dir", str(run_dir),
            "--wave", str(wave), "--base", base_sha]
    for tid, patch in specs:
        args += ["--patch", "%s=%s" % (tid, patch)]
    return run_cli(*args, *extra)


def do_resolve(repo, run_dir, wave, i, reply_dir, specs):
    args = ["resolve", "--repo", str(repo), "--run-dir", str(run_dir),
            "--wave", str(wave), "--conflict", str(i),
            "--reply-dir", str(reply_dir)]
    for tid, patch in specs:
        args += ["--patch", "%s=%s" % (tid, patch)]
    return run_cli(*args)


def do_materialize(repo, run_dir, wave, prev_head, specs):
    args = ["materialize", "--repo", str(repo), "--run-dir", str(run_dir),
            "--wave", str(wave), "--prev-head", prev_head]
    for tid, patch in specs:
        args += ["--patch", "%s=%s" % (tid, patch)]
    return run_cli(*args)


def wave_events(run_dir, wave=1):
    log = run_dir / "frontier" / ("wave-%d" % wave) / "fold_log.jsonl"
    return [json.loads(line) for line in log.read_text().splitlines()]


def reply_dir(tmp_path, name, **hunk_files):
    d = tmp_path / name
    d.mkdir()
    for hid, text in hunk_files.items():
        (d / (hid + ".txt")).write_text(text)
    return d


def parents_of(repo, sha):
    return _git(repo, "rev-list", "--parents", "-n", "1", sha).split()[1:]


# --- the bijection: patch input ≡ branch input ---------------------------


def test_patch_fold_reaches_the_same_stop_as_branch_input(tmp_path):
    repo, base_sha, heads = branch_suite.make_repo(tmp_path)
    ordered = [("t1", heads["t1"]), ("t2", heads["t2"])]

    by_branch = branch_suite.do_fold(repo, tmp_path / "run-branch", 1, base_sha,
                                     [(t, t, s) for t, s in ordered])
    specs = patch_specs(repo, base_sha, tmp_path, ordered)
    by_patch = do_fold(repo, tmp_path / "run-patch", 1, base_sha, specs)
    assert by_patch.returncode == 0, by_patch.stderr

    # Same stop, same open conflict, same hunk count — only the wave dir
    # differs, and it is the run dir's, not the input shape's.
    a, b = last_json(by_branch), last_json(by_patch)
    for reply in (a, b):
        for entry in reply["open"]:
            entry["hunksFile"] = Path(entry["hunksFile"]).name
    assert a == b
    narr = lambda run: (run / "frontier/wave-1/conflict-1.txt").read_text()  # noqa: E731
    assert narr(tmp_path / "run-branch") == narr(tmp_path / "run-patch")

    # The log records the derived TREE as headSha and the patch beside it.
    events = wave_events(tmp_path / "run-patch")
    assert events[0] == {"type": "base", "sha": base_sha}
    folds = [e for e in events if e["type"] == "fold"]
    assert [e["task"] for e in folds] == ["t1", "t2"]
    for e, (_tid, patch) in zip(folds, specs):
        assert e["patch"] == str(patch)
        assert _git(repo, "cat-file", "-t", e["headSha"]) == "tree"
        # …and that tree IS the branch's tree: content in, content out.
    assert [e["headSha"] for e in folds] == [
        _git(repo, "rev-parse", "%s^{tree}" % sha) for _, sha in ordered]


def test_patch_resolve_completes_and_materializes_with_one_parent(tmp_path):
    repo, base_sha, heads = branch_suite.make_repo(tmp_path)
    t3 = branch_suite.add_third_branch(repo, base_sha)
    ordered = [("t1", heads["t1"]), ("t2", heads["t2"]), ("t3", t3[1])]
    branch_specs = [("t1", "t1", heads["t1"]), ("t2", "t2", heads["t2"]),
                    ("t3", t3[0], t3[1])]
    specs = patch_specs(repo, base_sha, tmp_path, ordered)

    def drive(run_dir, fold, resolve, materialize, task_specs):
        p = last_json(fold(repo, run_dir, 1, base_sha, task_specs))
        d = reply_dir(tmp_path, run_dir.name + "-r1", h1="    return y + 1 * 2\n\n")
        q = last_json(resolve(repo, run_dir, 1, p["open"][0]["i"], d, task_specs))
        assert q["complete"] is False and len(q["open"]) == 1
        d2 = reply_dir(tmp_path, run_dir.name + "-r2", h1="    return y + 1 * 2\n\n")
        r2 = resolve(repo, run_dir, 1, q["open"][0]["i"], d2, task_specs)
        assert r2.returncode == 0, r2.stderr
        assert last_json(r2) == {"applied": True, "open": [], "remaining": [],
                                 "autoResolved": 0, "complete": True,
                                 "selfChecks": "ok"}
        m = materialize(repo, run_dir, 1, base_sha, task_specs)
        assert m.returncode == 0, m.stdout + m.stderr
        return last_json(m)["candidateSha"]

    by_branch = drive(tmp_path / "run-branch", branch_suite.do_fold,
                      branch_suite.do_resolve, branch_suite.do_materialize,
                      branch_specs)
    by_patch = drive(tmp_path / "run-patch", do_fold, do_resolve,
                     do_materialize, specs)

    # Identical candidate TREES — the fold is a function of content.
    assert (_git(repo, "rev-parse", by_branch + "^{tree}")
            == _git(repo, "rev-parse", by_patch + "^{tree}"))
    assert _git_bytes(repo, "show", by_patch + ":app.py") == (
        b"def a(x):\n    return x\n\ndef b(y):\n    return y + 1 * 2\n"
        b"\ndef c(z):\n    return z + 5\n")
    # The designed difference: branch tasks parent the candidate, patch
    # tasks cannot (there is no commit) — it sits on the integration line.
    assert parents_of(repo, by_branch) == [base_sha, heads["t1"], heads["t2"], t3[1]]
    assert parents_of(repo, by_patch) == [base_sha]
    # And the checkout never moved, either way.
    assert _git(repo, "status", "--porcelain") == ""
    assert _git(repo, "rev-parse", "HEAD") == base_sha

    # rehydrate re-derives every task from its patch file and agrees.
    log = tmp_path / "run-patch/frontier/wave-1/fold_log.jsonl"
    assert ff.rehydrate(repo, log).manifest()["app.py"].endswith("return z + 5\n")


def test_patch_carries_binary_mode_add_and_delete(tmp_path):
    """The materialize suite's repo plus a binary edit: modes are observed
    off the derived trees, a delete reaches the candidate, a created
    executable keeps its mode, and bytes round-trip through `--binary`."""
    repo, base_sha, heads = mat_suite.make_repo(tmp_path)
    # A binary path on the base, rewritten by t2 (so t2's diff needs --binary).
    _git(repo, "checkout", "-q", "integration")
    (repo / "blob.bin").write_bytes(b"\x00\x01\x02base")
    base2 = mat_suite.commit_and_capture(repo, "base+bin")
    _git(repo, "checkout", "-q", "-b", "t1b", base2)
    (repo / "app.py").write_text("a = 2\nb = 1\nc = 1\n")
    (repo / "run.sh").write_text("#!/bin/sh\necho t1\n")
    t1 = mat_suite.commit_and_capture(repo, "t1")
    _git(repo, "checkout", "-q", "-b", "t2b", base2)
    (repo / "app.py").write_text("a = 1\nb = 1\nc = 2\n")
    (repo / "other.txt").unlink()
    (repo / "new.sh").write_text("#!/bin/sh\necho new\n")
    os.chmod(repo / "new.sh", 0o755)
    (repo / "blob.bin").write_bytes(b"\x00\x01\x02t2")
    t2 = mat_suite.commit_and_capture(repo, "t2")
    _git(repo, "checkout", "-q", "integration")

    ordered = [("t1", t1), ("t2", t2)]
    specs = patch_specs(repo, base2, tmp_path, ordered)
    assert b"GIT binary patch" in specs[1][1].read_bytes()

    run_dir = tmp_path / "run"
    fold = do_fold(repo, run_dir, 1, base2, specs)
    assert fold.returncode == 0, fold.stderr
    assert last_json(fold)["clean"] is True
    m = do_materialize(repo, run_dir, 1, base2, specs)
    assert m.returncode == 0, m.stdout + m.stderr
    candidate = last_json(m)["candidateSha"]

    entries = mat_suite.tree_entries(repo, candidate)
    assert "other.txt" not in entries                       # the delete landed
    assert entries["new.sh"][0] == "100755"                 # creator's mode
    assert entries["run.sh"][0] == "100755"                 # base mode kept
    assert entries["link.txt"][0] == "120000"               # untouched survives
    assert _git_bytes(repo, "show", candidate + ":app.py") == b"a = 2\nb = 1\nc = 2\n"
    assert _git_bytes(repo, "show", candidate + ":blob.bin") == b"\x00\x01\x02t2"
    assert parents_of(repo, candidate) == [base2]

    # Byte-for-byte the tree a branch-input run of the same wave builds.
    by_branch = mat_suite.do_materialize(
        repo, _branch_run(repo, tmp_path, base2, ordered), 1, base2, ordered)
    assert by_branch.returncode == 0, by_branch.stdout + by_branch.stderr
    assert (_git(repo, "rev-parse", candidate + "^{tree}")
            == _git(repo, "rev-parse", last_json(by_branch)["candidateSha"] + "^{tree}"))


def _branch_run(repo, tmp_path, base_sha, heads):
    run_dir = tmp_path / "run-branch"
    r = mat_suite.do_fold(repo, run_dir, 1, base_sha, heads)
    assert r.returncode == 0, r.stderr
    return run_dir


def test_empty_patch_is_a_task_that_changed_nothing(tmp_path):
    repo, base_sha, heads = branch_suite.make_repo(tmp_path)
    empty = tmp_path / "patches" / "task-t0.patch"
    empty.parent.mkdir()
    empty.write_bytes(b"")
    specs = [("t0", empty)] + patch_specs(repo, base_sha, tmp_path, [("t1", heads["t1"])])

    run_dir = tmp_path / "run"
    r = do_fold(repo, run_dir, 1, base_sha, specs)
    assert r.returncode == 0, r.stderr
    assert last_json(r)["clean"] is True
    folds = [e for e in wave_events(run_dir) if e["type"] == "fold"]
    assert folds[0]["task"] == "t0"
    assert folds[0]["headSha"] == _git(repo, "rev-parse", base_sha + "^{tree}")


# --- refusals --------------------------------------------------------------


def test_a_patch_that_does_not_apply_refuses_exit_2_before_writing(tmp_path):
    """A patch cut against a different base is the patch-side analogue of an
    undescended head (#246): refused by name, and nothing is written."""
    repo, base_sha, heads = branch_suite.make_repo(tmp_path)
    # t2's diff against t1 (not base): its app.py preimage is t1's, absent at base.
    stale = tmp_path / "patches" / "task-t2.patch"
    write_patch(repo, heads["t1"], heads["t2"], stale)
    specs = patch_specs(repo, base_sha, tmp_path, [("t1", heads["t1"])]) + [("t2", stale)]

    run_dir = tmp_path / "run"
    r = do_fold(repo, run_dir, 1, base_sha, specs)
    assert r.returncode == 2, r.stdout + r.stderr
    assert "refusing wave 1: patch for task t2" in r.stderr
    assert "does not apply against base %s" % base_sha[:7] in r.stderr
    assert not (run_dir / "frontier").exists()
    assert _git(repo, "status", "--porcelain") == ""


def test_a_corrupt_patch_file_refuses_rather_than_reading_as_no_change(tmp_path):
    repo, base_sha, heads = branch_suite.make_repo(tmp_path)
    garbage = tmp_path / "patches" / "task-t1.patch"
    garbage.parent.mkdir()
    garbage.write_text("this is not a patch\n")
    r = do_fold(repo, tmp_path / "run", 1, base_sha, [("t1", garbage)])
    assert r.returncode == 2, r.stdout + r.stderr
    assert "patch for task t1" in r.stderr
    assert not (tmp_path / "run" / "frontier").exists()


def test_a_missing_patch_file_is_an_argument_error(tmp_path):
    repo, base_sha, _heads = branch_suite.make_repo(tmp_path)
    r = do_fold(repo, tmp_path / "run", 1, base_sha,
                [("t1", tmp_path / "nope.patch")])
    assert r.returncode == 2
    assert "no such file" in r.stderr


def test_a_wave_must_name_at_least_one_task(tmp_path):
    repo, base_sha, _heads = branch_suite.make_repo(tmp_path)
    r = run_cli("fold", "--repo", str(repo), "--run-dir", str(tmp_path / "run"),
                "--wave", "1", "--base", base_sha)
    assert r.returncode == 2
    assert "needs at least one task: --branch or --patch" in r.stderr


def test_a_patch_edited_after_it_folded_is_a_log_list_disagreement(tmp_path):
    """The log records the tree the patch yielded; a resolve that re-supplies
    an edited patch derives a different tree and is refused as the same
    disagreement a re-run branch is."""
    repo, base_sha, heads = branch_suite.make_repo(tmp_path)
    specs = patch_specs(repo, base_sha, tmp_path,
                        [("t1", heads["t1"]), ("t2", heads["t2"])])
    run_dir = tmp_path / "run"
    p = last_json(do_fold(repo, run_dir, 1, base_sha, specs))

    # t1 re-cut with a different edit after the fold recorded it.
    _git(repo, "checkout", "-q", "-b", "t1-again", base_sha)
    (repo / "app.py").write_text(branch_suite.T1_APP.replace("y + 1", "y + 9"))
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "t1 again")
    write_patch(repo, base_sha, "t1-again", specs[0][1])
    _git(repo, "checkout", "-q", base_sha)

    d = reply_dir(tmp_path, "reply", h1="    return y + 1 * 2\n\n")
    r = do_resolve(repo, run_dir, 1, p["open"][0]["i"], d, specs)
    assert r.returncode == 2, r.stdout + r.stderr
    assert "log/list disagreement" in r.stderr
    assert [e["type"] for e in wave_events(run_dir)] == ["base", "fold", "fold"]


def test_rehydrate_refuses_a_patch_that_no_longer_yields_the_recorded_tree(tmp_path):
    """materialize rehydrates from the log; a patch changed underneath it is a
    named fallback, not a candidate built from content the log never saw."""
    repo, base_sha, heads = branch_suite.make_repo(tmp_path)
    specs = patch_specs(repo, base_sha, tmp_path, [("t1", heads["t1"])])
    run_dir = tmp_path / "run"
    assert do_fold(repo, run_dir, 1, base_sha, specs).returncode == 0

    _git(repo, "checkout", "-q", "-b", "t1-again", base_sha)
    (repo / "app.py").write_text(branch_suite.T1_APP.replace("y + 1", "y + 9"))
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "t1 again")
    write_patch(repo, base_sha, "t1-again", specs[0][1])
    _git(repo, "checkout", "-q", base_sha)

    # The direct rehydrate names the disagreement…
    log = run_dir / "frontier/wave-1/fold_log.jsonl"
    try:
        ff.rehydrate(repo, log)
        assert False, "rehydrate accepted an edited patch"
    except ValueError as e:
        assert "the patch changed after it folded" in str(e)
    # …and materialize with the ORIGINAL tree supplied via --task-head still
    # rehydrates from the patch and falls back by that name.
    tree = [e for e in wave_events(run_dir) if e["type"] == "fold"][0]["headSha"]
    m = run_cli("materialize", "--repo", str(repo), "--run-dir", str(run_dir),
                "--wave", "1", "--prev-head", base_sha, "--task-head", "t1=" + tree)
    assert m.returncode == 3, m.stdout + m.stderr
    assert "the patch changed after it folded" in last_json(m)["fallback"]


# --- mixing, and the pure helper --------------------------------------------


def test_branch_and_patch_mix_in_argv_order(tmp_path):
    repo, base_sha, heads = branch_suite.make_repo(tmp_path)
    t3 = branch_suite.add_third_branch(repo, base_sha)
    (t2_patch,) = [p for _, p in patch_specs(repo, base_sha, tmp_path, [("t2", heads["t2"])])]
    run_dir = tmp_path / "run"
    r = run_cli("fold", "--repo", str(repo), "--run-dir", str(run_dir),
                "--wave", "1", "--base", base_sha,
                "--branch", "t3=%s:%s" % t3,
                "--patch", "t2=%s" % t2_patch,
                "--branch", "t1=t1:%s" % heads["t1"])
    assert r.returncode == 0, r.stderr
    folds = [(e["task"], e.get("patch")) for e in wave_events(run_dir) if e["type"] == "fold"]
    # t3 folds clean, t2 folds clean, t1 opens the app.py conflict — argv order.
    assert folds == [("t3", None), ("t2", str(t2_patch)), ("t1", None)]


def test_apply_patch_tree_is_deterministic_and_touches_no_ref(tmp_path):
    repo, base_sha, heads = branch_suite.make_repo(tmp_path)
    patch = write_patch(repo, base_sha, heads["t2"], tmp_path / "t2.patch")
    before = _git(repo, "for-each-ref")
    a = rw.apply_patch_tree(repo, base_sha, patch)
    b = rw.apply_patch_tree(repo, base_sha, patch)
    assert a == b == _git(repo, "rev-parse", heads["t2"] + "^{tree}")
    assert _git(repo, "for-each-ref") == before
    assert _git(repo, "status", "--porcelain") == ""
    # The repo's real index is untouched: the apply went through a temporary one.
    assert _git(repo, "diff", "--cached", "--name-only") == ""

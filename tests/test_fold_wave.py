"""fold_wave.py — the wave-scoped CLI, incremental (spec 2026-08-18 §1b).

`fold` pre-scans the whole wave for parks, then folds task by task until the
first fold that opens a conflict, writing its self-sufficient record
(fold_log.jsonl, per-conflict narrations + hunks files, conflicts.json,
fold_stats.json) and stopping there. `resolve` splices one hunk-scoped reply
into that narration, applies it, and — once the stop is fully resolved —
continues folding to the next stop or to completion. A re-issued `resolve` is
a stale refusal (exit 2), never a re-narration.

Every scenario is its own tmp_path git repo — no shared fixtures.
"""
import json
import subprocess
import sys
import threading
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
KERNEL = ROOT / "skills" / "ultrapowers" / "kernel"
CLI = str(KERNEL / "fold_wave.py")
sys.path.insert(0, str(KERNEL))
sys.path.insert(0, str(KERNEL / "vendor"))
import repo_weave as rw
import frontier_fold as ff
import fold_wave as fw

BASE_APP = "def a(x):\n    return x\n\ndef b(y):\n    return y\n\ndef c(z):\n    return z\n"
T1_APP = "def a(x):\n    return x\n\ndef b(y):\n    return y + 1\n\ndef c(z):\n    return z\n"
T2_APP = "def a(x):\n    return x\n\ndef b(y):\n    return y * 2\n\ndef c(z):\n    return z\n"
T3_APP = "def a(x):\n    return x\n\ndef b(y):\n    return y\n\ndef c(z):\n    return z + 5\n"


def _git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True,
                          capture_output=True, text=True).stdout.strip()


def _init(repo):
    repo.mkdir()
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "t@example.com")
    _git(repo, "config", "user.name", "T")


def make_repo(tmp_path):
    """Base commit (app.py: 3 short functions + other.txt) plus t1/t2
    branches editing app.py's `b` line differently — one genuine conflict —
    with t2 also deleting other.txt."""
    repo = tmp_path / "repo"
    _init(repo)
    (repo / "app.py").write_text(BASE_APP)
    (repo / "other.txt").write_text("hello\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "base")
    base_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", "-b", "t1", base_sha)
    (repo / "app.py").write_text(T1_APP)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "t1")
    t1_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", "-b", "t2", base_sha)
    (repo / "app.py").write_text(T2_APP)
    (repo / "other.txt").unlink()
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "t2")
    t2_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", base_sha)
    return repo, base_sha, {"t1": t1_sha, "t2": t2_sha}


def add_third_branch(repo, base_sha):
    """t3: a third writer of app.py, touching only its `c` line. Returns
    `(branchName, headSha)`.

    Under the incremental protocol t3 is what makes the wave stop twice: the
    fold stops at t2's conflict with t3 still in `remaining`, and folding t3
    after the resolution opens a second conflict — `apply_resolution` rewrites
    the whole file's weave, so a later writer of the same file always
    re-narrates against the resolved frontier.
    """
    _git(repo, "checkout", "-q", "-b", "t3", base_sha)
    (repo / "app.py").write_text(T3_APP)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "t3")
    t3_sha = _git(repo, "rev-parse", "HEAD")
    _git(repo, "checkout", "-q", base_sha)
    return "t3", t3_sha


def make_binary_park_repo(tmp_path):
    """t1 adds `asset.bin` as binary, t2 adds the same path as text: the
    text/bytes presence pairing, which carries no annotated narration and so
    parks. Unlike a size park it survives the cap's retirement."""
    repo = tmp_path / "park"
    _init(repo)
    (repo / "keep.txt").write_text("keep\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "base")
    base_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", "-b", "t1", base_sha)
    (repo / "asset.bin").write_bytes(b"\x00\x01\x02binary\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "t1")
    t1_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", "-b", "t2", base_sha)
    (repo / "asset.bin").write_text("plain text\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "t2")
    t2_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", base_sha)
    return repo, base_sha, {"t1": t1_sha, "t2": t2_sha}


def make_union_scope_repo(tmp_path):
    """Base commit with app.py + shared.py, both pre-existing.

    Three base-existing paths, folded in the order t1, t2, t3:

    * `app.py`  — single writer (t1 only): the modify-as-modify path itself.
    * `early.py` — contested by t1 and t2, untouched by t3.
    * `late.py`  — contested by t2 and t3, untouched by t1.

    Every contested path is in the base, so `_text_kind` must report `lines`.
    No single branch's touched set covers both contested paths, so ANY base
    scope narrower than the union of all three heads drops one of them out of
    the base and turns its collision into `add/add` — a first-branch (or
    per-task streaming) scope loses `late.py`, a last-branch scope loses
    `early.py`. That is the falsifier this shape exists for.
    """
    repo = tmp_path / "unionscope"
    _init(repo)
    (repo / "app.py").write_text("x = 1\n")
    (repo / "early.py").write_text("e = 1\n")
    (repo / "late.py").write_text("l = 1\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "base")
    base_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", "-b", "t1", base_sha)
    (repo / "app.py").write_text("x = 2\n")
    (repo / "early.py").write_text("e = 2\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "t1")
    t1_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", "-b", "t2", base_sha)
    (repo / "early.py").write_text("e = 3\n")
    (repo / "late.py").write_text("l = 2\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "t2")
    t2_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", "-b", "t3", base_sha)
    (repo / "late.py").write_text("l = 3\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "t3")
    t3_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", base_sha)
    return repo, base_sha, {"t1": t1_sha, "t2": t2_sha, "t3": t3_sha}


def make_two_path_stop_repo(tmp_path):
    """Two writers of the SAME two files, colliding on both: one fold opens
    two narrations at one epoch, which is the stop the work-list has to
    drain before the frontier may move again."""
    repo = tmp_path / "twopath"
    _init(repo)
    (repo / "a.py").write_text("a = 1\n")
    (repo / "b.py").write_text("b = 1\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "base")
    base_sha = _git(repo, "rev-parse", "HEAD")

    for name, value in (("t1", 2), ("t2", 3)):
        _git(repo, "checkout", "-q", "-b", name, base_sha)
        (repo / "a.py").write_text("a = %d\n" % value)
        (repo / "b.py").write_text("b = %d\n" % value)
        _git(repo, "add", "-A")
        _git(repo, "commit", "-qm", name)

    heads = {n: _git(repo, "rev-parse", n) for n in ("t1", "t2")}
    _git(repo, "checkout", "-q", base_sha)
    return repo, base_sha, heads


def make_marker_shaped_repo(tmp_path):
    """A repo whose own source quotes a kernel marker form.

    The narration then carries a content line the hunk grammar cannot tell
    from a delimiter, so `derive` refuses to guess and the conflict parks.
    """
    repo = tmp_path / "markershaped"
    _init(repo)
    (repo / "doc.md").write_text("a = 1\n>>>>>>> end conflict\nc = 1\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "base")
    base_sha = _git(repo, "rev-parse", "HEAD")

    for name, value in (("t1", 2), ("t2", 3)):
        _git(repo, "checkout", "-q", "-b", name, base_sha)
        (repo / "doc.md").write_text(
            "a = %d\n>>>>>>> end conflict\nc = 1\n" % value)
        _git(repo, "add", "-A")
        _git(repo, "commit", "-qm", name)

    heads = {n: _git(repo, "rev-parse", n) for n in ("t1", "t2")}
    _git(repo, "checkout", "-q", base_sha)
    return repo, base_sha, heads


def make_big_conflict_repo(tmp_path):
    """A ~1200-line file both branches edit at the same line, differently: a
    genuine conflict far past the retired 400-line resolver cap."""
    lines = ["line %d" % i for i in range(1200)]
    base_text = "\n".join(lines) + "\n"
    t1_lines = list(lines)
    t1_lines[600] = "line 600 (t1)"
    t2_lines = list(lines)
    t2_lines[600] = "line 600 (t2)"

    repo = tmp_path / "big"
    _init(repo)
    (repo / "big.py").write_text(base_text)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "base")
    base_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", "-b", "t1", base_sha)
    (repo / "big.py").write_text("\n".join(t1_lines) + "\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "t1")
    t1_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", "-b", "t2", base_sha)
    (repo / "big.py").write_text("\n".join(t2_lines) + "\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "t2")
    t2_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", base_sha)
    return repo, base_sha, {"t1": t1_sha, "t2": t2_sha}


def make_single_writer_repo(tmp_path, n_lines, name="huge"):
    """One base-existing text file of `n_lines`, edited by exactly ONE branch.

    `_fold_text` calls `merge_states` for every base-existing touched path even
    with a single writer, so this is the cheapest shape that drives the kernel's
    per-line recursion — no conflict required.
    """
    repo = tmp_path / name
    _init(repo)
    lines = ["line %d" % i for i in range(n_lines)]
    (repo / "huge.py").write_text("\n".join(lines) + "\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "base")
    base_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", "-b", "t1", base_sha)
    edited = list(lines)
    edited[n_lines // 2] = "line %d (t1)" % (n_lines // 2)
    (repo / "huge.py").write_text("\n".join(edited) + "\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "t1")
    t1_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", base_sha)
    return repo, base_sha, t1_sha, "\n".join(edited) + "\n"


def run_cli(*args):
    return subprocess.run([sys.executable, CLI, *args],
                          capture_output=True, text=True)


def do_fold(repo, run_dir, wave, base_sha, branch_specs):
    """branch_specs: [(taskId, branchName, headSha), ...] in task-index order."""
    args = ["fold", "--repo", str(repo), "--run-dir", str(run_dir),
            "--wave", str(wave), "--base", base_sha]
    for tid, name, sha in branch_specs:
        args += ["--branch", "%s=%s:%s" % (tid, name, sha)]
    return run_cli(*args)


def do_resolve(repo, run_dir, wave, i, reply_dir, branch_specs):
    """The `resolve` mirror of `do_fold`: the wave's task list is re-supplied
    on every call, and the narration is addressed by its conflicts.json `i`."""
    args = ["resolve", "--repo", str(repo), "--run-dir", str(run_dir),
            "--wave", str(wave), "--conflict", str(i),
            "--reply-dir", str(reply_dir)]
    for tid, name, sha in branch_specs:
        args += ["--branch", "%s=%s:%s" % (tid, name, sha)]
    return run_cli(*args)


def _reply_dir(tmp_path, name, **hunk_files):
    d = tmp_path / name
    d.mkdir()
    for hid, text in hunk_files.items():
        (d / (hid + ".txt")).write_text(text)
    return d


def last_json(result):
    return json.loads(result.stdout.strip().splitlines()[-1])


def wave_events(run_dir, wave=1):
    log = run_dir / "frontier" / ("wave-%d" % wave) / "fold_log.jsonl"
    return [json.loads(l) for l in log.read_text().splitlines()]


# --- fold ---------------------------------------------------------------


def test_fold_writes_log_narrations_and_index_at_the_first_stop(tmp_path):
    repo, base_sha, heads = make_repo(tmp_path)
    run_dir = tmp_path / "run"
    result = do_fold(repo, run_dir, 1, base_sha,
                     [("t1", "t1", heads["t1"]), ("t2", "t2", heads["t2"])])
    assert result.returncode == 0, result.stderr

    wave_dir = run_dir / "frontier" / "wave-1"
    events = wave_events(run_dir)
    assert events[0] == {"type": "base", "sha": base_sha}
    fold_events = [e for e in events if e["type"] == "fold"]
    assert [(e["task"], e["headSha"]) for e in fold_events] == [
        ("t1", heads["t1"]), ("t2", heads["t2"])]

    index = json.loads((wave_dir / "conflicts.json").read_text())
    assert len(index) == 1
    entry = index[0]
    assert entry["path"] == "app.py" and entry["dispatchable"] is True
    narration = (wave_dir / ("conflict-%d.txt" % entry["i"])).read_text()
    assert any(line.startswith(rw.MARKERS) for line in narration.splitlines())

    payload = last_json(result)
    assert payload == {"clean": False, "conflicts": 1, "dispatchable": 1,
                       "parked": 0, "complete": False, "remaining": [],
                       "open": [{"i": 1, "path": "app.py", "kind": "lines",
                                 "epoch": 2,
                                 "hunksFile": str(wave_dir / "conflict-1.hunks.txt"),
                                 "hunkCount": 1}]}
    # Every task folded here (the conflict opened on the last one), so
    # `remaining` is empty — but the wave is not `complete` while the
    # narration is unresolved.
    # `maxLines` is the largest text file this call folded: app.py's 9
    # `split_lines` entries (8 newlines + the trailing "").
    assert json.loads((wave_dir / "fold_stats.json").read_text())["maxLines"] == [9]


def test_fold_refuses_preexisting_log(tmp_path):
    repo, base_sha, heads = make_repo(tmp_path)
    run_dir = tmp_path / "run"
    branch_specs = [("t1", "t1", heads["t1"]), ("t2", "t2", heads["t2"])]
    first = do_fold(repo, run_dir, 1, base_sha, branch_specs)
    assert first.returncode == 0, first.stderr

    second = do_fold(repo, run_dir, 1, base_sha, branch_specs)
    assert second.returncode == 2
    assert "fold log already exists for wave 1" in second.stderr


def test_fold_scoped_snapshot_folds_single_writer_modify_as_modify(tmp_path):
    """The union-then-fold ordering contract, made falsifiable.

    `app.py` is a base-existing path with a single writer (t1, folded first),
    which must fold as a modify. It cannot carry the contract on its own — a
    single-writer path materializes identically whether it is scoped as a
    modify or as an add — so the falsifier rides the two contested paths
    `early.py` (t1+t2) and `late.py` (t2+t3): both are in the base, so both
    must be reported `lines`, and no single branch's touched set covers both.
    Narrow cmd_fold's scope to any one head and one of them flips to
    `add/add`, which also diverges cmd_fold's manifest from `rehydrate`'s
    (union-scoped), tripping the replay self-check to exit 3.
    """
    repo, base_sha, heads = make_union_scope_repo(tmp_path)
    run_dir = tmp_path / "run"
    specs = [("t1", "t1", heads["t1"]), ("t2", "t2", heads["t2"]),
             ("t3", "t3", heads["t3"])]
    result = do_fold(repo, run_dir, 1, base_sha, specs)
    assert result.returncode == 0, result.stdout + result.stderr

    wave_dir = run_dir / "frontier" / "wave-1"
    # The fold stops at t2, which is where `early.py` first collides.
    first = last_json(result)
    assert first["complete"] is False and first["remaining"] == ["t3"]
    assert [(e["path"], e["kind"], e["epoch"]) for e in first["open"]] == [
        ("early.py", "lines", 2)]

    # Resolving it continues the fold into t3, where `late.py` collides. Both
    # contested paths are in the base, so BOTH must be reported `lines`: a
    # scope narrowed to any single head would drop one out of the base and
    # flip it to `add/add`.
    d1 = _reply_dir(tmp_path, "reply-1", h1="e = 9\n")
    second = do_resolve(repo, run_dir, 1, first["open"][0]["i"], d1, specs)
    assert second.returncode == 0, second.stdout + second.stderr
    q = last_json(second)
    assert q["applied"] is True and q["complete"] is False and q["remaining"] == []
    assert [(e["path"], e["kind"], e["epoch"]) for e in q["open"]] == [
        ("late.py", "lines", 4)]

    index = json.loads((wave_dir / "conflicts.json").read_text())
    assert [(e["path"], e["kind"]) for e in index] == [
        ("early.py", "lines"), ("late.py", "lines")]
    assert not any(e["kind"] == "add/add" for e in index)

    # selfChecks=="ok" pins the live manifest equal to rehydrate's, so
    # reading the manifest through rehydrate also asserts the CLI's scoping.
    d2 = _reply_dir(tmp_path, "reply-2", h1="l = 9\n")
    third = do_resolve(repo, run_dir, 1, q["open"][0]["i"], d2, specs)
    assert third.returncode == 0, third.stdout + third.stderr
    done = last_json(third)
    assert done["complete"] is True and done["selfChecks"] == "ok"

    manifest = ff.rehydrate(repo, wave_dir / "fold_log.jsonl").manifest()
    assert manifest["app.py"] == "x = 2\n"


def test_a_1200_line_conflict_dispatches_now_that_the_cap_is_retired(tmp_path):
    """The size term is gone: a big genuine conflict is briefed, not parked.

    This shape used to be the cap's park (1,200 lines > the retired 400-line
    resolver cap). With the size term retired the wave stops on it and
    dispatches a hunk-scoped brief exactly as a small conflict does — which is
    the whole point of Phase 1: fold reaches the files that carry contention.
    """
    repo, base_sha, heads = make_big_conflict_repo(tmp_path)
    run_dir = tmp_path / "run"
    result = do_fold(repo, run_dir, 1, base_sha,
                     [("t1", "t1", heads["t1"]), ("t2", "t2", heads["t2"])])
    assert result.returncode == 0, result.stderr

    wave_dir = run_dir / "frontier" / "wave-1"
    index = json.loads((wave_dir / "conflicts.json").read_text())
    assert [(e["path"], e["kind"], e["dispatchable"]) for e in index] == [
        ("big.py", "lines", True)]
    assert index[0]["reason"] == "" and index[0]["hunkCount"] >= 1
    assert Path(index[0]["hunksFile"]).exists()

    payload = last_json(result)
    assert payload["parked"] == 0
    assert payload["dispatchable"] == 1 and payload["conflicts"] == 1
    assert [o["path"] for o in payload["open"]] == ["big.py"]
    assert payload["complete"] is False and payload["remaining"] == []
    assert (wave_dir / "fold_log.jsonl").exists()


def test_fold_of_a_10k_line_single_writer_file_stays_inside_the_exit_contract(tmp_path):
    """A file far past ordinary recursion depth must never crash the CLI.

    10,500 lines needs ~21,004 kernel frames, and `_fold_text` merges it even
    though only one branch wrote it. The fold runs on the 1 GiB-stack kernel
    thread with `THREAD_RECURSION_LIMIT` fixed at 1,000,000, so this size is
    ordinarily absorbed — but whatever the platform's stack allows, the
    invocation must stay inside the documented {0, 2, 3} exit contract, print
    its one-line JSON, and leave the wave's artifacts on disk; if the thread
    could not absorb it, the outcome is a NAMED kernel-limit park in the
    conflicts index, never an uncaught raise.
    """
    n = 10500
    repo, base_sha, t1_sha, t1_text = make_single_writer_repo(tmp_path, n)
    run_dir = tmp_path / "run"
    result = do_fold(repo, run_dir, 1, base_sha, [("t1", "t1", t1_sha)])

    assert result.returncode in (0, 2, 3), result.stderr
    payload = last_json(result)              # stdout JSON exists in every case
    wave_dir = run_dir / "frontier" / "wave-1"
    assert (wave_dir / "fold_log.jsonl").exists()
    index = json.loads((wave_dir / "conflicts.json").read_text())

    parks = [e for e in index if e["kind"] == "kernel-limit"]
    if parks:
        assert result.returncode == 3
        assert parks[0]["dispatchable"] is False
        assert "recursion" in parks[0]["reason"] and "huge.py" in parks[0]["reason"]
        assert payload["parked"] >= 1
        assert payload["selfChecks"].startswith("failed:")
    else:
        # The kernel thread absorbed it: an ordinary clean single-task fold,
        # which folds everything and therefore completes in the one call.
        assert result.returncode == 0
        assert payload == {"clean": True, "conflicts": 0, "dispatchable": 0,
                           "parked": 0, "open": [], "remaining": [],
                           "complete": True, "selfChecks": "ok"}
        # In-process too: the kernel needs the big-stack thread wherever it is
        # driven, which is why the helper is the CLI's, not a local hack.
        manifest = fw.run_on_kernel_thread(
            lambda: ff.rehydrate(repo, wave_dir / "fold_log.jsonl").manifest())
        assert manifest["huge.py"] == t1_text


def test_fold_parks_a_named_kernel_limit_when_the_thread_limit_is_insufficient(
        tmp_path, monkeypatch, capsys):
    """The kernel-limit park lane — now the ONLY ceiling left once the sized
    cap retired — forced deterministically by patching `THREAD_RECURSION_LIMIT`
    low, rather than relying on a corpus big enough to overrun the real 1M
    limit. A 3,000-line single-writer fold comfortably clears the fixed
    limit, so this is the mutation: with the patch, the same fold must park
    with a NAMED kernel-limit entry and exit 3; without it, it must not.

    Driven in-process (`fw.main`, not the subprocess `run_cli`/`do_fold`
    helpers) because the monkeypatch only reaches the CLI's own process.
    """
    n = 3000
    repo, base_sha, t1_sha, _ = make_single_writer_repo(tmp_path, n)
    run_dir = tmp_path / "run"
    argv = ["fold", "--repo", str(repo), "--run-dir", str(run_dir),
            "--wave", "1", "--base", base_sha,
            "--branch", "t1=t1:%s" % t1_sha]

    prior_limit = sys.getrecursionlimit()
    monkeypatch.setattr(fw, "THREAD_RECURSION_LIMIT", 200)
    code = fw.main(argv)
    out = capsys.readouterr().out
    # The caller's process-global recursion limit is restored even on the
    # park path — `run_on_kernel_thread`'s `finally` runs whether `fn` raised
    # or returned.
    assert sys.getrecursionlimit() == prior_limit

    assert code == 3
    payload = json.loads(out.strip().splitlines()[-1])
    assert payload["clean"] is False
    assert payload["parked"] >= 1
    assert payload["selfChecks"].startswith("failed: kernel recursion limit")

    wave_dir = run_dir / "frontier" / "wave-1"
    index = json.loads((wave_dir / "conflicts.json").read_text())
    parks = [e for e in index if e["kind"] == "kernel-limit"]
    assert len(parks) == 1
    entry = parks[0]
    assert entry["dispatchable"] is False
    for token in ("kernel recursion limit", "task t1", "huge.py"):
        assert token in entry["reason"]
    assert (wave_dir / ("conflict-%d.txt" % entry["i"])).exists()
    assert (wave_dir / "fold_log.jsonl").exists()

    # Mutation check: remove the low patch and the same fold must NOT park —
    # it is well inside the real 1,000,000 limit, so the clean path runs.
    monkeypatch.setattr(fw, "THREAD_RECURSION_LIMIT", 1_000_000)
    run_dir2 = tmp_path / "run2"
    argv2 = ["fold", "--repo", str(repo), "--run-dir", str(run_dir2),
             "--wave", "1", "--base", base_sha,
             "--branch", "t1=t1:%s" % t1_sha]
    code2 = fw.main(argv2)
    payload2 = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert code2 == 0 and payload2["parked"] == 0


def test_fold_of_a_100k_line_pair_never_segfaults(tmp_path):
    """Spec §1d pin: 100k-line two-writer fold succeeds on the running
    interpreter (on 3.9 the big-stack thread is what makes it true) — never
    exit 139.

    Both writers touch `huge.py` at different ends, so the kernel merges
    ~100,001 entries per fold — ~200k frames, far past any stack the main
    thread has. Before the fold thread this invocation died on a segfault,
    an exit outside the documented {0, 2, 3} contract with no stdout JSON at
    all; the first assert is the one that catches that regression.
    """
    n = 100_000
    repo, base_sha, t1_sha, _ = make_single_writer_repo(tmp_path, n)
    # `make_single_writer_repo` builds one branch; add a second writer editing
    # the other end of the same file.
    _git(repo, "checkout", "-q", "-b", "t2", base_sha)
    p = repo / "huge.py"
    lines = p.read_text().split("\n")
    lines[5] = "# t2 edit"
    p.write_text("\n".join(lines))
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "t2")
    t2_sha = _git(repo, "rev-parse", "HEAD")
    _git(repo, "checkout", "-q", base_sha)

    r = do_fold(repo, tmp_path / "run", 1, base_sha,
                [("t1", "t1", t1_sha), ("t2", "t2", t2_sha)])
    assert r.returncode in (0, 3), (r.returncode, r.stderr[-500:])  # never 139/-11
    assert r.returncode == 0, r.stderr[-500:]
    payload = last_json(r)
    assert payload["clean"] is True and payload["complete"] is True
    assert payload["selfChecks"] == "ok"


# --- the big-stack kernel thread ------------------------------------------


def _distinct_limit(current):
    """A recursion limit that is neither the current one nor the thread's.

    Deep enough for pytest's own frames, and different from `current` so an
    assertion against it cannot pass by accident.
    """
    candidate = 4321 if current != 4321 else 4322
    assert candidate not in (current, fw.THREAD_RECURSION_LIMIT)
    return candidate


def test_run_on_kernel_thread_marshals_result_and_sets_the_fixed_limit():
    """The wrapper returns the callee's value and the callee sees the fixed
    limit — the thread's limit is what replaced the sized bound.

    The caller's limit is asserted against a SENTINEL this test installs, not
    against whatever the interpreter happened to be carrying: because
    `sys.setrecursionlimit` is interpreter-global rather than per-thread, an
    earlier in-process `run_on_kernel_thread` call would otherwise leave
    1_000_000 behind and make a broken restore look green.
    """
    seen = {}

    def probe(a, b=0):
        seen["limit"] = sys.getrecursionlimit()
        seen["thread"] = threading.current_thread().name
        return a + b

    outer = sys.getrecursionlimit()
    sentinel = _distinct_limit(outer)
    sys.setrecursionlimit(sentinel)
    try:
        assert fw.run_on_kernel_thread(probe, 2, b=40) == 42
        assert seen["limit"] == fw.THREAD_RECURSION_LIMIT == 1_000_000
        assert seen["thread"] == "fold-kernel"
        assert fw.STACK_BYTES == 1 << 30
        assert sys.getrecursionlimit() == sentinel   # restored, not leaked
    finally:
        sys.setrecursionlimit(outer)


def test_run_on_kernel_thread_restores_the_caller_limit_after_a_raise():
    """The restore is in a `finally`, so a raising callee leaks nothing either.

    Without it, one failed fold would leave the whole interpreter at
    1_000_000 — and a later runaway recursion would exhaust the C stack and
    segfault instead of raising the `RecursionError` the kernel-limit park
    lane is built on.
    """
    def boom():
        raise ValueError("kaboom")

    outer = sys.getrecursionlimit()
    sentinel = _distinct_limit(outer)
    sys.setrecursionlimit(sentinel)
    try:
        with pytest.raises(ValueError, match="kaboom"):
            fw.run_on_kernel_thread(boom)
        assert sys.getrecursionlimit() == sentinel
    finally:
        sys.setrecursionlimit(outer)


def test_run_on_kernel_thread_reraises_including_systemexit():
    """Exceptions are marshalled back so exit codes are unchanged: a
    `SystemExit` raised inside the kernel must still terminate the CLI with
    its own code, not be swallowed into a silent success."""
    def boom():
        raise ValueError("kaboom")

    with pytest.raises(ValueError, match="kaboom"):
        fw.run_on_kernel_thread(boom)

    def bail():
        raise SystemExit(3)

    with pytest.raises(SystemExit) as excinfo:
        fw.run_on_kernel_thread(bail)
    assert excinfo.value.code == 3


def test_run_on_kernel_thread_falls_back_to_the_main_thread(monkeypatch, capsys):
    """A platform that refuses the 1 GiB stack must still run the work.

    Both refusal shapes — `ValueError` from `threading.stack_size` and
    `RuntimeError` from `Thread.start()` — fall through to a main-thread call
    plus exactly one stderr line, so the CLI's exit codes never change.
    """
    for exc, label in ((ValueError("size not valid"), "stack_size"),
                       (RuntimeError("can't start new thread"), "start")):
        def refuse(*_a, **_k):
            raise exc
        if label == "stack_size":
            monkeypatch.setattr(fw.threading, "stack_size", refuse)
        else:
            monkeypatch.setattr(fw.threading, "stack_size", lambda _n: None)
            monkeypatch.setattr(fw.threading.Thread, "start", refuse)

        assert fw.run_on_kernel_thread(lambda x: x * 3, 5) == 15
        err = capsys.readouterr().err.strip().splitlines()
        assert len(err) == 1
        assert err[0].startswith("fold_wave: big-stack thread unavailable")
        monkeypatch.undo()


def test_pre_scan_reports_parks_before_any_narration(tmp_path):
    """No resolver is ever spent on a wave that will park.

    The pre-scan folds the whole wave in memory first; a park anywhere in it
    is reported up front, with no fold log written at all — so nothing can
    dispatch a resolver against a half-folded frontier that is going to be
    thrown away.
    """
    repo, base_sha, heads = make_binary_park_repo(tmp_path)
    run_dir = tmp_path / "run"
    r = do_fold(repo, run_dir, 1, base_sha,
                [("t1", "t1", heads["t1"]), ("t2", "t2", heads["t2"])])
    assert r.returncode == 0, r.stderr
    p = last_json(r)
    assert p["parked"] == 1 and p["dispatchable"] == 0 and p["open"] == []
    assert p["complete"] is False and p["remaining"] == ["t1", "t2"]

    wave_dir = run_dir / "frontier" / "wave-1"
    assert not (wave_dir / "fold_log.jsonl").exists()
    idx = json.loads((wave_dir / "conflicts.json").read_text())
    assert all(e["dispatchable"] is False for e in idx)
    assert [(e["i"], e["path"], e["kind"]) for e in idx] == [
        (1, "asset.bin", "binary")]
    assert (wave_dir / "conflict-1.txt").exists()


def test_marker_shaped_content_parks_with_a_named_reason(tmp_path):
    """A narration the hunk grammar cannot delimit parks, never guesses."""
    repo, base_sha, heads = make_marker_shaped_repo(tmp_path)
    run_dir = tmp_path / "run"
    r = do_fold(repo, run_dir, 1, base_sha,
                [("t1", "t1", heads["t1"]), ("t2", "t2", heads["t2"])])
    assert r.returncode == 0, r.stderr
    p = last_json(r)
    assert p["parked"] == 1 and p["dispatchable"] == 0

    idx = json.loads((run_dir / "frontier/wave-1/conflicts.json").read_text())
    assert len(idx) == 1
    assert idx[0]["dispatchable"] is False
    assert idx[0]["reason"] == "marker-shaped content in doc.md"
    assert idx[0]["hunksFile"] == "" and idx[0]["hunkCount"] == 0
    assert not (run_dir / "frontier/wave-1/fold_log.jsonl").exists()


# --- the incremental protocol ---------------------------------------------


def test_fold_stops_at_first_conflicting_fold_and_reports_remaining(tmp_path):
    repo, base_sha, heads = make_repo(tmp_path)
    t3 = add_third_branch(repo, base_sha)                 # (name, sha) editing c()
    run_dir = tmp_path / "run"
    specs = [("t1", "t1", heads["t1"]), ("t2", "t2", heads["t2"]), ("t3", t3[0], t3[1])]
    r = do_fold(repo, run_dir, 1, base_sha, specs)
    assert r.returncode == 0, r.stderr
    p = last_json(r)
    assert p["complete"] is False and p["remaining"] == ["t3"]
    assert p["conflicts"] == p["dispatchable"] == len(p["open"]) == 1
    e = p["open"][0]
    assert e["path"] == "app.py" and e["hunkCount"] == 1
    assert Path(e["hunksFile"]).is_file() and "HUNK h1" in Path(e["hunksFile"]).read_text()
    assert "selfChecks" not in p                           # a stop reply carries none
    events = wave_events(run_dir)
    assert [ev["task"] for ev in events if ev["type"] == "fold"] == ["t1", "t2"]


def test_resolve_applies_then_continues_to_completion_with_self_checks(tmp_path):
    """Resolve -> continue folding -> the next stop -> resolve -> complete.

    t3 writes app.py too, and `apply_resolution` rewrites the whole file's
    weave, so folding t3 after the first resolution narrates a second
    conflict against the resolved frontier. The wave therefore completes on
    the SECOND resolve — which is the work-list the engine loop runs — and
    the self-checks ride whichever call completes it.
    """
    repo, base_sha, heads = make_repo(tmp_path)
    t3 = add_third_branch(repo, base_sha)
    run_dir = tmp_path / "run"
    specs = [("t1", "t1", heads["t1"]), ("t2", "t2", heads["t2"]), ("t3", t3[0], t3[1])]
    p = last_json(do_fold(repo, run_dir, 1, base_sha, specs))

    d = _reply_dir(tmp_path, "reply-1-1", h1="    return y + 1 * 2\n\n")
    r = do_resolve(repo, run_dir, 1, p["open"][0]["i"], d, specs)
    assert r.returncode == 0, r.stderr
    q = last_json(r)
    assert q["applied"] is True and q["complete"] is False and q["remaining"] == []
    assert q["conflicts"] == q["dispatchable"] == len(q["open"]) == 1
    assert q["open"][0]["path"] == "app.py" and q["open"][0]["i"] == 2
    assert "selfChecks" not in q

    d2 = _reply_dir(tmp_path, "reply-2-1", h1="    return y + 1 * 2\n\n")
    r2 = do_resolve(repo, run_dir, 1, q["open"][0]["i"], d2, specs)
    assert r2.returncode == 0, r2.stderr
    assert last_json(r2) == {"applied": True, "open": [], "remaining": [],
                             "complete": True, "selfChecks": "ok"}

    assert [ev["type"] for ev in wave_events(run_dir)] == [
        "base", "fold", "fold", "resolve", "fold", "resolve"]
    stats = json.loads((run_dir / "frontier/wave-1/fold_stats.json").read_text())
    assert len(stats["maxLines"]) >= 1

    manifest = ff.rehydrate(
        repo, run_dir / "frontier/wave-1/fold_log.jsonl").manifest()
    assert manifest["app.py"] == (
        "def a(x):\n    return x\n\ndef b(y):\n    return y + 1 * 2\n"
        "\ndef c(z):\n    return z + 5\n")


def test_resolve_splices_hunk_replies_and_appends_the_lines_event(tmp_path):
    """The reply is hunk-scoped; the log still records the whole file.

    Nothing below the splice changes: `apply_resolution` takes the same
    whole-file line list it always took, and the context lines — which the
    reply grammar makes inexpressible — come through byte-identical.
    """
    repo, base_sha, heads = make_repo(tmp_path)
    run_dir = tmp_path / "run"
    specs = [("t1", "t1", heads["t1"]), ("t2", "t2", heads["t2"])]
    p = last_json(do_fold(repo, run_dir, 1, base_sha, specs))

    d = _reply_dir(tmp_path, "reply-1-1", h1="    return 0\n\n")
    result = do_resolve(repo, run_dir, 1, p["open"][0]["i"], d, specs)
    assert result.returncode == 0, result.stderr
    assert last_json(result) == {"applied": True, "open": [], "remaining": [],
                                 "complete": True, "selfChecks": "ok"}

    whole = ("def a(x):\n    return x\n\ndef b(y):\n    return 0\n"
             "\ndef c(z):\n    return z\n")
    events = wave_events(run_dir)
    assert events[-1]["type"] == "resolve"
    assert events[-1]["path"] == "app.py"
    assert events[-1]["lines"] == rw.split_lines(whole)

    manifest = ff.rehydrate(
        repo, run_dir / "frontier/wave-1/fold_log.jsonl").manifest()
    assert manifest["app.py"] == whole


def test_reissued_resolve_is_a_stale_refusal_not_a_renarration(tmp_path):
    repo, base_sha, heads = make_repo(tmp_path)
    t3 = add_third_branch(repo, base_sha)
    run_dir = tmp_path / "run"
    specs = [("t1", "t1", heads["t1"]), ("t2", "t2", heads["t2"]), ("t3", t3[0], t3[1])]
    p = last_json(do_fold(repo, run_dir, 1, base_sha, specs))
    d = _reply_dir(tmp_path, "reply-1-1", h1="    return y + 1 * 2\n\n")
    i = p["open"][0]["i"]
    assert do_resolve(repo, run_dir, 1, i, d, specs).returncode == 0
    before = json.loads((run_dir / "frontier/wave-1/conflicts.json").read_text())

    r = do_resolve(repo, run_dir, 1, i, d, specs)      # the same command again
    assert r.returncode == 2 and last_json(r) == {"applied": False, "stale": True}
    # No re-narration: the index is untouched and nothing reached the log.
    assert json.loads(
        (run_dir / "frontier/wave-1/conflicts.json").read_text()) == before
    assert [ev["type"] for ev in wave_events(run_dir)] == [
        "base", "fold", "fold", "resolve", "fold"]


def test_a_stop_with_two_open_paths_waits_for_both(tmp_path):
    """Folding continues only once EVERY entry of the stop is applied.

    A fold that opens two paths narrated both against the same frontier
    state; letting the first reply move the frontier would make the second
    one stale before its resolver ever ran.
    """
    repo, base_sha, heads = make_two_path_stop_repo(tmp_path)
    run_dir = tmp_path / "run"
    specs = [("t1", "t1", heads["t1"]), ("t2", "t2", heads["t2"])]
    p = last_json(do_fold(repo, run_dir, 1, base_sha, specs))
    assert p["conflicts"] == p["dispatchable"] == len(p["open"]) == 2
    assert sorted(e["path"] for e in p["open"]) == ["a.py", "b.py"]
    assert len({e["epoch"] for e in p["open"]}) == 1     # one fold, one epoch

    first, second = p["open"][0], p["open"][1]
    r = do_resolve(repo, run_dir, 1, first["i"],
                   _reply_dir(tmp_path, "reply-a", h1="%s = 9\n" % first["path"][0]),
                   specs)
    assert r.returncode == 0, r.stderr
    assert last_json(r) == {"applied": True, "waiting": [second["i"]]}

    r2 = do_resolve(repo, run_dir, 1, second["i"],
                    _reply_dir(tmp_path, "reply-b", h1="%s = 9\n" % second["path"][0]),
                    specs)
    assert r2.returncode == 0, r2.stderr
    assert last_json(r2) == {"applied": True, "open": [], "remaining": [],
                             "complete": True, "selfChecks": "ok"}

    manifest = ff.rehydrate(
        repo, run_dir / "frontier/wave-1/fold_log.jsonl").manifest()
    assert manifest == {"a.py": "a = 9\n", "b.py": "b = 9\n"}


def test_rejected_reply_exits_4_with_reason(tmp_path):
    repo, base_sha, heads = make_repo(tmp_path)
    run_dir = tmp_path / "run"
    specs = [("t1", "t1", heads["t1"]), ("t2", "t2", heads["t2"])]
    p = last_json(do_fold(repo, run_dir, 1, base_sha, specs))
    d = _reply_dir(tmp_path, "reply-1-1", h1="    return y\n>>>>>>> end conflict\n")
    r = do_resolve(repo, run_dir, 1, p["open"][0]["i"], d, specs)
    assert r.returncode == 4
    q = last_json(r)
    assert q["applied"] is False and q["rejected"] is True and "marker" in q["reason"]
    assert not any(ev["type"] == "resolve" for ev in wave_events(run_dir))


def test_rejected_reply_with_a_missing_hunk_exits_4(tmp_path):
    repo, base_sha, heads = make_repo(tmp_path)
    run_dir = tmp_path / "run"
    specs = [("t1", "t1", heads["t1"]), ("t2", "t2", heads["t2"])]
    p = last_json(do_fold(repo, run_dir, 1, base_sha, specs))
    d = tmp_path / "reply-empty"
    d.mkdir()
    r = do_resolve(repo, run_dir, 1, p["open"][0]["i"], d, specs)
    assert r.returncode == 4
    assert last_json(r) == {"applied": False, "rejected": True,
                            "reason": "missing reply for h1"}


def test_log_list_disagreement_refuses(tmp_path):
    repo, base_sha, heads = make_repo(tmp_path)
    run_dir = tmp_path / "run"
    specs = [("t1", "t1", heads["t1"]), ("t2", "t2", heads["t2"])]
    p = last_json(do_fold(repo, run_dir, 1, base_sha, specs))
    d = _reply_dir(tmp_path, "reply-1-1", h1="    return y\n\n")
    r = run_cli("resolve", "--repo", str(repo), "--run-dir", str(run_dir),
                "--wave", "1", "--conflict", str(p["open"][0]["i"]),
                "--reply-dir", str(d),
                "--branch", "t2=t2:%s" % heads["t2"],
                "--branch", "t1=t1:%s" % heads["t1"])      # reordered
    assert r.returncode == 2 and "disagreement" in (r.stderr + r.stdout)
    assert not any(ev["type"] == "resolve" for ev in wave_events(run_dir))


def test_resolve_refuses_when_the_wave_has_no_fold_log(tmp_path):
    repo, base_sha, heads = make_repo(tmp_path)
    run_dir = tmp_path / "run"
    d = _reply_dir(tmp_path, "reply", h1="x\n")
    r = do_resolve(repo, run_dir, 1, 1, d,
                   [("t1", "t1", heads["t1"]), ("t2", "t2", heads["t2"])])
    assert r.returncode == 2
    assert "fold log missing for wave 1" in r.stderr



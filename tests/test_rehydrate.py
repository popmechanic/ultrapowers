"""`rehydrate(repo, log_path)`: a live FrontierEngine rebuilt from git plus
the fold log alone. The log + the repo are the whole record — no in-memory
carry-over — so every wave-scoped CLI invocation can rebuild the engine it
left behind. Recorded resolutions re-apply UNCONDITIONALLY: the log records
what actually applied, and re-deciding it would silently drop a resolution.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KERNEL = ROOT / "skills" / "ultrapowers" / "kernel"
sys.path.insert(0, str(KERNEL))
sys.path.insert(0, str(KERNEL / "vendor"))
import repo_weave as rw
import frontier_fold as ff

BASE_TEXT = "def a(x):\n    return x\n\ndef b(y):\n    return y\n"
T1_TEXT = "def a(x):\n    return x + 1\n\ndef b(y):\n    return y\n"
T2_TEXT = "def a(x):\n    return x\n\ndef b(y):\n    return y * 2\n"
RESOLVED_TEXT = "def a(x):\n    return 0\n\ndef b(y):\n    return y\n"


def _git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True,
                          capture_output=True, text=True).stdout.strip()


def make_repo(tmp_path):
    """A base commit plus two task branches, each editing `cli.py`."""
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "t@example.com")
    _git(repo, "config", "user.name", "T")
    (repo / "cli.py").write_text(BASE_TEXT)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "base")
    base_sha = _git(repo, "rev-parse", "HEAD")
    heads = {}
    for tid, text in (("t1", T1_TEXT), ("t2", T2_TEXT)):
        _git(repo, "checkout", "-q", "-b", tid, base_sha)
        (repo / "cli.py").write_text(text)
        _git(repo, "add", "-A")
        _git(repo, "commit", "-qm", tid)
        heads[tid] = _git(repo, "rev-parse", "HEAD")
    _git(repo, "checkout", "-q", base_sha)
    return repo, base_sha, heads


def write_log(path, events):
    path.write_text("".join(json.dumps(e) + "\n" for e in events))
    return path


def drive_live(tmp_path):
    """Fold t1, resolve `cli.py` at its epoch, fold t2 — recording the log."""
    repo, base_sha, heads = make_repo(tmp_path)
    order = [("t1", heads["t1"]), ("t2", heads["t2"])]
    touched = ff._union_touched(repo, base_sha, [h for _, h in order])
    base = rw.snapshot_scoped(repo, base_sha, touched)
    eng = ff.FrontierEngine(base)
    tasks, log = {}, [{"type": "base", "sha": base_sha}]
    tasks["t1"] = rw.publish(base, repo, base_sha, heads["t1"], task_id="t1")
    eng.fold(tasks["t1"])
    log.append({"type": "fold", "task": "t1", "headSha": heads["t1"]})
    epoch = eng.epoch()
    lines = rw.split_lines(RESOLVED_TEXT)
    assert eng.apply_resolution("cli.py", epoch, lines) is True
    log.append({"type": "resolve", "path": "cli.py", "epoch": epoch,
                "lines": lines})
    tasks["t2"] = rw.publish(base, repo, base_sha, heads["t2"], task_id="t2")
    eng.fold(tasks["t2"])
    log.append({"type": "fold", "task": "t2", "headSha": heads["t2"]})
    return {"repo": repo, "base_sha": base_sha, "heads": heads, "base": base,
            "tasks": tasks, "engine": eng, "log": log}


def test_union_touched_and_scoped_base_read_only_the_touched_paths(tmp_path):
    """The ordering contract: union every task's touched set FIRST, then
    snapshot only those paths — a per-task streaming scope would misclassify
    a path another task later touches as an add/add instead of a modify."""
    repo, base_sha, heads = make_repo(tmp_path)
    assert ff._union_touched(repo, base_sha, list(heads.values())) == {"cli.py"}
    base = rw.snapshot_scoped(repo, base_sha, {"cli.py"})
    assert set(base.files) == {"cli.py"}
    assert rw.manifest(base) == {"cli.py": BASE_TEXT}
    # a path no task touched is simply absent from the scoped base
    assert rw.snapshot_scoped(repo, base_sha, {"nope.py"}).files == {}
    assert rw.snapshot_scoped(repo, base_sha, set()).files == {}


def test_scoped_base_treats_pathspecs_literally(tmp_path):
    """A scoped base passes paths to git as pathspecs, and a leading ":" is
    pathspec MAGIC: without --literal-pathspecs git drops such a path silently
    (exit 0, no output), which would misclassify a modify as an add/add."""
    repo = tmp_path / "magic"
    repo.mkdir()
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "t@example.com")
    _git(repo, "config", "user.name", "T")
    (repo / ":x.py").write_text("magic = 1\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "base")
    sha = _git(repo, "rev-parse", "HEAD")
    assert rw.manifest(rw.snapshot_scoped(repo, sha, {":x.py"})) == {":x.py": "magic = 1\n"}


def test_rehydrate_reconstructs_epoch_and_touched_map(tmp_path):
    live = drive_live(tmp_path)
    log_path = write_log(tmp_path / "fold_log.jsonl", live["log"])
    eng = ff.rehydrate(live["repo"], log_path)
    # Epoch equality is the point: replay() historically skipped appending
    # resolve events and desynced the clock, which the manifest cannot see.
    assert eng.epoch() == live["engine"].epoch() == 3
    assert eng._touched_at == live["engine"]._touched_at
    assert eng.events == live["engine"].events
    assert eng.manifest() == live["engine"].manifest()


def test_rehydrate_in_a_fresh_process_needs_only_the_repo_and_the_log(tmp_path):
    live = drive_live(tmp_path)
    log_path = write_log(tmp_path / "fold_log.jsonl", live["log"])
    prog = (
        "import json, sys\n"
        "sys.path.insert(0, %r)\n"
        "import frontier_fold as ff\n"
        "eng = ff.rehydrate(%r, %r)\n"
        "print(json.dumps({'epoch': eng.epoch(), 'touched': eng._touched_at,\n"
        "                  'manifest': eng.manifest()}))\n"
        % (str(KERNEL), str(live["repo"]), str(log_path)))
    out = subprocess.run([sys.executable, "-c", prog], check=True,
                         capture_output=True, text=True).stdout
    payload = json.loads(out.strip().splitlines()[-1])
    assert payload["epoch"] == live["engine"].epoch()
    assert payload["touched"] == live["engine"]._touched_at
    assert payload["manifest"] == live["engine"].manifest()


def test_rehydrate_applies_recorded_resolve_unconditionally(tmp_path):
    """A recorded resolve whose epoch would FAIL apply_resolution's staleness
    check must still apply during rehydration."""
    repo, base_sha, heads = make_repo(tmp_path)
    lines = rw.split_lines(RESOLVED_TEXT)
    folds = [{"type": "base", "sha": base_sha},
             {"type": "fold", "task": "t1", "headSha": heads["t1"]},
             {"type": "fold", "task": "t2", "headSha": heads["t2"]}]
    stale = {"type": "resolve", "path": "cli.py", "epoch": 1, "lines": lines}

    # the live guard really would reject this resolve: the t2 fold at event
    # index 1 touched cli.py at or after the narration's epoch of 1.
    guarded = ff.rehydrate(repo, write_log(tmp_path / "folds.jsonl", folds))
    assert guarded.apply_resolution("cli.py", 1, lines) is False

    eng = ff.rehydrate(repo, write_log(tmp_path / "log.jsonl", folds + [stale]))
    assert eng.manifest()["cli.py"] == RESOLVED_TEXT
    assert eng.events[-1] == stale


def test_rehydrate_rejects_a_log_that_does_not_open_with_base(tmp_path):
    repo, base_sha, heads = make_repo(tmp_path)
    bad = write_log(tmp_path / "bad.jsonl",
                    [{"type": "fold", "task": "t1", "headSha": heads["t1"]}])
    try:
        ff.rehydrate(repo, bad)
    except ValueError as e:
        assert "base" in str(e)
    else:
        raise AssertionError("a log with no base event must not rehydrate")


def test_replay_is_a_thin_wrapper_and_matches_rehydrate(tmp_path):
    live = drive_live(tmp_path)
    log_path = write_log(tmp_path / "fold_log.jsonl", live["log"])
    rehydrated = ff.rehydrate(live["repo"], log_path)
    events = live["engine"].events
    assert ff.replay(live["base"], live["tasks"], events) == rehydrated.manifest()
    # base events are inert: a log-shaped event list replays identically.
    with_base = [{"type": "base", "sha": live["base_sha"]}] + events
    assert ff.replay(live["base"], live["tasks"], with_base) == rehydrated.manifest()


def test_replay_keeps_the_clock_it_used_to_desync(tmp_path):
    """The shared event walk appends resolve events, so a replayed engine's
    epoch matches the run it replays instead of drifting behind it."""
    live = drive_live(tmp_path)
    eng = ff.FrontierEngine(live["base"])
    ff._apply_events(eng, live["tasks"], live["engine"].events)
    assert eng.epoch() == live["engine"].epoch()
    assert eng._touched_at == live["engine"]._touched_at

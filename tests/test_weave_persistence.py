"""`emit-weave` — the adopted wave's per-path weave states, persisted.

Tier 1 (spec `docs/superpowers/specs/2026-09-01-tier1-weave-persistence.md`
§2.1): after the engine ADOPTS a wave, the kernel writes each folded path's
manyana state string as a content-addressed blob under
`<run-dir>/frontier/weave/blobs/<sha256(state)>`, plus one wholesale-replaced
`manifest.json` (`{"wave": N, "entries": {path: {stateBlob, visibleSha}}}`)
and an append-only `weave-events.jsonl` sidecar.

What these pin:

* the blob is content-addressed by sha256 of its own bytes, and `visibleSha`
  is git's OWN blob sha for the adopted file — the equality that lets the next
  wave decide whether the persisted state still describes what git holds;
* a path the reconcile leg edited after the fold (adopt-head blob != the
  frontier's visible bytes) is recorded `superseded` and kept OUT of the
  manifest, so next wave's miss is expected rather than surfacing as drift;
* nothing is written for an incomplete fold — `emit-weave` is an adopt-leg
  call, and an unresolved wave was never adopted;
* `state_strings()` hands back raw manyana state strings (the persistence
  unit), copied, not the engine's live map.

Every scenario builds its own tmp_path git repo and drives the real CLI by
subprocess, exactly as `tests/test_fold_wave.py` does.
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
KERNEL = ROOT / "skills" / "ultrapowers" / "kernel"
CLI = str(KERNEL / "fold_wave.py")
sys.path.insert(0, str(KERNEL))
sys.path.insert(0, str(KERNEL / "vendor"))
import manyana                      # noqa: E402
import repo_weave as rw             # noqa: E402
import frontier_fold as ff          # noqa: E402
import fold_wave as fw              # noqa: E402

BASE_APP = "def a(x):\n    return x\n\ndef b(y):\n    return y\n"
T1_APP = "def a(x):\n    return x + 1\n\ndef b(y):\n    return y\n"
T2_APP = "def a(x):\n    return x * 2\n\ndef b(y):\n    return y\n"


class FoldEnv:
    """One wave's worth of throwaway state: the repo, its run dir, and the
    commit the engine would have adopted (`adopt_sha`, which the fixture
    leaves checked out so a test can reconcile on top of it)."""

    def __init__(self, repo, run_dir, base_sha, heads, adopt_sha):
        self.repo = repo
        self.run_dir = run_dir
        self.base_sha = base_sha
        self.heads = heads
        self.adopt_sha = adopt_sha

    def git(self, *args):
        return subprocess.run(["git", "-C", str(self.repo), *args], check=True,
                              capture_output=True, text=True).stdout


def _init(repo):
    repo.mkdir()
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "t@example.com")
    _git(repo, "config", "user.name", "T")


def _git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True,
                          capture_output=True, text=True).stdout.strip()


def run_cli(env, argv, expect_code=0):
    """The kernel CLI from inside the repo — the tests pass `--repo .`, which
    is how the engine invokes it from the integration worktree."""
    r = subprocess.run([sys.executable, CLI, *argv], cwd=str(env.repo),
                       capture_output=True, text=True)
    assert r.returncode == expect_code, (r.returncode, r.stdout, r.stderr)
    return r


def _one_task_repo(tmp_path):
    """Base `app.py` (4 lines) plus a single task branch editing line 2."""
    repo = tmp_path / "repo"
    _init(repo)
    (repo / "app.py").write_text(BASE_APP)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "base")
    base_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", "-b", "t1", base_sha)
    (repo / "app.py").write_text(T1_APP)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "t1")
    t1_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", base_sha)
    return repo, base_sha, {"t1": t1_sha}


@pytest.fixture
def fold_env(tmp_path):
    """A complete wave 1: folded, materialized, and ADOPTED (`reset --hard`
    to the candidate, the engine's own adopt leg) so `HEAD` is the adopt
    head and the worktree matches it."""
    repo, base_sha, heads = _one_task_repo(tmp_path)
    run_dir = tmp_path / "run"
    env = FoldEnv(repo, run_dir, base_sha, heads, None)

    fold = run_cli(env, ["fold", "--repo", ".", "--run-dir", str(run_dir),
                         "--wave", "1", "--base", base_sha,
                         "--branch", "t1=t1:%s" % heads["t1"]])
    assert json.loads(fold.stdout)["complete"] is True, fold.stdout

    mat = run_cli(env, ["materialize", "--repo", ".", "--run-dir", str(run_dir),
                        "--wave", "1", "--prev-head", base_sha,
                        "--task-head", "t1=%s" % heads["t1"]])
    env.adopt_sha = json.loads(mat.stdout)["candidateSha"]
    _git(repo, "reset", "-q", "--hard", env.adopt_sha)
    return env


@pytest.fixture
def fold_env_incomplete(tmp_path):
    """Two writers of the same line: the fold stops on an unresolved
    conflict, so the wave was never adopted."""
    repo = tmp_path / "repo"
    _init(repo)
    (repo / "app.py").write_text(BASE_APP)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "base")
    base_sha = _git(repo, "rev-parse", "HEAD")

    heads = {}
    for name, text in (("t1", T1_APP), ("t2", T2_APP)):
        _git(repo, "checkout", "-q", "-b", name, base_sha)
        (repo / "app.py").write_text(text)
        _git(repo, "add", "-A")
        _git(repo, "commit", "-qm", name)
        heads[name] = _git(repo, "rev-parse", "HEAD")
    _git(repo, "checkout", "-q", base_sha)

    run_dir = tmp_path / "run"
    env = FoldEnv(repo, run_dir, base_sha, heads, base_sha)
    fold = run_cli(env, ["fold", "--repo", ".", "--run-dir", str(run_dir),
                         "--wave", "1", "--base", base_sha,
                         "--branch", "t1=t1:%s" % heads["t1"],
                         "--branch", "t2=t2:%s" % heads["t2"]])
    assert json.loads(fold.stdout)["complete"] is False, fold.stdout
    return env


# --- emit ---------------------------------------------------------------


def test_emit_weave_writes_blobs_manifest_and_events(fold_env):
    out = run_cli(fold_env, ["emit-weave", "--repo", ".", "--run-dir", str(fold_env.run_dir),
                             "--wave", "1", "--adopt-head", fold_env.adopt_sha])
    reply = json.loads(out.stdout)
    assert reply == {"emitted": 1, "superseded": 0}
    weave = fold_env.run_dir / "frontier" / "weave"
    manifest = json.loads((weave / "manifest.json").read_text())
    assert manifest["wave"] == 1
    entry = manifest["entries"]["app.py"]
    blob = (weave / "blobs" / entry["stateBlob"]).read_text()
    assert hashlib.sha256(blob.encode()).hexdigest() == entry["stateBlob"]
    # visibleSha is git's own blob sha for the adopted file
    expected = fold_env.git("rev-parse", fold_env.adopt_sha + ":app.py").strip()
    assert entry["visibleSha"] == expected
    events = [json.loads(l) for l in (weave / "weave-events.jsonl").read_text().splitlines()]
    assert {"event": "emitted", "wave": 1, "path": "app.py"}.items() <= events[-1].items()


def test_emitted_blob_is_the_state_the_fold_ended_on(fold_env):
    """The blob is the raw manyana state string — the persistence unit — and
    its visible lines are the adopted file's lines, not a re-derivation."""
    run_cli(fold_env, ["emit-weave", "--repo", ".", "--run-dir", str(fold_env.run_dir),
                       "--wave", "1", "--adopt-head", fold_env.adopt_sha])
    weave = fold_env.run_dir / "frontier" / "weave"
    entry = json.loads((weave / "manifest.json").read_text())["entries"]["app.py"]
    state = (weave / "blobs" / entry["stateBlob"]).read_text()
    assert manyana.current_lines(state) == rw.split_lines(T1_APP)

    eng = ff.rehydrate(fold_env.repo,
                       fold_env.run_dir / "frontier" / "wave-1" / "fold_log.jsonl")
    assert state == eng.state_strings()["app.py"]


def test_emit_weave_manifest_shape_is_exactly_wave_and_entries(fold_env):
    run_cli(fold_env, ["emit-weave", "--repo", ".", "--run-dir", str(fold_env.run_dir),
                       "--wave", "1", "--adopt-head", fold_env.adopt_sha])
    manifest = json.loads(
        (fold_env.run_dir / "frontier" / "weave" / "manifest.json").read_text())
    assert sorted(manifest) == ["entries", "wave"]
    assert sorted(manifest["entries"]) == ["app.py"]
    assert sorted(manifest["entries"]["app.py"]) == ["stateBlob", "visibleSha"]


def test_emit_weave_is_idempotent_and_content_addressed(fold_env):
    """A re-issued emit rewrites the same manifest and reuses the blob (the
    blob name IS its content), while the event sidecar keeps appending."""
    argv = ["emit-weave", "--repo", ".", "--run-dir", str(fold_env.run_dir),
            "--wave", "1", "--adopt-head", fold_env.adopt_sha]
    first = json.loads(run_cli(fold_env, argv).stdout)
    weave = fold_env.run_dir / "frontier" / "weave"
    manifest_one = (weave / "manifest.json").read_text()

    second = json.loads(run_cli(fold_env, argv).stdout)
    assert second == first == {"emitted": 1, "superseded": 0}
    assert (weave / "manifest.json").read_text() == manifest_one
    assert len(list((weave / "blobs").iterdir())) == 1
    events = (weave / "weave-events.jsonl").read_text().splitlines()
    assert len(events) == 2


def test_emit_weave_manifest_is_replaced_wholesale_by_the_newest_wave(fold_env):
    """The newest adopted wave OWNS the manifest: wave 2's emit does not
    inherit wave 1's entries."""
    run_cli(fold_env, ["emit-weave", "--repo", ".", "--run-dir", str(fold_env.run_dir),
                       "--wave", "1", "--adopt-head", fold_env.adopt_sha])
    (fold_env.repo / "app.py").write_text("reconciled\n")
    fold_env.git("add", "-A")
    fold_env.git("commit", "-m", "reconcile")
    head = fold_env.git("rev-parse", "HEAD").strip()
    run_cli(fold_env, ["emit-weave", "--repo", ".", "--run-dir", str(fold_env.run_dir),
                       "--wave", "1", "--adopt-head", head])
    manifest = json.loads(
        (fold_env.run_dir / "frontier" / "weave" / "manifest.json").read_text())
    assert manifest == {"wave": 1, "entries": {}}


def test_emit_weave_marks_reconciled_paths_superseded(fold_env):
    # amend the adopt head so app.py's blob differs from the fold's visible lines
    (fold_env.repo / "app.py").write_text("reconciled\n")
    fold_env.git("add", "-A")
    fold_env.git("commit", "-m", "reconcile")
    head = fold_env.git("rev-parse", "HEAD").strip()
    reply = json.loads(run_cli(fold_env, ["emit-weave", "--repo", ".", "--run-dir",
        str(fold_env.run_dir), "--wave", "1", "--adopt-head", head]).stdout)
    assert reply == {"emitted": 0, "superseded": 1}
    manifest = json.loads((fold_env.run_dir / "frontier/weave/manifest.json").read_text())
    assert "app.py" not in manifest["entries"]


def test_superseded_event_names_the_path_and_the_wave(fold_env):
    (fold_env.repo / "app.py").write_text("reconciled\n")
    fold_env.git("add", "-A")
    fold_env.git("commit", "-m", "reconcile")
    head = fold_env.git("rev-parse", "HEAD").strip()
    run_cli(fold_env, ["emit-weave", "--repo", ".", "--run-dir", str(fold_env.run_dir),
                       "--wave", "1", "--adopt-head", head])
    events = [json.loads(l) for l in (fold_env.run_dir /
              "frontier/weave/weave-events.jsonl").read_text().splitlines()]
    assert {"event": "superseded", "wave": 1, "path": "app.py"}.items() <= events[-1].items()


def test_path_absent_at_adopt_head_is_superseded_not_emitted(fold_env):
    """A path the reconcile leg DELETED is a miss too, not a crash."""
    (fold_env.repo / "app.py").unlink()
    fold_env.git("add", "-A")
    fold_env.git("commit", "-m", "drop app.py")
    head = fold_env.git("rev-parse", "HEAD").strip()
    reply = json.loads(run_cli(fold_env, ["emit-weave", "--repo", ".", "--run-dir",
        str(fold_env.run_dir), "--wave", "1", "--adopt-head", head]).stdout)
    assert reply == {"emitted": 0, "superseded": 1}


# --- refusals -----------------------------------------------------------


def test_emit_weave_refuses_incomplete_fold(fold_env_incomplete):
    env = fold_env_incomplete
    r = run_cli(env, ["emit-weave", "--repo", ".", "--run-dir", str(env.run_dir),
                      "--wave", "1", "--adopt-head", env.adopt_sha],
                expect_code=2)
    assert "incomplete" in r.stderr
    assert not (env.run_dir / "frontier" / "weave").exists()


def test_emit_weave_refuses_a_missing_fold_log(fold_env):
    r = run_cli(fold_env, ["emit-weave", "--repo", ".", "--run-dir",
                           str(fold_env.run_dir), "--wave", "7",
                           "--adopt-head", fold_env.adopt_sha],
                expect_code=2)
    assert "fold log missing" in r.stderr


# --- accessors ----------------------------------------------------------


def test_state_strings_round_trips_through_manyana():
    eng = ff.FrontierEngine(rw.RepoState(files={"a.py": manyana.initial_state(["x"])},
                                         deleted_marks=frozenset(), raw={}))
    s = eng.state_strings()
    assert manyana.current_lines(s["a.py"]) == ["x"]


def test_state_strings_is_a_copy_not_the_live_map():
    base = rw.RepoState(files={"a.py": manyana.initial_state(["x"])},
                        deleted_marks=frozenset(), raw={})
    eng = ff.FrontierEngine(base)
    s = eng.state_strings()
    s["b.py"] = manyana.initial_state(["y"])
    assert sorted(eng.state_strings()) == ["a.py"]


def test_load_weave_manifest_is_none_before_any_emit(tmp_path):
    assert fw.load_weave_manifest(tmp_path) is None


def test_load_weave_manifest_reads_the_emitted_manifest(fold_env):
    assert fw.load_weave_manifest(fold_env.run_dir) is None
    run_cli(fold_env, ["emit-weave", "--repo", ".", "--run-dir", str(fold_env.run_dir),
                       "--wave", "1", "--adopt-head", fold_env.adopt_sha])
    manifest = fw.load_weave_manifest(fold_env.run_dir)
    assert manifest["wave"] == 1
    assert manifest["entries"]["app.py"]["visibleSha"] == fold_env.git(
        "rev-parse", fold_env.adopt_sha + ":app.py").strip()

"""Shadow seeding and the divergence record (Tier 1, spec 2026-09-01 §2.2).

Wave N+1's fold derives its base from git exactly as it always has. AFTER the
wave has folded clean and complete, `cmd_fold` re-derives the same wave a
second time in memory over a base whose weave states were SEEDED from the
adopted wave's persisted blobs, and records what it saw in the
`weave-events.jsonl` sidecar:

* `seeded` — one per seeded path, when the seeded pass reproduced the fresh
  pass's visible tree exactly;
* `drift` — a manifest entry that no longer describes what git holds at the
  base (or a blob whose bytes are not its own sha256 name); that path is not
  seeded;
* `divergence` — the seeded pass narrated a conflict the fresh pass did not,
  or ended on a different visible tree (carrying both tree sha256s);
* `shadow-skipped` — the wave was not a clean fold to measure (it completed
  through `resolve`, or the fresh fold narrated conflicts), or the shadow
  itself failed for any reason at all.

What these pin, above every individual event: the shadow is SHADOW. The live
fold reply, the fold log and the conflicts index are byte-for-byte what they
are with no weave dir present, and a missing, poisoned or unreadable weave
dir costs the wave nothing — no failure, no park, no altered fold.

Every scenario builds its own tmp_path git repo and drives the real CLI by
subprocess, exactly as `tests/test_fold_wave.py` does.
"""
import hashlib
import json
import shutil
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
import fold_wave as fw              # noqa: E402

# Wave 1 edits `a`; wave 2 edits `b`, so the two waves touch the same file in
# different places — the shape a seed is supposed to make cheap.
BASE_APP = "def a(x):\n    return x\n\ndef b(y):\n    return y\n"
W1_APP = "def a(x):\n    return x + 1\n\ndef b(y):\n    return y\n"
W2_APP = "def a(x):\n    return x + 1\n\ndef b(y):\n    return y * 3\n"
# Two wave-2 tasks writing the SAME line of the adopted file: a conflict.
C1_APP = "def a(x):\n    return x + 1\n\ndef b(y):\n    return y * 3\n"
C2_APP = "def a(x):\n    return x + 1\n\ndef b(y):\n    return y - 7\n"
# Two wave-2 tasks that fold CLEAN against git's base: one drops the blank
# line, the other edits `b`. Both divergence fixtures ride this wave — a
# divergence needs two writers, since a lone writer lands on its own content
# whatever base it was published against.
D1_APP = "def a(x):\n    return x + 1\ndef b(y):\n    return y\n"
D2_APP = "def a(x):\n    return x + 1\n\ndef b(y):\n    return y * 3\n"
# The seed that ends the wave somewhere else: it never carried the blank line
# D1 deletes, so the seeded pass reads D2 as ADDING it back.
LIE_TREE = "def a(x):\n    return x + 1\ndef b(y):\n    return y\n"
# The seed that makes the wave conflict: it lies about the line only D2
# edits, so D1 (which restores it) and D2 (which rewrites it) collide.
LIE_CONFLICT = "def a(x):\n    return x + 1\n\ndef b(y):\n    return y + 999\n"
# Two wave-2 tasks appending at the same point: an ALL-`added` conflict, which
# a `Commutes:` declaration licenses the fold to union in process.
U1_APP = W1_APP + "# t1 note\n"
U2_APP = W1_APP + "# t2 note\n"


def _git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True,
                          capture_output=True, text=True).stdout.strip()


def _git_raw(repo, *args):
    """Unstripped stdout — a patch's trailing newline is part of the patch."""
    return subprocess.run(["git", "-C", str(repo), *args], check=True,
                          capture_output=True).stdout


def _init(repo):
    repo.mkdir(parents=True)
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "t@example.com")
    _git(repo, "config", "user.name", "T")


class TwoWaveEnv:
    """A run whose wave 1 folded, materialized, ADOPTED and emitted its weave,
    with wave 2's tasks captured as patches against the adopt head but NOT yet
    folded — every test drives that fold itself."""

    def __init__(self, root, repo, run_dir, base_sha, adopt_sha, patches):
        self.root = root
        self.repo = repo
        self.run_dir = run_dir
        self.base_sha = base_sha
        self.adopt_sha = adopt_sha
        self.wave2_patches = patches
        self.wave2_patch = patches[0]

    def git(self, *args):
        return _git(self.repo, *args)

    @property
    def weave(self):
        return self.run_dir / "frontier" / "weave"


def run_cli(env, argv, expect_code=0):
    """The kernel CLI from inside the repo — the tests pass `--repo .`, which
    is how the engine invokes it from the integration worktree."""
    r = subprocess.run([sys.executable, CLI, *argv], cwd=str(env.repo),
                       capture_output=True, text=True)
    assert r.returncode == expect_code, (r.returncode, r.stdout, r.stderr)
    return r


def read_events(env):
    """The weave sidecar's events, oldest first (wave 1's `emitted` included)."""
    path = env.weave / "weave-events.jsonl"
    if not path.exists():
        return []
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]


def poison_manifest(env, path, **fields):
    """Rewrite one manifest entry's fields in place (`visibleSha=...`)."""
    manifest_path = env.weave / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["entries"][path].update(fields)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")


def seed_state(env, path):
    """The state string the manifest currently offers as `path`'s seed."""
    entry = json.loads((env.weave / "manifest.json").read_text())["entries"][path]
    return (env.weave / "blobs" / entry["stateBlob"]).read_text()


def replace_seed(env, path, state):
    """Point `path`'s manifest entry at a NEW, correctly-named state blob.

    `visibleSha` is left alone, so the seed still claims to describe what git
    holds at the base: the manifest is self-consistent and the sha256 check
    passes — only the state's own visible lines lie. That is the one shape
    that reaches the shadow's tree comparison.
    """
    state_blob = hashlib.sha256(state.encode()).hexdigest()
    (env.weave / "blobs" / state_blob).write_text(state)
    poison_manifest(env, path, stateBlob=state_blob)


def _capture_patch(repo, root, name, text):
    """A `git diff --binary --full-index --no-renames HEAD` for `app.py` ==
    `text`, captured the way a worker captures its own tree, then reverted."""
    (repo / "app.py").write_text(text)
    patch = root / name
    patch.write_bytes(_git_raw(repo, "diff", "--binary", "--full-index",
                               "--no-renames", "HEAD"))
    _git(repo, "checkout", "--", "app.py")
    return patch


def _build_two_wave(tmp_path, name, wave2_texts):
    root = tmp_path / name
    repo = root / "repo"
    _init(repo)
    (repo / "app.py").write_text(BASE_APP)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "base")
    base_sha = _git(repo, "rev-parse", "HEAD")

    _git(repo, "checkout", "-q", "-b", "t1", base_sha)
    (repo / "app.py").write_text(W1_APP)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "t1")
    t1_sha = _git(repo, "rev-parse", "HEAD")
    _git(repo, "checkout", "-q", base_sha)

    run_dir = root / "run"
    env = TwoWaveEnv(root, repo, run_dir, base_sha, None, [None])
    fold = run_cli(env, ["fold", "--repo", ".", "--run-dir", str(run_dir),
                         "--wave", "1", "--base", base_sha,
                         "--branch", "t1=t1:%s" % t1_sha])
    assert json.loads(fold.stdout)["complete"] is True, fold.stdout
    mat = run_cli(env, ["materialize", "--repo", ".", "--run-dir", str(run_dir),
                        "--wave", "1", "--prev-head", base_sha,
                        "--task-head", "t1=%s" % t1_sha])
    adopt_sha = json.loads(mat.stdout)["candidateSha"]
    _git(repo, "reset", "-q", "--hard", adopt_sha)      # the engine's adopt leg
    env.adopt_sha = adopt_sha
    emit = run_cli(env, ["emit-weave", "--repo", ".", "--run-dir", str(run_dir),
                         "--wave", "1", "--adopt-head", adopt_sha])
    assert json.loads(emit.stdout) == {"emitted": 1, "superseded": 0}, emit.stdout

    patches = [_capture_patch(repo, root, "w2-%d.patch" % i, text)
               for i, text in enumerate(wave2_texts, start=1)]
    env.wave2_patches = patches
    env.wave2_patch = patches[0]
    return env


def wave2_argv(env, wave=2):
    argv = ["fold", "--repo", ".", "--run-dir", str(env.run_dir),
            "--wave", str(wave), "--base", env.adopt_sha]
    for i, patch in enumerate(env.wave2_patches, start=1):
        argv += ["--patch", "%d=%s" % (i, patch)]
    return argv


@pytest.fixture
def two_wave_env(tmp_path):
    """Wave 2: one task, editing the same file wave 1 folded."""
    return _build_two_wave(tmp_path, "one", [W2_APP])


@pytest.fixture
def two_wave_env_pair(tmp_path):
    """The SAME run twice — a byte-for-byte copy — one with its weave dir
    removed. Any difference in the live reply is the shadow leaking."""
    with_weave = _build_two_wave(tmp_path, "with", [W2_APP])
    other = tmp_path / "without"
    shutil.copytree(with_weave.root, other)
    without = TwoWaveEnv(other, other / "repo", other / "run",
                         with_weave.base_sha, with_weave.adopt_sha,
                         [other / p.name for p in with_weave.wave2_patches])
    shutil.rmtree(without.weave)
    return with_weave, without


@pytest.fixture
def clean_two_task_env(tmp_path):
    """Wave 2: two tasks that fold CLEAN against git's base — the wave both
    divergence tests poison the seed of."""
    return _build_two_wave(tmp_path, "clean2", [D1_APP, D2_APP])


@pytest.fixture
def auto_union_env(tmp_path):
    """Wave 2: two tasks whose only collision is all-`added`, so a declared
    `Commutes:` lets the fold complete WITHOUT a resolver — but not cleanly."""
    return _build_two_wave(tmp_path, "union", [U1_APP, U2_APP])


@pytest.fixture
def conflicted_two_wave_env(tmp_path):
    """Wave 2: two tasks writing the same line, so the fold stops and the
    wave can only complete through `resolve`."""
    return _build_two_wave(tmp_path, "conflicted", [C1_APP, C2_APP])


# --- the seeded pass ----------------------------------------------------


def test_wave2_fold_records_seeded_event_and_no_divergence(two_wave_env):
    out = run_cli(two_wave_env, wave2_argv(two_wave_env))
    assert json.loads(out.stdout)["complete"] is True
    events = read_events(two_wave_env)
    kinds = [e["event"] for e in events]
    assert "seeded" in kinds and "divergence" not in kinds and "drift" not in kinds
    seeded = [e for e in events if e["event"] == "seeded"][-1]
    assert seeded == {"event": "seeded", "wave": 2, "path": "app.py"}


def test_seeded_wave_records_exactly_one_event_per_seeded_path(two_wave_env):
    run_cli(two_wave_env, wave2_argv(two_wave_env))
    wave2 = [e for e in read_events(two_wave_env) if e.get("wave") == 2]
    assert wave2 == [{"event": "seeded", "wave": 2, "path": "app.py"}]


def test_seed_is_the_persisted_weave_state_not_a_fresh_snapshot(two_wave_env):
    """The seed offered is wave 1's own folded state — the blob carries the
    wave-1 fold's history, which a fresh `snapshot_scoped` of the base cannot."""
    state = seed_state(two_wave_env, "app.py")
    assert manyana.current_lines(state) == rw.split_lines(W1_APP)
    fresh = rw.snapshot_scoped(two_wave_env.repo, two_wave_env.adopt_sha,
                               ["app.py"]).files["app.py"]
    assert state != fresh


# --- drift --------------------------------------------------------------


def test_manifest_mismatch_records_drift_not_seed(two_wave_env):
    poison_manifest(two_wave_env, "app.py", visibleSha="0" * 40)
    out = run_cli(two_wave_env, wave2_argv(two_wave_env))
    assert json.loads(out.stdout)["complete"] is True
    wave2 = [e for e in read_events(two_wave_env) if e.get("wave") == 2]
    kinds = [e["event"] for e in wave2]
    assert "drift" in kinds and "seeded" not in kinds
    assert wave2 == [{"event": "drift", "wave": 2, "path": "app.py",
                      "reason": "manifest visibleSha is not the base blob"}]


def test_a_blob_that_is_not_its_own_sha256_is_drift(two_wave_env):
    entry = json.loads((two_wave_env.weave / "manifest.json").read_text())
    blob = two_wave_env.weave / "blobs" / entry["entries"]["app.py"]["stateBlob"]
    blob.write_text(blob.read_text() + "\n")     # same name, different bytes
    run_cli(two_wave_env, wave2_argv(two_wave_env))
    wave2 = [e for e in read_events(two_wave_env) if e.get("wave") == 2]
    assert wave2 == [{"event": "drift", "wave": 2, "path": "app.py",
                      "reason": "blob content is not its own sha256 name"}]


def test_an_unreadable_seed_blob_is_shadow_skipped_not_a_failure(two_wave_env):
    entry = json.loads((two_wave_env.weave / "manifest.json").read_text())
    (two_wave_env.weave / "blobs" / entry["entries"]["app.py"]["stateBlob"]).unlink()
    out = run_cli(two_wave_env, wave2_argv(two_wave_env))
    assert json.loads(out.stdout)["complete"] is True
    wave2 = [e for e in read_events(two_wave_env) if e.get("wave") == 2]
    assert [e["event"] for e in wave2] == ["shadow-skipped"]
    assert sorted(wave2[0]) == ["event", "reason", "wave"]


# --- divergence ---------------------------------------------------------


def test_a_seed_whose_visible_lines_lie_records_divergence(clean_two_task_env):
    """A self-consistent manifest pointing at a state that is NOT what git
    holds: both passes fold clean, but the seeded one ends on a different
    visible tree — the record the shadow exists to produce."""
    env = clean_two_task_env
    replace_seed(env, "app.py", manyana.update_state(
        seed_state(env, "app.py"), rw.split_lines(LIE_TREE)))
    out = run_cli(env, wave2_argv(env))
    assert json.loads(out.stdout)["complete"] is True
    wave2 = [e for e in read_events(env) if e.get("wave") == 2]
    assert [e["event"] for e in wave2] == ["divergence"]
    event = wave2[0]
    assert sorted(event) == ["event", "freshTree", "paths", "seededTree", "wave"]
    assert event["paths"] == ["app.py"] and event["wave"] == 2
    assert event["freshTree"] != event["seededTree"]
    assert all(len(event[k]) == 64 for k in ("freshTree", "seededTree"))


def test_the_recorded_fresh_tree_is_the_tree_the_wave_actually_folded(clean_two_task_env):
    """`freshTree` is a sha256 OF THE LIVE FOLD, so a divergence record can be
    checked against the wave that shipped, not just against itself."""
    env = clean_two_task_env
    replace_seed(env, "app.py", manyana.update_state(
        seed_state(env, "app.py"), rw.split_lines(LIE_TREE)))
    run_cli(env, wave2_argv(env))
    event = [e for e in read_events(env) if e["event"] == "divergence"][-1]

    merged = "def a(x):\n    return x + 1\ndef b(y):\n    return y * 3\n"
    assert event["freshTree"] == fw._visible_tree_sha({"app.py": merged})
    assert event["seededTree"] == fw._visible_tree_sha({"app.py": D2_APP})


def test_a_seed_that_makes_the_wave_conflict_records_divergence(clean_two_task_env):
    """The fresh pass was clean by construction; a conflict that only the
    seeded pass narrates is a divergence, reported by path."""
    env = clean_two_task_env
    replace_seed(env, "app.py", manyana.update_state(
        seed_state(env, "app.py"), rw.split_lines(LIE_CONFLICT)))
    out = run_cli(env, wave2_argv(env))
    assert json.loads(out.stdout)["complete"] is True
    assert json.loads(out.stdout)["clean"] is True      # the LIVE fold is clean
    wave2 = [e for e in read_events(env) if e.get("wave") == 2]
    assert wave2 == [{"event": "divergence", "wave": 2, "paths": ["app.py"]}]


# --- the shadow is shadow ----------------------------------------------


def test_missing_or_corrupt_weave_dir_changes_nothing(two_wave_env):
    shutil.rmtree(two_wave_env.weave)
    out = run_cli(two_wave_env, wave2_argv(two_wave_env))
    assert json.loads(out.stdout)["complete"] is True
    assert not two_wave_env.weave.exists()          # never re-created
    assert read_events(two_wave_env) == []


def test_corrupt_manifest_json_changes_nothing(two_wave_env):
    (two_wave_env.weave / "manifest.json").write_text("{not json at all")
    before = read_events(two_wave_env)
    out = run_cli(two_wave_env, wave2_argv(two_wave_env))
    assert json.loads(out.stdout)["complete"] is True
    assert read_events(two_wave_env) == before      # no seed offered, nothing said


def test_fold_reply_json_is_byte_identical_with_and_without_weave(two_wave_env_pair):
    with_weave, without_weave = two_wave_env_pair
    a = run_cli(with_weave, wave2_argv(with_weave)).stdout
    b = run_cli(without_weave, wave2_argv(without_weave)).stdout
    assert a == b
    assert json.loads(a)["complete"] is True


def test_the_wave_dir_is_byte_identical_with_and_without_weave(two_wave_env_pair):
    """Not just stdout: the fold log and the conflicts index are the same
    bytes, and no weave record ever enters the log."""
    with_weave, without_weave = two_wave_env_pair
    run_cli(with_weave, wave2_argv(with_weave))
    run_cli(without_weave, wave2_argv(without_weave))

    def read(env, name):
        # The log records each patch by its ABSOLUTE path, which is the one
        # thing that legitimately differs between the two copies.
        text = (env.run_dir / "frontier/wave-2" / name).read_text()
        return text.replace(str(env.root), "<root>")

    for name in ("fold_log.jsonl", "conflicts.json", "fold_stats.json"):
        assert read(with_weave, name) == read(without_weave, name), name
    log = [json.loads(l) for l in (with_weave.run_dir /
           "frontier/wave-2/fold_log.jsonl").read_text().splitlines()]
    assert sorted({e["type"] for e in log}) == ["base", "fold"]


def test_materialize_after_a_seeded_fold_is_unchanged(two_wave_env_pair):
    """The seeded pass is in-memory only: the candidate the engine adopts is
    the same tree either way."""
    with_weave, without_weave = two_wave_env_pair
    shas = []
    for env in (with_weave, without_weave):
        run_cli(env, wave2_argv(env))
        mat = run_cli(env, ["materialize", "--repo", ".", "--run-dir",
                            str(env.run_dir), "--wave", "2", "--prev-head",
                            env.adopt_sha, "--patch",
                            "1=%s" % env.wave2_patches[0]])
        candidate = json.loads(mat.stdout)["candidateSha"]
        shas.append(_git(env.repo, "rev-parse", candidate + "^{tree}"))
    assert shas[0] == shas[1]
    assert _git(with_weave.repo, "show", "%s:app.py" % shas[0]) == W2_APP.strip()


# --- waves the shadow does not measure ----------------------------------


def test_conflicted_wave_records_shadow_skipped(conflicted_two_wave_env, tmp_path):
    env = conflicted_two_wave_env
    stop = json.loads(run_cli(env, wave2_argv(env)).stdout)
    assert stop["complete"] is False and stop["dispatchable"] == 1
    assert [e["event"] for e in read_events(env) if e.get("wave") == 2] == []

    reply = tmp_path / "reply"
    reply.mkdir()
    (reply / "h1.txt").write_text("    return y * 3 - 7\n")
    done = json.loads(run_cli(env, [
        "resolve", "--repo", ".", "--run-dir", str(env.run_dir), "--wave", "2",
        "--conflict", str(stop["open"][0]["i"]), "--reply-dir", str(reply),
        "--patch", "1=%s" % env.wave2_patches[0],
        "--patch", "2=%s" % env.wave2_patches[1]]).stdout)
    assert done["complete"] is True

    events = read_events(env)
    kinds = [e["event"] for e in events]
    assert "shadow-skipped" in kinds and "seeded" not in kinds
    assert [e for e in events if e.get("wave") == 2] == [
        {"event": "shadow-skipped", "wave": 2,
         "reason": "wave completed via resolve"}]


def test_an_auto_unioned_wave_is_shadow_skipped(auto_union_env):
    """A wave that completes through the assume rung DID narrate a conflict,
    so "a conflict in the seeded pass is a divergence" no longer holds: this
    tier measures clean folds only."""
    env = auto_union_env
    reply = json.loads(run_cli(env, wave2_argv(env) + [
        "--commutes", "1=app.py", "--commutes", "2=app.py"]).stdout)
    assert reply["complete"] is True and reply["autoResolved"] == 1
    assert reply["clean"] is False
    assert [e for e in read_events(env) if e.get("wave") == 2] == [
        {"event": "shadow-skipped", "wave": 2,
         "reason": "fold narrated conflicts"}]


def test_a_wave_with_no_seedable_path_says_nothing(two_wave_env):
    """Wave 2 touches a path the manifest does not carry: an empty seed set is
    an expected miss, not an event."""
    env = two_wave_env
    (env.repo / "other.py").write_text("z = 1\n")
    _git(env.repo, "add", "-N", "other.py")
    patch = env.root / "w2-other.patch"
    patch.write_bytes(_git_raw(env.repo, "diff", "--binary", "--full-index",
                               "--no-renames", "HEAD"))
    _git(env.repo, "reset", "-q")
    (env.repo / "other.py").unlink()

    before = read_events(env)
    argv = ["fold", "--repo", ".", "--run-dir", str(env.run_dir), "--wave", "2",
            "--base", env.adopt_sha, "--patch", "1=%s" % patch]
    assert json.loads(run_cli(env, argv).stdout)["complete"] is True
    assert read_events(env) == before

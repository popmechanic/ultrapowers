"""The deterministic 2-wave cell — cross-wave validation of Tier 1 weave
persistence (spec `docs/superpowers/specs/2026-09-01-tier1-weave-persistence.md`
§6).

§5.3 chose a *local 2-wave contended cell* as the live validation shape. This
module is that cell frozen into CI: the same end-to-end drive the operator ran
by hand, but with **handcrafted patches instead of LLM workers**, so it is a
function of nothing but git and the kernel and runs the same way forever.

The cell, in full:

* one `app.py` with three disjoint regions;
* **wave 1** = two tasks editing disjoint regions of it, each captured as a
  `git diff` in its own throwaway clone (a worker's substrate, minus the
  worker) — `fold` (complete) → `materialize` → adopt the candidate →
  `emit-weave`;
* **wave 2** = one task editing *near* wave 1's edits, based at the adopt
  head, captured the same way — `fold` (complete), then `materialize` → adopt
  → `emit-weave` of its own.

What the cell pins is §6's machine-checked clause: wave 2's fold records at
least one `seeded` sidecar event with **zero** `drift` and **zero**
`divergence`, and wave 2's own `emit-weave` hands the manifest to the newest
adopted wave — `"wave": 2`, with a FRESH `visibleSha` equal to
`git rev-parse <wave-2 candidate>:app.py`.

The cell is built once per module and only read afterwards, so each clause of
§6 gets its own named assertion without re-driving five subprocesses apiece.
"""
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
KERNEL = ROOT / "skills" / "ultrapowers" / "kernel"
CLI = str(KERNEL / "fold_wave.py")

# Three regions, two blank lines apart, so wave 1's two tasks are disjoint by
# construction and wave 2 still lands adjacent to both of their edits.
BASE_APP = (
    "def alpha(x):\n"
    "    return x\n"
    "\n"
    "\n"
    "def beta(y):\n"
    "    return y\n"
    "\n"
    "\n"
    "def gamma(z):\n"
    "    return z\n"
)
# Wave 1, task 1: the top region only.
W1_T1_APP = BASE_APP.replace("    return x\n", "    return x + 1\n")
# Wave 1, task 2: the bottom region only.
W1_T2_APP = BASE_APP.replace("    return z\n", "    return z * 3\n")
# What the two of them fold to — the tree wave 2 is based at.
W1_ADOPTED_APP = (
    "def alpha(x):\n"
    "    return x + 1\n"
    "\n"
    "\n"
    "def beta(y):\n"
    "    return y\n"
    "\n"
    "\n"
    "def gamma(z):\n"
    "    return z * 3\n"
)
# Wave 2's single task: a line inserted directly above wave 1's `alpha` edit,
# and the middle region rewritten between wave 1's two edits. "Near", in both
# directions, which is the shape a stale seed would get wrong.
W2_ADOPTED_APP = (
    "def alpha(x):\n"
    "    # fast path\n"
    "    return x + 1\n"
    "\n"
    "\n"
    "def beta(y):\n"
    "    return y - 7\n"
    "\n"
    "\n"
    "def gamma(z):\n"
    "    return z * 3\n"
)


def _git(cwd, *args):
    return subprocess.run(["git", "-C", str(cwd), *args], check=True,
                          capture_output=True, text=True).stdout.strip()


def _git_raw(cwd, *args):
    return subprocess.run(["git", "-C", str(cwd), *args], check=True,
                          capture_output=True).stdout


def _init(repo):
    repo.mkdir(parents=True)
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "t@example.com")
    _git(repo, "config", "user.name", "T")


class Cell:
    """The whole two-wave drive's outputs, captured as it ran."""

    def __init__(self, repo, run_dir):
        self.repo = repo
        self.run_dir = run_dir
        self.base_sha = None
        self.wave1 = {}          # fold reply, candidate sha, emit reply
        self.wave2 = {}

    @property
    def weave(self):
        return self.run_dir / "frontier" / "weave"

    def manifest(self):
        return json.loads((self.weave / "manifest.json").read_text())

    def events(self):
        """The sidecar, oldest first — every wave's events in one file."""
        path = self.weave / "weave-events.jsonl"
        if not path.exists():
            return []
        return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]

    def events_for(self, wave):
        return [e for e in self.events() if e.get("wave") == wave]


def run_cli(repo, argv, expect_code=0):
    """The kernel CLI from inside the repo — `--repo .`, exactly as the engine
    invokes it from the integration worktree."""
    r = subprocess.run([sys.executable, CLI, *argv], cwd=str(repo),
                       capture_output=True, text=True)
    assert r.returncode == expect_code, (r.returncode, r.stdout, r.stderr)
    return json.loads(r.stdout) if r.stdout.strip() else None


def _worker_patch(repo, base_sha, work, name, text):
    """One task's patch, captured in a THROWAWAY CLONE checked out at
    `base_sha` — the deterministic stand-in for an LLM worker's own tree.

    The clone is the point: patch input makes folding a function of CONTENT,
    so the "worker" needs no branch, no push and no shared object store with
    the integration repo — only the diff it produces.
    """
    clone = work / name
    subprocess.run(["git", "clone", "-q", "--no-hardlinks", str(repo),
                    str(clone)], check=True, capture_output=True)
    _git(clone, "checkout", "-q", base_sha)
    (clone / "app.py").write_text(text)
    patch = work / ("%s.patch" % name)
    patch.write_bytes(_git_raw(clone, "diff", "--binary", "--full-index",
                               "--no-renames", base_sha))
    assert patch.stat().st_size > 0, "%s produced an empty patch" % name
    return patch


@pytest.fixture(scope="module")
def cell(tmp_path_factory):
    """Drive the full cell once: wave 1 (two disjoint tasks) then wave 2 (one
    task near their edits), each folded, materialized, adopted and emitted."""
    root = tmp_path_factory.mktemp("crosswave")
    repo = root / "repo"
    work = root / "workers"
    work.mkdir()
    _init(repo)
    (repo / "app.py").write_text(BASE_APP)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "base")
    _git(repo, "checkout", "-q", "-B", "integration")
    c = Cell(repo, root / "run")
    c.base_sha = _git(repo, "rev-parse", "HEAD")

    # --- wave 1: two tasks, disjoint regions of one file -----------------
    p1 = _worker_patch(repo, c.base_sha, work, "w1-t1", W1_T1_APP)
    p2 = _worker_patch(repo, c.base_sha, work, "w1-t2", W1_T2_APP)
    c.wave1["patches"] = [p1, p2]
    c.wave1["fold"] = run_cli(repo, [
        "fold", "--repo", ".", "--run-dir", str(c.run_dir),
        "--wave", "1", "--base", c.base_sha,
        "--patch", "t1=%s" % p1, "--patch", "t2=%s" % p2])
    c.wave1["materialize"] = run_cli(repo, [
        "materialize", "--repo", ".", "--run-dir", str(c.run_dir),
        "--wave", "1", "--prev-head", c.base_sha,
        "--patch", "t1=%s" % p1, "--patch", "t2=%s" % p2])
    c.wave1["candidate"] = c.wave1["materialize"]["candidateSha"]
    _git(repo, "reset", "-q", "--hard", c.wave1["candidate"])   # the adopt leg
    c.wave1["emit"] = run_cli(repo, [
        "emit-weave", "--repo", ".", "--run-dir", str(c.run_dir),
        "--wave", "1", "--adopt-head", c.wave1["candidate"]])

    # --- wave 2: one task, based at the adopt head -----------------------
    adopt1 = c.wave1["candidate"]
    p3 = _worker_patch(repo, adopt1, work, "w2-t1", W2_ADOPTED_APP)
    c.wave2["patches"] = [p3]
    c.wave2["fold"] = run_cli(repo, [
        "fold", "--repo", ".", "--run-dir", str(c.run_dir),
        "--wave", "2", "--base", adopt1, "--patch", "t3=%s" % p3])
    c.wave2["materialize"] = run_cli(repo, [
        "materialize", "--repo", ".", "--run-dir", str(c.run_dir),
        "--wave", "2", "--prev-head", adopt1, "--patch", "t3=%s" % p3])
    c.wave2["candidate"] = c.wave2["materialize"]["candidateSha"]
    _git(repo, "reset", "-q", "--hard", c.wave2["candidate"])
    c.wave2["emit"] = run_cli(repo, [
        "emit-weave", "--repo", ".", "--run-dir", str(c.run_dir),
        "--wave", "2", "--adopt-head", c.wave2["candidate"]])
    return c


# --- wave 1: the cell's own preconditions -------------------------------


CLEAN_COMPLETE = {"clean": True, "conflicts": 0, "dispatchable": 0,
                  "parked": 0, "open": [], "remaining": [], "autoResolved": 0,
                  "complete": True, "selfChecks": "ok"}


def test_wave1_folds_complete_and_clean(cell):
    """Two writers of disjoint regions is a clean, complete fold — if this
    ever stops holding, every §6 assertion below is measuring the wrong wave."""
    assert cell.wave1["fold"] == CLEAN_COMPLETE


def test_wave1_candidate_holds_both_disjoint_edits(cell):
    blob = _git(cell.repo, "show", "%s:app.py" % cell.wave1["candidate"])
    assert blob + "\n" == W1_ADOPTED_APP


def test_wave1_emit_weave_persists_the_one_folded_path(cell):
    assert cell.wave1["emit"] == {"emitted": 1, "superseded": 0}


# --- §6: the seeded wave ------------------------------------------------


def test_wave2_folds_complete_over_the_adopt_head(cell):
    """And byte-identical to wave 1's reply: seeding is shadow-only, so the
    presence of a weave dir cannot show up here."""
    assert cell.wave2["fold"] == CLEAN_COMPLETE


def test_wave2_records_at_least_one_seeded_event(cell):
    """§6: `seeded` sidecar events on wave 2+. One folded path, one seed."""
    seeded = [e for e in cell.events_for(2) if e["event"] == "seeded"]
    assert len(seeded) >= 1
    assert seeded == [{"event": "seeded", "wave": 2, "path": "app.py"}]


def test_wave2_records_zero_drift_and_zero_divergence(cell):
    """§6's other half — and the reason the cell exists: a persisted state
    carried across an adoption still describes what git holds, and re-folding
    over it lands on the same tree the fresh pass did."""
    kinds = [e["event"] for e in cell.events_for(2)]
    assert kinds.count("drift") == 0
    assert kinds.count("divergence") == 0
    assert kinds.count("shadow-skipped") == 0


def test_the_sidecar_holds_only_the_two_waves_own_events(cell):
    """The whole cell's sidecar, in order: wave 1 emitted, wave 2 seeded, wave
    2 emitted. Nothing else was written across two full waves."""
    assert [(e["event"], e["wave"]) for e in cell.events()] == [
        ("emitted", 1), ("seeded", 2), ("emitted", 2)]


def test_no_weave_record_reached_either_fold_log(cell):
    """`kernel/FOLD_LOG.md`'s three-type vocabulary, pinned across the cell:
    seeding is shadow-only, so neither wave's log grew a weave event."""
    for wave in (1, 2):
        log = (cell.run_dir / "frontier" / ("wave-%d" % wave) / "fold_log.jsonl")
        kinds = {json.loads(l)["type"]
                 for l in log.read_text().splitlines() if l.strip()}
        assert kinds == {"base", "fold"}


# --- §6: wave 2 owns the manifest ---------------------------------------


def test_wave2_candidate_holds_the_edits_near_wave1s(cell):
    blob = _git(cell.repo, "show", "%s:app.py" % cell.wave2["candidate"])
    assert blob + "\n" == W2_ADOPTED_APP


def test_wave2_emit_weave_replaces_the_manifest_wholesale(cell):
    """§6: `"wave": 2` with a FRESH `visibleSha` — git's own blob sha for
    app.py at the wave-2 candidate, not the wave-1 one it replaced."""
    assert cell.wave2["emit"] == {"emitted": 1, "superseded": 0}
    manifest = cell.manifest()
    assert manifest["wave"] == 2
    assert sorted(manifest) == ["entries", "wave"]
    assert sorted(manifest["entries"]) == ["app.py"]

    expected = _git(cell.repo, "rev-parse",
                    "%s:app.py" % cell.wave2["candidate"])
    assert manifest["entries"]["app.py"]["visibleSha"] == expected

    wave1_blob = _git(cell.repo, "rev-parse",
                      "%s:app.py" % cell.wave1["candidate"])
    assert expected != wave1_blob


def test_the_wave2_manifest_blob_is_on_disk_and_content_addressed(cell):
    """The seed wave 3 would be offered: named by its own sha256, holding the
    state string wave 2's fold ended on."""
    import hashlib
    entry = cell.manifest()["entries"]["app.py"]
    state = (cell.weave / "blobs" / entry["stateBlob"]).read_text()
    assert hashlib.sha256(state.encode()).hexdigest() == entry["stateBlob"]

    sys.path.insert(0, str(KERNEL))
    sys.path.insert(0, str(KERNEL / "vendor"))
    import manyana                              # noqa: E402
    import repo_weave as rw                     # noqa: E402
    assert rw.join_lines(manyana.current_lines(state)) == W2_ADOPTED_APP

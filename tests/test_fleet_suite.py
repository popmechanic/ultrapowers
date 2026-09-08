import fcntl
import glob, os, subprocess, pytest

FLEET = os.path.join(os.path.dirname(__file__), "..", "fleet")
# Measured wall at 0.3.19 under `-n 6`: 40.9 s, 33.3 s, 30.7 s, 17.0 s, 13.3 s,
# 12.6 s, 10.6 s.
# Under `--dist load` a worker that picks up a 40 s sim last holds the whole
# suite open, so the seven longest go out first; the rest follow in relative-path
# order. A name that leaves fleet/tests/ simply drops out of the list.
# test_sandbox_boot_selfmerge.mjs leads it as the longest sim that boots
# fleet/sandbox-boot.sh — the pole test_sandbox_boot_merge.mjs used to hide.
# The merge sim ran it and six other boot siblings inside itself and no longer
# does, so the wall that used to be charged to the merge sim is this one's now,
# out where the bridge can dispatch it first. test_run_engine_proof_runs.mjs is
# longer still and follows it: the head of this list goes out in one dispatch
# round, so the order WITHIN it is not what keeps a worker from stranding —
# membership is. `timeout` below reads MJS_TIMEOUT rather than a literal so the
# cap and this list keep being read together.
SLOW_FIRST = ('test_sandbox_boot_selfmerge.mjs', 'test_run_engine_proof_runs.mjs',
              'test_sandbox_boot.mjs', 'test_sandbox_boot_merge.mjs',
              'test_sandbox_boot_edges.mjs', 'test_run_engine_exam_evidence.mjs',
              'test_publish_fold.mjs')


def _sim_id(fleet_dir, path):
    """`path` as the bridge names it: relative to `<fleet_dir>/tests`, /-joined.

    `test_x.mjs` for a curated sim, `exams/run_7/test_x.mjs` for an exam. The
    basename alone was the id while every sim sat in one directory; it stopped
    being an identity the moment a run's exams could carry a curated sim's name.
    """
    rel = os.path.relpath(path, os.path.join(fleet_dir, "tests"))
    return rel.replace(os.sep, "/")


def _order_key(rel):
    """SLOW_FIRST members in SLOW_FIRST order, then the rest by relative path.

    Membership is by basename — SLOW_FIRST is a list of wall measurements, and a
    sim's wall does not change because a run copied it into `exams/`. The
    relative path is the tiebreaker, so two files of one basename in different
    directories order deterministically instead of one displacing the other.
    """
    name = rel.rsplit("/", 1)[-1]
    rank = SLOW_FIRST.index(name) if name in SLOW_FIRST else len(SLOW_FIRST)
    return (rank, rel)


def collect_sims(fleet_dir):
    """Every sim `<fleet_dir>/tests/` offers, slowest-first then alphabetical.

    Two sources, one list: the curated `tests/test_*.mjs`, and the exams a run
    writes into the reserved `tests/exams/<slug>/` (#777). The reserved
    directory does not exist on main, so the second glob is empty there and CI
    keeps running the curated tree with no workflow edit; inside a run the
    branch carries the exams and the suite collects them by the same rule.

    Returns paths under `fleet_dir` (what `node` is handed), ordered by the
    relative name (what the parametrize id shows).
    """
    tests_dir = os.path.join(fleet_dir, "tests")
    paths = (glob.glob(os.path.join(tests_dir, "test_*.mjs"))
             + glob.glob(os.path.join(tests_dir, "exams", "*", "test_*.mjs")))
    return sorted(paths, key=lambda p: _order_key(_sim_id(fleet_dir, p)))


TESTS = collect_sims(FLEET)
IDS = [_sim_id(FLEET, path) for path in TESTS]


def _ensure_node_modules():
    """Install fleet deps at most once even under pytest-xdist (#426): every
    worker process runs this check-then-act, so the check must sit inside an
    exclusive flock — otherwise a second worker sees the node_modules dir npm
    creates first and runs node against a half-written tree. package.json is
    the lock file: always present, never modified by flock (advisory only).
    No unlocked fast path: npm creates node_modules early, so an isdir check
    outside the lock would pass while a peer's install is still writing."""
    with open(os.path.join(FLEET, "package.json")) as lockf:
        fcntl.flock(lockf, fcntl.LOCK_EX)
        if not os.path.isdir(os.path.join(FLEET, "node_modules")):
            subprocess.run(["npm", "install", "--no-audit", "--no-fund"],
                           cwd=FLEET, check=True, capture_output=True)


# The cap is per sim, and it is a hang detector, not a budget: a sim that has
# not spoken in this long is wedged, not slow. 120 s was a fit for a fleet whose
# longest sim was 83.5 s, and it stopped being one when the merge sim's nesting
# put ~130 s of wall on one name on an idle four-core box. That nesting is gone:
# the longest pole among the boot sims is test_sandbox_boot_selfmerge.mjs at
# ~33 s here, and test_run_engine_proof_runs.mjs at ~41 s is the longest of any
# sim. The cap stays 300 s because it is sized for the slowest box the suite
# runs on rather than this one — a four-vCPU sandbox with every core busy under
# `-n auto` takes several times these walls — and because a hang detector is
# worth nothing if it fires on a slow box instead of a wedged sim.
MJS_TIMEOUT = 300


@pytest.mark.parametrize("path", TESTS, ids=IDS)
def test_fleet_mjs(path):
    _ensure_node_modules()
    # 300 s and not 120: the wall has to clear the LONGEST sim under `-n auto`
    # contention on the slowest box the suite runs on, not on the box that
    # measured the numbers above. A wall only a little over an honest runtime
    # reports a slow box as a broken suite; this one is a deadlock catcher,
    # not a budget.
    r = subprocess.run(["node", path], capture_output=True, text=True, timeout=MJS_TIMEOUT)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "ALL TESTS PASSED" in r.stdout


def test_fleet_has_tests():
    assert TESTS, "fleet/tests/ must contain at least one test_*.mjs"

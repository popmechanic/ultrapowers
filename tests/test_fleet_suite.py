import fcntl
import glob, os, subprocess, pytest

FLEET = os.path.join(os.path.dirname(__file__), "..", "fleet")

# Measured wall at 0.3.11: 83.5 s, 40.9 s, 27.0 s, 9.8 s, 8.1 s, 6.4 s. Under
# `--dist load` a worker that picks up an 83 s sim last holds the whole suite
# open, so the six longest go out first, longest first; the rest follow
# alphabetically. A name that leaves fleet/tests/ simply drops out of the list.
SLOW_FIRST = ('test_run_engine_examiner.mjs', 'test_sandbox_boot.mjs',
              'test_exam_edited_patches.mjs', 'test_run_engine_integrated_runs.mjs',
              'test_run_engine_proof_runs.mjs', 'test_deadline_slack.mjs')


def _slowest_first(paths):
    """`paths` ordered SLOW_FIRST-then-alphabetical by basename."""
    by_name = {os.path.basename(p): p for p in paths}
    ordered = [by_name[name] for name in SLOW_FIRST if name in by_name]
    ordered += [by_name[name] for name in sorted(by_name) if name not in SLOW_FIRST]
    return ordered


TESTS = _slowest_first(glob.glob(os.path.join(FLEET, "tests", "test_*.mjs")))


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


@pytest.mark.parametrize("path", TESTS, ids=[os.path.basename(p) for p in TESTS])
def test_fleet_mjs(path):
    _ensure_node_modules()
    r = subprocess.run(["node", path], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "ALL TESTS PASSED" in r.stdout


def test_fleet_has_tests():
    assert TESTS, "fleet/tests/ must contain at least one test_*.mjs"

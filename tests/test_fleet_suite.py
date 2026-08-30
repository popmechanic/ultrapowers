import fcntl
import glob, os, subprocess, pytest

FLEET = os.path.join(os.path.dirname(__file__), "..", "fleet")
TESTS = sorted(glob.glob(os.path.join(FLEET, "tests", "test_*.mjs")))


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

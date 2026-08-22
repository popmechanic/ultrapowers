import glob, os, subprocess, pytest

FLEET = os.path.join(os.path.dirname(__file__), "..", "fleet")
TESTS = sorted(glob.glob(os.path.join(FLEET, "tests", "test_*.mjs")))

@pytest.mark.parametrize("path", TESTS, ids=[os.path.basename(p) for p in TESTS])
def test_fleet_mjs(path):
    if not os.path.isdir(os.path.join(FLEET, "node_modules")):
        subprocess.run(["npm", "install", "--no-audit", "--no-fund"], cwd=FLEET, check=True, capture_output=True)
    r = subprocess.run(["node", path], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "ALL TESTS PASSED" in r.stdout

def test_fleet_has_tests():
    assert TESTS, "fleet/tests/ must contain at least one test_*.mjs"

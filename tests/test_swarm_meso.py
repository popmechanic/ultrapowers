"""Run the JS meso-assembly spec (tests/swarm_meso_spec.mjs). Requires node; skips without it."""
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = ROOT / "tests/swarm_meso_spec.mjs"


def test_swarm_meso_js():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not available")
    p = subprocess.run([node, str(SPEC)], capture_output=True, text=True)
    assert p.returncode == 0, p.stdout + p.stderr
    assert "ALL TESTS PASSED" in p.stdout, p.stdout + p.stderr

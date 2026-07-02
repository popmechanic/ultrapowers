"""Run the integration-ancestry simulation (tests/wave_ancestry_sim.mjs).

Loads the real waves.js and asserts the #70 ancestry contract (a recorded
headSha missing from the integration ancestry forces the run BLOCKED).
Previously this sim ran only via the suite-gate on harness-JS diffs; wiring
it here puts it in the default `pytest` and CI. Requires node; skips without.
"""
import pathlib, shutil, subprocess
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SIM = ROOT / "tests/wave_ancestry_sim.mjs"


def test_wave_ancestry_simulation():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not available")
    p = subprocess.run([node, str(SIM)], capture_output=True, text=True)
    assert p.returncode == 0, p.stdout + p.stderr
    assert "ALL SCENARIOS PASSED" in p.stdout, p.stdout + p.stderr

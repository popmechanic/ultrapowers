"""Run the workflow orchestration simulation (tests/sim_workflow.mjs).

The simulation stubs the Workflow engine globals and executes workflow.js the
way the engine does, asserting the orchestration logic end-to-end (happy path,
fix-loop, blocked-wave cascade, fail-loud args). Requires node; skips without it.
"""
import pathlib, shutil, subprocess
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SIM = ROOT / "tests/sim_workflow.mjs"


def test_workflow_simulation():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not available")
    p = subprocess.run([node, str(SIM)], capture_output=True, text=True)
    assert p.returncode == 0, p.stdout + p.stderr
    assert "ALL SCENARIOS PASSED" in p.stdout, p.stdout + p.stderr

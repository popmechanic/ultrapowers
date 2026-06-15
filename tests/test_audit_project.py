"""Run the JS transcript-projection spec (tests/audit_project_spec.mjs).

Projection logic lives once, in viewer/audit_project.js; this is its guard.
Requires node; skips without it (same pattern as test_workflow_sim.py)."""
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = ROOT / "tests/audit_project_spec.mjs"


def test_audit_projection_js():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not available")
    p = subprocess.run([node, str(SPEC)], capture_output=True, text=True)
    assert p.returncode == 0, p.stdout + p.stderr
    assert "ALL TESTS PASSED" in p.stdout, p.stdout + p.stderr

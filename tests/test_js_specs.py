"""One parametrized runner for the committed node specs/sims (previously six
per-file shims). Requires node; skips without it.

wave_ancestry_sim and sim_workflow run here so the #70 ancestry contract and
the workflow simulation sit in the default `pytest` and CI, not only behind
the harness-JS suite-gate. Sentinels are load-bearing: run_acceptance.sh
--suite-gate greps `ALL (SCENARIOS|TESTS) PASSED`."""
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]

SPECS = [
    ("swarm_layout_spec.mjs", "ALL TESTS PASSED"),
    ("swarm_meso_spec.mjs", "ALL TESTS PASSED"),
    ("swarm_zoom_spec.mjs", "ALL TESTS PASSED"),
    ("audit_project_spec.mjs", "ALL TESTS PASSED"),
    ("wave_ancestry_sim.mjs", "ALL SCENARIOS PASSED"),
    ("sim_workflow.mjs", "ALL SCENARIOS PASSED"),
]


@pytest.mark.parametrize("spec,sentinel", SPECS, ids=[s for s, _ in SPECS])
def test_js_spec(spec, sentinel):
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not available")
    p = subprocess.run([node, str(ROOT / "tests" / spec)],
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stdout + p.stderr
    assert sentinel in p.stdout, p.stdout + p.stderr

"""One parametrized runner for the committed node engine sims. Requires node;
skips without it.

wave_ancestry_sim and sim_workflow run here so the #70 ancestry contract and
the workflow simulation sit in the default `pytest` and CI, not only behind
the harness-JS suite-gate. Sentinels are load-bearing: run_acceptance.sh
--suite-gate greps `ALL (SCENARIOS|TESTS) PASSED`. The four viewer specs died
with the viewer (One Driver Phase 0, row 8)."""
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]

SPECS = [
    ("wave_ancestry_sim.mjs", "ALL SCENARIOS PASSED"),
    ("sim_workflow.mjs", "ALL SCENARIOS PASSED"),
    ("sim_base_ancestry.mjs", "ALL SCENARIOS PASSED"),
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


def test_no_viewer_left_behind():
    """Phase 0 row 8: the viewer directory, its three scripts and its four
    specs are gone; nothing under tests/ references `viewer/` any more."""
    assert not (ROOT / "skills/ultrapowers/viewer").exists()
    for name in ("render_viewer.py", "serve_viewer.py", "swarm_watch.py"):
        assert not (ROOT / "skills/ultrapowers/scripts" / name).exists(), name
    for spec in ("swarm_layout_spec.mjs", "swarm_meso_spec.mjs",
                 "swarm_zoom_spec.mjs", "audit_project_spec.mjs"):
        assert not (ROOT / "tests" / spec).exists(), spec
    assert not [p for p in (ROOT / "tests").glob("*.py")
                if p != pathlib.Path(__file__).resolve()
                and "viewer/" in p.read_text()]

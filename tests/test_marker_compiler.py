"""The compiler reference (dependency-analysis.md) must consume the marker
contract: classification precedes DAG construction, Depends-on is an edge
source, and excluded tasks land in the post-merge runbook."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEP_ANALYSIS = ROOT / "skills/ultrapowers/references/dependency-analysis.md"
TYPES = ("implementation", "gate", "release", "manual")


def test_compiler_reference_wires_the_executable_compiler():
    text = DEP_ANALYSIS.read_text()
    assert "compile_plan.py" in text
    assert "derived_knobs" in text
    assert '"heuristic": true' in text

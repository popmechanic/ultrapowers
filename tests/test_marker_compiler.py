"""The compiler reference (dependency-analysis.md) must consume the marker
contract: classification precedes DAG construction, Depends-on is an edge
source, and excluded tasks land in the post-merge runbook."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEP_ANALYSIS = ROOT / "skills/ultrapowers/references/dependency-analysis.md"
TYPES = ("implementation", "gate", "release", "manual")


def test_compiler_classifies_before_building_the_dag():
    text = DEP_ANALYSIS.read_text()
    assert "plan-markers.md" in text
    idx_classify = text.index("## Classify")
    idx_dag = text.index("## Build the DAG")
    assert idx_classify < idx_dag, "classification must precede DAG construction"
    for t in TYPES:
        assert t in text, f"type '{t}' missing from the compiler reference"


def test_compiler_consumes_depends_on_markers():
    text = DEP_ANALYSIS.read_text()
    assert "**Depends-on:**" in text
    assert "additive" in text
    assert "marker_conflicts" in text


def test_compiler_collects_runbook_and_inlines_preamble():
    text = DEP_ANALYSIS.read_text()
    assert "post-merge runbook" in text
    assert "preamble" in text.lower()
    assert "fence-aware" in text
    assert "dispositions" in text   # transparency block carries them


def test_compiler_reference_wires_the_executable_compiler():
    text = DEP_ANALYSIS.read_text()
    assert "compile_plan.py" in text
    assert "derived_knobs" in text
    assert '"heuristic": true' in text

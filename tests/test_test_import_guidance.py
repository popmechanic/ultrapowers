"""The test-import Depends-on guidance (#71) must live in BOTH ultraplan mirrors
so a test-only import edge is declared, not left to cascade-block a wave."""
import pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]
MARKERS = (ROOT / "skills/ultrapowers/references/plan-markers.md").read_text().lower()
SKILL = (ROOT / "skills/ultraplan/SKILL.md").read_text().lower()

def test_markers_document_test_import_dependency():
    assert "import" in MARKERS and "depends-on" in MARKERS
    # the guidance ties a test's import of a sibling symbol to an explicit Depends-on
    assert "test" in MARKERS and "sibling" in MARKERS

def test_skill_mirrors_test_import_guidance():
    assert "import" in SKILL and "depends-on" in SKILL and "test" in SKILL

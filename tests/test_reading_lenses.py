from pathlib import Path

DOC = Path(__file__).resolve().parents[1] / "skills/ultralearn/references/reading-lenses.md"

REQUIRED_LENSES = ["friction", "routing", "operator", "cost", "frontier"]
REQUIRED_KEYS = ["runId", "lens", "title", "novelty", "severity",
                 "evidence", "evidenceAbstracted", "implication", "surface"]

def test_rubric_documents_all_lenses_and_schema_keys():
    text = DOC.read_text()
    for lens in REQUIRED_LENSES:
        assert lens in text, f"lens {lens!r} missing from rubric"
    for key in REQUIRED_KEYS:
        assert key in text, f"schema key {key!r} missing from rubric"

def test_rubric_names_the_emergent_seed_and_foreign_rule():
    text = DOC.read_text().lower()
    assert "test-driven development" in text or "tdd" in text, "emergent-behavior seed example missing"
    assert "foreign" in text and "abstract" in text, "foreign-run abstraction rule missing"

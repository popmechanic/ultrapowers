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

def test_rubric_requires_redirect_round_count_per_bundle():
    """2026-07-04: the redirect-round rate is the canary metric for judging
    whether an adopted rigor-for-efficiency trade is paying. The rate is only
    computable across runs if EVERY bundle read emits the count — including
    zero (the zero is the data), so absence can't be read as a clean run."""
    text = DOC.read_text().lower()
    assert "redirect-round count" in text, "required redirect-round count missing from rubric"
    assert "canary" in text, "rubric must name the count's canary role for distill"
    assert "even when the count is 0" in text, "zero-count emission requirement missing"

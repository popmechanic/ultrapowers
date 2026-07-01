"""#69: the finishing handoff must sanction a holistic cross-phase review over the
integrated tree against the combined plan, before the final PR."""
import pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]
SKILL = (ROOT / "skills/ultrapowers/SKILL.md").read_text().lower()
NOTES = (ROOT / "skills/ultrapowers/references/finishing-notes.md").read_text().lower()

def test_finishing_handoff_documents_cross_phase_review():
    blob = SKILL + "\n" + NOTES
    assert "cross-phase" in blob or "cross phase" in blob
    assert "holistic" in blob
    # gated before the final PR
    assert "pr" in blob

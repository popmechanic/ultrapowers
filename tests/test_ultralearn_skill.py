from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/ultralearn/SKILL.md"
CI = ROOT / ".github/workflows/ci.yml"


def test_skill_has_frontmatter_and_both_verbs():
    text = SKILL.read_text()
    assert text.startswith("---"), "missing YAML frontmatter"
    assert "name:" in text and "description:" in text
    assert "harvest_runs.py" in text and "merge_ledger.py" in text
    assert "distill" in text  # the second verb is documented


def test_skill_documents_human_gate_and_two_tier_privacy():
    text = SKILL.read_text().lower()
    assert "human" in text and "approv" in text  # nothing files without approval
    assert "foreign" in text and "abstract" in text


def test_ci_validates_ultralearn():
    assert "skills/ultralearn" in CI.read_text()

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


def test_distill_is_structural_first():
    """2026-07-03 discovery (deterministic-driver cycle): holistic architecture
    fixes beat reactive per-defect guards — one structural move retired four
    recurring ledger classes that guards had been chasing run after run.
    Structural-first must be the rubric's default order of consideration
    (ask what change deletes the whole class BEFORE drafting a guard),
    not merely a framing preference."""
    rubric = (ROOT / "skills/ultralearn/references/distilling-proposals.md").read_text().lower()
    skill = SKILL.read_text().lower()
    assert "structural-first" in skill
    assert "structural-first" in rubric
    # the rubric must state the why: reactive guard accretion breeds fragility
    assert "reactive" in rubric and "accret" in rubric

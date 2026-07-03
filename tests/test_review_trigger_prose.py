import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/ultrapowers/SKILL.md"
PROMPTS = ROOT / "skills/ultrapowers/references/reviewer-prompts.md"


def test_skill_review_depth_is_plan_authored_not_engine_derived():
    src = SKILL.read_text()
    # The mis-firing proxy must be gone: tier alone must not warrant adversarial.
    assert "most-capable` tasks warrant\n  `adversarial`" not in src
    assert "most-capable` tasks warrant `adversarial`" not in src
    # Review depth is a plan-authored property (the ultraplan `**Review:**`
    # marker), not an engine-derived risk-lexicon heuristic (#87 deletion).
    assert "plan-authored" in src
    assert "**Review:**" in src
    assert "engine-derived" not in src


def test_prompts_record_no_split_decision():
    src = PROMPTS.read_text()
    # The divergence note must record the decided end-state: keep both passes
    # full-spectrum; do NOT split into spec-only / quality-only.
    assert "full-spectrum" in src
    assert "do not split" in src.lower()
    # And must NOT still present the split as the intended restoration/upgrade.
    assert "the place to restore it (pass 1 spec-only, pass 2 quality-only)" not in src

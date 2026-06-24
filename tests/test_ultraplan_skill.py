"""The ultraplan authoring skill must mirror the canonical marker contract
(plan-markers.md BAKE blocks) verbatim — same anti-drift discipline as
test_no_prompt_drift.py uses for workflow.js."""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "skills/ultrapowers/references/plan-markers.md"
ULTRAPLAN = ROOT / "skills/ultraplan/SKILL.md"

MARKER = re.compile(r"<!-- BAKE:(\w+) -->(.*?)<!-- /BAKE -->", re.DOTALL)


def normalize(s: str) -> str:
    s = s.lower()
    s = re.sub(r"'s\b", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return s.strip()


def contract_blocks():
    blocks = {name: body for name, body in MARKER.findall(CONTRACT.read_text())}
    assert blocks, "no <!-- BAKE:NAME --> markers found in plan-markers.md"
    return blocks


def test_ultraplan_mirrors_the_canonical_contract():
    blocks = contract_blocks()
    skill = normalize(ULTRAPLAN.read_text())
    for name in ("MARKER_SYNTAX", "TYPE_SEMANTICS"):
        expected = normalize(blocks[name])
        assert expected, "empty contract block " + name
        assert expected in skill, (
            "drift: BAKE:" + name + " in plan-markers.md is not mirrored in "
            "skills/ultraplan/SKILL.md — copy the block content verbatim.")


def test_ultraplan_does_not_cross_reference_other_skill_dirs():
    # validate_skill.py resolves `references/...` mentions against the skill's
    # OWN directory; a literal cross-skill path would fail validation or dangle.
    assert "references/plan-markers.md" not in ULTRAPLAN.read_text()


def test_ultraplan_pairs_with_writing_plans():
    text = ULTRAPLAN.read_text()
    assert "superpowers:writing-plans" in text
    assert "worktree-pure" in text


def test_ultraplan_overrides_the_execution_header_and_handoff():
    text = ULTRAPLAN.read_text()
    assert "REQUIRED SUB-SKILL" in text          # quotes the upstream header it replaces
    assert "ultrapowers:ultrapowers" in text     # names the parallel executor
    assert "Execution Handoff" in text           # overrides writing-plans' two-option menu
    # Anti-drift pin for the no-pause contract (2026-06-12): the handoff's
    # option 1 must keep saying that selecting ultrapowers authorizes
    # execution with no further approval pause (mirrors SKILL.md Step 3).
    assert "authorizes execution" in text
    assert "without a further approval pause" in text


def test_ultraplan_handoff_analyzes_before_recommending():
    text = ULTRAPLAN.read_text()
    # The reflex crown is gone: no unconditional "recommended for marked plans".
    assert "(recommended for marked plans)" not in text
    # The handoff now runs a fit analysis grounded in the rubric.
    assert "parallel width" in text
    assert "risk override" in text
    assert "T≥4" in text
    # All three lanes are named as recommendable outcomes.
    for lane in ("Ultrapowers", "Subagent-Driven", "Inline"):
        assert lane in text

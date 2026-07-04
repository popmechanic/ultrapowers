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


def test_ultraplan_shapes_decomposition_before_annotating():
    text = ULTRAPLAN.read_text()
    # The new up-front shaping phase exists...
    assert "Shape the decomposition" in text
    # ...with its load-bearing moves and the justification gate...
    assert "contract-first" in text
    assert "would a good engineer" in text
    assert "Parallelization rationale" in text
    # ...and an explicit escape valve so linear specs are not forced to widen.
    assert "no latent parallelism" in text


def test_ultraplan_mirrors_the_review_marker_line():
    # BAKE:MARKER_SYNTAX now includes **Review:** — the existing whole-block
    # mirror pin above already enforces this verbatim, but pin the marker
    # itself directly too so a future BAKE-block edit can't silently drop it.
    blocks = contract_blocks()
    assert "**Review:**" in blocks["MARKER_SYNTAX"]
    text = normalize(ULTRAPLAN.read_text())
    assert normalize("**Review:**") in text
    assert "adversarial" in text
    assert "lean" in text


def test_ultraplan_carries_the_review_authoring_rubric():
    text = ULTRAPLAN.read_text()
    # Authoring rubric (#87): decide review depth explicitly at plan-writing
    # time, using the same risk list the execution-handoff rubric uses.
    assert "decide review depth explicitly" in text
    assert "**Review:** adversarial" in text
    assert "The engine derives nothing" in text
    assert "unmarked means lean" in text


def test_ultraplan_carries_shrink_budget_and_escalation_guidance():
    text = ULTRAPLAN.read_text()
    # Two new authoring-guidance notes (#87): the shrink-budget pattern and
    # escalation-prone tiering.
    assert "Shrink budgets are acceptance criteria." in text
    assert "Tier escalation-prone tasks up front." in text


def test_contract_documents_the_files_grammar():
    # plan-markers.md is the canonical contract (#85): it must document the
    # narrowed Files grammar the compiler now enforces — canonical labels,
    # the annotation/glob bail, and the catch-all construct.
    text = CONTRACT.read_text()
    assert "Create" in text and "Modify" in text and "Test" in text
    assert "catch-all" in text
    assert "glob" in text.lower()
    assert "annotation" in text.lower()


def test_contract_documents_the_interfaces_grammar():
    # plan-markers.md documents the symbol-list rule and the placeholder
    # forms that tokenize to empty (#85).
    text = CONTRACT.read_text()
    assert "symbol list" in text.lower()
    for placeholder in ("nothing", "none", "n/a"):
        assert placeholder in text


def test_ultraplan_ends_authoring_with_the_check_step():
    # #85: a marked plan is not done until `--check` passes — this is the
    # mandatory final authoring step, not an optional suggestion.
    text = ULTRAPLAN.read_text()
    assert "compile_plan.py --check" in text
    assert "PLAN OK" in text
    assert "not done until it passes the grammar check" in text

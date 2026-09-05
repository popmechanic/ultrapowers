"""The ultralearn spec-review brief asks for thinness and scope first (#519).

Reads the one section of `skills/ultralearn/references/distilling-proposals.md`
that #519 rewrites — from its heading to the next section's — and pins the
operative parts in order. Whitespace runs are squeezed to one space so a
sentence may wrap however the author likes.
"""

import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
BRIEF = REPO / "skills/ultralearn/references/distilling-proposals.md"

HEADING = "## The spec review (spec approval — every spec in this repo)"
NEXT_HEADING = "## The adopted-proposal retrospective"


def brief_text():
    return BRIEF.read_text(encoding="utf-8")


def section_raw():
    """The section's lines, from its heading up to (not including) the next."""
    lines = brief_text().splitlines()
    starts = [i for i, ln in enumerate(lines) if ln.startswith("## The spec review")]
    assert starts, "no `## The spec review` heading in the brief"
    start = starts[0]
    ends = [
        i for i, ln in enumerate(lines) if i > start and ln.startswith(NEXT_HEADING)
    ]
    assert ends, "no `## The adopted-proposal retrospective` heading after the section"
    return "\n".join(lines[start : ends[0]])


def section():
    """The section with whitespace runs squeezed to one space."""
    return re.sub(r"\s+", " ", section_raw())


# --- M1: the heading is renamed -------------------------------------------


def test_new_heading_is_exact_and_alone_on_its_line():
    assert HEADING in brief_text().splitlines()


def test_no_trim_review_heading_remains():
    assert not [
        ln for ln in brief_text().splitlines() if ln.startswith("## The trim review")
    ]


# --- M2: under-specification first, then scope reconciliation --------------


def test_under_specification_precedes_scope_reconciliation():
    body = section().lower()
    thin = body.index("under-specification")
    scope = min(
        (body.index(p) for p in ("reconcile scope", "scope reconciliation") if p in body),
        default=-1,
    )
    assert scope > thin >= 0, "scope reconciliation must follow under-specification"


def test_four_under_specification_shapes_are_named():
    body = section()
    assert re.search(r"ambiguous rule.*cannot build as written", body)
    assert re.search(r"missing refusal.*failure semantics", body)
    assert re.search(r"unstated migration behaviou?r", body)
    assert "authority granted without an enforcement point" in body


def test_scope_is_reconciled_against_the_decision_records():
    body = section()
    assert re.search(r"scope.*against the decision records.*every expansion", body)
    assert re.search(r"decision.*only in .*conversation", body)
    assert "contradiction" in body


# --- M3: trims are optional output ----------------------------------------


def test_trim_proposals_are_welcome_but_not_the_mandate():
    assert re.search(r"trim proposals.*welcome.*not the mandate", section(), re.I)


def test_old_per_element_trim_mandate_is_gone():
    raw = section_raw()
    assert "Propose the trimmed version" not in raw
    assert "for each design element" not in raw


# --- M4: the mechanics #519 left unchanged --------------------------------


def test_one_fresh_context_dispatch():
    assert re.search(r"one.*fresh-context subagent", section())


def test_inputs_exclude_the_authoring_conversation():
    assert re.search(r"never the authoring conversation", section(), re.I)


def test_reviewer_grades_net_concept_delta():
    assert re.search(r"Grade .netConceptDelta.", section())


def test_spec_carries_adopt_or_answer_for_every_finding():
    assert re.search(
        r".## Spec review. section.*adopt-or-answer.*every finding", section()
    )


def test_review_is_advisory_never_a_gate():
    assert re.search(r"advisory to the operator, never a .*gate", section())


def test_historical_specs_keep_the_old_section_name():
    assert re.search(r"Historical specs carry .## Trim review. sections", section())


# --- M5 + the global constraints ------------------------------------------


def test_skill_still_validates():
    proc = subprocess.run(
        [sys.executable, "skills/ultrapowers/scripts/validate_skill.py", "skills/ultralearn"],
        cwd=REPO,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert proc.stdout.strip() == "skill ok"


def test_shouted_imperative_counts_are_unchanged():
    text = brief_text()
    assert len(re.findall(r"\bMUST\b", text)) == 1
    assert re.findall(r"\bNEVER\b", text) == []
    assert re.findall(r"\bALWAYS\b", text) == []
    # the one MUST is line 5, outside the rewritten section
    assert "MUST" not in section_raw()

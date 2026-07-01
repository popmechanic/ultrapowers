"""Prose-contract: the ultraplan self-review checklist must carry the
"every test-asserted literal traces to prescribed content" check. A test that
asserts a string or behavior the same task never prescribes is a plan
contradiction (the test/content slip in ledger 37eaa67f) — resolve toward the
test as authority and fix the plan (#65)."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/ultraplan/SKILL.md"


def test_literal_trace_selfreview_present():
    low = SKILL.read_text().lower()
    assert "## self-review" in low, "ultraplan/SKILL.md lost its self-review section"
    # The check lives inside the self-review section, not merely somewhere in the file.
    body = low.split("## self-review", 1)[1]
    assert "test-asserted" in body, \
        "self-review missing the 'test-asserted literal' check"
    assert "literal" in body, \
        "self-review missing the 'literal' half of the check"
    assert "prescrib" in body, \
        "self-review does not tie the literal to content the task prescribes"

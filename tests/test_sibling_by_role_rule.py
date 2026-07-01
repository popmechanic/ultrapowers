"""Prose-contract: the "describe siblings by role, not by filename" rule must
live as a HARD WRITE-TIME authoring rule in BOTH ultraplan mirrors —
`references/plan-markers.md` (the source) and `ultraplan/SKILL.md` (the mirror)
— not only in the self-review checklist. Backticking a sibling task's filename
in a `Produces:`/`Consumes:` description injects a phantom serializing edge (the
compiler warns `description-inferred`), so the author should describe the
sibling by its ROLE instead ([108894a8435da7c7], #65)."""
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIRRORS = {
    "references/plan-markers.md": ROOT / "skills/ultrapowers/references/plan-markers.md",
    "ultraplan/SKILL.md": ROOT / "skills/ultraplan/SKILL.md",
}


@pytest.mark.parametrize("name,path", list(MIRRORS.items()))
def test_sibling_by_role_rule_present(name, path):
    text = path.read_text().lower()
    # The write-time rule: describe siblings by ROLE ...
    assert "by role" in text, \
        f"{name} missing the write-time 'describe siblings by role' rule"
    # ... NOT by filename ...
    assert "not by filename" in text, \
        f"{name} missing the 'not by filename' half of the by-role rule"
    # ... and it ties the rule to the description edge it prevents.
    assert "description" in text, \
        f"{name} does not tie the by-role rule to the description-inferred edge"

from pathlib import Path

DOC = Path(__file__).resolve().parents[1] / "skills/ultrapowers/references/design-rationale.md"

TOMBSTONE = (
    "Workflow-runtime rationale removed 2026-09-01 — that runtime was deleted "
    "at 0.3.0 (#434); see git history."
)


def test_workflow_era_rationale_is_gone():
    text = DOC.read_text().lower()
    for dead in ("ultracode", "harness", "saved workflow", ".claude/workflows"):
        assert dead not in text


def test_step_4_and_4a_headings_are_gone():
    headings = [ln for ln in DOC.read_text().splitlines() if ln.startswith("## ")]
    assert headings == [
        "## § Step 5 — Verdict independence from checkout position (#84)",
        "## § Dependency inference — the mixed-B-2 eval war story",
    ]


def test_tombstone_records_the_deletion_verbatim():
    lines = [ln.strip() for ln in DOC.read_text().splitlines()]
    assert lines.count(TOMBSTONE) == 1


def test_surviving_rationale_is_untouched():
    text = DOC.read_text()
    for kept in (
        "`git status --porcelain` MUST be empty.",
        "The report's `gitVerified` MUST be true",
        "**Schema-degrade crash guard ([cbf0d886651f723c]).**",
        "Eval run mixed-B-2 (2026-06-13)",
        '"merge-sha guard unavailable — result lacks waveMerges[last].headSha".',
    ):
        assert kept in text

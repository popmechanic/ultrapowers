"""The resolver brief is a load-bearing prompt artifact: the driver sends it
verbatim to a headless session. Pin the contract tokens the fold engine and
driver rely on (spec 2026-08-11 component 4)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BRIEF = ROOT / "evals/frontier/references/resolver-prompt.md"


def test_brief_exists_and_carries_the_contract_tokens():
    text = BRIEF.read_text()
    for token in (
        "resolvedFileLines",          # the output key, exactly
        "complete visible line list", # whole-file-out, no region output
        "planBodies",                 # input field names
        '"narration"',
        "only JSON",                  # no prose around the object
        "do not invent",              # no content beyond the two sides + context
    ):
        assert token in text, "brief missing contract token: %r" % token


def test_brief_forbids_tools_and_repo_access():
    text = BRIEF.read_text().lower()
    assert "no tools" in text and "no repo access" in text and "no shell" in text

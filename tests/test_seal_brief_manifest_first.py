"""Manifest-first sealing brief (seam consolidation): the manifest draft is
written before the RED proof and proven via --manifest, so the gate only
ever consumes fields the proof exercised; and exams pin behavior, never
implementation layout (spec-time seals guessed module surfaces in 2 field
runs and forced rework of correct code)."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROMPT = (ROOT / "skills/ultraplan/references/seal-author-prompt.md").read_text()


def test_brief_writes_the_manifest_draft_before_the_red_proof():
    assert "Write the manifest draft" in PROMPT
    assert "--manifest" in PROMPT


def test_brief_retires_the_flags_invocation():
    assert '--run "<runCmd>"' not in PROMPT, (
        "the flags invocation is the second channel — proving via flags and "
        "writing the manifest separately is how unproven fields reached the gate"
    )


def test_brief_names_framework_and_ranpattern():
    assert "framework" in PROMPT
    assert "ranPattern" in PROMPT
    assert "MANIFEST_INCOHERENT" in PROMPT


def test_brief_pins_behavior_not_layout():
    assert "never module layout" in PROMPT


def test_brief_prefers_value_pinning_over_symbol_pinning():
    assert "golden values" in PROMPT

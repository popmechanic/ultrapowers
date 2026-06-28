import pathlib

WAVES = pathlib.Path(__file__).resolve().parents[1] / "skills/ultrapowers/harnesses/waves.js"


def test_floor_is_override_proof_default_tier():
    src = WAVES.read_text()
    start = src.index("const reviewerModelFor")
    block = src[start:start + 300]
    # Built from DEFAULT_TIER (override-proof), not the override-able TIER.
    assert "DEFAULT_TIER.standard" in block
    assert "DEFAULT_TIER.mostCapable" in block
    # A bare TIER reference (not DEFAULT_TIER) would appear after a space or operator;
    # DEFAULT_TIER.standard contains "TIER.standard" as a substring so we check
    # for " TIER." (space-prefixed) which catches bare usage without false-matching
    # the DEFAULT_TIER prefix.
    assert " TIER.standard" not in block and " TIER.mostCapable" not in block


def test_per_task_review_uses_selector():
    src = WAVES.read_text()
    assert "model: reviewerModelFor(task)" in src


def test_completeness_critic_stays_opus():
    src = WAVES.read_text()
    # The integration/completeness dispatch must remain the opus REVIEWER_MODEL.
    idx = src.index("label: 'integration'")
    assert "model: REVIEWER_MODEL" in src[idx - 80:idx + 80]

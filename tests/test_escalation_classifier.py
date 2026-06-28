import pathlib

WAVES = pathlib.Path(__file__).resolve().parents[1] / "skills/ultrapowers/harnesses/waves.js"


def test_classifiers_present():
    src = WAVES.read_text()
    assert "const isSchemaTrip" in src
    assert "const looksStructural" in src
    assert "AGENT_NULL" in src


def test_retry_defaults_to_same_tier():
    src = WAVES.read_text()
    # Same-tier default: retryTier is task.tier unless a schema trip escalates it.
    assert "capabilityFixable ? escalateTier(task.tier) : (task.tier || 'standard')" in src


def test_structural_fault_diagnosed():
    src = WAVES.read_text()
    assert "missing Depends-on edge" in src

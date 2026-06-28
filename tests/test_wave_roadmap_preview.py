import pathlib

WAVES = pathlib.Path(__file__).resolve().parents[1] / "skills/ultrapowers/harnesses/waves.js"


def test_roadmap_preregistered_in_execution_order():
    src = WAVES.read_text()
    first_setup = src.index("phase('Setup')")
    loop = src.index("for (let w = 0; w < WAVES.length; w++) phase(waveLabel(w))")
    intreview = src.index("phase('Integration Review')")
    setup_agent = src.index("label: 'setup'")
    # Setup runs first, so it must be REGISTERED first — the engine lists phases
    # by first-registration order, so a Setup registered after the waves sorts to
    # the BOTTOM even though it executed first (#setup-at-bottom).
    assert first_setup < loop
    # The full roadmap is still pre-registered up front, before the setup agent
    # runs, so every wave + Integration Review show as pending from the start.
    assert loop < setup_agent
    assert intreview < setup_agent
    # Setup is re-activated right before its agent so setup progress groups under
    # the Setup box (re-activation is in-place, so its top position is kept).
    assert first_setup < src.index("phase('Setup')", first_setup + 1) < setup_agent

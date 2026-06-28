import pathlib

WAVES = pathlib.Path(__file__).resolve().parents[1] / "skills/ultrapowers/harnesses/waves.js"


def test_roadmap_preregistered_before_setup():
    src = WAVES.read_text()
    setup_idx = src.index("phase('Setup')")
    head = src[:setup_idx]
    # The pre-registration loop appears before the FIRST phase('Setup') call.
    assert "for (let w = 0; w < WAVES.length; w++) phase(waveLabel(w))" in head
    assert "phase('Integration Review')" in head

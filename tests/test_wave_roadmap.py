import pathlib

WAVES = pathlib.Path(__file__).resolve().parents[1] / "skills/ultrapowers/harnesses/waves.js"


def test_wave_label_helper_present():
    src = WAVES.read_text()
    assert "const waveLabel = (w) =>" in src
    assert "ARGS.waveLabels" in src


def test_loop_uses_wave_label():
    src = WAVES.read_text()
    assert "phase(waveLabel(w))" in src
    assert "phase('Wave ' + (w + 1))" not in src  # the bare label is gone


def test_meta_phases_use_wave_label():
    src = WAVES.read_text()
    assert "title: waveLabel(i)" in src

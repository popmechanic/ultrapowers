"""Capture script: pure-logic tests (no browser, no ffmpeg)."""
import importlib.util
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "docs/scripts/render_post_media.py"


def load():
    spec = importlib.util.spec_from_file_location("rpm", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_frame_times_cover_duration_and_hold():
    mod = load()
    times = mod.frame_times(1000, fps=30, hold_s=2.0)
    assert times[0] == 0
    assert max(times) == 1000
    assert all(b >= a for a, b in zip(times, times[1:])), "not monotonic"
    assert times.count(1000.0) >= 60, "expected >=2s of hold frames at 30fps"


def test_gif_cmd_is_palette_optimized_loop():
    mod = load()
    cmd = mod.gif_cmd(pathlib.Path("/tmp/frames"), 30, pathlib.Path("/tmp/o.gif"))
    joined = " ".join(cmd)
    assert cmd[0] == "ffmpeg"
    assert "palettegen" in joined and "paletteuse" in joined
    assert "-loop" in cmd and cmd[cmd.index("-loop") + 1] == "0"


def test_mp4_cmd_is_x_compatible():
    mod = load()
    cmd = mod.mp4_cmd(pathlib.Path("/tmp/frames"), 30, pathlib.Path("/tmp/o.mp4"))
    joined = " ".join(cmd)
    assert "yuv420p" in joined and "+faststart" in joined and "libx264" in joined


def test_default_figs_match_post_contract():
    mod = load()
    assert mod.FIGS == ["fig-anatomy", "fig-race"]

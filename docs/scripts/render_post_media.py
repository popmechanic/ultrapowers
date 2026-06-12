#!/usr/bin/env python3
"""Render the post's animated figures to looping GIF + MP4 for cross-posting.

The post, loaded with ?capture, exposes window.__seek(figId, tMs) and
window.__figDuration(figId) and disables autoplay; this script steps each
figure's deterministic timeline frame by frame — no screen recording.

Requires: pip install playwright && playwright install chromium; ffmpeg on PATH.

Usage:
  python3 docs/scripts/render_post_media.py            # both figures
  python3 docs/scripts/render_post_media.py --fig fig-race --fps 30 --scale 2
"""
import argparse
import pathlib
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
POST = ROOT / "docs" / "superpowers-ultrapowers-evals.html"
OUT = ROOT / "docs" / "media"
FIGS = ["fig-anatomy", "fig-race"]


def frame_times(duration_ms, fps=30, hold_s=2.0):
    """Timestamps 0..duration at fps, then hold_s of completed-state frames."""
    step = 1000.0 / fps
    times = []
    t = 0.0
    while t < duration_ms:
        times.append(t)
        t += step
    times.append(float(duration_ms))
    times.extend([float(duration_ms)] * int(round(hold_s * fps)))
    return times


def gif_cmd(frames_dir, fps, out_path):
    return [
        "ffmpeg", "-y", "-framerate", str(fps),
        "-i", str(frames_dir / "%05d.png"),
        "-vf", "split[a][b];[a]palettegen=stats_mode=diff[p];"
               "[b][p]paletteuse=dither=bayer:bayer_scale=4",
        "-loop", "0", str(out_path),
    ]


def mp4_cmd(frames_dir, fps, out_path):
    return [
        "ffmpeg", "-y", "-framerate", str(fps),
        "-i", str(frames_dir / "%05d.png"),
        "-vf", "crop=trunc(iw/2)*2:trunc(ih/2)*2",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
        "-movflags", "+faststart", str(out_path),
    ]


def capture(figs, fps, scale):
    from playwright.sync_api import sync_playwright
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 760, "height": 1200},
                                device_scale_factor=scale)
        page.goto(POST.resolve().as_uri() + "?capture")
        page.wait_for_function("typeof window.__seek === 'function'")
        for fig in figs:
            duration = page.evaluate("window.__figDuration(%r)" % fig)
            el = page.locator("#" + fig)
            el.scroll_into_view_if_needed()
            with tempfile.TemporaryDirectory() as td:
                frames = pathlib.Path(td)
                for i, t in enumerate(frame_times(duration, fps)):
                    page.evaluate("window.__seek(%r, %f)" % (fig, t))
                    el.screenshot(path=str(frames / ("%05d.png" % i)))
                subprocess.run(gif_cmd(frames, fps, OUT / (fig + ".gif")),
                               check=True, capture_output=True)
                subprocess.run(mp4_cmd(frames, fps, OUT / (fig + ".mp4")),
                               check=True, capture_output=True)
            print("wrote", OUT / (fig + ".gif"), "and", OUT / (fig + ".mp4"))
        browser.close()


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fig", nargs="*", default=FIGS,
                    help="figure element ids to render (default: all)")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--scale", type=int, default=2,
                    help="device scale factor (2 = retina-sharp text)")
    args = ap.parse_args()
    capture(args.fig, args.fps, args.scale)


if __name__ == "__main__":
    main()

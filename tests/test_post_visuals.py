"""Blog-post visuals: seekable viz engine + unified agent-grammar figures.

Static/structural tests in the style of test_viewer.py: string assertions
on the HTML plus node --check on every embedded <script> block.
"""
import pathlib
import re
import shutil
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
POST = ROOT / "docs/superpowers-ultrapowers-evals.html"


def html():
    return POST.read_text()


def scripts():
    return re.findall(r"<script>(.*?)</script>", html(), re.S)


def test_engine_present():
    h = html()
    assert "function Figure(" in h
    assert "__vizRegister" in h
    assert "getPointAtLength" in h
    assert "stroke-dashoffset" in h


def test_capture_hook_gated_on_query():
    h = html()
    assert "window.__seek" in h
    assert "window.__figDuration" in h
    assert re.search(r"capture", h), "capture query flag missing"


def test_capture_mode_disables_autoplay():
    # in capture mode figures must render(0) and never observe/play
    h = html()
    assert "CAPTURE" in h
    assert "IntersectionObserver" in h


def test_reduced_motion_renders_final_state():
    assert "prefers-reduced-motion" in html()


def test_viz_css_classes_defined():
    h = html()
    for cls in [".vlbl", ".vnum", ".vclk", ".viz svg"]:
        assert cls in h, f"missing CSS for {cls}"


def test_all_scripts_parse():
    node = shutil.which("node")
    if not node:
        import pytest
        pytest.skip("node not available")
    for i, js in enumerate(scripts()):
        f = POST.parent / f".tmp-script-{i}.js"
        f.write_text(js)
        try:
            subprocess.run([node, "--check", str(f)], check=True,
                           capture_output=True, text=True)
        finally:
            f.unlink()


def test_anatomy_figure_present():
    h = html()
    assert 'id="fig-anatomy"' in h
    for label in ["worktrees — one isolated copy each", "one agent per task",
                  "independent review", "merge agent · Haiku", "your gate",
                  "integration branch", "Sonnet", "Opus"]:
        assert label in h, f"anatomy label missing: {label}"


def test_anatomy_has_human_gate_square():
    # the single square in the grammar is the human gate
    assert 'id="an-gate"' in html()


def test_script_ids_exist_in_markup():
    h = html()
    ids = set()
    for js in scripts():
        ids |= set(re.findall(r'"((?:an|rc)-[a-z0-9]+)"', js))
    for tok in sorted(ids):
        assert f'id="{tok}"' in h, f"script references missing element id {tok}"


def test_race_figure_uses_real_run_data():
    h = html()
    assert 'id="fig-race"' in h
    assert "mixed-A-1" in h and "mixed-B-1" in h, "figcaption must cite run ids"
    # node x for the 42.6-min serial task-6 completion: 40 + 42.6*600/46.4
    assert 'cx="590.9"' in h
    # waves final merge at 16.9 min: 40 + 16.9*600/46.4
    assert 'cx="258.6"' in h


def test_race_figcaption_maps_task_names():
    h = html()
    for name in ["user schema", "payload validation", "serialization",
                 "in-memory store", "handlers", "router"]:
        assert name in h, f"task-name mapping missing: {name}"


def test_old_gantt_race_removed():
    h = html()
    assert 'class="track serial"' not in h
    assert "@keyframes grow" not in h
    assert 'id="replayBtn"' not in h


def test_thumbnails_use_unified_grammar():
    h = html()
    assert h.count('class="mini"') == 4, "expected four grammar miniatures"
    assert 'stroke-dasharray="3 3"' in h, "degrade ghost fan missing"
    assert ".dag circle" not in h and ".dag path" not in h, "old .dag CSS lingers"

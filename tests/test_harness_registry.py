"""The harness library contract: every manifest names a real harness file whose
meta.name matches, with existing fixtures and (optional) drift test. No
execution — meta.name is read by regex, like the drift test does."""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
HARNESSES = ROOT / "skills/ultrapowers/harnesses"
WAVES = HARNESSES / "waves.js"


def manifests():
    return sorted(HARNESSES.glob("*.harness.json"))


def meta_name(js_path):
    text = js_path.read_text()
    m = re.search(r"meta\s*=\s*\{.*?name:\s*'([^']+)'", text, re.S)
    return m.group(1) if m else None


def test_the_engine_harness_is_ultrapowers_run():
    """Read from waves.js's meta.name directly — the manifest reader died with
    the registry probe (One Driver Phase 0, row 5); the harness file is the
    authority. `ultrapowers-run` alone: the probe harness is gone."""
    assert meta_name(WAVES) == "ultrapowers-run"
    assert sorted(p.name for p in HARNESSES.glob("*.js")) == ["waves.js"]


def test_no_writeside_harness_shadows_the_ultrapowers_command():
    """Regression guard for the /ultrapowers command collision
    (docs/bugs/2026-06-15-ultrapowers-command-collision.md): the engine
    auto-registers a saved workflow as a /<meta.name> slash command. A
    write-side harness named 'ultrapowers' would shadow the
    ultrapowers:ultrapowers SKILL (the documented /ultrapowers entry point) and
    feed a bare plan path straight into the engine. Forbid that name — for both
    the manifest and the harness's own meta.name."""
    assert meta_name(WAVES) != "ultrapowers"
    for m in manifests():
        spec = json.loads(m.read_text())
        if spec.get("writeSide") is not True:
            continue
        assert spec["name"] != "ultrapowers", (
            f"{m.name}: write-side harness named 'ultrapowers' shadows the "
            "/ultrapowers skill command — rename it (e.g. 'ultrapowers-run')")
        js = HARNESSES / spec["file"]
        assert meta_name(js) != "ultrapowers", (
            f"{spec['file']}: meta.name 'ultrapowers' shadows the /ultrapowers "
            "skill command — rename it (e.g. 'ultrapowers-run')")


def test_every_manifest_points_to_a_matching_harness():
    for m in manifests():
        spec = json.loads(m.read_text())
        for key in ("name", "file", "purpose", "writeSide", "version", "fixtures", "driftTest"):
            assert key in spec, f"{m.name}: missing key {key}"
        js = HARNESSES / spec["file"]
        assert js.exists(), f"{m.name}: harness file {spec['file']} missing"
        assert meta_name(js) == spec["name"], f"{m.name}: meta.name != manifest name"
        assert (ROOT / spec["fixtures"]).exists(), f"{m.name}: fixtures path missing"
        if spec["driftTest"] is not None:
            assert (ROOT / spec["driftTest"]).exists(), f"{m.name}: driftTest path missing"

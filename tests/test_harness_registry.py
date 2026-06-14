"""The harness library contract: every manifest names a real harness file whose
meta.name matches, with existing fixtures and (optional) drift test. Candidates
are not registered. No execution — meta.name is read by regex, like the drift
test does."""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
HARNESSES = ROOT / "skills/ultrapowers/harnesses"


def manifests():
    return sorted(HARNESSES.glob("*.harness.json"))


def meta_name(js_path):
    text = js_path.read_text()
    m = re.search(r"meta\s*=\s*\{.*?name:\s*'([^']+)'", text, re.S)
    return m.group(1) if m else None


def test_at_least_the_two_core_harnesses_registered():
    names = {json.loads(m.read_text())["name"] for m in manifests()}
    assert {"ultrapowers", "ultrapowers-probe"} <= names


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


def test_candidates_are_not_registered():
    cand = HARNESSES / "candidates"
    assert cand.is_dir(), "candidates/ directory must exist (ratchet staging)"
    assert not list(cand.glob("*.harness.json")), "candidates must not carry registered manifests"

import json
import os
import tempfile

os.environ["ULTRAPOWERS_HOME"] = tempfile.mkdtemp(prefix="ultrapowers-home-")

BRIDGE = "test_fleet_suite.py"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEMES = os.path.join(ROOT, "skills/ultrawrite/themes")


def contract():
    with open(os.path.join(THEMES, "contract.json")) as f:
        return json.load(f)


def skipped(s):
    return s.get("hidden") or s.get("optional")


def synthetic(tmp_path, name="synth", drop_slot=None, drop_state=None, drop_bare=None, extra=""):
    rules = [f"@layer ui-sdk, structure, {name};", f"@layer {name} {{"]
    for c in contract()["components"]:
        for s in c["slots"]:
            if s["slot"] == drop_slot or skipped(s):
                continue
            sel = f'[data-slot="{s["slot"]}"]'
            if s["slot"] != drop_bare:
                rules.append(sel + "{display:block}")
            rules += [sel + st["state"] + "{opacity:.5}" for st in s["states"] if (s["slot"], st["state"]) != drop_state]
    rules.append("}" + extra)
    d = tmp_path / name
    d.mkdir()
    (d / "theme.css").write_text("\n".join(rules))
    (d / "README.md").write_text("x")
    (d / "LICENSE").write_text("x")
    return str(d)


def pytest_collection_modifyitems(session, config, items):
    bridge = [item for item in items if item.fspath.basename == BRIDGE]
    if bridge:
        items[:] = bridge + [item for item in items
                             if item.fspath.basename != BRIDGE]

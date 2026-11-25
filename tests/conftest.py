import json
import os
import shutil
import tempfile

import pytest

os.environ["ULTRAPOWERS_HOME"] = tempfile.mkdtemp(prefix="ultrapowers-home-")

BRIDGE = "test_fleet_suite.py"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEMES = os.path.join(ROOT, "skills/ultrawrite/themes")
POLICY = os.path.join(ROOT, "skills/ultrawrite/stories/policy.json")

needs_install = pytest.mark.skipif(
    not os.path.isdir(os.path.join(THEMES, "node_modules", "@ui-sdk", "react")),
    reason="run bun install in skills/ultrawrite/themes")


def tool_copy(tmp_path, link_modules=True):
    plugin = tmp_path / "plugin"
    dest = plugin / "skills/ultrawrite/themes"
    dest.mkdir(parents=True)
    for f in os.listdir(THEMES):
        src = os.path.join(THEMES, f)
        if os.path.isfile(src):
            shutil.copy(src, dest / f)
    shutil.copytree(os.path.join(THEMES, "pouf"), dest / "pouf")
    (plugin / "skills/ultrawrite/stories").mkdir()
    shutil.copy(POLICY, plugin / "skills/ultrawrite/stories/policy.json")
    (plugin / ".claude-plugin").mkdir()
    shutil.copy(os.path.join(ROOT, ".claude-plugin/plugin.json"), plugin / ".claude-plugin/plugin.json")
    if link_modules:
        os.symlink(os.path.join(THEMES, "node_modules"), dest / "node_modules")
    return dest


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

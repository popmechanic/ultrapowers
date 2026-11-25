import json
import os
import shutil
import subprocess

import pytest

pytestmark = pytest.mark.skipif(shutil.which("bun") is None, reason="bun is not installed")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEMES = os.path.join(ROOT, "skills/ultrawrite/themes")
LIB = os.path.join(THEMES, "lib.ts")

NAMES = ["Button", "Field", "Input", "Textarea", "Number Input", "Select", "Dialog",
         "Alert Dialog", "Checkbox", "Switch", "Segmented Control", "Radio", "Tabs", "Menu",
         "Popover", "Tooltip", "Toast", "Combobox", "Meter", "Progress", "Separator"]


def read(path):
    with open(path) as f:
        return json.load(f)


def contract():
    return read(os.path.join(THEMES, "contract.json"))


def policy():
    return read(os.path.join(ROOT, "skills/ultrawrite/stories/policy.json"))


def package():
    return read(os.path.join(THEMES, "package.json"))


def bun_eval(expr):
    r = subprocess.run(["bun", "-e", f"import {{resolveTheme}} from '{LIB}'; {expr}"],
                       capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_the_contract_names_the_core_set():
    assert [c["name"] for c in contract()["components"]] == NAMES


def test_every_state_says_its_kind_and_every_slot_where_it_renders():
    for c in contract()["components"]:
        assert c["slots"], c["name"]
        for s in c["slots"]:
            assert s["in"] in ("markup", "live"), s["slot"]
            for st in s["states"]:
                assert st["kind"] in ("markup", "css"), (s["slot"], st)


def test_the_contract_states_the_layer_order_and_four_facts():
    assert contract()["layers"] == ["ui-sdk", "structure"]
    assert len(contract()["facts"]) == 4


def test_the_pin_is_written_once():
    cell = policy()["ui"]
    assert cell["sdk"] == "0.1.0-beta.17" and cell["theme"] == "pouf"
    assert cell["experiment"] is True and cell["n"] == 1 and cell["window"] and cell["rollback"]
    deps = package()["dependencies"]
    assert deps["@ui-sdk/react"] == deps["@ui-sdk/core"] == contract()["sdk"] == cell["sdk"]
    assert deps["react"] == deps["react-dom"] == "19.1.0"


def test_resolve_theme_strips_a_trailing_slash(tmp_path):
    d = tmp_path / "mine"
    d.mkdir()
    assert bun_eval(f"console.log(JSON.stringify(resolveTheme('{d}/')))") == {"name": "mine", "dir": str(d)}

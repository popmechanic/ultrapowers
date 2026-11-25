import json
import os
import shutil
import subprocess

import pytest

pytestmark = pytest.mark.skipif(shutil.which("bun") is None, reason="bun is not installed")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEMES = os.path.join(ROOT, "skills/ultrawrite/themes")
SAMPLE = os.path.join(THEMES, "sample.ts")
STRUCTURE = os.path.join(THEMES, "structure.css")


def contract():
    with open(os.path.join(THEMES, "contract.json")) as f:
        return json.load(f)


def run_sample(*args):
    r = subprocess.run(["bun", SAMPLE, *args], capture_output=True, text=True, timeout=120)
    return r.returncode, r.stdout, r.stderr


def test_the_sample_renders_every_markup_slot_the_contract_lists():
    rendered = set(json.loads(run_sample("--slots")[1]))
    listed = {s["slot"] for c in contract()["components"] for s in c["slots"] if s["in"] == "markup"}
    assert listed - rendered == set()


def test_the_sample_renders_no_slot_the_contract_omits():
    rendered = set(json.loads(run_sample("--slots")[1]))
    known = {s["slot"] for c in contract()["components"] for s in c["slots"]}
    assert rendered - known == set()


def test_the_structure_sheet_declares_its_layers_first():
    assert open(STRUCTURE).read().lstrip().startswith("@layer ui-sdk, structure;")


CHECK = os.path.join(THEMES, "check.ts")


def check(*args, tool=CHECK):
    r = subprocess.run(["bun", tool, *args], capture_output=True, text=True, timeout=120)
    return r.returncode, r.stdout


def skipped(s):
    return s.get("hidden") or s.get("optional")


def synthetic(tmp_path, name="synth", drop_slot=None, drop_state=None, extra=""):
    rules = [f"@layer ui-sdk, structure, {name};", f"@layer {name} {{"]
    for c in contract()["components"]:
        for s in c["slots"]:
            if s["slot"] == drop_slot or skipped(s):
                continue
            sel = f'[data-slot="{s["slot"]}"]'
            rules.append(sel + "{display:block}")
            rules += [sel + st["state"] + "{opacity:.5}" for st in s["states"] if (s["slot"], st["state"]) != drop_state]
    rules.append("}" + extra)
    d = tmp_path / name
    d.mkdir()
    (d / "theme.css").write_text("\n".join(rules))
    (d / "README.md").write_text("x")
    (d / "LICENSE").write_text("x")
    return str(d)


def tool_copy(tmp_path, link_modules=True):
    dest = tmp_path / "tool"
    dest.mkdir()
    for f in os.listdir(THEMES):
        src = os.path.join(THEMES, f)
        if os.path.isfile(src):
            shutil.copy(src, dest / f)
    if link_modules:
        os.symlink(os.path.join(THEMES, "node_modules"), dest / "node_modules")
    return dest


def test_a_complete_theme_passes(tmp_path):
    code, out = check(synthetic(tmp_path))
    assert code == 0 and out.startswith("THEME OK: synth")


def test_hidden_and_optional_slots_need_no_rule(tmp_path):
    slots = [s for c in contract()["components"] for s in c["slots"]]
    hidden = next(s["slot"] for s in slots if s.get("hidden"))
    optional = next(s["slot"] for s in slots if s.get("optional"))
    d = synthetic(tmp_path)
    css = open(os.path.join(d, "theme.css")).read()
    assert f'"{hidden}"' not in css and f'"{optional}"' not in css
    assert check(d)[0] == 0


def test_a_missing_slot_is_named(tmp_path):
    code, out = check(synthetic(tmp_path, drop_slot="select-content"))
    assert code == 1 and 'theme: no rule styles [data-slot="select-content"]' in out.splitlines()


def test_a_missing_state_is_named(tmp_path):
    code, out = check(synthetic(tmp_path, drop_state=("button", ":hover")))
    assert code == 1 and out.splitlines() == ['theme: no rule styles [data-slot="button"]:hover']


def test_is_groups_count_for_every_slot_in_them(tmp_path):
    d = synthetic(tmp_path, drop_state=("button", ":hover"),
                  extra='@layer synth{:is([data-slot="button"],[data-slot="dialog-close"]):hover{opacity:.9}}')
    assert check(d)[0] == 0


def test_a_nested_rule_counts(tmp_path):
    d = synthetic(tmp_path, drop_state=("button", ":hover"),
                  extra='@layer synth{[data-slot="button"]{&:hover{opacity:.9}}}')
    assert check(d)[0] == 0


def test_a_pressed_attribute_satisfies_active(tmp_path):
    d = synthetic(tmp_path, drop_state=("button", ":active"),
                  extra='@layer synth{[data-slot="button"][data-pressed]{opacity:.9}}')
    assert check(d)[0] == 0


def test_an_ancestor_or_has_does_not_count(tmp_path):
    d = synthetic(tmp_path, drop_slot="switch-thumb",
                  extra='@layer synth{[data-slot="switch-thumb"] span{top:0} div:has([data-slot="switch-thumb"]){top:0}}')
    assert check(d)[0] == 1


def test_a_wrong_layer_line_a_relative_url_and_missing_docs_are_findings(tmp_path):
    a = synthetic(tmp_path, name="a")
    css = open(os.path.join(a, "theme.css")).read()
    open(os.path.join(a, "theme.css"), "w").write(css.replace("@layer ui-sdk, structure, a;", "@layer a;", 1))
    assert check(a) == (1, 'theme: theme.css must begin "@layer ui-sdk, structure, a;"\n')
    b = synthetic(tmp_path, name="b", extra="a{background:url(x.png)}")
    assert check(b) == (1, "theme: theme.css loads x.png, which is not a data URL\n")
    c = synthetic(tmp_path, name="c")
    os.remove(os.path.join(c, "README.md"))
    os.remove(os.path.join(c, "LICENSE"))
    assert check(c) == (1, "theme: README.md is missing\ntheme: LICENSE is missing\n")
    d = synthetic(tmp_path, name="d")
    open(os.path.join(d, "font.css"), "w").write('@font-face{font-family:X;src:url("data:font/woff2;base64,AAAA")}')
    assert check(d)[0] == 0
    e = synthetic(tmp_path, name="e")
    open(os.path.join(e, "font.css"), "w").write('@import "y.css";')
    assert check(e) == (1, "theme: font.css loads y.css, which is not a data URL\n")


def test_a_missing_theme_css_is_named(tmp_path):
    d = synthetic(tmp_path)
    os.remove(os.path.join(d, "theme.css"))
    assert check(d) == (1, "theme: theme.css is missing\n")


def test_a_trailing_slash_names_the_same_theme(tmp_path):
    assert check(synthetic(tmp_path) + "/")[1].startswith("THEME OK: synth")


def test_structure_passes_and_a_colour_in_it_fails(tmp_path):
    assert check("--structure") == (0, "STRUCTURE OK\n")
    tool = tool_copy(tmp_path)
    with open(tool / "structure.css", "a") as f:
        f.write("\na{color:red}\n")
    assert check("--structure", tool=str(tool / "check.ts")) == (1, "structure: color sets a look\n")


def test_a_slot_the_contract_does_not_list_is_named(tmp_path):
    theme = synthetic(tmp_path)
    tool = tool_copy(tmp_path)
    c = contract()
    for comp in c["components"]:
        comp["slots"] = [s for s in comp["slots"] if s["slot"] != "meter-label"]
    (tool / "contract.json").write_text(json.dumps(c))
    code, out = check(theme, tool=str(tool / "check.ts"))
    assert code == 1 and out.splitlines() == [
        'contract: the sample renders [data-slot="meter-label"], which the contract does not list']


def test_slots_from_a_walk_lists_the_unstyled_ones(tmp_path):
    walk = tmp_path / "w.walk.json"
    walk.write_text(json.dumps({"slots": ["button", "accordion-item", "select-form-input"]}))
    code, out = check(synthetic(tmp_path), "--slots", str(walk))
    assert code == 0 and out.splitlines() == ['walk: [data-slot="accordion-item"] is on the page and no rule in the theme styles it']


def test_without_node_modules_it_says_how_to_fix_it(tmp_path):
    theme = synthetic(tmp_path)
    tool = tool_copy(tmp_path, link_modules=False)
    code, out = check(theme, tool=str(tool / "check.ts"))
    assert code == 2 and out.strip() == "could not run: run bun install in skills/ultrawrite/themes"

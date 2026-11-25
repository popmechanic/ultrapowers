import json
import os
import shutil
import subprocess

import pytest

from conftest import ROOT, THEMES, contract, needs_install, synthetic, tool_copy

pytestmark = pytest.mark.skipif(shutil.which("bun") is None, reason="bun is not installed")
SAMPLE = os.path.join(THEMES, "sample.ts")
STRUCTURE = os.path.join(THEMES, "structure.css")


def run_sample(*args):
    r = subprocess.run(["bun", SAMPLE, *args], capture_output=True, text=True, timeout=120)
    return r.returncode, r.stdout, r.stderr


@needs_install
def test_the_sample_renders_every_markup_slot_the_contract_lists():
    rendered = set(json.loads(run_sample("--slots")[1]))
    listed = {s["slot"] for c in contract()["components"] for s in c["slots"] if s["in"] == "markup"}
    assert listed - rendered == set()


@needs_install
def test_the_sample_renders_no_slot_the_contract_omits():
    rendered = set(json.loads(run_sample("--slots")[1]))
    known = {s["slot"] for c in contract()["components"] for s in c["slots"]}
    assert rendered - known == set()


def test_the_structure_sheet_declares_its_layers_first():
    assert open(STRUCTURE).read().lstrip().startswith("@layer ui-sdk, structure;")


CHECK = os.path.join(THEMES, "check.ts")


def check(*args, tool=CHECK, cwd=None):
    r = subprocess.run(["bun", tool, *args], capture_output=True, text=True, timeout=120, cwd=cwd)
    return r.returncode, r.stdout


@needs_install
def test_a_complete_theme_passes(tmp_path):
    code, out = check(synthetic(tmp_path))
    assert code == 0 and out.startswith("THEME OK: synth")


@needs_install
def test_hidden_and_optional_slots_need_no_rule(tmp_path):
    slots = [s for c in contract()["components"] for s in c["slots"]]
    hidden = next(s["slot"] for s in slots if s.get("hidden"))
    optional = next(s["slot"] for s in slots if s.get("optional"))
    d = synthetic(tmp_path)
    css = open(os.path.join(d, "theme.css")).read()
    assert f'"{hidden}"' not in css and f'"{optional}"' not in css
    assert check(d)[0] == 0


@needs_install
def test_a_missing_slot_is_named(tmp_path):
    code, out = check(synthetic(tmp_path, drop_slot="select-content"))
    assert code == 1 and 'theme: no rule styles [data-slot="select-content"]' in out.splitlines()


@needs_install
def test_a_missing_state_is_named(tmp_path):
    code, out = check(synthetic(tmp_path, drop_state=("button", ":hover")))
    assert code == 1 and out.splitlines() == ['theme: no rule styles [data-slot="button"]:hover']


@needs_install
def test_is_groups_count_for_every_slot_in_them(tmp_path):
    d = synthetic(tmp_path, drop_state=("button", ":hover"),
                  extra='@layer synth{:is([data-slot="button"],[data-slot="dialog-close"]):hover{opacity:.9}}')
    assert check(d)[0] == 0


@needs_install
def test_a_nested_rule_counts(tmp_path):
    d = synthetic(tmp_path, drop_state=("button", ":hover"),
                  extra='@layer synth{[data-slot="button"]{&:hover{opacity:.9}}}')
    assert check(d)[0] == 0


@needs_install
def test_a_pressed_attribute_satisfies_active(tmp_path):
    d = synthetic(tmp_path, drop_state=("button", ":active"),
                  extra='@layer synth{[data-slot="button"][data-pressed]{opacity:.9}}')
    assert check(d)[0] == 0


@needs_install
def test_an_ancestor_or_has_does_not_count(tmp_path):
    d = synthetic(tmp_path, drop_slot="switch-thumb",
                  extra='@layer synth{[data-slot="switch-thumb"] span{top:0} div:has([data-slot="switch-thumb"]){top:0}}')
    code, out = check(d)
    assert code == 1 and 'theme: no rule styles [data-slot="switch-thumb"]' in out.splitlines()


@needs_install
def test_a_slot_styled_only_through_a_state_rule_is_styled(tmp_path):
    code, out = check(synthetic(tmp_path, drop_bare="button"))
    assert code == 0 and out.startswith("THEME OK: synth")


@needs_install
@pytest.mark.parametrize("rules", [
    '[data-slot="meter-track"]{inset-inline-start:0}',
    '[data-slot="meter-track"]{border-start-start-radius:4px}',
])
def test_a_logical_property_is_still_a_rule_for_its_slot(tmp_path, rules):
    d = synthetic(tmp_path, drop_slot="meter-track", extra="@layer synth{" + rules + "}")
    assert check(d)[0] == 0


@needs_install
def test_a_logical_property_on_a_state_rule_keeps_the_state(tmp_path):
    d = synthetic(tmp_path, drop_slot="tabs-panel",
                  extra='@layer synth{[data-slot="tabs-panel"]:focus-visible{border-start-start-radius:2px;inset-inline-end:0}}')
    assert check(d)[0] == 0


@needs_install
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
    f = synthetic(tmp_path, name="f", extra='a{background-image:image-set("x.png" 1x, "data:image/png;base64,AA" 2x)}')
    assert check(f) == (1, "theme: theme.css loads x.png, which is not a data URL\n")


@needs_install
def test_a_missing_theme_css_is_named(tmp_path):
    d = synthetic(tmp_path)
    os.remove(os.path.join(d, "theme.css"))
    assert check(d) == (1, "theme: theme.css is missing\n")


@needs_install
def test_a_trailing_slash_names_the_same_theme(tmp_path):
    assert check(synthetic(tmp_path) + "/")[1].startswith("THEME OK: synth")


def test_structure_passes_and_a_colour_in_it_fails(tmp_path):
    assert check("--structure") == (0, "STRUCTURE OK\n")
    tool = tool_copy(tmp_path)
    with open(tool / "structure.css", "a") as f:
        f.write("\na{color:red}\n")
    assert check("--structure", tool=str(tool / "check.ts")) == (1, "structure: color sets a look\n")


@pytest.mark.parametrize("rule,line", [
    ("a{border:1px solid red}", "structure: border sets a look"),
    ("a{border-width:1px;border-style:solid;border-color:red}", "structure: border-color sets a look"),
    ("a{outline:2px solid #00f}", "structure: outline sets a look"),
    ("a{text-decoration:underline currentColor}", "structure: text-decoration sets a look"),
    ("a{caret-color:blue}", "structure: caret-color sets a look"),
    ("a{filter:drop-shadow(0 0 2px)}", "structure: filter sets a look"),
    ("a{background:transparent}", "structure: background sets a look"),
    ("a{b{top:0}}", "structure: a nests a rule"),
])
def test_structure_fails_on_each_look(tmp_path, rule, line):
    tool = tool_copy(tmp_path)
    with open(tool / "structure.css", "a") as f:
        f.write("\n" + rule + "\n")
    assert check("--structure", tool=str(tool / "check.ts")) == (1, line + "\n")


@needs_install
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


@needs_install
def test_slots_from_a_walk_lists_the_unstyled_ones(tmp_path):
    walk = tmp_path / "w.walk.json"
    walk.write_text(json.dumps({"slots": ["button", "accordion-item", "select-form-input"]}))
    code, out = check(synthetic(tmp_path), "--slots", str(walk))
    assert code == 0 and out.splitlines() == ['walk: [data-slot="accordion-item"] is on the page and no rule in the theme styles it']


def test_without_node_modules_it_says_how_to_fix_it(tmp_path):
    theme = synthetic(tmp_path)
    tool = tool_copy(tmp_path, link_modules=False)
    code, out = check(theme, tool=str(tool / "check.ts"))
    assert code == 2 and out.strip() == f"could not run: run bun install in {os.path.realpath(tool)}"


def partial_install(tool):
    (tool / "node_modules").mkdir()
    os.symlink(os.path.join(THEMES, "node_modules", "@ui-sdk"), tool / "node_modules" / "@ui-sdk")


@needs_install
@pytest.mark.parametrize("tool_name,args", [
    ("check.ts", ["THEME"]),
    ("sample.ts", ["--slots"]),
    ("place.ts", ["--theme", "pouf", "--app", "APP"]),
])
def test_a_partial_install_says_how_to_fix_it(tmp_path, tool_name, args):
    theme = synthetic(tmp_path)
    tool = tool_copy(tmp_path, link_modules=False)
    partial_install(tool)
    args = [theme if a == "THEME" else str(tmp_path) if a == "APP" else a for a in args]
    r = subprocess.run(["bun", str(tool / tool_name), *args], capture_output=True, text=True, timeout=120)
    assert (r.returncode, r.stdout.strip(), r.stderr) == (2, f"could not run: run bun install in {os.path.realpath(tool)}", "")


@needs_install
def test_an_installed_version_off_the_pin_says_both(tmp_path):
    theme = synthetic(tmp_path)
    tool = tool_copy(tmp_path)
    policy = tool.parent / "stories/policy.json"
    cell = json.loads(policy.read_text())
    cell["ui"]["sdk"] = "0.0.1"
    policy.write_text(json.dumps(cell))
    code, out = check(theme, tool=str(tool / "check.ts"))
    installed = contract()["sdk"]
    assert code == 2 and out.strip() == (
        f"could not run: @ui-sdk/react {installed} is installed in {os.path.realpath(tool)} and the ui cell pins 0.0.1")


@needs_install
def test_a_bundled_name_with_a_trailing_slash_is_found_from_the_repo_root():
    code, out = check("pouf/", cwd=ROOT)
    assert code == 0 and out.startswith("THEME OK: pouf")


@needs_install
@pytest.mark.parametrize("name", ["ui-sdk", "structure", "9lives", "my.theme"])
def test_a_folder_name_that_cannot_be_a_layer_is_a_finding(tmp_path, name):
    d = synthetic(tmp_path, name="ok")
    bad = tmp_path / name
    os.rename(d, bad)
    code, out = check(str(bad))
    assert code == 1 and out.splitlines() == [f"theme: the folder name {name} cannot be a layer name"]


@needs_install
def test_a_layer_line_after_a_comment_is_named_as_such(tmp_path):
    d = synthetic(tmp_path, name="a")
    css = open(os.path.join(d, "theme.css")).read()
    open(os.path.join(d, "theme.css"), "w").write("/* Theme a */\n" + css)
    assert check(d) == (1, 'theme: theme.css must begin "@layer ui-sdk, structure, a;", before any comment\n')


POUF = os.path.join(THEMES, "pouf")


@needs_install
def test_pouf_passes_the_check():
    code, out = check(POUF)
    assert code == 0, out

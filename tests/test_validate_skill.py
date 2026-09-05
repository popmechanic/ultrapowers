import subprocess, sys, pathlib, textwrap
ROOT = pathlib.Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "skills/ultrapowers/scripts/validate_skill.py"

def run(skill_dir):
    p = subprocess.run([sys.executable, str(VALIDATOR), str(skill_dir)],
                       capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr

def test_good_skill_passes():
    code, out = run(ROOT / "tests/fixtures/good-skill")
    assert code == 0, out

def test_ultrapowers_skill_validates():
    code, out = run(ROOT / "skills/ultrapowers")
    assert code == 0, out

def test_ultrawrite_skill_validates():
    code, out = run(ROOT / "skills/ultrawrite")
    assert code == 0, out


def test_ci_validates_every_shipped_skill():
    # A skill dropped from CI is a skill whose references rot unnoticed; #390
    # retired ultraplan and added ultrawrite, so derive the list, never type it.
    ci = (ROOT / ".github/workflows/ci.yml").read_text()
    shipped = sorted(d.name for d in (ROOT / "skills").iterdir()
                     if (d / "SKILL.md").is_file())
    assert shipped == ["ultradocket", "ultralearn", "ultrapowers", "ultrawrite"]
    # Since #641 CI validates `skills/*/` in one loop, so every directory the
    # tree ships is covered without being named; the pin is on the loop.
    assert "for s in skills/*/; do" in ci, \
        ".github/workflows/ci.yml does not loop over skills/*/"
    assert "validate_skill.py \"${s%/}\"" in ci
    assert "ultraplan" not in ci

def test_missing_description_fails(tmp_path):
    (tmp_path / "SKILL.md").write_text("---\nname: x\n---\nbody\n")
    code, out = run(tmp_path)
    assert code != 0 and "description" in out

def test_bad_name_chars_fail(tmp_path):
    (tmp_path / "SKILL.md").write_text(
        "---\nname: bad name (x)\ndescription: Use when testing this validator thing.\n---\nbody\n")
    code, out = run(tmp_path)
    assert code != 0 and "name" in out

def test_overlong_description_fails(tmp_path):
    (tmp_path / "SKILL.md").write_text(
        "---\nname: x\ndescription: " + "w" * 1100 + "\n---\nbody\n")
    code, out = run(tmp_path)
    assert code != 0 and "1024" in out

def test_missing_script_link_fails(tmp_path):
    (tmp_path / "SKILL.md").write_text(
        "---\nname: x\ndescription: Use when testing this validator thing.\n---\n"
        "run scripts/missing_tool.py\n")
    code, out = run(tmp_path)
    assert code != 0 and "missing_tool.py" in out

def test_missing_reference_fails(tmp_path):
    (tmp_path / "SKILL.md").write_text(
        "---\nname: x\ndescription: This skill should be used when ...\n---\n"
        "see references/missing.md\n")
    code, out = run(tmp_path)
    assert code != 0 and "missing.md" in out


def test_sibling_skill_reference_resolves_against_that_skill(tmp_path):
    # #159: `skills/<name>/scripts/x` resolves against the sibling skill dir
    # (present -> green, absent -> red), never against this skill's dir.
    skills = tmp_path / "skills"
    (skills / "y/scripts").mkdir(parents=True)
    (skills / "y/scripts/there.py").write_text("")
    (skills / "x").mkdir()
    fm = "---\nname: x\ndescription: Use when testing sibling skill references.\n---\n"
    (skills / "x/SKILL.md").write_text(
        fm + "run `${CLAUDE_PLUGIN_ROOT}/skills/y/scripts/there.py` first\n")
    code, out = run(skills / "x")
    assert code == 0, out
    (skills / "x/SKILL.md").write_text(
        fm + "run `${CLAUDE_PLUGIN_ROOT}/skills/y/scripts/nope.py` first\n")
    code, out = run(skills / "x")
    assert code != 0 and "nope.py" in out and "skill y" in out

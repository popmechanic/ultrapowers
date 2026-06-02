import subprocess, sys, pathlib, textwrap
ROOT = pathlib.Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "skills/ultra-driven-development/scripts/validate_skill.py"

def run(skill_dir):
    p = subprocess.run([sys.executable, str(VALIDATOR), str(skill_dir)],
                       capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr

def test_good_skill_passes():
    code, out = run(ROOT / "tests/fixtures/good-skill")
    assert code == 0, out

def test_missing_description_fails(tmp_path):
    (tmp_path / "SKILL.md").write_text("---\nname: x\n---\nbody\n")
    code, out = run(tmp_path)
    assert code != 0 and "description" in out

def test_missing_reference_fails(tmp_path):
    (tmp_path / "SKILL.md").write_text(
        "---\nname: x\ndescription: This skill should be used when ...\n---\n"
        "see references/missing.md\n")
    code, out = run(tmp_path)
    assert code != 0 and "missing.md" in out

# tests/test_compat_skill_wiring.py
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/ultrapowers/SKILL.md"


def test_step1_invokes_compat_script():
    text = SKILL.read_text()
    assert "check_superpowers_compat.py" in text


def test_step1_documents_graded_behavior():
    text = SKILL.read_text().lower()
    assert "contract token" in text       # the gate condition
    assert "advisory" in text             # the version-delta warn path
    assert "human" in text                # the block-with-override gate


def test_step1_no_longer_lists_a_hard_coded_cache_path():
    text = SKILL.read_text()
    assert "plugins/cache/claude-plugins-official/superpowers/`" not in text
    assert "vendored Superpowers v6 snapshot (dev 08fc48c)" not in text

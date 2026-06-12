"""SKILL.md Step 5 must offer the report-derived Salvage path, and
report-format.md must present it alongside Approve/Redirect."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/ultrapowers/SKILL.md"
REPORT = ROOT / "skills/ultrapowers/references/report-format.md"


def test_skill_step5_offers_salvage():
    text = SKILL.read_text()
    assert "**Salvage**" in text
    assert "PRIOR ATTEMPT" in text          # failed-task bodies carry the kept branch + findings
    assert text.count("resume: true") >= 2  # both Salvage and Redirect relaunch via resume


def test_salvage_is_built_from_the_report():
    text = SKILL.read_text()
    assert "kept branch" in text            # prior-attempt coordinates from tasks[]
    assert "unfinished" in text             # dep-blocked tasks ride along verbatim


def test_report_format_presents_salvage():
    text = REPORT.read_text()
    assert "**Salvage**" in text

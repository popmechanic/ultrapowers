import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/ultralearn/SKILL.md"
LENSES = ROOT / "skills/ultralearn/references/reading-lenses.md"
HARVEST = ROOT / "skills/ultralearn/scripts/harvest_fleet_runs.py"


def test_the_known_gap_paragraph_is_gone():
    assert "KNOWN GAP since 0.3.0" not in SKILL.read_text()


def test_skill_names_the_fleet_harvester_and_its_corpus():
    text = SKILL.read_text()
    assert "harvest_fleet_runs.py" in text
    assert "events.jsonl" in text


def test_every_flag_the_skill_advertises_exists():
    help_text = subprocess.run(
        [sys.executable, str(HARVEST), "--help"],
        capture_output=True, text=True, check=True).stdout
    advertised = set(re.findall(r"`?(--[a-z][a-z-]+)", SKILL.read_text()))
    for flag in advertised & {"--remote", "--run", "--cache", "--force",
                              "--origin", "--engine-version", "--slice-budget",
                              "--remote-root"}:
        assert flag in help_text, f"SKILL.md advertises {flag}, the CLI has no such flag"


def test_lenses_carry_the_cutover_disciplines():
    text = LENSES.read_text()
    assert "## Reading across the cutover" in text
    assert "deleted, not fixed" in text
    assert "ULID" in text

"""ultralearn's SKILL.md and its harvester agree.

The two sentence pins that stood here (a deleted paragraph, three phrases in
`reading-lenses.md`) are gone with the rest of the prose diet. What survives is
the pair that reads code: the skill names the script and the file it consumes,
and every flag it advertises is a flag the CLI actually has.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/ultralearn/SKILL.md"
HARVEST = ROOT / "skills/ultralearn/scripts/harvest_fleet_runs.py"


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

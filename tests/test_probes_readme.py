"""Pin: fleet/tests/PROBES.md exists as the note explaining the `probe_*.mjs`
convention — probes spend real tokens against a real `claude -p`, so they are
deliberately not named `test_*.mjs` and never run in CI or the suite."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROBES = ROOT / "fleet" / "tests" / "PROBES.md"


def test_probes_note_exists():
    assert PROBES.is_file()


def test_probes_note_is_non_empty():
    assert PROBES.read_text().strip()


def test_probes_note_names_the_bypass_probe_and_the_live_cli():
    text = PROBES.read_text()
    assert "probe_bypass_vs_hook.mjs" in text
    assert "claude -p" in text

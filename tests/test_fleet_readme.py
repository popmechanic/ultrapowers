"""Pin: fleet/tests/README.md exists as the index of the fleet engine's test
suite, and names the two boundaries that are easiest to lose track of — the
deterministic engine entry and the implementer confinement hook."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
README = ROOT / "fleet" / "tests" / "README.md"


def test_fleet_tests_readme_exists():
    assert README.is_file()


def test_fleet_tests_readme_is_non_empty():
    assert README.read_text().strip()


def test_fleet_tests_readme_names_the_engine_entry_and_confinement_tests():
    text = README.read_text()
    assert "test_run_main.mjs" in text
    assert "test_confine_hook.mjs" in text

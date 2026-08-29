"""Pin: fleet/roles/README.md exists as the note on the judgment-role prompts,
and names the two things that make the directory make sense — the engine that
reads it at dispatch, and the amendment that keeps choreography out of it."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
README = ROOT / "fleet" / "roles" / "README.md"


def test_roles_readme_exists():
    assert README.is_file()


def test_roles_readme_is_non_empty():
    assert README.read_text().strip()


def test_roles_readme_names_the_engine_and_the_amendment():
    text = README.read_text()
    assert "run-engine.mjs" in text
    assert "Amendment 10" in text

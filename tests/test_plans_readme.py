"""The plans/ directory is historical as of 0.3.0 — the signed artifact that
drives a run is the intent document. Pin the note's presence and key content in
runtime form so the directory can never again read as the live input."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
README = ROOT / "docs/superpowers/plans/README.md"


def test_plans_readme_exists():
    assert README.is_file(), f"missing {README}"


def test_plans_readme_is_non_empty():
    assert README.read_text().strip(), f"{README} is empty"


def test_plans_readme_calls_the_directory_historical():
    assert "historical" in README.read_text().lower()


def test_plans_readme_points_to_intents():
    assert "intents" in README.read_text()

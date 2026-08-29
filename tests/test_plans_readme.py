"""`docs/superpowers/plans/` is historical from 0.3.0 — the note saying so has
to stay committed, so pin its presence and its two load-bearing words
(`historical`, and the pointer to `intents`) in runtime form."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
README = ROOT / "docs/superpowers/plans/README.md"


def test_plans_readme_exists_and_is_non_empty():
    assert README.exists(), f"missing {README}"
    assert README.read_text().strip(), f"empty {README}"


def test_plans_readme_marks_the_directory_historical():
    assert "historical" in README.read_text()


def test_plans_readme_points_at_intents():
    assert "intents" in README.read_text()

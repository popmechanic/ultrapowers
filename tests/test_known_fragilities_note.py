import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
NOTE = ROOT / "skills/ultrapowers/references/known-fragilities.md"


def test_note_exists_and_covers_git_ultra():
    assert NOTE.exists(), "known-fragilities.md is missing"
    text = NOTE.read_text()
    assert ".git/ultra" in text
    assert "git-common-dir" in text
    assert "6.0.3" in text  # ties it to the superpowers precedent

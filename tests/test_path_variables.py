"""One path-variable convention: ${CLAUDE_PLUGIN_ROOT}. Two conventions invite
a broken substitution on a surface where only one is set (issue #16)."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]


def test_no_claude_skill_dir_variable_in_plugin_surfaces():
    hits = []
    for p in (ROOT / "skills").rglob("*"):
        if p.is_file() and p.suffix in {".md", ".js", ".sh", ".py"}:
            if "CLAUDE_SKILL_DIR" in p.read_text():
                hits.append(str(p.relative_to(ROOT)))
    assert hits == [], f"CLAUDE_SKILL_DIR crept back into: {hits}"

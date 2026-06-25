import pathlib, sys
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
import superpowers_contract as sc  # noqa: E402


def _synthesize(root, omit_index=None):
    """Write a full superpowers tree under `root` that satisfies every MANIFEST
    entry (derived from MANIFEST itself, so it never drifts). When omit_index is
    set, the token for MANIFEST[omit_index] is left out of its file."""
    by_file = defaultdict(list)
    for i, e in enumerate(sc.MANIFEST):
        by_file[e["rel"]].append((i, e))
    for rel, entries in by_file.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        chunks = []
        for i, e in entries:
            if i == omit_index or e.get("exists_only"):
                continue
            tok = e.get("any_of", [e.get("token")])[0]
            chunks.append(tok)
        p.write_text("\n".join(chunks) + "\n")


def test_check_passes_on_full_tree(tmp_path):
    _synthesize(tmp_path)
    rep = sc.check(tmp_path)
    assert rep.ok is True
    assert rep.missing == []
    assert rep.checked == len(sc.MANIFEST)


def test_check_reports_exact_missing_token(tmp_path):
    # Drop the "### Task N:" entry's token; check must name that entry.
    idx = next(i for i, e in enumerate(sc.MANIFEST) if e.get("token") == "### Task N:")
    _synthesize(tmp_path, omit_index=idx)
    rep = sc.check(tmp_path)
    assert rep.ok is False
    assert any(m.get("token") == "### Task N:" for m in rep.missing)


def test_check_reports_absent_file_as_missing(tmp_path):
    # Empty tree → every entry missing (no partial-tree skip after the GA-flip).
    rep = sc.check(tmp_path)
    assert rep.ok is False
    assert len(rep.missing) == len(sc.MANIFEST)


def test_tested_against_is_pinned():
    assert sc.TESTED_AGAINST == "6.0.3"

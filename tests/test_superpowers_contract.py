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


def _cleanly_omittable_index():
    """First MANIFEST index whose token is NOT a substring of any sibling token
    sharing its file — i.e. one that can be made genuinely absent by omitting only
    its own line.

    A prefix entry is NOT cleanly omittable: "### Task N:" is a substring of
    "### Task N: [Component Name]" (same file), so under correct substring matching
    dropping its own line still leaves it present inside the longer heading. That
    prefix relationship is real, not synthetic — in upstream writing-plans/SKILL.md
    the ONLY occurrence of "### Task N:" is inside "### Task N: [Component Name]".
    A checker that could report "### Task N:" missing in isolation would have to be
    line-anchored, which is exactly the bug that falsely flagged ~17 mid-line
    tokens as missing against real 6.0.0 / 6.0.3 installs."""
    for i, e in enumerate(sc.MANIFEST):
        tok = e.get("token")
        if not tok:
            continue
        sibling_tokens = [
            t
            for j, o in enumerate(sc.MANIFEST)
            if j != i and o["rel"] == e["rel"]
            for t in o.get("any_of", [o.get("token")])
            if t
        ]
        if not any(tok in st for st in sibling_tokens):
            return i, tok
    raise AssertionError("no cleanly omittable MANIFEST entry found")


def test_check_passes_on_full_tree(tmp_path):
    _synthesize(tmp_path)
    rep = sc.check(tmp_path)
    assert rep.ok is True
    assert rep.missing == []
    assert rep.checked == len(sc.MANIFEST)


def test_check_reports_exact_missing_token(tmp_path):
    # Drop a single uniquely-identifiable token and confirm check() names exactly
    # that entry. We pick a token that is not a substring of any sibling token in
    # the same file (see _cleanly_omittable_index) so the omission is genuinely
    # detectable under plain substring matching.
    idx, tok = _cleanly_omittable_index()
    _synthesize(tmp_path, omit_index=idx)
    rep = sc.check(tmp_path)
    assert rep.ok is False
    assert [m.get("token") for m in rep.missing] == [tok]


def test_check_matches_tokens_embedded_mid_line(tmp_path):
    """Regression for the line-anchoring bug. Real upstream SKILL.md files carry
    contract tokens mid-line (the token does not terminate its line). Write every
    token wrapped in surrounding prose and assert check() still finds them all.

    A line-anchored implementation (requiring `token + "\\n"`) reports ~17 of these
    as falsely MISSING; correct plain-substring matching reports zero missing."""
    by_file = defaultdict(list)
    for e in sc.MANIFEST:
        by_file[e["rel"]].append(e)
    for rel, entries in by_file.items():
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        lines = []
        for e in entries:
            if e.get("exists_only"):
                continue
            tok = e.get("any_of", [e.get("token")])[0]
            # trailing content guarantees the token never terminates its line
            lines.append(f"leading prose {tok} and trailing prose")
        p.write_text("\n".join(lines) + "\n")
    rep = sc.check(tmp_path)
    assert rep.ok is True, [m.get("token") or m.get("any_of") for m in rep.missing]
    assert rep.missing == []


def test_check_reports_absent_file_as_missing(tmp_path):
    # Empty tree → every entry missing (no partial-tree skip after the GA-flip).
    rep = sc.check(tmp_path)
    assert rep.ok is False
    assert len(rep.missing) == len(sc.MANIFEST)


def test_tested_against_is_pinned():
    assert sc.TESTED_AGAINST == "6.0.3"

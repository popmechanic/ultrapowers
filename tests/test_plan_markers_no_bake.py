"""plan-markers.md carries no BAKE fences; the marker contract reads headings.

`2553120` left the four `<!-- BAKE:... -->` fences in plan-markers.md only
because tests/test_marker_contract.py anchored on them — the bake step itself
was deleted in 0.3.0 (PR #434). These legs pin the fences gone, every sentence
between them kept, and tests/test_marker_contract.py reading the same two
sections by their headings instead.
"""
import os
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "skills/ultrapowers/references/plan-markers.md"
CONTRACT_TEST = ROOT / "tests/test_marker_contract.py"

MARKER_SYNTAX = "## Marker syntax"
TYPE_SEMANTICS = "## Type semantics (dispositions)"

# The count of `def test_` functions in tests/test_marker_contract.py at BASE.
# Pinned so a deletion or a gutting of that file cannot green leg (c).
CONTRACT_TEST_MIN_TESTS = 13


def section(text, heading):
    """The slice of `text` from `heading` to the next `## ` line (or EOF)."""
    body, inside = [], False
    for line in text.splitlines(keepends=True):
        if line.startswith("## "):
            if inside:
                break
            inside = line.strip() == heading
        if inside:
            body.append(line)
    assert body, f"plan-markers.md has no {heading!r} section"
    return "".join(body)


def test_contract_doc_carries_no_bake_fences():
    # leg (a)
    assert "BAKE" not in CONTRACT.read_text()


def test_contract_doc_keeps_every_sentence_the_fences_wrapped():
    # leg (b): the two sections the fences used to delimit still say what the
    # fenced blocks said — read by heading now, not by anchor comment.
    text = CONTRACT.read_text()
    assert MARKER_SYNTAX in text
    assert TYPE_SEMANTICS in text

    syntax = section(text, MARKER_SYNTAX)
    assert "**Review:**" in syntax
    assert "**Commutes:**" in syntax
    assert "own `**Files:**`" in syntax
    assert "marker conflict" in syntax

    semantics = section(text, TYPE_SEMANTICS)
    for t in ("implementation", "gate", "release", "manual"):
        assert t in semantics, f"type {t!r} missing from the type-semantics section"


def test_contract_test_reads_headings_not_fences():
    # leg (c)
    src = CONTRACT_TEST.read_text()
    assert "BAKE" not in src
    assert "<!--" not in src
    assert MARKER_SYNTAX in src
    assert TYPE_SEMANTICS in src
    count = len(re.findall(r"^def test_", src, re.MULTILINE))
    assert count >= CONTRACT_TEST_MIN_TESTS, (
        f"tests/test_marker_contract.py defines {count} tests, "
        f"fewer than the {CONTRACT_TEST_MIN_TESTS} it carried at BASE")


def run_contract_test(contract_path=None):
    env = dict(os.environ)
    env.pop("PYTEST_ADDOPTS", None)
    if contract_path is not None:
        env["PLAN_MARKERS_MD"] = str(contract_path)
    else:
        env.pop("PLAN_MARKERS_MD", None)
    return subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "tests/test_marker_contract.py"],
        cwd=ROOT, env=env, capture_output=True, text=True)


def test_contract_test_passes_against_the_fence_free_doc():
    # leg (d), first half
    proc = run_contract_test()
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_contract_test_fails_when_the_marker_syntax_section_loses_commutes(tmp_path):
    # leg (d), second half: gut `**Commutes:**` out of the `## Marker syntax`
    # section of a copy and the contract test must go red — proving the
    # sectioner reads the heading, not a fence.
    text = CONTRACT.read_text()
    syntax = section(text, MARKER_SYNTAX)
    assert "**Commutes:**" in syntax
    gutted = text.replace(syntax, syntax.replace("**Commutes:**", ""))
    assert gutted != text
    copy = tmp_path / "plan-markers.md"
    copy.write_text(gutted)

    proc = run_contract_test(copy)
    assert proc.returncode != 0, (
        "tests/test_marker_contract.py stayed green against a plan-markers.md "
        "whose `## Marker syntax` section lost `**Commutes:**`\n"
        + proc.stdout + proc.stderr)


def test_contract_doc_dropped_the_anchor_note():
    # leg (e)
    assert "no bake step exists since 0.3.0" not in CONTRACT.read_text()

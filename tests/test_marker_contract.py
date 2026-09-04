"""plan-markers.md is the single source of truth for the parallel-execution
marker contract. These tests pin its vocabulary and the fixture that exercises
every marker shape. Sibling test files keep the consumers (compiler reference,
orchestrator, report format) from drifting. Since #390 this file carries the
RUNTIME half only; authoring lives in skills/ultrawrite/SKILL.md."""
import os
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
# Overridable so a test can point this contract at a mutated copy of the doc
# and watch the assertions below go red.
CONTRACT = pathlib.Path(os.environ.get(
    "PLAN_MARKERS_MD", ROOT / "skills/ultrapowers/references/plan-markers.md"))
FIXTURE = ROOT / "tests/fixtures/marked-plan.md"

MARKER_SYNTAX = "## Marker syntax"
TYPE_SEMANTICS = "## Type semantics (dispositions)"
TYPES = ("implementation", "gate", "release", "manual")


def contract_sections():
    """plan-markers.md split by `## ` heading — each section runs from its
    heading to the next `## ` line. The sections are the anchors; the doc
    carries no comment fences to anchor on (0.3.0 deleted the bake step)."""
    sections, heading = {}, None
    for line in CONTRACT.read_text().splitlines(keepends=True):
        if line.startswith("## "):
            heading = line.strip()
            sections[heading] = []
        if heading is not None:
            sections[heading].append(line)
    assert sections, "no `## ` sections found in plan-markers.md"
    return {name: "".join(body) for name, body in sections.items()}


def test_contract_defines_both_markers_and_all_types():
    text = CONTRACT.read_text()
    assert "**Type:**" in text
    assert "**Depends-on:**" in text
    for t in TYPES:
        assert t in text, f"type '{t}' missing from the contract"


def test_contract_review_marker_lives_in_marker_syntax_section():
    # The Review marker (#87) is documented inside the existing `## Marker
    # syntax` section, not under a section of its own — with the ultraplan
    # mirror retired (#390), this section IS the authoritative statement.
    syntax = contract_sections()[MARKER_SYNTAX]
    assert "**Review:**" in syntax
    # #556: the documented value is `peer` — it names the shape (a second
    # independent read of the patch), not an attitude toward the author.
    assert "peer" in syntax
    assert "lean" in syntax


def test_contract_commutes_marker_lives_in_marker_syntax_section():
    # `**Commutes:**` is documented inside the same `## Marker syntax` section
    # (same discipline as **Review:**) — one section the compiler's own
    # vocabulary is read against, not a second source of truth.
    syntax = contract_sections()[MARKER_SYNTAX]
    assert "**Commutes:**" in syntax
    assert "own `**Files:**`" in syntax          # the own-Files validation rule
    assert "marker conflict" in syntax           # a stray path is never a compile error


DELETED_EDGE_LABELS = ("read-after-write", "prose-reference", "ambiguous-files",
                       "description-inferred")


def test_contract_no_longer_documents_the_deleted_edge_tiers():
    # Kept `why` vocabulary: marker | text | interface | write-after-create
    # (+ write-after-write under `--overlap serialize`). The contract doc must
    # not keep advertising tiers the compiler no longer emits.
    text = CONTRACT.read_text()
    for label in DELETED_EDGE_LABELS:
        assert label not in text, f"plan-markers.md still documents deleted edge tier {label!r}"


def test_contract_documents_review_marker_semantics():
    text = CONTRACT.read_text()
    assert "**Review:**" in text
    assert "peer" in text
    assert "lean" in text
    # unmarked = lean, and an invalid/duplicate value is a compile error —
    # these are the semantics the compiler (task 1) actually implements.
    assert "compile error" in text.lower() or "compile-time" in text.lower()


def test_contract_has_the_two_marker_sections_this_file_reads_by_heading():
    sections = contract_sections()
    for heading in (MARKER_SYNTAX, TYPE_SEMANTICS):
        assert heading in sections, "plan-markers.md lost section " + heading
    for t in TYPES:
        assert t in sections[TYPE_SEMANTICS], (
            f"type '{t}' missing from the {TYPE_SEMANTICS!r} section")


def test_fixture_covers_every_marker_shape():
    p = FIXTURE.read_text()
    assert p.count("### Task") == 5
    assert p.count("**Type:**") == 4        # Task 2 deliberately has no Type (default)
    assert "**Type:** gate" in p
    assert "**Type:** release" in p
    assert "**Depends-on:** 1" in p          # explicit edge Task 1 -> Task 3
    assert "**Depends-on:** none" in p
    # canary expectations for the compiler: waves [[1,2],[3]], 4 -> config, 5 -> runbook
    assert "Create: `a.txt`" in p
    assert "Modify: `a.txt`" in p


# #390 cutover: plan-markers.md is now the RUNTIME half only. The authoring
# half moved to skills/ultrawrite/SKILL.md, so the sections that addressed the
# plan author must be gone from this file — not merely reworded.
DELETED_AUTHORING_SECTIONS = (
    "## Executor variance",
    "## Authoring rules that complement the markers",
)


def test_contract_no_longer_carries_the_authoring_half():
    text = CONTRACT.read_text()
    for heading in DELETED_AUTHORING_SECTIONS:
        assert heading not in text, \
            f"plan-markers.md still carries the authoring-half section {heading!r}"
    # The retired authoring skill is not named anywhere in the runtime contract.
    assert "ultraplan" not in text


def test_contract_keeps_the_runtime_half_intact():
    text = CONTRACT.read_text()
    for heading in ("## The worktree-pure task contract", "## Marker syntax",
                    "## Type semantics (dispositions)",
                    "## Classification heuristics (unmarked plans)",
                    "## Compile-time obligations", "## Files grammar",
                    "## Interfaces grammar"):
        assert heading in text, f"plan-markers.md lost runtime section {heading!r}"


RELEASE_PATTERNS = ("git push", "git checkout main", "git merge", "ssh", "scp",
                    "systemctl", "after the branch merges")


def test_contract_documents_compiler_release_patterns():
    doc = CONTRACT.read_text()
    src = (ROOT / "skills/ultrapowers/scripts/compile_plan.py").read_text()
    for pat in RELEASE_PATTERNS:
        assert pat in src, (
            f"compiler lost release pattern {pat!r} — update plan-markers.md's "
            "disclosure paragraph and this list together")
        assert pat in doc, (
            f"plan-markers.md does not disclose compiler release pattern {pat!r}")


MANUAL_PATTERNS = ("the owner runs", "cannot be done from this machine", "on the deployment")
GATE_PATTERNS = ("pytest", "npm test", "git status", "git log")


def test_contract_documents_compiler_manual_and_gate_heuristics():
    """plan-markers.md's heuristic disclosure must move with MANUAL_EV/GATE_EV —
    the release patterns are already three-way pinned; these were not."""
    doc = CONTRACT.read_text()
    src = (ROOT / "skills/ultrapowers/scripts/compile_plan.py").read_text()
    for pat in MANUAL_PATTERNS + GATE_PATTERNS:
        assert pat in src, (
            f"compiler lost heuristic pattern {pat!r} — update plan-markers.md's "
            "disclosure paragraph and this list together")
    # The disclosure paragraph names the one manual pattern the documented
    # heuristic itself omits; pin that claim specifically.
    assert "on the deployment" in doc, (
        "plan-markers.md no longer discloses the 'on the deployment' manual pattern")


def test_contract_documents_empty_writes_gate_rule():
    src = (ROOT / "skills/ultrapowers/scripts/compile_plan.py").read_text()
    doc = (ROOT / "skills/ultrapowers/references/plan-markers.md").read_text()
    # the empty-writes build/QA -> gate rule must be disclosed in the contract doc
    assert "empty" in doc.lower() and "writes" in doc.lower() and "gate" in doc.lower()
    assert "EMPTY_WRITES_GATE" in src  # the rule's named marker in the compiler

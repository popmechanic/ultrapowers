"""plan-markers.md is the single source of truth for the parallel-execution
marker contract. These tests pin its vocabulary and the fixture that exercises
every marker shape. Sibling test files keep the consumers (compiler reference,
orchestrator, report format) from drifting. Since #390 this file carries the
RUNTIME half only; authoring lives in skills/ultrawrite/SKILL.md."""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "skills/ultrapowers/references/plan-markers.md"
FIXTURE = ROOT / "tests/fixtures/marked-plan.md"

MARKER = re.compile(r"<!-- BAKE:(\w+) -->(.*?)<!-- /BAKE -->", re.DOTALL)
TYPES = ("implementation", "gate", "release", "manual")


def contract_blocks():
    blocks = {name: body for name, body in MARKER.findall(CONTRACT.read_text())}
    assert blocks, "no <!-- BAKE:NAME --> markers found in plan-markers.md"
    return blocks


def test_contract_defines_both_markers_and_all_types():
    text = CONTRACT.read_text()
    assert "**Type:**" in text
    assert "**Depends-on:**" in text
    for t in TYPES:
        assert t in text, f"type '{t}' missing from the contract"


def test_contract_review_marker_lives_in_marker_syntax_block():
    # The Review marker (#87) is documented as an extension of the existing
    # MARKER_SYNTAX block, not a new BAKE block — with the ultraplan mirror
    # retired (#390), this block IS the authoritative statement of the marker.
    blocks = contract_blocks()
    syntax = blocks["MARKER_SYNTAX"]
    assert "**Review:**" in syntax
    assert "adversarial" in syntax
    assert "lean" in syntax


def test_contract_commutes_marker_lives_in_marker_syntax_block():
    # `**Commutes:**` is documented as an extension of the existing
    # MARKER_SYNTAX block (same discipline as **Review:**) — one block the
    # compiler's own vocabulary is read against, not a second source of truth.
    blocks = contract_blocks()
    syntax = blocks["MARKER_SYNTAX"]
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
    assert "adversarial" in text
    assert "lean" in text
    # unmarked = lean, and an invalid/duplicate value is a compile error —
    # these are the semantics the compiler (task 1) actually implements.
    assert "compile error" in text.lower() or "compile-time" in text.lower()


def test_contract_has_bake_blocks_for_mirroring():
    blocks = contract_blocks()
    for name in ("MARKER_SYNTAX", "TYPE_SEMANTICS"):
        assert name in blocks, "missing BAKE marker for " + name


def test_contract_states_the_invariants():
    text = CONTRACT.read_text()
    assert "worktree-pure" in text          # contract is an invariant, not a pattern list
    assert "post-merge runbook" in text     # excluded tasks are never silently dropped
    assert "additive" in text               # Depends-on never replaces file-edge inference
    assert "fence-aware" in text            # body-extraction hazard is documented


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

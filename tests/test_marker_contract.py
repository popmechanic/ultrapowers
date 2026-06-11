"""plan-markers.md is the single source of truth for the parallel-execution
marker contract. These tests pin its vocabulary and the fixture that exercises
every marker shape. Sibling test files keep the consumers (compiler reference,
authoring skill, orchestrator, report format) from drifting."""
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


def test_contract_defines_executor_variance():
    text = CONTRACT.read_text()
    assert "## Executor variance" in text
    assert "sequential executor" in text.lower()


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

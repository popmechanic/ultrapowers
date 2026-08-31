"""The ultraplan authoring skill CITES the canonical marker contract
(skills/ultrapowers/references/plan-markers.md) instead of mirroring it.

#492: the mirror existed because the SKILL was believed unable to reference
across skill directories. It could — `validate_skill.py` has resolved a
`skills/<name>/references/<file>` prefix against the sibling skill's directory
since #159; only this file's own prohibition test enforced the ban, and its
comment stated a rationale the validator had already outgrown. A citation
cannot drift from its source, so the two anti-drift pins it replaces are gone.
What is still pinned here is the CONTRACT's own content and the SKILL's
authoring judgment, which is ultraplan's and is not in the contract."""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "skills/ultrapowers/references/plan-markers.md"
ULTRAPLAN = ROOT / "skills/ultraplan/SKILL.md"

MARKER = re.compile(r"<!-- BAKE:(\w+) -->(.*?)<!-- /BAKE -->", re.DOTALL)


def contract_blocks():
    blocks = {name: body for name, body in MARKER.findall(CONTRACT.read_text())}
    assert blocks, "no <!-- BAKE:NAME --> markers found in plan-markers.md"
    return blocks


def test_ultraplan_cites_the_canonical_contract():
    # The inverse of the prohibition this replaces. Two separate things have to
    # be true and only one of them is validate_skill.py's business:
    #
    #  (a) it VALIDATES — `validate_skill.py` resolves a `skills/<name>/` prefix
    #      against the SIBLING skill's directory (#159), and the ${...} prefix
    #      does not defeat that match. CI proves it every run.
    #  (b) it RESOLVES FOR THE AGENT — a bare repo-relative path does not. The
    #      authoring agent's cwd is the USER's project, not the plugin root, so
    #      a citation without ${CLAUDE_PLUGIN_ROOT} validates in CI and then
    #      dangles in the only place that matters. That is the idiom
    #      dependency-analysis.md and report-format.md already use for paths an
    #      agent must actually open.
    text = ULTRAPLAN.read_text()
    assert "${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/references/plan-markers.md" in text
    bare = text.count("skills/ultrapowers/references/plan-markers.md")
    rooted = text.count("${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/references/plan-markers.md")
    assert bare == rooted, (
        "a citation of plan-markers.md without ${CLAUDE_PLUGIN_ROOT} will not "
        "resolve from the agent's cwd")


def test_the_cited_contract_exists_where_the_skill_says_it_does():
    # The citation is only as good as the file. If plan-markers.md ever moves,
    # this fails here rather than silently in an authoring session.
    assert CONTRACT.is_file()


def test_ultraplan_pairs_with_writing_plans():
    text = ULTRAPLAN.read_text()
    assert "superpowers:writing-plans" in text
    assert "worktree-pure" in text


def test_ultraplan_overrides_the_execution_header_and_handoff():
    text = ULTRAPLAN.read_text()
    assert "REQUIRED SUB-SKILL" in text          # quotes the upstream header it replaces
    assert "ultrapowers:ultrapowers" in text     # names the parallel executor
    assert "Execution Handoff" in text           # overrides writing-plans' two-option menu
    # Anti-drift pin for the no-pause contract (2026-06-12): the handoff's
    # option 1 must keep saying that selecting ultrapowers authorizes
    # execution with no further approval pause (mirrors SKILL.md Step 3).
    assert "authorizes execution" in text
    assert "without a further approval pause" in text


def test_ultraplan_handoff_analyzes_before_recommending():
    text = ULTRAPLAN.read_text()
    # The reflex crown is gone: no unconditional "recommended for marked plans".
    assert "(recommended for marked plans)" not in text
    # The handoff now runs a fit analysis grounded in the rubric.
    assert "parallel width" in text
    assert "risk override" in text
    assert "T≥4" in text
    # All three lanes are named as recommendable outcomes.
    for lane in ("Ultrapowers", "Subagent-Driven", "Inline"):
        assert lane in text


def test_ultraplan_names_every_marker_the_contract_defines():
    # The SKILL no longer restates marker semantics, but it must still NAME each
    # marker — an author who never learns a marker exists will not go read its
    # contract. The contract half of the pin stays: a BAKE-block edit that drops
    # **Review:** is still caught.
    blocks = contract_blocks()
    assert "**Review:**" in blocks["MARKER_SYNTAX"]
    text = ULTRAPLAN.read_text()
    for marker in ("**Type:**", "**Depends-on:**", "**Review:**", "**Commutes:**"):
        assert marker in text, "ultraplan does not name the " + marker + " marker"
    assert "adversarial" in text and "lean" in text


def test_ultraplan_carries_the_commutes_and_resolver_doctrine():
    text = ULTRAPLAN.read_text()
    # The Commutes marker is authored here, not only in the compiler.
    assert "**Commutes:**" in text
    # Fold-native authoring guidance: write tasks the merge resolver can fold.
    assert "author for the resolver" in text.lower()


def test_ultraplan_drops_the_phantom_edge_authoring_rules():
    # The prose-reference / description-inferred tiers are deleted from the
    # compiler, so the authoring rules that existed only to dodge them go too.
    text = ULTRAPLAN.read_text()
    assert "Describe siblings by role" not in text
    assert "description-inferred" not in text
    assert "prose-reference" not in text


def test_contract_documents_the_files_grammar():
    # plan-markers.md is the canonical contract (#85): it must document the
    # narrowed Files grammar the compiler now enforces — canonical labels,
    # the annotation/glob bail, and the catch-all construct.
    text = CONTRACT.read_text()
    assert "Create" in text and "Modify" in text and "Test" in text
    assert "glob" in text.lower()
    # Pin the annotation bail to the Files-grammar section specifically. The
    # old `"annotation" in text.lower()` was satisfied by the preamble line
    # "Additive per-task annotations", not the Files grammar (Task-6 review,
    # #85 redirect); "parenthetical note" appears only in the Files bullet
    # that forbids a trailing annotation on a path.
    assert "parenthetical note" in text.lower()


def test_contract_documents_the_interfaces_grammar():
    # plan-markers.md documents the symbol-list rule and the placeholder
    # forms that tokenize to empty (#85).
    text = CONTRACT.read_text()
    assert "symbol list" in text.lower()
    for placeholder in ("nothing", "none", "n/a"):
        assert placeholder in text


def test_ultraplan_ends_authoring_with_the_check_step():
    # #85: a marked plan is not done until `--check` passes — this is the
    # mandatory final authoring step, not an optional suggestion.
    text = ULTRAPLAN.read_text()
    assert "compile_plan.py --check" in text
    assert "PLAN OK" in text
    assert "not done until it passes the grammar check" in text


def test_shaping_moves_state_the_wave_cost_model():
    """#444 item 1: the four shaping moves are doctrine without a reason.
    An author who does not know the tail is serial and paid per wave has no
    reason to fight for an edge removal — #443 measured 54% of waves are
    decomposition shape, not dependency floor."""
    text = ULTRAPLAN.read_text()
    assert "paid once per wave" in text
    assert "billed dimension" in text
    # width is the cheap axis and the skill must say so
    assert "nearly free up to `WIDTH`" in text


def test_authoring_rules_require_evidence_for_live_world_claims():
    """#458: run-30's acks were guaranteed by its plan's shape. A reviewer can
    check correspondence to recorded evidence; it cannot check truth."""
    text = (ROOT / "skills/ultraplan/SKILL.md").read_text()
    assert "correspondence" in text
    assert "hand-executed record" in text
